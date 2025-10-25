/***************************************************************
/* filename: "discord-admin-join.js"                           *
/* Version 1.0                                                 *
/* Purpose: Handle /join and /leave via admin-flow snapshot;   *
/*          create/teardown voice connection and session store *
/*          with separate text vs voice channel handling.      *
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

const MODULE_NAME = "discord-admin-join";

/***************************************************************
/* functionSignature: setLogVoiceStateDiag (connection, log, ctx)*
/* Subscribes to voice state changes for diagnostics            *
/***************************************************************/
function setLogVoiceStateDiag(connection, log, ctx) {
  try {
    connection.setMaxListeners?.(0);
    connection.on("stateChange", (oldState, newState) => {
      log("voice state change", "info", { ...ctx, moduleName: MODULE_NAME, from: oldState.status, to: newState.status });
    });
  } catch {}
}

/***************************************************************
/* functionSignature: getRegistry ()                           *
/* Ensures and returns the voice session registry              *
/***************************************************************/
async function getRegistry() {
  const key = "discord-voice:registry";
  let reg = null;
  try { reg = await getItem(key); } catch { reg = null; }
  if (!reg || typeof reg !== "object") {
    reg = { list: [] };
    try { await putItem(reg, key); } catch {}
  } else if (!Array.isArray(reg.list)) {
    reg.list = [];
    try { await putItem(reg, key); } catch {}
  }
  return reg;
}

/***************************************************************
/* functionSignature: setAddSessionKey (sessionKey)            *
/* Adds a session key to the registry                          *
/***************************************************************/
async function setAddSessionKey(sessionKey) {
  const key = "discord-voice:registry";
  const reg = await getRegistry();
  if (!reg.list.includes(sessionKey)) {
    reg.list.push(sessionKey);
    try { await putItem(reg, key); } catch {}
  }
}

/***************************************************************
/* functionSignature: setRemoveSessionKey (sessionKey)         *
/* Removes a session key from the registry                     *
/***************************************************************/
async function setRemoveSessionKey(sessionKey) {
  const key = "discord-voice:registry";
  const reg = await getRegistry();
  reg.list = (reg.list || []).filter(k => k !== sessionKey);
  try { await putItem(reg, key); } catch {}
}

/***************************************************************
/* functionSignature: getResolveClient (wo)                    *
/* Resolves the Discord client from the registry               *
/***************************************************************/
async function getResolveClient(wo) {
  const ref = wo?.clientRef || wo?.refs?.client || "discord:client";
  try {
    return await getItem(ref);
  } catch {
    return null;
  }
}

/***************************************************************
/* functionSignature: getResolveGuildAndMember (client,gid,uid)*
/* Fetches guild and member objects                            *
/***************************************************************/
async function getResolveGuildAndMember(client, guildId, userId) {
  try {
    const guild  = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    return { guild, member };
  } catch {
    return { guild: null, member: null };
  }
}

/***************************************************************
/* functionSignature: getDiscordJoinLeave (coreData)           *
/* Handles /join and /leave slash commands for voice sessions  *
/***************************************************************/
export default async function getDiscordJoinLeave(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    if (wo?.flow !== "discord-admin") return coreData;

    const cmd = String(wo?.admin?.command || "").toLowerCase();
    if (cmd !== "join" && cmd !== "leave") {
      return coreData;
    }

    const guildId       = String(wo?.admin?.guildId   || "");
    const userId        = String(wo?.admin?.userId    || "");
    const textChannelId = String(wo?.admin?.channelId || wo?.id || "");
    if (!guildId || !userId || !textChannelId) {
      log("slash join/leave failed: missing guildId/userId/textChannelId", "error", { moduleName: MODULE_NAME, guildId, userId, textChannelId });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    const client = await getResolveClient(wo);
    if (!client) {
      log("slash join/leave failed: missing discord client in registry", "error", { moduleName: MODULE_NAME });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    const { guild, member } = await getResolveGuildAndMember(client, guildId, userId);
    if (!guild) {
      log("slash join/leave failed: could not fetch guild", "error", { moduleName: MODULE_NAME, guildId });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    const sessionKey = `discord-voice:data:${guildId}`;
    let live = null;
    try { live = await getItem(sessionKey); } catch { live = null; }

    if (cmd === "leave") {
      try {
        const conn   = live?.connection;
        const player = live?.player;
        player?.removeAllListeners?.();
        try { player?.stop?.(); } catch {}
        conn?.removeAllListeners?.();
        try { conn?.destroy?.(); } catch {}
      } catch {}
      try { await deleteItem(sessionKey); } catch {}
      await setRemoveSessionKey(sessionKey);
      log("discord-leave: session terminated and removed", "info", {
        moduleName: MODULE_NAME,
        guildId,
        textChannelId: live?.textChannelId || null,
        voiceChannelId: live?.voiceChannelId || null
      });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    const voiceChannelId = String(member?.voice?.channelId || "");
    if (!voiceChannelId) {
      log("join failed: user not connected to a voice channel", "warn", { moduleName: MODULE_NAME, guildId, userId, textChannelId });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    if (live?.connection) {
      try {
        live.player?.removeAllListeners?.();
        try { live.player?.stop?.(); } catch {}
        live.connection?.removeAllListeners?.();
        try { live.connection?.destroy?.(); } catch {}
      } catch {}
      try { await deleteItem(sessionKey); } catch {}
      await setRemoveSessionKey(sessionKey);
    }

    const adapterCreator = guild.voiceAdapterCreator;
    if (!adapterCreator) {
      log("join failed: guild.voiceAdapterCreator missing", "error", { moduleName: MODULE_NAME, guildId, textChannelId, voiceChannelId });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    let connection = null;
    try {
      connection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId,
        adapterCreator,
        selfDeaf: false,
        selfMute: false
      });
      setLogVoiceStateDiag(connection, log, { guildId, textChannelId, voiceChannelId });
      await entersState(connection, VoiceConnectionStatus.Ready, 10000);
    } catch (e) {
      log("join failed", "error", {
        moduleName: MODULE_NAME, guildId, textChannelId, voiceChannelId,
        reason: e?.message || String(e),
        hints: [
          "Bot requires CONNECT/SPEAK permissions in the voice channel",
          "GuildVoiceStates intent must be enabled"
        ]
      });
      wo.Response = "";
      wo.stop = true;
      return coreData;
    }

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    player.on?.("error", (err) => log("audio player error", "warn", { moduleName: MODULE_NAME, guildId, textChannelId, voiceChannelId, err: err?.message }));
    try { connection.subscribe(player); } catch {}

    const liveSession = {
      guildId,
      channelId: textChannelId,
      textChannelId,
      voiceChannelId,
      clientRef: wo?.clientRef || "discord:client",
      connection,
      player,
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try { await putItem(liveSession, sessionKey); } catch {}
    await setAddSessionKey(sessionKey);
    coreData.workingObject.voiceSessionRef = sessionKey;

    log("discord-join persisted live session", "info", {
      moduleName: MODULE_NAME,
      sessionKey,
      sessionView: {
        guildId,
        channelId: liveSession.channelId,
        textChannelId: liveSession.textChannelId,
        voiceChannelId: liveSession.voiceChannelId,
        status: liveSession.status,
        hasConnection: !!liveSession.connection,
        hasReceiver: !!liveSession.connection?.receiver,
        hasPlayer: !!liveSession.player
      }
    });

    wo.Response = "";
    wo.stop = true;
    return coreData;

  } catch (e) {
    const elog = getPrefixedLogger(coreData?.workingObject || {}, import.meta.url);
    elog("slash join/leave failed", "error", { moduleName: MODULE_NAME, reason: e?.message || String(e) });
    wo.Response = "";
    wo.stop = true;
    return coreData;
  }
}
