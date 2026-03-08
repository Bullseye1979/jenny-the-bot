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

  const maxScore = Math.max(...scored.map(s => s.score));
  const candidates = maxScore > 0
    ? scored.filter(s => s.score === maxScore)
    : scored;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  if (pick) {
  } else {
  }

  return pick ? pick.track : null;
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
    if (text) {
      bardClient.user.setPresence({ activities: [{ name: text, type: ActivityType.Listening }], status: "online" });
    } else {
      bardClient.user.setPresence({ activities: [], status: "online" });
    }
  } catch {}
}

/************************************************************************************/
/* functionSignature: setPlayTrack (session, track, musicDir, log)                   *
/* Creates an audio resource and plays it on the session's player.                   *
/************************************************************************************/
async function setPlayTrack(session, track, musicDir, log) {
  try {
    const filePath = path.resolve(musicDir, track.file);
    if (!fs.existsSync(filePath)) {
      log(`audio file not found: ${filePath}`, "warn", { moduleName: MODULE_NAME });
      return false;
    }
    const resource = createAudioResource(filePath, { inputType: StreamType.Arbitrary, inlineVolume: true });
    const vol = Number.isFinite(track.volume) ? Math.max(0.1, Math.min(4.0, track.volume)) : 1.0;
    if (resource.volume) resource.volume.setVolume(vol);
    session.player.play(resource);
    const nowPlaying = {
      file: track.file,
      title: track.title,
      labels: session._lastLabels || [],
      startedAt: new Date().toISOString()
    };
    await putItem(nowPlaying, `bard:nowplaying:${session.guildId}`);
    try {
      const bardClient = await getItem("bard:client");
      if (bardClient?.user) {
        const songName = path.basename(track.file, path.extname(track.file));
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
/* functionSignature: setBindSessionPlayer (session, sessionKey, musicDir, log,      *
/*                                          idlePresence)                            *
/* Binds the Idle event to the session player (once per session). On song end,       *
/* reloads library.xml from disk and picks the next song. Sets idle presence when    *
/* no matching track is found.                                                       *
/************************************************************************************/
function setBindSessionPlayer(session, sessionKey, musicDir, log, idlePresence) {
  if (session._playerBound) return;
  session._playerBound = true;

  const player = session.player;

  player.on(AudioPlayerStatus.Idle, async () => {
    try {
      log("song ended, selecting next track", "info", { moduleName: MODULE_NAME, sessionKey });
      const liveSession = await getItem(sessionKey);
      if (!liveSession) {
        return;
      }

      const labelsData = await getItem(`bard:labels:${liveSession.guildId}`);
      const currentNp = await getItem(`bard:nowplaying:${liveSession.guildId}`);
      const currentFile = currentNp?.file || null;

      let labels = Array.isArray(labelsData?.labels) ? labelsData.labels : [];
      if (labels.length === 0 && Array.isArray(currentNp?.labels) && currentNp.labels.length) {
        labels = currentNp.labels;
      } else {
      }

      const library = getLoadLibrary(musicDir);
      const next = getSelectSong(labels, library, null, currentFile);
      if (!next) {
        log("no tracks in library for song-end pick", "warn", { moduleName: MODULE_NAME });
        await setIdlePresence(idlePresence);
        return;
      }
      liveSession._lastLabels = labels;
      await setPlayTrack(liveSession, next, musicDir, log);
    } catch (e) {
      log(`idle-handler error: ${e?.message}`, "error", { moduleName: MODULE_NAME });
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
/* functionSignature: getScanAndPlay (musicDir, pollMs, log, idlePresence)           *
/* Returns the polling function. Reloads library.xml each cycle, scans               *
/* bard:registry and manages music per session. Sets idle presence when no           *
/* matching track is found.                                                          *
/************************************************************************************/
function getScanAndPlay(musicDir, pollMs, log, idlePresence) {
  async function scanAndPlay() {
    try {
      const library = getLoadLibrary(musicDir);
      const reg = await getItem("bard:registry");
      const keys = Array.isArray(reg?.list) ? reg.list : [];

      if (!keys.length) {
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


          setBindSessionPlayer(session, sessionKey, musicDir, log, idlePresence);

          const isPlaying = playerState === AudioPlayerStatus.Playing ||
                            playerState === AudioPlayerStatus.Buffering;

          if (isPlaying) {
            if (labels.length === 0) {
              continue;
            }
            const next = getSelectSong(labels, library, currentFile);
            if (next === null) {
              continue;
            }
            session._lastLabels = labels;
            await setPlayTrack(session, next, musicDir, log);
          } else {
            const next = getSelectSong(labels, library, null, currentFile);
            if (!next) {
              await setIdlePresence(idlePresence);
              continue;
            }
            session._lastLabels = labels;
            await setPlayTrack(session, next, musicDir, log);
          }
        } catch (e) {
          log(`session scan error for ${sessionKey}: ${e?.message}`, "error", { moduleName: MODULE_NAME });
        }
      }
    } catch (e) {
      log(`scanAndPlay error: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    } finally {
      setTimeout(scanAndPlay, pollMs);
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

  const scanAndPlay = getScanAndPlay(musicDir, pollMs, log, idlePresence);
  setTimeout(scanAndPlay, 1000);
}
