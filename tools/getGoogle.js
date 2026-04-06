






import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

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
  const res = await fetchWithTimeout(u.toString(), {}, timeoutMs);
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
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
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
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
  invoke: getInvoke
};
