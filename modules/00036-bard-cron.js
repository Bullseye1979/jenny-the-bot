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

// Default prompt template for 6-label structured output:
//   position 1 = location, position 2 = situation, positions 3-6 = 4 mood tags.
// Placeholders filled by buildSystemPrompt():
//   {{LOCATION_TAGS}}  — comma list of known location tags from library
//   {{SITUATION_TAGS}} — comma list of known situation tags from library
//   {{MOOD_TAGS}}      — comma list of known mood tags from library
//   {{CURRENT_LABELS}} — current active labels for reference
const DEFAULT_PROMPT_TEMPLATE =
  "You are a music classifier for a D&D tabletop RPG session. " +
  "Read the transcript and output EXACTLY 6 comma-separated tags describing what is happening RIGHT NOW.\n" +
  "\n" +
  "TAG STRUCTURE — the 6 positions are FIXED and must always appear in this exact order:\n" +
  "  1. LOCATION  — WHERE the scene takes place (a physical place). " +
  "Known locations: {{LOCATION_TAGS}}. " +
  "Output EMPTY (nothing) if the location is unclear. NEVER put a situation or mood word here.\n" +
  "  2. SITUATION — WHAT is happening (the type of activity). " +
  "Known situations: {{SITUATION_TAGS}}. " +
  "Output EMPTY (nothing) if the situation is unclear. NEVER put a location or mood word here.\n" +
  "  3-6. MOOD    — exactly 4 mood/atmosphere words describing the feeling of the scene. " +
  "Known moods: {{MOOD_TAGS}}. " +
  "MUST always be 4 values — use the closest fitting moods even if not a perfect match. " +
  "ORDER by importance: most fitting first, least fitting last. NEVER put a location or situation word here.\n" +
  "\n" +
  "RULES:\n" +
  "1. Base your answer ONLY on what is happening in the transcript RIGHT NOW.\n" +
  "2. Each non-empty tag must be a SINGLE word from the known lists — never invent new words.\n" +
  "3. POSITIONS ARE FIXED — NEVER shift values. Each position is decided independently. " +
  "If position 1 is unclear, output empty for position 1 and STILL decide position 2 on its own. " +
  "Example: location unclear + combat → output: ,combat,mood1,mood2,mood3,mood4 (NOT combat at position 1).\n" +
  "4. Do NOT carry over previous tags — always pick what fits the transcript NOW.\n" +
  "5. Output EXACTLY 6 comma-separated values. No spaces around commas. No explanation. No apology.\n" +
  "\n" +
  "Current labels (reference only — do not copy blindly): {{CURRENT_LABELS}}\n" +
  "{{EXAMPLE_LINES}}";


function getNowIso() {
  try { return new Date().toISOString(); } catch { return ""; }
}


function getStr(v) {
  return v == null ? "" : String(v);
}


function getLibraryTagCategories(musicDir) {
  const empty = { locations: new Set(), situations: new Set(), moods: new Set(), all: new Set() };
  try {
    const xmlPath = path.join(musicDir, "library.xml");
    if (!fs.existsSync(xmlPath)) return empty;
    const xmlText = fs.readFileSync(xmlPath, "utf8");
    const { locations, situations, moods, all } = empty;
    const re = /<tags>([^<]*)<\/tags>/gi;
    let m;
    while ((m = re.exec(xmlText)) !== null) {
      const parts = m[1].split(",");
      const loc = (parts[0] || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const sit = (parts[1] || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (loc) { locations.add(loc); all.add(loc); }
      if (sit) { situations.add(sit); all.add(sit); }
      parts.slice(2).forEach(t => {
        const clean = t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (clean) { moods.add(clean); all.add(clean); }
      });
    }
    return { locations, situations, moods, all };
  } catch {
    return empty;
  }
}


function buildSystemPrompt(template, tagCategories, currentLabels) {
  const locs  = [...tagCategories.locations].sort();
  const sits  = [...tagCategories.situations].sort();
  const moodsSorted = [...tagCategories.moods].sort();

  const locList  = locs.join(",")       || "tavern,dungeon,forest,city,camp";
  const sitList  = sits.join(",")       || "combat,exploration,rest,dialogue";
  const moodList = moodsSorted.join(",") || "dark,tense,calm,ambient,intense,eerie";

  // Build 4 illustrative examples from real library tags.
  // Fallback values are used only when the library is still empty.
  // L0 appears in examples 1 AND 2 so the LLM sees it as a location value both
  // when situation is known and when situation is unknown. This prevents the LLM
  // from learning that empty fields always appear at the very beginning.
  const L0 = locs[0]       || "dungeon";
  const S0 = sits[0]       || "combat";
  const S1 = sits[1]       || "rest";
  const M  = (moodsSorted.length >= 4 ? moodsSorted : ["ambient","calm","dark","intense"]).slice(0, 4);

  const exampleLines =
    `Example (${L0}/${S0}, both known):       ${L0},${S0},${M[0]},${M[1]},${M[2]},${M[3]}\n` +
    `Example (${L0}, situation unclear):      ${L0},,${M[0]},${M[1]},${M[2]},${M[3]}\n` +
    `Example (${S1}, location unclear):       ,${S1},${M[0]},${M[1]},${M[2]},${M[3]}\n` +
    `Example (unclear/empty transcript):      ,,,${M[0]},${M[1]},${M[2]},${M[3]}`;

  const labelStr = Array.isArray(currentLabels) && currentLabels.length
    ? currentLabels.join(",")
    : "none";

  return template
    .replace("{{LOCATION_TAGS}}",  locList)
    .replace("{{SITUATION_TAGS}}", sitList)
    .replace("{{MOOD_TAGS}}",      moodList)
    .replace("{{CURRENT_LABELS}}", labelStr)
    .replace("{{EXAMPLE_LINES}}",  exampleLines);
}


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
  const tagCategories = getLibraryTagCategories(musicDir);

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
      const systemPrompt = buildSystemPrompt(promptTemplate, tagCategories, currentLabels);

      // Set up the working object for the core-ai pipeline
      wo.systemPrompt = systemPrompt;
      wo.payload      = userText;

      // Store bard-specific state so bard-label-output can use it.
      // _bardLastRunKey and _bardLastRunTs are written to registry by bard-label-output
      // only after a successful AI response — preventing the stuck-lastrun bug.
      wo._bardGuildId     = getStr(session.guildId);
      wo._bardValidTags   = [...tagCategories.all];       // full set — mood validation in output module
      wo._bardLocations   = [...tagCategories.locations]; // for position rescue in output module
      wo._bardSituations  = [...tagCategories.situations];// for position rescue in output module
      wo._bardLastRunKey  = lastRunKey;
      wo._bardLastRunTs   = targetNowTs;

      // AI params come from workingObject defaults + core-channel-config overrides (bard-label-gen flow).
      // Only set a model fallback if nothing was applied from channel config.
      if (!wo.model) wo.model = "gpt-4o-mini";

      wo.temperature       = 0.3;
      wo.maxTokens         = 80; // 6 labels ~ 50 chars, 80 tokens is ample
      wo.maxLoops          = 1;
      wo.useAiModule       = "completions";
      wo.includeHistory    = false;
      wo.doNotWriteToContext = true;
      wo.tools             = [];

      log(`prepared label-gen payload for guild ${session.guildId}`, "info", {
        moduleName: MODULE_NAME,
        guildId: session.guildId,
        textChannelId,
        locations: tagCategories.locations.size,
        situations: tagCategories.situations.size,
        moods: tagCategories.moods.size,
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
