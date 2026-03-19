/************************************************************************************
/* filename: discord-voice-tts-play.js                                             *
/* Version 1.0                                                                     *
/* Purpose: Discord-specific TTS playback module.                                  *
/*          Takes pre-rendered audio buffers from wo.ttsSegments (set by           *
/*          core-voice-tts) and plays them sequentially through the guild's        *
/*          Discord voice connection with guild-level lock management.             *
/*                                                                                 *
/* Trigger: wo.ttsSegments exists + wo.voiceSessionRef is usable                  *
/************************************************************************************/

import { getItem, putItem, deleteItem } from "../core/registry.js";
import {
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} from "@discordjs/voice";
import { Readable } from "node:stream";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-voice-tts-play";

/*************************************************************************************
/* functionSignature: getNow ()                                                     *
/* Returns current timestamp in milliseconds.                                       *
/*************************************************************************************/
function getNow() { return Date.now(); }

/*************************************************************************************
/* functionSignature: getIsVoiceSessionRefUsable (ref)                             *
/* Returns true if voiceSessionRef points to a valid registry key.                  *
/*************************************************************************************/
function getIsVoiceSessionRefUsable(ref) {
  if (ref == null) return false;
  const s = String(ref).trim().toLowerCase();
  return s !== "" && s !== "null" && s !== "undefined";
}

/*************************************************************************************
/* functionSignature: setSessionLight (sessionKey, session)                        *
/* Saves session state without unserializable voice objects.                        *
/*************************************************************************************/
async function setSessionLight(sessionKey, session) {
  if (!sessionKey || !session) return;
  const { player, connection, ...rest } = session;
  try { await putItem(rest, sessionKey); } catch {}
}

/*************************************************************************************
/* functionSignature: getBufferToBinaryStream (buf)                                *
/* Converts a Buffer to a one-shot Readable stream.                                 *
/*************************************************************************************/
function getBufferToBinaryStream(buf) {
  return new Readable({ read() { this.push(buf); this.push(null); } });
}

/*************************************************************************************
/* functionSignature: getResourceFromOggOpusBuffer (buf)                           *
/* Probes and builds a Discord audio resource from an OGG/Opus buffer.             *
/*************************************************************************************/
async function getResourceFromOggOpusBuffer(buf) {
  const { stream, type } = await demuxProbe(getBufferToBinaryStream(buf));
  return createAudioResource(stream, { inputType: type });
}

/*************************************************************************************
/* functionSignature: getTTSLockKey (guildId)                                      *
/* Builds the guild-specific TTS mutex key.                                         *
/*************************************************************************************/
function getTTSLockKey(guildId) { return `tts-lock-${guildId}`; }

/*************************************************************************************
/* functionSignature: getIsLockValid (lock)                                        *
/* Returns true if the lock object is still within its TTL window.                  *
/*************************************************************************************/
function getIsLockValid(lock) {
  if (!lock || typeof lock !== "object") return false;
  return (getNow() - Number(lock.since || 0)) < (Number(lock.ttlMs) || 60000);
}

/*************************************************************************************
/* functionSignature: getDiscordVoiceTTSPlay (coreData)                            *
/* Main module entry: acquires guild lock and plays ttsSegments via AudioPlayer.   *
/*************************************************************************************/
export default async function getDiscordVoiceTTSPlay(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (!Array.isArray(wo.ttsSegments) || !wo.ttsSegments.length) return coreData;

  const sessionKey = wo.voiceSessionRef;
  if (!getIsVoiceSessionRefUsable(sessionKey)) return coreData;

  let session = null;
  try { session = await getItem(sessionKey); } catch {}

  const connection = session?.connection;
  const guildId    = wo.guildId || session?.guildId || null;
  if (!guildId) {
    log("Missing guildId for TTS playback", "error", { moduleName: MODULE_NAME, sessionKey });
    return coreData;
  }

  const lockKey = getTTSLockKey(guildId);
  const existing = await getItem(lockKey);
  if (getIsLockValid(existing)) {
    log("TTS lock active → skip playback", "info", { moduleName: MODULE_NAME, guildId });
    wo.ttsSkipped = true;
    return coreData;
  }

  const ttlMs = Number(wo.TTSTTL || 60000);
  const owner = `tts:${sessionKey}:${getNow()}:${Math.random().toString(36).slice(2, 8)}`;
  await putItem({ owner, since: getNow(), ttlMs, speaking: false }, lockKey);

  let failsafe = null;

  function bumpFailsafe() {
    try { if (failsafe) clearTimeout(failsafe); } catch {}
    failsafe = setTimeout(async () => {
      try { const cur = await getItem(lockKey); if (cur?.owner === owner) await deleteItem(lockKey); } catch {}
    }, ttlMs + 500);
  }

  bumpFailsafe();

  async function setReleaseLock(reason = "unknown") {
    try { if (failsafe) clearTimeout(failsafe); } catch {}
    try {
      const player = session?.player;
      if (player?._ttsPlayWatchdog) clearTimeout(player._ttsPlayWatchdog);
      if (player?._ttsSpeakPoll)    clearInterval(player._ttsSpeakPoll);
      if (player) { player._ttsPlayWatchdog = null; player._ttsSpeakPoll = null; }
    } catch {}
    try {
      const cur = await getItem(lockKey);
      if (cur?.owner === owner) {
        await deleteItem(lockKey);
        log("TTS lock released", "info", { moduleName: MODULE_NAME, guildId, reason });
      }
    } catch {}
  }

  async function refreshLock(reason = "refresh") {
    try {
      const cur = await getItem(lockKey);
      if (cur?.owner !== owner) return false;
      cur.since = getNow(); cur.lastRefreshReason = reason;
      await putItem(cur, lockKey); bumpFailsafe(); return true;
    } catch { return false; }
  }

  async function guardOwner() {
    const cur = await getItem(lockKey);
    return !!cur && cur.owner === owner && getIsLockValid(cur);
  }

  if (!connection) {
    log("No voice connection", "error", { moduleName: MODULE_NAME, sessionKey });
    await setReleaseLock("no_connection");
    return coreData;
  }

  try { await entersState(connection, VoiceConnectionStatus.Ready, 10000); }
  catch {
    log("Voice connection not ready", "warn", { moduleName: MODULE_NAME });
    await setReleaseLock("not_ready");
    return coreData;
  }

  let player = session?.player;
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    if (session) { session.player = player; await setSessionLight(sessionKey, session); }
  }

  const hasMultiVoice  = wo.ttsSegments.length > 1;
  player._ttsRelease   = setReleaseLock;
  player._ttsOwner     = owner;
  player._ttsLockKey   = lockKey;
  player._ttsGuildId   = guildId;
  player._ttsAutoRelease = !hasMultiVoice;

  if (player.state?.status === AudioPlayerStatus.Playing) {
    log("Player already playing → skip", "info", { moduleName: MODULE_NAME });
    await setReleaseLock("player_already_playing");
    return coreData;
  }

  if (!player._ttsHandlersBound) {
    player.on("error", (e) => { player._ttsRelease?.("player_error"); });

    player.on(AudioPlayerStatus.Playing, async () => {
      try {
        const cur = await getItem(player._ttsLockKey);
        if (cur?.owner === player._ttsOwner) {
          cur.speaking = true; cur.startedAt = getNow();
          await putItem(cur, player._ttsLockKey);
        }
      } catch {}
      try { if (player._ttsPlayWatchdog) clearTimeout(player._ttsPlayWatchdog); } catch {}
      player._ttsPlayWatchdog = setTimeout(
        () => player._ttsRelease?.("play_watchdog_timeout"),
        Number(wo.TTSPlayMaxMs || 120000)
      );
      player._ttsSpeakPoll = setInterval(() => {
        if (player.state?.status !== AudioPlayerStatus.Playing) {
          try { if (player._ttsSpeakPoll) clearInterval(player._ttsSpeakPoll); } catch {}
          player._ttsSpeakPoll = null;
          if (player._ttsAutoRelease) player._ttsRelease?.("speak_poll_end");
        }
      }, 1000);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      try { if (player._ttsSpeakPoll) clearInterval(player._ttsSpeakPoll); } catch {}
      player._ttsSpeakPoll = null;
      if (player._ttsAutoRelease) player._ttsRelease?.("idle");
    });

    connection.on?.("stateChange", (_old, newState) => {
      if (newState.status !== VoiceConnectionStatus.Ready) player._ttsRelease?.("conn_state_change");
    });

    player._ttsHandlersBound = true;
  } else {
    player._ttsRelease     = setReleaseLock;
    player._ttsOwner       = owner;
    player._ttsLockKey     = lockKey;
    player._ttsGuildId     = guildId;
    player._ttsAutoRelease = !hasMultiVoice;
  }

  const PLAY_MAX_MS = Number(wo.TTSPlayMaxMs || 120000);

  try {
    for (let i = 0; i < wo.ttsSegments.length; i++) {
      const seg = wo.ttsSegments[i];
      if (!seg?.buffer) continue;

      if (player.state?.status === AudioPlayerStatus.Playing) {
        await setReleaseLock("guard_playing"); return coreData;
      }
      if (!(await guardOwner())) return coreData;
      await refreshLock(`play_segment_${i + 1}_of_${wo.ttsSegments.length}`);

      const resource = await getResourceFromOggOpusBuffer(seg.buffer);
      player.play(resource);
      connection.subscribe(player);

      log("TTS segment playing", "info", {
        moduleName: MODULE_NAME,
        segment: i + 1, total: wo.ttsSegments.length,
        voice: seg.voice, bytes: seg.buffer.length
      });

      try { await entersState(player, AudioPlayerStatus.Playing, 15000); }
      catch { log("Segment failed to enter Playing state", "warn", { moduleName: MODULE_NAME, segment: i + 1 }); }

      try { await entersState(player, AudioPlayerStatus.Idle, PLAY_MAX_MS); }
      catch {
        log("Segment playback timeout", "warn", { moduleName: MODULE_NAME, segment: i + 1 });
        await setReleaseLock("segment_timeout");
        return coreData;
      }
    }
    log("TTS playback finished", "info", { moduleName: MODULE_NAME, segments: wo.ttsSegments.length });
  } catch (e) {
    log("Playback error", "error", { moduleName: MODULE_NAME, error: e?.message });
    await setReleaseLock("playback_error");
    return coreData;
  }

  await setReleaseLock("end_of_segments");
  return coreData;
}
