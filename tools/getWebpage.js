/********************************************************************************
/* filename: "getWebpage.js"                                                    *
/* Version 1.0                                                                  *
/* Purpose: Fetch a webpage, extract readable text, and answer a user_prompt    *
/*          via OpenAI (tool: "getWebpage").                                    *
/********************************************************************************/
/*                                                                              */
/********************************************************************************/

import fetch from "node-fetch";

const MODULE_NAME = "getWebpage";

/********************************************************************************
/* functionSignature: getStr (value, fallback)                                  *
/* Returns a non-empty string or the provided default                           *
/********************************************************************************/
function getStr(value, fallback) {
  return typeof value === "string" && value.length ? value : fallback;
}

/********************************************************************************
/* functionSignature: getNum (value, fallback)                                  *
/* Returns a finite number or the provided default                              *
/********************************************************************************/
function getNum(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

/********************************************************************************
/* functionSignature: getClamp (n, min, max)                                    *
/* Clamps a number into [min, max]                                              *
/********************************************************************************/
function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}

/********************************************************************************
/* functionSignature: getHttpGet (url, headers, timeoutMs)                      *
/* Performs a GET request and returns { ok, status, text, ct }                  *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getStripBlocks (html)                                     *
/* Removes script/style/noscript/etc. blocks from HTML                          *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getExtractTitle (html)                                    *
/* Extracts the <title> content if present                                      *
/********************************************************************************/
function getExtractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/********************************************************************************
/* functionSignature: getHtmlToText (html)                                      *
/* Linearizes HTML into plain text with basic block handling                    *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getBuildMessages (userPrompt, title, url, text)           *
/* Builds OpenAI chat messages for grounded answering                           *
/********************************************************************************/
function getBuildMessages(userPrompt, title, url, text) {
  const pageHeader = [
    title ? `Title: ${title}` : "",
    url ? `URL: ${url}` : ""
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: "You are a precise web analyst. Answer strictly from the provided page text. If the answer isn't present, say so clearly." },
    { role: "user", content: `User request: "${userPrompt}"` },
    { role: "user", content: pageHeader ? pageHeader + "\n\n" + text : text }
  ];
}

/********************************************************************************
/* functionSignature: getInvoke (args, coreData)                                *
/* Fetches URL, extracts text, and summarizes with OpenAI                       *
/********************************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getWebpage || {};

  const url = getStr(args?.url, "").trim();
  const user_prompt = getStr(args?.user_prompt, "").trim();
  if (!url) return { ok: false, error: "Missing url" };
  if (!user_prompt) return { ok: false, error: "Missing user_prompt" };

  const timeoutMs = getNum(toolCfg.timeoutMs, 30000);
  const ua = getStr(
    toolCfg.user_agent,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  const { ok, status, text: html, ct } = await getHttpGet(
    url,
    { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    timeoutMs
  );
  if (!ok) return { ok: false, error: `HTTP ${status || 0} while fetching URL`, url };

  const title = getExtractTitle(html);
  let pageText = ct.includes("html") ? getHtmlToText(html) : String(html || "");
  const maxChars = getClamp(getNum(toolCfg.maxInputChars, 240000), 1000, 800000);
  if (pageText.length > maxChars) pageText = pageText.slice(0, maxChars);

  if (!pageText || pageText.length < 30) {
    return { ok: false, error: "No meaningful text extracted from page", url, title };
  }

  const endpoint = getStr(wo.Endpoint, "https://api.openai.com/v1/chat/completions");
  const apiKey = getStr(wo.APIKey, "");
  if (!apiKey) return { ok: false, error: "Missing OpenAI API key in workingObject.APIKey" };

  const model = getStr(toolCfg.model, getStr(wo.Model, "gpt-4o-mini"));
  const temperature = getNum(toolCfg.temperature, 0.1);
  const max_tokens = getClamp(getNum(toolCfg.max_tokens, 1400), 100, 4096);

  const messages = getBuildMessages(user_prompt, title, url, pageText);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getNum(toolCfg.aiTimeoutMs, 45000));
  let res, raw, data;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
      signal: controller.signal
    });
    raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = null; }
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e?.message || String(e) };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, error: `OpenAI HTTP ${res.status} ${res.statusText}`, details: (data && data.error && data.error.message) || null };
  }

  const answer = (data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) {
    return { ok: false, error: "Empty answer from model", model };
  }

  return {
    ok: true,
    url,
    title,
    contentType: ct,
    model,
    characters: pageText.length,
    answer
  };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Fetch a webpage, extract readable text, and answer user_prompt strictly from that page.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute URL to fetch (http/https)." },
          user_prompt: { type: "string", description: "Question/instruction to execute against the page text." }
        },
        required: ["url", "user_prompt"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
