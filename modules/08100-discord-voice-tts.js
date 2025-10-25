/***************************************************************
/* filename: "discord-voice-tts.js"                            *
/* Version 1.0                                                 *
/* Purpose: Speak wo.Response via OpenAI TTS into the current  *
/*          voice connection with a per-guild speaking lock,   *
/*          race-safe owner rechecks, and watchdog unlock.     *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

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

const MODULE_NAME = "discord-voice-tts";

/***************************************************************
/* functionSignature: setLog (wo, message, level, extra)       *
/* Appends a structured log entry to wo.logging                *
/***************************************************************/
function setLog(wo, message, level = "info", extra = {}) {
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: level,
    module: MODULE_NAME,
    exitStatus: "success",
    message,
    ...((Object.keys(extra).length && { context: extra }) || {})
  });
}

/***************************************************************
/* functionSignature: getBufferToBinaryStream (buf)            *
/* Wraps a Buffer into a Readable binary stream                *
/***************************************************************/
function getBufferToBinaryStream(buf) {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    }
  });
}

/***************************************************************
/* functionSignature: getResourceFromOggOpusBuffer (buf)       *
/* Builds a Discord audio resource from an OGG/WebM Opus buffer*/
/***************************************************************/
async function getResourceFromOggOpusBuffer(buf) {
  const bin = getBufferToBinaryStream(buf);
  const { stream, type } = await demuxProbe(bin);
  return createAudioResource(stream, { inputType: type });
}

/***************************************************************
/* functionSignature: getNow ()                                *
/* Returns the current timestamp in milliseconds               *
/***************************************************************/
function getNow() { return Date.now(); }

/***************************************************************
/* functionSignature: getSpeakingKey (guildId)                 *
/* Returns the per-guild speaking lock key                     *
/***************************************************************/
function getSpeakingKey(guildId) {
  return `speaking-${guildId}`;
}

/***************************************************************
/* functionSignature: getIsLockValid (lock)                    *
/* True if lock exists and is within its TTL                   *
/***************************************************************/
function getIsLockValid(lock) {
  if (!lock || typeof lock !== "object") return false;
  const ttl = Number(lock.ttlMs) || 60000;
  return (getNow() - Number(lock.since || 0)) < ttl;
}

/***************************************************************
/* functionSignature: getIsStillOwner (lockKey, owner)         *
/* True if the current owner still holds the lock              *
/***************************************************************/
async function getIsStillOwner(lockKey, owner) {
  const cur = await getItem(lockKey);
  return !!cur && cur.owner === owner && getIsLockValid(cur);
}

/***************************************************************
/* functionSignature: getDiscordVoiceTTS (coreData)            *
/* Generates TTS audio and plays it into the active connection */
/* while ensuring only one TTS per guild                       *
/***************************************************************/
export default async function getDiscordVoiceTTS(coreData) {
  const wo = coreData.workingObject || {};
  if (wo.silentMode) {
    setLog(wo, "Silent mode enabled -> skip TTS", "info");
    return coreData;
  }

  const text = (typeof wo.Response === "string" ? wo.Response.trim() : "");
  if (!text) {
    setLog(wo, "No Response to speak", "warn");
    return coreData;
  }

  const sessionKey = wo.voiceSessionRef;
  if (!sessionKey) {
    setLog(wo, "Missing voiceSessionRef", "error");
    return coreData;
  }

  let session = null;
  try {
    session = await getItem(sessionKey);
  } catch {
    session = null;
  }

  const connection = session?.connection;
  const guildId = wo.guildId || session?.guildId || null;
  if (!guildId) {
    setLog(wo, "Missing guildId for speaking lock", "error", { sessionKey });
    return coreData;
  }

  const lockKey = getSpeakingKey(guildId);
  const ttlMs = Number(wo.TTSTTL || 60000);
  const owner = `tts:${sessionKey}:${getNow()}:${Math.random().toString(36).slice(2,8)}`;

  const existing = await getItem(lockKey);
  if (getIsLockValid(existing)) {
    setLog(wo, "Speaking lock active -> skip TTS", "info", { guildId });
    return coreData;
  }
  await putItem({ owner, since: getNow(), ttlMs }, lockKey);

  const failsafe = setTimeout(async () => {
    try {
      const l = await getItem(lockKey);
      if (l?.owner === owner) await deleteItem(lockKey);
    } catch {}
  }, ttlMs + 250);

  const PLAY_MAX_MS = Number(wo.TTSPlayMaxMs || 120000);
  let playWatchdog = null;

  /*************************************************************
  /* functionSignature: setReleaseLock (reason)                *
  /* Releases the speaking lock if still owned by this worker  *
  /*************************************************************/
  async function setReleaseLock(reason) {
    try { clearTimeout(failsafe); } catch {}
    try { if (playWatchdog) clearTimeout(playWatchdog); } catch {}
    try {
      const l = await getItem(lockKey);
      if (l?.owner === owner) {
        await deleteItem(lockKey);
        setLog(wo, "Speaking lock released", "info", { guildId, reason });
      }
    } catch {}
  }

  const model = wo.TTSModel || "gpt-4o-mini-tts";
  const voice = wo.TTSVoice || "alloy";
  const endpoint = wo.TTSEndpoint || "https://api.openai.com/v1/audio/speech";
  const apiKey = wo.TTSAPIKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    setLog(wo, "Missing TTS API key", "error");
    await setReleaseLock("no_api_key");
    return coreData;
  }

  const ttspayload = { model, voice, input: text, format: "opus" };
  let oggOpusBuffer;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ttspayload)
    });
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      setLog(wo, `TTS HTTP ${resp.status}`, "error", { body: errTxt.slice(0, 400) });
      await setReleaseLock("http_error");
      return coreData;
    }
    oggOpusBuffer = Buffer.from(await resp.arrayBuffer());
    if (!oggOpusBuffer?.length) {
      setLog(wo, "Empty TTS audio buffer", "error");
      await setReleaseLock("empty_buffer");
      return coreData;
    }
  } catch (e) {
    setLog(wo, "TTS request failed", "error", { error: e?.message || String(e) });
    await setReleaseLock("request_failed");
    return coreData;
  }

  if (!connection) {
    setLog(wo, "No voice connection available", "error", { sessionKey });
    await setReleaseLock("no_connection");
    return coreData;
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
  } catch {
    setLog(wo, "Voice connection not ready", "warn", { sessionKey });
    await setReleaseLock("not_ready");
    return coreData;
  }

  let player = session?.player;
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    if (session) {
      session.player = player;
      try { await putItem(session, sessionKey); } catch {}
    }
  }

  if (player.state?.status === AudioPlayerStatus.Playing) {
    setLog(wo, "Player already playing -> skip TTS", "info");
    await setReleaseLock("already_playing");
    return coreData;
  }

  if (!(await getIsStillOwner(lockKey, owner))) {
    setLog(wo, "Lost speaking lock before play -> skip", "info");
    await setReleaseLock("lost_lock_before_play");
    return coreData;
  }

  if (session && !session._ttsHandlersBound) {
    player.on("error", (e) => {
      try { setLog(session?.wo || wo, `AudioPlayer error: ${e.message}`, "error"); } catch {}
      setReleaseLock("player_error");
    });
    player.on(AudioPlayerStatus.Playing, () => {
      try { if (playWatchdog) clearTimeout(playWatchdog); } catch {}
      playWatchdog = setTimeout(() => setReleaseLock("play_watchdog_timeout"), PLAY_MAX_MS);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      try { setLog(session?.wo || wo, "TTS playback finished", "info"); } catch {}
      setReleaseLock("idle");
    });
    connection.on?.("stateChange", (_old, newState) => {
      if (newState.status !== VoiceConnectionStatus.Ready) {
        setReleaseLock("conn_state_change");
      }
    });
    session._ttsHandlersBound = true;
    try { await putItem(session, sessionKey); } catch {}
  }

  try {
    const resource = await getResourceFromOggOpusBuffer(oggOpusBuffer);
    if (player.state?.status === AudioPlayerStatus.Playing) {
      setLog(wo, "Guard: player already playing -> skip", "info");
      await setReleaseLock("guard_playing");
      return coreData;
    }
    if (!(await getIsStillOwner(lockKey, owner))) {
      setLog(wo, "Guard: lost lock -> skip", "info");
      await setReleaseLock("guard_lost_lock");
      return coreData;
    }
    player.play(resource);
    connection.subscribe(player);
    setLog(wo, "TTS playback started", "info", { bytes: oggOpusBuffer.length, model, voice });
  } catch (e) {
    setLog(wo, "Failed to create or play audio resource", "error", { error: e?.message || String(e) });
    await setReleaseLock("play_failed");
  }

  return coreData;
}
