/**************************************************************/
/* filename: "getFoundryJournal.js"                          */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryJournal";

async function getInvoke(args, coreData) {
  const operation = String(args?.operation || "").trim().toLowerCase();
  if (!operation) {
    return { ok: false, error: "operation is required. Use list, search, read, scan, outline, entrypoints, anchors, storynavigation, or currentsceneanchor." };
  }

  return invokeFoundryTool(MODULE_NAME, "journal", {
    operation,
    query: String(args?.query || "").trim(),
    entryRef: String(args?.entryRef || "").trim(),
    pageRef: String(args?.pageRef || "").trim(),
    limit: args?.limit,
    cursor: args?.cursor,
    offset: args?.offset,
    maxChars: args?.maxChars,
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
