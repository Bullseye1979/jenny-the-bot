/***************************************************************
/* filename: "09000-discord-text-output.js"                    *
/* Version 1.0                                                 *
/* Purpose: Send AI responses to Discord as embeds using wo.id *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { EmbedBuilder } from "discord.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-text-output";

/***************************************************************
/* functionSignature: getIsLikelyImageUrl (url)                *
/* Returns true if the URL likely points to an image           *
/***************************************************************/
function getIsLikelyImageUrl(url) {
  const u = String(url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || /\/documents\//.test(u);
}

/***************************************************************
/* functionSignature: getFirstImageUrlFromText (text)          *
/* Extracts the first image URL from text (markdown or plain)  *
/***************************************************************/
function getFirstImageUrlFromText(text) {
  if (!text) return null;
  const s = String(text);
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i.exec(s);
  if (md && getIsLikelyImageUrl(md[1])) return md[1];
  const urlRegex = /(https?:\/\/[^\s<>"'()]+)(?=[\s<>"')]|$)/gi;
  let m;
  while ((m = urlRegex.exec(s)) !== null) {
    const u = m[1];
    if (getIsLikelyImageUrl(u)) return u;
  }
  return null;
}

/***************************************************************
/* functionSignature: getChunkText (str, max)                  *
/* Splits text into chunks not exceeding max length            *
/***************************************************************/
function getChunkText(str, max = 3500) {
  const text = typeof str === "string" ? str : "";
  if (!text) return [];
  if (text.length <= max) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + max, text.length);
    let slice = text.slice(i, end);
    if (end < text.length) {
      const p = slice.lastIndexOf("\n\n");
      const l = slice.lastIndexOf("\n");
      const sp = slice.lastIndexOf(" ");
      const pref = p > 800 ? p : l > 800 ? l : sp > 800 ? sp : -1;
      if (pref > -1) { end = i + pref; slice = text.slice(i, end); }
    }
    chunks.push(slice.trim() || "\u200b");
    i = end;
  }
  return chunks.length ? chunks : ["\u200b"];
}

/***************************************************************
/* functionSignature: getBuildSingleEmbed (data)               *
/* Creates one Discord embed for a given text page             *
/***************************************************************/
function getBuildSingleEmbed({ content, page, total, botName, botAvatar, imageUrl }) {
  const title = total > 1 ? `Answer • Page ${page}/${total}` : "Answer";
  const e = new EmbedBuilder()
    .setColor(0x2F3136)
    .setAuthor({ name: botName, iconURL: botAvatar || undefined })
    .setTitle(title)
    .setDescription((content || "").slice(0, 4096) || "\u200b")
    .setFooter({ text: botName })
    .setTimestamp(new Date());
  if (imageUrl && page === 1) e.setImage(imageUrl);
  return e;
}

/***************************************************************
/* functionSignature: getDiscordTextOutput (coreData)          *
/* Sends wo.Response to Discord as 1-embed-per-message pages   *
/***************************************************************/
export default async function getDiscordTextOutput(coreData) {
  const wo = coreData.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const response = (typeof wo.Response === "string" ? wo.Response : "").trim();
  if (!response) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "Missing response – nothing to send."
    });
    return coreData;
  }

  const clientKey = wo.clientRef || (wo.refs && wo.refs.client);
  const client = clientKey ? getItem(clientKey) : null;
  if (!client) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Discord client not available from registry"
    });
    return coreData;
  }

  const channelId = String(wo.id || "");
  if (!channelId) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "Missing wo.id – cannot resolve channel."
    });
    return coreData;
  }

  try {
    const botUser = client.user || null;
    const botName = botUser?.username || "AI Assistant";
    const botAvatar = typeof botUser?.displayAvatarURL === "function" ? botUser.displayAvatarURL({ size: 64 }) : null;

    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    const firstImage = getFirstImageUrlFromText(response);
    const parts = getChunkText(response, 3500);
    const total = Math.max(1, parts.length);

    let sentCount = 0;
    for (let i = 0; i < total; i++) {
      const embed = getBuildSingleEmbed({
        content: parts[i],
        page: i + 1,
        total,
        botName,
        botAvatar,
        imageUrl: firstImage
      });
      // eslint-disable-next-line no-await-in-loop
      await channel.send({ embeds: [embed] });
      sentCount++;
    }

    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Sent ${sentCount} message(s) to channel ${channelId} (1 embed each, no replies).`
    });
  } catch (err) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Failed to send Discord embeds: ${err?.message || String(err)}`
    });
  }

  return coreData;
}
