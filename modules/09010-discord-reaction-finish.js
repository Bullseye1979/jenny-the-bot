/***************************************************************
/* filename: "09010-discord-reaction-finish.js"                *
/* Version 1.0                                                 *
/* Purpose: Finalize reactions on the triggering message;      *
/*          clear all and add ✅ on success or ❌ on error      *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-reaction-finish";

/***************************************************************
/* functionSignature: getFlowHadErrors (wo)                    *
/* Returns true if wo.logging contains error/failed entries    *
/***************************************************************/
function getFlowHadErrors(wo) {
  const logs = Array.isArray(wo?.logging) ? wo.logging : [];
  for (const l of logs) {
    const sev = String(l?.severity || "").toLowerCase();
    const status = String(l?.exitStatus || "").toLowerCase();
    if (sev === "error" || status === "failed") return true;
  }
  return false;
}

/***************************************************************
/* functionSignature: getDiscordReactionFinish (coreData)      *
/* Clears reactions and adds ✅ or ❌ based on flow outcome     *
/***************************************************************/
export default async function getDiscordReactionFinish(coreData) {
  const wo = coreData?.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Finalizing reactions"
  });

  try {
    const client = getItem(wo.clientRef);
    const channelId = wo?.message?.channelId;
    const messageId = wo?.message?.id;
    if (!client || !channelId || !messageId) {
      throw new Error("Missing client or message identifiers");
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.messages?.fetch !== "function") {
      throw new Error("Channel not fetchable");
    }

    const msg = await channel.messages.fetch(messageId);

    try {
      if (typeof msg.reactions?.removeAll === "function") {
        await msg.reactions.removeAll();
      }
    } catch {}

    const isError = getFlowHadErrors(wo);
    const emoji = isError ? "❌" : "✅";
    await msg.react(emoji);

    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Finalized with ${emoji}`
    });
  } catch (err) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Finalize failed: ${err?.message || String(err)}`
    });
  }

  return coreData;
}
