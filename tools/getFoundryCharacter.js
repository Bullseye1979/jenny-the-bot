/**************************************************************/
/* filename: "getFoundryCharacter.js"                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryCharacter";

async function getInvoke(args, coreData) {
  const characterRef = String(args?.characterRef || "").trim();
  if (!characterRef) {
    return { ok: false, error: "characterRef is required (for example an actor ID, exact actor name, or configured external key)." };
  }

  return invokeFoundryTool(MODULE_NAME, "character", {
    characterRef,
    detail: String(args?.detail || "").trim(),
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
