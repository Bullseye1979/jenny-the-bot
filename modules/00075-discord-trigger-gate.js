/***************************************************************
/* filename: "discord-trigger-gate.js"                         *
/* Version 1.0                                                 *
/* Purpose: Block when user text (wo.payload) does not start   *
/*          with trigger (wo.trigger); set wo.Response/stop    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-trigger-gate";

/***************************************************************
/* functionSignature: getDiscordTriggerGate (coreData)         *
/* Stops flow when payload does not start with configured key  *
/***************************************************************/
export default async function getDiscordTriggerGate(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const triggerRaw = typeof wo.trigger === "string" ? wo.trigger : "";
  const payloadRaw = typeof wo.payload === "string" ? wo.payload : "";

  if (!triggerRaw.trim()) {
    log("No trigger set → allow", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  const trigger = triggerRaw.trim().toLowerCase();
  const text = payloadRaw.trimStart().toLowerCase();
  const matches = text.startsWith(trigger);

  if (!matches) {
    wo.Response = "STOP";
    wo.stop = true;
    log("Blocked: payload does not start with trigger", "warn", {
      moduleName: MODULE_NAME,
      trigger,
      sample: payloadRaw.slice(0, 40)
    });
    return coreData;
  }

  log("Allowed: payload starts with trigger", "info", { moduleName: MODULE_NAME, trigger });
  return coreData;
}
