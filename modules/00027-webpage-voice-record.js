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
/* Config (config["webpage-voice-record"]):                                              */
/*   recordModel                  — transcription model (default: gpt-4o-transcribe) */
/*   diarize                      — run speaker-attribution pass (default: true)  */
/*   clearContextChannels            — array of channel IDs for which the context */
/*                                    DB is purged (non-frozen rows only) before  */
/*                                    storing the transcript. Default: []         */
/*   allowedRoles                 — role whitelist (empty = open)                */
/*   port                         — HTTP port (default 3119)                     */
/**********************************************************************************/

import fs   from "node:fs";
import os   from "node:os";
import path from "node:path";
import { FormData, File, fetch } from "undici";
import ffmpegImport from "fluent-ffmpeg";
import { getPrefixedLogger }  from "../core/logging.js";
import { getIsAllowedRoles }  from "../shared/webpage/utils.js";
import { setContext, setPurgeContext } from "../core/context.js";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME  = "webpage-voice-record";
const DEFAULT_PORT = 3119;
const ROUTE_RECORD = "/voice/record";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");



async function sendJson(wo, status, data) {
  const res = wo?.http?.res;
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
  const apiKey   = await getSecret(wo, cfg.whisperApiKey || wo.whisperApiKey || wo.apiKey || "");
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

  const segText = segments.map((s, i) =>
    `[${i + 1}] (${(s.start || 0).toFixed(1)}s–${(s.end || 0).toFixed(1)}s) ${(s.text || "").trim()}`
  ).join("\n");

  const apiBase = String(cfg.apiUrl || wo.apiBaseUrl || "http://localhost:3400").replace(/\/+$/, "");
  const channelId = String(cfg.diarizationChannelId || "").trim();
  const apiSecretKey = String(cfg.apiSecret || wo.apiSecret || "").trim();
  const apiSecret = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const defaultDiarizationPrompt =
    "You receive numbered transcript segments. Assign each segment to a speaker " +
    "(Speaker 1, Speaker 2, etc.) based on context and turn-taking patterns. " +
    "Return only the formatted transcript with one line per segment in the format " +
    "'Speaker X: <text>'.";
  const promptPrefix = (typeof cfg.diarizationSystemPrompt === "string" && cfg.diarizationSystemPrompt.trim())
    ? cfg.diarizationSystemPrompt.trim()
    : defaultDiarizationPrompt;

  if (!channelId) return transcript.text || "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers.Authorization = `Bearer ${apiSecret}`;

  try {
    const response = await fetch(`${apiBase}/api`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        channelID: channelId,
        payload: `${promptPrefix}\n\nTranscript segments:\n${segText}`,
        doNotWriteToContext: true
      })
    });
    const data = await response.json().catch(() => ({}));
    const result = String(data?.response || "").trim();
    if (!response.ok || !data?.ok || !result) return transcript.text || "";
    return result;
  } catch {
    return transcript.text || "";
  }
}


export default async function getWebpageVoiceRecord(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg    = coreData?.config?.[MODULE_NAME] || {};
  const port   = Number(cfg.port ?? DEFAULT_PORT);
  const method = (wo.http?.method || "").toUpperCase();
  const url    = wo.http?.url || "";

  if (Number(wo.http?.port) !== port) return coreData;
  if (method !== "POST" || !url.startsWith(ROUTE_RECORD)) return coreData;

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  if (!getIsAllowedRoles(wo, allowedRoles)) {
    await sendJson(wo, 403, { error: "forbidden" });
    wo.stop = true; wo.stopReason = "forbidden";
    return coreData;
  }

  const qIdx      = url.indexOf("?");
  const params    = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
  const channelId = (params.get("channelId") || "").trim();
  if (!channelId) {
    await sendJson(wo, 400, { error: "missing_channel_id" });
    wo.stop = true; wo.stopReason = "missing_channel_id";
    return coreData;
  }

  const rawBody = wo.http?.rawBodyBytes;
  if (!rawBody?.length) {
    await sendJson(wo, 400, { error: "empty_body" });
    wo.stop = true; wo.stopReason = "empty_body";
    return coreData;
  }

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

    log("Transcribing meeting recording", "info", { moduleName: MODULE_NAME, channelId, bytes: rawBody.length });
    const transcript = await getTranscript(audioFile, cfg, wo);

    const diarize = cfg.diarize !== false;
    let finalText = transcript.text || "";
    let speakers  = 1;
    if (diarize && Array.isArray(transcript.segments) && transcript.segments.length > 1) {
      finalText = await getDiarizedText(transcript, cfg, wo);
      const matches = new Set((finalText.match(/Speaker \d+:/g) || []));
      speakers = matches.size || 1;
    }

    const words = (finalText.match(/\S+/g) || []).length;

    const prevChannelId = wo.channelID;
    wo.channelID = channelId;

    if (Array.isArray(cfg.clearContextChannels) && cfg.clearContextChannels.includes(channelId)) {
      await setPurgeContext(wo);
      log("Context purged before transcription storage", "info", { moduleName: MODULE_NAME, channelId });
    }

    const ts = new Date().toISOString();
    await setContext(wo, {
      role:    "user",
      text:    `[Meeting transcript — ${ts}]\n\n${finalText}`,
      content: `[Meeting transcript — ${ts}]\n\n${finalText}`,
      userId:  String(wo.userId || ""),
      source:  "voice-transcription"
    });

    wo.channelID = prevChannelId;

    log("Meeting transcript stored", "info", { moduleName: MODULE_NAME, channelId, words, speakers });
    await sendJson(wo, 200, { ok: true, words, speakers, text: finalText.slice(0, 500) });

  } catch (e) {
    log("Meeting recording error", "error", { moduleName: MODULE_NAME, error: e?.message });
    await sendJson(wo, 500, { error: "transcription_failed", detail: String(e?.message || e).slice(0, 200) });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    wo.stop = true; wo.stopReason = "voice_record_handled";
  }

  return coreData;
}
