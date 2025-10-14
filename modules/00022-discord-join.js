/***************************************************************
/* filename: "00022-discord-join.js"                           *
/* Version 1.0                                                 *
/* Purpose: Handle "!join" and "!leave" to manage a Discord    *
/*          voice session registry and connection lifecycle    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState
} from "@discordjs/voice";
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-join";

/***************************************************************
/* functionSignature: getConfig (coreData)                     *
/* Resolves join/leave commands and timeouts from config       *
/***************************************************************/
function getConfig(coreData) {
  const cfg = coreData?.config?.["discord-voice"] || {};
  return {
    joinCommand: typeof cfg.joinCommand === "string" && cfg.joinCommand.trim() ? cfg.joinCommand.trim() : "!join",
    leaveCommand: typeof cfg.leaveCommand === "string" && cfg.leaveCommand.trim() ? cfg.leaveCommand.trim() : "!leave",
    readyTimeoutMs: Number.isFinite(cfg.readyTimeoutMs) ? Math.max(2000, Number(cfg.readyTimeoutMs)) : 10000
  };
}

/***************************************************************
/* functionSignature: getGuildCtx (message)                    *
/* Extracts guild and voice channel context from a message     *
/***************************************************************/
function getGuildCtx(msg) {
  const guildId = String(msg?.guildId || msg?.guild?.id || "");
  const channelId = String(msg?.member?.voice?.channelId || "");
  const guild = msg?.guild || null;
  const adapterCreator = guild?.voiceAdapterCreator || null;
  return { guildId, channelId, guild, adapterCreator };
}

/***************************************************************
/* functionSignature: getOrInitVoiceRegistry ()                *
/* Ensures the voice registry exists and returns it            *
/***************************************************************/
function getOrInitVoiceRegistry() {
  let reg = getItem("discord-voice:registry");
  if (!reg || typeof reg !== "object") {
    reg = { list: [] };
    putItem(reg, "discord-voice:registry");
  } else if (!Array.isArray(reg.list)) {
    reg.list = [];
    putItem(reg, "discord-voice:registry");
  }
  return reg;
}

/***************************************************************
/* functionSignature: setIndexSessionKey (sessionKey)          *
/* Adds a session key to registry index if missing             *
/***************************************************************/
function setIndexSessionKey(sessionKey) {
  const reg = getOrInitVoiceRegistry();
  if (!reg.list.includes(sessionKey)) {
    reg.list.push(sessionKey);
    putItem(reg, "discord-voice:registry");
  }
}

/***************************************************************
/* functionSignature: setRemoveSessionKey (sessionKey)         *
/* Removes a session key from registry index                   *
/***************************************************************/
function setRemoveSessionKey(sessionKey) {
  const reg = getOrInitVoiceRegistry();
  if (Array.isArray(reg.list)) {
    reg.list = reg.list.filter(k => k !== sessionKey);
    putItem(reg, "discord-voice:registry");
  }
}

/***************************************************************
/* functionSignature: setConnDiagnostics (connection, log, ctx)*
//* Attaches connection diagnostics logging                     *
/***************************************************************/
function setConnDiagnostics(connection, log, context) {
  try {
    connection.setMaxListeners?.(0);
    connection.on("stateChange", (oldState, newState) => {
      log("voice state change", "info", { ...context, moduleName: MODULE_NAME, from: oldState.status, to: newState.status });
    });
  } catch {}
}

/***************************************************************
/* functionSignature: getDiscordJoinLeave (coreData)           *
/* Handles join/leave commands and maintains live session      *
/***************************************************************/
export default async function getDiscordJoinLeave(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = getConfig(coreData);

  const msg = wo?.message;
  const content = String(msg?.content || wo?.payload || "").trim().toLowerCase();
  if (!content) return coreData;

  if (content.startsWith(cfg.leaveCommand.toLowerCase())) {
    const { guildId } = msg || {};
    if (!guildId) { log("Leave failed: no guild context", "error", { moduleName: MODULE_NAME }); wo.stop = true; return coreData; }

    const sessionKey = `discord-voice:data:${guildId}`;
    const live = getItem(sessionKey);

    try {
      const conn = live?.connection;
      const player = live?.player;
      player?.removeAllListeners?.();
      if (player?.stop) { try { player.stop(); } catch {} }
      conn?.removeAllListeners?.();
      if (conn?.destroy) { try { conn.destroy(); } catch {} }
    } catch {}

    deleteItem(sessionKey);
    setRemoveSessionKey(sessionKey);

    log("discord-leave: session terminated and removed", "info", { moduleName: MODULE_NAME, guildId });
    wo.stop = true;
    return coreData;
  }

  if (!content.startsWith(cfg.joinCommand.toLowerCase())) return coreData;

  const clientRef = wo?.clientRef || "discord:client";
  const client = getItem(clientRef);
  if (!client) {
    log("Join failed: Discord client missing in registry", "error", { moduleName: MODULE_NAME, clientRef });
    wo.stop = true; return coreData;
  }

  const { guildId, channelId, guild, adapterCreator } = getGuildCtx(msg);
  if (!guildId || !guild)        { log("Join failed: message has no guild context", "error", { moduleName: MODULE_NAME }); wo.stop = true; return coreData; }
  if (!channelId)                { log("Join failed: user is not in a voice channel", "warn",  { moduleName: MODULE_NAME, guildId }); wo.stop = true; return coreData; }
  if (!adapterCreator)           { log("Join failed: guild.voiceAdapterCreator missing", "error", { moduleName: MODULE_NAME, guildId }); wo.stop = true; return coreData; }

  const sessionKey = `discord-voice:data:${guildId}`;
  const prev = getItem(sessionKey);
  if (prev?.connection) {
    try {
      prev.player?.removeAllListeners?.();
      if (prev.player?.stop) prev.player.stop();
      prev.connection?.removeAllListeners?.();
      prev.connection?.destroy?.();
    } catch {}
    deleteItem(sessionKey);
    setRemoveSessionKey(sessionKey);
  }

  let connection = null;
  try {
    connection = joinVoiceChannel({ channelId, guildId, adapterCreator, selfDeaf: false, selfMute: false });
    setConnDiagnostics(connection, log, { guildId, channelId });
    await entersState(connection, VoiceConnectionStatus.Ready, cfg.readyTimeoutMs);
  } catch (e) {
    log("Join failed", "error", {
      moduleName: MODULE_NAME, guildId, channelId,
      reason: e?.message || String(e),
      hints: [
        "Bot needs CONNECT/SPEAK permissions for the voice channel",
        "Ensure GuildVoiceStates intent is enabled",
        "Try re-issuing !join after a few seconds"
      ]
    });
    wo.stop = true; return coreData;
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  player.on?.("error", (err) => log("audio player error", "warn", { moduleName: MODULE_NAME, guildId, err: err?.message }));
  try { connection.subscribe(player); } catch {}

  const liveSession = {
    guildId, channelId, message: msg || null, clientRef,
    connection, player, status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  getOrInitVoiceRegistry();
  putItem(liveSession, sessionKey);
  setIndexSessionKey(sessionKey);

  coreData.workingObject.voiceSessionRef = sessionKey;

  log("discord-join persisted live session (registry, refs intact)", "info", {
    moduleName: MODULE_NAME,
    sessionKey,
    sessionView: {
      guildId,
      channelId,
      status: liveSession.status,
      hasConnection: !!liveSession.connection,
      hasReceiver: !!liveSession.connection?.receiver,
      hasPlayer: !!liveSession.player,
      messageChannelId: liveSession.message?.channelId || null
    }
  });

  wo.stop = true;
  return coreData;
}
