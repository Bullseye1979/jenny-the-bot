/**************************************************************/
/* filename: "08000-discord-text-output.js"                         */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/











import discordJs from "discord.js";
const { EmbedBuilder, PermissionFlagsBits, WebhookClient } = discordJs;
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-text-output";
const COLOR_PRIMARY = 0x22C55E;

const EMBED_DESC_MAX = 4096;
const DM_ANSWER_MAX = 1900;
const GUILD_ANSWER_MAX = 3500;

const REASONING_DESC_TARGET = 3900;
const THREAD_AUTO_ARCHIVE_MINUTES = 60;


function getIsLikelyImageUrl(url) {
  const u = String(url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || /\/documents\//.test(u);
}


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


function getWithCachebuster(url) {
  if (!url) return url;
  const cb = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${url}${url.includes("?") ? "&" : "?"}cb=${cb}`;
}


function getModuleConfigBaseURL(config) {
  return config?.["discord-text-output"]?.baseURL || null;
}


function getIsThreadChannel(ch) {
  return ch?.isThread?.() === true;
}


function getIsChannelWebhook(h) {
  return Number(h?.type) === 1 || String(h?.type) === "Incoming";
}


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


async function setEnsureOwnChannelWebhookClient(client, message, desiredName, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
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
    log(`created channel webhook "${desiredName}" in #${parentChannel.id}`, "info");
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

  log(`using channel webhook: id=${hook.id} name="${hook.name}" type=${hook.type} parent=${parentChannel.id} thread=${threadId || "-"}`, "info");

  return { webhookClient, threadId };
}


function getAvatarLookupId(baseChannel, threadId, fallbackId) {
  if (threadId) {
    const pid = baseChannel?.parentId || baseChannel?.parent?.id || null;
    return String(pid || baseChannel?.id || fallbackId || "");
  }
  return String(baseChannel?.id || fallbackId || "");
}


async function getResolvedIdentity(wo, config, effectiveChannelOrThreadId, client) {
  const raw = typeof wo?.botName === "string" ? wo.botName.trim() : "";
  if (!raw) throw new Error(`${MODULE_NAME}: wo.botName is required but empty/missing`);

  const username = raw.slice(0, 80);
  const baseURL = getModuleConfigBaseURL(config || {});
  let avatarURL = null;

  if (baseURL) {
    const trimmed = String(baseURL).replace(/\/+$/, "");
    if (effectiveChannelOrThreadId) {
      const candidate = getWithCachebuster(`${trimmed}/documents/avatars/${effectiveChannelOrThreadId}.png`);
      if (await getUrlExists(candidate)) avatarURL = candidate;
    }
    if (!avatarURL) {
      const def = getWithCachebuster(`${trimmed}/documents/avatars/default.png`);
      if (await getUrlExists(def)) avatarURL = def;
    }
  }

  if (!avatarURL && client?.user?.displayAvatarURL) {
    try { avatarURL = client.user.displayAvatarURL(); } catch {}
  }

  return { username, avatarURL };
}


function getAskerDisplay(wo, baseMessage) {
  const nameCandidates = [
    "UserDisplayName", "userDisplayName", "DisplayName", "displayName",
    "Username", "username", "UserName", "userName", "User", "user", "Author", "author",
    "authorDisplayname", "authorDisplayName"
  ];

  for (const k of nameCandidates) {
    const v = wo?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  const bmAuthor = baseMessage?.author;
  if (bmAuthor?.globalName) return bmAuthor.globalName;
  if (bmAuthor?.username) return bmAuthor.username;
  return "";
}


function getLikelyQuestion(wo) {
  if (typeof wo?.question === "string" && wo.question.trim()) return wo.question.trim();
  const v = wo?.payload;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  try { return String(v).trim(); } catch { return ""; }
}


function getLocalTimeString(date, tz) {
  try {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz || "Europe/Berlin" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
}


function getBuildYamlQuestionBlock(name, text) {
  const display = String(name || "").trim();
  const norm = String(text || "").replace(/\r\n?/g, "\n");
  const lines = norm.split("\n").map(l => `  ${l || ""}`).join("\n");
  const header = display ? `${display}: \n\n` : "";
  const body = `${header}${lines}`.trimEnd();
  return "```yaml\n" + body + "\n```";
}


function getStripInvis(s) {
  return String(s || "")
    .replace(/\u200B/g, "")
    .replace(/\u200C/g, "")
    .replace(/\u200D/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ");
}


function getNormalizeReasoningText(text) {
  const norm = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!norm) return "";

  const lines = norm.split("\n");
  const out = [];
  let lastWasRsId = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = getStripInvis(lines[i] || "").replace(/\t/g, "    ");
    const t = raw.trim();
    const tl = t.toLowerCase();

    if (/^rs_[a-f0-9]{10,}$/i.test(t)) { lastWasRsId = true; continue; }
    if (lastWasRsId && tl === "reasoning") { lastWasRsId = false; continue; }
    if (tl === "summary_text") { lastWasRsId = false; continue; }

    lastWasRsId = false;
    out.push(raw);
  }

  const spaced = [];
  for (let i = 0; i < out.length; i++) {
    const line = out[i] || "";
    const isBoldHeadline = /^\s*\*\*.+?\*\*\s*$/.test(line);
    if (isBoldHeadline) {
      const prev = spaced.length ? spaced[spaced.length - 1] : "";
      if (String(prev).trim().length) spaced.push("");
    }
    spaced.push(line);
  }

  return spaced.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}


function getFenceOpenMeta(line) {
  const s = String(line || "");
  const m = /^\s*(```|~~~)\s*([A-Za-z0-9_-]+)?\s*$/.exec(s);
  if (!m) return null;
  const fence = m[1];
  const lang = (m[2] || "").trim();
  const fenceLine = lang ? `${fence}${lang}` : `${fence}`;
  return { fence, fenceLine };
}


function getIsFenceCloseLine(line, fence) {
  if (!fence) return false;
  const s = String(line || "");
  const esc = fence.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`^\\s*${esc}\\s*$`).test(s);
}


function getChunkMarkdownFlex(str, firstMax = 3500, nextMax = 3500) {
  const text = typeof str === "string" ? str.replace(/\r\n?/g, "\n") : "";
  if (!text) return [];

  const fMax = Math.max(200, Math.min(3900, Number(firstMax) || 3500));
  const nMax = Math.max(200, Math.min(3900, Number(nextMax) || 3500));

  const chunks = [];
  const lines = text.split("\n");

  let buf = "";
  let activeFence = "";
  let activeFenceLine = "";


  function getCurrMax() {
    return chunks.length === 0 ? fMax : nMax;
  }


  function pushChunk(s) {
    const out = String(s || "").replace(/\s+$/g, "");
    chunks.push(out.length ? out : "\u200b");
  }


  function closeFenceIfNeeded() {
    if (!activeFence) return;
    if (!buf.endsWith("\n")) buf += "\n";
    buf += `${activeFence}\n`;
  }


  function startNewChunk() {
    buf = "";
    if (activeFence && activeFenceLine) buf += `${activeFenceLine}\n`;
  }


  function appendPiece(piece) {
    const currMax = getCurrMax();
    if (!piece) return;

    const reserve = activeFence ? (activeFence.length + 1) : 0;

    if ((buf.length + piece.length + reserve) <= currMax) {
      buf += piece;
      return;
    }

    closeFenceIfNeeded();
    pushChunk(buf);
    startNewChunk();

    const currMax2 = getCurrMax();
    const reserve2 = activeFence ? (activeFence.length + 1) : 0;

    if ((buf.length + piece.length + reserve2) <= currMax2) {
      buf += piece;
      return;
    }

    let remaining = piece;
    while (remaining.length) {
      const currMaxN = getCurrMax();
      const reserveN = activeFence ? (activeFence.length + 1) : 0;
      const room = Math.max(1, currMaxN - buf.length - reserveN);
      const part = remaining.slice(0, room);
      remaining = remaining.slice(room);
      buf += part;
      if (remaining.length) {
        closeFenceIfNeeded();
        pushChunk(buf);
        startNewChunk();
      }
    }
  }

  startNewChunk();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const piece = (i === lines.length - 1) ? line : `${line}\n`;

    appendPiece(piece);

    if (!activeFence) {
      const open = getFenceOpenMeta(line);
      if (open) {
        activeFence = open.fence;
        activeFenceLine = open.fenceLine;
      }
    } else if (getIsFenceCloseLine(line, activeFence)) {
      activeFence = "";
      activeFenceLine = "";
    }
  }

  if (buf.length) {
    closeFenceIfNeeded();
    pushChunk(buf);
  }

  return chunks.length ? chunks : ["\u200b"];
}


function getTextFromAny(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(getTextFromAny).filter(Boolean).join("\n");
  if (typeof x === "object") {
    if (typeof x.text === "string") return x.text;
    if (typeof x.content === "string") return x.content;
    if (typeof x.summary === "string") return x.summary;
    if (Array.isArray(x.summary)) return getTextFromAny(x.summary);
    if (Array.isArray(x.items)) return getTextFromAny(x.items);
    try { return JSON.stringify(x); } catch { return ""; }
  }
  try { return String(x); } catch { return ""; }
}


function getReasoningText(wo) {
  const v = wo?.reasoningSummary;
  if (v == null) return "";
  if (typeof v === "string") return getNormalizeReasoningText(v);
  return getNormalizeReasoningText(getTextFromAny(v).trim());
}


function getIsBoldHeadlineLine(line) {
  return /^\s*\*\*.+?\*\*\s*$/.test(String(line || ""));
}


function getSplitByBoldHeadlines(text) {
  const norm = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!norm) return [];

  const lines = norm.split("\n");
  const segments = [];
  let buf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (getIsBoldHeadlineLine(line) && buf.length) {
      segments.push(buf.join("\n").trim());
      buf = [];
    }
    buf.push(line);
  }

  if (buf.length) segments.push(buf.join("\n").trim());
  return segments.filter(Boolean);
}


function getPackSegmentsToChunksMarkdown(segments, maxLen) {
  const max = Math.max(400, Math.min(3900, Number(maxLen) || REASONING_DESC_TARGET));
  const out = [];
  let cur = "";


  function pushCur() {
    const v = String(cur || "").trim();
    if (v) out.push(v);
    cur = "";
  }

  for (const seg0 of (segments || [])) {
    const seg = String(seg0 || "").trim();
    if (!seg) continue;

    if (seg.length > max) {
      pushCur();
      const parts = getChunkMarkdownFlex(seg, max, max);
      for (const p of parts) {
        const v = String(p || "").trim();
        if (v) out.push(v);
      }
      continue;
    }

    if (!cur) {
      cur = seg;
      continue;
    }

    const candidate = `${cur}\n\n${seg}`;
    if (candidate.length <= max) {
      cur = candidate;
    } else {
      pushCur();
      cur = seg;
    }
  }

  pushCur();
  return out;
}


function getNormalizeReasoningForThread(text) {
  const norm = getNormalizeReasoningText(text);
  if (!norm) return "";
  return norm.replace(/\n{3,}/g, "\n\n").trim();
}


function getReasoningThreadChunks(text, maxLen = REASONING_DESC_TARGET) {
  const norm = getNormalizeReasoningForThread(text);
  if (!norm) return [];

  const segments = getSplitByBoldHeadlines(norm);
  if (segments.length) return getPackSegmentsToChunksMarkdown(segments, maxLen);

  return getChunkMarkdownFlex(norm, maxLen, maxLen);
}


function getJoinLen(parts) {
  const kept = parts.filter(Boolean).map(x => String(x));
  if (!kept.length) return 0;
  let n = 0;
  for (let i = 0; i < kept.length; i++) {
    if (i) n += 2;
    n += kept[i].length;
  }
  return n;
}


function getFooterText(botName, model, useAiModule, timeStr, projectId) {
  const base = `${botName} (${model || "-"} / ${useAiModule || "-"})`;
  const pid  = projectId ? ` - ${projectId}` : "";
  return `${base}${pid}`;
}


function getBuildPrimaryEmbed({ askerDisplay, questionText, answerChunk, botName, model, useAiModule, timeStr, imageUrl, projectId }) {
  const qBlock = getBuildYamlQuestionBlock(askerDisplay, questionText);
  const joined = [qBlock, String(answerChunk || "")].filter(Boolean).join("\n\n") || "\u200b";
  const desc = joined.slice(0, EMBED_DESC_MAX) || "\u200b";

  const e = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setDescription(desc)
    .setFooter({ text: getFooterText(botName, model, useAiModule, timeStr, projectId) })
    .setTimestamp(new Date());

  if (imageUrl) e.setImage(getWithCachebuster(imageUrl));
  return e;
}


function getBuildAnswerEmbed({ answerChunk, botName, model, useAiModule, timeStr, projectId }) {
  const desc = String(answerChunk || "").slice(0, EMBED_DESC_MAX) || "\u200b";

  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setDescription(desc)
    .setFooter({ text: getFooterText(botName, model, useAiModule, timeStr, projectId) })
    .setTimestamp(new Date());
}


function setBuildEmbedsForAnswer({ askerDisplay, questionText, answerText, botName, model, useAiModule, timeStr, imageUrl, isDM, projectId }) {
  const qBlock = getBuildYamlQuestionBlock(askerDisplay, questionText);

  const baseMax = isDM ? DM_ANSWER_MAX : GUILD_ANSWER_MAX;
  const firstMax = Math.max(200, Math.min(baseMax, EMBED_DESC_MAX - qBlock.length - 2));
  const nextMax = Math.max(200, baseMax);

  const answerChunks = getChunkMarkdownFlex(String(answerText || ""), firstMax, nextMax);
  const embeds = [];

  for (let i = 0; i < answerChunks.length; i++) {
    const prefix = i === 0 ? qBlock : "";
    const joinedParts = [prefix, answerChunks[i]].filter(Boolean);

    if (getJoinLen(joinedParts) > EMBED_DESC_MAX) {
      const overhead = getJoinLen([prefix].filter(Boolean));
      const available = Math.max(200, Math.min(3900, EMBED_DESC_MAX - overhead - (overhead ? 2 : 0)));
      const split = getChunkMarkdownFlex(String(answerChunks[i] || ""), available, nextMax);
      answerChunks[i] = split[0] || "\u200b";
      if (split.length > 1) answerChunks.splice(i + 1, 0, ...split.slice(1));
      i--;
      continue;
    }

    if (i === 0) {
      embeds.push(getBuildPrimaryEmbed({
        askerDisplay,
        questionText,
        answerChunk: answerChunks[i],
        botName,
        model,
        useAiModule,
        timeStr,
        imageUrl,
        projectId
      }));
    } else {
      embeds.push(getBuildAnswerEmbed({
        answerChunk: answerChunks[i],
        botName,
        model,
        useAiModule,
        timeStr,
        projectId
      }));
    }
  }

  return embeds;
}


function getBuildReasoningEmbed({ chunk, partIndex, partCount, botName, model, useAiModule, timeStr }) {
  const title = partCount > 1 ? `Reasoning (${partIndex}/${partCount})` : "Reasoning";
  const desc = String(chunk || "").slice(0, EMBED_DESC_MAX) || "\u200b";

  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: getFooterText(botName, model, useAiModule, timeStr) })
    .setTimestamp(new Date());
}


function getReasoningThreadName(wo, askerDisplay) {
  const base = String(wo?.ReasoningThreadName || "").trim();
  if (base) return base.slice(0, 100);
  const who = String(askerDisplay || "").trim();
  const name = who ? `Reasoning - ${who}` : "Reasoning";
  return name.slice(0, 100);
}


async function setCanCreateMessageThread(client, channel) {
  try {
    const guild = channel?.guild;
    if (!guild) return false;
    const me = guild.members.me ?? await guild.members.fetch(client.user.id);
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    if (perms.has(PermissionFlagsBits.ManageThreads)) return true;
    return perms.has(PermissionFlagsBits.CreatePublicThreads) || perms.has(PermissionFlagsBits.CreatePrivateThreads);
  } catch {
    return false;
  }
}


async function setCreateReasoningMessageThread(client, channel, rootMessageId, threadName, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  if (!channel?.threads?.create) return null;

  const can = await setCanCreateMessageThread(client, channel);
  if (!can) {
    log(`Missing permission to create message thread in #${channel?.id || "-"}`, "warn");
    return null;
  }

  try {
    const th = await channel.threads.create({
      name: String(threadName || "Reasoning").slice(0, 100),
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
      startMessage: rootMessageId,
      reason: `${MODULE_NAME}: attach reasoning`
    });

    log(`Created message thread ${th?.id || "-"} for message ${rootMessageId}`, "info");

    return th;
  } catch (err) {
    log(`Failed to create message thread: ${err?.message || String(err)}`, "error");
    return null;
  }
}


async function setSendWebhookEmbeds(webhookClient, payloadBase, embeds) {
  let firstMsg = null;
  let lastMsg = null;
  let sent = 0;

  for (const e of (embeds || [])) {
    const msg = await webhookClient.send({ ...payloadBase, embeds: [e], wait: true });
    const hasWebhookId = !!msg?.webhookId || !!msg?.webhook_id;
    if (!hasWebhookId) throw new Error("send returned no webhookId (not a webhook post)");
    if (!firstMsg) firstMsg = msg;
    lastMsg = msg;
    sent++;
  }

  return { firstMsg, lastMsg, sent };
}


async function setSendReasoningEmbeds(webhookClient, payloadBase, reasoningText, meta) {
  const chunks = getReasoningThreadChunks(reasoningText, REASONING_DESC_TARGET);
  if (!chunks.length) return 0;

  let sent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const e = getBuildReasoningEmbed({
      chunk: chunks[i],
      partIndex: i + 1,
      partCount: chunks.length,
      botName: meta.botName,
      model: meta.model,
      useAiModule: meta.useAiModule,
      timeStr: meta.timeStr
    });

    const msg = await webhookClient.send({ ...payloadBase, embeds: [e], wait: true });
    const hasWebhookId = !!msg?.webhookId || !!msg?.webhook_id;
    if (!hasWebhookId) throw new Error("send returned no webhookId (not a webhook post)");
    sent++;
  }

  return sent;
}


async function setSendDirectEmbeds(channel, embeds) {
  let sent = 0;
  for (const e of (embeds || [])) {
    await channel.send({ embeds: [e] });
    sent++;
  }
  return sent;
}


async function setSendDirectReasoningEmbeds(channel, reasoningText, meta) {
  const chunks = getReasoningThreadChunks(reasoningText, REASONING_DESC_TARGET);
  if (!chunks.length) return 0;

  let sent = 0;
  for (let i = 0; i < chunks.length; i++) {
    const e = getBuildReasoningEmbed({
      chunk: chunks[i],
      partIndex: i + 1,
      partCount: chunks.length,
      botName: meta.botName,
      model: meta.model,
      useAiModule: meta.useAiModule,
      timeStr: meta.timeStr
    });
    await channel.send({ embeds: [e] });
    sent++;
  }

  return sent;
}


export default async function getDiscordTextOutput(coreData) {
  const wo = coreData.workingObject || {};
  const config = coreData.config || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const silence = (wo.modSilence || "[silence]").toString();
  const response = (typeof wo.response === "string" ? wo.response : "").trim();

  if (!response || response === silence) {
    log(!response ? "Missing response – nothing to send." : "Silence token – not sending.", "warn");
    return coreData;
  }

  const clientKey = wo.clientRef || (wo.refs && wo.refs.client);
  const client = clientKey ? await getItem(clientKey) : null;

  if (!client) {
    log("Discord client not available from registry", "error");
    return coreData;
  }

  const channelId = String(wo.channelID || "");
  if (!channelId) {
    log("Missing wo.channelID – cannot resolve channel.", "warn");
    return coreData;
  }

  const isDM =
    !!(wo.DM || wo.isDM || wo.channelType === 1 ||
      String(wo.channelType ?? "").toUpperCase() === "DM" ||
      (!wo.guildId && !!wo.userId));

  try {
    const baseMessage = wo.message;
    const baseChannel = baseMessage?.channel ?? (await client.channels.fetch(channelId));
    if (!baseChannel) throw new Error("Channel not found");

    const firstImage = (typeof wo.primaryImageUrl === "string" && wo.primaryImageUrl) ? wo.primaryImageUrl : getFirstImageUrlFromText(response);
    const questionRaw = getLikelyQuestion(wo);
    const askerDisplay = getAskerDisplay(wo, baseMessage);

    const model = String(wo.model || "");
    const useAiModule = String(wo.useAiModule || "");
    const timeStr = getLocalTimeString(new Date(), wo.timezone || "Europe/Berlin");
    const botNameRaw = (typeof wo.botName === "string" && wo.botName.trim()) ? wo.botName.trim() : "Bot";
    const reasoningText = getReasoningText(wo);
    const projectId = null;

    if (isDM) {
      const embeds = setBuildEmbedsForAnswer({
        askerDisplay,
        questionText: questionRaw,
        answerText: response,
        botName: botNameRaw,
        model,
        useAiModule,
        timeStr,
        imageUrl: firstImage,
        isDM: true,
        projectId
      });

      const sentEmbeds = await setSendDirectEmbeds(baseChannel, embeds);

      let sentReasoning = 0;
      if (reasoningText) {
        sentReasoning = await setSendDirectReasoningEmbeds(baseChannel, reasoningText, {
          botName: botNameRaw,
          model,
          useAiModule,
          timeStr
        });
      }

      log(`Sent ${sentEmbeds} DM embed message(s) and ${sentReasoning} reasoning embed message(s)`, "info");

      return coreData;
    }

    const desiredName = botNameRaw;
    const { webhookClient, threadId } =
      await setEnsureOwnChannelWebhookClient(client, { channel: baseChannel }, desiredName, wo);

    const avatarLookupId = getAvatarLookupId(baseChannel, threadId, channelId);
    const identity = await getResolvedIdentity(wo, config, avatarLookupId, client);

    const answerEmbeds = setBuildEmbedsForAnswer({
      askerDisplay,
      questionText: questionRaw,
      answerText: response,
      botName: identity.username,
      model,
      useAiModule,
      timeStr,
      imageUrl: firstImage,
      isDM: false,
      projectId
    });

    const answerPayloadBase = {
      username: identity.username,
      avatarURL: identity.avatarURL || undefined,
      threadId: threadId || undefined
    };

    const answerResult = await setSendWebhookEmbeds(webhookClient, answerPayloadBase, answerEmbeds);
    const rootMessageId = answerResult?.lastMsg?.id || answerResult?.firstMsg?.id || null;

    let sentReasoning = 0;

    if (reasoningText) {
      const inThreadAlready = !!threadId || getIsThreadChannel(baseChannel);

      if (inThreadAlready) {
        const tid = threadId || String(baseChannel?.id || "");
        const payloadBase = {
          username: identity.username,
          avatarURL: identity.avatarURL || undefined,
          threadId: tid || undefined
        };

        sentReasoning = await setSendReasoningEmbeds(webhookClient, payloadBase, reasoningText, {
          botName: identity.username,
          model,
          useAiModule,
          timeStr
        });

        log("Cannot create a message-thread inside an existing thread; posted reasoning in the current thread instead.", "warn");
      } else {
        const threadName = getReasoningThreadName(wo, askerDisplay);
        const th = rootMessageId
          ? await setCreateReasoningMessageThread(client, baseChannel, rootMessageId, threadName, wo)
          : null;

        if (th?.id) {
          const payloadBase = {
            username: identity.username,
            avatarURL: identity.avatarURL || undefined,
            threadId: th.id
          };

          sentReasoning = await setSendReasoningEmbeds(webhookClient, payloadBase, reasoningText, {
            botName: identity.username,
            model,
            useAiModule,
            timeStr
          });
        } else {
          sentReasoning = await setSendDirectReasoningEmbeds(baseChannel, reasoningText, {
            botName: identity.username,
            model,
            useAiModule,
            timeStr
          });

          log("Thread creation failed or not permitted; posted reasoning as direct follow-up in channel.", "warn");
        }
      }
    }

    log(`Sent ${answerResult.sent} embed(s) and ${sentReasoning} reasoning embed message(s) to channel ${baseChannel?.id || channelId} as "${identity.username}".`, "info");
  } catch (err) {
    log(`Failed to send Discord message: ${err?.message || String(err)}`, "error");
  }

  return coreData;
}
