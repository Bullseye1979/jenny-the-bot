/**************************************************************/
/* filename: "08200-discord-reaction-finish.js"                     */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/






import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-reaction-finish";


function getFlowHadErrors(wo) {
  const logs = Array.isArray(wo?.logging) ? wo.logging : [];
  for (const entry of logs) {
    const level = String(entry?.level || entry?.severity || "").toLowerCase();
    const exitStatus = String(entry?.exitStatus || "").toLowerCase();
    if (level === "error" || exitStatus === "failed") return true;
  }
  return false;
}


function getIsDMContext(wo) {
  return !!(wo?.DM || wo?.isDM || wo?.channelType === 1 ||
            String(wo?.channelType ?? "").toUpperCase() === "DM" ||
            (!wo?.guildId && !!wo?.userId));
}


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


export default async function getDiscordReactionFinish(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo?.showReactions !== true) {
    log("Reactions disabled → skip finalization");
    return coreData;
  }

  log("Finalizing reactions");

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

    log(`Finalized with ${finalEmoji}`);
  } catch (err) {
    log(`Finalize failed: ${err?.message || String(err)}`, "error");
  }

  return coreData;
}
