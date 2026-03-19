/************************************************************************************
/* filename: 00031-webpage-voice-add-context.js                                    *
/* Version 1.0                                                                     *
/* Purpose: Writes the voice transcription to the context DB immediately after     *
/*          transcription — before module 00032 sets wo.stop — so this executes    *
/*          for both transcribeOnly (meeting recorder) and full voice-AI flows.    *
/*                                                                                 *
/*          Diarized transcripts contain lines of the form "LABEL: text" where     *
/*          LABEL is either a single letter (A, B, …) for matched speakers or an  *
/*          offset label (A_2, B_3, …) for speakers whose identity could not be    *
/*          confirmed across chunk boundaries. Both formats are parsed; each        *
/*          speaker turn produces one context DB entry.                             *
/*          Plain (non-diarized) transcripts produce a single entry with userId A. *
/*                                                                                 *
/* Gate:    wo.isWebpageVoice === true  AND  wo.payload non-empty                  *
/*          AND  wo.channelID set  AND  wo.db available                            *
/*                                                                                 *
/* Config (config["webpage-voice-add-context"]):                                   *
/*   clearContextBeforeTranscription — when true, purges non-frozen context rows   *
/*                                     for the channel before writing the          *
/*                                     transcript (default: false)                 *
/*                                                                                 *
/* Flow:    webpage                                                                 *
/************************************************************************************/

import { setContext, setPurgeContext } from "../core/context.js";
import { getPrefixedLogger }           from "../core/logging.js";

const MODULE_NAME    = "webpage-voice-add-context";
const SPEAKER_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/*************************************************************************************
/* functionSignature: parseDiarizeSegments (text)                                  *
/* Parses "LABEL: text" lines and returns { label, text } objects.                 *
/*                                                                                 *
/* Recognised label formats:                                                       *
/*   A      — single uppercase letter (known speaker)                              *
/*   A_2    — letter + underscore + digit(s) (uncertain/offset speaker)            *
/*   speaker_0 — legacy numeric format, mapped to A, B, C, …                      *
/*                                                                                 *
/* Returns an empty array when no matching lines are found (plain transcript).     *
/*************************************************************************************/
function parseDiarizeSegments(text) {
  const speakerMap = {};
  const segments   = [];

  for (const line of text.split("\n")) {
    /* Matches: "A: text", "A_2: text", "speaker_0: text", "SPEAKER_00: text" */
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s+(.+)$/);
    if (!m) continue;

    const raw = m[1];
    if (!speakerMap[raw]) {
      if (/^[A-Z](_\d+)?$/.test(raw)) {
        /* Already a processed label (A or A_2) — use as-is */
        speakerMap[raw] = raw;
      } else {
        /* Legacy speaker_N format — map to next available letter */
        const idx       = Object.keys(speakerMap).length;
        speakerMap[raw] = SPEAKER_LABELS[idx] ?? `S${idx}`;
      }
    }

    const content = m[2].trim();
    if (content) segments.push({ label: speakerMap[raw], text: content });
  }

  return segments;
}

/*************************************************************************************
/* functionSignature: getWebpageVoiceAddContext (coreData)                         *
/* Optionally purges channel context, then writes one context entry per speaker    *
/* turn (diarized) or a single entry for plain transcripts.                        *
/*************************************************************************************/
export default async function getWebpageVoiceAddContext(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!wo.isWebpageVoice) return coreData;

  const text = typeof wo.payload === "string" ? wo.payload.trim() : "";
  if (!text) return coreData;

  if (!wo.db || !wo.flow || !wo.channelID) {
    log("Missing db/flow/channelID — skipping context write", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  // ── Purge channel context before storing (if configured) ──────────────────────
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  if (cfg.clearContextBeforeTranscription === true) {
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
