/**************************************************************/
/* filename: "_foundry-specialist-client.js"                 */
/* Version 1.0                                               */
/* Purpose: Shared helper for Foundry specialist channels.   */
/**************************************************************/

import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";

function getTrimmed(value) {
  return String(value || "").trim();
}

function getSlug(value) {
  return getTrimmed(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "foundry";
}

function getBridgeCfg(wo) {
  return wo?.toolsconfig?.getFoundryBridge || {};
}

function getApiUrl(wo) {
  return getTrimmed(getBridgeCfg(wo)?.apiUrl || "http://localhost:3400");
}

function getApiSecretAlias(wo) {
  return getTrimmed(getBridgeCfg(wo)?.apiSecret || wo?.apiSecret || "API_SECRET");
}

export function getFoundrySpecialistChannel(baseChannelId, kind) {
  return `subagent-foundry-${kind}-${getSlug(baseChannelId)}`;
}

export async function invokeFoundrySpecialist(kind, args, coreData, defaults = {}) {
  const wo = coreData?.workingObject || {};
  const prompt = getTrimmed(args?.prompt || args?.query || defaults.prompt || "");
  if (!prompt) return { ok: false, error: "prompt is required." };

  const baseChannelId = getTrimmed(args?.channelId || getBridgeCfg(wo)?.channelKey || wo?.channelId);
  if (!baseChannelId) return { ok: false, error: "Foundry channelId is required." };

  const apiUrl = getApiUrl(wo);
  const apiSecretAlias = getApiSecretAlias(wo);
  const apiSecret = apiSecretAlias ? await getSecret(wo, apiSecretAlias) : "";
  if (!apiSecret) return { ok: false, error: "Foundry API secret could not be resolved." };

  const targetChannelId = getFoundrySpecialistChannel(baseChannelId, kind);
  const payload = {
    channelId: targetChannelId,
    payload: prompt,
    userId: getTrimmed(wo?.userId || "foundry-specialist"),
    callerChannelId: getTrimmed(wo?.channelId || baseChannelId),
    callerFlow: getTrimmed(wo?.flow || ""),
    doNotWriteToContext: defaults.doNotWriteToContext === true,
    workingObjectPatch: {
      bypassTriggerGate: true
    }
  };

  const res = await fetchWithTimeout(`${apiUrl.replace(/\/+$/, "")}/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiSecret}`
    },
    body: JSON.stringify(payload)
  }, Number(defaults.timeoutMs || 300000));

  const raw = await res.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Foundry specialist call failed: HTTP ${res.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
    };
  }

  return {
    ok: true,
    channelId: targetChannelId,
    turnId: parsed?.turnId || null,
    response: getTrimmed(parsed?.response || ""),
    raw: parsed
  };
}
