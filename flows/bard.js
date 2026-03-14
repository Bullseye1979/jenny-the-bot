/************************************************************************************/
/* filename: bard.js                                                                */
/* Version 1.0                                                                      */
/* Purpose: Bard flow — polls bard:registry every N seconds, selects music from    */
/*          library.xml based on bard:labels, and writes bard:stream for the web   */
/*          audio player. No Discord voice bot required.                            */
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "fluent-ffmpeg";
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
    return getParseLibraryXml(xmlText);
  } catch {
    return [];
  }
}

/************************************************************************************/
/* functionSignature: getSelectSong (labels, library, currentFile, excludeFile)      *
/* Selects the best-matching song using bidirectional position-weighted scoring.     *
/* AI labels: 1st = highest weight (N), last = 1. Track tags: same principle.       *
/* Score per matching pair = AI label weight × track tag weight.                    *
/* Returns null if the current file is already the unique best match (no change).   *
/************************************************************************************/
function getSelectSong(labels, library, currentFile, excludeFile = null) {
  if (!Array.isArray(library) || !library.length) return null;
  if (!Array.isArray(labels)) labels = [];

  // Build AI label weight map: 1st label = labels.length pts, each subsequent = -1.
  // Example for ["combat","vampire","dungeon"]: combat=3, vampire=2, dungeon=1.
  const labelWeights = {};
  labels.forEach((label, index) => {
    labelWeights[String(label).toLowerCase()] = labels.length - index;
  });

  const excluded = excludeFile || currentFile;

  // Bidirectional scoring: track tag positional weight × AI label weight.
  // A tag that is the primary identity of a track (position 0) AND the top AI label
  // scores highest. Both directions contribute to the final match quality.
  const scored = library.map(track => ({
    track,
    score: track.tags.reduce((sum, tag, tagIndex) => {
      const aiWeight = labelWeights[tag] || 0;
      if (aiWeight === 0) return sum;
      const trackWeight = track.tags.length - tagIndex; // primary tag = highest weight
      return sum + aiWeight * trackWeight;
    }, 0)
  }));

  const maxScore = Math.max(...scored.map(s => s.score));

  // Only stay on the current track (return null = "no change") if it is the
  // UNIQUE best match — no other track has the same top score.
  if (currentFile) {
    const currentEntry = scored.find(s => s.track.file === currentFile);
    const currentScore = currentEntry?.score ?? 0;
    if (maxScore >= 1 && currentScore === maxScore) {
      const otherBest = scored.filter(s => s.score === maxScore && s.track.file !== currentFile);
      if (otherBest.length === 0) return null; // current is uniquely best → stay
    }
  }

  const best = scored.filter(s => s.score === maxScore);

  // Always try to exclude the current/last-played file for variety.
  const candidates = best.filter(s => s.track.file !== excluded);

  return (candidates.length > 0 ? candidates : best)[Math.floor(Math.random() * (candidates.length > 0 ? candidates : best).length)].track;
}

/************************************************************************************/
/* functionSignature: getTrackDurationMs (filePath)                                  *
/* Returns the duration of an audio file in milliseconds via ffprobe.               *
/* Falls back to 180000 ms (3 minutes) if ffprobe fails or duration is unavailable. *
/************************************************************************************/
async function getTrackDurationMs(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !Number.isFinite(metadata?.format?.duration)) {
        resolve(180000);
        return;
      }
      resolve(Math.round(metadata.format.duration * 1000));
    });
  });
}

/************************************************************************************/
/* functionSignature: setPlayTrack (session, track, musicDir, log, triggerPoll)     *
/* Writes bard:stream and bard:nowplaying for the given track. Gets the track       *
/* duration via ffprobe and schedules a timer to trigger the next poll when done.   *
/************************************************************************************/
async function setPlayTrack(session, track, musicDir, log, triggerPoll) {
  try {
    const filePath = path.resolve(musicDir, track.file);
    if (!fs.existsSync(filePath)) {
      log(`audio file not found: ${filePath}`, "warn", { moduleName: MODULE_NAME });
      return false;
    }

    session._lastPlayedFile = track.file;

    const nowTs = new Date().toISOString();
    await putItem(
      {
        guildId: session.guildId,
        file: track.file,
        title: track.title,
        labels: session._lastLabels || [],
        trackTags: Array.isArray(track.tags) ? track.tags : [],
        rejectedLabels: session._lastRejectedLabels || [],
        startedAt: nowTs,
        musicDir
      },
      `bard:stream:${session.guildId}`
    );
    await putItem(
      { file: track.file, title: track.title, labels: session._lastLabels || [], startedAt: nowTs },
      `bard:nowplaying:${session.guildId}`
    );

    const durationMs = await getTrackDurationMs(filePath);
    session._trackEndAt = Date.now() + durationMs;

    if (session._trackTimer) clearTimeout(session._trackTimer);
    session._trackTimer = setTimeout(() => {
      session._trackEndAt = null;
      session._trackTimer = null;
      triggerPoll();
    }, durationMs + 200);

    log(`now playing: "${track.title}" (${track.file}), duration: ${Math.round(durationMs / 1000)}s`, "info", {
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
/* functionSignature: getScanAndPlay (musicDir, pollMs, log, cfg)                   *
/* Returns the polling function. Reads bard:registry on each cycle, selects and     *
/* starts tracks for each active session. triggerPoll is passed to setPlayTrack so  *
/* the track end timer can fire an immediate poll without racing a running cycle.   *
/************************************************************************************/
function getScanAndPlay(musicDir, pollMs, log, cfg) {
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

      if (!keys.length) return;

      for (const sessionKey of keys) {
        try {
          const session = await getItem(sessionKey);
          if (!session?.guildId) continue;

          const labelsData = await getItem(`bard:labels:${session.guildId}`);
          const nowPlaying = await getItem(`bard:nowplaying:${session.guildId}`);
          const currentFile = nowPlaying?.file || null;

          let labels = Array.isArray(labelsData?.labels) ? labelsData.labels : [];
          let rejected = Array.isArray(labelsData?.rejected) ? labelsData.rejected : [];
          if (labels.length === 0 && Array.isArray(nowPlaying?.labels) && nowPlaying.labels.length) {
            labels = nowPlaying.labels;
          }

          const isPlaying = !!(session._trackEndAt && Date.now() < session._trackEndAt);

          log(`[label-debug] guild=${session.guildId} isPlaying=${isPlaying} labels=[${labels.join(",")}] labelsUpdatedAt=${labelsData?.updatedAt || "none"} currentFile=${currentFile || "none"}`, "info", { moduleName: MODULE_NAME });

          if (isPlaying) {
            if (labels.length === 0) continue;
            // Only trigger a track switch if the AI labels have changed from when the
            // track started (nowPlaying.labels). Identical labels → keep playing.
            // When labels change, always select the best-fit track (no overlap check).
            const trackStartLabels = Array.isArray(nowPlaying?.labels) ? nowPlaying.labels : [];
            const labelsChanged = [...labels].sort().join(",") !== [...trackStartLabels].sort().join(",");
            log(`[label-debug] guild=${session.guildId} isPlaying=true trackStartLabels=[${trackStartLabels.join(",")}] newLabels=[${labels.join(",")}] labelsChanged=${labelsChanged}`, "info", { moduleName: MODULE_NAME });
            if (!labelsChanged) continue; // labels unchanged → keep playing
            // Labels changed → always pick best fit
            const next = getSelectSong(labels, library, currentFile);
            if (next === null) {
              if (nowPlaying) {
                await putItem({ ...nowPlaying, labels }, `bard:nowplaying:${session.guildId}`);
              }
              continue;
            }
            session._lastLabels = labels;
            session._lastRejectedLabels = rejected;
            await setPlayTrack(session, next, musicDir, log, triggerPoll);
          } else {
            const next = getSelectSong(labels, library, null, session._lastPlayedFile || currentFile);
            if (!next) {
              try { await deleteItem(`bard:stream:${session.guildId}`); } catch {}
              continue;
            }
            session._lastLabels = labels;
            session._lastRejectedLabels = rejected;
            await setPlayTrack(session, next, musicDir, log, triggerPoll);
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
/* Loads the music library and starts the headless bard playback scheduler.          *
/************************************************************************************/
export default async function getBardFlow(baseCore, runFlow, createRunCore) {
  const rc = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);

  const cfg = baseCore?.config?.[MODULE_NAME] || {};

  const pollMs = Number.isFinite(Number(cfg.pollIntervalMs))
    ? Math.max(5000, Number(cfg.pollIntervalMs))
    : 30000;

  const musicDir = path.resolve(
    __dirname, "..",
    typeof cfg.musicDir === "string" ? cfg.musicDir : "assets/bard"
  );

  const startupLibrary = getLoadLibrary(musicDir);
  log(`library loaded: ${startupLibrary.length} track(s)`, "info", { moduleName: MODULE_NAME, musicDir });

  const scanAndPlay = getScanAndPlay(musicDir, pollMs, log, cfg);
  setTimeout(scanAndPlay, 1000);
}
