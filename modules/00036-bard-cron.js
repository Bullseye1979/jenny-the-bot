/**************************************************************/
/* filename: "00036-bard-cron.js"                                   */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/










import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getItem, putItem } from "../core/registry.js";
import { getContextLastSeconds, getContextSince } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-cron";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

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

  let reg = null;
  try { reg = await getItem("bard:registry"); } catch { reg = null; }
  const sessionKeys = Array.isArray(reg?.list) ? reg.list : [];

  log(`[label-debug] bard-label-gen fired: woCh="${getStr(wo.channelId)}" sessions=${sessionKeys.length}`, "info", { moduleName: MODULE_NAME });

  if (!sessionKeys.length) {
    log("no active bard sessions — skipping label generation", "info", { moduleName: MODULE_NAME });
    wo.jump = true;
    return coreData;
  }

  const musicDir = path.resolve(
    __dirname, "..",
    typeof cfg.musicDir === "string" ? cfg.musicDir : "assets/bard"
  );
  const tagCategories = getLibraryTagCategories(musicDir);

  const woCh = getStr(wo.channelId);
  let targetSession = null;
  let targetLastRunAt = "";
  let targetNowTs = "";

  for (const sessionKey of sessionKeys) {
    try {
      const session = await getItem(sessionKey);
      if (!session) continue;

      const textChannelId = getStr(session.textChannelId);
      if (!textChannelId) continue;

      const isSnowflake = /^\d{10,}$/.test(woCh);
      if (isSnowflake && woCh !== textChannelId) continue;

      const lastRunKey = `bard:lastrun:${session.textChannelId}`;
      let lastRunData = null;
      try { lastRunData = await getItem(lastRunKey); } catch {}
      const lastRunAt = getStr(lastRunData?.ts || "");

      const woForCtx = { ...wo, channelId: textChannelId };
      const rows = lastRunAt
        ? await getContextSince(woForCtx, lastRunAt)
        : await getContextLastSeconds(woForCtx, 300);

      log(`[label-debug] channel=${session.textChannelId} textChannelId=${textChannelId} lastRunAt="${lastRunAt||"none"}" contextRows=${rows.length}`, "info", { moduleName: MODULE_NAME });

      if (!rows.length) {
        log(`no new context since ${lastRunAt || "last 300s"} for channel ${textChannelId}`, "info", { moduleName: MODULE_NAME });
        continue;
      }

      targetSession  = session;
      targetLastRunAt = lastRunAt;
      targetNowTs = getNowIso();

      const userText = rows
        .map(r => `${r.role === "assistant" ? "Bot" : "Player"}: ${r.text}`)
        .join("\n");

      let currentLabels = [];
      try {
        const labelsData = await getItem(`bard:labels:${session.textChannelId}`);
        if (Array.isArray(labelsData?.labels)) currentLabels = labelsData.labels;
      } catch {}

      const promptTemplate = getStr(cfg.prompt);
      if (!promptTemplate) {
        log("missing bard-cron.prompt configuration", "warn", { moduleName: MODULE_NAME });
        continue;
      }
      const systemPrompt = buildSystemPrompt(promptTemplate, tagCategories, currentLabels);

      wo.systemPrompt = systemPrompt;
      wo.payload      = userText;

      wo._bardChannelId   = getStr(session.textChannelId);
      wo._bardValidTags   = [...tagCategories.all];
      wo._bardLocations   = [...tagCategories.locations];
      wo._bardSituations  = [...tagCategories.situations];
      wo._bardLastRunKey  = lastRunKey;
      wo._bardLastRunTs   = targetNowTs;

      if (!wo.model) wo.model = "gpt-4o-mini";

      wo.temperature       = 0.3;
      wo.maxTokens         = 80;
      wo.maxLoops          = 1;
      wo.useAiModule       = "completions";
      wo.includeHistory    = false;
      wo.doNotWriteToContext = true;
      wo.tools             = [];

      log(`prepared label-gen payload for channel ${session.textChannelId}`, "info", {
        moduleName: MODULE_NAME,
        channelId: session.textChannelId,
        textChannelId,
        locations: tagCategories.locations.size,
        situations: tagCategories.situations.size,
        moods: tagCategories.moods.size,
        currentLabels
      });

      break;
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
