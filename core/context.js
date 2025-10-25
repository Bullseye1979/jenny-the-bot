/***************************************************************
/* filename: "context.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Minimal MySQL context store keyed solely by id;    *
/*          persists JSON turns and retrieves recent history.  *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "context";

let sharedPool = null;
let sharedDsn = "";

/***************************************************************
/* functionSignature: getDsnKey (db)                           *
/* Builds a DSN fingerprint string for pool reuse              *
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
/* Ensures shared pool exists and required table is created    *
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
      ts   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id   VARCHAR(128) NOT NULL,
      json LONGTEXT     NOT NULL,
      text TEXT         NULL,
      KEY idx_id_ts (id, ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  sharedPool = pool;
  sharedDsn = dsnKey;
  return pool;
}

/***************************************************************
/* functionSignature: getDeepSanitize (value)                  *
/* Deeply sanitizes values for JSON-safe persistence           *
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
/* Normalizes assistant tool_calls structure                   *
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
/* Produces a JSON-safe, normalized record                     *
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
/* Derives a short indexable text from the record              *
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
/* Persists a record to DB by id only                          *
/***************************************************************/
export async function setContext(workingObject, record) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);

  const normalized = getNormalizeRecord(record);
  const json = JSON.stringify(normalized);
  const text = getDeriveIndexText(normalized);

  await pool.execute(
    "INSERT INTO context (id, json, text) VALUES (?, ?, ?)",
    [id, json, text]
  );
  return true;
}

/***************************************************************
/* functionSignature: getContext (workingObject)               *
/* Returns last N user windows (contentful only)               *
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
             AND JSON_VALID(json) = 1
             AND JSON_UNQUOTE(JSON_EXTRACT(json, '$.role')) = 'user'
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

  const out = [];
  for (const row of rows || []) {
    try {
      const obj = JSON.parse(row.json);
      out.push({ ...obj, ts: new Date(row.ts).toISOString() });
    } catch {}
  }
  return out;
}

/***************************************************************
/* functionSignature: purgeContext (workingObject)             *
/* Deletes all rows for the given id                           *
/***************************************************************/
export async function purgeContext(workingObject) {
  const id = String(workingObject?.id || "");
  if (!id) throw new Error("[context] missing id");
  const pool = await getEnsurePool(workingObject);
  const [res] = await pool.execute("DELETE FROM context WHERE id = ?", [id]);
  return Number(res?.affectedRows || 0);
}

export default { setContext, getContext, purgeContext };
