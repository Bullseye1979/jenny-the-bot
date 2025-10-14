/***************************************************************
/* filename: "discord-voice.js"                                *
/* Version 1.0                                                 *
/* Purpose: Poll registry, attach voice speaking triggers,     *
/*          and forward captures into the "discord-voice" flow *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { entersState, VoiceConnectionStatus } from "@discordjs/voice";
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-voice";

const BOUND = new WeakSet();
const PENDING = new Map();
const PENDING_MS = 1200;

/***************************************************************
/* functionSignature: getIsPending (key)                       *
/* True if a short pending lock is active for the given key    *
/***************************************************************/
function getIsPending(key) {
  const t = PENDING.get(key) || 0;
  const ok = Date.now() - t < PENDING_MS;
  if (!ok) PENDING.delete(key);
  return ok;
}

/***************************************************************
/* functionSignature: setPendingLock (key)                     *
/* Sets a short pending lock timestamp for the given key       *
/***************************************************************/
function setPendingLock(key) {
  PENDING.set(key, Date.now());
}

/***************************************************************
/* functionSignature: getResolveDisplayName (userLike)         *
/* Derives a display name from a Discord user/member object    *
/***************************************************************/
function getResolveDisplayName(u) {
  if (!u) return "Unknown";
  if (u.nickname) return u.nickname;
  if (u.displayName) return u.displayName;
  const x = u.user || u;
  return x?.globalName || x?.username || "Unknown";
}

/***************************************************************
/* functionSignature: getResolveSpeakerName (client,guildId,uid)*
/* Fetches and resolves a speaker name using the Discord API   *
/***************************************************************/
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

/***************************************************************
/* functionSignature: setMergeDynamicWO (src, dst)             *
/* Merges dynamic fields from src into dst excluding denylist  *
/***************************************************************/
function setMergeDynamicWO(src, dst) {
  const deny = new Set([
    "message","payload","Response","logging",
    "voiceIntent","flow","source","id","guildId","clientRef",
    "voiceSessionRef","userid","userId","channelallowed",
    "config"
  ]);
  for (const [k, v] of Object.entries(src || {})) {
    if (deny.has(k)) continue;
    dst[k] = v;
  }
}

/***************************************************************
/* functionSignature: setAttachToSession (base, key, sess, cfg,run,make,log)*
/* Attaches speaking.start handler to a single voice session   *
/***************************************************************/
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
  const voiceChannelId = session.channelId || null;
  const textChannelId = (session?.message && session.message.channelId) || session?.textChannelId || null;

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

      const targetId = useVoice
        ? (voiceChannelId || textChannelId || null)
        : (textChannelId  || voiceChannelId || null);

      const rc = createRunCore();
      const wo = rc.workingObject;

      if (Object.prototype.hasOwnProperty.call(wo, "message")) delete wo.message;

      setMergeDynamicWO(liveWO, wo);

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

      log("voice trigger (debounced)", "info", {
        moduleName: MODULE_NAME,
        sessionKey,
        userId,
        id: wo.id,
        useVoiceChannel: !!wo.useVoiceChannel
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
    channelId: session.channelId || null,
    receiverBound: Boolean(receiver)
  });
}

/***************************************************************
/* functionSignature: getDiscordVoiceFlow (baseCore, runFlow, makeCore)*
/* Starts poller that scans registry and attaches prime hooks  *
/***************************************************************/
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
