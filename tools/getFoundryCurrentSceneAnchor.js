/**************************************************************/
/* filename: "getFoundryCurrentSceneAnchor.js"               */
/* Version 1.0                                               */
/* Purpose: Resolve the current Foundry story anchor.       */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryCurrentSceneAnchor";

async function getInvoke(args, coreData) {
  return invokeFoundryTool(MODULE_NAME, "journal", {
    operation: "currentsceneanchor",
    query: String(args?.query || "").trim(),
    currentLocation: String(args?.currentLocation || "").trim(),
    chapterHint: String(args?.chapterHint || "").trim(),
    objective: String(args?.objective || "").trim(),
    recentEvent: String(args?.recentEvent || "").trim(),
    limit: args?.limit,
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
