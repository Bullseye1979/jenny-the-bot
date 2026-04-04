/************************************************************************************
/* filename: 00999-core-ai-context-loader.js                                       *
/* Version 1.0                                                                     *
/* Purpose: Pre-loads the conversation context (snapshot) from the context DB into *
/*          wo._contextSnapshot before any core-ai module runs.                    *
/*                                                                                 *
/*          Optionally applies per-channel context optimizations to the snapshot.  *
/*          Optimizations are purely navigational — DB rows are never modified.    *
/*          Applies to all core-ai modules (01000–01003) which all read from       *
/*          wo._contextSnapshot when available.                                    *
/*                                                                                 *
/*          Modules positioned between 00999 and the core-ai modules (01000–01003) *
/*          can inspect and modify wo._contextSnapshot before the AI sees it,      *
/*          enabling context injection / filtering at pipeline level.              *
/*                                                                                 *
/*          All core-ai modules retain a direct getContext() fallback so that      *
/*          synthetic pipelines (e.g. wiki image generation) which call a core-ai  *
/*          module directly — without running the module pipeline — continue to    *
/*          work.                                                                  *
/*                                                                                 *
/* Special source handling:                                                        *
/*   Rows with source "voice-transcription" receive special treatment during       *
/*   context optimization. All voice paths must set this source on context writes: *
/*   - Discord voice (00070-discord-add-context, when wo.voiceTranscribed=true)    *
/*   - Webpage always-on voice (00031-webpage-voice-add-context)                   *
/*   - Diarize sessions (00047-webpage-voice)                                      *
/*   - Meeting recorder (00027-webpage-voice-record)                               *
/*                                                                                 *
/* Config (contextOptimization in channel override):                               *
/*   enabled                       — master toggle (default: false)                *
/*   transcriptions.minWords       — voice rows with fewer words than this are     *
/*                                   excluded from the snapshot when outside the   *
/*                                   protected recent window (default: 5)          *
/*   transcriptions.keepRecentCount — number of most-recent snapshot rows that are *
/*                                   always kept regardless of word count           *
/*                                   (default: 3)                                  *
/*   relevance.enabled             — relevance-based filtering (default: false)    *
/*   relevance.keepRecentCount     — always keep N most-recent rows (default: 5)   *
/*   relevance.minScore            — minimum Jaccard score to retain an older row  *
/*                                   (0.0–1.0, default: 0.05)                     *
/*                                                                                 *
/*   Relevance filtering applies only to non-voice-transcription rows.             *
/*   Requires non-simplified context (simplifiedContext !== true) for source       *
/*   field detection.                                                              *
/*                                                                                 *
/* Flow: discord, discord-voice, discord-status, api, bard-label-gen, webpage      *
/************************************************************************************/
import { getContext } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME          = "core-ai-context-loader";
const TRANSCRIPTION_SOURCE = "voice-transcription";


function getWordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}


function getTokenSet(text) {
  return new Set(
    String(text || "").toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2)
  );
}


function getJaccardScore(queryTokens, text) {
  if (!queryTokens.size) return 0;
  const rowTokens = getTokenSet(text);
  if (!rowTokens.size) return 0;
  let intersect = 0;
  for (const t of queryTokens) {
    if (rowTokens.has(t)) intersect++;
  }
  const union = queryTokens.size + rowTokens.size - intersect;
  return intersect / union;
}


function getApplyTranscriptionFilter(snapshot, cfg) {
  const minWords   = Math.max(1, Number.isFinite(Number(cfg.minWords))        ? Number(cfg.minWords)        : 5);
  const keepRecent = Math.max(0, Number.isFinite(Number(cfg.keepRecentCount)) ? Number(cfg.keepRecentCount) : 3);

  const cutoff = snapshot.length - keepRecent;

  return snapshot.filter((row, idx) => {
    if (row?.source !== TRANSCRIPTION_SOURCE) return true;
    if (idx >= cutoff) return true;
    return getWordCount(row.content) >= minWords;
  });
}


function getApplyRelevanceFilter(snapshot, cfg, payload) {
  const keepRecent = Math.max(1, Number.isFinite(Number(cfg.keepRecentCount)) ? Number(cfg.keepRecentCount) : 5);
  const minScore   = Number.isFinite(Number(cfg.minScore)) ? Math.max(0, Number(cfg.minScore)) : 0.05;

  if (snapshot.length <= keepRecent) return snapshot;

  const queryTokens = getTokenSet(payload);
  const tail        = snapshot.slice(-keepRecent);
  const head        = snapshot.slice(0, -keepRecent);

  const filtered = head.filter(row => {
    if (row?.source === TRANSCRIPTION_SOURCE) return true;
    const content = typeof row.content === "string" ? row.content : "";
    return getJaccardScore(queryTokens, content) >= minScore;
  });

  return [...filtered, ...tail];
}


function getApplyOptimizations(snapshot, cfg, payload) {
  let result = snapshot;

  const transCfg = cfg.transcriptions;
  if (!transCfg || transCfg.enabled !== false) {
    result = getApplyTranscriptionFilter(result, transCfg || {});
  }

  const relCfg = cfg.relevance;
  if (relCfg?.enabled && payload) {
    result = getApplyRelevanceFilter(result, relCfg, payload);
  }

  return result;
}


export default async function getCoreAiContextLoader(coreData) {
  const wo  = coreData?.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  if (Array.isArray(wo._contextSnapshot)) return coreData;

  if (!String(wo?.payload ?? "").trim()) return coreData;

  const channelId = String(wo?.channelID ?? "").trim();
  if (!channelId) {
    log("Skipped: no channelID — AI modules will load context themselves");
    return coreData;
  }

  try {
    const snapshot = await getContext(wo);
    wo._contextSnapshot = Array.isArray(snapshot) ? snapshot : [];
    log(`Context loaded: ${wo._contextSnapshot.length} row(s) for channel "${channelId}"`);
  } catch (e) {
    wo._contextSnapshot = [];
    log(`getContext failed — _contextSnapshot set to []: ${e?.message || String(e)}`, "warn");
  }

  const optCfg = wo?.contextOptimization;
  if (optCfg?.enabled && wo._contextSnapshot.length) {
    const before = wo._contextSnapshot.length;
    wo._contextSnapshot = getApplyOptimizations(wo._contextSnapshot, optCfg, String(wo.payload ?? ""));
    log(`Context optimized: ${before} → ${wo._contextSnapshot.length} row(s)`);
  }

  return coreData;
}
