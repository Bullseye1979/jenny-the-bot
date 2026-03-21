/**********************************************************************************/
/* filename: 00027-webpage-voice-record.js                                        */
/* Version 1.0                                                                    */
/* Purpose: Handles POST /voice/record — receives a full meeting recording,       */
/*          transcribes it with the configured model (default: gpt-4o-transcribe),*/
/*          optionally runs a diarization pass via GPT-4o, optionally purges the  */
/*          channel context (preserving frozen rows), and stores the formatted    */
/*          transcript in the channel context via setContext.                     */
/*                                                                                */
/* Routes (port 3119):                                                            */
/*   POST /voice/record?channelId=<id>                                            */
/*                                                                                */
/* Config (config["webpage-voice"]):                                              */
/*   recordModel                  — transcription model (default: gpt-4o-transcribe) */
/*   diarize                      — run speaker-attribution pass (default: true)  */
/*   clearContextBeforeTranscription — purge non-frozen context before storing   */
/*                                    the transcript (default: false)             */
/*   allowedRoles                 — role whitelist (empty = open)                */
/*   port                         — HTTP port (default 3119)                     */
/**********************************************************************************/

import fs   from "node:fs";
import os   from "node:os";
import path from "node:path";
import { FormData, File, fetch } from "undici";
import ffmpegImport from "fluent-ffmpeg";
import { getPrefixedLogger }  from "../core/logging.js";
import { getItem }            from "../core/registry.js";
import { setContext, setPurgeContext } from "../core/context.js";

const MODULE_NAME  = "webpage-voice-record";
const VOICE_CFG    = "webpage-voice";
const DEFAULT_PORT = 3119;
const ROUTE_RECORD = "/voice/record";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");


function getIsAllowedRoles(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set();
  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary) have.add(primary);
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) roles.forEach(r => { const v = String(r || "").trim().toLowerCase(); if (v) have.add(v); });
  return req.some(r => { const n = String(r || "").trim().toLowerCase(); return n && have.has(n); });
}


async function sendJson(wo, status, data) {
  const key   = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  const res   = entry?.res;
  if (!res || res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}


function getConvertToWav(inputFile, outputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputFile)
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .save(outputFile)
      .on("end", resolve)
      .on("error", reject);
  });
}


async function getTranscript(wavFile, cfg, wo) {
  const model    = String(cfg.recordModel || "gpt-4o-transcribe");
  const endpoint = String(wo.whisperEndpoint || "https://api.openai.com");
  const apiKey   = String(cfg.whisperApiKey || wo.whisperApiKey || wo.apiKey || "");
  const url      = endpoint.replace(/\/$/, "") + "/v1/audio/transcriptions";

  const audioBuffer = fs.readFileSync(wavFile);
  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("file", new File([audioBuffer], "audio.wav", { type: "audio/wav" }));

  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Authorization": "Bearer " + apiKey },
    body:    form
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Transcription API error ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return resp.json();
}


async function getDiarizedText(transcript, cfg, wo) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (!segments.length) return transcript.text || "";

  /* Build numbered segment list for the LLM */
  const segText = segments.map((s, i) =>
    `[${i + 1}] (${(s.start || 0).toFixed(1)}s\u2013${(s.end || 0).toFixed(1)}s) ${(s.text || "").trim()}`
  ).join("\n");

  const endpoint = String(wo.endpoint || "https://api.openai.com/v1/chat/completions");
  const apiKey   = String(cfg.apiKey   || wo.apiKey || "");
  const model    = String(cfg.model    || wo.model  || "gpt-4o-mini");

  const systemPrompt =
    "You receive numbered transcript segments. Assign each segment to a speaker " +
    "(Speaker 1, Speaker 2, etc.) based on context and turn-taking patterns. " +
    "Return ONLY the formatted transcript, one line per segment: " +
    "\"Speaker X: <text>\". No extra commentary.";

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body:    JSON.stringify({
      model,
      temperature: 0,
      max_tokens:  4000,
      messages: [
        { role: "system",  content: systemPrompt },
        { role: "user",    content: segText }
      ]
    })
  });

  if (!resp.ok) return transcript.text || "";
  const data   = await resp.json().catch(() => ({}));
  const result = data?.choices?.[0]?.message?.content || "";
  return result.trim() || transcript.text || "";
}


export default async function getWebpageVoiceRecord(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg    = coreData?.config?.[VOICE_CFG] || {};
  const port   = Number(cfg.port ?? DEFAULT_PORT);
  const method = (wo.http?.method || "").toUpperCase();
  const url    = wo.http?.url || "";

  if (Number(wo.http?.port) !== port) return coreData;
  if (method !== "POST" || !url.startsWith(ROUTE_RECORD)) return coreData;

  /* Auth gate */
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  if (!getIsAllowedRoles(wo, allowedRoles)) {
    await sendJson(wo, 403, { error: "forbidden" });
    wo.stop = true;
    return coreData;
  }

  /* Parse channelId */
  const qIdx      = url.indexOf("?");
  const params    = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
  const channelId = (params.get("channelId") || "").trim();
  if (!channelId) {
    await sendJson(wo, 400, { error: "missing_channel_id" });
    wo.stop = true;
    return coreData;
  }

  /* Validate body */
  const rawBody = wo.http?.rawBodyBytes;
  if (!rawBody?.length) {
    await sendJson(wo, 400, { error: "empty_body" });
    wo.stop = true;
    return coreData;
  }

  /* Convert audio to WAV */
  const contentType = (wo.http?.headers?.["content-type"] || "audio/webm").split(";")[0].trim();
  const extMap      = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav",
                        "audio/mpeg": ".mp3",  "audio/mp4": ".mp4", "audio/x-m4a": ".m4a" };
  const ext         = extMap[contentType] || ".webm";
  const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), "wrec-"));
  const inputFile   = path.join(tmpDir, `input${ext}`);
  const wavFile     = path.join(tmpDir, "audio.wav");

  try {
    await fs.promises.writeFile(inputFile, rawBody);
    if (ext !== ".wav") await getConvertToWav(inputFile, wavFile);
    const audioFile = ext === ".wav" ? inputFile : wavFile;

    /* Transcribe */
    log("Transcribing meeting recording", "info", { moduleName: MODULE_NAME, channelId, bytes: rawBody.length });
    const transcript = await getTranscript(audioFile, cfg, wo);

    /* Optionally diarize */
    const diarize = cfg.diarize !== false;
    let finalText = transcript.text || "";
    let speakers  = 1;
    if (diarize && Array.isArray(transcript.segments) && transcript.segments.length > 1) {
      finalText = await getDiarizedText(transcript, cfg, wo);
      /* Rough speaker count: count unique "Speaker N:" patterns */
      const matches = new Set((finalText.match(/Speaker \d+:/g) || []));
      speakers = matches.size || 1;
    }

    const words = (finalText.match(/\S+/g) || []).length;

    /* Set channelID so setContext writes to the right channel */
    const prevChannelId = wo.channelID;
    wo.channelID = channelId;

    /* Optionally purge non-frozen context before storing */
    if (cfg.clearContextBeforeTranscription) {
      await setPurgeContext(wo);
      log("Context purged before transcription storage", "info", { moduleName: MODULE_NAME, channelId });
    }

    /* Store in context */
    const ts = new Date().toISOString();
    await setContext(wo, {
      role:    "user",
      text:    `[Meeting transcript — ${ts}]\n\n${finalText}`,
      content: `[Meeting transcript — ${ts}]\n\n${finalText}`,
      userId:  String(wo.webAuth?.userId || wo.webAuth?.id || wo.userId || "")
    });

    wo.channelID = prevChannelId;

    log("Meeting transcript stored", "info", { moduleName: MODULE_NAME, channelId, words, speakers });
    await sendJson(wo, 200, { ok: true, words, speakers, text: finalText.slice(0, 500) });

  } catch (e) {
    log("Meeting recording error", "error", { moduleName: MODULE_NAME, error: e?.message });
    await sendJson(wo, 500, { error: "transcription_failed", detail: String(e?.message || e).slice(0, 200) });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    wo.stop = true;
  }

  return coreData;
}
