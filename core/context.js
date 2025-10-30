/***************************************************************
/* filename: "context.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Minimal MySQL context store + rolling timeline      *
/*          summaries                                           *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import mysql from "mysql2/promise";
import crypto from "crypto";

let sharedPool = null;
let sharedDsn = "";

const TIMELINE_TABLE = "timeline_periods";

/***************************************************************
/* functionSignature: getContextConfig (workingObject)         *
/* Resolves endpoint, model, apiKey, and periodSize settings.  *
/***************************************************************/
function getContextConfig(workingObject) {
  const ctxCfg = workingObject?.config?.context || {};
  const endpoint = ctxCfg.endpoint
    || workingObject?.Endpoint
    || process.env.OPENAI_ENDPOINT
    || "https://api.openai.com/v1/chat/completions";
  const model = ctxCfg.model
    || workingObject?.Model
    || "gpt-4o-mini";
  const apiKey = ctxCfg.apiKey
    || workingObject?.APIKey
    || workingObject?.apiKey
    || process.env.OPENAI_API_KEY
    || "";
  const periodSize = Number.isFinite(ctxCfg.periodSize)
    ? Number(ctxCfg.periodSize)
    : 600;
  return { endpoint, model, apiKey, periodSize };
}

/***************************************************************
/* functionSignature: getDsnKey (db)                           *
/* Creates a stable key for the DB connection configuration.   *
/***************************************************************/
function getDsnKey(db) {
  const host = db?.host || "";
  const port = db?.port ?? 3306;
  const user = db?.user || "";
  const database = db?.database || "";
  const charset = db?.charset || "utf8mb4";
  return `${host}|${port}|${user}|${database}|${charset}`;
}

/***************************************************************
/* functionSignature: getEnsurePool (workingObject)            *
/* Ensures a pooled MySQL connection and required tables.      *
/***************************************************************/
async function getEnsurePool(workingObject) {
  const db = workingObject?.db;
  if (!db) throw new Error("[context] missing db configuration");
  const dsnKey = getDsnKey(db);
  if (sharedPool && sharedDsn === dsnKey) return sharedPool;
  const pool = mysql.createPool({
    host: db.host,
    port: db.port ?? 3306,
    user: db.user,
    password: db.password,
    database: db.database,
    charset: db.charset ?? "utf8mb4",
    connectionLimit: 4,
    decimalNumbers: true
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS context (
      ts        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id        VARCHAR(128)  NOT NULL,
      json      LONGTEXT      NOT NULL,
      text      TEXT          NULL,
      role      VARCHAR(32)   NOT NULL DEFAULT 'user',
      turn_id   CHAR(26)      NULL,
      KEY idx_id_ts         (id, ts),
      KEY idx_role          (role),
      KEY idx_turn          (turn_id),
      KEY idx_id_turn       (id, turn_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TIMELINE_TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      channel_id VARCHAR(128) NOT NULL,
      start_idx INT NOT NULL,
      end_idx INT NOT NULL,
      start_ts DATETIME NULL,
      end_ts DATETIME NULL,
      summary TEXT NOT NULL,
      model VARCHAR(64) NOT NULL,
      checksum CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_timeline (channel_id, start_idx, end_idx)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  sharedPool = pool;
  sharedDsn = dsnKey;
  return pool;
}

/***************************************************************
/* functionSignature: getDeepSanitize (value)                  *
/* Produces JSON-safe values while preserving key structure.   *
/***************************************************************/
function getDeepSanitize(value) {
  const t = typeof value;
  if (value === null) return null;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 6).join("\n") : undefined
    };
  }
  if (t === "function" || t === "undefined") return undefined;
  if (Array.isArray(value)) return value.map(v => getDeepSanitize(v)).filter(v => v !== undefined);
  if (value instanceof Map) return Array.from(value.entries()).map(([k, v]) => [getDeepSanitize(k), getDeepSanitize(v)]);
  if (value instanceof Set) return Array.from(value.values()).map(getDeepSanitize);
  if (t === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      const sv = getDeepSanitize(value[k]);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}

/***************************************************************
/* functionSignature: getNormalizeToolCalls (toolCalls)        *
/* Normalizes assistant tool_calls shape for storage.          *
/***************************************************************/
function getNormalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return undefined;
  return toolCalls.map(tc => ({
    id: tc?.id,
    type: "function",
    function: {
      name: tc?.function?.name,
      arguments: typeof tc?.function?.arguments === "string"
        ? tc.function.arguments
        : (tc?.function?.arguments ? JSON.stringify(tc.function.arguments) : "{}")
    }
  }));
}

/***************************************************************
/* functionSignature: getNormalizeRecord (record)              *
/* Produces a sanitized record suitable for DB insertion.      *
/***************************************************************/
function getNormalizeRecord(record) {
  const obj = typeof record === "object" && record !== null ? { ...record } : {};
  obj.role = typeof obj.role === "string" ? obj.role : "";
  obj.content = typeof obj.content === "string" ? obj.content : "";
  if (obj.role === "assistant" && Array.isArray(obj.tool_calls)) obj.tool_calls = getNormalizeToolCalls(obj.tool_calls);
  if (obj.role === "tool") {
    obj.tool_call_id = obj.tool_call_id ?? obj.id ?? undefined;
    obj.name = obj.name ?? undefined;
  }
  return getDeepSanitize(obj);
}

/***************************************************************
/* functionSignature: getDeriveIndexText (rec)                 *
/* Derives a short index text for LIKE/search acceleration.    *
/***************************************************************/
function getDeriveIndexText(rec) {
  if (typeof rec?.content === "string" && rec.content) return rec.content.slice(0, 500);
  const bits = [];
  if (rec?.role) bits.push(`[${rec.role}]`);
  if (rec?.authorName) bits.push(String(rec.authorName));
  if (rec?.userId) bits.push(`uid:${rec.userId}`);
  if (rec?.messageId) bits.push(`mid:${rec.messageId}`);
  return bits.join(" ").slice(0, 500) || null;
}

/***************************************************************
/* functionSignature: getApproxTokensFromMessage (msg)         *
/* Approximates token usage for a single message.              *
/***************************************************************/
function getApproxTokensFromMessage(msg) {
  function str(x) { return typeof x === "string" ? x : (x ? JSON.stringify(x) : ""); }
  let s = "";
  s += str(msg.role);
  s += str(msg.name);
  s += str(msg.content);
  if (msg.tool_call_id) s += str(msg.tool_call_id);
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      s += str(tc?.type);
      s += str(tc?.function?.name);
      s += str(tc?.function?.arguments);
    }
  }
  return Math.ceil(s.length / 4);
}

/***************************************************************
/* functionSignature: getTokensForString (s)                   *
/* Approximates token count for a raw string.                  *
/***************************************************************/
function getTokensForString(s) {
  return Math.ceil(String(s ?? "").length / 4);
}

/***************************************************************
/* functionSignature: getCloneForTrim (obj)                    *
/* Deep clones an object for safe trimming operations.         *
/***************************************************************/
function getCloneForTrim(obj) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

/***************************************************************
/* functionSignature: getTrimStringByTokens (s, maxTokens)     *
/* Trims a string to a token budget with ellipsis.             *
/***************************************************************/
function getTrimStringByTokens(s, maxTokens) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return "";
  const str = String(s ?? "");
  const approxChars = Math.max(0, Math.floor(maxTokens * 4) - 1);
  if (str.length <= approxChars) return str;
  let lo = 0, hi = str.length, best = "";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = str.slice(0, Math.max(0, mid - 1)) + "…";
    const t = getTokensForString(cand);
    if (t <= maxTokens) { best = cand; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best || "…";
}

/***************************************************************
/* functionSignature: getTrimMessageToBudget (msg, budget)     *
/* Trims a message structure to fit a token budget.            *
/***************************************************************/
function getTrimMessageToBudget(msg, budget) {
  const out = getCloneForTrim(msg);
  const base = { role: out.role, name: out.name, tool_call_id: out.tool_call_id };
  let minTokens = getApproxTokensFromMessage({ ...base, content: "", tool_calls: [] });
  if (minTokens > budget) {
    return { role: out.role, content: "…" };
  }
  let remain = budget - minTokens;
  if (typeof out.content === "string" && out.content.length) {
    const tContent = getTokensForString(out.content);
    if (tContent <= remain) {
      minTokens += tContent;
      remain -= tContent;
    } else {
      out.content = getTrimStringByTokens(out.content, remain);
      return out;
    }
  }
  if (Array.isArray(out.tool_calls) && out.tool_calls.length && remain > 0) {
    const trimmedTC = [];
    for (const tc of out.tool_calls) {
      const safe = getCloneForTrim(tc);
      const headerTokens = getTokensForString(safe?.function?.name ?? "") + 3;
      if (headerTokens > remain) break;
      remain -= headerTokens;
      let arg = String(safe?.function?.arguments ?? "");
      const argTokens = getTokensForString(arg);
      if (argTokens <= remain) {
        trimmedTC.push(safe);
        remain -= argTokens;
      } else {
        safe.function.arguments = getTrimStringByTokens(arg, remain);
        trimmedTC.push(safe);
        remain = 0;
        break;
      }
    }
    out.tool_calls = trimmedTC;
  }
  return out;
}

/***************************************************************
/* functionSignature: getBundleToolTransactions (block)        *
/* Groups assistant tool calls with their tool responses.      *
/***************************************************************/
function getBundleToolTransactions(block) {
  const units = [];
  for (let i = 0; i < block.length; i++) {
    const msg = block[i];
    if (msg?.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const callIds = new Set(
        msg.tool_calls.map(tc => (tc?.id || tc?.tool_call_id || "").toString()).filter(Boolean)
      );
      const unit = [msg];
      let j = i + 1;
      while (j < block.length) {
        const next = block[j];
        if (next?.role === "tool" && callIds.has(String(next?.tool_call_id || ""))) {
          unit.push(next);
          j++;
          continue;
        }
        break;
      }
      units.push(unit);
      i = j - 1;
      continue;
    }
    units.push([msg]);
  }
  return units;
}

/***************************************************************
/* functionSignature: getApproxTokensFromUnit (unit)           *
/* Sums approximate tokens for a grouped unit.                 *
/***************************************************************/
function getApproxTokensFromUnit(unit) {
  return unit.reduce((acc, m) => acc + getApproxTokensFromMessage(m), 0);
}

/***************************************************************
/* functionSignature: getTrimUnitToBudget (unit, budget)       *
/* Trims a unit to match a token budget from the end.          *
/***************************************************************/
function getTrimUnitToBudget(unit, budget) {
  const kept = [];
  let used = 0;
  for (let i = unit.length - 1; i >= 0; i--) {
    const msg = unit[i];
    const t = getApproxTokensFromMessage(msg);
    if (used + t <= budget) {
      kept.push(msg);
      used += t;
    } else {
      const remain = budget - used;
      if (remain <= 0) break;
      const trimmed = getTrimMessageToBudget(msg, remain);
      if (getApproxTokensFromMessage(trimmed) <= remain) {
        kept.push(trimmed);
        used = budget;
      }
      break;
    }
  }
  kept.reverse();
  return kept;
}

/***************************************************************
/* functionSignature: getCapSingleBlockToBudgetUnits (block,   *
/*                     budget)                                 *
/* Applies token capping across a contiguous message block.    *
/***************************************************************/
function getCapSingleBlockToBudgetUnits(block, budget) {
  const units = getBundleToolTransactions(block);
  const keptUnits = [];
  let used = 0;
  for (let u = units.length - 1; u >= 0; u--) {
    const unit = units[u];
    const tUnit = getApproxTokensFromUnit(unit);
    if (used + tUnit <= budget) {
      keptUnits.push(unit);
      used += tUnit;
      continue;
    }
    const remain = budget - used;
    if (remain > 0) {
      const trimmedUnit = getTrimUnitToBudget(unit, remain);
      if (trimmedUnit.length) keptUnits.push(trimmedUnit);
      used = budget;
    }
    break;
  }
  keptUnits.reverse();
  const flat = [];
  for (const unit of keptUnits) for (const m of unit) flat.push(m);
  return flat;
}

/***************************************************************
/* functionSignature: getSegmentIntoUserBlocks (messages)      *
/* Splits history into blocks starting at user messages.       *
/***************************************************************/
function getSegmentIntoUserBlocks(messages) {
  const idxs = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] || {};
    if (m.role === "user" && typeof m.content === "string" && m.content.trim()) {
      idxs.push(i);
    }
  }
  if (idxs.length === 0) return [];
  const blocks = [];
  for (let b = 0; b < idxs.length; b++) {
    const start = idxs[b];
    const end = b + 1 < idxs.length ? idxs[b + 1] : messages.length;
    blocks.push(messages.slice(start, end));
  }
  return blocks;
}

/***************************************************************
/* functionSignature: getCapByTokenBudgetUserBlocks (messages, *
/*                     tokenBudget)                            *
/* Caps history by token budget respecting user blocks.        *
/***************************************************************/
function getCapByTokenBudgetUserBlocks(messages, tokenBudget) {
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) return messages;
  const blocks = getSegmentIntoUserBlocks(messages);
  if (blocks.length === 0) {
    return getCapSingleBlockToBudgetUnits(messages, tokenBudget);
  }
  const keptBlocks = [];
  let total = 0;
  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b];
    const blockTokens = block.reduce((acc, m) => acc + getApproxTokensFromMessage(m), 0);
    if (total + blockTokens <= tokenBudget) {
      keptBlocks.push(block);
      total += blockTokens;
      continue;
    }
    const remain = tokenBudget - total;
    if (remain > 0) {
      const trimmed = getCapSingleBlockToBudgetUnits(block, remain);
      if (trimmed.length) keptBlocks.push(trimmed);
      total = tokenBudget;
    }
    break;
  }
  keptBlocks.reverse();
  const flat = [];
  for (const bl of keptBlocks) for (const m of bl) flat.push(m);
  return flat;
}

/***************************************************************
/* functionSignature: getBuildSummaryPromptFromRows (rows,     *
/*                     meta)                                   *
/* Builds a concise summarization prompt from context rows.    *
/***************************************************************/
function getBuildSummaryPromptFromRows(rows, { startIdx, endIdx, channelId }) {
  const lines = rows.map((r, i) => {
    const j = startIdx + i;
    const ts = r.ts instanceof Date ? r.ts.toISOString() : r.ts;
    const author = r.json?.authorName || r.json?.sender || r.json?.role || "";
    const content = typeof r.json?.content === "string" ? r.json.content : "";
    const clipped = content.length > 160 ? content.slice(0, 160) + "…" : content;
    return `${j}. [${ts}] ${author}: ${clipped}`;
  }).join("\n");
  return [
    {
      role: "system",
      content: "You are a very concise chronology condenser. Summarize chat/transcript excerpts in 1-3 sentences. No speculation. Mention characters, places, and events if they are clear. Always respond in English, even if the input is in German."
    },
    {
      role: "user",
      content:
        `Context window for channel ${channelId}, records ${startIdx}-${endIdx}:\n` +
        lines +
        "\n\nReturn ONLY the 1-3 sentences in English."
    }
  ];
}

/***************************************************************
/* functionSignature: getChecksumBatchFromContextRows (rows)   *
/* Computes a stable checksum over a batch of context rows.    *
/***************************************************************/
function getChecksumBatchFromContextRows(rows) {
  const h = crypto.createHash("sha256");
  for (const r of rows) {
    h.update(String(r.ts));
    h.update("|");
    h.update(String(r.json?.content ?? ""));
    h.update("\n");
  }
  return h.digest("hex");
}

/***************************************************************
/* functionSignature: getSummarizeContextBatch (workingObject, *
/*                     rows, meta)                              *
/* Calls the LLM to summarize a batch into 1–3 sentences.      *
/***************************************************************/
async function getSummarizeContextBatch(workingObject, rows, meta) {
  const { endpoint, apiKey, model } = getContextConfig(workingObject);
  if (!apiKey) throw new Error("[context] missing OpenAI API key for timeline summary");
  const messages = getBuildSummaryPromptFromRows(rows, meta);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 180
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`[context] OpenAI error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const summary = data?.choices?.[0]?.message?.content?.trim() || "";
  return { summary, model };
}

/***************************************************************
/* functionSignature: setMaybeCreateTimelinePeriod (pool,      *
/*                     workingObject, channelId)               *
/* Creates a timeline period when a full block is available.   *
/***************************************************************/
async function setMaybeCreateTimelinePeriod(pool, workingObject, channelId) {
  const { periodSize } = getContextConfig(workingObject);
  const [cntRows] = await pool.query(
    "SELECT COUNT(*) AS c FROM context WHERE id = ?",
    [channelId]
  );
  const total = Number(cntRows?.[0]?.c || 0);
  if (!total) return;
  if (total % periodSize !== 0) return;
  const endIdx = total;
  const startIdx = total - periodSize + 1;
  const [exists] = await pool.query(
    `SELECT id FROM ${TIMELINE_TABLE} WHERE channel_id = ? AND start_idx = ? AND end_idx = ? LIMIT 1`,
    [channelId, startIdx, endIdx]
  );
  if (exists.length) return;
  const [ctxRowsDesc] = await pool.query(
    `
      SELECT ts, json
        FROM context
       WHERE id = ?
       ORDER BY ts DESC
       LIMIT ?
    `,
    [channelId, periodSize]
  );
  const ctxRows = ctxRowsDesc.slice().reverse().map(r => ({
    ts: r.ts,
    json: (() => {
      try { return JSON.parse(r.json); } catch { return { content: r.json }; }
    })()
  }));
  const startTs = ctxRows[0]?.ts ?? null;
  const endTs = ctxRows[ctxRows.length - 1]?.ts ?? null;
  const checksum = getChecksumBatchFromContextRows(ctxRows);
  const { summary, model } = await getSummarizeContextBatch(workingObject, ctxRows, {
    startIdx,
    endIdx,
    channelId
  });
  await pool.query(
    `
      INSERT INTO ${TIMELINE_TABLE}
        (channel_id, start_idx, end_idx, start_ts, end_ts, summary, model, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        summary = VALUES(summary),
        start_ts = VALUES(start_ts),
        end_ts = VALUES(end_ts),
        model = VALUES(model),
        checksum = VALUES(checksum),
        updated_at = CURRENT_TIMESTAMP
    `,
    [channelId, startIdx, endIdx, startTs, endTs, summary, model, checksum]
  );
  console.log(`[context] timeline period created: ${channelId} ${startIdx}-${endIdx}`);
}

/***************************************************************
/* functionSignature: setContext (workingObject, record)       *
/* Inserts a record and updates rolling timeline if needed.    *
/***************************************************************/
export async function setContext(workingObject, record) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const normalized = getNormalizeRecord(record);
  const json = JSON.stringify(normalized);
  const text = getDeriveIndexText(normalized);
  const role = String(normalized?.role || workingObject?.role || "user");
  const turnId = (typeof workingObject?.turn_id === "string" && workingObject.turn_id.length > 0)
    ? workingObject.turn_id
    : (typeof normalized?.turn_id === "string" && normalized.turn_id.length > 0
        ? normalized.turn_id
        : null);
  await pool.execute(
    "INSERT INTO context (id, json, text, role, turn_id) VALUES (?, ?, ?, ?, ?)",
    [id, json, text, role, turnId]
  );
  try {
    await setMaybeCreateTimelinePeriod(pool, workingObject, id);
  } catch (e) {
    console.error("[context] timeline update failed:", e?.message || e);
  }
  return true;
}

/***************************************************************
/* functionSignature: getContext (workingObject)               *
/* Returns recent context capped by token budget.              *
/***************************************************************/
export async function getContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const nRaw = Number(workingObject?.contextSize ?? 10);
  const nUsers = Number.isFinite(nRaw) ? Math.max(1, Math.floor(nRaw)) : 10;
  const [thresholdRows] = await pool.query(
    `
      SELECT MIN(ts) AS min_ts
        FROM (
          SELECT ts
            FROM context
           WHERE id = ?
             AND role = 'user'
             AND JSON_VALID(json) = 1
             AND COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(json, '$.content')), ''), NULL) IS NOT NULL
           ORDER BY ts DESC
           LIMIT ?
        ) AS last_users
    `,
    [id, nUsers]
  );
  const minTs = thresholdRows?.[0]?.min_ts || null;
  let rows;
  if (minTs) {
    [rows] = await pool.query(
      `
        SELECT ts, json
          FROM context
         WHERE id = ? AND ts >= ?
           AND JSON_VALID(json) = 1
         ORDER BY ts ASC
      `,
      [id, minTs]
    );
  } else {
    [rows] = await pool.query(
      `
        SELECT ts, json
          FROM context
         WHERE id = ?
           AND JSON_VALID(json) = 1
         ORDER BY ts ASC
      `,
      [id]
    );
  }
  const messages = [];
  for (const row of (rows || [])) {
    try {
      const obj = JSON.parse(row.json);
      messages.push({ ...obj, ts: new Date(row.ts).toISOString() });
    } catch {}
  }
  const tokenBudget = workingObject?.contextTokenBudget;
  const capped = getCapByTokenBudgetUserBlocks(messages, tokenBudget);
  return capped;
}

/***************************************************************
/* functionSignature: setPurgeContext (workingObject)          *
/* Deletes all context rows for the given workingObject id.    *
/***************************************************************/
export async function setPurgeContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const [res] = await pool.execute("DELETE FROM context WHERE id = ?", [id]);
  return Number(res?.affectedRows || 0);
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Exposes the public API: setContext, getContext, purge.      *
/***************************************************************/
function getDefaultExport() {
  return { setContext, getContext, setPurgeContext };
}

export default getDefaultExport();
