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
      const rawVol   = volumeM ? parseFloat(volumeM[1]) : NaN;
      // Structured tag format: tags[0]=location, tags[1]=situation, tags[2+]=moods.
      // Positions 0-1 may be empty strings (wildcard = matches any).
      const rawParts = tagsM[1].split(",");
      const tLoc     = (rawParts[0] || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const tSit     = (rawParts[1] || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const tMoods   = rawParts.slice(2)
        .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
        .filter(Boolean);
      tracks.push({
        file:   fileM[1].trim(),
        title:  titleM ? titleM[1].trim() : fileM[1].trim(),
        tags:   [tLoc, tSit, ...tMoods],
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
/* Selects the best-matching song using a tiered pool approach.                      *
/* labels[0]=location, labels[1]=situation, labels[2-5]=moods.                      *
/* track.tags[0]=location, track.tags[1]=situation, track.tags[2+]=moods.           *
/*                                                                                   *
/* Empty library tag = wildcard (matches any AI value, including empty AI label).   *
/*                                                                                   *
/* Pool tiers (first non-empty tier is used):                                        *
/*   Tier 1 — songs matching BOTH location AND situation                             *
/*   Tier 2 — songs matching location OR situation                                   *
/*   Tier 3 — all songs                                                              *
/*                                                                                   *
/* Within the tier, best mood match wins. Tie-with-current → return null (stay).    *
/* excludeFile is excluded from variety rotation but not from tie-break stays.      *
/************************************************************************************/
function getSelectSong(labels, library, currentFile, excludeFile = null) {
  if (!Array.isArray(library) || !library.length) return null;
  if (!Array.isArray(labels)) labels = [];

  const aiLoc     = (labels[0] || "").trim().toLowerCase();
  const aiSit     = (labels[1] || "").trim().toLowerCase();
  const aiMoods   = labels.slice(2).map(l => (l || "").trim().toLowerCase()).filter(Boolean);
  const aiMoodSet = new Set(aiMoods);

  // Library empty tag = wildcard: matches any AI value (including empty).
  const locMatches = t => { const tl = (t.tags[0] || "").toLowerCase(); return !tl || !aiLoc || tl === aiLoc; };
  const sitMatches = t => { const ts = (t.tags[1] || "").toLowerCase(); return !ts || !aiSit || ts === aiSit; };
  const getMoodScore = t => t.tags.slice(2).map(x => x.toLowerCase()).filter(Boolean)
    .filter(m => aiMoodSet.has(m)).length;

  // Build candidate pool (exclude variety-rotation file, not current for tie check).
  const pool = library.filter(t => t.file !== excludeFile);

  let candidates = pool.filter(t => locMatches(t) && sitMatches(t));           // Tier 1
  if (!candidates.length) candidates = pool.filter(t => locMatches(t) || sitMatches(t)); // Tier 2
  if (!candidates.length) candidates = [...pool];                                         // Tier 3
  if (!candidates.length) return null;

  // Sort by mood score; pick the highest tier.
  const maxScore = Math.max(...candidates.map(getMoodScore));
  const best = candidates.filter(t => getMoodScore(t) === maxScore);

  // Tie with currently playing song → stay (no switch needed).
  if (currentFile && best.some(t => t.file === currentFile)) return null;

  // Random pick among best (variety: prefer not to repeat excludeFile).
  return best[Math.floor(Math.random() * best.length)];
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
            // Detect scene changes by comparing new AI labels vs previous active labels
            // (stored in nowPlaying.labels from the last poll).
            // Carry-forward in bard-label-output ensures empty AI slots retain the
            // previous value, so only genuine AI changes produce a mismatch here.
            //
            // Rules (all three can trigger a mid-song switch):
            //   1. Location changed   — both non-empty and different
            //   2. Situation changed  — both non-empty and different
            //   3. Mood drift >50%    — >50% of new moods are not in previous moods
            //      (skipped if either new or previous mood list is empty)
            const prevLabels  = Array.isArray(nowPlaying?.labels) ? nowPlaying.labels : [];
            const newLoc      = (labels[0] || "").trim().toLowerCase();
            const prevLoc     = (prevLabels[0] || "").trim().toLowerCase();
            const newSit      = (labels[1] || "").trim().toLowerCase();
            const prevSit     = (prevLabels[1] || "").trim().toLowerCase();
            const newMoods    = labels.slice(2).filter(Boolean).map(m => m.trim().toLowerCase());
            const prevMoods   = prevLabels.slice(2).filter(Boolean).map(m => m.trim().toLowerCase());
            const prevMoodSet = new Set(prevMoods);

            let switchReason = null;
            if (newLoc && prevLoc && newLoc !== prevLoc)
              switchReason = `location:${prevLoc}→${newLoc}`;
            else if (newSit && prevSit && newSit !== prevSit)
              switchReason = `situation:${prevSit}→${newSit}`;
            else if (newMoods.length > 0 && prevMoods.length > 0) {
              const changed = newMoods.filter(m => !prevMoodSet.has(m)).length;
              if (changed / newMoods.length > 0.5)
                switchReason = `mood:${changed}/${newMoods.length} changed`;
            }

            if (switchReason) {
              log(`mid-song switch (${switchReason}) for guild ${session.guildId}`, "info", { moduleName: MODULE_NAME });
              const next = getSelectSong(labels, library, currentFile);
              if (next !== null) {
                session._lastLabels = labels;
                session._lastRejectedLabels = rejected;
                await setPlayTrack(session, next, musicDir, log, triggerPoll);
                continue;
              }
              // getSelectSong returned null = current track is tied-best → stay, update UI only.
            }

            // No switch — refresh UI labels so the page always shows current mood context.
            if (nowPlaying) await putItem({ ...nowPlaying, labels }, `bard:nowplaying:${session.guildId}`);
            try {
              const currentStream = await getItem(`bard:stream:${session.guildId}`);
              if (currentStream) await putItem({ ...currentStream, labels }, `bard:stream:${session.guildId}`);
            } catch {}
            continue;
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
