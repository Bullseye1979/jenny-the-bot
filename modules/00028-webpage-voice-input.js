























import fs   from "node:fs";
import os   from "node:os";
import path from "node:path";
import ffmpegImport from "fluent-ffmpeg";
import { getPrefixedLogger } from "../core/logging.js";
import { getIsAllowedRoles } from "../shared/webpage/utils.js";

const MODULE_NAME  = "webpage-voice-input";
const DEFAULT_PORT = 3119;
const ROUTE_AUDIO  = "/voice/audio";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");


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



async function sendError(wo, status, errorCode) {
  const res = wo?.http?.res;
  if (!res || res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: errorCode }));
}


export default async function getWebpageVoiceInput(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg    = coreData?.config?.[MODULE_NAME] || {};
  const port   = Number(cfg.port ?? DEFAULT_PORT);
  const method = (wo.http?.method || "").toUpperCase();
  const url    = wo.http?.url || "";

  if (Number(wo.http?.port) !== port) return coreData;
  if (method !== "POST" || !url.startsWith(ROUTE_AUDIO)) return coreData;

  const rawBody = wo.http?.rawBodyBytes;
  if (!rawBody?.length) {
    await sendError(wo, 400, "empty_body");
    wo.stop = true; wo.stopReason = "empty_body";
    return coreData;
  }

  const qIdx      = url.indexOf("?");
  const params    = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
  const channelId      = (params.get("channelId") || "").trim();
  const isAlwaysOn     = params.get("alwaysOn")      === "1";
  const transcribeOnly = params.get("transcribeOnly") === "1";

  if (!channelId) {
    await sendError(wo, 400, "missing_channel_id");
    wo.stop = true; wo.stopReason = "missing_channel_id";
    return coreData;
  }

  const contentType = (wo.http?.headers?.["content-type"] || "audio/webm").split(";")[0].trim();
  const extMap      = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav",
                        "audio/mpeg": ".mp3",  "audio/mp4": ".mp4", "audio/x-m4a": ".m4a" };
  const ext         = extMap[contentType] || ".webm";

  const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), "wvox-"));
  const inputFile = path.join(tmpDir, `input${ext}`);
  const wavFile   = path.join(tmpDir, "audio.wav");

  try {
    await fs.promises.writeFile(inputFile, rawBody);

    if (ext === ".wav") {
      wo.audioFile = inputFile;
    } else {
      await getConvertToWav(inputFile, wavFile);
      wo.audioFile = wavFile;
    }

    wo._audioCaptureDir = tmpDir;
    wo.audioMimeType    = contentType;
    wo.transcribeAudio  = true;
    wo.synthesizeSpeech = true;
    wo.ttsFormat        = "mp3";
    wo.channelID        = channelId;
    wo.isWebpageVoice   = true;
    wo.isAlwaysOn       = isAlwaysOn;
    wo.transcribeOnly   = transcribeOnly;

    log("Audio received and queued for transcription", "info", {
      moduleName: MODULE_NAME, channelId, ext, bytes: rawBody.length, alwaysOn: isAlwaysOn
    });
  } catch (e) {
    log("Audio conversion failed", "error", { moduleName: MODULE_NAME, error: e?.message });
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    await sendError(wo, 500, "audio_conversion_failed");
    wo.stop = true; wo.stopReason = "audio_conversion_failed";
  }

  return coreData;
}
