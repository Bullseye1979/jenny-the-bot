/************************************************************************************/
/* filename: bard.js                                                                 *
/* Version 1.0                                                                       *
/* Purpose: Bard Bot flow — initializes a second Discord client, polls bard:registry *
/*          every 30 seconds, selects music from library.xml based on bard:labels,   *
/*          and plays MP3s via @discordjs/voice.                                     *
/************************************************************************************/

/************************************************************************************/
/*                                                                                   *
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import discordJs from "discord.js";
const { Client, GatewayIntentBits, ActivityType } = discordJs;
import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType
} from "@discordjs/voice";
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/************************************************************************************/
/* functionSignature: getParseLibraryXml (xmlText)                                  *
/* Parses library.xml content into [{file, title, tags[]}] without external deps.   *
/************************************************************************************/
function getParseLibraryXml(xmlText) {
  const tracks = [];
  const trackRe = /<track\s+([^>]+)>([\s\S]*?)<\/track>/gi;
  let m;
  while ((m = trackRe.exec(xmlText)) !== null) {
    const attrStr = m[1];
    const inner = m[2];
    const fileM = /file="([^"]*)"/.exec(attrStr);
    const titleM = /title="([^"]*)"/.exec(attrStr);
    const tagsM   = /<tags>([^<]*)<\/tags>/.exec(inner);
    const volumeM = /<volume>([^<]*)<\/volume>/.exec(inner);
    if (fileM && tagsM) {
      const rawVol = volumeM ? parseFloat(volumeM[1]) : NaN;
      tracks.push({
        file:   fileM[1].trim(),
        title:  titleM ? titleM[1].trim() : fileM[1].trim(),
        tags:   tagsM[1].split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
        volume: Number.isFinite(rawVol) ? Math.max(0.1, Math.min(4.0, rawVol)) : 1.0
      });
    }
  }
  return tracks;
}

/************************************************************************************/
/* functionSignature: getLoadLibrary (musicDir)                                      *
/* Loads and parses library.xml from the given directory. Returns [] on failure.     *
/************************************************************************************/
const LIBRARY_XML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>\n<library>\n</library>\n`;

function getLoadLibrary(musicDir) {
  try {
    const xmlPath = path.join(musicDir, "library.xml");
    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
    }
    if (!fs.existsSync(xmlPath)) {
      fs.writeFileSync(xmlPath, LIBRARY_XML_EMPTY, "utf8");
      return [];
    }
    const xmlText = fs.readFileSync(xmlPath, "utf8");
    const tracks = getParseLibraryXml(xmlText);
    for (const t of tracks) {
    }
    return tracks;
  } catch (e) {
    return [];
  }
}

/************************************************************************************/
/* functionSignature: getSelectSong (labels, library, currentFile, excludeFile)      *
/* Selects the best-matching song for the given labels. Returns null if currentFile  *
/* still matches (no change needed) or if library is empty.                          *
/************************************************************************************/
function getSelectSong(labels, library, currentFile, excludeFile = null) {
  if (!Array.isArray(library) || !library.length) return null;
  if (!Array.isArray(labels)) labels = [];

  const labelSet = new Set(labels.map(l => String(l).toLowerCase()));

  if (currentFile) {
    const current = library.find(t => t.file === currentFile);
    if (current) {
      const matches = current.tags.filter(t => labelSet.has(t)).length;
      if (matches >= 1) {
        return null;
      }
    }
  }

  const excluded = excludeFile || currentFile;
  const pool = excluded ? library.filter(t => t.file !== excluded) : library;
  if (!pool.length) {
    const single = library[0];
    return single || null;
  }

  const scored = pool.map(track => ({
    track,
    score: track.tags.filter(t => labelSet.has(t)).length
  }));

  // Weighted random: tracks with more matching labels are proportionally more likely,
  // but not guaranteed — avoids the same high-scoring song looping forever.
  // Tracks with score 0 are only used as fallback when nothing matches any label.
  const positiveScored = scored.filter(s => s.score > 0);
  const candidates = positiveScored.length > 0 ? positiveScored : scored;

  const totalWeight = candidates.reduce((sum, s) => sum + Math.max(1, s.score), 0);
  let r = Math.random() * totalWeight;
  for (const s of candidates) {
    r -= Math.max(1, s.score);
    if (r <= 0) return s.track;
  }
  return candidates[candidates.length - 1].track;
}

/************************************************************************************/
/* functionSignature: setIdlePresence (text)                                         *
/* Sets the bard client's Discord presence to the configured idle text.              *
/* Clears all activities when text is empty.                                         *
/************************************************************************************/
async function setIdlePresence(text) {
  try {
    const bardClient = await getItem("bard:client");
    if (!bardClient?.user) return;
    bardClient.user.setPresence({ activities: [{ name: text || "...", type: ActivityType.Listening }], status: "online" });
  } catch {}
}

/************************************************************************************/
/* functionSignature: setFadeIn (session, resource, targetVol, durationMs)          *
/* Gradually increases resource volume from 0 to targetVol over durationMs ms.      *
/* Cancels any previously running fade-in. Stores interval on session._fadeInIv.    *
/************************************************************************************/
function setFadeIn(session, resource, targetVol, durationMs) {
  if (session._fadeInIv) { clearInterval(session._fadeInIv); session._fadeInIv = null; }
  if (!resource?.volume || !(durationMs > 0)) return;
  try { resource.volume.setVolume(0); } catch {}
  const steps = Math.min(40, Math.max(10, Math.round(durationMs / 50)));
  const stepMs = durationMs / steps;
  let step = 0;
  const iv = setInterval(() => {
    step++;
    const v = Math.min(targetVol, (step / steps) * targetVol);
    try { resource.volume.setVolume(v); } catch {}
    if (step >= steps) { clearInterval(iv); if (session._fadeInIv === iv) session._fadeInIv = null; }
  }, stepMs);
  session._fadeInIv = iv;
}

/************************************************************************************/
/* functionSignature: setFadeOut (session, resource, fromVol, durationMs)            *
/* Cancels any running fade-in, then gradually decreases resource volume to 0.      *
/* fromVol must be the known current volume — do NOT read from the transformer.     *
/* Returns a Promise that resolves when done.                                        *
/************************************************************************************/
function setFadeOut(session, resource, fromVol, durationMs) {
  // Stop any running fade-in first so they don't fight each other
  if (session._fadeInIv) { clearInterval(session._fadeInIv); session._fadeInIv = null; }
  return new Promise(resolve => {
    if (!resource?.volume || !(durationMs > 0) || !(fromVol > 0)) { resolve(); return; }
    const steps = Math.min(40, Math.max(10, Math.round(durationMs / 50)));
    const stepMs = durationMs / steps;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      const v = Math.max(0, fromVol * (1 - step / steps));
      try { resource.volume.setVolume(v); } catch {}
      if (step >= steps) { clearInterval(iv); resolve(); }
    }, stepMs);
  });
}

/************************************************************************************/
/* functionSignature: setSchedulePreFade (session, resource, filePath, fadeMs, log) *
/* Uses ffprobe to read the track duration, then schedules a pre-emptive fade-out   *
/* fadeDurationMs before the song ends so natural transitions have a smooth fade.   *
/* Fire-and-forget — errors are silently swallowed.                                 *
/************************************************************************************/
async function setSchedulePreFade(session, resource, filePath, fadeMs, log) {
  try {
    const { default: ffmpeg } = await import("fluent-ffmpeg");
    const durationSec = await new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, meta) => {
        resolve(err ? 0 : (Number(meta?.format?.duration) || 0));
      });
    });
    if (!(durationSec > 0)) return;
    // Schedule fade-out to start (fadeDurationMs + 200ms margin) before track ends
    const delayMs = Math.max(0, durationSec * 1000 - fadeMs - 200);
    const timer = setTimeout(async () => {
      // Only fade if this resource is still the active one (not already switched)
      if (session._currentResource === resource) {
        const fromVol = session._currentVolume ?? 1.0;
        await setFadeOut(session, resource, fromVol, fadeMs).catch(() => {});
      }
    }, delayMs);
    if (typeof timer?.unref === "function") timer.unref();
    // Cancel previous timer and store the new one
    if (session._preFadeTimer) clearTimeout(session._preFadeTimer);
    session._preFadeTimer = timer;
  } catch {}
}

/************************************************************************************/
/* functionSignature: setPlayTrack (session, track, musicDir, log, cfg, fadeOpts)   *
/* Creates an audio resource and plays it on the session's player.                   *
/* fadeOpts.fadeIn=true  → fade volume in from 0 (eliminates silence gap).          *
/* fadeOpts.fadeOut=true → fade out current resource before switching (crossfade).  *
/************************************************************************************/
async function setPlayTrack(session, track, musicDir, log, cfg, { fadeIn = true, fadeOut = false } = {}) {
  try {
    const filePath = path.resolve(musicDir, track.file);
    if (!fs.existsSync(filePath)) {
      log(`audio file not found: ${filePath}`, "warn", { moduleName: MODULE_NAME });
      return false;
    }
    const fadeMs = Number.isFinite(Number(cfg?.fadeDurationMs)) ? Math.max(0, Number(cfg.fadeDurationMs)) : 1200;
    // Cancel any pending pre-fade timer from the previous track
    if (session._preFadeTimer) { clearTimeout(session._preFadeTimer); session._preFadeTimer = null; }
    // Fade out the currently playing resource before switching (crossfade / label change).
    // Use the stored volume — never read from VolumeTransformer state which may be mid-fade-in.
    if (fadeOut && session._currentResource && fadeMs > 0) {
      const fromVol = session._currentVolume ?? 1.0;
      await setFadeOut(session, session._currentResource, fromVol, fadeMs);
    }
    const resource = createAudioResource(filePath, { inputType: StreamType.Arbitrary, inlineVolume: true });
    const vol = Number.isFinite(track.volume) ? Math.max(0.1, Math.min(4.0, track.volume)) : 1.0;
    session._currentVolume = vol;   // remember for future fade-outs
    session._lastPlayedFile = track.file; // remember for post-song exclusion
    // Start silent if fading in so there is no gap between tracks
    if (resource.volume) resource.volume.setVolume(fadeIn && fadeMs > 0 ? 0 : vol);
    session.player.play(resource);
    session._currentResource = resource;
    // Fade in the new track (cancels any leftover fade-in from the previous track)
    if (fadeIn && fadeMs > 0) setFadeIn(session, resource, vol, fadeMs);
    // Schedule pre-emptive fade-out near the song's end (fire-and-forget)
    if (fadeMs > 0) setSchedulePreFade(session, resource, filePath, fadeMs, log).catch(() => {});
    const nowTs = new Date().toISOString();
    const nowPlaying = {
      file: track.file,
      title: track.title,
      labels: session._lastLabels || [],
      startedAt: nowTs
    };
    await putItem(nowPlaying, `bard:nowplaying:${session.guildId}`);
    // Also store stream entry (includes musicDir so webpage module can serve the file)
    await putItem({ guildId: session.guildId, file: track.file, title: track.title, labels: session._lastLabels || [], startedAt: nowTs, musicDir }, `bard:stream:${session.guildId}`);
    try {
      const bardClient = await getItem("bard:client");
      if (bardClient?.user) {
        const songName = track.title || path.basename(track.file, path.extname(track.file));
        bardClient.user.setPresence({ activities: [{ name: songName, type: ActivityType.Listening }], status: "online" });
      }
    } catch {}
    log(`now playing: "${track.title}" (${track.file})`, "info", {
      moduleName: MODULE_NAME,
      guildId: session.guildId,
      labels: session._lastLabels || []
    });
    return true;
  } catch (e) {
    log(`playTrack error: ${e?.message}`, "warn", { moduleName: MODULE_NAME });
    return false;
  }
}

/************************************************************************************/
/* functionSignature: setBindSessionPlayer (session, sessionKey, log, triggerPoll)  *
/* Binds the Idle event to the session player (once per session). On song end,      *
/* clears stream/nowplaying state and triggers an immediate poll cycle so the poll  *
/* loop is the sole authority for picking the next song.                            *
/************************************************************************************/
function setBindSessionPlayer(session, sessionKey, log, triggerPoll) {
  if (session._playerBound) return;
  session._playerBound = true;

  const player = session.player;

  player.on(AudioPlayerStatus.Idle, async () => {
    try {
      log("song ended, triggering next poll cycle", "info", { moduleName: MODULE_NAME, sessionKey });
      // Clear playback state so the poll picks the next song cleanly.
      try { await deleteItem(`bard:stream:${session.guildId}`); } catch {}
      try { await deleteItem(`bard:nowplaying:${session.guildId}`); } catch {}
    } catch (e) {
      log(`idle-handler error: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    } finally {
      triggerPoll();
    }
  });

  player.on("error", (err) => {
    log(`player error: ${err?.message}`, "warn", { moduleName: MODULE_NAME, sessionKey });
  });

  player.on(AudioPlayerStatus.Playing, () => {
  });

  player.on(AudioPlayerStatus.Buffering, () => {
  });

  player.on(AudioPlayerStatus.Paused, () => {
  });
}

/************************************************************************************/
/* functionSignature: getScanAndPlay (musicDir, pollMs, log, idlePresence, cfg)      *
/* Returns the polling function. The poll loop is the sole authority for song        *
/* selection. A triggerPoll() closure lets the Idle event handler fire an immediate  *
/* poll without racing a currently-running cycle.                                    *
/************************************************************************************/
function getScanAndPlay(musicDir, pollMs, log, idlePresence, cfg) {
  let _running = false;
  let _pendingPoll = false;

  function triggerPoll() {
    if (!_running) { scanAndPlay(); } else { _pendingPoll = true; }
  }

  async function scanAndPlay() {
    if (_running) { _pendingPoll = true; return; }
    _running = true;
    _pendingPoll = false;
    try {
      const library = getLoadLibrary(musicDir);
      const reg = await getItem("bard:registry");
      const keys = Array.isArray(reg?.list) ? reg.list : [];

      if (!keys.length) {
        await setIdlePresence(idlePresence);
        return;
      }

      for (const sessionKey of keys) {
        try {
          const session = await getItem(sessionKey);

          if (!session?.player || !session?.connection) {
            continue;
          }

          const playerState = session.player?.state?.status;
          const labelsData = await getItem(`bard:labels:${session.guildId}`);
          const nowPlaying = await getItem(`bard:nowplaying:${session.guildId}`);
          const currentFile = nowPlaying?.file || null;

          let labels = Array.isArray(labelsData?.labels) ? labelsData.labels : [];
          if (labels.length === 0 && Array.isArray(nowPlaying?.labels) && nowPlaying.labels.length) {
            labels = nowPlaying.labels;
          }

          log(`[label-debug] guild=${session.guildId} playerState=${playerState} labels=[${labels.join(",")}] labelsUpdatedAt=${labelsData?.updatedAt||"none"} currentFile=${currentFile||"none"}`, "info", { moduleName: MODULE_NAME });

          setBindSessionPlayer(session, sessionKey, log, triggerPoll);

          const isPlaying = playerState === AudioPlayerStatus.Playing ||
                            playerState === AudioPlayerStatus.Buffering;

          if (isPlaying) {
            if (labels.length === 0) {
              continue;
            }
            // Only react when labels actually changed since this track started.
            const trackLabels = Array.isArray(nowPlaying?.labels) ? nowPlaying.labels : [];
            const sameLabels = [...labels].sort().join(",") === [...trackLabels].sort().join(",");
            log(`[label-debug] guild=${session.guildId} isPlaying=true trackLabels=[${trackLabels.join(",")}] sameLabels=${sameLabels}`, "info", { moduleName: MODULE_NAME });
            if (sameLabels) {
              continue;
            }
            // Labels changed — switch only if the current song no longer fits.
            const next = getSelectSong(labels, library, currentFile);
            if (next === null) {
              // Song still fits; update stored labels to prevent re-check next poll.
              if (nowPlaying) {
                await putItem({ ...nowPlaying, labels }, `bard:nowplaying:${session.guildId}`);
              }
              continue;
            }
            session._lastLabels = labels;
            // Labels changed mid-song: fade out current, then fade in new (crossfade)
            await setPlayTrack(session, next, musicDir, log, cfg, { fadeIn: true, fadeOut: true });
          } else {
            // Use _lastPlayedFile as exclude fallback — nowplaying was cleared by the Idle handler
            // so currentFile is null, but we still want to avoid immediately repeating the last song.
            const next = getSelectSong(labels, library, null, session._lastPlayedFile || currentFile);
            if (!next) {
              try { await deleteItem(`bard:stream:${session.guildId}`); } catch {}
              await setIdlePresence(idlePresence);
              continue;
            }
            session._lastLabels = labels;
            // Player was idle (not playing): fade in new track, no fade-out needed
            await setPlayTrack(session, next, musicDir, log, cfg, { fadeIn: true, fadeOut: false });
          }
        } catch (e) {
          log(`session scan error for ${sessionKey}: ${e?.message}`, "error", { moduleName: MODULE_NAME });
        }
      }
    } catch (e) {
      log(`scanAndPlay error: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    } finally {
      _running = false;
      if (_pendingPoll) {
        _pendingPoll = false;
        setImmediate(scanAndPlay);
      } else {
        setTimeout(scanAndPlay, pollMs);
      }
    }
  }
  return scanAndPlay;
}

/************************************************************************************/
/* functionSignature: getBardFlow (baseCore, runFlow, createRunCore)                 *
/* Initializes the Bard Discord client, caches the music library, and starts the     *
/* playback poller.                                                                  *
/************************************************************************************/
export default async function getBardFlow(baseCore, runFlow, createRunCore) {
  const rc = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);

  const cfg = baseCore?.config?.[MODULE_NAME] || {};

  const PLACEHOLDER = "BARD_BOT_TOKEN_HERE";
  if (!cfg.token || cfg.token === PLACEHOLDER) {
    log("bard.token not set (still placeholder) — bard flow idle", "warn", { moduleName: MODULE_NAME });
    return;
  }

  const pollMs = Number.isFinite(Number(cfg.pollIntervalMs))
    ? Math.max(5000, Number(cfg.pollIntervalMs))
    : 30000;

  const musicDir = path.resolve(
    __dirname, "..",
    typeof cfg.musicDir === "string" ? cfg.musicDir : "assets/bard"
  );

  const idlePresence = typeof cfg.idlePresence === "string" ? cfg.idlePresence : "";


  const startupLibrary = getLoadLibrary(musicDir);
  log(`library loaded: ${startupLibrary.length} track(s)`, "info", { moduleName: MODULE_NAME, musicDir });

  let bardClient;
  try {
    bardClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("bard bot login timeout after 15s")), 15000);
      const done = (fn) => (...args) => { clearTimeout(timer); fn(...args); };
      bardClient.once("clientReady", done(resolve));
      bardClient.once("error", done(reject));
      bardClient.login(cfg.token).catch(done(reject));
    });

    await putItem(bardClient, "bard:client");
    log(`bard bot logged in as ${bardClient.user?.tag}`, "info", { moduleName: MODULE_NAME });
  } catch (e) {
    log(`bard bot login failed: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    return;
  }

  const scanAndPlay = getScanAndPlay(musicDir, pollMs, log, idlePresence, cfg);
  setTimeout(scanAndPlay, 1000);
}
