/************************************************************************************/
/* filename: bard-cron.js                                                          */
/* Version 1.0                                                                     */
/* Purpose: Prepares the bard-label-gen flow payload for core-ai-completions.     */
/*          Reads channel context, builds a system prompt (tag list + current      */
/*          labels as reference) and sets wo.payload so the shared AI pipeline     */
/*          can run. bard-label-output (08050) picks up wo.response to write the  */
/*          labels and stores the lastrun timestamp only on success.               */
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
  "Read the transcript below and classify what is happening RIGHT NOW. " +
  "You MUST pick exactly 3 tags from this list: {{TAGS}}. " +
  "Previous tags (for reference only): {{CURRENT_LABELS}}. " +
  "RULES: " +
  "1. Always base your answer ONLY on what the transcript says is happening now. " +
  "2. Each tag is ONE word from the list — never combine words, never invent new ones. " +
  "3. If combat or action is happening, pick matching tags. If calm or exploration, pick those. " +
  "4. Do NOT default to the previous tags — pick what fits the transcript best right now. " +
  "5. ORDER your 3 tags by importance: put the MOST fitting tag FIRST, the least fitting LAST. " +
  "   The first tag carries the highest weight in music selection — rank carefully. " +
  "6. Return ONLY the 3 tags as a comma-separated list. No spaces. No explanation. No apology. " +
  "If the transcript is empty or unclear, return default,ambient,exploration. " +
  "Example (combat scene): battle,intense,danger   Example (quiet scene): ambient,calm,exploration";

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

      // Do NOT write lastrun here — bard-label-output writes it after successful AI response.
      // Writing it here would cause the system to get stuck if the AI call fails:
      // the next run would find no new context (since lastrun > all messages) and skip forever.

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

      // Store bard-specific state so bard-label-output can use it.
      // _bardLastRunKey and _bardLastRunTs are written to registry by bard-label-output
      // only after a successful AI response — preventing the stuck-lastrun bug.
      wo._bardGuildId     = getStr(session.guildId);
      wo._bardValidTags   = [...validTags];
      wo._bardLastRunKey  = lastRunKey;
      wo._bardLastRunTs   = targetNowTs;

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
