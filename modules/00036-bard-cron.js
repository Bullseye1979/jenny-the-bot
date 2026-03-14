/************************************************************************************/
/* filename: bard-cron.js                                                          *
/* Version 1.0                                                                     *
/* Purpose: Prepares the bard-label-gen flow payload for core-ai-completions.      *
/*          Reads channel context, builds a system prompt (tag list + current       *
/*          labels) and sets wo.payload so the shared AI pipeline can run.          *
/*          bard-label-output (08050) picks up wo.response to write the labels.    *
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getItem, putItem } from "../core/registry.js";
import { getContextLastSeconds, getContextSince } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-cron";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_PROMPT_TEMPLATE =
  "You are a music mood classifier for a D&D tabletop RPG session. " +
  "Read the transcript below and choose exactly 3 tags that best describe what is happening RIGHT NOW. " +
  "You MUST pick from this exact list only: {{TAGS}}. " +
  "The currently active tags are: {{CURRENT_LABELS}}. " +
  "RULES: " +
  "1. Each tag is ONE word from the list above — never combine words, never add spaces. " +
  "2. Normally keep the current tags unless the mood has clearly shifted. " +
  "3. If combat is happening, pick combat tags. If exploration, pick exploration tags. " +
  "4. MOOD CHANGE: If the transcript shows a clear and decisive mood shift (e.g. calm → combat, " +
  "combat → rest, tension → celebration), you MUST pick 3 tags that are completely different " +
  "from the current tags — no overlap at all. This signals an immediate song change. " +
  "5. Return ONLY the 3 tags as a comma-separated list. No spaces. No explanation. No apology. " +
  "If the transcript is empty or unclear, keep the current tags. " +
  "Example: battle,intense,danger";

/************************************************************************************/
/* functionSignature: getNowIso()                                                  *
/* Returns the current ISO timestamp string.                                       *
/************************************************************************************/
function getNowIso() {
  try { return new Date().toISOString(); } catch { return ""; }
}

/************************************************************************************/
/* functionSignature: getStr(v)                                                    *
/* Returns string value; empty string for nullish.                                 *
/************************************************************************************/
function getStr(v) {
  return v == null ? "" : String(v);
}

/************************************************************************************/
/* functionSignature: getLibraryTags(musicDir)                                     *
/* Reads library.xml and returns a Set of all unique tags used across all tracks.  *
/************************************************************************************/
function getLibraryTags(musicDir) {
  try {
    const xmlPath = path.join(musicDir, "library.xml");
    if (!fs.existsSync(xmlPath)) return new Set();
    const xmlText = fs.readFileSync(xmlPath, "utf8");
    const tagSet = new Set();
    const re = /<tags>([^<]*)<\/tags>/gi;
    let m;
    while ((m = re.exec(xmlText)) !== null) {
      m[1].split(",").forEach(t => {
        const clean = t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (clean) tagSet.add(clean);
      });
    }
    return tagSet;
  } catch {
    return new Set();
  }
}

/************************************************************************************/
/* functionSignature: buildSystemPrompt(template, tagSet, currentLabels)           *
/* Injects the dynamic tag list and current labels into the system prompt.         *
/************************************************************************************/
function buildSystemPrompt(template, tagSet, currentLabels) {
  const tagList = [...tagSet].sort().join(",");
  const labelStr = Array.isArray(currentLabels) && currentLabels.length
    ? currentLabels.join(",")
    : "none";
  return template
    .replace("{{TAGS}}", tagList)
    .replace("{{CURRENT_LABELS}}", labelStr);
}

/************************************************************************************/
/* functionSignature: getBardCron(coreData)                                        *
/* Prepares wo.payload, wo.systemPrompt and AI params so core-ai-completions can   *
/* generate the mood labels. Handles one guild per flow run (the first active      *
/* session that has new context, or the one matching wo.channelID).                *
/************************************************************************************/
export default async function getBardCron(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (getStr(wo?.flow) !== "bard-label-gen") return coreData;

  const config  = coreData?.config || {};
  const cfg     = config[MODULE_NAME] || {};
  /* note: AI params (model, endpoint, apiKey) are applied by core-channel-config
     from the bard-label-gen flow overrides — no need to read them here */

  // Discover active bard sessions
  let reg = null;
  try { reg = await getItem("bard:registry"); } catch { reg = null; }
  const sessionKeys = Array.isArray(reg?.list) ? reg.list : [];

  log(`[label-debug] bard-label-gen fired: woCh="${getStr(wo.channelID)}" sessions=${sessionKeys.length}`, "info", { moduleName: MODULE_NAME });

  if (!sessionKeys.length) {
    log("no active bard sessions — skipping label generation", "info", { moduleName: MODULE_NAME });
    wo.jump = true;
    return coreData;
  }

  // Load tag list from library.xml
  const musicDir = path.resolve(
    __dirname, "..",
    typeof cfg.musicDir === "string" ? cfg.musicDir : "assets/bard"
  );
  const validTags = getLibraryTags(musicDir);

  // Find the target session: prefer the one whose textChannelId matches wo.channelID,
  // otherwise use the first session that has new context.
  const woCh = getStr(wo.channelID);
  let targetSession = null;
  let targetLastRunAt = "";
  let targetNowTs = "";

  for (const sessionKey of sessionKeys) {
    try {
      const session = await getItem(sessionKey);
      if (!session) continue;

      const textChannelId = getStr(session.textChannelId);
      if (!textChannelId) continue;

      // If a specific channelID is configured on the cron job, match it.
      // Only filter if woCh is a real Discord snowflake (numeric); synthetic IDs like
      // "bard-label-gen" or "cron" mean "process all sessions".
      const isSnowflake = /^\d{10,}$/.test(woCh);
      if (isSnowflake && woCh !== textChannelId) continue;

      const lastRunKey = `bard:lastrun:${session.guildId}`;
      let lastRunData = null;
      try { lastRunData = await getItem(lastRunKey); } catch {}
      const lastRunAt = getStr(lastRunData?.ts || "");

      const woForCtx = { ...wo, channelID: textChannelId };
      const rows = lastRunAt
        ? await getContextSince(woForCtx, lastRunAt)
        : await getContextLastSeconds(woForCtx, 300);

      log(`[label-debug] guild=${session.guildId} textChannelId=${textChannelId} lastRunAt="${lastRunAt||"none"}" contextRows=${rows.length}`, "info", { moduleName: MODULE_NAME });

      if (!rows.length) {
        log(`no new context since ${lastRunAt || "last 300s"} for channel ${textChannelId}`, "info", { moduleName: MODULE_NAME });
        continue;
      }

      targetSession  = session;
      targetLastRunAt = lastRunAt;
      targetNowTs = getNowIso();

      // Write lastrun timestamp immediately so the next run won't re-process
      await putItem({ ts: targetNowTs, guildId: session.guildId }, lastRunKey);

      const userText = rows
        .map(r => `${r.role === "assistant" ? "Bot" : "Player"}: ${r.text}`)
        .join("\n");

      // Fetch current labels for context
      let currentLabels = [];
      try {
        const labelsData = await getItem(`bard:labels:${session.guildId}`);
        if (Array.isArray(labelsData?.labels)) currentLabels = labelsData.labels;
      } catch {}

      // Build system prompt — always use DEFAULT_PROMPT_TEMPLATE as base;
      // cfg.prompt can override via config, but workingObject.prompt is ignored
      // to prevent the global systemPrompt from bleeding in.
      const promptTemplate = getStr(cfg.prompt || DEFAULT_PROMPT_TEMPLATE);
      const systemPrompt = buildSystemPrompt(promptTemplate, validTags, currentLabels);

      // Set up the working object for the core-ai pipeline
      wo.systemPrompt = systemPrompt;
      wo.payload      = userText;

      // Store bard-specific state so bard-label-output can use it
      wo._bardGuildId    = getStr(session.guildId);
      wo._bardValidTags  = [...validTags];

      // AI params come from workingObject defaults + core-channel-config overrides (bard-label-gen flow).
      // Only set a model fallback if nothing was applied from channel config.
      if (!wo.model) wo.model = "gpt-4o-mini";

      wo.temperature       = 0.3;
      wo.maxTokens         = 60;
      wo.maxLoops          = 1;
      wo.useAiModule       = "completions";
      wo.includeHistory    = false;
      wo.doNotWriteToContext = true;
      wo.tools             = [];

      log(`prepared label-gen payload for guild ${session.guildId}`, "info", {
        moduleName: MODULE_NAME,
        guildId: session.guildId,
        textChannelId,
        tagCount: validTags.size,
        currentLabels
      });

      break; // one guild per flow run
    } catch (e) {
      log(`error preparing session ${sessionKey}: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    }
  }

  if (!targetSession) {
    log("no sessions with new context — nothing to do", "info", { moduleName: MODULE_NAME });
    wo.jump = true;
  }

  return coreData;
}
