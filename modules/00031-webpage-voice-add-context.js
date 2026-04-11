/**************************************************************/
/* filename: "00031-webpage-voice-add-context.js"                   */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


























import { setContext } from "../core/context.js";
import { getPrefixedLogger }           from "../core/logging.js";

const MODULE_NAME    = "webpage-voice-add-context";
const SPEAKER_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";


function parseDiarizeSegments(text) {
  const speakerMap = {};
  const segments   = [];

  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s+(.+)$/);
    if (!m) continue;

    const raw = m[1];
    if (!speakerMap[raw]) {
      if (/^[A-Z](_\d+)?$/.test(raw)) {
        speakerMap[raw] = raw;
      } else {
        const idx       = Object.keys(speakerMap).length;
        speakerMap[raw] = SPEAKER_LABELS[idx] ?? `S${idx}`;
      }
    }

    const content = m[2].trim();
    if (content) segments.push({ label: speakerMap[raw], text: content });
  }

  return segments;
}


export default async function getWebpageVoiceAddContext(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!wo.isWebpageVoice)  return coreData;
  if (wo.transcribeOnly)   return coreData;

  const text = typeof wo.payload === "string" ? wo.payload.trim() : "";
  if (!text) return coreData;

  if (!wo.db || !wo.flow || !wo.channelId) {
    log("Missing db/flow/channelID — skipping context write", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const ts     = String(wo.timestamp || new Date().toISOString());
  const turnId = typeof wo.turnId === "string" && wo.turnId ? wo.turnId : undefined;

  try {
    const segments = parseDiarizeSegments(text);

    if (segments.length > 0) {
      for (const seg of segments) {
        await setContext(wo, {
          ts,
          role:       "user",
          turnId:    turnId,
          content:    seg.text,
          userId:     seg.label,
          authorName: "",
          channelId:  String(wo.channelId),
          messageId:  String(wo.messageId || ""),
          source:     "voice-transcription"
        });
      }
      log("Diarized segments written to context", "info", { moduleName: MODULE_NAME, segments: segments.length });
    } else {
      await setContext(wo, {
        ts,
        role:       "user",
        turnId:    turnId,
        content:    text,
        userId:     "A",
        authorName: "",
        channelId:  String(wo.channelId),
        messageId:  String(wo.messageId || ""),
        source:     "voice-transcription"
      });
      log("Voice payload written to context", "info", { moduleName: MODULE_NAME, chars: text.length });
    }
  } catch (err) {
    log("Context write failed", "error", { moduleName: MODULE_NAME, error: err?.message || String(err) });
  }

  return coreData;
}
