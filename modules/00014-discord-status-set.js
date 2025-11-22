/**********************************************************************************************************************
/* filename: "discord-status-set.js"                                                                                 *
/* Version 1.0                                                                                                       *
/* Purpose: Discord presence updater                                                                                 *
/**********************************************************************************************************************/
/**********************************************************************************************************************
/*                                                                                                                    *
/**********************************************************************************************************************/

import * as registry from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import mysql from "mysql2/promise";

const MODULE_NAME = "discord-status-set";
const REGISTRY_TOOL_KEY = "status:tool";
const REGISTRY_AI_KEY = "status:ai";
const CLIENT_REF = "discord:client";

const getItem = registry.getItem;
const setItem = typeof registry.setItem === "function" ? registry.setItem : null;

/**********************************************************************************************************************
/* functionSignature: getNum (v, d)                                                                                   *
/* Parses a number or returns default                                                                                 *
/**********************************************************************************************************************/
function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**********************************************************************************************************************
/* functionSignature: getStr (v, d)                                                                                   *
/* Returns a non-empty string or default                                                                              *
/**********************************************************************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/**********************************************************************************************************************
/* functionSignature: getBool (v, d)                                                                                  *
/* Returns a boolean or default                                                                                       *
/**********************************************************************************************************************/
function getBool(v, d) {
  return typeof v === "boolean" ? v : d;
}

/**********************************************************************************************************************
/* functionSignature: getHardTrimmed (s, maxChars)                                                                     *
/* Collapses whitespace and hard-limits to max characters                                                              *
/**********************************************************************************************************************/
function getHardTrimmed(s, maxChars) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!maxChars || maxChars <= 0) return t;
  return t.length <= maxChars ? t : t.slice(0, maxChars).trim();
}

/**********************************************************************************************************************
/* functionSignature: getFillTemplate (tpl, vars)                                                                      *
/* Replaces {KEY} placeholders with provided values                                                                    *
/**********************************************************************************************************************/
function getFillTemplate(tpl, vars) {
  if (!tpl) return "";
  return tpl.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : ""
  );
}

/**********************************************************************************************************************
/* functionSignature: getAllowedChannels (cfg)                                                                         *
/* Resolves allowed channel IDs for DB context selection                                                               *
/**********************************************************************************************************************/
function getAllowedChannels(cfg) {
  if (cfg?.aiGenerator && "allowedChannels" in cfg.aiGenerator) {
    return cfg.aiGenerator.allowedChannels;
  }
  return cfg?.allowedChannels;
}

/**********************************************************************************************************************
/* functionSignature: getIsPlaceholderOnlyMode (cfg, log)                                                              *
/* True if allowedChannels = [] → placeholder-only mode                                                                *
/**********************************************************************************************************************/
function getIsPlaceholderOnlyMode(cfg, log) {
  const raw = getAllowedChannels(cfg);
  if (raw === undefined) return false;
  if (Array.isArray(raw) && raw.length === 0) {
    log(
      "aiGenerator.allowedChannels is an empty array → placeholder-only mode (no DB, no AI)",
      "debug",
      { moduleName: MODULE_NAME }
    );
    return true;
  }
  return false;
}

/**********************************************************************************************************************
/* functionSignature: getDsnString (db)                                                                                *
/* Builds a compact DSN-like string for pool identity                                                                  *
/**********************************************************************************************************************/
function getDsnString(db) {
  const h = db?.host || "localhost";
  const u = db?.user || "";
  const n = db?.database || "";
  return `${u}@${h}/${n}`;
}

/**********************************************************************************************************************
/* functionSignature: getDbPool (workingDb)                                                                            *
/* Returns a shared MySQL pool for the given DB config                                                                 *
/**********************************************************************************************************************/
let sharedPool = null;
let sharedDsn = "";
async function getDbPool(workingDb) {
  if (!workingDb?.host || !workingDb?.user || !workingDb?.database) {
    throw new Error("workingObject.db is missing required fields (host/user/database)");
  }
  const dsn = getDsnString(workingDb);
  if (!sharedPool || sharedDsn !== dsn) {
    sharedPool?.end?.();
    sharedPool = mysql.createPool({
      host: workingDb.host,
      user: workingDb.user,
      password: workingDb.password,
      database: workingDb.database,
      waitForConnections: true,
      connectionLimit: 4,
      charset: "utf8mb4"
    });
    sharedDsn = dsn;
  }
  return sharedPool;
}

/**********************************************************************************************************************
/* functionSignature: getRecentContextRows (workingDb, opts)                                                           *
/* Fetches recent context rows; filters by allowed channels                                                            *
/**********************************************************************************************************************/
async function getRecentContextRows(workingDb, { limit = 20, allowedChannels } = {}) {
  const pool = await getDbPool(workingDb);
  const L = Math.max(1, getNum(limit, 20));
  const args = [];
  let sql =
    "SELECT ctx_id, ts, id, text, role " +
    "FROM context " +
    "WHERE text IS NOT NULL AND text <> '' AND frozen = 0 ";
  if (Array.isArray(allowedChannels) && allowedChannels.length > 0) {
    const cleaned = allowedChannels.map((c) => String(c || "").trim()).filter(Boolean);
    if (cleaned.length > 0) {
      const placeholders = cleaned.map(() => "?").join(",");
      sql += `AND id IN (${placeholders}) `;
      args.push(...cleaned);
    }
  }
  sql += "ORDER BY ctx_id DESC LIMIT ?";
  args.push(L);
  const [rows] = await pool.query(sql, args);
  return Array.isArray(rows) ? rows : [];
}

/**********************************************************************************************************************
/* functionSignature: getSummarizedRows (rows, maxCharsPerLine)                                                        *
/* Builds compact U:/A:/S: snippets from context rows                                                                  *
/**********************************************************************************************************************/
function getSummarizedRows(rows, maxCharsPerLine = 160) {
  const parts = [];
  for (const r of rows) {
    const role = (r.role || "").toLowerCase();
    const tag = role.startsWith("user") ? "U" : (role.startsWith("assistant") ? "A" : "S");
    const snippet = String(r.text || "").replace(/\s+/g, " ").trim();
    if (!snippet) continue;
    const trimmed = getHardTrimmed(snippet, maxCharsPerLine);
    parts.push(`${tag}: ${trimmed}`);
  }
  return parts.reverse().join("\n");
}

/**********************************************************************************************************************
/* functionSignature: getToolStatusFromRegistry ()                                                                      *
/* Reads current tool status from registry                                                                             *
/**********************************************************************************************************************/
async function getToolStatusFromRegistry() {
  if (typeof getItem !== "function") {
    return { hasTool: false, toolName: "" };
  }
  try {
    const tool = await getItem(REGISTRY_TOOL_KEY);
    const name = typeof tool === "string" ? tool : (tool?.name || "");
    const toolName = String(name || "").trim();
    return { hasTool: !!toolName, toolName };
  } catch {
    return { hasTool: false, toolName: "" };
  }
}

/**********************************************************************************************************************
/* functionSignature: getPresenceTextForTool (toolName, mapping)                                                        *
/* Maps tool name to presence text or builds a default                                                                  *
/**********************************************************************************************************************/
function getPresenceTextForTool(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}

/**********************************************************************************************************************
/* functionSignature: setDiscordPresence (text, status, log)                                                            *
/* Sets Discord user presence via client from registry                                                                  *
/**********************************************************************************************************************/
let lastPresenceText = "";
async function setDiscordPresence(text, status, log) {
  if (typeof getItem !== "function") {
    log("registry.getItem not available; cannot resolve discord client", "error", {
      moduleName: MODULE_NAME
    });
    return;
  }
  let client;
  try {
    client = await getItem(CLIENT_REF);
  } catch (e) {
    log(`failed to get discord client from registry: ${e?.message || String(e)}`, "error", {
      moduleName: MODULE_NAME
    });
    return;
  }
  if (!client?.user || typeof client.user.setPresence !== "function") {
    log("no valid discord client available; cannot set presence", "debug", { moduleName: MODULE_NAME });
    return;
  }
  const presenceText = getStr(text, "").trim() || " ";
  const presenceStatus = getStr(status, "online");
  if (presenceText === lastPresenceText) {
    log(`presence unchanged → "${presenceText}" [${presenceStatus}]`, "debug", { moduleName: MODULE_NAME });
    return;
  }
  try {
    await client.user.setPresence({
      status: presenceStatus,
      activities: [{ name: presenceText, type: 0 }]
    });
    lastPresenceText = presenceText;
    log(`set presence to: "${presenceText}" [${presenceStatus}]`, "info", { moduleName: MODULE_NAME });
  } catch (e) {
    log(`failed to set Discord presence: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
  }
}

/**********************************************************************************************************************
/* functionSignature: getGeneratedAIStatus (cfg, log, lastKnownText, workingDb)                                         *
/* Calls AI endpoint to craft a short presence line                                                                     *
/**********************************************************************************************************************/
async function getGeneratedAIStatus(cfg, log, lastKnownText, workingDb) {
  const ai = cfg.aiGenerator || {};
  const endpoint = getStr(ai.endpoint, "");
  const model = getStr(ai.model, "");
  const apiKey = getStr(ai.apiKey, "");
  const maxChars = getNum(ai.maxChars, 40);
  const tokenLimit = getNum(ai.tokenLimit, 32);
  const limit = getNum(ai.limit, 20);
  if (!endpoint || !model) {
    log("aiGenerator endpoint/model not configured; skip", "warn", { moduleName: MODULE_NAME });
    return "";
  }
  const rawAllowed = getAllowedChannels(cfg);
  let dbAllowed = undefined;
  if (Array.isArray(rawAllowed) && rawAllowed.length > 0) {
    dbAllowed = rawAllowed;
  } else {
    dbAllowed = undefined;
  }
  const lastStatus =
    getStr(ai._lastStatus, "") ||
    getStr(cfg._lastStatus, "") ||
    getStr(lastKnownText, "");
  let snippetsText = "";
  if (workingDb) {
    try {
      const rows = await getRecentContextRows(workingDb, { limit, allowedChannels: dbAllowed });
      if (rows.length) {
        snippetsText = getSummarizedRows(rows, Math.max(60, Math.floor(maxChars * 2.5)));
      }
    } catch (e) {
      log(`DB fetch for status snippets failed: ${e?.message || String(e)}`, "warn", { moduleName: MODULE_NAME });
    }
  }
  const template =
    getStr(ai.template, "") ||
    "Write ONE very short Discord status (<= {MAX} chars). No emojis, no hashtags. Snippets:\n{SNIPS}";
  const userPrompt = getFillTemplate(template, { MAX: maxChars, LAST: lastStatus, SNIPS: snippetsText || "" });
  const systemPrompt =
    getStr(ai.system, "") || "You craft ultra-short, non-repetitive Discord presence lines.";
  const body = {
    model,
    max_tokens: tokenLimit,
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  log(`calling aiGenerator at ${endpoint} with model=${model}`, "debug", { moduleName: MODULE_NAME });
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    log(`aiGenerator fetch failed: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
    return "";
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log(`aiGenerator HTTP ${res.status}: ${text.slice(0, 300)}`, "error", { moduleName: MODULE_NAME });
    return "";
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    log(`aiGenerator JSON parse failed: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
    return "";
  }
  const statusText =
    data?.choices?.[0]?.message?.content?.trim() ||
    data?.choices?.[0]?.text?.trim() ||
    "";
  const finalText = getHardTrimmed(statusText, maxChars);
  if (!finalText) {
    log("aiGenerator returned empty status", "warn", { moduleName: MODULE_NAME });
    return "";
  }
  ai._lastStatus = finalText;
  cfg._lastStatus = finalText;
  if (setItem) {
    try {
      await setItem(REGISTRY_AI_KEY, finalText);
    } catch (e) {
      log(`failed to store AI status in registry: ${e?.message || String(e)}`, "warn", { moduleName: MODULE_NAME });
    }
  }
  return finalText;
}

/**********************************************************************************************************************
/* functionSignature: getDiscordStatusSetFlow (baseCore)                                                                *
/* Flow entry: decides and updates Discord presence                                                                     *
/**********************************************************************************************************************/
let lastUpdateAt = 0;
let lastAiStatusInMemory = "";
export default async function getDiscordStatusSetFlow(baseCore) {
  const log = getPrefixedLogger(baseCore?.workingObject || {}, import.meta.url);
  const cfg =
    baseCore?.config?.[MODULE_NAME] ||
    baseCore?.config?.["cron-discord-status"] ||
    {};

  const updateStatusFlag =
    String(baseCore?.workingObject?.updateStatus || "").toLowerCase() === "true";

  const now = Date.now();
  const placeholderEnabled = getBool(cfg.placeholderEnabled, true);
  const placeholderText = getStr(cfg.placeholderText, " // xbullseyegaming.de // ");
  const status = getStr(cfg.status, "online");
  const mapping = cfg.mapping || {};
  const minUpdateGapMs = getNum(cfg.minUpdateGapMs, 30000);

  if (!updateStatusFlag && now - lastUpdateAt < minUpdateGapMs) {
    log(
      `skip presence update (minUpdateGapMs=${minUpdateGapMs} not reached)`,
      "debug",
      { moduleName: MODULE_NAME }
    );
    return;
  }

  const workingDb = baseCore?.workingObject?.db || baseCore?.db || null;
  const { hasTool, toolName } = await getToolStatusFromRegistry();

  if (hasTool) {
    const mappedText = getPresenceTextForTool(toolName, mapping);
    await setDiscordPresence(mappedText, status, log);
    lastUpdateAt = now;
    return;
  }

  const placeholderOnly = getIsPlaceholderOnlyMode(cfg, log);
  if (placeholderOnly) {
    if (placeholderEnabled) {
      await setDiscordPresence(placeholderText, status, log);
      lastUpdateAt = now;
    } else {
      log("placeholder-only mode but placeholderEnabled=false → nothing to set", "debug", {
        moduleName: MODULE_NAME
      });
    }
    return;
  }

  let lastAi = lastAiStatusInMemory;
  if (typeof getItem === "function") {
    try {
      const regVal = await getItem(REGISTRY_AI_KEY);
      if (regVal) {
        lastAi = getStr(regVal, lastAi);
      }
    } catch {}

  }

  if (lastAi) {
    await setDiscordPresence(lastAi, status, log);
  } else if (placeholderEnabled) {
    await setDiscordPresence(placeholderText, status, log);
  }

  const newAiStatus = await getGeneratedAIStatus(cfg, log, lastAi, workingDb);
  if (newAiStatus) {
    lastAiStatusInMemory = newAiStatus;
    await setDiscordPresence(newAiStatus, status, log);
    lastUpdateAt = now;
  } else if (placeholderEnabled) {
    await setDiscordPresence(placeholderText, status, log);
    lastUpdateAt = now;
  } else {
    log("no status to set (AI empty, placeholder disabled)", "debug", { moduleName: MODULE_NAME });
  }
}
