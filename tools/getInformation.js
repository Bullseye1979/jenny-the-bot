/**************************************************************/
/* filename: "getInformation.js"                                    */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/







import { getEnsurePool }      from "../core/context.js";
import { fetchWithTimeout }  from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getInformation";

const DEFAULT_ROWS_PER_CLUSTER   = 400;
const DEFAULT_PAD_ROWS           = 20;
const DEFAULT_MAX_LOG_CHARS      = 6000;
const DEFAULT_TOKEN_WINDOW       = 5;
const DEFAULT_MAX_OUTPUT_LINES   = 800;
const DEFAULT_MIN_COVERAGE       = 1;
const DEFAULT_EVENT_GAP_MINUTES  = 45;
const DEFAULT_ALIAS_MAX          = 8;
const DEFAULT_ALIAS_TIMEOUT_MS   = 30000;

const CONTENT_EXPR = `
  (
    COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.message.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.data.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.delta.content')),
      \`text\`,
      ''
    ) COLLATE utf8mb4_general_ci
  )
`;

const ESCAPE_CLAUSE = "ESCAPE '\\\\'";





function getStripLargeCodeBlocks(text) {
  return String(text || "").replace(/```[\s\S]*?```/g, (m) => {
    const lines = m.split("\n").length;
    return lines > 30 ? `«code ${lines} lines»` : m;
  });
}


function getEscapeLike(s) { return String(s).replace(/[\\%_]/g, m => '\\' + m); }


function getPickFirstString(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}


function getParseRowForText(row, { stripCode }) {
  const role = (typeof row.role === "string" && row.role.trim()) ? row.role.trim() : "unknown";
  let author = "unknown", content = "";
  try {
    const j = typeof row.json === "string" ? JSON.parse(row.json) : (row.json || {});
    author = getPickFirstString(j.authorName, j.user?.name, j.userId, j.role) || "unknown";
    content = getPickFirstString(
      j.content,
      j.message?.content,
      j.data?.content,
      j.delta?.content,
      j.text,
      row.text
    );
  } catch {
    author = "unknown";
    content = typeof row.text === "string" ? row.text.trim() : "";
  }
  if (stripCode) content = getStripLargeCodeBlocks(content);
  const sender = `${role}|${author}`;
  return { sender, content: String(content || "").trim() };
}


function getNorm(s) { return String(s || "").toLowerCase(); }


function getUniqueArr(a) { return [...new Set((a || []).filter(Boolean))]; }


function getTokenize(text) {
  return String(text || "").toLowerCase().split(/\W+/).filter(Boolean);
}


function getParseTs(ts) {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

function getFmtDelta(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}



function getNormalizeGroupsFromArgs(args) {
  const keywordGroups = Array.isArray(args?.keywordGroups) ? args.keywordGroups : args?.keyword_groups;
  if (Array.isArray(keywordGroups) && keywordGroups.length) {
    return keywordGroups.map((g, i) => ({
      id: g.id ?? i,
      base: getNorm(g.base),
      variants: getUniqueArr([...(g.variants || []), g.base].map(getNorm)),
      parts: getUniqueArr((g.parts || []).map(getNorm))
    }));
  }
  const phrases = (Array.isArray(args?.keywords) ? args.keywords : [])
    .map(s => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 48);
  return phrases.map((p, i) => ({
    id: i,
    base: getNorm(p),
    variants: [getNorm(p)],
    parts: []
  }));
}


function getPartsInWindow(tokens, parts, K = DEFAULT_TOKEN_WINDOW) {
  if (!parts?.length) return 0;
  const posMap = new Map(parts.map(p => [p, []]));
  tokens.forEach((t, i) => { if (posMap.has(t)) posMap.get(t).push(i); });
  let distinctPartsHere = 0;
  for (const p of parts) if ((posMap.get(p) || []).length) distinctPartsHere++;
  if (distinctPartsHere < 2) return 0;
  const ps = parts.filter(p => (posMap.get(p) || []).length);
  for (let a = 0; a < ps.length; a++) {
    for (let b = a + 1; b < ps.length; b++) {
      const A = posMap.get(ps[a]), B = posMap.get(ps[b]);
      let i = 0, j = 0;
      while (i < A.length && j < B.length) {
        const d = B[j] - A[i];
        if (Math.abs(d) <= K) return 2;
        (A[i] < B[j]) ? i++ : j++;
      }
    }
  }
  return 1;
}


function getAnalyzeClusterRows(rows, groups, { tokenWindow = DEFAULT_TOKEN_WINDOW, stripCode = false } = {}) {
  const gState = groups.map(() => ({ lvl: 0, partialLines: 0, hadFull: false }));
  let coverage = 0, sumEvidenceLevel = 0, fullformGroups = 0, totalHits = 0, rowsMulti = 0, rowsAny = 0;

  for (const r of rows) {
    const { content } = getParseRowForText(r, { stripCode });
    const text = String(content || "");
    if (!text) continue;
    const textLower = text.toLowerCase();
    const tokens = getTokenize(text);
    let distinctGroupsHere = 0;

    groups.forEach((g, gi) => {
      if (g.variants.some(v => textLower.includes(v))) {
        if (!gState[gi].hadFull) { totalHits += 1; gState[gi].hadFull = true; }
        if (gState[gi].lvl < 3) gState[gi].lvl = 3;
        distinctGroupsHere++;
        return;
      }
      const partsHit = getPartsInWindow(tokens, g.parts, tokenWindow);
      if (partsHit >= 2) {
        totalHits += 1;
        if (gState[gi].lvl < 2) gState[gi].lvl = 2;
        distinctGroupsHere++;
      } else if (partsHit === 1) {
        gState[gi].partialLines++;
      }
    });

    if (distinctGroupsHere > 0) {
      rowsAny++;
      if (distinctGroupsHere >= 2) rowsMulti++;
    }
  }

  gState.forEach(s => { if (s.lvl < 2 && s.partialLines >= 2) s.lvl = 1; });
  gState.forEach(s => {
    if (s.lvl > 0) {
      coverage++;
      sumEvidenceLevel += s.lvl;
      if (s.lvl === 3) fullformGroups++;
    }
  });

  return { coverage, sumEvidenceLevel, fullformGroups, totalHits, rowsMulti, rowsAny };
}


function getBuildClustersFromHits(hitRows, rowsPerCluster) {
  const R = Math.max(1, Math.floor(rowsPerCluster));
  const set = new Map();
  for (const h of hitRows) {
    const rn = Number(h.rn);
    const ch = String(h.id || "");
    const idx = Math.floor((rn - 1) / R);
    const key = `${ch}::${idx}`;
    let c = set.get(key);
    if (!c) {
      c = {
        key,
        channelId: ch,
        idx,
        startRn: idx * R + 1,
        endRn: (idx + 1) * R,
        hitCount: 0
      };
      set.set(key, c);
    }
    c.hitCount++;
  }
  return [...set.values()];
}


function getBuildLikeFlags(contentExpr, tokens) {
  const flagExprs = tokens.map(() =>
    `(${contentExpr} LIKE (?) ${ESCAPE_CLAUSE})`
  );
  const selectFlagsSQL = flagExprs.map((e, i) => `${e} AS k${i}`).join(",\n           ");
  const whereAnySQL = flagExprs.length ? flagExprs.join(" OR ") : "FALSE";
  return { selectFlagsSQL, whereAnySQL };
}


function getBuildHitsSQL(idPlaceholders, selectFlagsSQL, whereAnySQL, { includeAssistantTurns, includeAnsweredTurns }) {
  const assistantFilter = includeAssistantTurns ? "" : `\n       AND o.\`role\` <> 'assistant'`;

  if (includeAnsweredTurns) {
    return `
      WITH ordered AS (
        SELECT \`ts\`, \`id\`, \`json\`, \`text\`, \`role\`, \`turn_id\`,
               ROW_NUMBER() OVER (PARTITION BY \`id\` ORDER BY \`ts\` ASC) AS rn
          FROM \`context\`
         WHERE \`id\` IN (${idPlaceholders})
      )
      SELECT o.\`ts\`, o.\`id\`, o.rn,
             ${selectFlagsSQL}
        FROM ordered o
       WHERE (${whereAnySQL})${assistantFilter}
       ORDER BY o.\`id\` ASC, o.rn ASC
    `.trim();
  }

  return `
    WITH ordered AS (
      SELECT \`ts\`, \`id\`, \`json\`, \`text\`, \`role\`, \`turn_id\`,
             ROW_NUMBER() OVER (PARTITION BY \`id\` ORDER BY \`ts\` ASC) AS rn
        FROM \`context\`
       WHERE \`id\` IN (${idPlaceholders})
    ),
    answered_turns AS (
      SELECT \`id\`, \`turn_id\`
        FROM \`context\`
       WHERE \`id\` IN (${idPlaceholders})
         AND \`turn_id\` IS NOT NULL
       GROUP BY \`id\`, \`turn_id\`
      HAVING SUM(\`role\` = 'assistant') > 0
         AND SUM(\`role\` IN ('user','agent')) > 0
    )
    SELECT o.\`ts\`, o.\`id\`, o.rn,
           ${selectFlagsSQL}
      FROM ordered o
     WHERE (${whereAnySQL})${assistantFilter}
       AND (
         o.\`turn_id\` IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM answered_turns at
            WHERE at.\`id\` = o.\`id\`
              AND at.\`turn_id\` = o.\`turn_id\`
         )
       )
     ORDER BY o.\`id\` ASC, o.rn ASC
  `.trim();
}


function getBuildFetchRangeSQL(includeAssistantTurns, includeAnsweredTurns) {
  const assistantFilter = includeAssistantTurns ? "" : `\n       AND o.\`role\` <> 'assistant'`;

  if (includeAnsweredTurns) {
    return `
      WITH ordered AS (
        SELECT \`ts\`, \`id\`, \`json\`, \`text\`, \`role\`, \`turn_id\`,
               ROW_NUMBER() OVER (PARTITION BY \`id\` ORDER BY \`ts\` ASC) AS rn
          FROM \`context\`
         WHERE \`id\` = ?
      )
      SELECT o.\`ts\`, o.\`id\`, o.\`json\`, o.\`text\`, o.\`role\`, o.rn
        FROM ordered o
       WHERE o.rn BETWEEN ? AND ?${assistantFilter}
       ORDER BY o.rn ASC
    `.trim();
  }

  return `
    WITH ordered AS (
      SELECT \`ts\`, \`id\`, \`json\`, \`text\`, \`role\`, \`turn_id\`,
             ROW_NUMBER() OVER (PARTITION BY \`id\` ORDER BY \`ts\` ASC) AS rn
        FROM \`context\`
       WHERE \`id\` = ?
    ),
    answered_turns AS (
      SELECT \`turn_id\`
        FROM \`context\`
       WHERE \`id\` = ?
         AND \`turn_id\` IS NOT NULL
       GROUP BY \`turn_id\`
      HAVING SUM(\`role\` = 'assistant') > 0
         AND SUM(\`role\` IN ('user','agent')) > 0
    )
    SELECT o.\`ts\`, o.\`id\`, o.\`json\`, o.\`text\`, o.\`role\`, o.rn
      FROM ordered o
     WHERE o.rn BETWEEN ? AND ?${assistantFilter}
       AND (o.\`turn_id\` IS NULL OR o.\`turn_id\` NOT IN (SELECT \`turn_id\` FROM answered_turns))
     ORDER BY o.rn ASC
  `.trim();
}




async function getRunSearchPass(db, channelIds, groups, opts) {
  const {
    rowsPerCluster, padRows, tokenWindow, stripCode,
    maxOutputLines, minCoverage,
    includeAssistantTurns, includeAnsweredTurns,
    fetchRangeSQL
  } = opts;

  const sqlTokens = Array.from(new Set(groups.flatMap(g => g.variants)));
  if (!sqlTokens.length) return null;

  const { selectFlagsSQL, whereAnySQL } = getBuildLikeFlags(CONTENT_EXPR, sqlTokens);
  const likeParams = sqlTokens.map(k => `%${getEscapeLike(k)}%`);
  const idPlaceholders = channelIds.map(() => "?").join(", ");
  const hitsSQL = getBuildHitsSQL(idPlaceholders, selectFlagsSQL, whereAnySQL, { includeAssistantTurns, includeAnsweredTurns });

  const hitsParams = includeAnsweredTurns
    ? [...channelIds, ...likeParams, ...likeParams]
    : [...channelIds, ...channelIds, ...likeParams, ...likeParams];
  const [hitRows] = await db.execute(hitsSQL, hitsParams);

  if (!hitRows?.length) return { blocks: [], analyzed: [], hitCount: 0 };

  const clustersAll = getBuildClustersFromHits(hitRows, rowsPerCluster);
  const analyzed = [];

  for (const c of clustersAll) {
    const [rowsInRange] = await db.execute(
      fetchRangeSQL,
      includeAnsweredTurns
        ? [c.channelId, c.startRn, c.endRn]
        : [c.channelId, c.channelId, c.startRn, c.endRn]
    );
    const metrics = getAnalyzeClusterRows(rowsInRange, groups, { tokenWindow, stripCode });
    let firstTs = null, lastTs = null;
    for (const r of rowsInRange) {
      const t = getParseTs(r.ts);
      if (t == null) continue;
      if (firstTs == null || t < firstTs) firstTs = t;
      if (lastTs == null || t > lastTs) lastTs = t;
    }
    analyzed.push({ ...c, rowsInRangeCount: rowsInRange.length, ...metrics, firstTs, lastTs });
  }

  analyzed.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (b.totalHits !== a.totalHits) return b.totalHits - a.totalHits;
    if (b.rowsMulti !== a.rowsMulti) return b.rowsMulti - a.rowsMulti;
    if (b.rowsAny !== a.rowsAny) return b.rowsAny - a.rowsAny;
    if (a.channelId !== b.channelId) return a.channelId.localeCompare(b.channelId);
    return a.startRn - b.startRn;
  });

  const blocks = [];
  let usedLines = 0;

  for (const c of analyzed) {
    if (c.coverage < minCoverage) break;

    const padStart = Math.max(1, c.startRn - padRows);
    const padEnd = c.endRn + padRows;
    const [rowsFull] = await db.execute(
      fetchRangeSQL,
      includeAnsweredTurns
        ? [c.channelId, padStart, padEnd]
        : [c.channelId, c.channelId, padStart, padEnd]
    );

    const lines = [];
    const seenLocal = new Set();

    lines.push({
      channelId: c.channelId,
      rn: c.startRn - 0.0001,
      ts: null,
      sender: "meta",
      content: `[[ CLUSTER channel=${c.channelId} idx=${c.idx} rows=${c.startRn}-${c.endRn} coverage=${c.coverage} hits=${c.totalHits} ]]`
    });

    let firstTs = null, lastTs = null;

    for (const r of rowsFull) {
      const key = `${r.id}:${r.rn}`;
      if (seenLocal.has(key)) continue;
      seenLocal.add(key);

      const { sender, content } = getParseRowForText(r, { stripCode });
      let safe = typeof content === "string" ? content : String(content ?? "");
      if (safe.length > DEFAULT_MAX_LOG_CHARS) safe = safe.slice(0, DEFAULT_MAX_LOG_CHARS) + "…";

      const t = getParseTs(r.ts);
      if (t != null) {
        if (firstTs == null || t < firstTs) firstTs = t;
        if (lastTs == null || t > lastTs) lastTs = t;
      }

      lines.push({ channelId: r.id, rn: r.rn, ts: r.ts, sender, content: safe });
    }

    if (usedLines + lines.length > maxOutputLines) {
      const remaining = Math.max(0, maxOutputLines - usedLines);
      if (remaining > 0) blocks.push({ channelId: c.channelId, startRn: c.startRn, idx: c.idx, lines: lines.slice(0, remaining), firstTs, lastTs });
      usedLines = maxOutputLines;
      break;
    }

    blocks.push({ channelId: c.channelId, startRn: c.startRn, idx: c.idx, lines, firstTs, lastTs });
    usedLines += lines.length;
  }

  return { blocks, analyzed, hitCount: hitRows.length };
}


async function callInternalLlm(payload, cfg, timeoutMs) {
  const apiUrl    = String(cfg.llmApiUrl    || "http://localhost:3400") + "/api";
  const channelId = String(cfg.aliasLlmChannelId || cfg.llmChannelId || "").trim();
  const apiSecret = String(cfg.llmApiSecret || "").trim();

  if (!channelId) return { ok: false, text: "" };

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const body = JSON.stringify({ channelId, payload, doNotWriteToContext: true });

  try {
    const res  = await fetchWithTimeout(apiUrl, { method: "POST", headers, body }, Math.max(5000, timeoutMs || DEFAULT_ALIAS_TIMEOUT_MS));
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return { ok: false, text: "" };
    return { ok: true, text: String(data.response || "") };
  } catch {
    return { ok: false, text: "" };
  }
}


async function getExtractAliases(contentLines, originalGroups, giCfg) {
  const maxAliases = Math.max(1, Math.floor(giCfg.aliasMaxCount ?? DEFAULT_ALIAS_MAX));
  const timeoutMs  = Math.max(5000, Math.floor(giCfg.aliasTimeoutMs ?? DEFAULT_ALIAS_TIMEOUT_MS));

  const channelId = String(giCfg.aliasLlmChannelId || giCfg.llmChannelId || "").trim();
  if (!channelId) return [];
  if (!contentLines.length) return [];

  const excerpts = contentLines
    .map(l => `[${String(l.sender || "").split("|")[0]}]: ${String(l.content || "").slice(0, 300)}`)
    .join("\n");

  const searchTerms = originalGroups.map(g => g.base);

  const systemPrompt = typeof giCfg.aliasSystemPrompt === "string"
    ? giCfg.aliasSystemPrompt.trim().replace(/\$\{maxAliases\}/g, String(maxAliases))
    : "";
  if (!systemPrompt) return [];

  const userPrompt =
    `Search terms (find aliases FOR these): ${JSON.stringify(searchTerms)}\n\nConversation excerpts:\n${excerpts}`;

  const fullPayload = `${systemPrompt}\n\n${userPrompt}`;

  const result = await callInternalLlm(fullPayload, giCfg, timeoutMs);
  if (!result.ok || !result.text) return [];

  try {
    const match = result.text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const original = new Set(searchTerms.map(getNorm));
    return parsed
      .map(s => getNorm(String(s || "").trim()))
      .filter(s => s.length >= 2 && s.length <= 100 && !original.has(s))
      .slice(0, maxAliases);
  } catch {
    return [];
  }
}


function getBlockRowKeys(blocks) {
  const keys = new Set();
  for (const b of blocks)
    for (const l of b.lines)
      if (Number.isInteger(l.rn)) keys.add(`${l.channelId}:${l.rn}`);
  return keys;
}


function getDiffLines(newBlocks, existingKeys) {
  const lines = [];
  for (const b of newBlocks)
    for (const l of b.lines)
      if (Number.isInteger(l.rn) && !existingKeys.has(`${l.channelId}:${l.rn}`))
        lines.push(l);
  return lines;
}



function getMergeBlocks(blocks1, blocks2) {
  const seenRN = new Set();
  const merged = [];

  for (const b of [...blocks1, ...blocks2]) {
    const lines = [];
    for (const l of b.lines) {
      const isHeader = !Number.isInteger(l.rn);
      if (isHeader) { lines.push(l); continue; }
      const key = `${l.channelId}:${l.rn}`;
      if (seenRN.has(key)) continue;
      seenRN.add(key);
      lines.push(l);
    }
    if (lines.filter(l => Number.isInteger(l.rn)).length > 0) {
      merged.push({ ...b, lines });
    }
  }

  merged.sort((a, b) => {
    if (a.channelId !== b.channelId) return a.channelId.localeCompare(b.channelId);
    return a.startRn - b.startRn;
  });

  return merged;
}


async function getEnrichTimeline(db, snippetRows, channelIds) {
  const placeholders = channelIds.map(() => "?").join(", ");
  let periods = [];
  try {
    const [rows] = await db.execute(
      `SELECT channel_id, start_idx, end_idx, start_ts, end_ts, summary
         FROM timeline_periods
        WHERE channel_id IN (${placeholders})
        ORDER BY start_ts ASC, start_idx ASC`,
      channelIds
    );
    periods = (rows || []).map((row) => ({
      channelId: row.channel_id || "",
      startIdx: row.start_idx,
      endIdx: row.end_idx,
      startTs: row.start_ts,
      endTs: row.end_ts,
      summary: row.summary || ""
    }));
  } catch {
    return snippetRows.length
      ? [{ type: "unplaced", snippets: snippetRows }]
      : [];
  }

  if (!periods.length) {
    return snippetRows.length
      ? [{ type: "unplaced", snippets: snippetRows }]
      : [];
  }

  const snippetsByChannel = new Map();
  for (const row of snippetRows) {
    const cid = row.channelId || "";
    if (!snippetsByChannel.has(cid)) snippetsByChannel.set(cid, []);
    snippetsByChannel.get(cid).push(row);
  }

  const placedKeys = new Set();
  const entries = [];

  for (const period of periods) {
    const cid = period.channelId;
    const pStart = period.startTs ? new Date(period.startTs).getTime() : null;
    const pEnd   = period.endTs   ? new Date(period.endTs).getTime()   : null;

    const matching = (snippetsByChannel.get(cid) || []).filter(row => {
      if (!row.ts) return false;
      const t = new Date(row.ts).getTime();
      if (Number.isNaN(t)) return false;
      if (pStart !== null && t < pStart) return false;
      if (pEnd   !== null && t > pEnd)   return false;
      return true;
    });

    if (matching.length) {
      for (const row of matching) placedKeys.add(`${row.channelId}:${row.rn}`);
      entries.push({
        type: "detail",
        channelId: cid,
        startTs: period.startTs,
        endTs: period.endTs,
        snippets: matching
      });
    } else {
      entries.push({
        type: "period",
        channelId: cid,
        startTs: period.startTs,
        endTs: period.endTs,
        summary: period.summary || ""
      });
    }
  }

  const unplaced = snippetRows.filter(row => !placedKeys.has(`${row.channelId}:${row.rn}`));
  if (unplaced.length) {
    const unplacedTimes = unplaced.map(r => r.ts ? new Date(r.ts).getTime() : null).filter(t => t !== null && Number.isFinite(t));
    const unplacedEntry = { type: "unplaced", snippets: unplaced };
    if (unplacedTimes.length) {
      unplacedEntry.startTs = new Date(Math.min(...unplacedTimes)).toISOString();
      unplacedEntry.endTs = new Date(Math.max(...unplacedTimes)).toISOString();
    }
    entries.push(unplacedEntry);
  }

  return entries;
}


async function getInformationInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const startedAt = Date.now();
  const wo = coreData?.workingObject || {};

  // Always use the full mix of all available channels from context
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

  if (!channelIds.length) return { error: "ERROR: channelId missing (wo.channelId / wo.channelIds)" };

  const mainChannelId = primaryChannelId || channelIds[0];
  const groups = getNormalizeGroupsFromArgs(args);
  if (!Array.isArray(groups) || !groups.length) return { error: "ERROR: no keyword_groups or keywords" };

  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) return { error: "ERROR: workingObject.db incomplete" };

  const giCfg              = wo?.toolsconfig?.getInformation || {};
  const rowsPerCluster     = Math.max(1, Math.floor(giCfg.clusterRows      ?? DEFAULT_ROWS_PER_CLUSTER));
  const stripCode          = giCfg.stripCode === true;
  const padRows            = Math.max(0, Math.floor(giCfg.padRows           ?? DEFAULT_PAD_ROWS));
  const tokenWindow        = Math.max(1, Math.floor(giCfg.tokenWindow       ?? DEFAULT_TOKEN_WINDOW));
  const maxLogChars        = Number.isFinite(giCfg.maxLogChars) ? giCfg.maxLogChars : DEFAULT_MAX_LOG_CHARS;
  const maxOutputLines     = Math.max(100, Math.floor(giCfg.maxOutputLines  ?? DEFAULT_MAX_OUTPUT_LINES));
  const minCoverage        = Math.max(0, Math.floor(giCfg.minCoverage       ?? DEFAULT_MIN_COVERAGE));
  const eventGapMinutes    = Math.max(1, Math.floor(giCfg.eventGapMinutes   ?? DEFAULT_EVENT_GAP_MINUTES));
  const EVENT_GAP_MS       = eventGapMinutes * 60 * 1000;
  const includeAssistantTurns  = giCfg.includeAssistantTurns === true;
  const includeAnsweredTurns   = includeAssistantTurns || giCfg.includeAnsweredTurns === true;
  const includeAliasSearch     = giCfg.includeAliasSearch === true;
  const aliasMaxDepth          = Math.max(1, Math.floor(giCfg.aliasMaxDepth  ?? 1));

  const fetchRangeSQL = getBuildFetchRangeSQL(includeAssistantTurns, includeAnsweredTurns);

  const passOpts = {
    rowsPerCluster, padRows, tokenWindow, stripCode,
    maxOutputLines, minCoverage,
    includeAssistantTurns, includeAnsweredTurns,
    fetchRangeSQL
  };

  try {
    const db = await getEnsurePool(wo);

    const pass1 = await getRunSearchPass(db, channelIds, groups, passOpts);

    if (!pass1 || pass1.hitCount === 0) {
      return {
        items: [],
        meta: {
          channelId: mainChannelId, channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rowsPerCluster,
          clustersConsidered: 0,
          clustersSelected: 0,
          printedRows: 0,
          durationMs: Date.now() - startedAt,
          includeAssistantTurns,
          includeAnsweredTurns,
          note: "No matching rows found. Try broader keywords or call getHistory with a date range for a chronological overview."
        }
      };
    }
    const allSearched    = new Set(groups.flatMap(g => g.variants));
    let allBlocks        = pass1.blocks;
    let prevBlockRowKeys = getBlockRowKeys(pass1.blocks);
    let totalAliases     = [];
    let clustersConsidered = pass1.analyzed?.length || 0;

    if (includeAliasSearch && pass1.blocks.length) {
      for (let depth = 0; depth < aliasMaxDepth; depth++) {
        const sourceLines = depth === 0
          ? pass1.blocks.flatMap(b => b.lines).filter(l => Number.isInteger(l.rn))
          : getDiffLines(allBlocks, prevBlockRowKeys);

        const newAliases = (await getExtractAliases(sourceLines, groups, giCfg))
          .filter(a => !allSearched.has(a));

        if (!newAliases.length) break;

        for (const g of groups)
          for (const a of newAliases)
            if (!g.variants.includes(a)) g.variants.push(a);

        newAliases.forEach(a => allSearched.add(a));
        totalAliases = [...totalAliases, ...newAliases];

        const passN = await getRunSearchPass(db, channelIds, groups, passOpts);
        clustersConsidered += passN?.analyzed?.length || 0;

        if (passN?.blocks?.length) {
          prevBlockRowKeys = getBlockRowKeys(allBlocks);

          allBlocks        = getMergeBlocks(allBlocks, passN.blocks);
        } else {
          break;
        }
      }
    }

    if (!allBlocks.length) {
      return {
        items: [],
        meta: {
          channelId: mainChannelId, channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rowsPerCluster,
          clustersConsidered,
          clustersSelected: 0,
          printedRows: 0,
          durationMs: Date.now() - startedAt,
          includeAssistantTurns,
          includeAnsweredTurns,
          aliasesSearched: totalAliases.length ? totalAliases : undefined,
          note: "Hits found but no cluster met minCoverage. Try broader keywords or call getHistory with a date range for a chronological overview."
        }
      };
    }

    const allPrinted = [];
    const seenGlobalRN = new Set();

    for (let bi = 0; bi < allBlocks.length; bi++) {
      const B = allBlocks[bi];

      for (const L of B.lines) {
        const isHeader = !Number.isInteger(L.rn);
        if (isHeader) { allPrinted.push(L); continue; }
        const key = `${L.channelId}:${L.rn}`;
        if (seenGlobalRN.has(key)) continue;
        seenGlobalRN.add(key);
        allPrinted.push(L);
      }

      if (bi < allBlocks.length - 1) {
        const next = allBlocks[bi + 1];
        const gapOK = (B.firstTs != null && next.firstTs != null);
        const bigGap = gapOK && (next.firstTs - B.lastTs) >= EVENT_GAP_MS;
        if (bigGap) {
          allPrinted.push({
            channelId: B.channelId,
            rn: (B.lines[B.lines.length - 1]?.rn ?? 0) + 0.00001,
            ts: null,
            sender: "meta",
            content: `---------- NEW EVENT (Δ ${getFmtDelta(next.firstTs - B.lastTs)}) ----------`
          });
        }
      }
    }

    const compact = allPrinted.map(({ channelId, rn, ts, sender, content }) => ({ channelId, rn, ts, sender, content }));

    const timeline = await getEnrichTimeline(db, compact, channelIds);

    const meta = {
      channelId: mainChannelId,
      channelIds,
      groups: groups.map(g => ({ base: g.base, parts: g.parts })),
      rowsPerCluster,
      clustersConsidered,
      clustersSelected: allBlocks.length,
      printedRows: allPrinted.length,
      durationMs: Date.now() - startedAt,
      includeAssistantTurns,
      includeAnsweredTurns,
      aliasesSearched: totalAliases.length ? totalAliases : undefined,
      note:
        "Timeline entries show the full chronological structure. " +
        "Entries of type 'detail' contain exact matching snippets; entries of type 'period' are coarse summaries. " +
        (totalAliases.length ? `Alias search found ${totalAliases.length} alias(es): ${totalAliases.join(", ")}. ` : "")
    };

    return { timeline, meta };

  } catch (e) {
    return { error: e?.message || String(e) };
  }
}


function getDefaultExport() {
  return {
    name: MODULE_NAME,
    invoke: getInformationInvoke
  };
}

export default getDefaultExport();
