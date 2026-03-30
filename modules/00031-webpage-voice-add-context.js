/************************************************************************************
/* filename: 00031-webpage-voice-add-context.js                                    *
/* Version 1.0                                                                     *
/* Purpose: Writes the voice transcription to the context DB immediately after     *
/*          transcription for the always-on voice path only.                       *
/*          Skips when wo.transcribeOnly is true (meeting recorder) — those        *
/*          transcripts are stored in the diarize review DB and written to context *
/*          only when the user explicitly clicks Apply in the Review tab.          *
/*                                                                                 *
/*          Diarized transcripts contain lines of the form "LABEL: text" where     *
/*          LABEL is either a single letter (A, B, …) for matched speakers or an  *
/*          offset label (A_2, B_3, …) for speakers whose identity could not be    *
/*          confirmed across chunk boundaries. Both formats are parsed; each        *
/*          speaker turn produces one context DB entry.                             *
/*          Plain (non-diarized) transcripts produce a single entry with userId A. *
/*                                                                                 *
/* Gate:    wo.isWebpageVoice === true  AND  wo.transcribeOnly !== true            *
/*          AND  wo.payload non-empty  AND  wo.channelID set  AND  wo.db available *
/*                                                                                 *
/* Config (config["webpage-voice-add-context"]):                                   *
/*   clearContextChannels — array of channel IDs for which the context DB is       *
/*                          purged (non-frozen rows only, via setPurgeContext)     *
/*                          before storing the transcription. Default: []          *
/*                                                                                 *
/* Flow:    webpage                                                                 *
/************************************************************************************/

import { setContext, setPurgeContext } from "../core/context.js";
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

  if (!wo.db || !wo.flow || !wo.channelID) {
    log("Missing db/flow/channelID — skipping context write", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const cfg             = coreData?.config?.[MODULE_NAME] || {};
  const clearChannels   = Array.isArray(cfg.clearContextChannels) ? cfg.clearContextChannels : [];
  if (clearChannels.includes(wo.channelID)) {
    try {
      const purged = await setPurgeContext(wo);
      log("Context purged before transcription store", "info", { moduleName: MODULE_NAME, purged });
    } catch (err) {
      log("Context purge failed", "error", { moduleName: MODULE_NAME, error: err?.message || String(err) });
    }
  }

  const ts     = String(wo.timestamp || new Date().toISOString());
  const turnId = typeof wo.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;

  try {
    const segments = parseDiarizeSegments(text);

    if (segments.length > 0) {
      for (const seg of segments) {
        await setContext(wo, {
          ts,
          role:       "user",
          turn_id:    turnId,
          content:    seg.text,
          userId:     seg.label,
          authorName: "",
          channelId:  String(wo.channelID),
          messageId:  String(wo.messageId || ""),
          source:     "voice-transcribe"
        });
      }
      log("Diarized segments written to context", "info", { moduleName: MODULE_NAME, segments: segments.length });
    } else {
      await setContext(wo, {
        ts,
        role:       "user",
        turn_id:    turnId,
        content:    text,
        userId:     "A",
        authorName: "",
        channelId:  String(wo.channelID),
        messageId:  String(wo.messageId || ""),
        source:     "voice-transcribe"
      });
      log("Voice payload written to context", "info", { moduleName: MODULE_NAME, chars: text.length });
    }
  } catch (err) {
    log("Context write failed", "error", { moduleName: MODULE_NAME, error: err?.message || String(err) });
  }

  return coreData;
}
