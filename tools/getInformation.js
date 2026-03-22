/**********************************************************************************/
/* filename: getInformation.js                                                     *
/* Version 1.1                                                                     *
/* Purpose: Query channel context in MariaDB using fixed-size clusters to build    *
/*          info snippets ranked by coverage then frequency.                       *
/*          v1.1: 2-pass alias search — Pass 1 finds rows for original keywords,  *
/*          a small AI call extracts aliases, Pass 2 searches for those aliases,   *
/*          results are merged and deduplicated before returning.                  *
/**********************************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getInformation";
const POOLS = new Map();

const DEFAULT_ROWS_PER_CLUSTER   = 400;
const DEFAULT_PAD_ROWS           = 20;
const DEFAULT_MAX_LOG_CHARS      = 6000;
const DEFAULT_TOKEN_WINDOW       = 5;
const DEFAULT_MAX_OUTPUT_LINES   = 800;
const DEFAULT_MIN_COVERAGE       = 1;
const DEFAULT_EVENT_GAP_MINUTES  = 45;
const DEFAULT_ALIAS_SAMPLE_ROWS  = 30;
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


function getNormalizePhrasesToWords(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const s = String(raw ?? "").toLowerCase();
    const words = s.split(/\s+/).map(w => w.trim()).filter(Boolean);
    for (const w of words) {
      if (w.length < 2 || w.length > 200) continue;
      if (!seen.has(w)) {
        seen.add(w);
        out.push(w);
        if (out.length >= 48) break;
      }
    }
    if (out.length >= 48) break;
  }
  return out;
}


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
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


function getNormalizeGroupsFromArgs(args) {
  if (Array.isArray(args?.keyword_groups) && args.keyword_groups.length) {
    return args.keyword_groups.map((g, i) => ({
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
        channel_id: ch,
        idx,
        start_rn: idx * R + 1,
        end_rn: (idx + 1) * R,
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


/* Run a single search pass for the given groups.
   Returns { blocks, analyzed, hitCount } or null when no hits. */
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
        ? [c.channel_id, c.start_rn, c.end_rn]
        : [c.channel_id, c.channel_id, c.start_rn, c.end_rn]
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
    if (a.channel_id !== b.channel_id) return a.channel_id.localeCompare(b.channel_id);
    return a.start_rn - b.start_rn;
  });

  const blocks = [];
  let usedLines = 0;

  for (const c of analyzed) {
    if (c.coverage < minCoverage) break;

    const padStart = Math.max(1, c.start_rn - padRows);
    const padEnd = c.end_rn + padRows;
    const [rowsFull] = await db.execute(
      fetchRangeSQL,
      includeAnsweredTurns
        ? [c.channel_id, padStart, padEnd]
        : [c.channel_id, c.channel_id, padStart, padEnd]
    );

    const lines = [];
    const seenLocal = new Set();

    lines.push({
      channel_id: c.channel_id,
      rn: c.start_rn - 0.0001,
      ts: null,
      sender: "meta",
      content: `[[ CLUSTER channel=${c.channel_id} idx=${c.idx} rows=${c.start_rn}-${c.end_rn} coverage=${c.coverage} hits=${c.totalHits} ]]`
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

      lines.push({ channel_id: r.id, rn: r.rn, ts: r.ts, sender, content: safe });
    }

    if (usedLines + lines.length > maxOutputLines) {
      const remaining = Math.max(0, maxOutputLines - usedLines);
      if (remaining > 0) blocks.push({ channel_id: c.channel_id, start_rn: c.start_rn, idx: c.idx, lines: lines.slice(0, remaining), firstTs, lastTs });
      usedLines = maxOutputLines;
      break;
    }

    blocks.push({ channel_id: c.channel_id, start_rn: c.start_rn, idx: c.idx, lines, firstTs, lastTs });
    usedLines += lines.length;
  }

  return { blocks, analyzed, hitCount: hitRows.length };
}


/* Extract aliases from Pass 1 rows using a small AI call.
   Returns an array of lowercase alias strings (may be empty). */
async function getExtractAliases(pass1Blocks, originalGroups, giCfg, wo) {
  const endpoint   = giCfg.aliasEndpoint   || wo.endpoint   || "";
  const apiKey     = giCfg.aliasApiKey     || wo.apiKey     || "";
  const model      = giCfg.aliasModel      || wo.model      || "gpt-4o-mini";
  const maxAliases = Math.max(1, Math.floor(giCfg.aliasMaxCount   ?? DEFAULT_ALIAS_MAX));
  const sampleSize = Math.max(5, Math.floor(giCfg.aliasSampleRows ?? DEFAULT_ALIAS_SAMPLE_ROWS));
  const timeoutMs  = Math.max(5000, Math.floor(giCfg.aliasTimeoutMs ?? DEFAULT_ALIAS_TIMEOUT_MS));

  if (!endpoint || !apiKey) return [];

  /* Collect content rows from Pass 1, skip meta lines */
  const contentLines = pass1Blocks
    .flatMap(b => b.lines)
    .filter(l => Number.isInteger(l.rn))
    .slice(0, sampleSize);

  if (!contentLines.length) return [];

  const excerpts = contentLines
    .map(l => `[${String(l.sender || "").split("|")[0]}]: ${String(l.content || "").slice(0, 300)}`)
    .join("\n");

  const searchTerms = originalGroups.map(g => g.base);

  const systemPrompt =
    `You are an alias extractor for conversation transcripts. ` +
    `Given excerpts, identify ALL alternative names, nicknames, titles, or labels used to refer to the SAME entities as the search terms. ` +
    `Rules: return ONLY a JSON array of short strings (names/labels, not sentences). ` +
    `Max ${maxAliases} items. Exclude the original search terms. If none found, return []. ` +
    `Example: ["Hippomann","Slaad","der Unbekannte"]`;

  const userPrompt =
    `Search terms: ${JSON.stringify(searchTerms)}\n\nConversation excerpts:\n${excerpts}`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   }
        ]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const match = text.match(/\[[\s\S]*?\]/);
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


/* Merge blocks from two passes, deduplicate rows by (channel_id, rn), sort chronologically. */
function getMergeBlocks(blocks1, blocks2) {
  const seenRN = new Set();
  const merged = [];

  for (const b of [...blocks1, ...blocks2]) {
    const lines = [];
    for (const l of b.lines) {
      const isHeader = !Number.isInteger(l.rn);
      if (isHeader) { lines.push(l); continue; }
      const key = `${l.channel_id}:${l.rn}`;
      if (seenRN.has(key)) continue;
      seenRN.add(key);
      lines.push(l);
    }
    /* Only keep block if it has at least one non-header row */
    if (lines.filter(l => Number.isInteger(l.rn)).length > 0) {
      merged.push({ ...b, lines });
    }
  }

  merged.sort((a, b) => {
    if (a.channel_id !== b.channel_id) return a.channel_id.localeCompare(b.channel_id);
    return a.start_rn - b.start_rn;
  });

  return merged;
}


async function getInformationInvoke(args, coreData) {
  const startedAt = Date.now();
  const wo = coreData?.workingObject || {};

  const primaryChannelId = String(wo?.channelID || "").trim();
  const extraChannelIds = Array.isArray(wo?.channelIds)
    ? wo.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];

  const channelIdSet = new Set();
  if (primaryChannelId) channelIdSet.add(primaryChannelId);
  for (const cid of extraChannelIds) channelIdSet.add(cid);
  const channelIds = [...channelIdSet];

  if (!channelIds.length) return { error: "ERROR: channel_id missing (wo.channelID / wo.channelIds)" };

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
  const aliasMaxDepth          = Math.max(1, Math.floor(giCfg.aliasMaxDepth ?? 1));

  const fetchRangeSQL = getBuildFetchRangeSQL(includeAssistantTurns, includeAnsweredTurns);

  const passOpts = {
    rowsPerCluster, padRows, tokenWindow, stripCode,
    maxOutputLines, minCoverage,
    includeAssistantTurns, includeAnsweredTurns,
    fetchRangeSQL
  };

  try {
    const db = await getPool(wo);

    /* ── Pass 1: search for original keywords ── */
    const pass1 = await getRunSearchPass(db, channelIds, groups, passOpts);

    if (!pass1 || pass1.hitCount === 0) {
      return {
        items: [],
        meta: {
          channel_id: mainChannelId, channel_ids: channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rows_per_cluster: rowsPerCluster, clusters_considered: 0,
          clusters_selected: 0, printed_rows: 0,
          duration_ms: Date.now() - startedAt,
          include_assistant_turns: includeAssistantTurns,
          include_answered_turns: includeAnsweredTurns,
          note: "No matching rows found. Call getTimeline separately if a chronological overview is needed."
        }
      };
    }

    /* ── Iterative alias search (depth-limited) ── */
    /* allAliases: every alias searched so far (prevents re-searching)
       latestBlocks: blocks from the most recent pass (source for next alias extraction)
       allBlocks: accumulated merged result across all passes               */
    const allAliases = new Set(groups.map(g => g.base));
    let allBlocks    = pass1.blocks;
    let latestBlocks = pass1.blocks;
    let totalAliases = [];
    let clustersConsidered = pass1.analyzed?.length || 0;

    if (includeAliasSearch && pass1.blocks.length) {
      for (let depth = 0; depth < aliasMaxDepth; depth++) {
        /* Extract aliases from rows found in the PREVIOUS pass only */
        const newAliases = (await getExtractAliases(latestBlocks, groups, giCfg, wo))
          .filter(a => !allAliases.has(a));

        if (!newAliases.length) break;

        newAliases.forEach(a => allAliases.add(a));
        totalAliases = [...totalAliases, ...newAliases];

        const aliasGroups = newAliases.map((a, i) => ({
          id: groups.length + totalAliases.length - newAliases.length + i,
          base: a,
          variants: [a],
          parts: []
        }));

        const passN = await getRunSearchPass(db, channelIds, aliasGroups, passOpts);
        clustersConsidered += passN?.analyzed?.length || 0;

        if (passN?.blocks?.length) {
          allBlocks    = getMergeBlocks(allBlocks, passN.blocks);
          latestBlocks = passN.blocks;
        } else {
          break; /* no new rows found — stop early */
        }
      }
    }

    if (!allBlocks.length) {
      return {
        items: [],
        meta: {
          channel_id: mainChannelId, channel_ids: channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rows_per_cluster: rowsPerCluster,
          clusters_considered: clustersConsidered,
          clusters_selected: 0, printed_rows: 0,
          duration_ms: Date.now() - startedAt,
          include_assistant_turns: includeAssistantTurns,
          include_answered_turns: includeAnsweredTurns,
          aliases_searched: totalAliases.length ? totalAliases : undefined,
          note: "Hits found but no cluster met minCoverage. Call getTimeline separately if a chronological overview is needed."
        }
      };
    }

    /* ── Build final output ── */
    const allPrinted = [];
    const seenGlobalRN = new Set();

    for (let bi = 0; bi < allBlocks.length; bi++) {
      const B = allBlocks[bi];

      for (const L of B.lines) {
        const isHeader = !Number.isInteger(L.rn);
        if (isHeader) { allPrinted.push(L); continue; }
        const key = `${L.channel_id}:${L.rn}`;
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
            channel_id: B.channel_id,
            rn: (B.lines[B.lines.length - 1]?.rn ?? 0) + 0.00001,
            ts: null,
            sender: "meta",
            content: `---------- NEW EVENT (Δ ${getFmtDelta(next.firstTs - B.lastTs)}) ----------`
          });
        }
      }
    }

    const compact = allPrinted.map(({ channel_id, rn, ts, sender, content }) => ({ channel_id, rn, ts, sender, content }));

    const meta = {
      channel_id: mainChannelId,
      channel_ids: channelIds,
      groups: groups.map(g => ({ base: g.base, parts: g.parts })),
      rows_per_cluster: rowsPerCluster,
      clusters_considered: clustersConsidered,
      clusters_selected: allBlocks.length,
      printed_rows: allPrinted.length,
      duration_ms: Date.now() - startedAt,
      include_assistant_turns: includeAssistantTurns,
      include_answered_turns: includeAnsweredTurns,
      aliases_searched: totalAliases.length ? totalAliases : undefined,
      note:
        "These are detail snippets ranked by keyword coverage. " +
        (totalAliases.length ? `Alias search found ${totalAliases.length} alias(es): ${totalAliases.join(", ")}. ` : "") +
        "Call getTimeline separately to get the full chronological event history."
    };

    return { items: compact, meta };

  } catch (e) {
    return { error: e?.message || String(e) };
  }
}


function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Search the conversation log for historical data using keywords. " +
          "Searches one or multiple channels (workingObject.channelID + optional workingObject.channelIds) " +
          "using fixed-size clusters (400 rows). " +
          "By default excludes assistant messages and 'answered' turns (role/turn_id). " +
          "Set toolsconfig.getInformation.includeAssistantTurns=true to include all rows. " +
          "Set toolsconfig.getInformation.includeAliasSearch=true to enable 2-pass alias resolution: " +
          "Pass 1 finds rows for the original keywords; a small AI call extracts aliases (e.g. nicknames, " +
          "later-used names); Pass 2 searches for those aliases; results are merged and deduplicated. " +
          "Prefers 'keyword_groups' (with 'variants' and optional 'parts'); " +
          "falls back to 'keywords' as full-form LIKE tokens (no internal splitting). " +
          "Ranking: coverage (distinct keyword groups) → totalHits → chronological order. " +
          "Each returned item includes: channel_id, rn, ts, sender, content. " +
          "Does NOT return timeline data. " +
          "Call getTimeline separately to get the full chronological event history. " +
          "Only tell the provided facts. Do not invent stories.",
        parameters: {
          type: "object",
          properties: {
            keyword_groups: {
              type: "array",
              description:
                "AI-provided groups. Each group represents a concept (full-form variants + optional parts).",
              items: {
                type: "object",
                properties: {
                  id:       { type: ["string", "number"] },
                  base:     { type: "string" },
                  variants: { type: "array", items: { type: "string" } },
                  parts:    { type: "array", items: { type: "string" } }
                },
                required: ["base"],
                additionalProperties: true
              }
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description:
                "Fallback: free-form search phrases; uses FULL FORMS only (no internal splitting)."
            }
          },
          additionalProperties: false
        }
      }
    },
    invoke: getInformationInvoke
  };
}

export default getDefaultExport();
