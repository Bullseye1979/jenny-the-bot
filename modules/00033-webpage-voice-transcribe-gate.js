/**************************************************************/
/* filename: "00033-webpage-voice-transcribe-gate.js"               */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/











import { getPrefixedLogger } from "../core/logging.js";
import { getEnsureDiarizePool, ensureDiarizeTables, createChunk } from "../shared/voice/voice-diarize.js";

const MODULE_NAME = "webpage-voice-transcribe-gate";


function getSafeHeaderValue(str) {
  return String(str || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}


export default async function getWebpageVoiceTranscribeGate(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!wo.isWebpageVoice || !wo.transcribeOnly) return coreData;

  const res = wo?.http?.res;
  let storedChunks = Number(wo.voiceDiarizeStoredChunks || 0);

  if (wo.payload && wo.voiceDiarizeSessionId && storedChunks < 1) {
    try {
      const pool = await getEnsureDiarizePool(wo);
      await ensureDiarizeTables(pool);
      await createChunk(pool, {
        sessionId: wo.voiceDiarizeSessionId,
        chunkIndex: 0,
        transcript: String(wo.payload || "").trim()
      });
      storedChunks = 1;
      wo.voiceDiarizeStoredChunks = 1;
      log("Transcribe gate stored fallback review chunk", "warn", {
        moduleName: MODULE_NAME,
        sessionId: wo.voiceDiarizeSessionId
      });
    } catch (e) {
      log("Transcribe gate fallback chunk persistence failed", "error", {
        moduleName: MODULE_NAME,
        sessionId: wo.voiceDiarizeSessionId,
        error: e?.message || String(e)
      });
    }
  }

  if (res && !res.headersSent) {
    if (wo.payload) {
      const headers = {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",
        "X-Transcript":  getSafeHeaderValue(wo.payload)
      };
      if (wo.voiceDiarizeSessionId) headers["X-Diarize-Session"] = String(wo.voiceDiarizeSessionId);
      res.writeHead(200, headers);
      res.end(JSON.stringify({
        transcript: wo.payload,
        sessionId: wo.voiceDiarizeSessionId || null,
        storedChunks
      }));
    } else {
      const reason = wo.transcribeSkipped || "no_transcript";
      const detail = String(wo.transcribeError || "").trim();
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(detail ? { error: reason, detail } : { error: reason }));
    }
  }

  wo.jump       = true;
  wo.jumpReason = "transcribe_only";
  log("transcribeOnly — response sent, stopping pipeline", "info", {
    moduleName: MODULE_NAME, payload: (wo.payload || "").slice(0, 80)
  });

  return coreData;
}
