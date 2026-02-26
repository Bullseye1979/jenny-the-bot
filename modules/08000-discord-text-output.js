/********************************************************************************
/* filename: "discord-text-output.js"                                           *
/* Version 1.0                                                                  *
/* Purpose: Single-embed reply that shows the entire question as a Markdown     *
/*          code block above the answer. Works in DMs (direct send) and guilds  *
/*          (via webhook).                                                     *
/*          If wo.reasoningSummary exists, attach it as a Discord message       *
/*          thread created from the LAST answer embed message (Create Thread on *
/*          message). Preserves fenced code blocks across embed splits.         *
/********************************************************************************/

import { EmbedBuilder, PermissionFlagsBits, WebhookClient } from "discord.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "discord-text-output";
const COLOR_PRIMARY = 0x22C55E;

const EMBED_DESC_MAX = 4096;
const DM_ANSWER_MAX = 1900;
const GUILD_ANSWER_MAX = 3500;

const REASONING_DESC_TARGET = 3900;
const THREAD_AUTO_ARCHIVE_MINUTES = 60;

/********************************************************************************
/* functionSignature: getIsLikelyImageUrl (url)                                 *
/* Returns true if the URL likely points to an image.                           *
/********************************************************************************/
function getIsLikelyImageUrl(url) {
  const u = String(url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || /\/documents\//.test(u);
}

/********************************************************************************
/* functionSignature: getFirstImageUrlFromText (text)                           *
/* Extracts the first image-like URL from a text string.                        *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getWithCachebuster (url)                                  *
/* Appends a cache-busting query parameter to a URL.                            *
/********************************************************************************/
function getWithCachebuster(url) {
  if (!url) return url;
  const cb = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${url}${url.includes("?") ? "&" : "?"}cb=${cb}`;
}

/********************************************************************************
/* functionSignature: getModuleConfigBaseURL (config)                           *
/* Resolves the module baseURL from config.                                     *
/********************************************************************************/
function getModuleConfigBaseURL(config) {
  const a = config?.["discord-text-output"];
  const b = config?.["discord_text-output"];
  return (a && a.baseURL) || (b && b.baseURL) || null;
}

/********************************************************************************
/* functionSignature: getIsThreadChannel (ch)                                   *
/* Checks whether a channel is a thread.                                        *
/********************************************************************************/
function getIsThreadChannel(ch) {
  return ch?.isThread?.() === true;
}

/********************************************************************************
/* functionSignature: getIsChannelWebhook (h)                                   *
/* Checks whether a webhook is a channel webhook.                               *
/********************************************************************************/
function getIsChannelWebhook(h) {
  return Number(h?.type) === 1 || String(h?.type) === "Incoming";
}

/********************************************************************************
/* functionSignature: getUrlExists (url, timeoutMs)                             *
/* Verifies remote URL availability with HEAD/GET.                              *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: setEnsureOwnChannelWebhookClient (client, message, name, wo) *
/* Ensures a usable channel webhook and returns its client.                     *
/********************************************************************************/
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

  return { webhookClient, threadId };
}

/********************************************************************************
/* functionSignature: getAvatarLookupId (baseChannel, threadId, fallbackId)     *
/* Returns an id to use for avatar lookup (parent channel when in thread).      *
/********************************************************************************/
function getAvatarLookupId(baseChannel, threadId, fallbackId) {
  if (threadId) {
    const pid = baseChannel?.parentId || baseChannel?.parent?.id || null;
    return String(pid || baseChannel?.id || fallbackId || "");
  }
  return String(baseChannel?.id || fallbackId || "");
}

/********************************************************************************
/* functionSignature: getResolvedIdentity (wo, config, channelId, client)       *
/* Resolves username and avatar URL for webhook identity.                       *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getAskerDisplay (wo, baseMessage)                         *
/* Resolves a human name for the asker without raw IDs.                         *
/********************************************************************************/
function getAskerDisplay(wo, baseMessage) {
  const nameCandidates = [
    "UserDisplayName", "userDisplayName", "DisplayName", "displayName",
    "Username", "username", "UserName", "userName", "User", "user", "Author", "author"
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

/********************************************************************************
/* functionSignature: getLikelyQuestion (wo)                                    *
/* Returns wo.payload as the question (entire payload).                         *
/********************************************************************************/
function getLikelyQuestion(wo) {
  const v = wo?.payload;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  try { return String(v).trim(); } catch { return ""; }
}

/********************************************************************************
/* functionSignature: getLocalTimeString (date, tz)                             *
/* Formats a local time string for the given timezone.                          *
/********************************************************************************/
function getLocalTimeString(date, tz) {
  try {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz || "Europe/Berlin" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
}

/********************************************************************************
/* functionSignature: getBuildYamlQuestionBlock (name, text)                    *
/* Builds a YAML code block: first line highlights the name.                    *
/********************************************************************************/
function getBuildYamlQuestionBlock(name, text) {
  const display = String(name || "").trim();
  const norm = String(text || "").replace(/\r\n?/g, "\n");
  const lines = norm.split("\n").map(l => `  ${l || ""}`).join("\n");
  const header = display ? `${display}: \n\n` : "";
  const body = `${header}${lines}`.trimEnd();
  return "```yaml\n" + body + "\n```";
}

/********************************************************************************
/* functionSignature: getStripInvis (s)                                         *
/* Removes zero-width and normalizes whitespace artifacts.                      *
/********************************************************************************/
function getStripInvis(s) {
  return String(s || "")
    .replace(/\u200B/g, "")
    .replace(/\u200C/g, "")
    .replace(/\u200D/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ");
}

/********************************************************************************
/* functionSignature: getNormalizeReasoningText (text)                          *
/* Removes provider artifacts and improves readability.                         *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getFenceOpenMeta (line)                                   *
/* Returns { fence, fenceLine } if an opening fence is found.                   *
/********************************************************************************/
function getFenceOpenMeta(line) {
  const s = String(line || "");
  const m = /^\s*(```|~~~)\s*([A-Za-z0-9_-]+)?\s*$/.exec(s);
  if (!m) return null;
  const fence = m[1];
  const lang = (m[2] || "").trim();
  const fenceLine = lang ? `${fence}${lang}` : `${fence}`;
  return { fence, fenceLine };
}

/********************************************************************************
/* functionSignature: getIsFenceCloseLine (line, fence)                         *
/* Returns true if line closes the currently open fence.                        *
/********************************************************************************/
function getIsFenceCloseLine(line, fence) {
  if (!fence) return false;
  const s = String(line || "");
  const esc = fence.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`^\\s*${esc}\\s*$`).test(s);
}

/********************************************************************************
/* functionSignature: getChunkMarkdownFlex (str, firstMax, nextMax)             *
/* Chunks markdown while preserving fenced code blocks.                         *
/********************************************************************************/
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

  /********************************************************************************
  /* functionSignature: getCurrMax ()                                             *
  /* Returns the active max length for the current chunk.                         *
  /********************************************************************************/
  function getCurrMax() {
    return chunks.length === 0 ? fMax : nMax;
  }

  /********************************************************************************
  /* functionSignature: pushChunk (s)                                             *
  /* Pushes a completed chunk, ensuring it is non-empty for Discord.              *
  /********************************************************************************/
  function pushChunk(s) {
    const out = String(s || "").replace(/\s+$/g, "");
    chunks.push(out.length ? out : "\u200b");
  }

  /********************************************************************************
  /* functionSignature: closeFenceIfNeeded ()                                     *
  /* Closes any currently open fence in the buffer.                               *
  /********************************************************************************/
  function closeFenceIfNeeded() {
    if (!activeFence) return;
    if (!buf.endsWith("\n")) buf += "\n";
    buf += `${activeFence}\n`;
  }

  /********************************************************************************
  /* functionSignature: startNewChunk ()                                          *
  /* Starts a new chunk and re-opens the active fence if needed.                  *
  /********************************************************************************/
  function startNewChunk() {
    buf = "";
    if (activeFence && activeFenceLine) buf += `${activeFenceLine}\n`;
  }

  /********************************************************************************
  /* functionSignature: appendPiece (piece)                                       *
  /* Appends text to the current chunk while respecting max length and fences.    *
  /********************************************************************************/
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

/********************************************************************************
/* functionSignature: getTextFromAny (x)                                        *
/* Extracts text from various structures (string/array/object).                 *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getReasoningText (wo)                                     *
/* Returns reasoningSummary as a normalized string.                             *
/********************************************************************************/
function getReasoningText(wo) {
  const v = wo?.reasoningSummary;
  if (v == null) return "";
  if (typeof v === "string") return getNormalizeReasoningText(v);
  return getNormalizeReasoningText(getTextFromAny(v).trim());
}

/********************************************************************************
/* functionSignature: getIsBoldHeadlineLine (line)                              *
/* Returns true if the line is a bold headline.                                 *
/********************************************************************************/
function getIsBoldHeadlineLine(line) {
  return /^\s*\*\*.+?\*\*\s*$/.test(String(line || ""));
}

/********************************************************************************
/* functionSignature: getSplitByBoldHeadlines (text)                            *
/* Splits text into segments starting at bold headline lines.                   *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getPackSegmentsToChunksMarkdown (segments, maxLen)        *
/* Packs segments into chunks; preserves fenced code blocks.                    *
/********************************************************************************/
function getPackSegmentsToChunksMarkdown(segments, maxLen) {
  const max = Math.max(400, Math.min(3900, Number(maxLen) || REASONING_DESC_TARGET));
  const out = [];
  let cur = "";

  /********************************************************************************
  /* functionSignature: pushCur ()                                                *
  /* Pushes the current accumulator into output and resets it.                    *
  /********************************************************************************/
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

/********************************************************************************
/* functionSignature: getNormalizeReasoningForThread (text)                     *
/* Produces reasoning suitable for thread embeds.                               *
/********************************************************************************/
function getNormalizeReasoningForThread(text) {
  const norm = getNormalizeReasoningText(text);
  if (!norm) return "";
  return norm.replace(/\n{3,}/g, "\n\n").trim();
}

/********************************************************************************
/* functionSignature: getReasoningThreadChunks (text, maxLen)                   *
/* Returns reasoning chunks, prioritizing splits on headlines.                  *
/********************************************************************************/
function getReasoningThreadChunks(text, maxLen = REASONING_DESC_TARGET) {
  const norm = getNormalizeReasoningForThread(text);
  if (!norm) return [];

  const segments = getSplitByBoldHeadlines(norm);
  if (segments.length) return getPackSegmentsToChunksMarkdown(segments, maxLen);

  return getChunkMarkdownFlex(norm, maxLen, maxLen);
}

/********************************************************************************
/* functionSignature: getJoinLen (parts)                                        *
/* Returns the joined length with "\n\n" separators.                            *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getFooterText (botName, model, useAiModule, timeStr)      *
/* Builds a consistent embed footer text.                                       *
/********************************************************************************/
function getFooterText(botName, model, useAiModule, timeStr) {
  return `${botName} (${model || "-"} / ${useAiModule || "-"}) - ${timeStr}`;
}

/********************************************************************************
/* functionSignature: getBuildPrimaryEmbed (params)                             *
/* Builds the main embed with question block + answer chunk.                    *
/********************************************************************************/
function getBuildPrimaryEmbed({ askerDisplay, questionText, answerChunk, botName, model, useAiModule, timeStr, imageUrl }) {
  const qBlock = getBuildYamlQuestionBlock(askerDisplay, questionText);
  const joined = [qBlock, String(answerChunk || "")].filter(Boolean).join("\n\n") || "\u200b";
  const desc = joined.slice(0, EMBED_DESC_MAX) || "\u200b";

  const e = new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setDescription(desc)
    .setFooter({ text: getFooterText(botName, model, useAiModule, timeStr) })
    .setTimestamp(new Date());

  if (imageUrl) e.setImage(getWithCachebuster(imageUrl));
  return e;
}

/********************************************************************************
/* functionSignature: getBuildAnswerEmbed (params)                              *
/* Builds additional answer-only embeds for overflow.                           *
/********************************************************************************/
function getBuildAnswerEmbed({ answerChunk, botName, model, useAiModule, timeStr }) {
  const desc = String(answerChunk || "").slice(0, EMBED_DESC_MAX) || "\u200b";

  return new EmbedBuilder()
    .setColor(COLOR_PRIMARY)
    .setDescription(desc)
    .setFooter({ text: getFooterText(botName, model, useAiModule, timeStr) })
    .setTimestamp(new Date());
}

/********************************************************************************
/* functionSignature: setBuildEmbedsForAnswer (params)                          *
/* Creates embeds for answer; preserves fenced code blocks.                     *
/********************************************************************************/
function setBuildEmbedsForAnswer({ askerDisplay, questionText, answerText, botName, model, useAiModule, timeStr, imageUrl, isDM }) {
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
        imageUrl
      }));
    } else {
      embeds.push(getBuildAnswerEmbed({
        answerChunk: answerChunks[i],
        botName,
        model,
        useAiModule,
        timeStr
      }));
    }
  }

  return embeds;
}

/********************************************************************************
/* functionSignature: getBuildReasoningEmbed (params)                           *
/* Builds a reasoning embed for thread posting.                                 *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getReasoningThreadName (wo, askerDisplay)                 *
/* Builds a safe thread name for the reasoning thread.                          *
/********************************************************************************/
function getReasoningThreadName(wo, askerDisplay) {
  const base = String(wo?.ReasoningThreadName || "").trim();
  if (base) return base.slice(0, 100);
  const who = String(askerDisplay || "").trim();
  const name = who ? `Reasoning - ${who}` : "Reasoning";
  return name.slice(0, 100);
}

/********************************************************************************
/* functionSignature: setCanCreateMessageThread (client, channel)               *
/* Returns true if the bot likely can create a message thread.                  *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: setCreateReasoningMessageThread (client, channel, msgId, name, wo) *
/* Creates a Discord message-thread from a root message id.                     *
/********************************************************************************/
async function setCreateReasoningMessageThread(client, channel, rootMessageId, threadName, wo) {
  if (!channel?.threads?.create) return null;

  const can = await setCanCreateMessageThread(client, channel);
  if (!can) {
    (wo.logging ||= []).push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Missing permission to create message thread in #${channel?.id || "-"}`
    });
    return null;
  }

  try {
    const th = await channel.threads.create({
      name: String(threadName || "Reasoning").slice(0, 100),
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
      startMessage: rootMessageId,
      reason: `${MODULE_NAME}: attach reasoning`
    });

    (wo.logging ||= []).push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Created message thread ${th?.id || "-"} for message ${rootMessageId}`
    });

    return th;
  } catch (err) {
    (wo.logging ||= []).push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Failed to create message thread: ${err?.message || String(err)}`
    });
    return null;
  }
}

/********************************************************************************
/* functionSignature: setSendWebhookEmbeds (webhookClient, payloadBase, embeds) *
/* Sends embeds via webhook and verifies webhookId. Returns first/last message. *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: setSendReasoningEmbeds (webhookClient, payloadBase, text, meta) *
/* Sends reasoning chunks as embeds into a target thread.                       *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: setSendDirectEmbeds (channel, embeds)                     *
/* Sends embeds directly to a channel (DM path).                                *
/********************************************************************************/
async function setSendDirectEmbeds(channel, embeds) {
  let sent = 0;
  for (const e of (embeds || [])) {
    await channel.send({ embeds: [e] });
    sent++;
  }
  return sent;
}

/********************************************************************************
/* functionSignature: setSendDirectReasoningEmbeds (channel, reasoningText, meta) *
/* Sends reasoning embeds directly to a channel (DM path).                      *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getDiscordTextOutput (coreData)                           *
/* Sends embed responses; webhook in guilds and DMs direct.                      *
/********************************************************************************/
export default async function getDiscordTextOutput(coreData) {
  const wo = coreData.workingObject || {};
  const config = coreData.config || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const silence = (wo.modSilence || "[silence]").toString();
  const response = (typeof wo.response === "string" ? wo.response : "").trim();

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
    const questionRaw = getLikelyQuestion(wo);
    const askerDisplay = getAskerDisplay(wo, baseMessage);

    const model = String(wo.model || wo.model || "");
    const useAiModule = String(wo.useAiModule || wo.useAiModule || "");
    const timeStr = getLocalTimeString(new Date(), wo.timezone || "Europe/Berlin");
    const botNameRaw = (typeof wo.botName === "string" && wo.botName.trim()) ? wo.botName.trim() : "Bot";
    const reasoningText = getReasoningText(wo);

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
        isDM: true
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

      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Sent ${sentEmbeds} DM embed message(s) and ${sentReasoning} reasoning embed message(s)`
      });

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
      isDM: false
    });

    const answerPayloadBase = {
      username: identity.username,
      avatarURL: identity.avatarURL || undefined,
      threadId: threadId || undefined
    };

    const answerResult = await setSendWebhookEmbeds(webhookClient, answerPayloadBase, answerEmbeds);
    const rootMessageId = answerResult?.lastMsg?.id || answerResult?.firstMsg?.id || null;

    let sentReasoning = 0;

    if (reasoningText && rootMessageId) {
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

        (wo.logging ||= []).push({
          timestamp: new Date().toISOString(),
          severity: "warn",
          module: MODULE_NAME,
          exitStatus: "skipped",
          message: "Cannot create a message-thread inside an existing thread; posted reasoning in the current thread instead."
        });
      } else {
        const threadName = getReasoningThreadName(wo, askerDisplay);
        const th = await setCreateReasoningMessageThread(client, baseChannel, rootMessageId, threadName, wo);

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
        }
      }
    }

    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Sent ${answerResult.sent} embed(s) and ${sentReasoning} reasoning embed message(s) to channel ${baseChannel?.id || channelId} as "${identity.username}".`
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
