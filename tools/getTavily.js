/**********************************************************************************/
/* filename: getTavily.js                                                          *
/* Version 1.0                                                                     *
/* Purpose: Perform web search via Tavily Search API and expose results            *
/*          as a function toolcall.                                                *
/**********************************************************************************/

import fetch from "node-fetch";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "getTavily";


function getStr(value, fallback) {
  return typeof value === "string" && value.length ? value : fallback;
}


function getNum(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}


function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}


async function getHttpPostJson(url, body, headers, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let res, raw, data;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = null; }
  } finally {
    clearTimeout(timer);
  }
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

  const results = getNormalizeResults(data?.results);
  if (!results.length) {
    return { ok: false, error: "No relevant search results found", query, total: 0, results: [] };
  }

  return {
    ok: true,
    query,
    total: results.length,
    ...(data?.answer && { answer: data.answer }),
    responseTime: data?.response_time ?? null,
    results
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
