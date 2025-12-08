/***************************************************************/
/* filename: "discord-text-output.js"                          *
/* Version 1.0                                                 *
/* Purpose: Send two-embed replies: first a blue italic        *
/*          question embed (no footer or timestamp, no quote    *
/*          bar), then one or more green answer embeds (DMs     *
/*          direct; guilds via webhook).                        *
/***************************************************************/
/***************************************************************/
/*                                                             */
/***************************************************************/

import { EmbedBuilder, PermissionFlagsBits, WebhookClient } from "discord.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-text-output";
const COLOR_QUESTION = 0x3B82F6;
const COLOR_ANSWER = 0x22C55E;

/***************************************************************/
/* functionSignature: getIsLikelyImageUrl (url)               *
/* Returns true if the URL likely points to an image          *
/***************************************************************/
function getIsLikelyImageUrl(url) {
  const u = String(url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || /\/documents\//.test(u);
}

/***************************************************************/
/* functionSignature: getFirstImageUrlFromText (text)         *
/* Extracts the first image-like URL from a text string       *
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

/***************************************************************/
/* functionSignature: getChunkText (str, max)                 *
/* Splits long text into chunks respecting soft boundaries    *
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

/***************************************************************/
/* functionSignature: getWithCachebuster (url)                *
/* Appends a cache-busting query parameter to a URL           *
/***************************************************************/
function getWithCachebuster(url) {
  if (!url) return url;
  const cb = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${url}${url.includes("?") ? "&" : "?"}cb=${cb}`;
}

/***************************************************************/
/* functionSignature: getModuleConfigBaseURL (config)         *
/* Resolves the module baseURL from config                    *
/***************************************************************/
function getModuleConfigBaseURL(config) {
  const a = config?.["discord-text-output"];
  const b = config?.["discord_text-output"];
  return (a && a.baseURL) || (b && b.baseURL) || null;
}

/***************************************************************/
/* functionSignature: getIsThreadChannel (ch)                 *
/* Checks whether a channel is a thread                       *
/***************************************************************/
function getIsThreadChannel(ch) {
  return ch?.isThread?.() === true;
}

/***************************************************************/
/* functionSignature: getIsChannelWebhook (h)                 *
/* Checks whether a webhook is a channel webhook              *
/***************************************************************/
function getIsChannelWebhook(h) {
  return Number(h?.type) === 1 || String(h?.type) === "Incoming";
}

/***************************************************************/
/* functionSignature: getUrlExists (url, timeoutMs)           *
/* Verifies remote URL availability with HEAD/GET             *
/***************************************************************/
async function getUrlExists(url, timeoutMs = 3000) {
  if (typeof fetch !== "function") return true;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (res.ok) return true;
    res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: controller.signal });
    if (!res.ok) return false;
    const ct = String(res.headers.get("content-type") || "");
    return /image\//i.test(ct) || res.status === 206 || res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/***************************************************************/
/* functionSignature: setEnsureOwnChannelWebhookClient (...)  *
/* Ensures a usable channel webhook and returns its client    *
/***************************************************************/
async function setEnsureOwnChannelWebhookClient(client, message, desiredName, wo) {
  const currChannel = message.channel;
  const parentChannel = getIsThreadChannel(currChannel) ? currChannel.parent : currChannel;
  if (!parentChannel) throw new Error(`${MODULE_NAME}: cannot resolve parent channel for webhook`);
  const me = parentChannel.guild.members.me ?? await parentChannel.guild.members.fetch(client.user.id);
  const perms = parentChannel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ManageWebhooks)) {
    throw new Error(`${MODULE_NAME}: missing MANAGE_WEBHOOKS in #${parentChannel.id}`);
  }
  const webhooks = await parentChannel.fetchWebhooks();
  let hook = [...webhooks.values()].find(h => getIsChannelWebhook(h) && h.name === desiredName) || null;
  if (!hook) {
    hook = await parentChannel.createWebhook({ name: desiredName, reason: `${MODULE_NAME}: auto-create for ${desiredName}` });
    (wo.logging ||= []).push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `created channel webhook "${desiredName}" in #${parentChannel.id}`
    });
  }
  if (!hook || !getIsChannelWebhook(hook)) {
    throw new Error(`${MODULE_NAME}: resolved webhook is not a channel webhook (type=1)`);
  }
  const webhookClient = hook.url
    ? new WebhookClient({ url: hook.url })
    : (hook.id && hook.token ? new WebhookClient({ id: hook.id, token: hook.token }) : null);
  if (!webhookClient || typeof webhookClient.send !== "function") {
    throw new Error(`${MODULE_NAME}: failed to create WebhookClient`);
  }
  const threadId = getIsThreadChannel(currChannel) ? currChannel.id : null;
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: `using channel webhook: id=${hook.id} name="${hook.name}" type=${hook.type} parent=${parentChannel.id} thread=${threadId || "-"}`
  });
  return { webhookClient, threadId, parentChannelId: parentChannel.id };
}

/***************************************************************/
/* functionSignature: getResolvedIdentity (wo, config, id, c) *
/* Resolves username and avatar URL for webhook identity      *
/***************************************************************/
async function getResolvedIdentity(wo, config, effectiveChannelOrThreadId, client) {
  const raw = typeof wo?.Botname === "string" ? wo.Botname.trim() : "";
  if (!raw) throw new Error(`${MODULE_NAME}: wo.Botname is required but empty/missing`);
  const username = raw.slice(0, 80);
  const baseURL = getModuleConfigBaseURL(config || {});
  let avatarURL = null;
  if (baseURL) {
    const trimmed = String(baseURL).replace(/\/+$/, "");
    if (effectiveChannelOrThreadId) {
      const candidate = getWithCachebuster(`${trimmed}/documents/avatars/${effectiveChannelOrThreadId}.png`);
      if (await getUrlExists(candidate)) {
        avatarURL = candidate;
      }
    }
    if (!avatarURL) {
      const def = getWithCachebuster(`${trimmed}/documents/avatars/default.png`);
      if (await getUrlExists(def)) {
        avatarURL = def;
      }
    }
  }
  if (!avatarURL && client?.user?.displayAvatarURL) {
    try { avatarURL = client.user.displayAvatarURL(); } catch {}
  }
  return { username, avatarURL };
}

/***************************************************************/
/* functionSignature: getAskerDisplay (wo, baseMessage)       *
/* Resolves a display string for the original asker           *
/***************************************************************/
function getAskerDisplay(wo, baseMessage) {
  const nameCandidates = [
    "UserDisplayName","userDisplayName","DisplayName","displayName",
    "Username","username","UserName","userName","User","user","Author","author"
  ];
  let name = "";
  for (const k of nameCandidates) {
    const v = wo?.[k];
    if (typeof v === "string" && v.trim()) { name = v.trim(); break; }
  }
  const bmAuthor = baseMessage?.author;
  const userId = String(wo?.userId || wo?.userid || bmAuthor?.id || "") || "";
  if (!name && bmAuthor) {
    name = bmAuthor.tag || bmAuthor.username || "";
  }
  if (userId) {
    return `<@${userId}>`;
  }
  return name || "";
}

/***************************************************************/
/* functionSignature: getLikelyQuestion (wo)                  *
/* Extracts the original question text from the working obj   *
/***************************************************************/
function getLikelyQuestion(wo) {
  const candidates = [
    "Payload","payload","Prompt","prompt","Question","question",
    "Request","request","Query","query","Input","input",
    "UserText","userText","UserMessage","userMessage"
  ];
  for (const k of candidates) {
    const v = wo?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof wo?.payload === "object" && wo.payload !== null) {
    const s = String(wo.payload.text || wo.payload.content || "");
    if (s.trim()) return s.trim();
  }
  return "";
}

/***************************************************************/
/* functionSignature: getQuestionAsItalic (q, asker)          *
/* Formats entire multi-line question as plain italic text     *
/***************************************************************/
function getQuestionAsItalic(q, askerDisplay) {
  if (!q) return "";
  const normalized = String(q).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    if (i === 0 && askerDisplay) {
      if (line.trim()) out.push(`*${askerDisplay}: ${line}*`);
      else out.push(`*${askerDisplay}:*`);
    } else {
      if (line.trim()) out.push(`*${line}*`);
      else out.push("\u200b");
    }
  }
  return out.join("\n");
}

/***************************************************************/
/* functionSignature: getLocalTimeString (date, tz)           *
/* Formats a local time string for the given timezone         *
/***************************************************************/
function getLocalTimeString(date, tz) {
  try {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz || "Europe/Berlin" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
}

/***************************************************************/
/* functionSignature: getEmbedForQuestion (params)            *
/* Builds the blue question embed without footer/timestamp    *
/***************************************************************/
function getEmbedForQuestion({ qStr, askerDisplay }) {
  const desc = (getQuestionAsItalic(qStr, askerDisplay) || "\u200b").slice(0, 4096);
  return new EmbedBuilder()
    .setColor(COLOR_QUESTION)
    .setDescription(desc);
}

/***************************************************************/
/* functionSignature: getEmbedForAnswer (params)              *
/* Builds one green answer embed (with footer & timestamp)    *
/***************************************************************/
function getEmbedForAnswer({ answer, botName, model, useAIModule, timeStr, imageUrl }) {
  const desc = (String(answer || "").slice(0, 4096)) || "\u200b";
  const footerText = `${botName} (${model || "-"} / ${useAIModule || "-"}) - ${timeStr}`;
  const e = new EmbedBuilder()
    .setColor(COLOR_ANSWER)
    .setDescription(desc)
    .setFooter({ text: footerText })
    .setTimestamp(new Date());
  if (imageUrl) e.setImage(getWithCachebuster(imageUrl));
  return e;
}

/***************************************************************/
/* functionSignature: getDiscordTextOutput (coreData)         *
/* Sends two-embed output: question then answer(s)            *
/***************************************************************/
export default async function getDiscordTextOutput(coreData) {
  const wo = coreData.workingObject || {};
  const config = coreData.config || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const silence = (wo.ModSilence || "[silence]").toString();
  let response = (typeof wo.Response === "string" ? wo.Response : "").trim();
  if (!response || response === silence) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: !response ? "Missing response – nothing to send." : "Silence token – not sending."
    });
    return coreData;
  }

  const clientKey = wo.clientRef || (wo.refs && wo.refs.client);
  const client = clientKey ? await getItem(clientKey) : null;
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

  const isDM =
    !!(wo.DM || wo.isDM || wo.channelType === 1 ||
       String(wo.channelType ?? "").toUpperCase() === "DM" ||
       (!wo.guildId && (wo.userId || wo.userid)));

  try {
    const baseMessage = wo.message;
    const baseChannel = baseMessage?.channel ?? (await client.channels.fetch(channelId));
    if (!baseChannel) throw new Error("Channel not found");

    const firstImage = getFirstImageUrlFromText(response);
    const chunks = getChunkText(response, isDM ? 1900 : 3500);

    const question = getLikelyQuestion(wo);
    const askerDisplay = getAskerDisplay(wo, baseMessage);

    const model = String(wo.Model || wo.model || "");
    the const useAIModule = String(wo.useAIModule || wo.UseAIModule || "");
    const timeStr = getLocalTimeString(new Date(), wo.timezone || "Europe/Berlin");

    const questionBotName = (typeof wo.Botname === "string" && wo.Botname.trim()) ? wo.Botname.trim() : "Bot";

    const questionEmbed = getEmbedForQuestion({
      qStr: question,
      askerDisplay
    });

    if (isDM) {
      let sent = 0;
      await baseChannel.send({ embeds: [questionEmbed] });
      for (let i = 0; i < chunks.length; i++) {
        const embed = getEmbedForAnswer({
          answer: chunks[i],
          botName: questionBotName,
          model,
          useAIModule,
          timeStr,
          imageUrl: i === 0 ? firstImage : null
        });
        await baseChannel.send({ embeds: [embed] });
        sent++;
      }
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Sent question + ${sent} DM answer embed chunk(s)`
      });
      return coreData;
    }

    const desiredName = (typeof wo.Botname === "string" && wo.Botname.trim()) ? wo.Botname.trim() : "";
    if (!desiredName) throw new Error("wo.Botname is required but missing/empty");

    const { webhookClient, threadId, parentChannelId } =
      await setEnsureOwnChannelWebhookClient(client, { channel: baseChannel }, desiredName, wo);

    const effectiveAvatarId = threadId || parentChannelId;
    const identity = await getResolvedIdentity(wo, config, effectiveAvatarId, client);

    async function setSendAndVerify(payload) {
      const msg = await webhookClient.send({ ...payload, wait: true });
      const hasWebhookId = !!msg?.webhookId || !!msg?.webhook_id;
      if (!hasWebhookId) throw new Error("send returned no webhookId (not a webhook post)");
      return msg;
    }

    await setSendAndVerify({
      username: identity.username,
      avatarURL: identity.avatarURL || undefined,
      threadId: threadId || undefined,
      embeds: [questionEmbed]
    });

    let sentCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const embed = getEmbedForAnswer({
        answer: chunks[i],
        botName: identity.username,
        model,
        useAIModule,
        timeStr,
        imageUrl: i === 0 ? firstImage : null
      });
      await setSendAndVerify({
        username: identity.username,
        avatarURL: identity.avatarURL || undefined,
        threadId: threadId || undefined,
        embeds: [embed]
      });
      sentCount++;
    }

    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Sent question + ${sentCount} answer embed(s) to channel ${parentChannelId || channelId} as "${identity.username}".`
    });
  } catch (err) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Failed to send Discord message: ${err?.message || String(err)}`
    });
  }

  return coreData;
}
