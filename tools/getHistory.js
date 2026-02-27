/********************************************************************************
/* filename: "getHistory.js"                                                    *
/* Version 1.0                                                                  *
/* Purpose: Retrieve channel history with dump/summary/chunk modes, including   *
/*          paging, filtering, and OpenAI summaries across one or many channels.*
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getHistory";
const POOLS = new Map();

/****************************************************************************
/* functionSignature: getPool (wo)                                          *
/* Create or reuse a MySQL pool based on workingObject database settings.   *
/****************************************************************************/
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

/****************************************************************
/* functionSignature: getPadString (n)                          *
/* Return a two-digit, zero-padded string representation.       *
/****************************************************************/
function getPadString(n) { return String(n).padStart(2, "0"); }

/********************************************************************************
/* functionSignature: getParsedHumanDate (input, isEnd)                         *
/* Parse human dates into "YYYY-MM-DD HH:mm:ss" or return null if unsupported. *
/********************************************************************************/
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
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${getPadString(d.getMonth() + 1)}-${getPadString(d.getDate())} ${getPadString(d.getHours())}:${getPadString(d.getMinutes())}:${getPadString(d.getSeconds())}`;
  }
  const stripped = raw.replace("T", " ").replace("Z", "").split(".")[0];
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stripped)) return stripped;
  return null;
}

/**********************************************************************
/* functionSignature: getISO (ts)                                     *
/* Convert "YYYY-MM-DD HH:mm:ss" to ISO 8601 if valid, else passthru. *
/**********************************************************************/
function getISO(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString();
}

/***********************************************************************
/* functionSignature: getIsDateOnly (raw)                              *
/* Determine if value is a date-only string in DE or ISO format.       *
/***********************************************************************/
function getIsDateOnly(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
}

/****************************************************************************************
/* functionSignature: getAddDaysUTC (yyyy_mm_dd, days)                                   *
/* Add UTC days to a date-only string and return a "YYYY-MM-DD" formatted date string.  *
/****************************************************************************************/
function getAddDaysUTC(yyyy_mm_dd, days) {
  const d = new Date(yyyy_mm_dd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + (days | 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/******************************************************************************************************
/* functionSignature: getRowsByTime (pool, channelIds, opts)                                         *
/* Retrieve rows from DB within a time range for one or multiple channels with pagination and roles. *
/******************************************************************************************************/
async function getRowsByTime(
  pool,
  channelIds,
  { startTs, endTs, endExclusive, startCtxId, limit, includeToolRows }
) {
  const ids = Array.isArray(channelIds) ? channelIds : [channelIds];
  if (!ids.length) return [];
  const where = [];
  const vals = [];
  const idPlaceholders = ids.map(() => "?").join(", ");
  where.push(`id IN (${idPlaceholders})`);
  vals.push(...ids);
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

/****************************************************************************************************************
/* functionSignature: getPreloadUpToCap (pool, channelIds, opts)                                               *
/* Load pages of rows up to a cap or until none remain; propagate includeToolRows downstream consistently.     *
/****************************************************************************************************************/
async function getPreloadUpToCap(
  pool,
  channelIds,
  { startTs, endTs, endExclusive, startCtxId, cap, pageSize, includeToolRows }
) {
  const out = [];
  let cursor = Number.isFinite(startCtxId) && startCtxId > 0 ? startCtxId : null;
  const size = Math.max(1, pageSize || 1000);
  const hardCap = Math.max(1, cap || 10000);
  while (out.length < hardCap) {
    const need = Math.min(size, hardCap - out.length);
    const chunk = await getRowsByTime(pool, channelIds, {
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

/**********************************************************************************************************
/* functionSignature: getBuildSummaryMessages (meta, lines, extraPrompt)                                 *
/* Build messages payload for summarization with optional operator instructions and concise channel info. *
/**********************************************************************************************************/
function getBuildSummaryMessages(meta, lines, extraPrompt) {
  const channelLine = Array.isArray(meta.channels) && meta.channels.length > 1
    ? `Channels: ${meta.channels.join(", ")}`
    : `Channel: ${meta.channel}`;
  const head = [
    channelLine,
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
      "Do not invent facts. Summarize in strict chronological order. Do not mix up events. " +
      "If multiple channels are present, keep them disambiguated by their channel ids or names where helpful."
  };
  const extraSystem =
    extraPrompt && String(extraPrompt).trim()
      ? { role: "system", content: "ADDITIONAL INSTRUCTIONS FROM OPERATOR:\n" + String(extraPrompt).trim() }
      : null;
  const msgs = [baseSystem];
  if (extraSystem) msgs.push(extraSystem);
  msgs.push({ role: "user", content: head + "\n\n" + body });
  return msgs;
}

/********************************************************************************************************************
/* functionSignature: getSummarize (wo, meta, rows, cfg, extraPrompt)                                               *
/* Perform an OpenAI-compatible summarization call; respects cfg.max_tokens and returns model and summary or error. *
/********************************************************************************************************************/
async function getSummarize(wo, meta, rows, cfg, extraPrompt) {
  const endpoint =
    (typeof cfg?.endpoint === "string" && cfg.endpoint)
      ? cfg.endpoint
      : (typeof wo?.endpoint === "string" && wo.endpoint ? wo.endpoint : "https://api.openai.com/v1/chat/completions");
  const apiKey =
    (typeof cfg?.apiKey === "string" && cfg.apiKey)
      ? cfg.apiKey
      : (typeof wo?.apiKey === "string" ? wo.apiKey : "");
  if (!apiKey) {
    return { ok: false, error: "Missing OpenAI API key" };
  }
  const model =
    (typeof cfg?.model === "string" && cfg.model)
      ? cfg.model
      : (typeof wo?.model === "string" && wo.model ? wo.model : "gpt-4o-mini");
  const temperature = Number.isFinite(cfg?.temperature) ? Number(cfg.temperature) : 0.2;
  const max_tokens = Number.isFinite(cfg?.max_tokens) ? Math.max(50, Math.min(4096, Number(cfg.max_tokens))) : 900;
  const lines = rows.map((r) => {
    const t = (typeof r?.text === "string" && r.text) ? r.text : "";
    const j = (typeof r?.json === "string" && r.json) ? r.json : "";
    const payload = j ? j : t;
    const ch = r.channel_id || r.id || "";
    const tag = ch ? `[${r.ctx_id}|${ch}]` : `[${r.ctx_id}]`;
    return `${tag} ${r.ts} ${payload}`;
  });
  const messages = getBuildSummaryMessages(meta, lines, extraPrompt);
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(cfg?.aiTimeoutMs) ? Number(cfg.aiTimeoutMs) : 45000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res, raw, data;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
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

/**************************************************************************************************************************************************************************
/* functionSignature: getHistoryInvoke (args, coreData)                                                                                                                  *
/* Execute retrieval: dump (≤ threshold), single summary (≤ max_rows), or chunked summaries (> max_rows) with paging and prompt steering across one or more channels.    *
/**************************************************************************************************************************************************************************/
async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const cfgTool = wo?.toolsconfig?.getHistory || {};
  const primaryChannelId = String(wo?.channelID || "").trim();
  const extraChannelIds = Array.isArray(wo?.channelIds)
    ? wo.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];
  const channelIdSet = new Set();
  if (primaryChannelId) channelIdSet.add(primaryChannelId);
  for (const cid of extraChannelIds) channelIdSet.add(cid);
  const channelIds = [...channelIdSet];
  if (!channelIds.length) {
    return { ok: false, error: "channel_id missing (wo.channelID / wo.channelIds)" };
  }
  const mainChannelId = primaryChannelId || channelIds[0];
  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) {
    return { ok: false, error: "workingObject.db incomplete" };
  }
  const startRaw = args?.start ? String(args.start).trim() : null;
  if (!startRaw) {
    return { ok: false, error: "timeframe_required", hint: 'Pass at least {"start":"2025-10-25"}' };
  }
  const startTs = getParsedHumanDate(startRaw, false);
  if (!startTs) {
    return { ok: false, error: "invalid_start", hint: `Use YYYY-MM-DD or DD.MM.YYYY (got start="${startRaw}")` };
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
      return { ok: false, error: "invalid_end", hint: `Use YYYY-MM-DD or DD.MM.YYYY (got end="${endRaw}")` };
    }
    endExclusive = false;
  }
  const startCtxIdRaw = args?.start_ctx_id ?? args?.start_ctx ?? null;
  const startCtxId = startCtxIdRaw != null ? Number(startCtxIdRaw) : null;
  const maxRows = Math.max(1, Number.isFinite(Number(cfgTool?.max_rows)) ? Number(cfgTool.max_rows) : 5000);
  const pageSize = Math.max(1, Number.isFinite(Number(cfgTool?.pagesize)) ? Number(cfgTool.pagesize) : 1000);
  const threshold = Math.max(1, Number.isFinite(Number(cfgTool?.threshold)) ? Number(cfgTool.threshold) : 300);
  const chunkMaxTokens = Math.max(50, Number.isFinite(Number(cfgTool?.chunk_max_tokens)) ? Number(cfgTool.chunk_max_tokens) : 150);
  const chunkMaxChunks = Math.max(1, Number.isFinite(Number(cfgTool?.chunk_max_chunks)) ? Number(cfgTool.chunk_max_chunks) : 10);
  const includeToolRows = cfgTool.include_tool_rows !== false;
  const pool = await getPool(wo);
  let rows = await getPreloadUpToCap(pool, channelIds, {
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
      channel: mainChannelId,
      channels: channelIds,
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
  const userPrompt = typeof args?.prompt === "string" ? args.prompt : "";
  const doDump = rows.length <= threshold;
  if (doDump) {
    const actualStartIso = getISO(rows[0].ts);
    const lastDump = rows[rows.length - 1];
    const actualEndIso = getISO(lastDump.ts);
    const outRows = rows.map((r) => ({
      ctx_id: r.ctx_id,
      ts: r.ts,
      id: r.id,
      channel_id: r.id,
      json: r.json,
      text: r.text,
      role: r.role ?? null
    }));
    outRows.push({
      ctx_id: lastDump.ctx_id,
      ts: lastDump.ts,
      id: mainChannelId,
      channel_id: mainChannelId,
      json: null,
      text: `[effective_end_ts]\n${lastDump.ts}`,
      role: null
    });
    rows = null;
    return {
      ok: true,
      mode: "dump",
      channel: mainChannelId,
      channels: channelIds,
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
      next_start_ctx_id: cappedByCap ? outRows[outRows.length - 2].ctx_id : null
    };
  }
  if (!cappedByCap) {
    const actualStartIso = getISO(rows[0].ts);
    const lastSummary = rows[rows.length - 1];
    const actualEndIso = getISO(lastSummary.ts);
    const summaryInput = rows.map((r) => ({
      ctx_id: r.ctx_id,
      ts: r.ts,
      id: r.id,
      channel_id: r.id,
      json: r.json,
      text: r.text,
      role: r.role ?? null
    }));
    rows = null;
    const meta = {
      channel: mainChannelId,
      channels: channelIds,
      requested_start: startTs,
      requested_end: endTs,
      actual_start: actualStartIso,
      actual_end: actualEndIso
    };
    const sumRes = await getSummarize(wo, meta, summaryInput, cfgTool, userPrompt);
    if (!sumRes.ok) {
      return { ok: false, error: sumRes.error || "summary_failed", details: sumRes.details || null };
    }
    return {
      ok: true,
      mode: "summary",
      channel: mainChannelId,
      channels: channelIds,
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
  let chunkRows = rows;
  rows = null;
  const chunkSummaries = [];
  const modelsUsed = new Set();
  let totalRowsUsed = 0;
  let chunkIndex = 0;
  let globalActualStartIso = getISO(chunkRows[0].ts);
  let globalActualEndIso = null;
  let lastCtxId = chunkRows[chunkRows.length - 1].ctx_id;
  while (chunkRows && chunkRows.length > 0 && chunkIndex < chunkMaxChunks) {
    const chunkFirst = chunkRows[0];
    const chunkLast = chunkRows[chunkRows.length - 1];
    const chunkMeta = {
      channel: mainChannelId,
      channels: channelIds,
      requested_start: startTs,
      requested_end: endTs,
      actual_start: getISO(chunkFirst.ts),
      actual_end: getISO(chunkLast.ts)
    };
    const chunkCfg = { ...cfgTool, max_tokens: chunkMaxTokens };
    const chunkInput = chunkRows.map((r) => ({
      ctx_id: r.ctx_id,
      ts: r.ts,
      id: r.id,
      channel_id: r.id,
      json: r.json,
      text: r.text,
      role: r.role ?? null
    }));
    const sumRes = await getSummarize(wo, chunkMeta, chunkInput, chunkCfg, userPrompt);
    if (!sumRes.ok) {
      return {
        ok: false,
        error: sumRes.error || "summary_failed_chunk",
        details: sumRes.details || null,
        chunk_index: chunkIndex
      };
    }
    chunkSummaries.push({
      index: chunkIndex,
      number: chunkIndex + 1,
      start_ts: chunkFirst.ts,
      end_ts: chunkLast.ts,
      model: sumRes.model,
      title: `Chunk ${chunkIndex + 1}`,
      summary: sumRes.summary
    });
    modelsUsed.add(sumRes.model);
    totalRowsUsed += chunkInput.length;
    globalActualEndIso = getISO(chunkLast.ts);
    chunkIndex += 1;
    if (chunkRows.length < maxRows) {
      break;
    }
    const nextRows = await getRowsByTime(pool, channelIds, {
      startTs,
      endTs,
      endExclusive,
      startCtxId: lastCtxId,
      limit: maxRows,
      includeToolRows
    });
    if (!nextRows.length) break;
    chunkRows = nextRows;
    lastCtxId = chunkRows[chunkRows.length - 1].ctx_id;
  }
  const totalChunks = chunkSummaries.length;
  const joinedSummary = chunkSummaries
    .map((c, idx) => {
      const n = idx + 1;
      const head = `Chunk ${n}/${totalChunks} (${c.start_ts} → ${c.end_ts}):`;
      return `${head}\n${c.summary}`;
    })
    .join("\n\n---\n\n");
  return {
    ok: true,
    mode: "summary_chunked",
    channel: mainChannelId,
    channels: channelIds,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: globalActualStartIso,
    actual_end: globalActualEndIso,
    used_rows: totalRowsUsed,
    max_rows: maxRows,
    model: modelsUsed.size === 1 ? Array.from(modelsUsed)[0] : null,
    summary: joinedSummary,
    chunk_count: totalChunks,
    chunk_summaries: chunkSummaries,
    preloaded_count: preloadedCount,
    capped_by_preload: true,
    chunk_max_tokens: chunkMaxTokens,
    chunk_max_chunks: chunkMaxChunks
  };
}

/************************************************************************************************
/* functionSignature: getDefaultExport ()                                                       *
/* Construct the tool definition and return the default export object for function invocation.  *
/************************************************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "ALWAYS USE THIS TO RETRIEVE HISTORICAL DATA AND PAST EVENTS, WHEN A TIMEFRAME IS KNOWN. " +
          "Get the historical records of the channel based on provided timeframes. " +
          "If rows ≤ threshold → dump, if threshold < rows ≤ max_rows → single summary, " +
          "if rows > max_rows → multi-chunk summary with short, prompt-focused chunks. " +
          "History is pulled from workingObject.channelID plus optional workingObject.channelIds.",
        parameters: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "REQUIRED: start timestamp (YYYY-MM-DD, DD.MM.YYYY, or ISO). If date-only → 00:00:00."
            },
            end: {
              type: "string",
              description:
                "OPTIONAL: end timestamp. If omitted → 23:59:59 of same day. " +
                "If date-only, end is exclusive at next day 00:00:00."
            },
            start_ctx_id: {
              type: "number",
              description: "OPTIONAL: continue after this ctx_id (manual pagination only; applies across all channels)."
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
