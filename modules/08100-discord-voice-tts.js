/**************************************************************
/* filename: "discord-voice-tts.js"                            *
/* Version 1.0                                                *
/* Purpose: Speak wo.Response once per guild; later TTS is     *
/*          skipped while pipeline persists; events always     *
/*          use the current run                                *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

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

/**************************************************************
/* functionSignature: getNow ()                               *
/* Returns the current timestamp in milliseconds              *
/**************************************************************/
function getNow() { return Date.now(); }

/**************************************************************
/* functionSignature: setLog (wo, message, level = "info",    *
/* extra = {})                                                *
/* Appends a structured log entry into the working object     *
/**************************************************************/
function setLog(wo, message, level = "info", extra = {}) {
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: level,
    module: "discord-voice-tts",
    exitStatus: "success",
    message,
    ...((Object.keys(extra).length && { context: extra }) || {})
  });
}

/**************************************************************
/* functionSignature: setSessionLight (sessionKey, session)   *
/* Saves a session without voice-related objects               *
/**************************************************************/
async function setSessionLight(sessionKey, session) {
  if (!sessionKey || !session) return;
  const { player, connection, ...rest } = session;
  try { await putItem(rest, sessionKey); } catch {}
}

/**************************************************************
/* functionSignature: getBufferToBinaryStream (buf)           *
/* Converts a Buffer to a one-shot readable stream            *
/**************************************************************/
function getBufferToBinaryStream(buf) {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    }
  });
}

/**************************************************************
/* functionSignature: getResourceFromOggOpusBuffer (buf)      *
/* Probes and builds a Discord audio resource from OGG/Opus   *
/**************************************************************/
async function getResourceFromOggOpusBuffer(buf) {
  const bin = getBufferToBinaryStream(buf);
  const { stream, type } = await demuxProbe(bin);
  return createAudioResource(stream, { inputType: type });
}

/**************************************************************
/* functionSignature: getTTSLockKey (guildId)                 *
/* Builds a lock key for a guild-specific TTS mutex           *
/**************************************************************/
function getTTSLockKey(guildId) {
  return `tts-lock-${guildId}`;
}

/**************************************************************
/* functionSignature: getIsLockValid (lock)                   *
/* Validates whether a stored lock object is still active     *
/**************************************************************/
function getIsLockValid(lock) {
  if (!lock || typeof lock !== "object") return false;
  const ttl = Number(lock.ttlMs) || 60000;
  return (getNow() - Number(lock.since || 0)) < ttl;
}

/**************************************************************
/* functionSignature: getIsStillOwner (lockKey, owner)        *
/* Checks if the caller still owns the active lock            *
/**************************************************************/
async function getIsStillOwner(lockKey, owner) {
  const cur = await getItem(lockKey);
  return !!cur && cur.owner === owner && getIsLockValid(cur);
}

/**************************************************************
/* functionSignature: getSanitizedTTSText (text)              *
/* Strips link targets so TTS reads only the visible text     *
/**************************************************************/
function getSanitizedTTSText(text) {
  if (!text) return "";

  let s = String(text);
  s = s.replace(/!\[([^\]]*)\]\(\s*https?:\/\/[^\s)]+?\s*\)/gi, (_, alt) => {
    return (alt || "").trim();
  });
  s = s.replace(/\[([^\]]+)\]\(\s*https?:\/\/[^\s)]+?\s*\)/gi, (_, alt) => {
    return (alt || "").trim();
  });
  s = s.replace(/<\s*https?:\/\/[^>]+>/gi, "");
  s = s.replace(/\bhttps?:\/\/[^\s)>\]}]+/gi, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s*\n\s*\n\s*\n+/g, "\n\n");
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\[\s*\]/g, "");
  s = s.replace(/\{\s*\}/g, "");
  return s.trim();
}

/**************************************************************
/* functionSignature: getDiscordVoiceTTS (coreData)           *
/* Speaks wo.Response through a single TTS stream per guild   *
/**************************************************************/
export default async function getDiscordVoiceTTS(coreData) {
  const wo = coreData.workingObject || {};
  if (wo.silentMode) {
    setLog(wo, "Silent mode enabled -> skip TTS", "info");
    return coreData;
  }
  const raw = (typeof wo.Response === "string" ? wo.Response.trim() : "");
  if (!raw) {
    setLog(wo, "No Response to speak", "warn");
    return coreData;
  }

  const text = getSanitizedTTSText(raw);
  if (!text) {
    setLog(wo, "Response only contained links -> nothing to speak after sanitizing", "info");
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
  await putItem({ owner, since: getNow(), ttlMs, speaking: false }, lockKey);
  const failsafe = setTimeout(async () => {
    try {
      const cur = await getItem(lockKey);
      if (cur?.owner === owner) {
        await deleteItem(lockKey);
      }
    } catch {}
  }, ttlMs + 500);
  const PLAY_MAX_MS = Number(wo.TTSPlayMaxMs || 120000);
  let playWatchdog = null;
  let speakPoll = null;
  async function setReleaseLock(reason = "unknown") {
    try { clearTimeout(failsafe); } catch {}
    try { if (playWatchdog) clearTimeout(playWatchdog); } catch {}
    try { if (speakPoll) clearInterval(speakPoll); } catch {}
    try {
      const cur = await getItem(lockKey);
      if (cur?.owner === owner) {
        await deleteItem(lockKey);
        setLog(wo, "TTS lock released (end-of-run)", "info", { guildId, reason });
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
  let oggOpusBuffer;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, format: "opus" })
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
      await setSessionLight(sessionKey, session);
    }
  }
  player._ttsRelease = setReleaseLock;
  player._ttsOwner = owner;
  player._ttsLockKey = lockKey;
  player._ttsGuildId = guildId;
  if (player.state?.status === AudioPlayerStatus.Playing) {
    setLog(wo, "Player already playing -> release lock & skip TTS", "info");
    await setReleaseLock("player_already_playing");
    return coreData;
  }
  if (player && !player._ttsHandlersBound) {
    player.on("error", (e) => {
      const rel = player._ttsRelease;
      try { setLog(wo, `AudioPlayer error: ${e.message}`, "error"); } catch {}
      rel?.("player_error");
    });
    player.on(AudioPlayerStatus.Playing, async () => {
      const rel = player._ttsRelease;
      const curOwner = player._ttsOwner;
      const lk = player._ttsLockKey;
      try {
        const cur = await getItem(lk);
        if (cur?.owner === curOwner) {
          cur.speaking = true;
          cur.startedAt = getNow();
          await putItem(cur, lk);
        }
      } catch {}
      try {
        if (player._ttsPlayWatchdog) clearTimeout(player._ttsPlayWatchdog);
      } catch {}
      player._ttsPlayWatchdog = setTimeout(() => rel?.("play_watchdog_timeout"), Number(coreData.workingObject?.TTSPlayMaxMs || 120000));
      player._ttsSpeakPoll = setInterval(() => {
        const st = player.state?.status;
        if (st !== AudioPlayerStatus.Playing) {
          const r = player._ttsRelease;
          r?.("speak_poll_end");
        }
      }, 1000);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      const rel = player._ttsRelease;
      rel?.("idle");
    });
    connection.on?.("stateChange", (_old, newState) => {
      if (newState.status !== VoiceConnectionStatus.Ready) {
        const rel = player._ttsRelease;
        rel?.("conn_state_change");
      }
    });
    player._ttsHandlersBound = true;
  } else {
    player._ttsRelease = setReleaseLock;
    player._ttsOwner = owner;
    player._ttsLockKey = lockKey;
    player._ttsGuildId = guildId;
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
