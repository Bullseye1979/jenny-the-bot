/**************************************************************/
/* filename: "00074-core-trigger-gate.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/













import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME        = "core-trigger-gate";
const DEFAULT_WORD_WINDOW = 1;


export default async function getCoreTriggerGate(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo.flow && wo.flow.startsWith("webpage") && !wo.isWebpageVoice) {
    log("Skipped: non-voice webpage flow", "info", { moduleName: MODULE_NAME, flow: wo.flow });
    return coreData;
  }

  if (wo.bypassTriggerGate === true) {
    log("Allowed: bypassTriggerGate set", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (wo.isMacro === true) {
    log("Allowed: macro payload", "info", { moduleName: MODULE_NAME });
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
    wo.stopReason = "empty_payload";
    if (wo.isWebpageVoice) { wo.jump = true; } else { wo.stop = true; }
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
    wo.stopReason = "trigger_not_found";
    if (wo.isWebpageVoice) { wo.jump = true; } else { wo.stop = true; }
    log("Blocked: trigger not found in first words", "warn", {
      moduleName: MODULE_NAME, trigger, wordWindow, sample: payloadRaw.slice(0, 80)
    });
    return coreData;
  }

  log("Allowed: trigger found", "info", { moduleName: MODULE_NAME, trigger, wordWindow });
  return coreData;
}
