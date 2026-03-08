/************************************************************************************/
/* filename: bard-cron.js                                                          *
/* Version 2.0                                                                     *
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
  "You are analyzing a D&D tabletop RPG session transcript. " +
  "Choose exactly 3 tags that best describe the current atmosphere. " +
  "You MUST use ONLY tags from this exact list — no other words allowed: {{TAGS}}. " +
  "Use the exact tag words from the list. Do NOT invent similar words. " +
  "Return ONLY the 3 chosen tags as a comma-separated list. No explanation, no punctuation. " +
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
  let prompt = template.replace("{{TAGS}}", tagList);
  if (currentLabels.length) {
    prompt += `\n\nCurrently active mood labels: ${currentLabels.join(",")}.` +
              " Consider whether to keep or change them based on the conversation.";
  }
  return prompt;
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
  const bardCfg = config["bard"] || {};

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
    typeof bardCfg.musicDir === "string" ? bardCfg.musicDir : "assets/bard"
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

      // If a specific channelID is configured on the cron job, match it
      if (woCh && woCh !== "cron" && woCh !== textChannelId) continue;

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

      // Build system prompt: template + tag list + current labels
      const promptTemplate = getStr(wo.prompt || cfg.prompt || bardCfg.prompt || DEFAULT_PROMPT_TEMPLATE);
      const systemPrompt = buildSystemPrompt(promptTemplate, validTags, currentLabels);

      // Set up the working object for the core-ai pipeline
      wo.systemPrompt = systemPrompt;
      wo.payload      = userText;

      // Store bard-specific state so bard-label-output can use it
      wo._bardGuildId    = getStr(session.guildId);
      wo._bardValidTags  = [...validTags];

      // Override AI params for label generation (low tokens, no history, no tools)
      if (!wo.model)    wo.model    = getStr(cfg.model    || bardCfg.model    || "gpt-4o-mini");
      if (!wo.endpoint) wo.endpoint = getStr(cfg.endpoint || bardCfg.endpoint);
      if (!wo.apiKey)   wo.apiKey   = getStr(cfg.apiKey   || bardCfg.apiKey);

      wo.temperature       = 0.3;
      wo.maxTokens         = 60;
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
