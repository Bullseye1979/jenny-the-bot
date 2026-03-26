/************************************************************************************
/* filename: 09320-webpage-voice-output.js                                               *
/* Version 1.0                                                                     *
/* Purpose: Sends the TTS audio response back to the browser as an HTTP response.  *
/*          Runs at the end of the webpage-voice pipeline regardless of wo.stop    *
/*          so the browser always receives a well-formed response (audio or error).*
/*                                                                                 *
/* Gate:    wo.isWebpageVoice === true                                             *
/*                                                                                 *
/* Success: HTTP 200  Content-Type: audio/mpeg                                    *
/*          Header X-Transcript: <transcribed text>                               *
/*          Header X-Response:   <AI response text>                               *
/*          Body: concatenated MP3 buffers from wo.ttsSegments                    *
/*                                                                                 *
/* Error:   HTTP 4xx/5xx  Content-Type: application/json                          *
/*          Body: { "error": "<reason>" }                                          *
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-voice-output";


function getSafeHeaderValue(str) {
  return String(str || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}


export default async function getWebpageVoiceOutput(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!wo.isWebpageVoice) return coreData;

  const res = wo?.http?.res;
  if (!res || res.headersSent) return coreData;

  if (wo.transcribeOnly && wo.payload) {
    log("transcribeOnly — returning transcript only", "info", {
      moduleName: MODULE_NAME, transcript: (wo.payload || "").slice(0, 80)
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Transcript":  getSafeHeaderValue(wo.payload)
    });
    res.end(JSON.stringify({ transcript: wo.payload }));
    return coreData;
  }

  const hasSegments = Array.isArray(wo.ttsSegments) && wo.ttsSegments.some(s => s?.buffer?.length);

  if (!hasSegments) {
    const reason = wo.transcribeSkipped || wo.ttsSkipped || (wo.stop ? "pipeline_stopped" : "no_audio");
    log("No TTS segments → sending error response", "info", { moduleName: MODULE_NAME, reason });
    const errHeaders = { "Content-Type": "application/json" };
    if (wo.payload) errHeaders["X-Transcript"] = getSafeHeaderValue(wo.payload);
    res.writeHead(400, errHeaders);
    res.end(JSON.stringify({ error: reason }));
    return coreData;
  }

  const buffers  = wo.ttsSegments.map(s => s.buffer).filter(Boolean);
  const combined = Buffer.concat(buffers);

  const headers = {
    "Content-Type":   "audio/mpeg",
    "Content-Length": String(combined.length),
    "Cache-Control":  "no-store"
  };

  if (wo.payload)   headers["X-Transcript"] = getSafeHeaderValue(wo.payload);
  if (wo.response)  headers["X-Response"]   = getSafeHeaderValue(wo.response);

  res.writeHead(200, headers);
  res.end(combined);

  log("Audio response sent", "info", {
    moduleName: MODULE_NAME,
    bytes:    combined.length,
    segments: buffers.length,
    transcript: (wo.payload  || "").slice(0, 80),
    response:   (wo.response || "").slice(0, 80)
  });

  return coreData;
}
