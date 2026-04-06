














































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
