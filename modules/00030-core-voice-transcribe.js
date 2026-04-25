/**************************************************************/
/* filename: "00030-core-voice-transcribe.js"                       */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/













































import fs           from "node:fs";
import os           from "node:os";
import path         from "node:path";
import ffmpegImport from "fluent-ffmpeg";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import {
  getEnsureDiarizePool, ensureDiarizeTables, listSpeakers,
  buildSamplePreamble, concatPreambleWithAudio, resolveSpeakerMapping,
  createSession, createChunk, upsertChunkSpeaker
} from "../shared/voice/voice-diarize.js";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath (process.env.FFMPEG_PATH  || "/usr/bin/ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "/usr/bin/ffprobe");

const MAX_FILE_BYTES           = 20 * 1024 * 1024;
const DEFAULT_CHUNK_S          = 300;
const DEFAULT_OVERLAP_S        = 60;
const DEFAULT_DIARIZE_CHUNK_MB = 1;
const DEFAULT_OPUS_BITRATE_KBPS = 32;
const SPEAKER_LABELS           = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MODULE_NAME              = "core-voice-transcribe";

let transcribeWithWhisper = null;
try {
  const mod = await import("../core/whisper.js").catch(() => null);
  if (mod?.transcribeWithWhisper) transcribeWithWhisper = mod.transcribeWithWhisper;
} catch {}


function mbToChunkDurationS(targetMB, bitrateKbps) {
  return (targetMB * 1024 * 1024 * 8) / (bitrateKbps * 1000);
}


function getAudioDurationS(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      const dur = meta?.format?.duration;
      if (!Number.isFinite(dur) || dur <= 0)
        return reject(new Error("ffprobe: no duration for " + filePath));
      resolve(dur);
    });
  });
}


function getFirstAppearanceOrder(segments, field) {
  const seen = [];
  for (const seg of segments) {
    const val = seg[field];
    if (val != null && !seen.includes(val)) seen.push(val);
  }
  return seen;
}


async function splitAudioIntoChunks(filePath, chunkDir, chunkDurationS, overlapS, isDiarize, useOpus, opusBitrateKbps) {
  const duration = await getAudioDurationS(filePath);
  const chunks   = [];
  let   logStart = 0;
  let   idx      = 0;
  const ext      = useOpus ? ".ogg" : ".wav";
  const bitrate  = Number.isFinite(opusBitrateKbps) && opusBitrateKbps > 0 ? opusBitrateKbps : DEFAULT_OPUS_BITRATE_KBPS;

  while (logStart < duration) {
    const audioStart = (isDiarize && idx > 0) ? Math.max(0, logStart - overlapS) : logStart;
    const overlapDur = logStart - audioStart;
    const segDur     = Math.min(chunkDurationS + overlapDur, duration - audioStart);
    const out        = path.join(chunkDir, `chunk_${String(idx).padStart(4, "0")}${ext}`);

    await new Promise((resolve, reject) => {
      let cmd = ffmpeg()
        .input(filePath)
        .setStartTime(audioStart)
        .setDuration(segDur)
        .audioFrequency(16000)
        .audioChannels(1);
      if (useOpus) {
        cmd = cmd.audioCodec("libopus").audioBitrate(bitrate).format("ogg");
      } else {
        cmd = cmd.audioCodec("pcm_s16le").format("wav");
      }
      cmd.save(out).on("end", resolve).on("error", reject);
    });

    chunks.push({ file: out, overlapDur });
    logStart += chunkDurationS;
    idx++;
  }

  return chunks;
}


function buildSpeakerMapping(segments, overlapDur, prevGlobalSegments, counter, chunkIdx) {
  const localMap = {};

  if (chunkIdx === 0 || !prevGlobalSegments.length || overlapDur <= 0) {
    for (const seg of segments) {
      if (!localMap[seg.speaker]) {
        localMap[seg.speaker] = SPEAKER_LABELS[counter.n] ?? `S${counter.n}`;
        counter.n++;
      }
    }
    return localMap;
  }

  const overlapCurrent = segments.filter(s => (s.start ?? 0) < overlapDur);
  const currentOrder   = getFirstAppearanceOrder(overlapCurrent, "speaker");

  const prevEnd     = prevGlobalSegments.reduce((m, s) => Math.max(m, s.end ?? 0), 0);
  const overlapPrev = prevGlobalSegments.filter(s => (s.end ?? 0) > prevEnd - overlapDur);
  const prevOrder   = getFirstAppearanceOrder(overlapPrev, "globalLabel");

  for (let i = 0; i < Math.min(currentOrder.length, prevOrder.length); i++) {
    localMap[currentOrder[i]] = prevOrder[i];
  }

  for (const seg of segments) {
    if (!localMap[seg.speaker]) {
      const base = SPEAKER_LABELS[counter.n] ?? `S${counter.n}`;
      counter.n++;
      localMap[seg.speaker] = `${base}_${chunkIdx + 1}`;
    }
  }

  return localMap;
}


function formatDiarizedSegments(segments, localMap, overlapDur) {
  return segments
    .filter(s  => (s.start ?? 0) >= overlapDur)
    .map(s => {
      const label = localMap[s.speaker] ?? s.speaker;
      const text  = (s.text || "").trim();
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}


function getAudioTranscribeUrl(endpoint) {
  const ep = (endpoint || "").trim().replace(/\/+$/, "");
  if (ep) {
    if (/\/audio\/transcriptions$/.test(ep)) return ep;
    return `${ep}/v1/audio/transcriptions`;
  }
  return "https://api.openai.com/v1/audio/transcriptions";
}


async function transcribeOneRaw(fp, { model, language, isDiarize, apiKey, url, prompt, Fetch, FormData, Blob }) {
  const fd = new FormData();
  fd.set("model", model);
  if (language && language !== "auto") fd.set("language", language);
  if (prompt && !isDiarize) fd.set("prompt", prompt);
  if (isDiarize) {
    fd.set("response_format",   "diarized_json");
    fd.set("chunking_strategy", "auto");
  }
  const buf      = await fs.promises.readFile(fp);
  const ext      = path.extname(fp).toLowerCase();
  const mimeType = ext === ".ogg" ? "audio/ogg" : ext === ".mp3" ? "audio/mpeg" : "audio/wav";
  fd.set("file", new Blob([buf], { type: mimeType }), path.basename(fp));
  const res = await Fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    fd
  });
  if (!res.ok) {
    const rawError = await res.text().catch(() => "");
    const detail = String(rawError || "").trim().replace(/\s+/g, " ").slice(0, 500);
    throw new Error(detail ? `Transcribe API HTTP ${res.status}: ${detail}` : `Transcribe API HTTP ${res.status}`);
  }
  return res.json();
}


async function getTranscribeAudio(filePath, { model, language, apiKey, endpoint, chunkDurationS, overlapDurationS }) {
  let Fetch = globalThis.fetch, FormData = globalThis.FormData, Blob = globalThis.Blob;
  if (!Fetch || !FormData || !Blob) {
    const undici = await import("undici");
    Fetch    = undici.fetch;
    FormData = undici.FormData;
    Blob     = undici.Blob;
  }

  const url       = getAudioTranscribeUrl(endpoint);
  const chunkS    = Number.isFinite(chunkDurationS)   && chunkDurationS   > 0 ? chunkDurationS   : DEFAULT_CHUNK_S;
  const overlapS  = Number.isFinite(overlapDurationS) && overlapDurationS > 0 ? overlapDurationS : DEFAULT_OVERLAP_S;
  const isDiarize = String(model || "").toLowerCase().includes("diarize");

  const apiOpts = { model, language, isDiarize, apiKey, url, Fetch, FormData, Blob };

  const stat = await fs.promises.stat(filePath);
  if (stat.size <= MAX_FILE_BYTES) {
    const data = await transcribeOneRaw(filePath, apiOpts);
    if (isDiarize && Array.isArray(data?.segments) && data.segments.some(s => s.speaker)) {
      const counter  = { n: 0 };
      const localMap = buildSpeakerMapping(data.segments, 0, [], counter, 0);
      return formatDiarizedSegments(data.segments, localMap, 0);
    }
    return data?.text || "";
  }

  const chunkDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtchunk-"));
  try {
    const chunks         = await splitAudioIntoChunks(filePath, chunkDir, chunkS, overlapS, isDiarize);
    const counter        = { n: 0 };
    let   prevGlobalSegs = [];
    const parts          = [];

    for (let i = 0; i < chunks.length; i++) {
      const { file, overlapDur } = chunks[i];
      const data = await transcribeOneRaw(file, apiOpts);

      if (isDiarize && Array.isArray(data?.segments) && data.segments.some(s => s.speaker)) {
        const localMap = buildSpeakerMapping(data.segments, overlapDur, prevGlobalSegs, counter, i);
        const text     = formatDiarizedSegments(data.segments, localMap, overlapDur);
        if (text.trim()) parts.push(text.trim());
        prevGlobalSegs = data.segments.map(seg => ({
          ...seg,
          globalLabel: localMap[seg.speaker] ?? seg.speaker
        }));
      } else {
        const text = (typeof data?.text === "string" ? data.text : "").trim();
        if (text) parts.push(text);
        prevGlobalSegs = [];
      }
    }

    return parts.join("\n");
  } finally {
    try { await fs.promises.rm(chunkDir, { recursive: true, force: true }); } catch {}
  }
}


async function getDiarizeWithSamples(filePath, { model, fallbackModel, language, apiKey, endpoint, diarizeChunkMB, opusBitrateKbps, wo }) {
  const log = getPrefixedLogger(wo, import.meta.url);

  let Fetch = globalThis.fetch, FormData = globalThis.FormData, Blob = globalThis.Blob;
  if (!Fetch || !FormData || !Blob) {
    const undici = await import("undici");
    Fetch = undici.fetch; FormData = undici.FormData; Blob = undici.Blob;
  }

  const url           = getAudioTranscribeUrl(endpoint);
  const channelId     = String(wo.channelId || "");
  const chunkMB       = Number.isFinite(diarizeChunkMB) && diarizeChunkMB > 0 ? diarizeChunkMB : DEFAULT_DIARIZE_CHUNK_MB;
  const bitrate       = Number.isFinite(opusBitrateKbps) && opusBitrateKbps > 0 ? opusBitrateKbps : DEFAULT_OPUS_BITRATE_KBPS;
  const diarizeChunkS = mbToChunkDurationS(chunkMB, bitrate);

  log("getDiarizeWithSamples start", "info", { moduleName: MODULE_NAME, channelId, model });

  let pool     = null;
  let speakers = [];
  try {
    pool     = await getEnsureDiarizePool(wo);
    await ensureDiarizeTables(pool);
    if (channelId) speakers = await listSpeakers(pool, channelId);
    log("DB pool ready", "info", { moduleName: MODULE_NAME, speakerCount: speakers.length });
  } catch (e) {
    log("DB init failed", "error", { moduleName: MODULE_NAME, error: e?.message });
  }

  const apiOpts       = { model, language, isDiarize: true, apiKey, url, prompt: "", Fetch, FormData, Blob };

  const withSamples = speakers.filter(s => s.sampleAudioPath);
  log(`[diarize-debug] speakers total=${speakers.length} withSamples=${withSamples.length} names=[${withSamples.map(s => s.name).join(",")}]`, "info", { moduleName: MODULE_NAME, channelId });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdiar-"));
  let preamble = null;
  try {
    if (speakers.length > 0) preamble = await buildSamplePreamble(speakers, tmpDir);
  } catch (e) {
    log(`[diarize-debug] buildSamplePreamble failed: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    preamble = null;
  }
  log(`[diarize-debug] preamble=${!!preamble} durationS=${preamble?.preambleDurationS ?? "n/a"} speakerIds=[${(preamble?.orderedSpeakerIds||[]).join(",")}]`, "info", { moduleName: MODULE_NAME });

  let sessionId = null;
  try {
    if (pool && channelId) {
      sessionId = await createSession(pool, channelId);
      wo.voiceDiarizeSessionId = sessionId;
      log("Session created", "info", { moduleName: MODULE_NAME, sessionId, channelId });
    } else {
      log("Session skipped", "warn", { moduleName: MODULE_NAME, hasPool: !!pool, channelId });
    }
  } catch (e) {
    log("Session creation failed", "error", { moduleName: MODULE_NAME, error: e?.message });
  }

  const chunkDir  = path.join(tmpDir, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });
  const rawChunks  = await splitAudioIntoChunks(filePath, chunkDir, diarizeChunkS, 0, false, false, bitrate);
  const audioParts = rawChunks.map((c, i) => ({ file: c.file, index: i }));

  const parts = [];
  let storedChunkCount = 0;

  for (const { file, index } of audioParts) {
    const chunkNum = index + 1;
    let transcribeFile = file;
    let didConcat      = false;

    if (preamble) {
      const concatOut = path.join(tmpDir, `concat_${index}.wav`);
      try {
        await concatPreambleWithAudio(preamble, file, concatOut);
        transcribeFile = concatOut;
        didConcat      = true;
      } catch { transcribeFile = file; }
    }

    const data     = await transcribeOneRaw(transcribeFile, apiOpts);
    const segments = Array.isArray(data?.segments) ? data.segments.filter(s => s.speaker) : [];
    log(`[diarize-debug] segments=${segments.length} first3=${JSON.stringify(segments.slice(0,3).map(s=>({sp:s.speaker,t0:s.start,t1:s.end,tx:(s.text||"").slice(0,30)})))}`, "info", { moduleName: MODULE_NAME });

    let chunkTranscript    = "";
    let mapping            = {};
    let nameMap            = {};
    let cleanSegsToPersist = segments;

    if (preamble && segments.length > 0) {
      const resolved     = resolveSpeakerMapping(segments, preamble.preambleDurationS, preamble.orderedSpeakerIds, speakers);
      mapping            = resolved.mapping;
      cleanSegsToPersist = resolved.cleanSegments;
      log(`[diarize-debug] resolved: preambleSegs=${segments.filter(s=>(s.start??0)<preamble.preambleDurationS).length} cleanSegs=${resolved.cleanSegments.length} mapping=${JSON.stringify(mapping)} textMatched=${JSON.stringify(resolved.textMatchedMap || {})} zeroOffsetFallback=${resolved.zeroOffsetFallback === true}`, "info", { moduleName: MODULE_NAME });
      for (const [label, spId] of Object.entries(mapping)) {
        const sp = speakers.find(s => s.id === spId);
        nameMap[label] = sp ? sp.name : `Chunk${chunkNum}Speaker${label}`;
      }
      chunkTranscript = resolved.cleanSegments
        .map(s => {
          const name = nameMap[s.speaker] ?? `Chunk${chunkNum}Speaker${s.speaker}`;
          const text = (s.text || "").trim();
          return text ? `${name}: ${text}` : "";
        })
        .filter(Boolean).join("\n");
      if (!chunkTranscript.trim()) {
        log("Preamble diarization produced no clean segments, retrying chunk without preamble", "warn", {
          moduleName: MODULE_NAME,
          chunkNum,
          model,
          fallbackModel: fallbackModel || model
        });
        const fallbackData = await transcribeOneRaw(file, {
          model: fallbackModel || model,
          language,
          isDiarize: false,
          apiKey,
          url,
          Fetch,
          FormData,
          Blob
        });
        chunkTranscript = String(fallbackData?.text || "").trim();
        mapping = {};
        nameMap = {};
        cleanSegsToPersist = [];
      }
    } else if (segments.length > 0) {
      const seenRaw = [];
      chunkTranscript = segments
        .map(s => {
          const lbl  = `Chunk${chunkNum}Speaker${s.speaker}`;
          if (!seenRaw.includes(s.speaker)) { seenRaw.push(s.speaker); mapping[s.speaker] = null; }
          const text = (s.text || "").trim();
          return text ? `${lbl}: ${text}` : "";
        })
        .filter(Boolean).join("\n");
    } else {
      chunkTranscript = (data?.text || "").trim();
    }

    if (chunkTranscript) parts.push(chunkTranscript);

    if (pool && sessionId) {
      try {
        const chunkId    = await createChunk(pool, { sessionId, chunkIndex: index, transcript: chunkTranscript });
        storedChunkCount++;
        const seenLabels = new Set();
        for (const seg of cleanSegsToPersist) {
          const chunkLabel = nameMap[seg.speaker] ?? `Chunk${chunkNum}Speaker${seg.speaker}`;
          if (!seenLabels.has(chunkLabel)) {
            seenLabels.add(chunkLabel);
            const speakerId = mapping[seg.speaker] ?? null;
            await upsertChunkSpeaker(pool, { chunkId, chunkLabel, speakerId });
          }
        }
      } catch (e) {
        log("Chunk persistence failed", "error", {
          moduleName: MODULE_NAME,
          sessionId,
          chunkNum,
          error: e?.message || String(e)
        });
      }
    }

    if (didConcat) { try { await fs.promises.unlink(transcribeFile); } catch {} }
  }

  if (pool && sessionId && !storedChunkCount && parts.length) {
    try {
      await createChunk(pool, { sessionId, chunkIndex: 0, transcript: parts.join("\n\n") });
      storedChunkCount = 1;
      log("Stored fallback review chunk", "warn", {
        moduleName: MODULE_NAME,
        sessionId,
        chars: parts.join("\n\n").length
      });
    } catch (e) {
      log("Fallback review chunk persistence failed", "error", {
        moduleName: MODULE_NAME,
        sessionId,
        error: e?.message || String(e)
      });
    }
  }

  wo.voiceDiarizeStoredChunks = storedChunkCount;

  try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
  return parts.join("\n\n");
}


export default async function getCoreVoiceTranscribe(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo.transcribeAudio !== true) return coreData;

  const audioFile = typeof wo.audioFile === "string" ? wo.audioFile.trim() : "";
  if (!audioFile) {
    log("wo.transcribeAudio is true but wo.audioFile is missing", "warn", { moduleName: MODULE_NAME });
    wo.transcribeSkipped = "no_audio_file";
    wo.jump = true;
    return coreData;
  }

  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const SNR_DB_MIN    = Number.isFinite(wo.snrDbThreshold)     ? +wo.snrDbThreshold     : Number.isFinite(cfg.snrDbThreshold)    ? +cfg.snrDbThreshold    : 3.5;
  const MIN_VOICED_MS = Number.isFinite(wo.minVoicedMs)        ? +wo.minVoicedMs        : Number.isFinite(cfg.minVoicedMs)       ? +cfg.minVoicedMs       : 2000;
  const KEEP_WAV      = typeof wo.keepWav === "boolean"         ? wo.keepWav             : Boolean(cfg.keepWav);
  const API_KEY        = await getSecret(wo, (cfg.transcribeApiKey || wo.transcribeApiKey || "").trim());
  const STANDARD_MODEL = (cfg.transcribeModel || wo.transcribeModel || "gpt-4o-mini-transcribe").trim();
  const DIARIZE_MODEL  = (cfg.transcribeModelDiarize || "gpt-4o-transcribe-diarize").trim();
  const MODEL         = wo.transcribeOnly ? DIARIZE_MODEL : STANDARD_MODEL;
  const LANGUAGE      = (wo.transcribeLanguage || cfg.transcribeLanguage || "auto").trim();
  const ENDPOINT      = (wo.transcribeEndpoint || cfg.transcribeEndpoint || "").trim();
  const CHUNK_S           = Number.isFinite(wo.transcribeChunkS)   ? +wo.transcribeChunkS   : Number.isFinite(cfg.chunkDurationS)        ? +cfg.chunkDurationS        : DEFAULT_CHUNK_S;
  const OVERLAP_S         = Number.isFinite(wo.transcribeOverlapS) ? +wo.transcribeOverlapS : Number.isFinite(cfg.overlapDurationS)      ? +cfg.overlapDurationS      : DEFAULT_OVERLAP_S;
  const DIARIZE_CHUNK_MB  = Number.isFinite(wo.diarizeChunkMB)     ? +wo.diarizeChunkMB     : Number.isFinite(cfg.diarizeChunkMB)         ? +cfg.diarizeChunkMB         : DEFAULT_DIARIZE_CHUNK_MB;
  const OPUS_BITRATE_KBPS = Number.isFinite(wo.opusBitrateKbps)    ? +wo.opusBitrateKbps    : Number.isFinite(cfg.opusBitrateKbps)        ? +cfg.opusBitrateKbps        : DEFAULT_OPUS_BITRATE_KBPS;

  wo.voiceTranscribed = false;
  wo.transcribeError = "";

  const isDiarize = String(MODEL).toLowerCase().includes("diarize");

  log("transcribe path", "info", { moduleName: MODULE_NAME, model: MODEL, isDiarize, transcribeOnly: !!wo.transcribeOnly, hasApiKey: !!API_KEY });

  try {
    if (wo.audioStats) {
      const { snrDb = 0, usefulMs = 0 } = wo.audioStats;
      if (usefulMs < MIN_VOICED_MS) {
        log(`Skipping: usefulMs ${usefulMs} < ${MIN_VOICED_MS}`, "debug", { moduleName: MODULE_NAME });
        wo.transcribeSkipped = "insufficient_voiced_ms";
        wo.jump = true;
        return coreData;
      }
      if (snrDb < SNR_DB_MIN) {
        log(`Skipping: snrDb ${snrDb.toFixed(1)} < ${SNR_DB_MIN}`, "debug", { moduleName: MODULE_NAME });
        wo.transcribeSkipped = "low_snr";
        wo.jump = true;
        return coreData;
      }
    }

    if (!API_KEY) {
      log("no_api_key — stopping", "warn", { moduleName: MODULE_NAME });
      wo.transcribeSkipped = "no_api_key";
      wo.jump = true;
      return coreData;
    }

    let text = "";

    if (transcribeWithWhisper) {
      text = await transcribeWithWhisper(audioFile, MODEL, LANGUAGE, API_KEY);
    } else if (isDiarize && wo.transcribeOnly) {
      try {
        text = await getDiarizeWithSamples(audioFile, {
          model: MODEL, fallbackModel: STANDARD_MODEL, language: LANGUAGE, apiKey: API_KEY,
          endpoint: ENDPOINT, diarizeChunkMB: DIARIZE_CHUNK_MB, opusBitrateKbps: OPUS_BITRATE_KBPS, wo
        });
      } catch (e) {
        wo.transcribeError = e?.message || String(e);
        log("Diarize transcription failed, retrying standard transcription", "warn", {
          moduleName: MODULE_NAME,
          model: MODEL,
          fallbackModel: STANDARD_MODEL,
          error: wo.transcribeError
        });
        text = await getTranscribeAudio(audioFile, {
          model:            STANDARD_MODEL,
          language:         LANGUAGE,
          apiKey:           API_KEY,
          endpoint:         ENDPOINT,
          chunkDurationS:   CHUNK_S,
          overlapDurationS: OVERLAP_S
        });
      }
    } else {
      text = await getTranscribeAudio(audioFile, {
        model:            MODEL,
        language:         LANGUAGE,
        apiKey:           API_KEY,
        endpoint:         ENDPOINT,
        chunkDurationS:   CHUNK_S,
        overlapDurationS: OVERLAP_S
      });
    }

    const cleaned = String(text || "").trim();
    if (!cleaned) {
      wo.transcribeSkipped = "empty_result";
      wo.jump = true;
      return coreData;
    }

    wo.payload          = cleaned;
    wo.voiceTranscribed = true;

  } catch (e) {
    log("Transcription error", "error", { moduleName: MODULE_NAME, error: e?.message });
    wo.transcribeError = e?.message || String(e);
    wo.transcribeSkipped = wo.transcribeSkipped || "error";
    wo.jump = true;
  } finally {
    if (!KEEP_WAV) {
      if (wo._audioCaptureDir) {
        try { await fs.promises.rm(wo._audioCaptureDir, { recursive: true, force: true }); } catch {}
      } else if (audioFile) {
        try { await fs.promises.unlink(audioFile); } catch {}
      }
    }
  }

  if (wo.jump && !wo.jumpReason) wo.jumpReason = wo.transcribeSkipped || "transcribe_error";

  return coreData;
}
