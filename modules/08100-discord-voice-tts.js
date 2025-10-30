/***************************************************************
/* filename: "discord-voice-tts.js"                            *
/* Version 1.0                                                 *
/* Purpose: Speak wo.Response via OpenAI TTS into the current  *
/*          voice connection with a per-guild TTS lock.        *
/*          Multiple AI replies may occur, but only one plays  *
/*          at a time; later replies aren’t blocked, and we do *
/*          not wipe session.connection.                       *
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
/* functionSignature: setLog (wo, message, level = "info",     *
/*                     extra = {})                             *
/* Records a structured log entry into the working object.     *
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
/* Converts a Buffer into a readable stream.                   *
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
/* Creates a Discord audio resource from an OGG/Opus buffer.   *
/***************************************************************/
async function getResourceFromOggOpusBuffer(buf) {
  const bin = getBufferToBinaryStream(buf);
  const { stream, type } = await demuxProbe(bin);
  return createAudioResource(stream, { inputType: type });
}

/***************************************************************
/* functionSignature: getNow ()                                *
/* Returns the current timestamp in milliseconds.              *
/***************************************************************/
function getNow() { return Date.now(); }

/***************************************************************
/* functionSignature: getTTSLockKey (guildId)                  *
/* Returns the per-guild TTS lock key for the registry.        *
/***************************************************************/
function getTTSLockKey(guildId) {
  return `tts-lock-${guildId}`;
}

/***************************************************************
/* functionSignature: getIsLockValid (lock)                    *
/* Validates lock object presence and TTL window.              *
/***************************************************************/
function getIsLockValid(lock) {
  if (!lock || typeof lock !== "object") return false;
  const ttl = Number(lock.ttlMs) || 60000;
  return (getNow() - Number(lock.since || 0)) < ttl;
}

/***************************************************************
/* functionSignature: getIsStillOwner (lockKey, owner)         *
/* Confirms current lock holder matches and is valid.          *
/***************************************************************/
async function getIsStillOwner(lockKey, owner) {
  const cur = await getItem(lockKey);
  return !!cur && cur.owner === owner && getIsLockValid(cur);
}

/***************************************************************
/* functionSignature: getDiscordVoiceTTS (coreData)            *
/* Speaks wo.Response via OpenAI TTS into current connection.  *
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
  try { session = await getItem(sessionKey); } catch { session = null; }

  const connection = session?.connection;
  const guildId = wo.guildId || session?.guildId || null;
  if (!guildId) {
    setLog(wo, "Missing guildId for TTS", "error", { sessionKey });
    return coreData;
  }

  const lockKey = getTTSLockKey(guildId);
  const existing = await getItem(lockKey);
  if (getIsLockValid(existing)) {
    setLog(wo, "TTS currently speaking -> skip only TTS, keep pipeline", "info", {
      guildId,
      currentOwner: existing.owner
    });
    wo.ttsSkipped = true;
    return coreData;
  }

  const ttlMs = Number(wo.TTSTTL || 60000);
  const owner = `tts:${sessionKey}:${getNow()}:${Math.random().toString(36).slice(2,8)}`;
  await putItem({ owner, since: getNow(), ttlMs }, lockKey);

  const failsafe = setTimeout(async () => {
    try {
      const l = await getItem(lockKey);
      if (l?.owner === owner) await deleteItem(lockKey);
    } catch {}
  }, ttlMs + 250);

  const PLAY_MAX_MS = Number(wo.TTSPlayMaxMs || 120000);
  let playWatchdog = null;

  async function setReleaseLock(reason) {
    try { clearTimeout(failsafe); } catch {}
    try { if (playWatchdog) clearTimeout(playWatchdog); } catch {}
    try {
      const l = await getItem(lockKey);
      if (l?.owner === owner) {
        await deleteItem(lockKey);
        setLog(wo, "TTS lock released", "info", { guildId, reason });
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
    }
  }

  if (player.state?.status === AudioPlayerStatus.Playing) {
    setLog(wo, "Player already playing -> release lock & skip TTS", "info");
    await setReleaseLock("player_already_playing");
    return coreData;
  }

  if (!(await getIsStillOwner(lockKey, owner))) {
    setLog(wo, "Lost TTS lock before play -> skip", "info");
    return coreData;
  }

  if (player && !player._ttsHandlersBound) {
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

    player._ttsHandlersBound = true;
  }

  try {
    const resource = await getResourceFromOggOpusBuffer(oggOpusBuffer);

    if (player.state?.status === AudioPlayerStatus.Playing) {
      setLog(wo, "Guard: player already playing -> release lock & skip", "info");
      await setReleaseLock("guard_playing");
      return coreData;
    }
    if (!(await getIsStillOwner(lockKey, owner))) {
      setLog(wo, "Guard: lost lock -> skip", "info");
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
