/**************************************************************
/* filename: "discord-trigger-gate.js"                        *
/* Version 1.0                                                *
/* Purpose: Block if trigger not in first N words             *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-trigger-gate";
const DEFAULT_WORD_WINDOW = 1;

/**************************************************************
/* functionSignature: getDiscordTriggerGate (coreData)        *
/* Stops flow when payload lacks trigger within first N words *
/**************************************************************/
export default async function getDiscordTriggerGate(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const triggerRaw = typeof wo.trigger === "string" ? wo.trigger : "";
  const payloadRaw = typeof wo.payload === "string" ? wo.payload : "";
  const windowRaw = wo.triggerWordWindow;

  if (!triggerRaw.trim()) {
    log("Allowed: no trigger set", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  const trigger = triggerRaw.trim().toLowerCase();
  const wordWindow =
    Number.isInteger(windowRaw) && windowRaw > 0 ? windowRaw : DEFAULT_WORD_WINDOW;

  const text = payloadRaw.trimStart().toLowerCase();

  if (!text) {
    wo.response = "STOP";
    wo.stop = true;
    log("Blocked: empty payload", "warn", {
      moduleName: MODULE_NAME,
      trigger,
      wordWindow
    });
    return coreData;
  }

  const words = text.split(/\s+/);
  const limit = Math.min(wordWindow, words.length);

  let matches = false;

  for (let i = 0; i < limit; i++) {
    const normalizedWord = words[i]
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/[^\p{L}\p{N}]+$/gu, "");

    if (normalizedWord === trigger) {
      matches = true;
      break;
    }
  }

  if (!matches) {
    wo.response = "STOP";
    wo.stop = true;
    log("Blocked: trigger not found in first words", "warn", {
      moduleName: MODULE_NAME,
      trigger,
      wordWindow,
      sample: payloadRaw.slice(0, 80)
    });
    return coreData;
  }

  log("Allowed: trigger found in first words", "info", {
    moduleName: MODULE_NAME,
    trigger,
    wordWindow
  });

  return coreData;
}
