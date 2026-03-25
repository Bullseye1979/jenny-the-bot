/************************************************************************************
/* filename: 00074-core-trigger-gate.js                                            *
/* Version 1.0                                                                     *
/* Purpose: Flow-agnostic trigger gate.                                            *
/*          Stops the pipeline when wo.payload does not start with the configured  *
/*          trigger word (within the first N words).                               *
/*                                                                                 *
/* Trigger: wo.trigger (string) must be set; if empty/unset, all payloads pass.   *
/* Flows:   discord, discord-voice, webpage                                        *
/*          Skips automatically for webpage flows that are not voice               *
/*          (wo.isWebpageVoice !== true) — wiki, chat, etc. pass without check.   *
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME        = "core-trigger-gate";
const DEFAULT_WORD_WINDOW = 1;


export default async function getCoreTriggerGate(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  // Webpage flows that are not voice (wiki, chat, dashboard, …) don't use a
  // conversational trigger — skip so the global default trigger doesn't block them.
  if (wo.flow && wo.flow.startsWith("webpage") && !wo.isWebpageVoice) {
    log("Skipped: non-voice webpage flow", "info", { moduleName: MODULE_NAME, flow: wo.flow });
    return coreData;
  }

  const triggerRaw = typeof wo.trigger === "string" ? wo.trigger : "";
  const payloadRaw = typeof wo.payload === "string" ? wo.payload : "";
  const windowRaw  = wo.triggerWordWindow;

  if (!triggerRaw.trim()) {
    log("Allowed: no trigger set", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  const trigger    = triggerRaw.trim().toLowerCase();
  const wordWindow = Number.isInteger(windowRaw) && windowRaw > 0 ? windowRaw : DEFAULT_WORD_WINDOW;
  const text       = payloadRaw.trimStart().toLowerCase();

  if (!text) {
    wo.response   = "STOP";
    wo.stop       = true;
    wo.stopReason = "empty_payload";
    log("Blocked: empty payload", "warn", { moduleName: MODULE_NAME, trigger, wordWindow });
    return coreData;
  }

  const words = text.split(/\s+/);
  const limit = Math.min(wordWindow, words.length);
  let matches = false;

  for (let i = 0; i < limit; i++) {
    const normalizedWord = words[i]
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/[^\p{L}\p{N}]+$/gu, "");
    if (normalizedWord === trigger) { matches = true; break; }
  }

  if (!matches) {
    wo.response   = "STOP";
    wo.stop       = true;
    wo.stopReason = "trigger_not_found";
    log("Blocked: trigger not found in first words", "warn", {
      moduleName: MODULE_NAME, trigger, wordWindow, sample: payloadRaw.slice(0, 80)
    });
    return coreData;
  }

  log("Allowed: trigger found", "info", { moduleName: MODULE_NAME, trigger, wordWindow });
  return coreData;
}
