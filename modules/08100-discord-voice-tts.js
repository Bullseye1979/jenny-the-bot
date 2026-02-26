/**************************************************************/
/* filename: "discord-voice-tts.js"                            */
/* Version: 1.0                                                */
/* Purpose: Speak wo.response with optional [Speaker: <voice>]  */
/*          tags, prerender segments, and play sequentially     */
/* Notes:                                                      */
/*  - wo.ttsVoice is only the default voice.                   */
/*  - [speaker: <name>] is treated as the voice enum to use    */
/*    from that point on (lowercased).                         */
/*  - [speaker: default] or unclear/empty uses default voice.  */
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

/**************************************************************/
/* functionSignature: getNow ()                               */
/* Returns the current timestamp in milliseconds              */
/**************************************************************/
function getNow() {
  return Date.now();
}

/**************************************************************/
/* functionSignature: setLog (wo, message, level = "info",     */
/* extra = {})                                                */
/* Appends a structured log entry into the working object     */
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

/**************************************************************/
/* functionSignature: setSessionLight (sessionKey, session)   */
/* Saves a session without voice-related objects              */
/**************************************************************/
async function setSessionLight(sessionKey, session) {
  if (!sessionKey || !session) return;

  const { player, connection, ...rest } = session;

  try {
    await putItem(rest, sessionKey);
  } catch {}
}

/**************************************************************/
/* functionSignature: getBufferToBinaryStream (buf)           */
/* Converts a Buffer to a one-shot readable stream            */
/**************************************************************/
function getBufferToBinaryStream(buf) {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    }
  });
}

/**************************************************************/
/* functionSignature: getResourceFromOggOpusBuffer (buf)      */
/* Probes and builds a Discord audio resource from OGG/Opus   */
/**************************************************************/
async function getResourceFromOggOpusBuffer(buf) {
  const bin = getBufferToBinaryStream(buf);
  const { stream, type } = await demuxProbe(bin);
  return createAudioResource(stream, { inputType: type });
}

/**************************************************************/
/* functionSignature: getTTSLockKey (guildId)                 */
/* Builds a lock key for a guild-specific TTS mutex           */
/**************************************************************/
function getTTSLockKey(guildId) {
  return `tts-lock-${guildId}`;
}

/**************************************************************/
/* functionSignature: getIsLockValid (lock)                   */
/* Validates whether a stored lock object is still active     */
/**************************************************************/
function getIsLockValid(lock) {
  if (!lock || typeof lock !== "object") return false;
  const ttl = Number(lock.ttlMs) || 60000;
  return (getNow() - Number(lock.since || 0)) < ttl;
}

/**************************************************************/
/* functionSignature: getIsStillOwner (lockKey, owner)        */
/* Checks if the caller still owns the active lock            */
/**************************************************************/
async function getIsStillOwner(lockKey, owner) {
  const cur = await getItem(lockKey);
  return !!cur && cur.owner === owner && getIsLockValid(cur);
}

/**************************************************************/
/* functionSignature: getSanitizedTTSText (text)              */
/* Strips link targets so TTS reads only the visible text     */
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

/**************************************************************/
/* functionSignature: getNormalizedTagValue (raw)             */
/* Normalizes a [speaker: ...] tag value                      */
/**************************************************************/
function getNormalizedTagValue(raw) {
  let s = (raw ?? "");
  if (typeof s !== "string") s = String(s);

  s = s.trim();
  s = s.replace(/^<\s*/g, "");
  s = s.replace(/\s*>$/g, "");
  s = s.replace(/\s+/g, " ");
  s = s.toLowerCase();

  return s;
}

/**************************************************************/
/* functionSignature: getNormalizedVoiceKey (voiceRaw)        */
/* Normalizes a voice name into a stable API enum             */
/**************************************************************/
function getNormalizedVoiceKey(voiceRaw) {
  let v = (voiceRaw ?? "");
  if (typeof v !== "string") v = String(v);
  return v.trim().toLowerCase();
}

/**************************************************************/
/* functionSignature: getIsVoiceSessionRefUsable (ref)        */
/* Returns true if voiceSessionRef is a usable registry key   */
/**************************************************************/
function getIsVoiceSessionRefUsable(ref) {
  if (ref === null || ref === undefined) return false;

  let s = ref;
  if (typeof s !== "string") s = String(s);
  s = s.trim();

  if (!s) return false;

  const lowered = s.toLowerCase();
  if (lowered === "null") return false;
  if (lowered === "undefined") return false;

  return true;
}

/**************************************************************/
/* functionSignature: getTTSSpeakerSegments (rawText)         */
/* Splits text into voice segments based on [Speaker: <voice>]*/
/* - Tag value is used as the voice enum                      */
/* - "default"/empty maps to sentinel "default"               */
/**************************************************************/
function getTTSSpeakerSegments(rawText) {
  const src = (typeof rawText === "string" ? rawText : String(rawText ?? ""));
  const re = /\[\s*speaker\s*:\s*([^\]]*?)\s*\]/gi;

  const segments = [];
  let foundTag = false;
  let current = "default";
  let lastIndex = 0;
  let m;

  while ((m = re.exec(src)) !== null) {
    foundTag = true;

    const chunk = src.slice(lastIndex, m.index);
    if (chunk) segments.push({ voice: current, text: chunk });

    const tagVal = getNormalizedTagValue(m[1]);
    if (!tagVal || tagVal === "default") current = "default";
    else current = tagVal;

    lastIndex = m.index + m[0].length;
  }

  const tail = src.slice(lastIndex);
  if (tail) segments.push({ voice: current, text: tail });

  const cleaned = [];
  for (const seg of segments) {
    const t = getSanitizedTTSText(seg.text);
    if (!t) continue;

    const voice = getNormalizedVoiceKey(seg.voice) || "default";

    if (!cleaned.length) {
      cleaned.push({ voice, text: t });
      continue;
    }

    const prev = cleaned[cleaned.length - 1];
    if (prev.voice === voice) prev.text = `${prev.text}\n\n${t}`.trim();
    else cleaned.push({ voice, text: t });
  }

  return { segments: cleaned, foundTag };
}

/**************************************************************/
/* functionSignature: getRenderConcurrency (wo, segmentsLen)  */
/* Picks a safe default concurrency for prerendering          */
/**************************************************************/
function getRenderConcurrency(wo, segmentsLen) {
  const v = Number(wo?.TTSRenderConcurrency);
  if (Number.isFinite(v) && v > 0) return Math.min(8, Math.max(1, Math.floor(v)));
  if (segmentsLen <= 1) return 1;
  return 2;
}

/**************************************************************/
/* functionSignature: getPrerenderedSegmentBuffers (items,    */
/* concurrency, guardFn, refreshFn, renderFn)                 */
/* Prefetches TTS audio buffers with limited concurrency      */
/**************************************************************/
async function getPrerenderedSegmentBuffers(items, concurrency, guardFn, refreshFn, renderFn) {
  const out = new Array(items.length);
  let next = 0;

  /**************************************************************/
  /* functionSignature: worker (workerId)                        */
  /* Worker loop for prerender queue                             */
  /**************************************************************/
  const worker = async (workerId) => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;

      if (!(await guardFn())) throw new Error("Lost lock while prerendering");
      await refreshFn(`render_segment_${idx + 1}_of_${items.length}_w${workerId}`);

      const it = items[idx];
      const buf = await renderFn(it.text, it.voice);
      out[idx] = { ...it, buffer: buf };

      await refreshFn(`rendered_segment_${idx + 1}_of_${items.length}_w${workerId}`);
    }
  };

  const workers = [];
  const n = Math.max(1, Math.min(concurrency, items.length));
  for (let i = 0; i < n; i++) workers.push(worker(i + 1));

  await Promise.all(workers);
  return out;
}

/**************************************************************/
/* functionSignature: getDiscordVoiceTTS (coreData)           */
/* Speaks wo.response through a single TTS stream per guild   */
/**************************************************************/
export default async function getDiscordVoiceTTS(coreData) {
  const wo = coreData.workingObject || {};

  if (wo.deactivateSpeech) {
    setLog(wo, "deactivateSpeech enabled -> skip TTS entirely", "info");
    wo.ttsSkipped = true;
    return coreData;
  }

  const raw = (typeof wo.response === "string" ? wo.response.trim() : "");
  if (!raw) {
    setLog(wo, "No response to speak", "warn");
    return coreData;
  }

  const { segments: voiceSegments, foundTag } = getTTSSpeakerSegments(raw);
  if (!voiceSegments.length) {
    setLog(wo, "response only contained links -> nothing to speak after sanitizing", "info");
    return coreData;
  }

  const sessionKey = wo.voiceSessionRef;
  if (!getIsVoiceSessionRefUsable(sessionKey)) {
    wo.ttsSkipped = true;
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
  const owner = `tts:${sessionKey}:${getNow()}:${Math.random().toString(36).slice(2, 8)}`;
  await putItem({ owner, since: getNow(), ttlMs, speaking: false }, lockKey);

  let failsafe = null;

  /**************************************************************/
  /* functionSignature: bumpLockFailsafe ()                      */
  /* Arms/rearms a failsafe timer to release stale locks         */
  /**************************************************************/
  function bumpLockFailsafe() {
    try {
      if (failsafe) clearTimeout(failsafe);
    } catch {}

    failsafe = setTimeout(async () => {
      try {
        const cur = await getItem(lockKey);
        if (cur?.owner === owner) await deleteItem(lockKey);
      } catch {}
    }, ttlMs + 500);
  }

  bumpLockFailsafe();

  /**************************************************************/
  /* functionSignature: setReleaseLock (reason = "unknown")      */
  /* Releases the guild lock for this run (best-effort)          */
  /**************************************************************/
  async function setReleaseLock(reason = "unknown") {
    try {
      if (failsafe) clearTimeout(failsafe);
    } catch {}

    try {
      const player = session?.player;
      if (player?._ttsPlayWatchdog) clearTimeout(player._ttsPlayWatchdog);
      if (player?._ttsSpeakPoll) clearInterval(player._ttsSpeakPoll);
      if (player) {
        player._ttsPlayWatchdog = null;
        player._ttsSpeakPoll = null;
      }
    } catch {}

    try {
      const cur = await getItem(lockKey);
      if (cur?.owner === owner) {
        await deleteItem(lockKey);
        setLog(wo, "TTS lock released (end-of-run)", "info", { guildId, reason });
      }
    } catch {}
  }

  const model = wo.ttsModel || "gpt-4o-mini-tts";
  const defaultVoice = getNormalizedVoiceKey(wo.ttsVoice) || "alloy";
  const endpoint = wo.ttsEndpoint || "https://api.openai.com/v1/audio/speech";
  const apiKey = wo.ttsApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    setLog(wo, "Missing TTS API key", "error");
    await setReleaseLock("no_api_key");
    return coreData;
  }

  /**************************************************************/
  /* functionSignature: refreshLock (reason = "refresh")         */
  /* Refreshes lock TTL and re-arms failsafe                     */
  /**************************************************************/
  async function refreshLock(reason = "refresh") {
    try {
      const cur = await getItem(lockKey);
      if (cur?.owner !== owner) return false;

      cur.since = getNow();
      cur.lastRefreshReason = reason;

      await putItem(cur, lockKey);
      bumpLockFailsafe();
      return true;
    } catch {
      return false;
    }
  }

  /**************************************************************/
  /* functionSignature: guardOwner ()                            */
  /* Verifies this execution still owns the active lock          */
  /**************************************************************/
  async function guardOwner() {
    return await getIsStillOwner(lockKey, owner);
  }

  /**************************************************************/
  /* functionSignature: getTTSBufferForSegment (input, voice)    */
  /* Calls the TTS endpoint and returns an Opus buffer           */
  /**************************************************************/
  async function getTTSBufferForSegment(input, voice) {
    const v = getNormalizedVoiceKey(voice) || defaultVoice;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        voice: v,
        input,
        response_format: "opus"
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      throw new Error(`TTS HTTP ${resp.status}: ${errTxt.slice(0, 200)}`);
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf?.length) throw new Error("Empty TTS audio buffer");
    return buf;
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

  const hasMultiVoice = foundTag && voiceSegments.length > 1;
  player._ttsAutoRelease = !hasMultiVoice;

  if (player.state?.status === AudioPlayerStatus.Playing) {
    setLog(wo, "Player already playing -> release lock & skip TTS", "info");
    await setReleaseLock("player_already_playing");
    return coreData;
  }

  if (player && !player._ttsHandlersBound) {
    player.on("error", (e) => {
      const rel = player._ttsRelease;
      try {
        setLog(wo, `AudioPlayer error: ${e.message}`, "error");
      } catch {}
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

      player._ttsPlayWatchdog = setTimeout(
        () => rel?.("play_watchdog_timeout"),
        Number(coreData.workingObject?.TTSPlayMaxMs || 120000)
      );

      player._ttsSpeakPoll = setInterval(() => {
        const st = player.state?.status;
        if (st !== AudioPlayerStatus.Playing) {
          try {
            if (player._ttsSpeakPoll) clearInterval(player._ttsSpeakPoll);
          } catch {}

          player._ttsSpeakPoll = null;

          if (player._ttsAutoRelease) {
            const r = player._ttsRelease;
            r?.("speak_poll_end");
          }
        }
      }, 1000);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      try {
        if (player._ttsSpeakPoll) clearInterval(player._ttsSpeakPoll);
      } catch {}

      player._ttsSpeakPoll = null;

      if (player._ttsAutoRelease) {
        const rel = player._ttsRelease;
        rel?.("idle");
      }
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

  const renderItems = [];
  for (let i = 0; i < voiceSegments.length; i++) {
    const seg = voiceSegments[i];

    const tagVoice = getNormalizedVoiceKey(seg.voice);
    const effectiveVoice = (!tagVoice || tagVoice === "default") ? defaultVoice : tagVoice;

    renderItems.push({
      index: i,
      voice: effectiveVoice,
      text: seg.text
    });
  }

  const renderConcurrency = getRenderConcurrency(wo, renderItems.length);
  let prerendered = null;

  try {
    if (renderItems.length > 1) {
      setLog(wo, "TTS prerender started", "info", {
        segments: renderItems.length,
        concurrency: renderConcurrency
      });

      prerendered = await getPrerenderedSegmentBuffers(
        renderItems,
        renderConcurrency,
        guardOwner,
        refreshLock,
        getTTSBufferForSegment
      );

      setLog(wo, "TTS prerender finished", "info", {
        segments: prerendered.length,
        bytesTotal: prerendered.reduce((a, x) => a + (x?.buffer?.length || 0), 0)
      });
    } else {
      await refreshLock("render_single_segment");

      const one = renderItems[0];
      const buf = await getTTSBufferForSegment(one.text, one.voice);
      prerendered = [{ ...one, buffer: buf }];
    }
  } catch (e) {
    setLog(wo, "Failed during TTS prerender", "error", { error: e?.message || String(e) });
    await setReleaseLock("prerender_failed");
    return coreData;
  }

  const PLAY_MAX_MS = Number(wo.TTSPlayMaxMs || 120000);

  try {
    for (let i = 0; i < prerendered.length; i++) {
      const seg = prerendered[i];

      if (player.state?.status === AudioPlayerStatus.Playing) {
        setLog(wo, "Guard: player already playing -> abort", "info");
        await setReleaseLock("guard_playing");
        return coreData;
      }

      if (!(await guardOwner())) {
        setLog(wo, "Guard: lost lock -> abort", "info");
        return coreData;
      }

      await refreshLock(`play_segment_${i + 1}_of_${prerendered.length}`);

      const resource = await getResourceFromOggOpusBuffer(seg.buffer);

      player.play(resource);
      connection.subscribe(player);

      setLog(wo, "TTS segment playback started", "info", {
        segment: i + 1,
        segments: prerendered.length,
        voice: seg.voice,
        bytes: seg.buffer.length,
        model
      });

      try {
        await entersState(player, AudioPlayerStatus.Playing, 15000);
      } catch {
        setLog(wo, "TTS segment failed to enter Playing state", "warn", { segment: i + 1 });
      }

      try {
        await entersState(player, AudioPlayerStatus.Idle, PLAY_MAX_MS);
      } catch {
        setLog(wo, "TTS segment playback timeout", "warn", { segment: i + 1, maxMs: PLAY_MAX_MS });
        await setReleaseLock("segment_timeout");
        return coreData;
      }
    }

    if (!hasMultiVoice) {
      setLog(wo, "TTS playback finished", "info", { model, voice: defaultVoice });
    } else {
      setLog(wo, "TTS multi-voice playback finished", "info", {
        model,
        defaultVoice,
        usedVoices: Array.from(new Set(prerendered.map(s => s.voice || defaultVoice)))
      });
    }
  } catch (e) {
    setLog(wo, "Failed during multi-segment playback", "error", { error: e?.message || String(e) });
    await setReleaseLock("multi_segment_failed");
    return coreData;
  }

  await setReleaseLock("end_of_segments");
  return coreData;
}
