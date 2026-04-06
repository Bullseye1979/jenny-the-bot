/**********************************************************************************/
/* filename: getWebpage.js                                                         *
/* Version 1.0                                                                     *
/* Purpose: Fetch webpages, dump cleaned text or summarize via internal API        *
/*          if long.                                                                *
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";

const MODULE_NAME = "getWebpage";


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
  const h = String(html || "");
  return h
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


function getWordCount(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  return s.split(/\s+/g).length;
}


function getBuildMessages(userPrompt, title, url, text, extraPrompt, systemPrompt) {
  const baseSystem = {
    role: "system",
    content: (systemPrompt && systemPrompt.trim())
      ? systemPrompt.trim()
      : "You are a precise web analyst. Answer strictly from the provided page text. " +
        "If the answer isn't present, say so clearly. Keep chronology and avoid speculation."
  };
  const extraSystem =
    extraPrompt && extraPrompt.trim()
      ? {
          role: "system",
          content:
            "ADDITIONAL INSTRUCTIONS (bias the summary; do not override facts):\n" +
            extraPrompt.trim()
        }
      : null;

  const pageHeader = [title ? `Title: ${title}` : "", url ? `URL: ${url}` : ""]
    .filter(Boolean)
    .join("\n");

  const msgs = [baseSystem];
  if (extraSystem) msgs.push(extraSystem);
  msgs.push({ role: "user", content: `User request: "${userPrompt}"` });
  msgs.push({ role: "user", content: pageHeader ? pageHeader + "\n\n" + text : text });
  return msgs;
}


async function callSummaryApi(text, cfg, wo) {
  const channelId = String(cfg.summaryChannelId || "").trim();
  if (!channelId) return null;
  const apiUrl = String(cfg.summaryApiUrl || "http://localhost:3400").replace(/\/+$/, "") + "/api";
  const secretKey = String(cfg.summaryApiSecret || "").trim();
  const secret = secretKey ? await getSecret(wo, secretKey) : "";
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;
  const timeoutMs = Math.max(5000, Number.isFinite(Number(cfg.summaryTimeoutMs)) ? Number(cfg.summaryTimeoutMs) : 45000);
  try {
    const res = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ channelID: channelId, payload: text, doNotWriteToContext: true })
    }, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const summary = String(data?.response || "").trim();
    return summary || null;
  } catch {
    return null;
  }
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getWebpage || {};

  const url = getStr(args?.url, "").trim();
  const userPrompt = getStr(args?.userPrompt, getStr(args?.user_prompt, "")).trim();
  const prompt = getStr(args?.prompt, "");

  if (!url) return { ok: false, error: "Missing url" };
  if (!userPrompt) return { ok: false, error: "Missing userPrompt" };

  const timeoutMs = getNum(toolCfg.timeoutMs, 30000);
  const ua = getStr(
    toolCfg.userAgent,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  const { ok, status, text: html, ct } = await getHttpGet(
    url,
    { "User-Agent": ua, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    timeoutMs
  );
  if (!ok) return { ok: false, error: `HTTP ${status || 0} while fetching URL`, url };

  const title = getExtractTitle(html);
  let pageText = ct.includes("html") ? getHtmlToText(html) : String(html || "");

  const hardMaxChars = getClamp(getNum(toolCfg.maxInputChars, 240000), 1000, 800000);
  if (pageText.length > hardMaxChars) pageText = pageText.slice(0, hardMaxChars);

  if (!pageText || pageText.length < 30) {
    return { ok: false, error: "No meaningful text extracted from page", url, title };
  }

  const wordThreshold = Math.max(1, getNum(toolCfg.wordThreshold, 1200));
  const wordCount = getWordCount(pageText);

  if (wordCount <= wordThreshold) {
    return {
      ok: true,
      mode: "dump",
      url,
      title,
      contentType: ct,
      words: wordCount,
      characters: pageText.length,
      text: pageText
    };
  }

  const summaryInput = [
    userPrompt ? `User request: "${userPrompt}"` : "",
    title ? `Title: ${title}` : "",
    url ? `URL: ${url}` : "",
    prompt ? `Additional context: ${prompt}` : "",
    pageText
  ].filter(Boolean).join("\n\n");

  const summary = await callSummaryApi(summaryInput, toolCfg, wo);

  if (summary == null) {
    return {
      ok: true,
      mode: "dump",
      url,
      title,
      contentType: ct,
      words: wordCount,
      characters: pageText.length,
      text: pageText
    };
  }

  return {
    ok: true,
    mode: "summary",
    url,
    title,
    contentType: ct,
    words: wordCount,
    characters: pageText.length,
    answer: summary
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
