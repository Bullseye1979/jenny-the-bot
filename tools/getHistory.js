/**************************************************************/
/* filename: "getHistory.js"                                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/








import { getEnsurePool }      from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getHistory";


function getPadString(n) { return String(n).padStart(2, "0"); }


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


function getISO(ts) {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString();
}


function getIsDateOnly(raw) {
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
}


function getAddDaysUTC(yyyy_mm_dd, days) {
  const d = new Date(yyyy_mm_dd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + (days | 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
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




async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const cfgTool = wo?.toolsconfig?.getHistory || {};
  const overrideChannelId = args?.channelId ? String(args.channelId).trim() : (args?.channelId ? String(args.channelId).trim() : "");
  const primaryChannelId = overrideChannelId
    || String(wo?.callerChannelId || "").trim()
    || String(wo?.channelId || "").trim();
  const argChannelIds = Array.isArray(args?.channelIds)
    ? args.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : (Array.isArray(args?.channelIds)
      ? args.channelIds.map(c => String(c || "").trim()).filter(Boolean)
      : []);
  const woCallerChannelIds = Array.isArray(wo?.callerChannelIds)
    ? wo.callerChannelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];
  const woChannelIds = Array.isArray(wo?.channelIds)
    ? wo.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];
  const extraChannelIds = argChannelIds.length ? argChannelIds
    : woCallerChannelIds.length ? woCallerChannelIds
    : woChannelIds;
  const channelIdSet = new Set();
  if (primaryChannelId) channelIdSet.add(primaryChannelId);
  for (const cid of extraChannelIds) channelIdSet.add(cid);
  const channelIds = [...channelIdSet];
  if (!channelIds.length) {
    return { ok: false, error: "channelId missing (wo.channelId / wo.channelIds)" };
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
    endTs = getNowUtcSql();
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
  const startCtxIdRaw = args?.startCtxId ?? args?.start_ctx_id ?? args?.start_ctx ?? null;
  const startCtxId = startCtxIdRaw != null ? Number(startCtxIdRaw) : null;
  const maxRows = Math.max(1, Number.isFinite(Number(cfgTool?.maxRows)) ? Number(cfgTool.maxRows) : 5000);
  const pageSize = Math.max(1, Number.isFinite(Number(cfgTool?.pagesize)) ? Number(cfgTool.pagesize) : 1000);
  const includeToolRows = cfgTool.includeToolRows !== false;
  const includeJson = cfgTool.includeJson === true;
  const dumpMaxChars = Number.isFinite(Number(cfgTool?.dumpMaxChars)) ? Number(cfgTool.dumpMaxChars) : 60000;
  const pool = await getEnsurePool(wo);
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
  const actualStartIso = getISO(rows[0].ts);
  const lastRow = rows[rows.length - 1];
  const actualEndIso = getISO(lastRow.ts);
  const outRows = rows.map((r) => {
    const row = {
      ctx_id: r.ctx_id,
      ts: r.ts,
      id: r.id,
      channelId: r.id,
      text: r.text,
      role: r.role ?? null
    };
    if (includeJson) row.json = r.json;
    return row;
  });
  outRows.push({
    ctx_id: lastRow.ctx_id,
    ts: lastRow.ts,
    id: mainChannelId,
    channelId: mainChannelId,
    text: `[effective_end_ts]\n${lastRow.ts}`,
    role: null
  });
  rows = null;

  let cappedByChars = false;
  let charsTrimmedRows = outRows;
  if (dumpMaxChars > 0) {
    let charCount = 0;
    const kept = [];
    for (const row of outRows) {
      const rowLen = (row.text ? row.text.length : 0) + (row.json ? row.json.length : 0) + 80;
      if (charCount + rowLen > dumpMaxChars && kept.length > 0) {
        cappedByChars = true;
        break;
      }
      kept.push(row);
      charCount += rowLen;
    }
    charsTrimmedRows = kept;
  }

  return {
    ok: true,
    mode: "dump",
    channel: mainChannelId,
    channels: channelIds,
    requested_start: startTs,
    requested_end: endTs,
    actual_start: actualStartIso,
    actual_end: actualEndIso,
    rows: charsTrimmedRows,
    count: charsTrimmedRows.length,
    max_rows: maxRows,
    preloaded_count: preloadedCount,
    capped_by_preload: cappedByCap,
    capped_by_chars: cappedByChars,
    has_more: cappedByCap || cappedByChars,
    next_start_ctx_id: (cappedByCap || cappedByChars) ? charsTrimmedRows[charsTrimmedRows.length - 1]?.ctx_id ?? null : null
  };
}


function getDefaultExport() {
  return {
    name: MODULE_NAME,
    invoke: getHistoryInvoke
  };
}

export default getDefaultExport();
