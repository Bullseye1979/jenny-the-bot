/****************************************************************************************************************
/* filename: "getHistory.js"                                                                                   *
/* Version 1.0                                                                                                 *
/* Purpose: Preload up to max_rows; dump if count ≤ threshold else summarize; dump appends [effective_end_ts]. *
/*          Optional filtering of role="tool" rows via toolsconfig.getHistory.include_tool_rows.               *
/****************************************************************************************************************/
/****************************************************************************************************************
/*                                                                                                              *
/****************************************************************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getHistory";
const POOLS = new Map();

/************************************************************************************************************
/* functionSignature: getPool (wo)                                                                          *
/* Creates or reuses a MySQL pool based on workingObject db settings.                                       *
/************************************************************************************************************/
async function getPool(wo) {
  const key = JSON.stringify({ h: wo?.db?.host, u: wo?.db?.user, d: wo?.db?.database });
  if (POOLS.has(key)) {
    return POOLS.get(key);
  }
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
  pool.on?.("connection", (conn) => {
    try {
      conn.query?.("SET time_zone = '+00:00'");
    } catch (e) {}
  });
  POOLS.set(key, pool);
  return pool;
}

/************************************************************************************************************
/* functionSignature: getPadString (n)                                                                       *
/* Pads a number to two digits with a leading zero.                                                          *
/************************************************************************************************************/
function getPadString(n) { return String(n).padStart(2, "0"); }

/************************************************************************************************************
/* functionSignature: getParsedHumanDate (input, isEnd)                                                      *
/* Parses human dates into "YYYY-MM-DD HH:mm:ss" string.                                                     *
/************************************************************************************************************/
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isEnd ? `${raw} 23:59:59` : `${raw} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${getPadString(d.getMonth() + 1)}-${getPadString(d.getDate())} ${getPadString(d.getHours())}:${getPadString(d.getMinutes())}:${getPadString(d.getSeconds())}`;
  }
  const stripped = raw.replace("T", " ").replace("Z", "").split(".")[0];
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stripped)) return stripped;
  return null;
}

/************************************************************************************************************
/* functionSignature: getISO (ts)                                                                            *
/* Converts "YYYY-MM-DD HH:mm:ss" to ISO string if possible.                                                 *
/************************************************************************************************************/
function getISO(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString();
}

/************************************************************************************************************
/* functionSignature: getIsDateOnly (raw)                                                                    *
/* Checks whether input is a date-only string (DE or ISO).                                                   *
/************************************************************************************************************/
function getIsDateOnly(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
}

/************************************************************************************************************
/* functionSignature: getAddDaysUTC (yyyy_mm_dd, days)                                                       *
/* Adds days (UTC) to a date-only string and returns YYYY-MM-DD.                                             *
/************************************************************************************************************/
function getAddDaysUTC(yyyy_mm_dd, days) {
  const d = new Date(yyyy_mm_dd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + (days | 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/************************************************************************************************************
/* functionSignature: getRowsByTime (pool, channelId, opts)                                                  *
/* Retrieves rows from DB in a time range with optional ctx pagination and role="tool" filtering.            *
/************************************************************************************************************/
async function getRowsByTime(
  pool,
  channelId,
  { startTs, endTs, endExclusive, startCtxId, limit, includeToolRows }
) {
  const where = ["id = ?"];
  const vals = [channelId];
  where.push("ts >= ?");
  vals.push(startTs);
  if (endExclusive) {
    where.push("ts < ?");
  } else {
    where.push("ts <= ?");
  }
  vals.push(endTs);
  if (Number.isFinite(startCtxId) && startCtxId > 0) {
    where.push("ctx_id > ?");
    vals.push(startCtxId);
  }
  if (includeToolRows === false) {
    where.push("(role IS NULL OR LOWER(role) <> 'tool')");
  }
  const sql = `
    SELECT ctx_id, ts, id, json, text, role
      FROM context
     WHERE ${where.join(" AND ")}
  ORDER BY ctx_id ASC, ts ASC
     LIMIT ?
  `;
  vals.push(limit);
  const [rows] = await pool.execute(sql, vals);
  return rows || [];
}

/************************************************************************************************************
/* functionSignature: getPreloadUpToCap (pool, channelId, opts)                                              *
/* Loads pages of rows up to the max cap or until no more rows exist; passes includeToolRows downstream.     *
/************************************************************************************************************/
async function getPreloadUpToCap(
  pool,
  channelId,
  { startTs, endTs, endExclusive, startCtxId, cap, pageSize, includeToolRows }
) {
  const out = [];
  let cursor = Number.isFinite(startCtxId) && startCtxId > 0 ? startCtxId : null;
  const size = Math.max(1, pageSize || 1000);
  const hardCap = Math.max(1, cap || 10000);
  while (out.length < hardCap) {
    const need = Math.min(size, hardCap - out.length);
    const chunk = await getRowsByTime(pool, channelId, {
      startTs,
      endTs,
      endExclusive,
      startCtxId: cursor,
      limit: need,
      includeToolRows
    });
    if (!chunk.length) break;
    out.push(...chunk);
    cursor = chunk[chunk.length - 1].ctx_id;
    if (chunk.length < need) break;
  }
  return out;
}

/************************************************************************************************************
/* functionSignature: getBuildSummaryMessages (meta, lines, extraPrompt)                                     *
/* Builds messages payload for the summarization request.                                                    *
/************************************************************************************************************/
function getBuildSummaryMessages(meta, lines, extraPrompt) {
  const head = [
    `Channel: ${meta.channel}`,
    `Requested: ${meta.requested_start} → ${meta.requested_end}`,
    `Actual: ${meta.actual_start || "null"} → ${meta.actual_end || "null"}`,
    `Rows: ${lines.length}`
  ].join("\n");
  const body = lines.join("\n");
  const baseSystem = {
    role: "system",
    content:
      "You are a precise analyst. Summarize strictly from the provided raw rows. " +
      "Cover the whole data; do not omit important events. If something is unclear, say so. " +
      "Do not invent facts. Summarize in strict chronological order. Do not mix up events."
  };
  const extraSystem =
    extraPrompt && String(extraPrompt).trim()
      ? {
          role: "system",
          content: "ADDITIONAL INSTRUCTIONS FROM OPERATOR:\n" + String(extraPrompt).trim()
        }
      : null;
  const msgs = [baseSystem];
  if (extraSystem) msgs.push(extraSystem);
  msgs.push({ role: "user", content: head + "\n\n" + body });
  return msgs;
}

/************************************************************************************************************
/* functionSignature: getSummarize (wo, meta, rows, cfg, extraPrompt)                                        *
/* Performs the OpenAI-compatible summarization call.                                                        *
/************************************************************************************************************/
async function getSummarize(wo, meta, rows, cfg, extraPrompt) {
  const endpoint =
    (typeof cfg?.endpoint === "string" && cfg.endpoint)
      ? cfg.endpoint
      : (typeof wo?.Endpoint === "string" && wo.Endpoint
          ? wo.Endpoint
          : "https://api.openai.com/v1/chat/completions");
  const apiKey =
    (typeof cfg?.apiKey === "string" && cfg.apiKey)
      ? cfg.apiKey
      : (typeof wo?.APIKey === "string" ? wo.APIKey : "");
  if (!apiKey) {
    return { ok: false, error: "Missing OpenAI API key" };
  }
  const model =
    (typeof cfg?.model === "string" && cfg.model)
      ? cfg.model
      : (typeof wo?.Model === "string" && wo.Model
          ? wo.Model
          : "gpt-4o-mini");
  const temperature = Number.isFinite(cfg?.temperature)
    ? Number(cfg.temperature)
    : 0.2;
  const max_tokens = Number.isFinite(cfg?.max_tokens)
    ? Math.max(100, Math.min(4096, Number(cfg.max_tokens)))
    : 900;
  const lines = rows.map((r) => {
    const t = (typeof r?.text === "string" && r.text) ? r.text : "";
    const j = (typeof r?.json === "string" && r.json) ? r.json : "";
    const payload = t ? t : j;
    return `[${r.ctx_id}] ${r.ts} ${payload}`;
  });
  const messages = getBuildSummaryMessages(meta, lines, extraPrompt);
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(cfg?.aiTimeoutMs)
    ? Number(cfg.aiTimeoutMs)
    : 45000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res, raw, data;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
      signal: controller.signal
    });
    raw = await res.text();
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e?.message || String(e) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    return {
      ok: false,
      error: `OpenAI HTTP ${res.status} ${res.statusText}`,
      details: (data && data.error && data.error.message) || null
    };
  }
  const answer = (data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) return { ok: false, error: "Empty answer from model", model };
  return { ok: true, summary: answer, model };
}

/************************************************************************************************************
/* functionSignature: getHistoryInvoke (args, coreData)                                                       *
/* Preload up to max_rows; dump if count ≤ threshold else summarize; honors include_tool_rows (default true). *
/************************************************************************************************************/
async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const cfgTool = wo?.toolsconfig?.getHistory || {};
  const channelId = String(wo?.channelID || "");
  if (!channelId) {
    return { ok: false, error: "channel_id missing (wo.channelID)" };
  }
  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) {
    return { ok: false, error: "workingObject.db incomplete" };
  }
  const startRaw = args?.start ? String(args.start).trim() : null;
  if (!startRaw) {
    return { ok: false, error: "timeframe_required", hint: 'Pass at least {"start":"2025-10-25"}' };
  }
  const startTs = getParsedHumanDate(startRaw, false);
  if (!startTs) {
    return {
      ok: false,
      error: "invalid_start",
      hint: `Use YYYY-MM-DD or DD.MM.YYYY (got start="${startRaw}")`
    };
  }
  const endRaw = args?.end ? String(args.end).trim() : null;
  let endTs;
  let endExclusive = false;
  if (!endRaw) {
    endTs = startTs.slice(0, 10) + " 23:59:59";
    endExclusive = false;
  } else if (getIsDateOnly(endRaw)) {
    const endStart = getParsedHumanDate(endRaw, false);
    const endDate = endStart.slice(0, 10);
    const nextDay = getAddDaysUTC(endDate, 1);
    endTs = `${nextDay} 00:00:00`;
    endExclusive = true;
  } else {
    endTs = getParsedHumanDate(endRaw, true);
    if (!endTs) {
      return {
        ok: false,
        error: "invalid_end",
        hint: `Use YYYY-MM-DD or DD.MM.YYYY (got end="${endRaw}")`
      };
    }
    endExclusive = false;
  }
  const startCtxIdRaw = args?.start_ctx_id ?? args?.start_ctx ?? null;
  const startCtxId = startCtxIdRaw != null ? Number(startCtxIdRaw) : null;
  const maxRows = Math.max(
    1,
    Number.isFinite(Number(cfgTool?.max_rows))
      ? Number(cfgTool.max_rows)
      : 5000
  );
  const pageSize = Math.max(
    1,
    Number.isFinite(Number(cfgTool?.pagesize))
      ? Number(cfgTool.pagesize)
      : 1000
  );
  const threshold = Math.max(
    1,
    Number.isFinite(Number(cfgTool?.threshold))
      ? Number(cfgTool.threshold)
      : 300
  );
  const includeToolRows = cfgTool.include_tool_rows !== false;
  const pool = await getPool(wo);
  let rows = await getPreloadUpToCap(pool, channelId, {
    startTs,
    endTs,
    endExclusive,
    startCtxId: (Number.isFinite(startCtxId) && startCtxId > 0) ? startCtxId : null,
    cap: maxRows,
    pageSize,
    includeToolRows
  });
  const preloadedCount = rows.length;
  const cappedByCap = preloadedCount >= maxRows;
  if (!rows.length) {
    return {
      ok: true,
      mode: "dump",
      channel: channelId,
      requested_start: startTs,
      requested_end: endTs,
      actual_start: null,
      actual_end: null,
      rows: [],
      count: 0,
      max_rows: maxRows,
      preloaded_count: 0,
      capped_by_preload: false
    };
  }
  const actualStartIso = getISO(rows[0].ts);
  const userPrompt = typeof args?.prompt === "string" ? args.prompt : "";
  const doDump = rows.length <= threshold;
  if (doDump) {
    const lastDump = rows[rows.length - 1];
    const actualEndIso = getISO(lastDump.ts);
    const outRows = rows.map((r) => ({
      ctx_id: r.ctx_id,
      ts: r.ts,
      id: r.id,
      json: r.json,
      text: r.text,
      role: r.role ?? null
    }));
    outRows.push({
      ctx_id: lastDump.ctx_id,
      ts: lastDump.ts,
      id: channelId,
      json: null,
      text: `[effective_end_ts]\n${lastDump.ts}`,
      role: null
    });
    rows = null;
    return {
      ok: true,
      mode: "dump",
      channel: channelId,
      requested_start: startTs,
      requested_end: endTs,
      actual_start: actualStartIso,
      actual_end: actualEndIso,
      rows: outRows,
      count: outRows.length,
      max_rows: maxRows,
      preloaded_count: preloadedCount,
      capped_by_preload: cappedByCap,
      has_more: cappedByCap,
      next_start_ctx_id: cappedByCap ? lastDump.ctx_id : null
    };
  }
  const lastSummary = rows[rows.length - 1];
  const actualEndIso = getISO(lastSummary.ts);
  const summaryInput = rows.map((r) => ({
    ctx_id: r.ctx_id,
    ts: r.ts,
    id: r.id,
    json: r.json,
    text: r.text,
    role: r.role ?? null
  }));
  rows = null;
  const meta = {
    channel: channelId,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: actualStartIso,
    actual_end: actualEndIso
  };
  const sumRes = await getSummarize(wo, meta, summaryInput, cfgTool, userPrompt);
  if (!sumRes.ok) {
    return {
      ok: false,
      error: sumRes.error || "summary_failed",
      details: sumRes.details || null
    };
  }
  return {
    ok: true,
    mode: "summary",
    channel: channelId,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: actualStartIso,
    actual_end: actualEndIso,
    used_rows: summaryInput.length,
    max_rows: maxRows,
    model: sumRes.model,
    summary: sumRes.summary,
    preloaded_count: preloadedCount,
    capped_by_preload: cappedByCap
  };
}

/************************************************************************************************************
/* functionSignature: getDefaultExport ()                                                                     *
/* Constructs the tool definition and returns the default export object.                                      *
/************************************************************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "ALWAYS USE THIS TO RETRIEVE PAST EVENTS, WHEN A TIMEFRAME IS KNOWN. " +
          "Get the historical records of the channel based on provided timeframes. " +
          "The result is either a summary (where an optional prompt is applied to), " +
          "or a database dump, depending on the size of the retrieved data.",
        parameters: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description:
                "REQUIRED: start timestamp (YYYY-MM-DD, DD.MM.YYYY, or ISO). If date-only → 00:00:00."
            },
            end: {
              type: "string",
              description:
                "OPTIONAL: end timestamp. If omitted → 23:59:59 of same day. If date-only, end is exclusive at next day 00:00:00."
            },
            start_ctx_id: {
              type: "number",
              description: "OPTIONAL: continue after this ctx_id (manual pagination only)."
            },
            prompt: {
              type: "string",
              description: "OPTIONAL: additional instructions to steer the summary."
            }
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
