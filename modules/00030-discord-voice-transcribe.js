/*************************************************************************************
/* filename: "discord-voice-transcribe.js"                                           *
/* Version: 1.0                                                                      *
/* Purpose: Discord voice capture with VAD-style filtering and Whisper transcription *
/*          stored into workingObject.payload                                        *
/*************************************************************************************/
/*************************************************************************************
/*                                                                                   *
/*************************************************************************************/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EndBehaviorType } from "@discordjs/voice";
import prismImport from "prism-media";
import ffmpegImport from "fluent-ffmpeg";
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-voice-transcribe";
const prism = prismImport?.default || prismImport;
const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");

/*************************************************************************************
/* functionSignature: getTmpFile (ext)                                               *
/* Creates a unique temporary WAV or other audio file path.                          *
/*************************************************************************************/
function getTmpFile(ext = ".wav") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dvoice-"));
  const rnd = Math.random().toString(36).slice(2, 8);
  return { dir, file: path.join(dir, `${Date.now()}-${rnd}${ext}`) };
}

/*************************************************************************************
/* functionSignature: getPcmToWav (pcmReadable, options)                             *
/* Converts raw PCM stream to a WAV file with ffmpeg.                                *
/*************************************************************************************/
function getPcmToWav(pcmReadable, { rate = 48000, channels = 1 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const { dir, file } = getTmpFile(".wav");
      ffmpeg()
        .input(pcmReadable)
        .inputOptions([`-f s16le`, `-ar ${rate}`, `-ac ${channels}`])
        .audioCodec("pcm_s16le")
        .format("wav")
        .save(file)
        .on("end", () => resolve({ dir, file }))
        .on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

/*************************************************************************************
/* functionSignature: getBufferPcmToWav (pcmBuffer, options)                         *
/* Writes a PCM buffer into a WAV file via a PassThrough.                            *
/*************************************************************************************/
async function getBufferPcmToWav(pcmBuffer, { rate = 48000, channels = 1 } = {}) {
  const pass = new PassThrough();
  const wavPromise = getPcmToWav(pass, { rate, channels });
  pass.end(pcmBuffer);
  return wavPromise;
}

/*************************************************************************************
/* functionSignature: getAnalyzePcmInt16 (samples, frameSamples)                     *
/* Computes RMS, ZCR, SNR, and voiced frame mask.                                    *
/*************************************************************************************/
function getAnalyzePcmInt16(samples, frameSamples) {
  const totalFrames = Math.floor(samples.length / frameSamples);
  if (totalFrames <= 0) {
    return { totalFrames: 0, snrDb: 0, voicedRatio: 0, voicedFrames: 0, usefulMs: 0, mask: [] };
  }
  const rmsList = new Array(totalFrames);
  const zcrList = new Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    const start = f * frameSamples;
    let sumSq = 0;
    let zc = 0;
    let prev = samples[start];
    for (let i = 1; i < frameSamples; i++) {
      const s = samples[start + i];
      sumSq += s * s;
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) zc++;
      prev = s;
    }
    const rms = Math.sqrt(sumSq / frameSamples) / 32768;
    const zcr = zc / (frameSamples - 1);
    rmsList[f] = rms;
    zcrList[f] = zcr;
  }
  const sorted = rmsList.slice().sort((a, b) => a - b);
  const p = (arr, q) =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * q)))];
  const noise = Math.max(1e-6, p(sorted, 0.2));
  const speech = Math.max(noise + 1e-6, p(sorted, 0.8));
  const snrDb = 20 * Math.log10(speech / noise);
  const mask = new Array(totalFrames);
  let voiced = 0;
  for (let f = 0; f < totalFrames; f++) {
    const voicedLike = rmsList[f] > noise * 2 && zcrList[f] < 0.25;
    mask[f] = voicedLike;
    if (voicedLike) voiced++;
  }
  const msPerFrame = Math.round((frameSamples / 48000) * 1000);
  const usefulMs = voiced * msPerFrame;
  return { totalFrames, snrDb, voicedRatio: voiced / totalFrames, voicedFrames: voiced, usefulMs, mask };
}

/*************************************************************************************
/* functionSignature: getAnalyzeWav (filePath, frameSamples)                         *
/* Analyzes a WAV file and returns voiced frame statistics.                          *
/*************************************************************************************/
async function getAnalyzeWav(filePath, frameSamples) {
  const buf = await fs.promises.readFile(filePath);
  if (!buf || buf.length <= 44) {
    return { totalFrames: 0, snrDb: 0, voicedRatio: 0, voicedFrames: 0, usefulMs: 0, mask: [] };
  }
  const pcm = buf.subarray(44);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  return getAnalyzePcmInt16(samples, frameSamples);
}

/*************************************************************************************
/* functionSignature: getVoicedOnlyWavFromFile (filePath, mask, frameSamples,        *
/*                     options)                                                      *
/* Extracts voiced frames and writes a compact WAV file.                             *
/*************************************************************************************/
async function getVoicedOnlyWavFromFile(filePath, mask, frameSamples, { rate = 48000, channels = 1 } = {}) {
  const buf = await fs.promises.readFile(filePath);
  const pcm = buf.subarray(44);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const voicedSamples = [];
  for (let f = 0; f < mask.length; f++) {
    if (!mask[f]) continue;
    const start = f * frameSamples;
    voicedSamples.push(samples.subarray(start, start + frameSamples));
  }
  if (!voicedSamples.length) return null;
  const total = voicedSamples.reduce((a, s) => a + s.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const s of voicedSamples) {
    out.set(s, off);
    off += s.length;
  }
  const outBuf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  return getBufferPcmToWav(outBuf, { rate, channels });
}

let transcribeWithWhisper = null;
try {
  const mod = await import("../core/whisper.js").catch(() => null);
  if (mod?.transcribeWithWhisper) transcribeWithWhisper = mod.transcribeWithWhisper;
} catch {}

/*************************************************************************************
/* functionSignature: getTranscribeUrl (whisperEndpoint)                              *
/* Normalizes a Whisper transcription endpoint URL.                                  *
/*************************************************************************************/
function getTranscribeUrl(whisperEndpoint) {
  const ep = (whisperEndpoint || "").trim().replace(/\/+$/, "");
  if (ep) {
    if (/\/audio\/transcriptions$/.test(ep)) return ep;
    return `${ep}/v1/audio/transcriptions`;
  }
  const base = (process.env.OPENAI_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/v1/audio/transcriptions` : "https://api.openai.com/v1/audio/transcriptions";
}

/*************************************************************************************
/* functionSignature: getTranscribeOpenAI (filePath, options)                        *
/* Sends a WAV file to OpenAI Whisper and returns text.                              *
/*************************************************************************************/
async function getTranscribeOpenAI(filePath, { model, language, apiKey, endpoint }) {
  let _fetch = globalThis.fetch,
    _FormData = globalThis.FormData,
    _Blob = globalThis.Blob;
  if (!_fetch || !_FormData || !_Blob) {
    const undici = await import("undici");
    _fetch = undici.fetch;
    _FormData = undici.FormData;
    _Blob = undici.Blob;
  }
  const url = getTranscribeUrl(endpoint);
  const fd = new _FormData();
  fd.set("model", model || "whisper-1");
  if (language && language !== "auto") fd.set("language", language);
  const wavBuf = await fs.promises.readFile(filePath);
  fd.set("file", new _Blob([wavBuf], { type: "audio/wav" }), path.basename(filePath));
  const res = await _fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd
  });
  if (!res.ok) throw new Error(`Whisper HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data?.text || "";
}

/*************************************************************************************
/* functionSignature: getCaptureOneSegment (receiver, userId, options)               *
/* Captures one voiced segment and stores it as WAV.                                 *
/*************************************************************************************/
async function getCaptureOneSegment(receiver, userId, { silenceMs = 2000, maxMs = 25000, frameSamples = 960 }) {
  let opus = null,
    pcm = null,
    pass = null,
    killTimer = null,
    wavDir = null,
    wavFile = null,
    endedBy = "silence";
  try {
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: frameSamples });
    opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: silenceMs }
    });
    pcm = opus.pipe(decoder);
    pass = new PassThrough();
    const wavPromise = getPcmToWav(pass, { rate: 48000, channels: 1 });
    pcm.on("data", (chunk) => pass.write(chunk));
    killTimer = setTimeout(() => {
      endedBy = "time";
      try {
        opus.destroy();
      } catch {}
    }, maxMs);
    await new Promise((res) => {
      const finish = () => {
        try {
          clearTimeout(killTimer);
        } catch {}
        try {
          pass.end();
        } catch {}
        res(null);
      };
      opus.once("end", finish);
      opus.once("close", finish);
      opus.once("error", finish);
      pcm.once("end", finish);
      pcm.once("error", finish);
    });
    const wf = await wavPromise;
    wavDir = wf.dir;
    wavFile = wf.file;
    return { dir: wavDir, file: wavFile, endedBy };
  } catch (e) {
    try {
      pass?.end();
    } catch {}
    if (wavDir)
      try {
        await fs.promises.rm(wavDir, { recursive: true, force: true });
      } catch {}
    throw e;
  }
}

/*************************************************************************************
/* functionSignature: getDiscordVoiceTranscribe (coreData)                           *
/* Captures, filters, and transcribes voice into payload.                            *
/*************************************************************************************/
export default async function getDiscordVoiceTranscribe(coreData) {
  const wo = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!(wo?.voiceIntent && wo.voiceIntent.action === "describe_and_transcribe" && wo.voiceIntent.userId)) {
    return coreData;
  }

  wo.voiceTranscribed = false;

  const cfg =
    coreData?.config?.[MODULE_NAME] ||
    coreData?.config?.["discord-voice-transcribe"] ||
    coreData?.config?.["discord-voice"] ||
    {};

  const SILENCE_MS = Number.isFinite(wo.silenceMs)
    ? Number(wo.silenceMs)
    : Number.isFinite(cfg.silenceMs)
    ? Number(cfg.silenceMs)
    : 2000;

  const MAX_SEGMENT_MS = Number.isFinite(wo.maxCaptureMs)
    ? Number(wo.maxCaptureMs)
    : Number.isFinite(cfg.maxCaptureMs)
    ? Number(cfg.maxCaptureMs)
    : 25000;

  const MIN_WAV_BYTES = Number.isFinite(wo.minWavBytes)
    ? Number(wo.minWavBytes)
    : Number.isFinite(cfg.minWavBytes)
    ? Number(cfg.minWavBytes)
    : 24000;

  const SNR_DB_MIN = Number.isFinite(wo.snrDbThreshold)
    ? Number(wo.snrDbThreshold)
    : Number.isFinite(cfg.snrDbThreshold)
    ? Number(cfg.snrDbThreshold)
    : 3.5;

  const MIN_VOICED_MS = Number.isFinite(wo.minVoicedMs)
    ? Number(wo.minVoicedMs)
    : Number.isFinite(cfg.minVoicedMs)
    ? Number(cfg.minVoicedMs)
    : 2000;

  const FRAME_MS = Number.isFinite(wo.frameMs)
    ? Math.max(10, Number(wo.frameMs))
    : Number.isFinite(cfg.frameMs)
    ? Math.max(10, Number(cfg.frameMs))
    : 20;

  const FRAME_SAMPLES = Math.round(48000 * (FRAME_MS / 1000));
  const KEEP_WAV = typeof wo.keepWav === "boolean" ? wo.keepWav : Boolean(cfg.keepWav);

  const WHISPER_KEY = (wo.whisperApiKey || cfg.whisperApiKey || process.env.OPENAI_API_KEY || "").trim();
  const WHISPER_MODEL = (wo.whisperModel || cfg.whisperModel || "whisper-1").trim();
  const WHISPER_LANG = (wo.whisperLanguage || cfg.whisperLanguage || "auto").trim();
  const WHISPER_ENDPOINT = (wo.whisperEndpoint || cfg.whisperEndpoint || "").trim();

  const MAX_SEGMENTS_PER_RUN = Number.isFinite(cfg.maxSegmentsPerRun)
    ? Number(cfg.maxSegmentsPerRun)
    : 32;

  const sessionKey = wo.voiceSessionRef;
  const userId = String(wo.voiceIntent.userId || "");
  if (!sessionKey || !userId) {
    log("Missing sessionKey or userId", "warn", { moduleName: MODULE_NAME, sessionKey, userId });
    return coreData;
  }

  const live = await getItem(sessionKey);
  const receiver = live?.connection?.receiver;
  if (!receiver) {
    log("No receiver on session", "error", { moduleName: MODULE_NAME, sessionKey });
    wo.transcribeSkipped = "no_receiver";
    wo.stop = true;
    return coreData;
  }

  const activeKey = `discord-voice:active:${sessionKey}:${userId}`;

  try {
    await putItem({ ts: Date.now(), sessionKey, userId }, activeKey);
  } catch {}

  try {
    const segments = [];

    while (segments.length < MAX_SEGMENTS_PER_RUN) {
      const seg = await getCaptureOneSegment(receiver, userId, {
        silenceMs: SILENCE_MS,
        maxMs: MAX_SEGMENT_MS,
        frameSamples: FRAME_SAMPLES
      });

      const st = await fs.promises.stat(seg.file).catch(() => null);
      if (!st || st.size < MIN_WAV_BYTES) {
        if (!KEEP_WAV) {
          try {
            await fs.promises.rm(seg.dir, { recursive: true, force: true });
          } catch {}
        }
        if (segments.length === 0) {
          wo.transcribeSkipped = "too_small";
          wo.stop = true;
          return coreData;
        }
        break;
      }

      segments.push(seg);

      if (seg.endedBy !== "time") {
        break;
      }
    }

    if (segments.length === 0) {
      wo.transcribeSkipped = "no_segments";
      wo.stop = true;
      return coreData;
    }

    const filteredWavs = [];
    for (const seg of segments) {
      const { snrDb, usefulMs, mask } = await getAnalyzeWav(seg.file, FRAME_SAMPLES);

      if (usefulMs < MIN_VOICED_MS || snrDb < SNR_DB_MIN) {
        if (!KEEP_WAV) {
          try {
            await fs.promises.rm(seg.dir, { recursive: true, force: true });
          } catch {}
        }
        continue;
      }

      const voicedWav = await getVoicedOnlyWavFromFile(seg.file, mask, FRAME_SAMPLES, {
        rate: 48000,
        channels: 1
      });
      if (!voicedWav) {
        if (!KEEP_WAV) {
          try {
            await fs.promises.rm(seg.dir, { recursive: true, force: true });
          } catch {}
        }
        continue;
      }
      if (!KEEP_WAV) {
        try {
          await fs.promises.rm(seg.dir, { recursive: true, force: true });
        } catch {}
      }
      filteredWavs.push(voicedWav);
    }

    if (filteredWavs.length === 0) {
      wo.transcribeSkipped = "no_voiced_frames";
      wo.stop = true;
      return coreData;
    }

    if (!WHISPER_KEY) {
      for (const w of filteredWavs) {
        if (!KEEP_WAV) {
          try {
            await fs.promises.rm(w.dir, { recursive: true, force: true });
          } catch {}
        }
      }
      wo.transcribeSkipped = "no_api_key";
      wo.stop = true;
      return coreData;
    }

    const parts = [];
    for (const w of filteredWavs) {
      try {
        const text = transcribeWithWhisper
          ? await transcribeWithWhisper(w.file, WHISPER_MODEL, WHISPER_LANG, WHISPER_KEY)
          : await getTranscribeOpenAI(w.file, {
              model: WHISPER_MODEL,
              language: WHISPER_LANG,
              apiKey: WHISPER_KEY,
              endpoint: WHISPER_ENDPOINT
            });
        const cleaned = String(text || "").trim();
        if (cleaned) parts.push(cleaned);
      } finally {
        if (!KEEP_WAV) {
          try {
            await fs.promises.rm(w.dir, { recursive: true, force: true });
          } catch {}
        }
      }
    }

    if (parts.length === 0) {
      wo.transcribeSkipped = "empty_result";
      wo.stop = true;
      return coreData;
    }

    const finalText = parts.join(" ").trim();
    if (finalText) {
      wo.payload = finalText;
      wo.voiceTranscribed = true;
    }

    if (!wo.payload) {
      if (!wo.transcribeSkipped) {
        wo.transcribeSkipped = "empty_result";
      }
      wo.stop = true;
      return coreData;
    }

    try {
      const captureKey = `discord-voice:capture:${sessionKey}`;
      const prev = (await getItem(captureKey)) || [];
      prev.push({
        ts: Date.now(),
        sessionKey,
        guildId: wo.guildId,
        channelId: wo.channelID,
        userId,
        speaker: wo.authorDisplayname || "Unknown",
        segments: parts.length,
        snrDbMinUsed: SNR_DB_MIN,
        minVoicedMsUsed: MIN_VOICED_MS
      });
      while (prev.length > 8) prev.shift();
      await putItem(prev, captureKey);
    } catch {}
  } catch (e) {
    log("Voice transcribe error", "error", {
      moduleName: MODULE_NAME,
      error: e?.message
    });
    wo.transcribeSkipped = wo.transcribeSkipped || "error";
    wo.stop = true;
  } finally {
    try {
      await deleteItem(activeKey);
    } catch {}
  }

  return coreData;
}
