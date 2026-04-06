/**********************************************************************************/
/* filename: getImageDescription.js                                                *
/* Version 1.0                                                                     *
/* Purpose: Vision analysis via Chat Completions using one image passed            *
/*          as args.imageURL.                                                      *
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";

const MODULE_NAME = "getImageDescription";

/**********************************************************************************/
/* getStrictConfig (workingObject)                                                 *
/**********************************************************************************/
function getStrictConfig(workingObject) {
  const toolCfg = workingObject?.toolsconfig?.[MODULE_NAME];
  if (!toolCfg || typeof toolCfg !== "object") throw new Error(`[${MODULE_NAME}] missing toolsconfig.${MODULE_NAME}`);
  const apiKey = String(toolCfg.apiKey || "").trim();
  const model = String(toolCfg.model || "").trim();
  const endpoint = String(toolCfg.endpoint || "").trim();
  const temperature = toolCfg.temperature;
  const maxTokens = toolCfg.maxTokens;
  const timeoutMs = toolCfg.timeoutMs;
  if (!apiKey) throw new Error(`[${MODULE_NAME}] missing apiKey`);
  if (!model) throw new Error(`[${MODULE_NAME}] missing model`);
  if (!endpoint) throw new Error(`[${MODULE_NAME}] missing endpoint`);
  if (!Number.isFinite(temperature)) throw new Error(`[${MODULE_NAME}] missing temperature`);
  if (!Number.isFinite(maxTokens)) throw new Error(`[${MODULE_NAME}] missing maxTokens`);
  if (!Number.isFinite(timeoutMs)) throw new Error(`[${MODULE_NAME}] missing timeoutMs`);
  return { apiKey, model, endpoint, temperature, maxTokens, timeoutMs };
}

/**********************************************************************************/
/* getMessages (imageUrl, analysisPrompt)                                          *
/**********************************************************************************/
function getMessages(imageUrl, analysisPrompt, systemPrompt) {
  const sysContent = (systemPrompt && systemPrompt.trim())
    ? systemPrompt.trim()
    : "You are an expert vision analyst. Provide faithful, useful descriptions and extract visible text.";
  return [
    { role: "system", content: sysContent },
    { role: "user", content: [{ type: "text", text: analysisPrompt }, { type: "image_url", image_url: { url: imageUrl } }] }
  ];
}

/**********************************************************************************/
/* getIsAzureOpenAI (endpoint)                                                     *
/**********************************************************************************/
function getIsAzureOpenAI(endpoint) {
  return /azure\.com/i.test(endpoint);
}

/**********************************************************************************/
/* getHeaders (endpoint, apiKey)                                                   *
/**********************************************************************************/
function getHeaders(endpoint, apiKey) {
  if (getIsAzureOpenAI(endpoint)) return { "Content-Type": "application/json", "api-key": apiKey };
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

/**********************************************************************************/
/* getHttpErrorText (status, statusText)                                           *
/**********************************************************************************/
function getHttpErrorText(status, statusText) {
  if (status === 403) return "Image URL forbidden or expired";
  if (status === 404) return "Image URL not found";
  if (status === 400) return "Bad request";
  if (status === 401) return "Unauthorized";
  return `HTTP ${status} ${statusText || ""}`.trim();
}

/**********************************************************************************/
/* validateImageUrl (imageURL)                                                     *
/**********************************************************************************/
function validateImageUrl(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) return null;
  return s;
}

/**********************************************************************************/
/* getInvoke (args, coreData)                                                      *
/**********************************************************************************/
async function getInvoke(args, coreData) {
  const workingObject = coreData?.workingObject || {};
  const { apiKey: rawApiKey, model, endpoint, temperature, maxTokens, timeoutMs } = getStrictConfig(workingObject);
  const apiKey = await getSecret(workingObject, rawApiKey);

  const imageUrl = validateImageUrl(args?.imageURL);
  if (!imageUrl) {
    return { ok: false, error: `[${MODULE_NAME}] Missing or invalid 'imageURL' (must be http/https).` };
  }

  const systemPrompt = String(workingObject?.toolsconfig?.[MODULE_NAME]?.systemPrompt || "").trim();
  const userPrompt = String(args?.prompt ?? "").trim();
  const analysisPrompt =
    userPrompt ||
    "Analyze the image thoroughly. Describe key objects, people, setting, colors, composition, and notable details. Extract any visible text (OCR). Be accurate and concise; avoid speculation.";

  const messages = getMessages(imageUrl, analysisPrompt, systemPrompt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getHeaders(endpoint, apiKey),
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: controller.signal
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: getHttpErrorText(res.status, res.statusText), body: raw?.slice(0, 500) || "" };

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: `[${MODULE_NAME}] Invalid JSON from API`, body: raw?.slice(0, 400) || "" };
    }

    const content = (data?.choices?.[0]?.message?.content || "").trim();
    if (!content) return { ok: false, error: `[${MODULE_NAME}] Empty response from vision model`, model };
    return { ok: true, model, input: { imageURL: imageUrl, prompt: analysisPrompt }, description: content };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    return { ok: false, error: isAbort ? `[${MODULE_NAME}] Request timed out after ${timeoutMs}ms` : `[${MODULE_NAME}] ${e?.message || String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
