/************************************************************************************
/* filename: 00029-discord-voice-capture.js                                              *
/* Version 1.0                                                                     *
/* Purpose: Discord-voice-specific segment capture + VAD filtering.                *
/*          Combines all voiced PCM frames into a single WAV file and writes       *
/*          the path to wo.audioFile so the downstream transcription module        *
/*          can work source-agnostically.                                           *
/*                                                                                 *
/* Trigger: wo.voiceIntent.action === "describe_and_transcribe"                    *
/*          + wo.voiceIntent.userId                                                 *
/*                                                                                 *
/* Output:  wo.audioFile        — absolute path to voiced WAV (temp file)          *
/*          wo.audioStats       — { snrDb, usefulMs } for quality gate downstream  *
/*          wo.transcribeAudio  — true (signals transcription module to run)       *
/*                                                                                 *
/* Quality decisions (SNR threshold, min voiced ms) are made by the               *
/* downstream transcription module, not here.                                      *
/*                                                                                 *
/* On skip: wo.transcribeSkipped = "<reason>", wo.stop = true                      *
/************************************************************************************/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import prismImport from "prism-media";
import ffmpegImport from "fluent-ffmpeg";
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

let EndBehaviorType = null;
try {
  const dv = await import("@discordjs/voice").catch(() => null);
  if (dv?.EndBehaviorType) EndBehaviorType = dv.EndBehaviorType;
} catch {}

const MODULE_NAME = "discord-voice-capture";
const prism = prismImport?.default || prismImport;
const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");


function getTmpFile(ext = ".wav") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dvcap-"));
  const rnd = Math.random().toString(36).slice(2, 8);
  return { dir, file: path.join(dir, `${Date.now()}-${rnd}${ext}`) };
}


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


function getAnalyzePcmInt16(samples, frameSamples) {
  const totalFrames = Math.floor(samples.length / frameSamples);
  if (totalFrames <= 0) return { snrDb: 0, usefulMs: 0, mask: [] };

  const rmsList = new Array(totalFrames);
  const zcrList = new Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    const start = f * frameSamples;
    let sumSq = 0, zc = 0, prev = samples[start];
    for (let i = 1; i < frameSamples; i++) {
      const s = samples[start + i];
      sumSq += s * s;
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) zc++;
      prev = s;
    }
    rmsList[f] = Math.sqrt(sumSq / frameSamples) / 32768;
    zcrList[f] = zc / (frameSamples - 1);
  }

  const sorted = rmsList.slice().sort((a, b) => a - b);
  const p      = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * q)))];
  const noise  = Math.max(1e-6, p(sorted, 0.2));
  const speech = Math.max(noise + 1e-6, p(sorted, 0.8));
  const snrDb  = 20 * Math.log10(speech / noise);

  let voiced = 0;
  const mask = new Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    mask[f] = rmsList[f] > noise * 2 && zcrList[f] < 0.25;
    if (mask[f]) voiced++;
  }
  const usefulMs = voiced * Math.round((frameSamples / 48000) * 1000);
  return { snrDb, usefulMs, mask };
}


function getExtractVoicedPcm(samples, mask, frameSamples) {
  const chunks = [];
  for (let f = 0; f < mask.length; f++) {
    if (!mask[f]) continue;
    const start = f * frameSamples;
    chunks.push(samples.subarray(start, start + frameSamples));
  }
  if (!chunks.length) return null;
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out   = new Int16Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}


function getWriteWav(samples, { rate = 48000, channels = 1 } = {}) {
  const pcmBytes = samples.byteLength;
  const hdr      = Buffer.alloc(44);
  hdr.write("RIFF", 0);            hdr.writeUInt32LE(36 + pcmBytes, 4);
  hdr.write("WAVE", 8);            hdr.write("fmt ", 12);
  hdr.writeUInt32LE(16, 16);       hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(channels, 22); hdr.writeUInt32LE(rate, 24);
  hdr.writeUInt32LE(rate * channels * 2, 28); hdr.writeUInt16LE(channels * 2, 32);
  hdr.writeUInt16LE(16, 34);       hdr.write("data", 36);
  hdr.writeUInt32LE(pcmBytes, 40);
  return Buffer.concat([hdr, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}


async function getCaptureOneSegment(receiver, userId, { silenceMs, maxMs, frameSamples }) {
  let opus = null, pcm = null, pass = null, killTimer = null, wavDir = null, endedBy = "silence";
  try {
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: frameSamples });
    opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: silenceMs }
    });
    pcm  = opus.pipe(decoder);
    pass = new PassThrough();
    const wavPromise = getPcmToWav(pass, { rate: 48000, channels: 1 });
    pcm.on("data", (chunk) => pass.write(chunk));
    killTimer = setTimeout(() => {
      endedBy = "time";
      try { opus.destroy(); } catch {}
    }, maxMs);
    await new Promise((res) => {
      const finish = () => {
        try { clearTimeout(killTimer); } catch {}
        try { pass.end(); } catch {}
        res(null);
      };
      opus.once("end",   finish); opus.once("close", finish); opus.once("error", finish);
      pcm.once("end",    finish); pcm.once("error",  finish);
    });
    const wf = await wavPromise;
    wavDir = wf.dir;
    return { dir: wavDir, file: wf.file, endedBy };
  } catch (e) {
    try { pass?.end(); } catch {}
    if (wavDir) try { await fs.promises.rm(wavDir, { recursive: true, force: true }); } catch {}
    throw e;
  }
}


export default async function getDiscordVoiceCapture(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!(wo.voiceIntent?.action === "describe_and_transcribe" && wo.voiceIntent?.userId)) {
    return coreData;
  }

  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const SILENCE_MS     = Number.isFinite(wo.silenceMs)   ? +wo.silenceMs   : Number.isFinite(cfg.silenceMs)   ? +cfg.silenceMs   : 2000;
  const MAX_SEGMENT_MS = Number.isFinite(wo.maxCaptureMs) ? +wo.maxCaptureMs : Number.isFinite(cfg.maxCaptureMs) ? +cfg.maxCaptureMs : 25000;
  const MIN_WAV_BYTES  = Number.isFinite(wo.minWavBytes)  ? +wo.minWavBytes  : Number.isFinite(cfg.minWavBytes)  ? +cfg.minWavBytes  : 24000;
  const FRAME_MS       = Number.isFinite(wo.frameMs)      ? Math.max(10, +wo.frameMs) : Number.isFinite(cfg.frameMs) ? Math.max(10, +cfg.frameMs) : 20;
  const FRAME_SAMPLES  = Math.round(48000 * (FRAME_MS / 1000));
  const KEEP_WAV       = typeof wo.keepWav === "boolean" ? wo.keepWav : Boolean(cfg.keepWav);
  const MAX_SEGMENTS   = Number.isFinite(cfg.maxSegmentsPerRun) ? +cfg.maxSegmentsPerRun : 32;

  const sessionKey = wo.voiceSessionRef;
  const userId     = String(wo.voiceIntent.userId || "");

  if (!sessionKey || !userId) {
    log("Missing sessionKey or userId", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const live     = await getItem(sessionKey);
  const receiver = live?.connection?.receiver;
  if (!receiver) {
    log("No voice receiver on session", "error", { moduleName: MODULE_NAME, sessionKey });
    wo.transcribeSkipped = "no_receiver";
    wo.stop       = true;
    wo.stopReason = "no_receiver";
    return coreData;
  }

  const activeKey = `discord-voice:active:${sessionKey}:${userId}`;
  try { await putItem({ ts: Date.now(), sessionKey, userId }, activeKey); } catch {}

  try {
    // ── Capture raw segments ────────────────────────────────────────────────────
    const segments = [];
    while (segments.length < MAX_SEGMENTS) {
      const seg = await getCaptureOneSegment(receiver, userId, {
        silenceMs: SILENCE_MS, maxMs: MAX_SEGMENT_MS, frameSamples: FRAME_SAMPLES
      });
      const st = await fs.promises.stat(seg.file).catch(() => null);
      if (!st || st.size < MIN_WAV_BYTES) {
        try { await fs.promises.rm(seg.dir, { recursive: true, force: true }); } catch {}
        if (!segments.length) { wo.transcribeSkipped = "too_small"; wo.stop = true; wo.stopReason = "too_small"; return coreData; }
        break;
      }
      segments.push(seg);
      if (seg.endedBy !== "time") break;
    }

    if (!segments.length) {
      wo.transcribeSkipped = "no_segments";
      wo.stop       = true;
      wo.stopReason = "no_segments";
      return coreData;
    }

    // ── VAD: extract voiced PCM, accumulate stats ───────────────────────────────
    const voicedChunks = [];
    let totalUsefulMs = 0;
    let maxSnrDb      = 0;

    for (const seg of segments) {
      const buf     = await fs.promises.readFile(seg.file);
      const pcm     = buf.subarray(44);
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
      const { snrDb, usefulMs, mask } = getAnalyzePcmInt16(samples, FRAME_SAMPLES);

      if (!KEEP_WAV) try { await fs.promises.rm(seg.dir, { recursive: true, force: true }); } catch {}

      totalUsefulMs += usefulMs;
      if (snrDb > maxSnrDb) maxSnrDb = snrDb;

      const voiced = getExtractVoicedPcm(samples, mask, FRAME_SAMPLES);
      if (voiced) voicedChunks.push(voiced);
    }

    if (!voicedChunks.length) {
      wo.transcribeSkipped = "no_voiced_frames";
      wo.stop       = true;
      wo.stopReason = "no_voiced_frames";
      return coreData;
    }

    // ── Combine all voiced frames → single WAV ──────────────────────────────────
    const totalSamples = voicedChunks.reduce((a, v) => a + v.length, 0);
    const combined     = new Int16Array(totalSamples);
    let off = 0;
    for (const v of voicedChunks) { combined.set(v, off); off += v.length; }

    const { dir: outDir, file: outFile } = getTmpFile(".wav");
    await fs.promises.writeFile(outFile, getWriteWav(combined, { rate: 48000, channels: 1 }));

    // ── Hand off to transcription module ────────────────────────────────────────
    wo.audioFile        = outFile;
    wo._audioCaptureDir = outDir;
    wo.audioStats       = { snrDb: maxSnrDb, usefulMs: totalUsefulMs };
    wo.transcribeAudio  = true;

    // Capture log (non-critical)
    try {
      const captureKey = `discord-voice:capture:${sessionKey}`;
      const prev = (await getItem(captureKey)) || [];
      prev.push({
        ts: Date.now(), sessionKey,
        guildId: wo.guildId, channelId: wo.channelID,
        userId, speaker: wo.authorDisplayname || "Unknown",
        segments: segments.length
      });
      while (prev.length > 8) prev.shift();
      await putItem(prev, captureKey);
    } catch {}

  } catch (e) {
    log("Voice capture error", "error", { moduleName: MODULE_NAME, error: e?.message });
    wo.transcribeSkipped = wo.transcribeSkipped || "capture_error";
    wo.stop       = true;
    wo.stopReason = wo.transcribeSkipped;
  } finally {
    try { await deleteItem(activeKey); } catch {}
  }

  return coreData;
}
