/***************************************************************
/* filename: "discord-reaction-finish.js"                     *
/* Version 1.0                                                *
/* Purpose: Clear hourglass and add check/cross reaction;     *
/*          DM-safe by removing only own hourglass in DMs.    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-reaction-finish";

/***************************************************************
/* functionSignature: getNowIso ()                             *
/* Returns current timestamp in ISO format                     *
/***************************************************************/
function getNowIso() { return new Date().toISOString(); }

/***************************************************************
/* functionSignature: getFlowHadErrors (wo)                    *
/* Checks logs for errors/failures to decide final reaction    *
/***************************************************************/
function getFlowHadErrors(wo) {
  const logs = Array.isArray(wo?.logging) ? wo.logging : [];
  for (const entry of logs) {
    const severity = String(entry?.severity || "").toLowerCase();
    const exitStatus = String(entry?.exitStatus || "").toLowerCase();
    if (severity === "error" || exitStatus === "failed") return true;
  }
  return false;
}

/***************************************************************
/* functionSignature: getIsDMContext (wo)                      *
/* Determines whether the current context is a DM              *
/***************************************************************/
function getIsDMContext(wo) {
  return !!(wo?.DM || wo?.isDM || wo?.channelType === 1 ||
            String(wo?.channelType ?? "").toUpperCase() === "DM" ||
            (!wo?.guildId && (wo?.userId || wo?.userid)));
}

/***************************************************************
/* functionSignature: setRemoveHourglassSafely (msg, c, dm)    *
/* Removes hourglass reactions safely, DM-aware                *
/***************************************************************/
async function setRemoveHourglassSafely(message, client, isDM) {
  try {
    if (!isDM && typeof message.reactions?.removeAll === "function") {
      await message.reactions.removeAll().catch(() => {});
    }
    const rx = message.reactions?.cache;
    if (!rx || rx.size === 0) return;
    const targets = ["⏳", "⌛"];
    for (const emoji of targets) {
      const r = rx.find(reac => (reac?.emoji?.name === emoji));
      if (r && r.users && typeof r.users.remove === "function" && client?.user?.id) {
        await r.users.remove(client.user.id).catch(() => {});
      }
    }
  } catch {}
}

/***************************************************************
/* functionSignature: getDiscordReactionFinish (coreData)      *
/* Finalizes reactions: clears hourglass, adds ✅ or ❌         *
/***************************************************************/
export default async function getDiscordReactionFinish(coreData) {
  const wo = coreData?.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  if (wo?.showReactions !== true) {
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
    const client = await getItem(wo.clientRef);
    const channelId = wo?.message?.channelId;
    const messageId = wo?.message?.id;
    if (!client || !channelId || !messageId) throw new Error("Missing client or message identifiers");

    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.messages?.fetch !== "function") throw new Error("Channel not fetchable");

    const triggeringMessage = await channel.messages.fetch(messageId);
    const dm = getIsDMContext(wo);

    await setRemoveHourglassSafely(triggeringMessage, client, dm);

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
