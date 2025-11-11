/**************************************************************************************
/* filename: "discord-status.js"                                                      *
/* Version 1.0                                                                        *
/* Purpose: Update Discord presence from DB/AI with tool mapping and stable fallback  *
/**************************************************************************************/

/**************************************************************************************
/*                                                                                    *
/**************************************************************************************/
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import mysql from "mysql2/promise";

const MODULE_NAME = "discord-status";
const REGISTRY_KEY = "status:tool";
const CLIENT_REF = "discord:client";

/**************************************************************************************
/* functionSignature: getNum (v, d)                                                   *
/* Returns a finite number or a default                                               *
/**************************************************************************************/
function getNum(v, d) { return Number.isFinite(v) ? Number(v) : d; }

/**************************************************************************************
/* functionSignature: getStr (v, d)                                                   *
/* Returns a non-empty string or a default                                            *
/**************************************************************************************/
function getStr(v, d) { return (typeof v === "string" && v.length) ? v : d; }

/**************************************************************************************
/* functionSignature: getBool (v, d)                                                  *
/* Returns a boolean or a default                                                     *
/**************************************************************************************/
function getBool(v, d) { return (typeof v === "boolean") ? v : d; }

/**************************************************************************************
/* functionSignature: getClamped (n, lo, hi)                                          *
/* Clamps a number between bounds                                                     *
/**************************************************************************************/
function getClamped(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**************************************************************************************
/* functionSignature: getJitteredMs (ms, pct)                                         *
/* Adds symmetric jitter to a base interval                                           *
/**************************************************************************************/
function getJitteredMs(ms, pct = 0.2) {
  const p = Math.max(0, Math.min(0.9, pct));
  const delta = Math.round(ms * p);
  return Math.max(1000, ms + Math.floor((Math.random() * 2 - 1) * delta));
}

/**************************************************************************************
/* functionSignature: getHardTrimmed (s, maxChars)                                    *
/* Trims, collapses whitespace, and enforces a max length                             *
/**************************************************************************************/
function getHardTrimmed(s, maxChars) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!maxChars || maxChars <= 0) return t;
  return t.length <= maxChars ? t : t.slice(0, maxChars).trim();
}

/**************************************************************************************
/* functionSignature: setApplyPresence (client, text, status)                         *
/* Applies a presence with activity name and status                                   *
/**************************************************************************************/
async function setApplyPresence(client, text, status = "online") {
  if (!client || !client.user || typeof client.user.setPresence !== "function") return false;
  const name = getHardTrimmed(text, 128);
  const activities = name ? [{ type: 4, name }] : [];
  try {
    await client.user.setPresence({ activities, status });
    return true;
  } catch {
    return false;
  }
}

/**************************************************************************************
/* functionSignature: getPresenceText (toolName, mapping)                             *
/* Resolves a tool name to a mapped presence text                                     *
/**************************************************************************************/
function getPresenceText(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}

let sharedPool = null;
let sharedDsn = "";

/**************************************************************************************
/* functionSignature: getDsnString (db)                                               *
/* Builds a display-only DSN fingerprint                                              *
/**************************************************************************************/
function getDsnString(db) {
  const h = db?.host || "localhost";
  const u = db?.user || "";
  const n = db?.database || "";
  return `${u}@${h}/${n}`;
}

/**************************************************************************************
/* functionSignature: getDbPool (workingDb)                                           *
/* Returns a shared MySQL pool bound to workingObject.db                              *
/**************************************************************************************/
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

/**************************************************************************************
/* functionSignature: getRecentContextRows (workingDb, opts)                          *
/* Fetches the most recent context rows                                               *
/**************************************************************************************/
async function getRecentContextRows(workingDb, { limit = 20, contextId = "" } = {}) {
  const pool = await getDbPool(workingDb);
  const L = Math.max(1, getNum(limit, 20));
  const args = [];
  let sql =
    "SELECT ctx_id, ts, id, text, role FROM context " +
    "WHERE text IS NOT NULL AND text <> '' ";
  if (contextId) { sql += "AND id = ? "; args.push(contextId); }
  sql += "ORDER BY ctx_id DESC LIMIT ?"; args.push(L);
  const [rows] = await pool.query(sql, args);
  return Array.isArray(rows) ? rows : [];
}

/**************************************************************************************
/* functionSignature: getSummarizedRows (rows, maxCharsPerLine)                       *
/* Builds compact U/A/S-tagged snippets from rows                                     *
/**************************************************************************************/
function getSummarizedRows(rows, maxCharsPerLine = 160) {
  const parts = [];
  for (const r of rows) {
    const role = (r.role || "").toLowerCase();
    const tag = role.startsWith("user") ? "U" : (role.startsWith("assistant") ? "A" : "S");
    const snippet = String(r.text || "").replace(/\s+/g, " ").trim();
    if (!snippet) continue;
    parts.push(`${tag}: ${getHardTrimmed(snippet, maxCharsPerLine)}`);
  }
  return parts.reverse().join("\n");
}

/**************************************************************************************
/* functionSignature: getAiStatusFromDb (aiCfg, workingDb, lastStableText, log)       *
/* Generates a short status from recent DB snippets                                   *
/**************************************************************************************/
async function getAiStatusFromDb(aiCfg, workingDb, lastStableText, log) {
  const endpoint = getStr(aiCfg?.endpoint, "");
  const apiKey = getStr(aiCfg?.apiKey, "");
  const model = getStr(aiCfg?.model, "gpt-4o-mini");
  const tokenLimit = Math.max(8, getNum(aiCfg?.tokenLimit, 32));
  const maxChars = getClamped(getNum(aiCfg?.maxChars, 30), 8, 128);
  const limit = Math.max(1, getNum(aiCfg?.limit, 20));
  const contextId = getStr(aiCfg?.contextId, "");
  const systemTxt = getStr(
    aiCfg?.system,
    "You write ultra-short, useful Discord presence lines, ≤ the requested char limit, no hashtags or emojis."
  );
  const tpl = getStr(
    aiCfg?.template,
    'From the recent snippets, write ONE activity-style status (≤{MAX} chars). Avoid repeating: "{LAST}".\nSnippets:\n{SNIPS}'
  );

  if (!endpoint || !apiKey) return "";

  let rows = [];
  try {
    rows = await getRecentContextRows(workingDb, { limit, contextId });
  } catch (e) {
    log?.(`DB fetch failed: ${e?.message || String(e)}`, "warn", { moduleName: MODULE_NAME });
    return "";
  }
  if (!rows.length) return "";

  const snips = getSummarizedRows(rows, Math.max(60, Math.floor(maxChars * 2.5)));
  const userPrompt = tpl
    .replaceAll("{MAX}", String(maxChars))
    .replaceAll("{LAST}", String(lastStableText || ""))
    .replaceAll("{SNIPS}", snips);

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  async function getTriedFetch(url, body) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  let text = "";
  try {
    const bodyResponses = {
      model,
      input: [
        { role: "system", content: [{ type: "text", text: systemTxt }] },
        { role: "user", content: [{ type: "text", text: userPrompt }] }
      ],
      max_output_tokens: tokenLimit
    };
    const j = await getTriedFetch(endpoint, bodyResponses);
    const c =
      j?.output?.[0]?.content?.[0]?.text ||
      j?.output_text ||
      j?.choices?.[0]?.message?.content ||
      j?.message?.content?.[0]?.text ||
      "";
    text = getHardTrimmed(c, maxChars);
  } catch {
    try {
      const bodyChat = {
        model,
        max_tokens: tokenLimit,
        messages: [
          { role: "system", content: systemTxt },
          { role: "user", content: userPrompt }
        ]
      };
      const j = await getTriedFetch(endpoint, bodyChat);
      const c = j?.choices?.[0]?.message?.content || "";
      text = getHardTrimmed(c, maxChars);
    } catch (e2) {
      log?.(`AI status generation failed: ${e2?.message || String(e2)}`, "warn", { moduleName: MODULE_NAME });
      return "";
    }
  }

  text = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  text = getHardTrimmed(text, maxChars);
  if (!text) return "";
  if (lastStableText && text.toLowerCase() === String(lastStableText).toLowerCase()) return "";
  return text;
}

/**************************************************************************************
/* functionSignature: getStartWatcher (cfg, log, workingDb)                           *
/* Starts the poller that updates presence from tools or AI                           *
/**************************************************************************************/
function getStartWatcher(cfg, log, workingDb) {
  const mapping = cfg?.mapping || {};
  const status = getStr(cfg?.status, "online");
  const pollMs = Math.max(100, getNum(cfg?.pollMs, 300));

  const randomEnabled = getBool(cfg?.randomEnabled, true);
  const aiCfg = cfg?.aiGenerator || null;
  const randomIntervalMs = Math.max(5000, getNum(cfg?.randomIntervalMs, 60000));
  const randomJitterPct = Math.max(0, Math.min(0.9, getNum(cfg?.randomJitterPct, 0.25)));

  const placeholderEnabled = getBool(cfg?.placeholderEnabled, true);
  const placeholderText = getStr(cfg?.placeholderText, "…");

  const minUpdateGapMs = Math.max(0, getNum(cfg?.minUpdateGapMs, 800));
  let lastSetAtMs = 0;

  let lastToolName = "__init__";
  let lastClientId = "__none__";
  let lastPresenceText = "";
  let lastStableText = "";
  let nextRandomDueAt = Date.now() + getJitteredMs(randomIntervalMs, randomJitterPct);
  let inflight = false;

  async function setMaybePresence(client, text) {
    const now = Date.now();
    if (now - lastSetAtMs < minUpdateGapMs && text === lastPresenceText) return false;
    const ok = await setApplyPresence(client, text, status);
    if (ok) {
      lastPresenceText = text;
      if (text && text !== placeholderText) {
        lastStableText = text;
      }
      lastSetAtMs = now;
      log(`presence set → "${text || "idle"}"`, "info", { moduleName: MODULE_NAME });
    }
    return ok;
  }

  async function getTick() {
    try {
      const client = await getItem(CLIENT_REF);
      const tool = await getItem(REGISTRY_KEY);
      const toolName = typeof tool === "string" ? tool : (tool?.name || "");
      const hasTool = !!String(toolName || "").trim();

      if (hasTool) {
        const mapped = getPresenceText(toolName, mapping);
        if (mapped !== lastPresenceText) await setMaybePresence(client, mapped);
      } else if (randomEnabled && aiCfg) {
        const now = Date.now();
        const toolCleared = !!lastToolName && lastToolName !== "__init__";
        const needImmediate = toolCleared || !lastPresenceText || now >= nextRandomDueAt;

        if (needImmediate && !inflight) {
          inflight = true;
          const prevStable = lastStableText;

          if (placeholderEnabled && lastPresenceText !== placeholderText) {
            await setMaybePresence(client, placeholderText);
          }

          try {
            const t = await getAiStatusFromDb(aiCfg, workingDb, prevStable, log);
            if (t) {
              if (t !== lastPresenceText) {
                await setMaybePresence(client, t);
              }
            } else {
              if (lastPresenceText === placeholderText) {
                await setMaybePresence(client, prevStable || "");
              }
            }
          } finally {
            inflight = false;
            nextRandomDueAt = now + getJitteredMs(randomIntervalMs, randomJitterPct);
          }
        }
      } else {
        if (lastPresenceText !== "") await setMaybePresence(client, "");
      }

      const cid = (await getItem(CLIENT_REF))?.user?.id || "unknown";
      lastClientId = cid;
      lastToolName = hasTool ? toolName : "";
    } catch (e) {
      log("presence update failed", "error", { moduleName: MODULE_NAME, error: e?.message || String(e) });
    } finally {
      setTimeout(getTick, pollMs);
    }
  }

  setTimeout(getTick, 0);
}

/**************************************************************************************
/* functionSignature: getDiscordStatusFlow (baseCore, runFlow, createRunCore)         *
/* Entry point: initializes logger and watcher                                        *
/**************************************************************************************/
export default async function getDiscordStatusFlow(baseCore, runFlow, createRunCore) {
  const rc = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || {};
  const workingDb = rc?.workingObject?.db || baseCore?.workingObject?.db;
  getStartWatcher(cfg, log, workingDb);
}

