/************************************************************************************
/* filename: bard-admin-join.js                                                    *
/* Version 1.0                                                                     *
/* Purpose: Handles /bardjoin and /bardleave in the discord-admin flow.            *
/*          Uses the Bard Bot client to join or leave voice channels.              *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/
import {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState
} from "@discordjs/voice";
import discordJs from "discord.js";
const { ActivityType } = discordJs;
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-admin-join";

/************************************************************************************/
/* functionSignature: getBardRegistry()                                            *
/* Ensures and returns the bard session registry object.                           *
/************************************************************************************/
async function getBardRegistry() {
  const key = "bard:registry";
  let reg = null;
  try { reg = await getItem(key); } catch { reg = null; }
  if (!reg || typeof reg !== "object" || !Array.isArray(reg.list)) {
    reg = { list: [] };
    try { await putItem(reg, key); } catch {}
  }
  return reg;
}

/************************************************************************************/
/* functionSignature: setAddBardSessionKey(sessionKey)                             *
/* Adds a session key to the bard registry list.                                   *
/************************************************************************************/
async function setAddBardSessionKey(sessionKey) {
  const key = "bard:registry";
  const reg = await getBardRegistry();
  if (!reg.list.includes(sessionKey)) {
    reg.list.push(sessionKey);
    try { await putItem(reg, key); } catch {}
  }
}

/************************************************************************************/
/* functionSignature: setRemoveBardSessionKey(sessionKey)                          *
/* Removes a session key from the bard registry list.                              *
/************************************************************************************/
async function setRemoveBardSessionKey(sessionKey) {
  const key = "bard:registry";
  const reg = await getBardRegistry();
  reg.list = (reg.list || []).filter(k => k !== sessionKey);
  try { await putItem(reg, key); } catch {}
}

/************************************************************************************/
/* functionSignature: getBardAdminJoin(coreData)                                   *
/* Main module entry. Handles bardjoin and bardleave slash commands.               *
/************************************************************************************/
export default async function getBardAdminJoin(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    if (wo?.flow !== "discord-admin") return coreData;

    const cmd = String(wo?.admin?.command || "").toLowerCase();
    if (cmd !== "bardjoin" && cmd !== "bardleave") return coreData;

    const guildId       = String(wo?.admin?.guildId   || "");
    const userId        = String(wo?.admin?.userId    || "");
    const textChannelId = String(wo?.admin?.channelId || wo?.channelID || "");

    if (!guildId || !userId) {
      log("bardjoin/bardleave failed: missing guildId or userId", "error", { moduleName: MODULE_NAME });
      wo.response = "";
      return coreData;
    }

    const bardClient = await getItem("bard:client");
    if (!bardClient) {
      log("bardjoin/bardleave failed: bard:client not in registry (bard bot not configured?)", "error", { moduleName: MODULE_NAME });
      wo.response = "";
      return coreData;
    }

    const sessionKey = `bard:session:${guildId}`;
    let live = null;
    try { live = await getItem(sessionKey); } catch { live = null; }

    if (cmd === "bardleave") {
      try {
        const conn   = live?.connection;
        const player = live?.player;
        player?.removeAllListeners?.();
        try { player?.stop?.(); } catch {}
        conn?.removeAllListeners?.();
        try { conn?.destroy?.(); } catch {}
      } catch {}
      try { await deleteItem(sessionKey); } catch {}
      try { await deleteItem(`bard:labels:${guildId}`); } catch {}
      try { await deleteItem(`bard:nowplaying:${guildId}`); } catch {}
      try { await deleteItem(`bard:stream:${guildId}`); } catch {}
      await setRemoveBardSessionKey(sessionKey);
      log("bardleave: bard session terminated", "info", {
        moduleName: MODULE_NAME,
        guildId,
        voiceChannelId: live?.voiceChannelId || null
      });
      // Immediately update presence — don't wait for the next poll cycle
      try {
        const idleText = String(coreData?.config?.["bard"]?.idlePresence ?? "");
        if (bardClient?.user) {
          bardClient.user.setPresence({ activities: [{ name: idleText || "...", type: ActivityType.Listening }], status: "online" });
        }
      } catch {}
      wo.response = "";
      return coreData;
    }

    let guild;
    try {
      guild = await bardClient.guilds.fetch(guildId);
    } catch (e) {
      log("bardjoin failed: could not fetch guild via bard client", "error", {
        moduleName: MODULE_NAME,
        guildId,
        reason: e?.message
      });
      wo.response = "";
      return coreData;
    }

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (e) {
      log("bardjoin failed: could not fetch member", "error", {
        moduleName: MODULE_NAME,
        guildId, userId,
        reason: e?.message
      });
      wo.response = "";
      return coreData;
    }

    const voiceChannelId = String(member?.voice?.channelId || "");
    if (!voiceChannelId) {
      log("bardjoin failed: user not connected to a voice channel", "warn", {
        moduleName: MODULE_NAME,
        guildId, userId
      });
      wo.response = "";
      return coreData;
    }

    // Check permissions before joining
    try {
      const voiceChannel = guild.channels.cache.get(voiceChannelId)
        || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (voiceChannel) {
        const myMember = guild.members.me;
        const perms = myMember ? voiceChannel.permissionsFor(myMember) : null;
        if (perms && !perms.has("Speak")) {
        }
      } else {
      }
    } catch (pe) {
    }

    if (live?.connection) {
      try {
        live.player?.removeAllListeners?.();
        try { live.player?.stop?.(); } catch {}
        live.connection?.removeAllListeners?.();
        try { live.connection?.destroy?.(); } catch {}
      } catch {}
      try { await deleteItem(sessionKey); } catch {}
      await setRemoveBardSessionKey(sessionKey);
    }

    const adapterCreator = guild.voiceAdapterCreator;
    if (!adapterCreator) {
      log("bardjoin failed: guild.voiceAdapterCreator missing", "error", {
        moduleName: MODULE_NAME,
        guildId, voiceChannelId
      });
      wo.response = "";
      return coreData;
    }

    // Track voice state changes to diagnose selfMute/selfDeaf
    const _vsHandler = (oldState, newState) => {
      if (newState.member?.user?.id !== bardClient.user?.id) return;
      if (newState.guild?.id !== guildId) return;
    };
    bardClient.on?.("voiceStateUpdate", _vsHandler);

    let connection;
    try {
      connection = joinVoiceChannel({
        channelId: voiceChannelId,
        guildId,
        adapterCreator,
        selfDeaf: false,
        selfMute: false,
        group: "bard"
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 10000);

      // Log actual Discord voice state after Ready
      try {
        await new Promise(r => setTimeout(r, 800));
        const botVoice = guild.members.me?.voice;
      } catch (ve) {
      }
    } catch (e) {
      bardClient.off?.("voiceStateUpdate", _vsHandler);
      log("bardjoin failed: voice connection error", "error", {
        moduleName: MODULE_NAME,
        guildId, voiceChannelId,
        reason: e?.message,
        hints: [
          "Bard bot requires CONNECT/SPEAK permissions in the voice channel",
          "GuildVoiceStates intent must be enabled for the bard bot"
        ]
      });
      wo.response = "";
      return coreData;
    }

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    try { connection.subscribe(player); } catch {}

    const liveSession = {
      guildId,
      voiceChannelId,
      textChannelId,
      clientRef: "bard:client",
      connection,
      player,
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try { await putItem(liveSession, sessionKey); } catch {}
    await setAddBardSessionKey(sessionKey);

    log("bardjoin: bard session created", "info", {
      moduleName: MODULE_NAME,
      sessionKey,
      guildId,
      voiceChannelId,
      textChannelId
    });

    wo.response = "";
    return coreData;

  } catch (e) {
    const elog = getPrefixedLogger(coreData?.workingObject || {}, import.meta.url);
    elog("bardjoin/bardleave unexpected error", "error", { moduleName: MODULE_NAME, reason: e?.message });
    (coreData?.workingObject || {}).response = "";
    return coreData;
  }
}
