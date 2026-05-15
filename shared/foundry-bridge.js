/**************************************************************/
/* filename: "foundry-bridge.js"                             */
/* Version 1.0                                               */
/* Purpose: Shared bridge queue between bot tools and        */
/*          external Foundry clients.                        */
/**************************************************************/

import { putItem, getItem, withSerial } from "../core/registry.js";

const REQUEST_PREFIX = "foundry-bridge:req:";
const QUEUE_PREFIX = "foundry-bridge:queue:";

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTrimmed(value) {
  return String(value || "").trim();
}

function getPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getRequestKey(requestId) {
  return `${REQUEST_PREFIX}${getTrimmed(requestId)}`;
}

function getQueueKey(channelKey) {
  return `${QUEUE_PREFIX}${getTrimmed(channelKey)}`;
}

function getQueueIds(channelKey) {
  const stored = getItem(getQueueKey(channelKey));
  return Array.isArray(stored) ? stored.filter(Boolean) : [];
}

function setQueueIds(channelKey, ids) {
  putItem(Array.isArray(ids) ? ids : [], getQueueKey(channelKey));
}

export function getFoundryBridgeConfig(workingObject, flowConfig = {}) {
  const cfg = workingObject?.toolsconfig?.getFoundryBridge || {};
  return {
    channelKey: getTrimmed(cfg.channelKey || workingObject?.channelId),
    responseTimeoutMs: getPositiveInt(cfg.responseTimeoutMs || cfg.timeoutMs, 30000),
    pollIntervalMs: getPositiveInt(cfg.pollIntervalMs, 750),
    claimLeaseMs: getPositiveInt(cfg.claimLeaseMs, 15000),
    apiSecret: getTrimmed(cfg.apiSecret),
    baseUrl: getTrimmed(cfg.baseUrl),
    chatPath: getTrimmed(flowConfig.chatPath || cfg.chatPath || "/foundry-bridge/chat"),
    pollPath: getTrimmed(flowConfig.pollPath || cfg.pollPath || "/foundry-bridge/poll"),
    resultPath: getTrimmed(flowConfig.resultPath || cfg.resultPath || "/foundry-bridge/result"),
    sessionSyncPath: getTrimmed(flowConfig.sessionSyncPath || cfg.sessionSyncPath || "/foundry-bridge/session-sync"),
    roundInputPath: getTrimmed(flowConfig.roundInputPath || cfg.roundInputPath || "/foundry-bridge/round-input"),
    contextImportPath: getTrimmed(flowConfig.contextImportPath || cfg.contextImportPath || "/foundry-bridge/context-import"),
    campaignResetPath: getTrimmed(flowConfig.campaignResetPath || cfg.campaignResetPath || "/foundry-bridge/campaign-reset")
  };
}

export async function enqueueFoundryBridgeRequest(workingObject, action, payload, meta = {}) {
  const cfg = getFoundryBridgeConfig(workingObject);
  const channelKey = getTrimmed(meta.channelKey || payload?.channelKey || cfg.channelKey);
  if (!channelKey) {
    return { ok: false, error: "Missing Foundry bridge channel key." };
  }

  const requestId = `fbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    ok: true,
    requestId,
    channelKey,
    action: getTrimmed(action),
    payload: { ...(payload || {}) },
    status: "pending",
    createdAt: new Date().toISOString(),
    createdAtMs: now(),
    tool: getTrimmed(meta.tool),
    requestContext: meta.requestContext || {}
  };

  delete record.payload.channelKey;

  await withSerial(getQueueKey(channelKey), async () => {
    putItem(record, getRequestKey(requestId));
    const ids = getQueueIds(channelKey);
    ids.push(requestId);
    setQueueIds(channelKey, ids);
  });

  return { ok: true, requestId, channelKey };
}

export async function awaitFoundryBridgeResponse(requestId, timeoutMs = 30000, pollIntervalMs = 750) {
  const started = now();
  const effectiveTimeout = getPositiveInt(timeoutMs, 30000);
  const interval = getPositiveInt(pollIntervalMs, 750);

  while ((now() - started) < effectiveTimeout) {
    const record = getItem(getRequestKey(requestId));
    if (!record) {
      return { ok: false, error: "Foundry bridge request disappeared before completion.", requestId };
    }
    if (record.status === "completed") {
      return {
        requestId,
        channelKey: record.channelKey,
        ...(record.response && typeof record.response === "object" ? record.response : { ok: true, body: record.response })
      };
    }
    await sleep(interval);
  }

  return { ok: false, error: "Timed out waiting for Foundry bridge response.", requestId };
}

export async function claimNextFoundryBridgeRequest(channelKey, leaseMs = 15000) {
  const cleanChannelKey = getTrimmed(channelKey);
  if (!cleanChannelKey) return { ok: false, error: "channelKey is required." };

  return withSerial(getQueueKey(cleanChannelKey), async () => {
    const ids = getQueueIds(cleanChannelKey);
    const remaining = [];
    let claimed = null;
    const leaseUntilMs = now() + getPositiveInt(leaseMs, 15000);

    for (const requestId of ids) {
      const record = getItem(getRequestKey(requestId));
      if (!record) continue;
      if (record.status === "completed") continue;

      const expiredLease = Number(record.leaseUntilMs || 0) > 0 && Number(record.leaseUntilMs || 0) <= now();
      const claimable = !claimed && (record.status === "pending" || expiredLease);

      if (claimable) {
        record.status = "claimed";
        record.claimedAt = new Date().toISOString();
        record.claimedAtMs = now();
        record.leaseUntilMs = leaseUntilMs;
        record.leaseUntil = new Date(leaseUntilMs).toISOString();
        putItem(record, getRequestKey(requestId));
        claimed = {
          requestId: record.requestId,
          channelKey: record.channelKey,
          action: record.action,
          payload: record.payload,
          tool: record.tool,
          requestContext: record.requestContext,
          createdAt: record.createdAt,
          leaseUntil: record.leaseUntil
        };
      }

      remaining.push(requestId);
    }

    setQueueIds(cleanChannelKey, remaining);
    return claimed ? { ok: true, request: claimed } : { ok: true, request: null };
  });
}

export async function completeFoundryBridgeRequest(channelKey, requestId, response) {
  const cleanChannelKey = getTrimmed(channelKey);
  const cleanRequestId = getTrimmed(requestId);
  if (!cleanChannelKey || !cleanRequestId) {
    return { ok: false, error: "channelKey and requestId are required." };
  }

  return withSerial(getQueueKey(cleanChannelKey), async () => {
    const record = getItem(getRequestKey(cleanRequestId));
    if (!record) return { ok: false, error: "Unknown requestId." };
    if (getTrimmed(record.channelKey) !== cleanChannelKey) {
      return { ok: false, error: "channelKey mismatch." };
    }

    record.status = "completed";
    record.completedAt = new Date().toISOString();
    record.completedAtMs = now();
    record.response = response;
    putItem(record, getRequestKey(cleanRequestId));

    const ids = getQueueIds(cleanChannelKey).filter((id) => id !== cleanRequestId);
    setQueueIds(cleanChannelKey, ids);

    return { ok: true, requestId: cleanRequestId, channelKey: cleanChannelKey };
  });
}
