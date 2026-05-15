/**************************************************************/
/* filename: "getFoundryRoll.js"                             */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryRoll";

async function getInvoke(args, coreData) {
  const notation = String(args?.notation || "").trim();
  const rollType = String(args?.rollType || "").trim();
  const actorRef = String(args?.actorRef || "").trim();
  if (!notation && !(rollType.toLowerCase() === "initiative" && actorRef)) {
    return { ok: false, error: "notation is required unless rollType='initiative' is used with actorRef." };
  }

  return invokeFoundryTool(MODULE_NAME, "roll", {
    notation,
    label: String(args?.label || "").trim(),
    actorRef,
    rollType,
    advantage: args?.advantage === true,
    disadvantage: args?.disadvantage === true,
    emitChatMessage: args?.emitChatMessage !== false,
    visibility: String(args?.visibility || "").trim(),
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
