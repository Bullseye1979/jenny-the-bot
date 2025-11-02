/***************************************************************
/* filename: "getHistory.js"                                   *
/* Version 1.0                                                 *
/* Purpose: Return raw context rows for a required timeframe;  *
/* capped by max_rows; no truncation hints; returns requested_ *
/* and actual_ timestamps; no reload prompts.                  *
/***************************************************************/
/***************************************************************/
/***************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getHistory";
const POOLS = new Map();

/***************************************************************
/* functionSignature: getPool (wo)                             *
/* Create or reuse a MySQL pool based on workingObject db cfg. *
/***************************************************************/
async function getPool(wo) {
  const key = JSON.stringify({ h: wo?.db?.host, u: wo?.db?.user, d: wo?.db?.database });
  if (POOLS.has(key)) return POOLS.get(key);
  const pool = mysql.createPool({
    host: wo?.db?.host,
    user: wo?.db?.user,
    password: wo?.db?.password,
    database: wo?.db?.database,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4",
    dateStrings: true
  });
  POOLS.set(key, pool);
  return pool;
}

/***************************************************************
/* functionSignature: getPadString (n)                         *
/* Left-pad a number to two digits as a string.                *
/***************************************************************/
function getPadString(n) { return String(n).padStart(2, "0"); }

/***************************************************************
/* functionSignature: getParsedHumanDate (input, isEnd)        *
/* Parse various human timestamps to "YYYY-MM-DD HH:MM:SS".    *
/***************************************************************/
function getParsedHumanDate(input, isEnd = false) {
  if (!input) return null;
  const raw = String(input).trim();

  const mDe = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mDe) {
    const day = Number(mDe[1]);
    const month = Number(mDe[2]);
    const year = Number(mDe[3]);
    let hh = Number(mDe[4] ?? (isEnd ? 23 : 0));
    let mm = Number(mDe[5] ?? (isEnd ? 59 : 0));
    let ss = Number(mDe[6] ?? (isEnd ? 59 : 0));
    return `${year}-${getPadString(month)}-${getPadString(day)} ${getPadString(hh)}:${getPadString(mm)}:${getPadString(ss)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isEnd ? `${raw} 23:59:59` : `${raw} 00:00:00`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw;
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${getPadString(d.getMonth() + 1)}-${getPadString(d.getDate())} ${getPadString(d.getHours())}:${getPadString(d.getMinutes())}:${getPadString(d.getSeconds())}`;
  }

  const stripped = raw.replace("T", " ").replace("Z", "").split(".")[0];
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stripped)) return stripped;

  return null;
}

/***************************************************************
/* functionSignature: getISO (ts)                              *
/* Convert "YYYY-MM-DD HH:MM:SS" to ISO string if possible.    *
/***************************************************************/
function getISO(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString();
}

/***************************************************************
/* functionSignature: getRowsByTime (pool, channelId, params)  *
/* Load rows for channel and timeframe with optional ctx start.*/
/***************************************************************/
async function getRowsByTime(pool, channelId, { startTs, endTs, startCtxId, limit }) {
  const where = ["id = ?"];
  const vals = [channelId];

  where.push("ts >= ?");
  vals.push(startTs);

  where.push("ts <= ?");
  vals.push(endTs);

  if (Number.isFinite(startCtxId) && startCtxId > 0) {
    where.push("ctx_id > ?");
    vals.push(startCtxId);
  }

  const sql = `
    SELECT ctx_id, ts, id, json, text
      FROM context
     WHERE ${where.join(" AND ")}
  ORDER BY ctx_id ASC, ts ASC
     LIMIT ?
  `;
  vals.push(limit);

  const [rows] = await pool.execute(sql, vals);
  return rows || [];
}

/***************************************************************
/* functionSignature: getHistoryInvoke (args, coreData)        *
/* Validate input, query DB, and return raw chronological data.*/
/***************************************************************/
async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const channelId = String(wo?.channelID || "");
  if (!channelId) {
    return { ok: false, error: "channel_id missing (wo.channelID)" };
  }
  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) {
    return { ok: false, error: "workingObject.db incomplete" };
  }

  const startRaw = args?.start ? String(args.start).trim() : null;
  if (!startRaw) {
    return {
      ok: false,
      error: "timeframe_required",
      hint: "Pass at least {\"start\":\"2025-10-25\"}. End is optional; if omitted → 23:59:59 of same day."
    };
  }

  let startTs = getParsedHumanDate(startRaw, false);
  if (!startTs) {
    return {
      ok: false,
      error: "invalid_start",
      hint: `Use YYYY-MM-DD or DD.MM.YYYY (got start="${startRaw}")`
    };
  }

  const endRaw = args?.end ? String(args.end).trim() : null;
  let endTs;
  if (!endRaw) {
    endTs = startTs.slice(0, 10) + " 23:59:59";
  } else {
    endTs = getParsedHumanDate(endRaw, true);
    if (!endTs) {
      return {
        ok: false,
        error: "invalid_end",
        hint: `Use YYYY-MM-DD or DD.MM.YYYY (got end="${endRaw}")`
      };
    }
  }

  const startCtxIdRaw = args?.start_ctx_id ?? args?.start_ctx ?? null;
  const startCtxId = startCtxIdRaw != null ? Number(startCtxIdRaw) : null;

  const cfg = wo?.toolsconfig?.gethistory || {};
  const MAX_ROWS_CFG = Number.isFinite(Number(cfg?.max_rows)) ? Number(cfg.max_rows) : 500;
  const REQ_LIMIT = Number.isFinite(Number(args?.limit)) ? Number(args.limit) : MAX_ROWS_CFG;
  const LIMIT = Math.max(1, Math.min(REQ_LIMIT, MAX_ROWS_CFG));

  const pool = await getPool(wo);
  const rows = await getRowsByTime(pool, channelId, {
    startTs,
    endTs,
    startCtxId: (Number.isFinite(startCtxId) && startCtxId > 0) ? startCtxId : null,
    limit: LIMIT
  });

  if (!rows.length) {
    return {
      ok: true,
      channel: channelId,
      requested_start: startTs,
      requested_end: endTs,
      actual_start: null,
      actual_end: null,
      rows: [],
      count: 0,
      max_rows: LIMIT
    };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const actualStartIso = getISO(first.ts);
  const actualEndIso = getISO(last.ts);

  const outRows = rows.map(r => ({
    ctx_id: r.ctx_id,
    ts: getISO(r.ts),
    id: r.id,
    json: r.json,
    text: r.text
  }));

  return {
    ok: true,
    channel: channelId,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: actualStartIso,
    actual_end: actualEndIso,
    rows: outRows,
    count: outRows.length,
    max_rows: LIMIT
  };
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Build the tool definition and bind the invoke function.     *
/***************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Return **raw** chronological messages for the CURRENT channel (wo.channelID) for a **REQUIRED** timeframe. If only start is given, the whole day is used. Returns also requested_start/requested_end and the actual_start/actual_end that were found. This tool does NOT tell you when the result was capped.",
        parameters: {
          type: "object",
          properties: {
            start:        { type: "string", description: "REQUIRED: start timestamp (YYYY-MM-DD, DD.MM.YYYY, or ISO). If only a date → 00:00." },
            end:          { type: "string", description: "OPTIONAL: end timestamp. If omitted → 23:59:59 of same day." },
            start_ctx_id: { type: "number", description: "OPTIONAL: continue from this ctx_id (manual pagination only)." },
            limit:        { type: "number", description: "OPTIONAL: row limit (≤ toolsconfig.gethistory.max_rows, default from config)" }
          },
          required: ["start"],
          additionalProperties: false
        }
      }
    },
    invoke: getHistoryInvoke
  };
}

export default getDefaultExport();
