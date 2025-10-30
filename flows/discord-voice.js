/********************************************************************************
/* filename: "discord-voice.js"                                                 *
/* Version 1.0                                                                  *
/* Purpose: Listen for discord-voice registry sessions and attach handlers that *
/*          debounce speaking-start events, seed workingObject (incl. turn_id), *
/*          and trigger the "discord-voice" flow.                               *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import { entersState, VoiceConnectionStatus } from "@discordjs/voice";
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-voice";
const BOUND = new WeakSet();
const PENDING = new Map();
const PENDING_MS = 1200;
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);

/********************************************************************************
/* functionSignature: getUlidEncodeTime (ms)                                    *
/* Encodes a millisecond timestamp into 10 base32 chars                         *
/********************************************************************************/
function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = CROCK[Number(x % 32n)]; x = x / 32n; }
  return out.join("");
}

/********************************************************************************
/* functionSignature: getUlidEncodeRandom80ToBase32 (rand)                      *
/* Encodes 80 random bits into 16 base32 chars                                  *
/********************************************************************************/
function getUlidEncodeRandom80ToBase32(rand) {
  const out = [];
  let acc = 0, bits = 0, i = 0;
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) { acc = (acc << 8) | rand[i++]; bits += 8; }
    else { const v = (acc >> (bits - 5)) & 31; bits -= 5; out.push(CROCK[v]); }
  }
  return out.slice(0, 16).join("");
}

/********************************************************************************
/* functionSignature: getUlidRandom80 ()                                        *
/* Produces 80 random bits as Uint8Array(10)                                    *
/********************************************************************************/
function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

/********************************************************************************
/* functionSignature: getNewUlid ()                                             *
/* Generates a 26-character monotonic ULID                                      *
/********************************************************************************/
function getNewUlid() {
  const now = Date.now();
  let rand = getUlidRandom80();
  if (now === __ulid_lastTime) {
    for (let i = 9; i >= 0; i--) {
      if (__ulid_lastRand[i] === 255) { __ulid_lastRand[i] = 0; continue; }
      __ulid_lastRand[i]++; break;
    }
    rand = __ulid_lastRand;
  } else {
    __ulid_lastTime = now;
    __ulid_lastRand = rand;
  }
  return getUlidEncodeTime(now) + getUlidEncodeRandom80ToBase32(rand);
}

/********************************************************************************
/* functionSignature: getIsPending (key)                                        *
/* True if a short pending lock is active for the given key                     *
/********************************************************************************/
function getIsPending(key) {
  const t = PENDING.get(key) || 0;
  const ok = Date.now() - t < PENDING_MS;
  if (!ok) PENDING.delete(key);
  return ok;
}

/********************************************************************************
/* functionSignature: setPendingLock (key)                                      *
/* Sets a short pending lock timestamp for the given key                        *
/********************************************************************************/
function setPendingLock(key) {
  PENDING.set(key, Date.now());
}

/********************************************************************************
/* functionSignature: getResolveDisplayName (userLike)                           *
/* Derives a display name from a Discord user/member object                     *
/********************************************************************************/
function getResolveDisplayName(u) {
  if (!u) return "Unknown";
  if (u.nickname) return u.nickname;
  if (u.displayName) return u.displayName;
  const x = u.user || u;
  return x?.globalName || x?.username || "Unknown";
}

/********************************************************************************
/* functionSignature: getResolveSpeakerName (client, guildId, userId)           *
/* Fetches and resolves a speaker name using the Discord API                    *
/********************************************************************************/
async function getResolveSpeakerName(client, guildId, userId) {
  try {
    const g = await client.guilds.fetch(guildId);
    const m = await g.members.fetch(userId).catch(() => null);
    const u = m?.user || m;
    return getResolveDisplayName(u) || "Unknown";
  } catch {
    return "Unknown";
  }
}

/********************************************************************************
/* functionSignature: setMergeDynamicWO (src, dst)                               *
/* Merges dynamic fields from src into dst excluding a denylist                 *
/********************************************************************************/
function setMergeDynamicWO(src, dst) {
  const deny = new Set([
    "message","payload","Response","logging",
    "voiceIntent","flow","source","id","guildId","clientRef",
    "voiceSessionRef","userid","userId","channelallowed",
    "config"
  ]);
  for (const [k, v] of Object.entries(src || {})) {
    if (!deny.has(k)) dst[k] = v;
  }
}

/********************************************************************************
/* functionSignature: setAttachToSession (baseCore, sessionKey, session, cfg, runFlow, createRunCore, log) *
/* Attaches speaking.start handler to a single voice session                     *
/********************************************************************************/
async function setAttachToSession(baseCore, sessionKey, session, cfg, runFlow, createRunCore, log) {
  try {
    await entersState(session.connection, VoiceConnectionStatus.Ready, 10000);
  } catch (e) {
    log("voice not ready", "warn", { moduleName: MODULE_NAME, sessionKey, error: e?.message });
    return;
  }
  const connection = session.connection;
  try { connection.setMaxListeners?.(0); } catch {}
  const receiver = connection?.receiver;
  if (!receiver) { log("missing receiver", "error", { moduleName: MODULE_NAME, sessionKey }); return; }
  if (BOUND.has(receiver)) return;
  BOUND.add(receiver);
  try { receiver.speaking?.setMaxListeners?.(0); } catch {}
  receiver.speaking?.removeAllListeners?.("start");
  const guildId = session.guildId || null;
  const voiceChannelId = session.voiceChannelId ?? (session.channelId && session.channelIdType === "voice" ? session.channelId : null) ?? null;
  const textChannelId = session.textChannelId ?? (session.message && session.message.channelId) ?? (session.channelId && session.channelIdType === "text" ? session.channelId : null) ?? null;
  const clientRef = session.clientRef || "discord:client";
  const client = await getItem(clientRef);
  receiver.speaking?.on?.("start", async (uidLike) => {
    try {
      let userId = null;
      if (typeof uidLike === "string" || typeof uidLike === "number") userId = String(uidLike);
      else if (uidLike && typeof uidLike === "object") userId = uidLike.id || uidLike.userId || uidLike.user_id || null;
      if (!userId) {
        try {
          const keys = [...(receiver.speaking?.users?.keys?.() || [])];
          userId = keys[keys.length - 1] ? String(keys[keys.length - 1]) : null;
        } catch {}
      }
      if (!userId) return;
      if (client?.user?.id && userId === client.user.id) return;
      const activeKey = `discord-voice:active:${sessionKey}:${userId}`;
      if (getIsPending(activeKey)) {
        log("skip trigger (pending short lock)", "info", { moduleName: MODULE_NAME, sessionKey, userId });
        return;
      }
      const active = await getItem(activeKey);
      if (active) {
        log("skip trigger (active capture in progress)", "info", { moduleName: MODULE_NAME, sessionKey, userId });
        return;
      }
      setPendingLock(activeKey);
      let speaker = "Unknown";
      if (client && guildId) {
        try { speaker = await getResolveSpeakerName(client, guildId, userId); } catch {}
      }
      const liveWO = baseCore?.workingObject || {};
      const useVoice = !!liveWO.useVoiceChannel;
      const targetId = useVoice ? (voiceChannelId || textChannelId || null) : (textChannelId || voiceChannelId || null);
      const rc = createRunCore();
      const wo = rc.workingObject;
      if (Object.prototype.hasOwnProperty.call(wo, "message")) delete wo.message;
      setMergeDynamicWO(liveWO, wo);
      wo.turn_id = getNewUlid();
      wo.flow = "discord-voice";
      wo.source = "discord";
      wo.voiceSessionRef = sessionKey;
      if (guildId) wo.guildId = guildId;
      if (targetId) wo.id = String(targetId);
      wo.clientRef = clientRef;
      wo.config = cfg;
      wo.userid = String(userId);
      wo.userId = String(userId);
      wo.channelallowed = true;
      wo.authorDisplayname = speaker;
      wo.voiceIntent = { action: "describe_and_transcribe", userId: String(userId) };
      wo.timestamp = new Date().toISOString();
      log("voice trigger (debounced)", "info", {
        moduleName: MODULE_NAME,
        sessionKey,
        userId,
        postChannelId: wo.id || null,
        useVoiceChannel: !!wo.useVoiceChannel,
        textChannelId,
        voiceChannelId
      });
      await runFlow("discord-voice", rc);
    } catch (e) {
      log("start-handler error", "error", { moduleName: MODULE_NAME, error: e?.message });
    }
  });
  if (!session._stateListenerBound) {
    session._stateListenerBound = true;
    connection.on?.("stateChange", () => {
      BOUND.delete(receiver);
    });
  }
  log("voice priming attached", "info", {
    moduleName: MODULE_NAME,
    sessionKey,
    guildId: session.guildId || null,
    textChannelId,
    voiceChannelId,
    receiverBound: Boolean(receiver)
  });
}

/********************************************************************************
/* functionSignature: getDiscordVoiceFlow (baseCore, runFlow, createRunCore)     *
/* Starts a poller that scans registry and attaches prime hooks                 *
/********************************************************************************/
export default async function getDiscordVoiceFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore.config?.["discord-voice"] || {};
  const pollMs = Number.isFinite(cfg.pollMs) ? Math.max(500, Number(cfg.pollMs)) : 1000;
  const rc = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);
  log("init discord-voice (poller)", "info", { moduleName: MODULE_NAME, pollMs });
  async function scanAndAttachOnce() {
    try {
      const reg = await getItem("discord-voice:registry");
      const keys = Array.isArray(reg?.list) ? reg.list : [];
      for (const sessionKey of keys) {
        try {
          const session = await getItem(sessionKey);
          if (session?.connection?.receiver) {
            await setAttachToSession(baseCore, sessionKey, session, cfg, runFlow, createRunCore, log);
          }
        } catch (e) {
          log("attach error", "error", { moduleName: MODULE_NAME, sessionKey, error: e?.message });
        }
      }
    } catch (e) {
      log("scan error", "error", { moduleName: MODULE_NAME, error: e?.message });
    } finally {
      setTimeout(scanAndAttachOnce, pollMs);
    }
  }
  setTimeout(scanAndAttachOnce, 0);
}
