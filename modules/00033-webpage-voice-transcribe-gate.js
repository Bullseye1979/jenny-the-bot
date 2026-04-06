










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
      const headers = {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",
        "X-Transcript":  getSafeHeaderValue(wo.payload)
      };
      if (wo.voiceDiarizeSessionId) headers["X-Diarize-Session"] = String(wo.voiceDiarizeSessionId);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ transcript: wo.payload, sessionId: wo.voiceDiarizeSessionId || null }));
    } else {
      const reason = wo.transcribeSkipped || "no_transcript";
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: reason }));
    }
  }

  wo.jump       = true;
  wo.jumpReason = "transcribe_only";
  log("transcribeOnly — response sent, stopping pipeline", "info", {
    moduleName: MODULE_NAME, payload: (wo.payload || "").slice(0, 80)
  });

  return coreData;
}
