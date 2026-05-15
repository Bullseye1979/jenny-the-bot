/**************************************************************/
/* filename: "getFoundryInitiative.js"                       */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryInitiative";

async function getInvoke(args, coreData) {
  return invokeFoundryTool(MODULE_NAME, "initiative", {
    operation: String(args?.operation || "").trim(),
    scope: String(args?.scope || "").trim(),
    mode: String(args?.mode || "").trim(),
    combatRef: String(args?.combatRef || "").trim(),
    actorRefs: Array.isArray(args?.actorRefs) ? args.actorRefs : [],
    npcNames: Array.isArray(args?.npcNames) ? args.npcNames : [],
    initiatives: Array.isArray(args?.initiatives) ? args.initiatives : [],
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
