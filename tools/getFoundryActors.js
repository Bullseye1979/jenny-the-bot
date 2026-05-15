/**************************************************************/
/* filename: "getFoundryActors.js"                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryActors";

async function getInvoke(args, coreData) {
  return invokeFoundryTool(MODULE_NAME, "actors", {
    query: String(args?.query || "").trim(),
    type: String(args?.type || "").trim(),
    ownedOnly: args?.ownedOnly === true,
    combatEligibleOnly: args?.combatEligibleOnly !== false,
    limit: Number(args?.limit) || 30,
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
