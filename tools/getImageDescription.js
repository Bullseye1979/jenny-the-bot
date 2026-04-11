/**************************************************************/
/* filename: "getImageDescription.js"                               */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/






import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";

const MODULE_NAME = "getImageDescription";

function getIsValidImageUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//.test(url) ? url : "";
}

function getStrictConfig(workingObject) {
  const toolCfg = workingObject?.toolsconfig?.[MODULE_NAME];
  if (!toolCfg || typeof toolCfg !== "object") throw new Error(`[${MODULE_NAME}] missing toolsconfig.${MODULE_NAME}`);

  const channelId = String(toolCfg.channelId || "").trim();
  const apiUrl = String(toolCfg.apiUrl || "http://localhost:3400").replace(/\/+$/, "");
  const apiSecret = String(toolCfg.apiSecret || "").trim();
  const timeoutMs = Number.isFinite(Number(toolCfg.timeoutMs)) ? Number(toolCfg.timeoutMs) : 30000;

  if (!channelId) throw new Error(`[${MODULE_NAME}] missing channelId`);
  return { channelId, apiUrl, apiSecret, timeoutMs, toolCfg };
}

async function getInvoke(args, coreData) {
  const workingObject = coreData?.workingObject || {};
  const imageUrl = getIsValidImageUrl(args?.imageUrl);
  if (!imageUrl) return { ok: false, error: `[${MODULE_NAME}] Missing or invalid imageUrl (must be http/https).` };

  try {
    const { channelId, apiUrl, apiSecret, timeoutMs, toolCfg } = getStrictConfig(workingObject);
    const bearer = apiSecret ? await getSecret(workingObject, apiSecret) : "";

    const systemPrompt = String(toolCfg.systemPrompt || "").trim();
    const userPrompt = String(args?.prompt || "").trim();
    const instruction = userPrompt || String(toolCfg.defaultPrompt || "").trim();
    if (!instruction) {
      return { ok: false, error: `[${MODULE_NAME}] missing toolsconfig.${MODULE_NAME}.defaultPrompt or args.prompt` };
    }

    const payloadParts = [systemPrompt, `Image URL: ${imageUrl}`, `Task: ${instruction}`].filter(Boolean);
    const headers = { "Content-Type": "application/json" };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;

    const res = await fetchWithTimeout(`${apiUrl}/api`, {
      method: "POST",
      headers,
      body: JSON.stringify({ channelId, payload: payloadParts.join("\n\n"), doNotWriteToContext: true })
    }, timeoutMs);

    const data = await res.json().catch(() => ({}));
    const description = String(data?.response || "").trim();
    if (!res.ok || !data?.ok || !description) {
      return { ok: false, error: `[${MODULE_NAME}] internal API request failed`, detail: String(data?.error || "") };
    }

    return {
      ok: true,
      input: { imageUrl, prompt: instruction },
      description
    };
  } catch (error) {
    return { ok: false, error: `[${MODULE_NAME}] ${error?.message || String(error)}` };
  }
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
