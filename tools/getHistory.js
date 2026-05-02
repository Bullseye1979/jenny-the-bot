/**************************************************************/
/* filename: "getHistory.js"                                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/








import { getEnsurePool }      from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getHistory";

function getErrorResult(code, message, details = {}) {
  return {
    ok: false,
    error: String(message || code || "unknown_error"),
    error_status: {
      source: MODULE_NAME,
      code: String(code || "unknown_error"),
      message: String(message || code || "unknown_error")
    },
    ...details
  };
}


const ROW_CONTENT_MAX = 500;

function getExtractContent(r) {
  if (r.json) {
    try {
      const j = typeof r.json === "string" ? JSON.parse(r.json) : r.json;
      const c = j?.content ?? j?.message?.content ?? j?.data?.content ?? j?.delta?.content ?? j?.text ?? null;
      if (typeof c === "string" && c.trim()) return c.trim().slice(0, ROW_CONTENT_MAX);
    } catch {}
  }
  if (typeof r.text === "string" && r.text.trim()) return r.text.trim().slice(0, ROW_CONTENT_MAX);
  return null;
}


function getPadString(n) { return String(n).padStart(2, "0"); }


function getNormalizeOffsetText(offsetText) {
  const raw = String(offsetText || "").trim();
  if (!raw) return "Z";
  if (raw === "GMT" || raw === "UTC") return "Z";
  const m = raw.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return "Z";
  const sign = m[1];
  const hh = String(m[2] || "0").padStart(2, "0");
  const mm = String(m[3] || "0").padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}


function getTimeZoneOffsetMs(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(date);
    const offsetText = parts.find((part) => part.type === "timeZoneName")?.value || "UTC";
    const normalized = getNormalizeOffsetText(offsetText);
    if (normalized === "Z") return 0;
    const m = normalized.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * ((Number(m[2]) * 60) + Number(m[3])) * 60000;
  } catch {
    return 0;
  }
}


function getUtcSqlForLocalParts({ year, month, day, hour, minute, second, timeZone }) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMs;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${getPadString(d.getUTCMonth() + 1)}-${getPadString(d.getUTCDate())} ${getPadString(d.getUTCHours())}:${getPadString(d.getUTCMinutes())}:${getPadString(d.getUTCSeconds())}`;
}


function getAddDaysLocal(year, month, day, days) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + (days | 0));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}


function getParsedHumanDate(input, isEnd = false, timeZone = "UTC") {
  if (!input) return null;
  const raw = String(input).trim();
  const mDe = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mDe) {
    const day = Number(mDe[1]);
    const month = Number(mDe[2]);
    const year = Number(mDe[3]);
    const hh = Number(mDe[4] ?? (isEnd ? 23 : 0));
    const mm = Number(mDe[5] ?? (isEnd ? 59 : 0));
    const ss = Number(mDe[6] ?? (isEnd ? 59 : 0));
    return getUtcSqlForLocalParts({ year, month, day, hour: hh, minute: mm, second: ss, timeZone });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return getUtcSqlForLocalParts({
      year,
      month,
      day,
      hour: isEnd ? 23 : 0,
      minute: isEnd ? 59 : 0,
      second: isEnd ? 59 : 0,
      timeZone
    });
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const [datePart, timePart] = raw.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute, second] = timePart.split(":").map(Number);
    return getUtcSqlForLocalParts({ year, month, day, hour, minute, second, timeZone });
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${getPadString(d.getUTCMonth() + 1)}-${getPadString(d.getUTCDate())} ${getPadString(d.getUTCHours())}:${getPadString(d.getUTCMinutes())}:${getPadString(d.getUTCSeconds())}`;
  }
  const stripped = raw.replace("T", " ").replace("Z", "").split(".")[0];
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stripped)) return stripped;
  return null;
}


function getISO(ts) {
  if (!ts) return "";
  if (ts instanceof Date) return ts.toISOString();
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString();
}


function getIsDateOnly(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
}


function getNowUtcSql() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${da} ${hh}:${mm}:${ss}`;
}


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


async function getPreloadUpToCap(
  pool,
  channelIds,
  { startTs, endTs, endExclusive, startCtxId, cap, pageSize, includeToolRows }
) {
  const out = [];
  let cursor = Number.isFinite(startCtxId) && startCtxId > 0 ? startCtxId : null;
  const size = Math.max(1, pageSize || 1000);
  const hardCap = Math.max(1, cap || 10000);
  const lookaheadCap = hardCap + 1;
  while (out.length < lookaheadCap) {
    const need = Math.min(size, lookaheadCap - out.length);
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
  const hasMore = out.length > hardCap;
  return {
    rows: hasMore ? out.slice(0, hardCap) : out,
    hasMore,
    fetchedCount: out.length
  };
}




async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const cfgTool = wo?.toolsconfig?.getHistory || {};

  const channelIdSet = new Set();
  const primaryChannelId = String(wo?.callerChannelId || wo?.channelId || "").trim();
  if (primaryChannelId) channelIdSet.add(primaryChannelId);
  for (const cid of (Array.isArray(wo?.callerChannelIds) ? wo.callerChannelIds : [])) {
    const s = String(cid || "").trim(); if (s) channelIdSet.add(s);
  }
  for (const cid of (Array.isArray(wo?.channelIds) ? wo.channelIds : [])) {
    const s = String(cid || "").trim(); if (s) channelIdSet.add(s);
  }
  const channelIds = [...channelIdSet];
  log(`getHistory channel resolution: channelId=${wo?.channelId || "?"} callerChannelId=${wo?.callerChannelId || "?"} callerChannelIds=${JSON.stringify(wo?.callerChannelIds || [])} channelIds=${JSON.stringify(wo?.channelIds || [])} → querying=${JSON.stringify(channelIds)}`, "info");
  if (!channelIds.length) {
    return getErrorResult("channel_missing", "channelId missing (wo.channelId / wo.channelIds)");
  }
  const mainChannelId = primaryChannelId || channelIds[0];
  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) {
    return getErrorResult("db_incomplete", "workingObject.db incomplete");
  }
  const startRaw = args?.start ? String(args.start).trim() : null;
  const timeZone = (typeof wo?.timezone === "string" && wo.timezone.trim()) ? wo.timezone.trim() : "Europe/Berlin";
  if (!startRaw) {
    return getErrorResult("timeframe_required", "timeframe_required", { hint: 'Pass at least {"start":"2025-10-25"}' });
  }
  const startTs = getParsedHumanDate(startRaw, false, timeZone);
  if (!startTs) {
    return getErrorResult("invalid_start", "invalid_start", { hint: `Use YYYY-MM-DD or DD.MM.YYYY (got start="${startRaw}")` });
  }
  const endRaw = args?.end ? String(args.end).trim() : null;
  let endTs;
  let endExclusive = false;
  if (!endRaw) {
    endTs = getNowUtcSql();
    endExclusive = false;
  } else if (getIsDateOnly(endRaw)) {
    const mDe = endRaw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const mIso = endRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const year = Number(mDe ? mDe[3] : mIso?.[1]);
    const month = Number(mDe ? mDe[2] : mIso?.[2]);
    const day = Number(mDe ? mDe[1] : mIso?.[3]);
    const nextDay = getAddDaysLocal(year, month, day, 1);
    endTs = getUtcSqlForLocalParts({
      year: nextDay.year,
      month: nextDay.month,
      day: nextDay.day,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone
    });
    endExclusive = true;
  } else {
    endTs = getParsedHumanDate(endRaw, true, timeZone);
    if (!endTs) {
      return getErrorResult("invalid_end", "invalid_end", { hint: `Use YYYY-MM-DD or DD.MM.YYYY (got end="${endRaw}")` });
    }
    endExclusive = false;
  }
  const startCtxIdRaw = args?.startCtxId ?? args?.start_ctx_id ?? args?.start_ctx ?? null;
  const startCtxId = startCtxIdRaw != null ? Number(startCtxIdRaw) : null;
  const maxRows = Math.max(1, Number.isFinite(Number(cfgTool?.maxRows)) ? Number(cfgTool.maxRows) : 5000);
  const pageSize = Math.max(1, Number.isFinite(Number(cfgTool?.pagesize)) ? Number(cfgTool.pagesize) : 1000);
  const includeToolRows = cfgTool.includeToolRows === true;
  const includeJson = cfgTool.includeJson === true;
  const dumpMaxChars = Number.isFinite(Number(cfgTool?.dumpMaxChars)) ? Number(cfgTool.dumpMaxChars) : 40000;
  const pool = await getEnsurePool(wo);
  const preload = await getPreloadUpToCap(pool, channelIds, {
    startTs,
    endTs,
    endExclusive,
    startCtxId: (Number.isFinite(startCtxId) && startCtxId > 0) ? startCtxId : null,
    cap: maxRows,
    pageSize,
    includeToolRows
  });
  let rows = preload.rows;
  const preloadedCount = rows.length;
  const cappedByCap = preload.hasMore;
  log(`getHistory DB result: channels=${JSON.stringify(channelIds)} start=${startTs} end=${endTs} rows=${preloadedCount} capped=${cappedByCap}`, "info");
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
      fetched_count: preload.fetchedCount,
      capped_by_preload: false
    };
  }
  const actualStartIso = getISO(rows[0].ts);
  const dbLastRow = rows[rows.length - 1];
  const dbEndIso = getISO(dbLastRow.ts);
  const outRows = [];
  for (const r of rows) {
    const content = getExtractContent(r);
    const roleLc = String(r.role || "").toLowerCase();
    if (roleLc === "assistant" && !content) continue;
    const row = {
      ctx_id: r.ctx_id,
      ts: getISO(r.ts),
      channelId: r.id,
      role: r.role ?? null,
      text: content ?? ""
    };
    if (includeJson) row.json = r.json;
    outRows.push(row);
  }
  rows = null;

  let cappedByChars = false;
  let charsTrimmedRows = outRows;
  if (dumpMaxChars > 0) {
    let charCount = 0;
    const kept = [];
    for (const row of outRows) {
      const rowLen = (row.text ? row.text.length : 0) + 80;
      if (charCount + rowLen > dumpMaxChars && kept.length > 0) {
        cappedByChars = true;
        break;
      }
      kept.push(row);
      charCount += rowLen;
    }
    charsTrimmedRows = kept;
  }

  const returnedLastRow = charsTrimmedRows[charsTrimmedRows.length - 1];
  const returnedEndIso = returnedLastRow ? getISO(returnedLastRow.ts) : dbEndIso;
  const hasMore = cappedByCap || cappedByChars;

  return {
    ok: true,
    mode: "dump",
    channel: mainChannelId,
    channels: channelIds,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: actualStartIso,
    actual_end: returnedEndIso,
    db_end: hasMore ? dbEndIso : undefined,
    rows: charsTrimmedRows,
    count: charsTrimmedRows.length,
    max_rows: maxRows,
    preloaded_count: preloadedCount,
    fetched_count: preload.fetchedCount,
    capped_by_preload: cappedByCap,
    capped_by_chars: cappedByChars,
    has_more: hasMore,
    next_start_ctx_id: hasMore ? (returnedLastRow?.ctx_id ?? null) : null
  };
}


function getDefaultExport() {
  return {
    name: MODULE_NAME,
    invoke: getHistoryInvoke
  };
}

export default getDefaultExport();
