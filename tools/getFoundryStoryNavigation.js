/**************************************************************/
/* filename: "getFoundryStoryNavigation.js"                  */
/* Version 1.0                                               */
/* Purpose: High-level Foundry story navigation tool.       */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryStoryNavigation";

async function getInvoke(args, coreData) {
  return invokeFoundryTool(MODULE_NAME, "journal", {
    operation: "storynavigation",
    query: String(args?.query || "").trim(),
    limit: args?.limit,
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
