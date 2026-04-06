/**********************************************************************************/
/* filename: getAgentResume.js                                                     *
/* Version 1.0                                                                     *
/* Purpose: Resumes an async subagent project by spawning a new job on the same   *
/*          channel. The subagent picks up its previous context automatically      *
/*          (stored under the channel ID from the prior run), so artifacts do not  *
/*          need to be passed back — the context already contains them.            *
/*                                                                                 *
/* Config: uses toolsconfig.getSubAgent (shared config — apiUrl, apiSecret, types) *
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "getAgentResume";


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.["getSubAgent"] || {};

  const projectId = String(args?.projectId || "").trim();
  const task      = String(args?.task      || "").trim();

  if (!projectId) return { ok: false, error: "projectId is required" };
  if (!task)      return { ok: false, error: "task is required" };
  if (wo.aborted) return { ok: false, error: "Pipeline aborted — parent context disconnected" };

  const _projectEntry = getItem("project:" + projectId);

  if (!_projectEntry) {
    return { ok: false, error: `No project found for projectId "${projectId}". It may not exist or may not have been started with the async system.` };
  }

  const agentType = String(_projectEntry.agentType || "");
  const types     = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const channelId = String(types[agentType] || "").trim();

  if (!channelId) {
    return { ok: false, error: `Cannot determine channel for agentType "${agentType}" in projectId "${projectId}". Check toolsconfig.getSubAgent.types.` };
  }

  const _apiBase      = String(cfg.apiUrl || wo.apiBaseUrl || "http://localhost:3400");
  const spawnUrl      = _apiBase + String(cfg.asyncSpawnPath || "/api/spawn");
  const apiSecretKey  = String(cfg.apiSecret || "").trim();
  const apiSecret     = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";
  const spawnTimeout  = Math.max(5000, Number.isFinite(Number(cfg.spawnTimeoutMs)) ? Number(cfg.spawnTimeoutMs) : 10000);

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const callerChannelId  = String(wo.callerChannelId || wo.channelID || "").trim();
  const callerChannelIds = Array.isArray(wo.channelIds)
    ? wo.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];
  const callerTurnId = String(wo.callerTurnId || wo.turn_id || "").trim();

  const spawnBody = JSON.stringify({
    channelID:           channelId,
    payload:             task,
    userId:              String(wo.userId || ""),
    guildId:             String(wo.guildId || ""),
    authorDisplayname:   String(wo.authorDisplayname || ""),
    projectId,
    callerChannelId:  callerChannelId || undefined,
    callerChannelIds: callerChannelIds.length ? callerChannelIds : undefined,
    callerTurnId:     callerTurnId || undefined,
    callerFlow:       String(wo.flow || ""),
    agentDepth:       (Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0) + 1,
    agentType,
  });

  try {
    const res  = await fetchWithTimeout(spawnUrl, { method: "POST", headers, body: spawnBody }, spawnTimeout);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}`, projectId, channel_id: channelId };
    }

    log(`Agent resumed — project: ${projectId}, new job: ${data.jobId}`);

    return {
      ok:         true,
      jobId:      data.jobId,
      projectId,
      status:     "started",
      message:    "Resuming project — result will be delivered when complete.",
      agentType,
      channel_id: channelId,
    };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? "Spawn request timed out" : (e?.message || String(e)),
      projectId,
      channel_id: channelId,
    };
  }
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
