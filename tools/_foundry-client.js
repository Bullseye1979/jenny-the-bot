import {
  getFoundryBridgeConfig,
  enqueueFoundryBridgeRequest,
  awaitFoundryBridgeResponse
} from "../shared/foundry-bridge.js";

function getTrimmed(value) {
  return String(value || "").trim();
}

export async function invokeFoundryTool(moduleName, action, args, coreData) {
  const wo = coreData?.workingObject || {};
  const cfg = getFoundryBridgeConfig(wo);
  const channelKey = getTrimmed(args?.channelKey || cfg.channelKey);
  if (!channelKey) {
    return { ok: false, error: "Missing Foundry channel key. Set toolsconfig.getFoundryBridge.channelKey or pass channelKey." };
  }

  const payload = { ...(args || {}) };
  delete payload.channelKey;
  const queued = await enqueueFoundryBridgeRequest(wo, action, payload, {
    tool: moduleName,
    channelKey,
    requestContext: {
      channelId: getTrimmed(wo?.channelId),
      userId: getTrimmed(wo?.userId),
      userName: getTrimmed(wo?.userName || wo?.username || wo?.authorName)
    }
  });
  if (!queued.ok) return queued;

  const response = await awaitFoundryBridgeResponse(
    queued.requestId,
    cfg.responseTimeoutMs,
    cfg.pollIntervalMs
  );

  return {
    action,
    channelKey,
    requestId: queued.requestId,
    ...response
  };
}
