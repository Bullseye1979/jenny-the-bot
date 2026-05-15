/**************************************************************/
/* filename: "getFoundryCampaignInfo.js"                    */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";

const MODULE_NAME = "getFoundryCampaignInfo";

async function getInvoke(args, coreData) {
  const query = String(args?.query || "").trim();
  if (!query) {
    return { ok: false, error: "query is required." };
  }

  return invokeFoundryTool(MODULE_NAME, "campaignInfo", {
    query,
    scope: String(args?.scope || "").trim(),
    limit: args?.limit,
    channelKey: args?.channelKey
  }, coreData);
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
