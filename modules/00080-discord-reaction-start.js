/**************************************************************/
/* filename: "00080-discord-reaction-start.js"                      */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-reaction-start";


export default async function getFlowStartReaction(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    if (wo?.showReactions !== true) {
      log("Reactions disabled → skip ⏳", "info", { moduleName: MODULE_NAME });
      return coreData;
    }

    const client = getItem(wo.clientRef);
    const channelId = wo?.message?.channelId;
    const messageId = wo?.message?.id;

    if (!client || !channelId || !messageId) throw new Error("Missing client or message identifiers");

    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.messages?.fetch !== "function") throw new Error("Channel not fetchable");

    const triggeringMessage = await channel.messages.fetch(messageId);
    await triggeringMessage.react("⏳");

    log("Added ⏳ reaction", "info", { moduleName: MODULE_NAME, channelId, messageId });
  } catch (err) {
    const reason = err?.message || String(err);
    log("Failed to add ⏳", "error", { moduleName: MODULE_NAME, reason });
  }

  return coreData;
}
