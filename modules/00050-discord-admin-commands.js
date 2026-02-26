/**************************************************************
/* filename: "discord-admin-commands.js"                     *
/* Version 1.0                                               *
/* Purpose: Slash admin commands for "discord-admin" flow    *
/*          plus DM-only text commands for purge and DB      *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";
import { setPurgeContext, setFreezeContext } from "../core/context.js";

const MODULE_NAME = "discord-admin-commands";

/**************************************************************
/* functionSignature: getSleep (ms)                          *
/* Returns a promise that resolves after ms milliseconds     *
/**************************************************************/
function getSleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**************************************************************
/* functionSignature: getJitter (ms)                         *
/* Applies a ±10% jitter and floors to an integer            *
/**************************************************************/
function getJitter(ms) {
  return Math.max(0, Math.floor(ms * (0.9 + Math.random() * 0.2)));
}

/**************************************************************
/* functionSignature: getIsRateLimit (e)                     *
/* True if error indicates a Discord rate limit              *
/**************************************************************/
function getIsRateLimit(e) {
  return (
    e?.status === 429 ||
    e?.httpStatus === 429 ||
    e?.code === 20028 ||
    (typeof e?.message === "string" && e.message.toLowerCase().includes("rate limit"))
  );
}

/**************************************************************
/* functionSignature: getResolveClient (wo)                  *
/* Resolves the Discord client from the registry             *
/**************************************************************/
async function getResolveClient(wo) {
  const ref = wo?.clientRef || wo?.refs?.client || "discord:client";
  try {
    const client = await getItem(ref);
    return client || null;
  } catch {
    return null;
  }
}

/**************************************************************
/* functionSignature: getResolveChannelById (wo, channelId)  *
/* Resolves a channel by id using the client registry        *
/**************************************************************/
async function getResolveChannelById(wo, channelId) {
  const client = await getResolveClient(wo);
  if (!client?.channels?.fetch) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch {
    return null;
  }
}

/**************************************************************
/* functionSignature: getIsDMContext (wo)                    *
/* Determines whether the current context is a DM            *
/**************************************************************/
function getIsDMContext(wo) {
  return !!(wo?.DM || wo?.isDM || wo?.channelType === 1 ||
            String(wo?.channelType ?? "").toUpperCase() === "DM" ||
            (!wo?.guildId && (wo?.userId || wo?.userid)));
}

/**************************************************************
/* functionSignature: getParseBangPurgeCount (payload)       *
/* Parses "!purge [count]" and returns a positive integer    *
/**************************************************************/
function getParseBangPurgeCount(payload) {
  const s = String(payload || "");
  const m = /^!purge(?:\s+(\d+))?$/i.exec(s.trim());
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 100;
}

/**************************************************************
/* functionSignature: getIsBangPurgeDb (payload)             *
/* True if payload is exactly "!purgedb"                     *
/**************************************************************/
function getIsBangPurgeDb(payload) {
  const s = String(payload || "").trim();
  return /^!purgedb$/i.test(s);
}

/**************************************************************
/* functionSignature: setDeleteMessagesIndividually (items, log, ctx, opts) *
/* Deletes messages one-by-one with adaptive backoff         *
/**************************************************************/
async function setDeleteMessagesIndividually(items, log, ctx, opts = {}) {
  const {
    perDeleteDelayMsStart = 150,
    minDelayMs = 80,
    maxDelayMs = 2000,
    decayFactor = 0.9,
    growthFactor = 1.6
  } = opts;

  let perDelay = perDeleteDelayMsStart;
  let total = 0;

  for (const m of items) {
    if (!m || m.pinned) continue;
    try {
      await m.delete();
      total++;
      log("purge delete", "info", { moduleName: MODULE_NAME, ...ctx, id: m.id, author: m.author?.id || null });
      perDelay = Math.max(minDelayMs, Math.floor(perDelay * decayFactor));
    } catch (e) {
      if (getIsRateLimit(e)) {
        const retryAfterSec =
          e?.retry_after ?? e?.data?.retry_after ?? e?.rawError?.retry_after ?? e?.raw?.retry_after ?? null;
        perDelay = Math.min(maxDelayMs, Math.floor(perDelay * growthFactor));
        const extra = retryAfterSec ? Math.ceil(Number(retryAfterSec) * 1000) : 0;
        const pause = getJitter(Math.max(perDelay, extra));
        log("rate limit backoff", "warn", { moduleName: MODULE_NAME, ...ctx, id: m?.id, retryAfterMs: extra || null, nextDelayMs: perDelay });
        await getSleep(pause);
        try {
          await m.delete();
          total++;
          log("purge delete (after backoff)", "info", { moduleName: MODULE_NAME, ...ctx, id: m.id });
          perDelay = Math.max(minDelayMs, Math.floor(perDelay * decayFactor));
        } catch (e2) {
          log("delete failed after backoff", "warn", { moduleName: MODULE_NAME, ...ctx, id: m.id, reason: e2?.message || String(e2) });
        }
      } else {
        log("delete failed", "warn", { moduleName: MODULE_NAME, ...ctx, id: m?.id, reason: e?.message || String(e) });
      }
    }
    await getSleep(getJitter(perDelay));
  }
  return total;
}

/**************************************************************
/* functionSignature: setPurgeLastN (channel, log, o)        *
/* Deletes exactly the last N messages, newest first         *
/**************************************************************/
async function setPurgeLastN(channel, log, { maxTotal }) {
  const ctx = { guildId: channel?.guild?.id || null, channelId: channel?.id || null };
  let remaining = Number.isFinite(maxTotal) && maxTotal > 0 ? Math.floor(maxTotal) : Infinity;
  let totalDeleted = 0;

  if (!channel?.messages?.fetch) throw new Error("Channel does not support messages.fetch()");

  if (Number.isFinite(remaining) && remaining > 0 && remaining <= 100) {
    try {
      const res = await channel.bulkDelete(remaining, true);
      const bulkDeleted = res?.size ?? 0;
      totalDeleted += bulkDeleted;
      remaining -= bulkDeleted;
      const requested = remaining + bulkDeleted;
      log("bulk delete try", "info", { moduleName: MODULE_NAME, ...ctx, requested, deleted: bulkDeleted });
    } catch (e) {
      log("bulk delete failed (fallback to manual)", "warn", { moduleName: MODULE_NAME, ...ctx, reason: e?.message || String(e) });
    }
  }

  let beforeId = undefined;
  const fetchBatch = 100;
  const perDeleteDelayMsStart = 150;
  const maxRounds = 1000;
  const startedAt = Date.now();
  const maxMillis = 10 * 60 * 1000;

  for (let round = 0; remaining > 0 && round < maxRounds; round++) {
    if (Date.now() - startedAt > maxMillis) {
      log("purge watchdog timeout", "warn", { moduleName: MODULE_NAME, ...ctx, totalDeletedSoFar: totalDeleted, remaining });
      break;
    }

    const batch = await channel.messages
      .fetch({ limit: fetchBatch, ...(beforeId ? { before: beforeId } : {}) })
      .catch(e => {
        log("fetch failed", "error", { moduleName: MODULE_NAME, ...ctx, reason: e?.message || String(e) });
        return null;
      });

    const items = batch ? Array.from(batch.values()) : [];
    if (!items.length) {
      log("no more messages", "info", { moduleName: MODULE_NAME, ...ctx, totalDeleted, remaining });
      break;
    }

    const candidates = items
      .filter(m => !m.pinned)
      .slice(0, Number.isFinite(remaining) ? remaining : undefined);

    const add = await setDeleteMessagesIndividually(candidates, log, ctx, { perDeleteDelayMsStart });
    totalDeleted += add;
    if (Number.isFinite(remaining)) remaining -= add;

    const oldest = items[items.length - 1];
    const prev = beforeId;
    beforeId = oldest?.id;
    if (beforeId && prev && beforeId === prev) {
      log("stall detected (beforeId unchanged)", "warn", { moduleName: MODULE_NAME, ...ctx, beforeId });
      break;
    }
  }

  log("purge done (last N)", "info", { moduleName: MODULE_NAME, ...ctx, requested: maxTotal, deleted: totalDeleted, remaining: Math.max(0, remaining) });
  return totalDeleted;
}

/**************************************************************
/* functionSignature: setPurgeDmDb (wo, payload, log)        *
/* Handles "!purgedb" in current DM channel                  *
/**************************************************************/
async function setPurgeDmDb(wo, payload, log) {
  if (!getIsDMContext(wo)) return false;
  if (!getIsBangPurgeDb(payload)) return false;

  const channelId = String(wo?.channelID || wo?.id || wo?.message?.channelId || "");
  if (!channelId) {
    wo.response = "STOP";
    wo.stop = true;
    return true;
  }

  const deleted = await setPurgeContext({ ...wo, id: channelId });
  log("db purge done (DM)", "info", { moduleName: MODULE_NAME, channelId, deleted });

  wo.response = "STOP";
  wo.stop = true;
  return true;
}

/**************************************************************
/* functionSignature: setPurgeDmBotMessages (wo, payload, log) *
/* Handles "!purge [count]" in current DM channel            *
/**************************************************************/
async function setPurgeDmBotMessages(wo, payload, log) {
  if (!getIsDMContext(wo)) return false;
  const count = getParseBangPurgeCount(payload);
  if (count === null) return false;

  const client = await getResolveClient(wo);
  const channelId = String(wo?.channelID || wo?.id || wo?.message?.channelId || "");
  if (!client || !channelId) {
    wo.response = "STOP";
    wo.stop = true;
    return true;
  }

  const channel = (wo?.message?.channel && wo?.message?.channel?.messages?.fetch)
    ? wo.message.channel
    : await getResolveChannelById(wo, channelId);

  if (!channel?.messages?.fetch || !client?.user?.id) {
    wo.response = "STOP";
    wo.stop = true;
    return true;
  }

  const ctx = { guildId: null, channelId };
  let remaining = Math.min(Math.max(1, count), 500);
  let totalDeleted = 0;
  let beforeId = undefined;

  while (remaining > 0) {
    const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
    const items = batch ? Array.from(batch.values()) : [];
    if (!items.length) break;

    const mine = items.filter(m => m.author?.id === client.user.id);
    const slice = mine.slice(0, remaining);

    const add = await setDeleteMessagesIndividually(slice, log, ctx, { perDeleteDelayMsStart: 120 });
    totalDeleted += add;
    remaining -= add;

    const oldest = items[items.length - 1];
    beforeId = oldest?.id;
    if (!beforeId) break;
  }

  log("dm purge done", "info", { moduleName: MODULE_NAME, ...ctx, deleted: totalDeleted });

  wo.response = "STOP";
  wo.stop = true;
  return true;
}

/**************************************************************
/* functionSignature: getDiscordAdminCommands (coreData)     *
/* Handles /purge, /error, /purgedb, /freeze and DM text cmds*
/**************************************************************/
export default async function getDiscordAdminCommands(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const payload = typeof wo?.payload === "string" ? wo.payload.trim() : "";
  const flow = String(wo?.flow || "");

  if (flow === "discord" && payload) {
    if (await setPurgeDmDb(wo, payload, log)) return coreData;
    if (await setPurgeDmBotMessages(wo, payload, log)) return coreData;
  }

  try {
    if (wo?.flow !== "discord-admin") return coreData;

    const cmd = String(wo?.admin?.command || "").toLowerCase();
    if (cmd !== "purge" && cmd !== "error" && cmd !== "purgedb" && cmd !== "freeze") {
      return coreData;
    }

    if (cmd === "error") {
      throw new Error("Simulated error via /error");
    }

    if (cmd === "purgedb") {
      const targetChannelId = String(wo?.admin?.channelId || wo?.channelID || wo?.id || "");
      if (!targetChannelId) {
        log("db purge failed", "error", { moduleName: MODULE_NAME, reason: "missing channel id" });
        wo.response = "";
        return coreData;
      }

      const purgeWO = { ...wo, id: targetChannelId };
      const deleted = await setPurgeContext(purgeWO);
      log("db purge done", "info", { moduleName: MODULE_NAME, channelId: targetChannelId, deleted });
      wo.response = "";
      return coreData;
    }

    if (cmd === "freeze") {
      const targetChannelId = String(wo?.admin?.channelId || wo?.channelID || wo?.id || "");
      if (!targetChannelId) {
        log("freeze failed", "error", { moduleName: MODULE_NAME, reason: "missing channel id" });
        wo.response = "";
        return coreData;
      }

      const freezeWO = { ...wo, id: targetChannelId };
      const updated = await setFreezeContext(freezeWO);
      log("freeze done", "info", { moduleName: MODULE_NAME, channelId: targetChannelId, updated });
      wo.response = "";
      return coreData;
    }

    const channelId = String(wo?.admin?.channelId || wo?.channelID || wo?.id || "");
    const channel = await getResolveChannelById(wo, channelId);
    if (!channel) {
      log("slash admin command failed", "error", { moduleName: MODULE_NAME, reason: "could not resolve channel" });
      wo.response = "";
      return coreData;
    }

    const countOpt = wo?.admin?.options?.count;
    const parsed   = Number(countOpt);
    const maxTotal = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Infinity;

    if (Number.isFinite(maxTotal)) {
      await setPurgeLastN(channel, log, { maxTotal });
    } else {
      await setPurgeLastN(channel, log, { maxTotal: 100 });
    }

    wo.response = "";
    return coreData;

  } catch (e) {
    log("slash admin command failed", "error", { moduleName: MODULE_NAME, reason: e?.message || String(e) });
    wo.response = "";
    return coreData;
  }
}
