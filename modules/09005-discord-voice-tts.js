/***************************************************************
/* filename: "09005-discord-voice-tts.js"                     *
/* Version 1.0                                                *
/* Purpose: Speak wo.Response via OpenAI TTS into the current  *
/*          Discord voice connection referenced by wo.voiceSessionRef *
/***************************************************************/
/***************************************************************
/*                                                            *
/***************************************************************/

import { getItem, putItem } from "../core/registry.js";
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
/* functionSignature: getDiscordVoiceTTS (coreData)            *
/* Generates TTS audio and plays it into the active connection */
/***************************************************************/
export default async function getDiscordVoiceTTS(coreData) {
  const wo = coreData.workingObject || {};
  const text = (typeof wo.Response === "string" ? wo.Response.trim() : "");
  if (!text) {
    setLog(wo, "No Response to speak", "warn");
    return coreData;
  }

  const model = wo.TTSModel || "gpt-4o-mini-tts";
  const voice = wo.TTSVoice || "alloy";
  const endpoint = wo.TTSEndpoint || "https://api.openai.com/v1/audio/speech";
  const apiKey = wo.TTSAPIKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    setLog(wo, "Missing TTS API key", "error");
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
      return coreData;
    }
    oggOpusBuffer = Buffer.from(await resp.arrayBuffer());
    if (!oggOpusBuffer?.length) {
      setLog(wo, "Empty TTS audio buffer", "error");
      return coreData;
    }
  } catch (e) {
    setLog(wo, "TTS request failed", "error", { error: e?.message || String(e) });
    return coreData;
  }

  const sessionKey = wo.voiceSessionRef;
  if (!sessionKey) {
    setLog(wo, "Missing voiceSessionRef", "error");
    return coreData;
  }

  const session = getItem(sessionKey) || null;
  const connection = session?.connection;
  if (!connection) {
    setLog(wo, "No voice connection available", "error", { sessionKey });
    return coreData;
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
  } catch {
    setLog(wo, "Voice connection not ready", "warn", { sessionKey });
    return coreData;
  }

  let player = session.player;
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    session.player = player;
    try { await putItem(session, sessionKey); } catch {}
  }

  player.on("error", (e) => setLog(wo, `AudioPlayer error: ${e.message}`, "error"));
  player.on(AudioPlayerStatus.Idle, () => setLog(wo, "TTS playback finished", "info"));

  try {
    const resource = await getResourceFromOggOpusBuffer(oggOpusBuffer);
    player.play(resource);
    connection.subscribe(player);
    setLog(wo, "TTS playback started", "info", { bytes: oggOpusBuffer.length, model, voice });
  } catch (e) {
    setLog(wo, "Failed to create/play audio resource", "error", { error: e?.message || String(e) });
  }

  return coreData;
}
