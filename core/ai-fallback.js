/**************************************************************/
/* filename: "ai-fallback.js"                                */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper. Probes the primary   */
/*          AI endpoint and applies fallbackOverrides when   */
/*          it is unreachable.                               */
/**************************************************************/

import net from "node:net";

const PROBE_CACHE_TTL_MS = 5000;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const probeCache = new Map();

function getNow() {
  return Date.now();
}

function getObject(value, fallback = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function getNonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getProbeKey(endpoint) {
  return getNonEmptyString(endpoint);
}

function getProbeTimeoutMs(wo) {
  const n = Number(wo?.endpointProbeTimeoutMs);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PROBE_TIMEOUT_MS;
}

function getEndpointHostPort(endpoint) {
  try {
    const url = new URL(getNonEmptyString(endpoint));
    if (!/^https?:$/i.test(url.protocol)) return null;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!url.hostname || !Number.isFinite(port) || port <= 0) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

async function probeEndpointPort(endpoint, timeoutMs) {
  const hp = getEndpointHostPort(endpoint);
  if (!hp) return { ok: false, reason: "invalid-endpoint" };
  return await new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, reason, host: hp.host, port: hp.port });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "connect-ok"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (err) => finish(false, err?.code || err?.message || "connect-error"));
    try {
      socket.connect(hp.port, hp.host);
    } catch (err) {
      finish(false, err?.code || err?.message || "connect-error");
    }
  });
}

async function getProbeResult(endpoint, timeoutMs) {
  const key = getProbeKey(endpoint);
  if (!key) return { ok: false, reason: "missing-endpoint" };
  const cached = probeCache.get(key);
  const now = getNow();
  if (cached && cached.expiresAt > now) return cached.result;
  let result = await probeEndpointPort(endpoint, timeoutMs);
  if (!result.ok && String(result.reason || "") === "timeout") {
    result = await probeEndpointPort(endpoint, timeoutMs);
  }
  probeCache.set(key, { result, expiresAt: now + PROBE_CACHE_TTL_MS });
  return result;
}

export async function applyAiFallbackOverrides(workingObject, { log, moduleName = "core-ai", endpoint } = {}) {
  const wo = getObject(workingObject, {}) || {};
  if (wo.__aiFallbackResolved === true) return wo;

  const fallbackOverrides = getObject(wo.fallbackOverrides, null);
  if (!fallbackOverrides || !Object.keys(fallbackOverrides).length) {
    wo.__aiFallbackResolved = true;
    wo.__aiFallbackApplied = false;
    return wo;
  }

  const useModule = getNonEmptyString(wo?.useAiModule).toLowerCase();
  const targetEndpoint = useModule === "responses"
    ? (getNonEmptyString(wo.endpointResponses) || getNonEmptyString(wo.endpoint) || getNonEmptyString(endpoint))
    : (getNonEmptyString(wo.endpoint) || getNonEmptyString(wo.endpointResponses) || getNonEmptyString(endpoint));
  if (!targetEndpoint) {
    wo.__aiFallbackResolved = true;
    wo.__aiFallbackApplied = false;
    return wo;
  }

  const probe = await getProbeResult(targetEndpoint, getProbeTimeoutMs(wo));
  if (probe.ok) {
    wo.__aiFallbackResolved = true;
    wo.__aiFallbackApplied = false;
    wo.__aiProbeReason = probe.reason;
    return wo;
  }

  const fallbackEndpoint =
    getNonEmptyString(fallbackOverrides.endpoint) ||
    getNonEmptyString(fallbackOverrides.endpointResponses);
  if (!fallbackEndpoint) {
    wo.__aiFallbackResolved = true;
    wo.__aiFallbackApplied = false;
    wo.__aiProbeReason = probe.reason;
    if (typeof log === "function") {
      log(`[${moduleName}] endpoint unreachable (${probe.reason}); no fallbackOverrides endpoint configured`, "warn");
    }
    return wo;
  }

  const merged = {
    ...wo,
    ...fallbackOverrides,
    fallbackOverrides
  };
  merged.__aiFallbackResolved = true;
  merged.__aiFallbackApplied = true;
  merged.__aiProbeReason = probe.reason;
  merged.__aiPrimaryEndpoint = targetEndpoint;

  if (typeof log === "function") {
    log(`[${moduleName}] endpoint unreachable (${probe.reason}); applying fallbackOverrides`, "warn");
  }
  return merged;
}
