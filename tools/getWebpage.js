/**************************************************************/
/* filename: "getWebpage.js"                                        */
/* Version 2.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { fetchWithTimeout } from "../core/fetch.js";
import { getStr, getNum } from "../core/utils.js";

const MODULE_NAME = "getWebpage";


function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}


async function getHttpGet(url, headers = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let res, text;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const ct = String(res?.headers?.get("content-type") || "").toLowerCase();
  return { ok: !!res?.ok, status: res?.status || 0, text: text || "", ct };
}


function getStripBlocks(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
}


function getExtractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}


function getHtmlToText(html) {
  let h = getStripBlocks(html);
  h = h.replace(/<\/(p|div|section|article|header|footer|aside|li|ul|ol|h[1-6]|br|main|nav)>/gi, "\n");
  h = h.replace(/<(br|hr)\s*\/?>/gi, "\n");
  h = h.replace(/<[^>]+>/g, " ");
  const lines = h
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length > 0);
  return lines.join("\n");
}


async function getInvoke(args, coreData) {
  const wo      = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getWebpage || {};

  const url         = getStr(args?.url, "").trim();
  const startOffset = Math.max(0, getNum(args?.start_ctx_id, 0));
  const maxChars    = getClamp(getNum(toolCfg.maxChars, 15000), 1000, 200000);
  const timeoutMs   = getNum(toolCfg.timeoutMs, 30000);
  const ua          = getStr(
    toolCfg.userAgent,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  if (!url) return { ok: false, error: "Missing url" };

  const { ok, status, text: html, ct } = await getHttpGet(
    url,
    { "User-Agent": ua, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    timeoutMs
  );
  if (!ok) return { ok: false, error: `HTTP ${status || 0} while fetching URL`, url };

  const title    = getExtractTitle(html);
  let   pageText = ct.includes("html") ? getHtmlToText(html) : String(html || "");

  const hardMax = getClamp(getNum(toolCfg.maxInputChars, 800000), 1000, 5000000);
  if (pageText.length > hardMax) pageText = pageText.slice(0, hardMax);

  if (!pageText || pageText.length < 30) {
    return { ok: false, error: "No meaningful text extracted from page", url, title };
  }

  const chunk       = pageText.slice(startOffset, startOffset + maxChars);
  const hasMore     = (startOffset + maxChars) < pageText.length;
  const nextCtxId   = hasMore ? startOffset + chunk.length : null;

  return {
    ok:               true,
    count:            1,
    has_more:         hasMore,
    next_start_ctx_id: nextCtxId,
    rows:             [chunk],
    url,
    title,
    content_type:     ct,
    total_characters: pageText.length,
  };
}

export default { name: MODULE_NAME, invoke: getInvoke };
