/**********************************************************************************/
/* filename: getGoogle.js                                                          *
/* Version 1.0                                                                     *
/* Purpose: Perform Google Custom Search via toolsconfig and expose results        *
/*          as a function toolcall.                                                *
/**********************************************************************************/

import fetch from "node-fetch";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "getGoogle";


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


async function getHttpJson(url, params, timeoutMs = 20000) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let res, raw, data;
  try {
    res = await fetch(u.toString(), { signal: controller.signal });
    raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = null; }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || "HTTP error";
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  if (data === null) throw new Error("Invalid JSON response");
  return data;
}


function getNormalizeItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it) => ({
    title: getStr(it?.title, "Untitled"),
    snippet: getStr(it?.snippet, ""),
    link: getStr(it?.link, ""),
    displayLink: getStr(it?.displayLink, ""),
    mime: getStr(it?.mime, ""),
  })).filter(r => r.link);
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getGoogle || {};
  const apiKey = await getSecret(wo, getStr(toolCfg.apiKey, "")) || null;
  const cseId  = await getSecret(wo, getStr(toolCfg.cseId, "")) || null;

  if (!apiKey) return { ok: false, error: "Missing toolsconfig.getGoogle.apiKey" };
  if (!cseId)  return { ok: false, error: "Missing toolsconfig.getGoogle.cseId" };

  const query = getStr(args?.query, "").trim();
  if (!query) return { ok: false, error: "Missing query" };

  const numReq = getClamp(getNum(args?.num, getNum(toolCfg.num, 5)), 1, 10);
  const safe   = getStr(args?.safe, getStr(toolCfg.safe, "off"));
  const hl     = getStr(args?.hl,   getStr(toolCfg.hl,   ""));
  const lr     = getStr(args?.lr,   getStr(toolCfg.lr,   ""));
  const cr     = getStr(args?.cr,   getStr(toolCfg.cr,   ""));
  const gl     = getStr(args?.gl,   getStr(toolCfg.gl,   ""));
  const timeoutMs = getNum(toolCfg.timeoutMs, 20000);

  const params = {
    key: apiKey,
    cx: cseId,
    q: query,
    num: numReq,
    safe,
    hl,
    lr,
    cr,
    gl
  };

  let data;
  try {
    data = await getHttpJson("https://www.googleapis.com/customsearch/v1", params, timeoutMs);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  const items = getNormalizeItems(data?.items);
  if (!items.length) {
    return { ok: false, error: "No relevant search results found", query, total: 0, items: [] };
  }

  return {
    ok: true,
    query,
    total: items.length,
    searchInformation: {
      formattedSearchTime: getStr(data?.searchInformation?.formattedSearchTime, ""),
      formattedTotalResults: getStr(data?.searchInformation?.formattedTotalResults, "")
    },
    items
  };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Search the web using Google. Always use this toolcall when asked for current news, situations, events or information. A query has to be provided.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text." },
          num:   { type: "integer", minimum: 1, maximum: 10, description: "Number of results to return (default from toolsconfig, max 10)." },
          safe:  { type: "string", description: "Safe search level: off, active, or high (optional)." },
          hl:    { type: "string", description: "UI language hint, e.g., de, en (optional)." },
          lr:    { type: "string", description: "Language restrict, e.g., lang_de (optional)." },
          cr:    { type: "string", description: "Country restrict, e.g., countryDE (optional)." },
          gl:    { type: "string", description: "Geolocation, e.g., de (optional)." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
