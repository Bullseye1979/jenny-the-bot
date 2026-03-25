/************************************************************************************
/* filename: 00033-webpage-voice-transcribe-gate.js                                *
/* Version 1.0                                                                     *
/* Purpose: When wo.transcribeOnly is true (set by 00028 from ?transcribeOnly=1), *
/*          stops the pipeline after transcription so AI and TTS never run.       *
/*          09320 detects wo.transcribeOnly and returns only the transcript.       *
/*                                                                                 *
/* MUST run after 00030-core-voice-transcribe (needs wo.payload).                 *
/* Flow: webpage                                                                   *
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-voice-transcribe-gate";


function getSafeHeaderValue(str) {
  return String(str || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}


export default async function getWebpageVoiceTranscribeGate(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!wo.isWebpageVoice || !wo.transcribeOnly) return coreData;

  const res = wo?.http?.res;

  if (res && !res.headersSent) {
    if (wo.payload) {
      res.writeHead(200, {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",
        "X-Transcript":  getSafeHeaderValue(wo.payload)
      });
      res.end(JSON.stringify({ transcript: wo.payload }));
    } else {
      const reason = wo.transcribeSkipped || "no_transcript";
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: reason }));
    }
  }

  wo.stop       = true;
  wo.stopReason = "transcribe_only";
  log("transcribeOnly — response sent, stopping pipeline", "info", {
    moduleName: MODULE_NAME, payload: (wo.payload || "").slice(0, 80)
  });

  return coreData;
}
