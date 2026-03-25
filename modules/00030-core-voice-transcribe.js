/************************************************************************************
/* filename: 00030-core-voice-transcribe.js                                        *
/* Version 1.0                                                                     *
/* Purpose: Source-agnostic audio transcription module.                            *
/*          Reads a WAV file from wo.audioFile, applies quality gates (SNR,        *
/*          voiced duration), calls the OpenAI audio transcriptions API, and       *
/*          stores the result in wo.payload.                                        *
/*                                                                                 *
/*          Large files (> MAX_FILE_BYTES) are split into overlapping chunks       *
/*          and transcribed sequentially. For diarized models, speaker labels      *
/*          are stitched across chunk boundaries using an overlap-based heuristic: *
/*          speakers identified in the overlap region are mapped to the global     *
/*          label from the previous chunk by order of first appearance; unmatched  *
/*          speakers receive an offset label (e.g. "C_2") to signal uncertain      *
/*          identity. The overlap region is excluded from the final output so that  *
/*          no text appears twice in wo.payload.                                   *
/*                                                                                 *
/* Trigger: wo.transcribeAudio === true                                             *
/*                                                                                 *
/* Input:   wo.audioFile   — absolute path to WAV file                             *
/*          wo.audioStats  — { snrDb, usefulMs } (optional; quality gate)          *
/*                                                                                 *
/* Output:  wo.payload          — transcribed text                                 *
/*          wo.voiceTranscribed — true on success                                  *
/*                                                                                 *
/* Config (config["core-voice-transcribe"]):                                       *
/*   transcribeModel        — model for always-on / discord-voice turns            *
/*   transcribeModelDiarize — model for meeting recorder (wo.transcribeOnly=true)  *
/*   chunkDurationS         — seconds per chunk for large files (default 300)      *
/*   overlapDurationS       — overlap seconds between chunks for stitching (def 60)*
/*   transcribeLanguage     — force language (ISO 639-1); empty = auto-detect      *
/*   transcribeEndpoint     — OpenAI-compatible API base URL                       *
/*   transcribeApiKey       — API key (falls back to wo fields / env var)          *
/*   keepWav                — retain temp WAV files after transcription            *
/*   minVoicedMs            — quality gate: minimum voiced ms (default 2000)       *
/*   snrDbThreshold         — quality gate: minimum SNR in dB (default 3.5)        *
/************************************************************************************/

import fs           from "node:fs";
import os           from "node:os";
import path         from "node:path";
import ffmpegImport from "fluent-ffmpeg";
import { getPrefixedLogger } from "../core/logging.js";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath (process.env.FFMPEG_PATH  || "/usr/bin/ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "/usr/bin/ffprobe");

const MAX_FILE_BYTES    = 20 * 1024 * 1024;
const DEFAULT_CHUNK_S   = 300;
const DEFAULT_OVERLAP_S = 60;
const SPEAKER_LABELS    = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MODULE_NAME       = "core-voice-transcribe";

// Optional local whisper fallback (core/whisper.js may not exist in all deployments).
let transcribeWithWhisper = null;
try {
  const mod = await import("../core/whisper.js").catch(() => null);
  if (mod?.transcribeWithWhisper) transcribeWithWhisper = mod.transcribeWithWhisper;
} catch {}


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


async function splitAudioIntoChunks(filePath, chunkDir, chunkDurationS, overlapS, isDiarize) {
  const duration = await getAudioDurationS(filePath);
  const chunks   = [];
  let   logStart = 0;
  let   idx      = 0;

  while (logStart < duration) {
    const audioStart = (isDiarize && idx > 0) ? Math.max(0, logStart - overlapS) : logStart;
    const overlapDur = logStart - audioStart;
    const segDur     = Math.min(chunkDurationS + overlapDur, duration - audioStart);
    const out        = path.join(chunkDir, `chunk_${String(idx).padStart(4, "0")}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(filePath)
        .setStartTime(audioStart)
        .setDuration(segDur)
        .audioCodec("pcm_s16le")
        .audioFrequency(16000)
        .audioChannels(1)
        .format("wav")
        .save(out)
        .on("end",   resolve)
        .on("error", reject);
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

  // Speakers appearing in current chunk's overlap region (start < overlapDur)
  const overlapCurrent = segments.filter(s => (s.start ?? 0) < overlapDur);
  const currentOrder   = getFirstAppearanceOrder(overlapCurrent, "speaker");

  // Speakers appearing in previous chunk's tail (end > prevEnd - overlapDur)
  const prevEnd     = prevGlobalSegments.reduce((m, s) => Math.max(m, s.end ?? 0), 0);
  const overlapPrev = prevGlobalSegments.filter(s => (s.end ?? 0) > prevEnd - overlapDur);
  const prevOrder   = getFirstAppearanceOrder(overlapPrev, "globalLabel");

  // Map by position in appearance order within the overlap
  for (let i = 0; i < Math.min(currentOrder.length, prevOrder.length); i++) {
    localMap[currentOrder[i]] = prevOrder[i];
  }

  // Unmatched speakers: assign offset label (e.g. "C_2")
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
  const base = (process.env.OPENAI_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/v1/audio/transcriptions` : "https://api.openai.com/v1/audio/transcriptions";
}


async function transcribeOneRaw(fp, { model, language, isDiarize, apiKey, url, Fetch, FormData, Blob }) {
  const fd = new FormData();
  fd.set("model", model);
  if (language && language !== "auto") fd.set("language", language);
  if (isDiarize) {
    fd.set("response_format",   "diarized_json");
    fd.set("chunking_strategy", "auto");
  }
  const buf = await fs.promises.readFile(fp);
  fd.set("file", new Blob([buf], { type: "audio/wav" }), path.basename(fp));
  const res = await Fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    fd
  });
  if (!res.ok) throw new Error(`Transcribe API HTTP ${res.status}`);
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

  // ── Single file ────────────────────────────────────────────────────────────────
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

  // ── Large file: overlapping chunks + speaker stitching ────────────────────────
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
        // Overlap region is excluded by formatDiarizedSegments (start < overlapDur filtered out)
        const text     = formatDiarizedSegments(data.segments, localMap, overlapDur);
        if (text.trim()) parts.push(text.trim());
        // Carry segments with resolved global labels forward for next chunk's stitching
        prevGlobalSegs = data.segments.map(seg => ({
          ...seg,
          globalLabel: localMap[seg.speaker] ?? seg.speaker
        }));
      } else {
        // Non-diarize: no overlap handling needed — plain text concatenation
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


export default async function getCoreVoiceTranscribe(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo.transcribeAudio !== true) return coreData;

  const audioFile = typeof wo.audioFile === "string" ? wo.audioFile.trim() : "";
  if (!audioFile) {
    log("wo.transcribeAudio is true but wo.audioFile is missing", "warn", { moduleName: MODULE_NAME });
    wo.transcribeSkipped = "no_audio_file";
    wo.stop = true;
    return coreData;
  }

  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const SNR_DB_MIN    = Number.isFinite(wo.snrDbThreshold)     ? +wo.snrDbThreshold     : Number.isFinite(cfg.snrDbThreshold)    ? +cfg.snrDbThreshold    : 3.5;
  const MIN_VOICED_MS = Number.isFinite(wo.minVoicedMs)        ? +wo.minVoicedMs        : Number.isFinite(cfg.minVoicedMs)       ? +cfg.minVoicedMs       : 2000;
  const KEEP_WAV      = typeof wo.keepWav === "boolean"         ? wo.keepWav             : Boolean(cfg.keepWav);
  const API_KEY       = (wo.transcribeApiKey || cfg.transcribeApiKey || process.env.OPENAI_API_KEY || "").trim();
  const MODEL         = wo.transcribeOnly
    ? (wo.transcribeModel || cfg.transcribeModelDiarize || "gpt-4o-transcribe-diarize").trim()
    : (wo.transcribeModel || cfg.transcribeModel || "gpt-4o-mini-transcribe").trim();
  const LANGUAGE      = (wo.transcribeLanguage || cfg.transcribeLanguage || "auto").trim();
  const ENDPOINT      = (wo.transcribeEndpoint || cfg.transcribeEndpoint || "").trim();
  const CHUNK_S       = Number.isFinite(wo.transcribeChunkS)   ? +wo.transcribeChunkS   : Number.isFinite(cfg.chunkDurationS)    ? +cfg.chunkDurationS    : DEFAULT_CHUNK_S;
  const OVERLAP_S     = Number.isFinite(wo.transcribeOverlapS) ? +wo.transcribeOverlapS : Number.isFinite(cfg.overlapDurationS)  ? +cfg.overlapDurationS  : DEFAULT_OVERLAP_S;

  wo.voiceTranscribed = false;

  try {
    // ── Quality gate (only when stats are available from capture module) ─────────
    if (wo.audioStats) {
      const { snrDb = 0, usefulMs = 0 } = wo.audioStats;
      if (usefulMs < MIN_VOICED_MS) {
        log(`Skipping: usefulMs ${usefulMs} < ${MIN_VOICED_MS}`, "debug", { moduleName: MODULE_NAME });
        wo.transcribeSkipped = "insufficient_voiced_ms";
        wo.stop = true;
        return coreData;
      }
      if (snrDb < SNR_DB_MIN) {
        log(`Skipping: snrDb ${snrDb.toFixed(1)} < ${SNR_DB_MIN}`, "debug", { moduleName: MODULE_NAME });
        wo.transcribeSkipped = "low_snr";
        wo.stop = true;
        return coreData;
      }
    }

    // ── API key check ────────────────────────────────────────────────────────────
    if (!API_KEY) {
      wo.transcribeSkipped = "no_api_key";
      wo.stop = true;
      return coreData;
    }

    // ── Transcription ────────────────────────────────────────────────────────────
    const text = transcribeWithWhisper
      ? await transcribeWithWhisper(audioFile, MODEL, LANGUAGE, API_KEY)
      : await getTranscribeAudio(audioFile, {
          model:            MODEL,
          language:         LANGUAGE,
          apiKey:           API_KEY,
          endpoint:         ENDPOINT,
          chunkDurationS:   CHUNK_S,
          overlapDurationS: OVERLAP_S
        });

    const cleaned = String(text || "").trim();
    if (!cleaned) {
      wo.transcribeSkipped = "empty_result";
      wo.stop = true;
      return coreData;
    }

    wo.payload          = cleaned;
    wo.voiceTranscribed = true;

  } catch (e) {
    log("Transcription error", "error", { moduleName: MODULE_NAME, error: e?.message });
    wo.transcribeSkipped = wo.transcribeSkipped || "error";
    wo.stop = true;
  } finally {
    // ── Cleanup temp files ───────────────────────────────────────────────────────
    if (!KEEP_WAV) {
      if (wo._audioCaptureDir) {
        try { await fs.promises.rm(wo._audioCaptureDir, { recursive: true, force: true }); } catch {}
      } else if (audioFile) {
        try { await fs.promises.unlink(audioFile); } catch {}
      }
    }
  }

  if (wo.stop && !wo.stopReason) wo.stopReason = wo.transcribeSkipped || "transcribe_error";

  return coreData;
}
