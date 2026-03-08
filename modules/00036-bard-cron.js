/************************************************************************************
/* filename: bard-cron.js                                                          *
/* Version 1.0                                                                     *
/* Purpose: Cron module for the bard-label-gen flow. Reads channel context,        *
/*          queries LLM for 3 mood tags, stores them in bard:labels:guildId.       *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
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
  "Example: battle,intense,danger\n\n" +
  "Conversation:\n";

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
    if (!fs.existsSync(xmlPath)) {
      return new Set();
    }
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
  } catch (e) {
    return new Set();
  }
}

/************************************************************************************/
/* functionSignature: buildPrompt(template, tagSet)                                *
/* Injects the dynamic tag list into the prompt template ({{TAGS}} placeholder).   *
/************************************************************************************/
function buildPrompt(template, tagSet) {
  const tagList = [...tagSet].sort().join(",");
  return template.replace("{{TAGS}}", tagList);
}

/************************************************************************************/
/* functionSignature: getLlmLabels (endpoint, apiKey, model, systemPrompt,         *
/*                    userText, validTags, timeoutMs)                              *
/* an array of up to 3 valid lowercase tag strings from the LLM.                   *
/************************************************************************************/
async function getLlmLabels(endpoint, apiKey, model, systemPrompt, userText, validTags, timeoutMs = 15000) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userText }
    ],
    temperature: 0.3,
    max_tokens: 60
  });

  const endpointShort = endpoint.replace(/^https?:\/\//, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);


    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    const content = getStr(data?.choices?.[0]?.message?.content).trim();

    if (!content) {
      return [];
    }

    const raw = content
      .split(",")
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
      .filter(Boolean);

    const labels   = raw.filter(t => validTags.size === 0 || validTags.has(t)).slice(0, 3);
    const rejected = raw.filter(t => validTags.size > 0 && !validTags.has(t));

    if (rejected.length) {
    }
    return labels;
  } catch (e) {
    clearTimeout(timer);
    return [];
  }
}

/************************************************************************************/
/* functionSignature: getBardCron(coreData)                                        *
/* Main module entry. Generates mood labels for all active bard sessions.          *
/************************************************************************************/
export default async function getBardCron(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const config = coreData?.config || {};

  if (getStr(wo?.flow) !== "bard-label-gen") return coreData;

  const cfg    = config[MODULE_NAME] || {};
  const bardCfg = config["bard"] || {};

  let reg = null;
  try { reg = await getItem("bard:registry"); } catch { reg = null; }
  const sessionKeys = Array.isArray(reg?.list) ? reg.list : [];

  if (!sessionKeys.length) {
    log("bard-cron: no active bard sessions — skipping label generation", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  const endpoint = getStr(cfg.endpoint || wo.endpoint || config.workingObject?.endpoint || bardCfg.endpoint);
  const apiKey   = getStr(cfg.apiKey   || wo.apiKey   || config.workingObject?.apiKey   || bardCfg.apiKey);
  const model    = getStr(cfg.model    || wo.model    || config.workingObject?.model    || bardCfg.model || "gpt-4o-mini");

  if (!endpoint || !apiKey) {
    log("bard-cron: no LLM endpoint/apiKey configured — skipping label generation", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  // Load valid tags dynamically from library.xml
  const musicDir = path.resolve(
    __dirname, "..",
    typeof bardCfg.musicDir === "string" ? bardCfg.musicDir : "assets/bard"
  );
  const validTags = getLibraryTags(musicDir);

  // Build prompt: workingObject takes priority (allows per-channel overrides),
  // then module config, then bard config, then built-in default
  const promptTemplate = getStr(wo.prompt || cfg.prompt || bardCfg.prompt || DEFAULT_PROMPT_TEMPLATE);
  const prompt = buildPrompt(promptTemplate, validTags);

  for (const sessionKey of sessionKeys) {
    try {
      const session = await getItem(sessionKey);
      if (!session) {
        continue;
      }

      const textChannelId = getStr(session.textChannelId);

      if (!textChannelId) {
        log(`bard-cron: session ${sessionKey} has no textChannelId — skipping`, "warn", { moduleName: MODULE_NAME });
        continue;
      }

      const lastRunKey = `bard:lastrun:${session.guildId}`;
      let lastRunData = null;
      try { lastRunData = await getItem(lastRunKey); } catch {}
      const lastRunAt = getStr(lastRunData?.ts || "");

      const nowTs = getNowIso();
      await putItem({ ts: nowTs, guildId: session.guildId }, lastRunKey);

      const woForCtx = { ...wo, channelID: textChannelId };
      const rows = lastRunAt
        ? await getContextSince(woForCtx, lastRunAt)
        : await getContextLastSeconds(woForCtx, 300);

      if (!rows.length) {
        log(`bard-cron: no new context since ${lastRunAt || "last 300s"} for channel ${textChannelId}`, "info", { moduleName: MODULE_NAME });
        continue;
      }

      const userText = rows
        .map(r => `${r.role === "assistant" ? "Bot" : "Player"}: ${r.text}`)
        .join("\n");


      const labels = await getLlmLabels(endpoint, apiKey, model, prompt, userText, validTags);

      if (!labels.length) {
        log(`bard-cron: LLM returned no valid labels for guild ${session.guildId}`, "warn", { moduleName: MODULE_NAME });
        continue;
      }

      const labelsEntry = {
        labels,
        guildId: session.guildId,
        updatedAt: getNowIso()
      };

      await putItem(labelsEntry, `bard:labels:${session.guildId}`);

      log(`bard-cron: labels set for guild ${session.guildId}`, "info", {
        moduleName: MODULE_NAME,
        labels,
        textChannelId
      });
    } catch (e) {
      log(`bard-cron: error for session ${sessionKey}: ${e?.message}`, "error", { moduleName: MODULE_NAME });
    }
  }

  return coreData;
}
