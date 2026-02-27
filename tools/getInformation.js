/************************************************************************************
/* filename: "getInformation.js"                                                   *
/* Version 1.0                                                                     *
/* Purpose: Query channel context in MariaDB using fixed-size clusters to build    *
/*          info snippets ranked by coverage then frequency; output chronologically*
/*          with conditional NEW EVENT separators and expose timeline_periods for  *
/*          alignment across one or multiple channels (channelID + channelIds).    *
/************************************************************************************/
/************************************************************************************
/*                                                                                  *
/************************************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getInformation";
const POOLS = new Map();

const DEFAULT_ROWS_PER_CLUSTER = 400;
const DEFAULT_PAD_ROWS = 20;
const DEFAULT_MAX_LOG_CHARS = 6000;
const DEFAULT_TOKEN_WINDOW = 5;
const DEFAULT_MAX_OUTPUT_LINES = 800;
const DEFAULT_MIN_COVERAGE = 1;
const DEFAULT_EVENT_GAP_MINUTES = 45;

const CONTENT_EXPR = `
  (
    COALESCE(
      \`text\`,
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.message.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.data.content')),
      JSON_UNQUOTE(JSON_EXTRACT(\`json\`, '$.delta.content')),
      ''
    ) COLLATE utf8mb4_general_ci
  )
`;

const ESCAPE_CLAUSE = "ESCAPE '\\\\'";

/************************************************************************************
/* functionSignature: getPool (wo)                                                 *
/* Returns or creates a pooled DB connection for given config.                     *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getMaxTimelineToFetch (wo, giCfg)                             *
/* Resolves the maximum number of timeline periods to fetch.                        *
/************************************************************************************/
function getMaxTimelineToFetch(wo, giCfg) {
  if (Number.isFinite(giCfg?.max_timeline_periods)) {
    return Math.max(1, Number(giCfg.max_timeline_periods));
  }
  const cfgCtx = wo?.config?.context;
  if (Number.isFinite(cfgCtx?.maxTimelinePeriods)) {
    return Math.max(1, Number(cfgCtx.maxTimelinePeriods));
  }
  return null;
}

/************************************************************************************
/* functionSignature: getNormalizePhrasesToWords (arr)                              *
/* Normalizes phrases into a capped list of unique words.                           *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getStripLargeCodeBlocks (text)                                *
/* Collapses large triple-backtick blocks with a placeholder.                       *
/************************************************************************************/
function getStripLargeCodeBlocks(text) {
  return String(text || "").replace(/```[\s\S]*?```/g, (m) => {
    const lines = m.split("\n").length;
    return lines > 30 ? `«code ${lines} lines»` : m;
  });
}

/************************************************************************************
/* functionSignature: getEscapeLike (s)                                            *
/* Escapes %, _ and \ for SQL LIKE expressions.                                    *
/************************************************************************************/
function getEscapeLike(s) { return String(s).replace(/[\\%_]/g, m => '\\' + m); }

/************************************************************************************
/* functionSignature: getPickFirstString (...vals)                                  *
/* Returns the first non-empty trimmed string value.                                *
/************************************************************************************/
function getPickFirstString(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

/************************************************************************************
/* functionSignature: getParseRowForText (row, opts)                                *
/* Extracts sender tag and content text from a DB row.                              *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getEscRe (s)                                                  *
/* Escapes a string for safe use in a RegExp pattern.                               *
/************************************************************************************/
function getEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/************************************************************************************
/* functionSignature: getNorm (s)                                                   *
/* Lowercases and normalizes a string value.                                        *
/************************************************************************************/
function getNorm(s) { return String(s || "").toLowerCase(); }

/************************************************************************************
/* functionSignature: getUniqueArr (a)                                              *
/* Returns a unique array with falsy values removed.                                *
/************************************************************************************/
function getUniqueArr(a) { return [...new Set((a || []).filter(Boolean))]; }

/************************************************************************************
/* functionSignature: getTokenize (text)                                            *
/* Tokenizes text into lowercase alphanumeric tokens.                               *
/************************************************************************************/
function getTokenize(text) {
  return String(text || "").toLowerCase().split(/\W+/).filter(Boolean);
}

/************************************************************************************
/* functionSignature: getParseTs (ts)                                               *
/* Parses a timestamp string to milliseconds or null.                               *
/************************************************************************************/
function getParseTs(ts) {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/************************************************************************************
/* functionSignature: getFmtDelta (ms)                                              *
/* Formats a duration in ms as human-readable h/m string.                           *
/************************************************************************************/
function getFmtDelta(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/************************************************************************************
/* functionSignature: getNormalizeGroupsFromArgs (args)                              *
/* Builds normalized keyword groups from args.                                      *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getPartsInWindow (tokens, parts, K)                            *
/* Detects proximity of distinct parts within a token window.                       *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getAnalyzeClusterRows (rows, groups, opts)                    *
/* Computes coverage, hits, and evidence metrics per cluster.                       *
/************************************************************************************/
function getAnalyzeClusterRows(rows, groups, { tokenWindow = DEFAULT_TOKEN_WINDOW, stripCode = false } = {}) {
  const gState = groups.map(() => ({ lvl: 0, partialLines: 0, hadFull: false }));
  let coverage = 0, sumEvidenceLevel = 0, fullformGroups = 0, totalHits = 0, rowsMulti = 0, rowsAny = 0;

  const fullRe = groups.map(g =>
    new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${g.variants.map(getEscRe).join("|")})(?=[^\\p{L}\\p{N}_]|$)`, "iu")
  );

  for (const r of rows) {
    const { content } = getParseRowForText(r, { stripCode });
    const text = String(content || "");
    if (!text) continue;
    const tokens = getTokenize(text);
    let distinctGroupsHere = 0;

    groups.forEach((g, gi) => {
      if (fullRe[gi].test(text)) {
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

/************************************************************************************
/* functionSignature: getBuildClustersFromHits (hitRows, rowsPerCluster)            *
/* Builds fixed-size clusters from hit row numbers per channel.                     *
/************************************************************************************/
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

/************************************************************************************
/* functionSignature: getBuildLikeFlags (contentExpr, tokens)                       *
/* Produces SELECT flag columns and a WHERE-any SQL fragment.                       *
/************************************************************************************/
function getBuildLikeFlags(contentExpr, tokens) {
  const flagExprs = tokens.map(() =>
    `(${contentExpr} LIKE (?) ${ESCAPE_CLAUSE})`
  );
  const selectFlagsSQL = flagExprs.map((e, i) => `${e} AS k${i}`).join(",\n           ");
  const whereAnySQL = flagExprs.length ? flagExprs.join(" OR ") : "FALSE";
  return { selectFlagsSQL, whereAnySQL };
}

/************************************************************************************
/* functionSignature: getInformationInvoke (args, coreData)                         *
/* Executes clustered search and returns snippets with meta.                        *
/************************************************************************************/
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
  if (!channelIds.length) {
    return { error: "ERROR: channel_id missing (wo.channelID / wo.channelIds)" };
  }
  const mainChannelId = primaryChannelId || channelIds[0];

  const groups = getNormalizeGroupsFromArgs(args);
  if (!Array.isArray(groups) || !groups.length) return { error: "ERROR: no keyword_groups or keywords" };

  const giCfg = wo?.toolsconfig?.getInformation || {};
  const rowsPerCluster = Math.max(1, Math.floor(giCfg.cluster_rows ?? DEFAULT_ROWS_PER_CLUSTER));
  const stripCode = giCfg.strip_code === true;
  const padRows = Math.max(0, Math.floor(giCfg.pad_rows ?? DEFAULT_PAD_ROWS));
  const tokenWindow = Math.max(1, Math.floor(giCfg.token_window ?? DEFAULT_TOKEN_WINDOW));
  const maxLogChars = Number.isFinite(giCfg.max_log_chars) ? giCfg.max_log_chars : DEFAULT_MAX_LOG_CHARS;
  const maxOutputLines = Math.max(100, Math.floor(giCfg.max_output_lines ?? DEFAULT_MAX_OUTPUT_LINES));
  const minCoverage = Math.max(0, Math.floor(giCfg.min_coverage ?? DEFAULT_MIN_COVERAGE));
  const eventGapMinutes = Math.max(1, Math.floor(giCfg.event_gap_minutes ?? DEFAULT_EVENT_GAP_MINUTES));
  const EVENT_GAP_MS = eventGapMinutes * 60 * 1000;

  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) {
    return { error: "ERROR: workingObject.db incomplete" };
  }

  const sqlTokens = Array.from(new Set(groups.flatMap(g => g.variants)));
  if (!sqlTokens.length) {
    return { error: "ERROR: no effective tokens (variants)" };
  }

  const { selectFlagsSQL, whereAnySQL } = getBuildLikeFlags(CONTENT_EXPR, sqlTokens);
  const likeParams = sqlTokens.map(k => `%${getEscapeLike(k)}%`);

  const idPlaceholders = channelIds.map(() => "?").join(", ");

  const hitsSQL = `
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
     WHERE (${whereAnySQL})
       AND o.\`role\` <> 'assistant'
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

  const fetchRangeSQL = `
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
     WHERE o.rn BETWEEN ? AND ?
       AND o.\`role\` <> 'assistant'
       AND (o.\`turn_id\` IS NULL OR o.\`turn_id\` NOT IN (SELECT \`turn_id\` FROM answered_turns))
     ORDER BY o.rn ASC
  `.trim();

  try {
    const db = await getPool(wo);
    const maxTimelineToFetch = getMaxTimelineToFetch(wo, giCfg);

    let timelinePerChannel = {};
    try {
      if (maxTimelineToFetch) {
        for (const cid of channelIds) {
          const [tlRowsDesc] = await db.execute(
            `
              SELECT start_idx, end_idx, start_ts, end_ts, summary
                FROM timeline_periods
               WHERE channel_id = ?
               ORDER BY start_idx DESC
               LIMIT ?
            `,
            [cid, maxTimelineToFetch]
          );
          timelinePerChannel[cid] = (tlRowsDesc || [])
            .map(r => ({
              start_idx: Number(r.start_idx),
              end_idx: Number(r.end_idx),
              start_ts: r.start_ts || null,
              end_ts: r.end_ts || null,
              summary: r.summary || ""
            }))
            .reverse();
        }
      } else {
        const [tlRows] = await db.execute(
          `
            SELECT channel_id, start_idx, end_idx, start_ts, end_ts, summary
              FROM timeline_periods
             WHERE channel_id IN (${idPlaceholders})
             ORDER BY channel_id ASC, start_idx ASC
          `,
          channelIds
        );
        timelinePerChannel = {};
        for (const r of tlRows || []) {
          const cid = String(r.channel_id || "");
          if (!timelinePerChannel[cid]) timelinePerChannel[cid] = [];
          timelinePerChannel[cid].push({
            start_idx: Number(r.start_idx),
            end_idx: Number(r.end_idx),
            start_ts: r.start_ts || null,
            end_ts: r.end_ts || null,
            summary: r.summary || ""
          });
        }
      }
    } catch {
      timelinePerChannel = {};
    }

    const timelinePeriods = timelinePerChannel[mainChannelId] || [];

    const hitsParams = [
      ...channelIds,
      ...channelIds,
      ...likeParams,
      ...likeParams
    ];
    const [hitRows] = await db.execute(hitsSQL, hitsParams);
    if (!hitRows?.length) {
      return {
        items: [],
        meta: {
          channel_id: mainChannelId,
          channel_ids: channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rows_per_cluster: rowsPerCluster,
          clusters_considered: 0,
          clusters_selected: 0,
          printed_rows: 0,
          timeline_periods: timelinePeriods,
          timeline_per_channel: timelinePerChannel,
          duration_ms: Date.now() - startedAt,
          note:
            "Returned snippets are detail information. Each item is tied to a specific channel_id. " +
            "You can align each item.rn to the rolling timeline via meta.timeline_per_channel[channel_id] " +
            "(rn ∈ [start_idx..end_idx])."
        }
      };
    }

    const clustersAll = getBuildClustersFromHits(hitRows, rowsPerCluster);
    const analyzed = [];

    for (const c of clustersAll) {
      const [rowsInRange] = await db.execute(
        fetchRangeSQL,
        [c.channel_id, c.channel_id, c.start_rn, c.end_rn]
      );
      const metrics = getAnalyzeClusterRows(rowsInRange, groups, { tokenWindow, stripCode });
      let firstTs = null, lastTs = null;
      for (const r of rowsInRange) {
        const t = getParseTs(r.ts);
        if (t == null) continue;
        if (firstTs == null || t < firstTs) firstTs = t;
        if (lastTs == null || t > lastTs) lastTs = t;
      }
      analyzed.push({
        ...c,
        rowsInRangeCount: rowsInRange.length,
        ...metrics,
        firstTs,
        lastTs
      });
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
        [c.channel_id, c.channel_id, padStart, padEnd]
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
        if (safe.length > maxLogChars) safe = safe.slice(0, maxLogChars) + "…";

        const t = getParseTs(r.ts);
        if (t != null) {
          if (firstTs == null || t < firstTs) firstTs = t;
          if (lastTs == null || t > lastTs) lastTs = t;
        }

        lines.push({
          channel_id: r.id,
          rn: r.rn,
          ts: r.ts,
          sender,
          content: safe
        });
      }

      if (usedLines + lines.length > maxOutputLines) {
        const remaining = Math.max(0, maxOutputLines - usedLines);
        if (remaining > 0) {
          blocks.push({
            channel_id: c.channel_id,
            start_rn: c.start_rn,
            idx: c.idx,
            lines: lines.slice(0, remaining),
            firstTs,
            lastTs
          });
        }
        usedLines = maxOutputLines;
        break;
      } else {
        blocks.push({
          channel_id: c.channel_id,
          start_rn: c.start_rn,
          idx: c.idx,
          lines,
          firstTs,
          lastTs
        });
        usedLines += lines.length;
      }
    }

    if (!blocks.length) {
      return {
        items: [],
        meta: {
          channel_id: mainChannelId,
          channel_ids: channelIds,
          groups: groups.map(g => ({ base: g.base, parts: g.parts })),
          rows_per_cluster: rowsPerCluster,
          clusters_considered: analyzed.length,
          clusters_selected: 0,
          printed_rows: 0,
          timeline_periods: timelinePeriods,
          timeline_per_channel: timelinePerChannel,
          duration_ms: Date.now() - startedAt,
          note:
            "Returned snippets are detail information. Each item is tied to a specific channel_id. " +
            "You can align each item.rn to the rolling timeline via meta.timeline_per_channel[channel_id] " +
            "(rn ∈ [start_idx..end_idx])."
        }
      };
    }

    blocks.sort((a, b) => {
      if (a.channel_id !== b.channel_id) return a.channel_id.localeCompare(b.channel_id);
      return a.start_rn - b.start_rn;
    });

    const allPrinted = [];
    const seenGlobalRN = new Set();

    for (let bi = 0; bi < blocks.length; bi++) {
      const B = blocks[bi];

      for (const L of B.lines) {
        const isHeader = !Number.isInteger(L.rn);
        if (isHeader) {
          allPrinted.push(L);
          continue;
        }
        const key = `${L.channel_id}:${L.rn}`;
        if (seenGlobalRN.has(key)) continue;
        seenGlobalRN.add(key);
        allPrinted.push(L);
      }

      if (bi < blocks.length - 1) {
        const next = blocks[bi + 1];
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

    const compact = allPrinted.map(({ channel_id, rn, ts, sender, content }) => ({
      channel_id,
      rn,
      ts,
      sender,
      content
    }));

    const meta = {
      channel_id: mainChannelId,
      channel_ids: channelIds,
      groups: groups.map(g => ({ base: g.base, parts: g.parts })),
      rows_per_cluster: rowsPerCluster,
      clusters_considered: analyzed.length,
      clusters_selected: blocks.length,
      printed_rows: allPrinted.length,
      timeline_periods: timelinePeriods,
      timeline_per_channel: timelinePerChannel,
      duration_ms: Date.now() - startedAt,
      note:
        "These snippets are DETAIL views from the global rolling timeline over one or multiple channels. " +
        "Each item has a channel_id and rn. To place a snippet on the timeline: " +
        "find meta.timeline_per_channel[channel_id] and then the period whose [start_idx..end_idx] contains rn; " +
        "treat that snippet as belonging to that period."
    };

    return { items: compact, meta };

  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

/************************************************************************************
/* functionSignature: getDefaultExport ()                                          *
/* Returns the tool definition object and invoke function.                         *
/************************************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Use this function to get historical data based on keywords " +
          "Search one or multiple channels (context.id / workingObject.channelID plus optional workingObject.channelIds) " +
          "using fixed-size clusters (400 rows). " +
          "Excludes assistant messages and 'answered' turns (role/turn_id). " +
          "Prefers AI-provided 'keyword_groups' (with 'variants' and optional 'parts'). " +
          "If only 'keywords' are provided, uses FULL FORMS only (no internal splitting). " +
          "Ranking strictly by coverage (number of distinct keyword groups) → frequency (totalHits). " +
          "Output: start with the most relevant cluster(s), then append further relevant info snippets " +
          "until none remain or the output budget is reached. Afterwards, blocks are sorted chronologically " +
          "and per channel. A 'NEW EVENT' separator is emitted only if a large time gap exists between clusters. " +
          "Each returned item includes: channel_id, rn (row number within that channel), ts (timestamp), " +
          "sender (speaker), content (verbatim or lightly code-collapsed). " +
          "Additionally, meta.timeline_per_channel[channel_id] contains a (possibly truncated) rolling timeline " +
          "for each used channel, so the LLM can align detail snippets via rn ∈ [start_idx..end_idx]. " +
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
                  id: { type: ["string", "number"] },
                  base: { type: "string" },
                  variants: { type: "array", items: { type: "string" } },
                  parts: { type: "array", items: { type: "string" } }
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
