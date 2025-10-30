/***************************************************************
/* filename: "getHistory.js"                                   *
/* Version 1.0                                                 *
/* Purpose: Build a chronological timeline from DB rows via    *
/*          GPT using toolsconfig.gethistory with STRICT       *
/*          channel isolation via wo.channelID only.           *
/***************************************************************/

/***************************************************************
/*                                                             *
/***************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getHistory";
const POOLS = new Map();

/***************************************************************
/* functionSignature: getPool (wo)                             *
/* Returns or creates a MySQL pool keyed by DSN parts.         *
/**************************************************************/
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
/* functionSignature: getToISO (ts)                            *
/* Converts SQL DATETIME/string to ISO 8601 string.            *
/**************************************************************/
function getToISO(ts) {
  return ts ? new Date(String(ts).replace(" ", "T") + "Z").toISOString() : "";
}

/***************************************************************
/* functionSignature: getParseRow (row)                        *
/* Extracts sender, timestamp (ISO), and content from a row.   *
/**************************************************************/
function getParseRow(row) {
  let sender = "";
  let content = "";
  try {
    const j = typeof row.json === "string" ? JSON.parse(row.json) : (row.json || {});
    sender = String(j.authorName || j.role || j.userId || "unknown").trim();
    content = String(j.content || row.text || "").trim();
  } catch {
    sender = "unknown";
    content = String(row.text || "").trim();
  }
  return { sender, timestamp: getToISO(row.ts), content };
}

/***************************************************************
/* functionSignature: getCheapCompressRows (rows)              *
/* Produces a compact, readable digest of rows.                *
/**************************************************************/
function getCheapCompressRows(rows) {
  const out = [];
  let lastSender = null;
  const isNoise = (c) => {
    const s = c.trim().toLowerCase();
    return s.length === 0 || s.length <= 2 || s === "ok" || s === "kk" || s === "thx" || s === "thanks" || s === "lol" || s === "+1";
  };
  for (const r of rows) {
    let c = String(r.content || "").trim();
    if (isNoise(c)) continue;
    c = c.replace(/```[\s\S]*?```/g, (m) => {
      const lines = m.split("\n").length;
      return lines > 30 ? `«code ${lines} lines»` : m;
    });
    c = c.replace(/\bhttps?:\/\/[^\s)]+/g, (u) => {
      try {
        const { host, pathname } = new URL(u);
        return `${host}${pathname}`.replace(/\/+$/, "");
      } catch { return u; }
    });
    const sender = String(r.sender || "unknown").trim();
    const ts = r.timestamp ? r.timestamp.slice(5, 16).replace("T", " ") : "";
    const segment = `[${ts}] ${sender}: ${c}`;
    if (sender === lastSender && out.length) {
      out[out.length - 1] += `; ${c}`;
    } else {
      out.push(segment);
      lastSender = sender;
    }
  }
  return out.join("\n");
}

/***************************************************************
/* functionSignature: getApproxTokensFromChars (n)             *
/* Approximates token count from character length.             *
/**************************************************************/
function getApproxTokensFromChars(n) {
  return Math.ceil(n / 4);
}

/***************************************************************
/* functionSignature: getLoadRowsFromDB (pool, channelId, start, end) *
/* Loads rows for a channel within an optional timeframe.      *
/**************************************************************/
async function getLoadRowsFromDB(pool, channelId, start, end) {
  const where = ["id = ?"];
  const vals = [channelId];
  if (start) { where.push("ts >= ?"); vals.push(start); }
  if (end)   { where.push("ts <= ?"); vals.push(end); }
  const sql =
    `SELECT ts, id, json, text
       FROM context
      WHERE ${where.join(" AND ")}
   ORDER BY ts ASC`;
  const [rows] = await pool.execute(sql, vals);
  return (rows || []).map(getParseRow);
}

/***************************************************************
/* functionSignature: getOpenAICompletion (cfg, systemText, userPrompt, digest, maxTokens) *
/* Calls the LLM and returns trimmed text output.              *
/**************************************************************/
async function getOpenAICompletion(cfg, systemText, userPrompt, digest, maxTokens) {
  const endpoint = String(cfg?.endpoint || "").trim();
  const apiKey = String(cfg?.apikey || "").trim();
  const model = String(cfg?.model || "").trim();
  const tokenLimit = Number.isFinite(Number(cfg?.tokenlimit)) ? Number(cfg.tokenlimit) : 128000;
  const temperature = 0.2;
  const timeoutMs = 180000;

  if (!endpoint || !apiKey || !model) return "ERROR: toolsconfig.gethistory missing endpoint/apikey/model";

  const approxInputTokens = getApproxTokensFromChars((systemText + userPrompt + digest).length);
  const safetyMaxTokens = Math.max(256, Math.min(maxTokens || tokenLimit / 4, tokenLimit - approxInputTokens - 512));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const messages = [
    { role: "system", content: systemText },
    { role: "user", content: userPrompt },
    { role: "user", content: digest }
  ];

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: safetyMaxTokens
      }),
      signal: controller.signal
    });
    const raw = await res.text();
    if (!res.ok) return `ERROR: HTTP ${res.status} ${res.statusText} ${raw.slice(0, 300)}`;
    const data = JSON.parse(raw);
    const text = data?.choices?.[0]?.message?.content ?? "";
    return String(text || "").trim() || "No answer possible.";
  } catch (e) {
    return `ERROR: ${e?.message || String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

/***************************************************************
/* functionSignature: getHistoryInvoke (args, coreData)        *
/* Tool entry: builds a timeline for the current channel only. *
/**************************************************************/
async function getHistoryInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const channelId = String(wo?.channelID || "");
  if (!channelId) return "ERROR: channel_id missing (wo.channelID)";

  const start = args?.start ? String(args.start).trim() : null;
  const end = args?.end ? String(args.end).trim() : null;
  const userPrompt = String(
    args?.user_prompt ||
    "Create a detailed chronological timeline of the events strictly in order. For each step, include timestamp, sender, and a concise paraphrase of the content. Do not group by themes; keep the original order. Include concrete numbers, URLs, message ids if present, and mark action items. Do not invent facts."
  ).trim();

  if (!wo?.db || !wo.db.host || !wo.db.user || !wo.db.database) return "ERROR: workingObject.db incomplete";
  const gh = wo?.toolsconfig?.gethistory || {};
  if (!gh?.endpoint || !gh?.apikey || !gh?.model) return "ERROR: workingObject.toolsconfig.gethistory incomplete";

  const pool = await getPool(wo);
  const rows = await getLoadRowsFromDB(pool, channelId, start, end);
  if (!rows.length) return "No data in timeframe.";

  const digest = getCheapCompressRows(rows);
  const tokenLimit = Number.isFinite(Number(gh?.tokenlimit)) ? Number(gh.tokenlimit) : 128000;
  const hardCap = Math.max(10000, tokenLimit * 4);

  let finalDigest = digest;
  if (finalDigest.length > hardCap) {
    finalDigest = finalDigest.slice(0, hardCap) + "\n…(truncated)…";
  }

  const systemText = [
    "You receive compressed logs from a single channel within a specified timeframe.",
    "Return a DETAILED CHRONOLOGICAL TIMELINE only. Do not cluster by themes.",
    "Format as a numbered list in ascending time. Each item: [ISO time] sender — concise paraphrase; include concrete facts, numbers, and URLs if present.",
    "Flag action items or decisions inline with (ACTION) or (DECISION). Do not invent content."
  ].join(" ");

  const out = await getOpenAICompletion(
    { endpoint: gh.endpoint, apikey: gh.apikey, model: gh.model, tokenlimit: gh.tokenlimit },
    systemText,
    userPrompt,
    finalDigest,
    gh.max_output_tokens
  );

  return out;
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Provides the default export object for the tool.            *
/**************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Build a chronological timeline **for the current channel only** from messages within a **known timeframe**. " +
          "ALWAYS call this tool when the user provides or requests a specific timeframe for the channel history " +
          "(e.g., 'from 2025-10-01 to 2025-10-15', 'yesterday 10:00–12:00'). " +
          "NEVER use this when the timeframe is unknown—use a keyword search tool instead.",
        parameters: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start timestamp (ISO or SQL DATETIME)" },
            end: { type: "string", description: "End timestamp (ISO or SQL DATETIME)" },
            user_prompt: { type: "string", description: "Optional instruction to steer the timeline" }
          },
          required: ["start", "end"],
          additionalProperties: false
        }
      }
    },
    invoke: getHistoryInvoke
  };
}

export default getDefaultExport();
