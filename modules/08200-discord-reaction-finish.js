/**************************************************************
/* filename: "discord-reaction-finish.js"                     *
/* Version 1.0                                                *
/* Purpose: Finalize reactions on the triggering message;     *
/*          clear all and add ✅ on success or ❌ on error   *
/*          (only if wo.ShowReactions === true)               *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-reaction-finish";

/**************************************************************
/* functionSignature: getNowIso ()                            *
/* Returns current time in ISO format.                        *
/**************************************************************/
function getNowIso() { return new Date().toISOString(); }

/**************************************************************
/* functionSignature: getFlowHadErrors (wo)                   *
/* Returns true if wo.logging contains error/failed entries   *
/**************************************************************/
function getFlowHadErrors(wo) {
  const logs = Array.isArray(wo?.logging) ? wo.logging : [];
  for (const entry of logs) {
    const severity = String(entry?.severity || "").toLowerCase();
    const exitStatus = String(entry?.exitStatus || "").toLowerCase();
    if (severity === "error" || exitStatus === "failed") return true;
  }
  return false;
}

/**************************************************************
/* functionSignature: getDiscordReactionFinish (coreData)     *
/* Clears reactions and adds ✅ or ❌ based on flow outcome    *
/**************************************************************/
export default async function getDiscordReactionFinish(coreData) {
  const wo = coreData?.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  if (wo?.ShowReactions !== true) {
    wo.logging.push({
      timestamp: getNowIso(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "Reactions disabled → skip finalization"
    });
    return coreData;
  }

  wo.logging.push({
    timestamp: getNowIso(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Finalizing reactions"
  });

  try {
    const client = getItem(wo.clientRef);
    const channelId = wo?.message?.channelId;
    const messageId = wo?.message?.id;
    if (!client || !channelId || !messageId) throw new Error("Missing client or message identifiers");

    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.messages?.fetch !== "function") throw new Error("Channel not fetchable");

    const triggeringMessage = await channel.messages.fetch(messageId);

    try {
      if (typeof triggeringMessage.reactions?.removeAll === "function") {
        await triggeringMessage.reactions.removeAll();
      }
    } catch { /* best-effort cleanup */ }

    const hadErrors = getFlowHadErrors(wo);
    const finalEmoji = hadErrors ? "❌" : "✅";
    await triggeringMessage.react(finalEmoji);

    wo.logging.push({
      timestamp: getNowIso(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Finalized with ${finalEmoji}`
    });
  } catch (err) {
    wo.logging.push({
      timestamp: getNowIso(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Finalize failed: ${err?.message || String(err)}`
    });
  }

  return coreData;
}
