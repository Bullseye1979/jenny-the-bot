/***************************************************************
/* filename: "context.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Minimal MySQL context store with monotonic ctx_id, *
/*          rolling timeline summaries, and user-block capping.*
/***************************************************************/
/***************************************************************/

import mysql from "mysql2/promise";
import crypto from "crypto";

let sharedPool = null;
let sharedDsn = "";

const TIMELINE_TABLE = "timeline_periods";

/***************************************************************
/* functionSignature: getContextConfig (workingObject)         *
/* Resolve endpoint, model, apiKey, and timeline period size.  *
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
/* Build a stable DSN key string for pool reuse.               *
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
/* Ensure pool exists and schema with ctx_id AI PK is present. *
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
      ctx_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ts        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id        VARCHAR(128)  NOT NULL,
      json      LONGTEXT      NOT NULL,
      text      TEXT          NULL,
      role      VARCHAR(32)   NOT NULL DEFAULT 'user',
      turn_id   CHAR(26)      NULL,
      frozen    TINYINT(1)    NOT NULL DEFAULT 0,
      PRIMARY KEY (ctx_id),
      KEY idx_id_ctx (id, ctx_id),
      KEY idx_role   (role),
      KEY idx_turn   (turn_id),
      KEY idx_id_turn (id, turn_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  try {
    await pool.query(`
      ALTER TABLE context
        ADD COLUMN IF NOT EXISTS ctx_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST;
    `);
  } catch {}
  try {
    await pool.query(`
      ALTER TABLE context
        ADD PRIMARY KEY (ctx_id);
    `);
  } catch {}
  try {
    await pool.query(`
      ALTER TABLE context
        ADD INDEX IF NOT EXISTS idx_id_ctx (id, ctx_id);
    `);
  } catch {}
  try {
    await pool.query(`
      ALTER TABLE context
        ADD COLUMN IF NOT EXISTS frozen TINYINT(1) NOT NULL DEFAULT 0;
    `);
  } catch {}

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
      frozen TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY ux_timeline (channel_id, start_idx, end_idx)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await pool.query(`
      ALTER TABLE ${TIMELINE_TABLE}
        ADD COLUMN IF NOT EXISTS frozen TINYINT(1) NOT NULL DEFAULT 0;
    `);
  } catch {}

  sharedPool = pool;
  sharedDsn = dsnKey;
  return pool;
}

/***************************************************************
/* functionSignature: getDeepSanitize (value)                  *
/* Sanitize nested values to safe JSON-ready structures.       *
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
/* Normalize assistant tool call entries to a standard shape.  *
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
/* Normalize a context record and sanitize nested values.      *
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
/* Derive a short indexable text snippet from a record.        *
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
/* functionSignature: setContext (workingObject, record)       *
/* Insert a normalized record; update rolling timeline.        *
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
    "INSERT INTO context (id, json, text, role, turn_id, frozen) VALUES (?, ?, ?, ?, ?, 0)",
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
/* Return capped messages based on user-block token budgeting. *
/***************************************************************/
export async function getContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const nRaw = Number(workingObject?.contextSize ?? 10);
  const nUsers = Number.isFinite(nRaw) ? Math.max(1, Math.floor(nRaw)) : 10;

  const [thresholdRows] = await pool.query(
    `
      SELECT MIN(ctx_id) AS min_ctx_id
        FROM (
          SELECT ctx_id
            FROM context
           WHERE id = ?
             AND role = 'user'
             AND JSON_VALID(json) = 1
             AND COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(json, '$.content')), ''), NULL) IS NOT NULL
           ORDER BY ctx_id DESC
           LIMIT ?
        ) AS last_users
    `,
    [id, nUsers]
  );
  const minCtxId = thresholdRows?.[0]?.min_ctx_id || null;

  let rows;
  if (minCtxId) {
    [rows] = await pool.query(
      `
        SELECT ctx_id, ts, json
          FROM context
         WHERE id = ? AND ctx_id >= ?
           AND JSON_VALID(json) = 1
         ORDER BY ctx_id ASC
      `,
      [id, minCtxId]
    );
  } else {
    [rows] = await pool.query(
      `
        SELECT ctx_id, ts, json
          FROM context
         WHERE id = ?
           AND JSON_VALID(json) = 1
         ORDER BY ctx_id ASC
      `,
      [id]
    );
  }

  const messages = [];
  for (const row of (rows || [])) {
    try {
      const obj = JSON.parse(row.json);
      messages.push({ ...obj, ts: new Date(row.ts).toISOString(), ctx_id: row.ctx_id });
    } catch {}
  }

  const tokenBudget = workingObject?.contextTokenBudget;
  const capped = getCapByTokenBudgetUserBlocks(messages, tokenBudget);
  return capped;
}

/***************************************************************
/* functionSignature: setMaybeCreateTimelinePeriod (pool, wo,  *
/* channelId) Create a summary row when period size reached.   *
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
       ORDER BY ctx_id DESC
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
        (channel_id, start_idx, end_idx, start_ts, end_ts, summary, model, checksum, frozen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
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
/* functionSignature: setPurgeContext (workingObject)          *
/* Delete non-frozen context and timeline rows for a channel.  *
/***************************************************************/
export async function setPurgeContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const [res1] = await pool.execute(
    "DELETE FROM context WHERE id = ? AND COALESCE(frozen, 0) = 0",
    [id]
  );
  const [res2] = await pool.execute(
    `DELETE FROM ${TIMELINE_TABLE} WHERE channel_id = ? AND COALESCE(frozen, 0) = 0`,
    [id]
  );
  return Number(res1?.affectedRows || 0) + Number(res2?.affectedRows || 0);
}

/***************************************************************
/* functionSignature: setFreezeContext (workingObject)         *
/* Mark context and timeline rows as frozen for a channel.     *
/***************************************************************/
export async function setFreezeContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const [r1] = await pool.execute(
    "UPDATE context SET frozen = 1 WHERE id = ?",
    [id]
  );
  const [r2] = await pool.execute(
    `UPDATE ${TIMELINE_TABLE} SET frozen = 1 WHERE channel_id = ?`,
    [id]
  );
  return Number(r1?.affectedRows || 0) + Number(r2?.affectedRows || 0);
}

/***************************************************************
/* functionSignature: getEstimatedTokensFromMessage (msg)      *
/* Roughly estimate tokens for budgeting decisions.            *
/***************************************************************/
function getEstimatedTokensFromMessage(msg) {
  if (!msg) return 0;
  const parts = [];
  if (typeof msg.content === "string") parts.push(msg.content);
  if (msg.role) parts.push(msg.role);
  if (msg.name) parts.push(msg.name);
  const s = parts.join(" ");
  return Math.ceil(s.length / 4);
}

/***************************************************************
/* functionSignature: getCapByTokenBudgetUserBlocks (messages, *
/* budget) Cap messages by walking user-anchored blocks.       *
/***************************************************************/
function getCapByTokenBudgetUserBlocks(messages, budget) {
  if (!Array.isArray(messages) || !messages.length) return [];
  const maxTokens = Number(budget);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return messages;

  const blocks = [];
  let currentBlock = [];
  let total = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    currentBlock.unshift(m);
    const isUser = m.role === "user";
    const isFirst = i === 0;
    if (isUser || isFirst) {
      let blockTokens = 0;
      for (const x of currentBlock) blockTokens += getEstimatedTokensFromMessage(x);
      if (total + blockTokens > maxTokens && blocks.length > 0) break;
      total += blockTokens;
      blocks.unshift(...currentBlock);
      currentBlock = [];
    }
  }
  if (currentBlock.length) blocks.unshift(...currentBlock);
  return blocks;
}

/***************************************************************
/* functionSignature: getChecksumBatchFromContextRows (rows)   *
/* Compute a SHA-256 checksum for a batch of context rows.     *
/***************************************************************/
function getChecksumBatchFromContextRows(rows) {
  const h = crypto.createHash("sha256");
  for (const r of rows || []) {
    h.update(String(r.ts || ""));
    h.update("|");
    h.update(JSON.stringify(r.json || {}));
    h.update("\n");
  }
  return h.digest("hex");
}

/***************************************************************
/* functionSignature: getSummarizeContextBatch (workingObject, *
/* rows, meta) Summarize a batch via the configured endpoint.  *
/***************************************************************/
async function getSummarizeContextBatch(workingObject, rows, meta) {
  const { endpoint, model, apiKey } = getContextConfig(workingObject);
  const clipped = (rows || []).slice(-50);
  const prompt = [
    "Summarize the following recent conversation segment concisely.",
    `Channel: ${meta?.channelId ?? ""}`,
    `Range: ${meta?.startIdx ?? ""}-${meta?.endIdx ?? ""}`,
    "Return 1-3 sentences with key actions, decisions, and open questions.",
  ].join(" ");
  const messages = [{ role: "system", content: prompt }];
  for (const r of clipped) {
    const role = typeof r?.json?.role === "string" ? r.json.role : "user";
    const content = typeof r?.json?.content === "string" ? r.json.content : JSON.stringify(r.json || {});
    messages.push({ role, content });
  }
  if (!apiKey) {
    return { summary: "[no-api-key] summary unavailable", model: model || "" };
  }
  try {
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
        max_tokens: 256
      })
    });
    const data = await res.json();
    const summary = data?.choices?.[0]?.message?.content || "[summary unavailable]";
    return { summary, model };
  } catch {
    return { summary: "[summarization failed]", model };
  }
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Provide named exports and default export object.            *
/***************************************************************/
function getDefaultExport() {
  return { setContext, getContext, setPurgeContext, setFreezeContext };
}

export default getDefaultExport();
