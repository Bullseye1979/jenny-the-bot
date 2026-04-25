/**************************************************************/
/* filename: "getTavily.js"                                         */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/







import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getStr, getNum } from "../core/utils.js";

const MODULE_NAME = "getTavily";


function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}


async function getHttpPostJson(url, body, headers, timeoutMs = 20000) {
  let res, raw, data;
  res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  }, Math.max(1, timeoutMs));
  raw = await res.text();
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.message || data?.detail || res.statusText || "HTTP error";
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  if (data === null) throw new Error("Invalid JSON response");
  return data;
}


function getNormalizeResults(results) {
  const list = Array.isArray(results) ? results : [];
  return list.map((r) => ({
    title:   getStr(r?.title, "Untitled"),
    url:     getStr(r?.url, ""),
    content: getStr(r?.content, ""),
    score:   Number.isFinite(r?.score) ? r.score : 0
  })).filter(r => r.url);
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getTavily || {};
  const apiKey = await getSecret(wo, getStr(toolCfg.apiKey, "")) || null;

  if (!apiKey) return { ok: false, error: "Missing toolsconfig.getTavily.apiKey" };

  const query = getStr(args?.query, "").trim();
  if (!query) return { ok: false, error: "Missing query" };

  const searchDepth   = getStr(args?.searchDepth, getStr(toolCfg.searchDepth, "basic"));
  const maxResults    = getClamp(getNum(args?.maxResults, getNum(toolCfg.maxResults, 5)), 1, 20);
  const topic         = getStr(args?.topic, getStr(toolCfg.topic, "general"));
  const timeRange     = getStr(args?.timeRange, "") || null;
  const includeAnswer = args?.includeAnswer ?? toolCfg.includeAnswer ?? false;
  const timeoutMs     = getNum(toolCfg.timeoutMs, 20000);

  const includeDomains = Array.isArray(toolCfg.includeDomains) && toolCfg.includeDomains.length
    ? toolCfg.includeDomains : null;
  const excludeDomains = Array.isArray(toolCfg.excludeDomains) && toolCfg.excludeDomains.length
    ? toolCfg.excludeDomains : null;
  const country = getStr(toolCfg.country, "") || null;

  const body = {
    query,
    search_depth:   searchDepth,
    max_results:    maxResults,
    topic,
    include_answer: includeAnswer,
    ...(timeRange      && { time_range:      timeRange }),
    ...(includeDomains && { include_domains: includeDomains }),
    ...(excludeDomains && { exclude_domains: excludeDomains }),
    ...(country        && { country })
  };

  let data;
  try {
    data = await getHttpPostJson(
      "https://api.tavily.com/search",
      body,
      { "Authorization": `Bearer ${apiKey}` },
      timeoutMs
    );
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  const rows = getNormalizeResults(data?.results);
  if (!rows.length) {
    return { ok: false, error: "No relevant search results found", query, count: 0, has_more: false, next_start_ctx_id: null, rows: [] };
  }

  return {
    ok: true,
    count: rows.length,
    has_more: false,
    next_start_ctx_id: null,
    rows,
    query,
    ...(data?.answer && { answer: data.answer }),
    responseTime: data?.response_time ?? null
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
