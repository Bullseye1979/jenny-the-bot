/**************************************************************/
/* filename: "getSubAgent.js"                                       */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/





























import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getItem, listKeys } from "../core/registry.js";
import { logSubagent } from "../core/subagent-logger.js";

const MODULE_NAME = "getSubAgent";

function getExtractHttpUrls(text) {
  const raw = String(text || "");
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const urls = [];
  for (const entry of matches) {
    const value = String(entry || "").trim().replace(/[),.;!?]+$/g, "");
    if (!value || urls.includes(value)) continue;
    urls.push(value);
  }
  return urls;
}

function getAppendSourceUrls(task, callerPayload) {
  const taskText = String(task || "").trim();
  const taskUrls = getExtractHttpUrls(taskText);
  const callerUrls = getExtractHttpUrls(callerPayload);
  const missingUrls = callerUrls.filter((url) => !taskUrls.includes(url));
  if (!missingUrls.length) return taskText;
  const sourceBlock = ["[SOURCE URLS]", ...missingUrls.map((url) => `- ${url}`), "[/SOURCE URLS]"].join("\n");
  return taskText ? `${taskText}\n\n${sourceBlock}` : sourceBlock;
}


function buildOrchestrationBlock(orchestration, turnId) {
  const lines = ["[ORCHESTRATION CONTEXT]"];

  if (turnId) lines.push(`turnId: ${turnId}`);

  const o = typeof orchestration === "string"
    ? (() => { try { return JSON.parse(orchestration); } catch { return null; } })()
    : (orchestration && typeof orchestration === "object" ? orchestration : null);

  if (!o) {
    lines.push("[/ORCHESTRATION CONTEXT]");
    return lines.join("\n");
  }

  if (typeof o.globalGoal === "string" && o.globalGoal.trim()) lines.push(`globalGoal: "${o.globalGoal}"`);
  if (typeof o.yourTask === "string" && o.yourTask.trim()) lines.push(`yourTask: "${o.yourTask}"`);
  if (typeof o.yourRole === "string" && o.yourRole.trim()) lines.push(`yourRole: ${o.yourRole}`);

  const doOnly = Array.isArray(o.doOnly) ? o.doOnly : null;
  if (Array.isArray(doOnly) && doOnly.length) {
    lines.push("doOnly:");
    for (const item of doOnly) lines.push(`  - ${item}`);
  }

  const doNot = Array.isArray(o.doNot) ? o.doNot : null;
  if (Array.isArray(doNot) && doNot.length) {
    lines.push("doNot:");
    for (const item of doNot) lines.push(`  - ${item}`);
  }

  const existingArtifacts = o.existingArtifacts && typeof o.existingArtifacts === "object"
    ? o.existingArtifacts
    : null;
  if (existingArtifacts) {
    const entries = Object.entries(existingArtifacts);
    if (entries.length) {
      lines.push("existingArtifacts:");
      for (const [k, v] of entries) lines.push(`  ${k}: ${v}`);
    }
  }

  const assignedToOthers = Array.isArray(o.assignedToOthers) ? o.assignedToOthers : null;
  if (Array.isArray(assignedToOthers) && assignedToOthers.length) {
    lines.push("assignedToOthers (DO NOT redo these):");
    for (const item of assignedToOthers) lines.push(`  - ${item}`);
  }

  const toolLocks = o.toolLocks && typeof o.toolLocks === "object"
    ? o.toolLocks
    : null;
  if (toolLocks) {
    const locks = Object.entries(toolLocks);
    if (locks.length) {
      lines.push("toolLocks (MUST NOT call these tools):");
      for (const [tool, reason] of locks) lines.push(`  ${tool}: ${reason}`);
    }
  }

  lines.push("[/ORCHESTRATION CONTEXT]");
  return lines.join("\n");
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const task      = String(args?.task || wo.payload || "").trim();
  const modeRaw = String(args?.mode || "normal").trim().toLowerCase();
  const mode = modeRaw === "resume" ? "resume" : "normal";
  const inputProjectId = args?.projectId ? String(args.projectId).trim() : "";
  const projectId = mode === "resume" ? inputProjectId : "";
  const explicitChannel = String(args?.channelId || "").trim();
  const orchestration   = args?.orchestration ?? null;
  const includeCallerContext = args?.includeCallerContext === true;
  const requestedType = String(args?.type || "").trim();
  let typeName = requestedType || "generic";

  const _invokeCallerChannelId = String(wo.callerChannelId || wo.channelId || "").trim();
  logSubagent("info", "getSubAgent", "invoke_called", {
    mode,
    typeName,
    requestedType:       requestedType || null,
    projectId:           projectId || null,
    inputProjectId:      inputProjectId || null,
    callerChannelId:     _invokeCallerChannelId || null,
    callerFlow:          String(wo.callerFlow || wo.flow || "") || null,
    callerContextChanId: String(wo.contextChannelId || "") || null,
    agentDepth:          Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0,
    agentType:           String(wo.agentType || "") || null,
    taskLen:             task.length,
    hasOrchestration:    orchestration !== null,
    includeCallerContext,
  });

  if (!task) {
    logSubagent("warn", "getSubAgent", "invoke_rejected", { reason: "task_empty" });
    return { ok: false, error: "task is required" };
  }
  if (wo.aborted) {
    logSubagent("warn", "getSubAgent", "invoke_rejected", { reason: "pipeline_aborted", callerChannelId: _invokeCallerChannelId });
    return { ok: false, error: "Pipeline aborted — parent context disconnected" };
  }

  const _apiBase     = String(cfg.apiUrl || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret || "").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const callerChannelId  = String(wo.callerChannelId || wo.channelId || "").trim();
  const callerChannelIds = [
    callerChannelId,
    ...(Array.isArray(wo.callerChannelIds) ? wo.callerChannelIds : []),
    ...(Array.isArray(wo.channelIds) && !wo.callerChannelId ? wo.channelIds : [])
  ].map(c => String(c || "").trim()).filter((value, index, arr) => value && arr.indexOf(value) === index);
  const callerTurnId = String(wo.callerTurnId || wo.turnId || "").trim();
  const contextSourceChannelId = String(wo.callerContextChannelId || callerChannelId || "").trim();
  const contextSourceChannelIds = callerChannelIds.slice();

  const callerPayloadRaw = String(wo.payload || "").trim();
  let fullPayload = getAppendSourceUrls(task, callerPayloadRaw);
  if (orchestration !== null && orchestration !== undefined) {
    const block = buildOrchestrationBlock(orchestration, callerTurnId);
    fullPayload = `${block}\n\n[YOUR TASK]\n${fullPayload}\n[/YOUR TASK]`;
  }

  const types      = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const agentDepth = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const agentType  = String(wo.agentType || "").trim();
  const nextAgentDepth = mode === "resume" ? agentDepth : (agentDepth + 1);

  if (modeRaw !== "normal" && modeRaw !== "resume") {
    logSubagent("warn", "getSubAgent", "invalid_mode", { modeRaw });
    return { ok: false, error: "Invalid mode. Use mode='normal' or mode='resume'." };
  }

  if (mode === "resume") {
    if (!projectId) {
      return { ok: false, error: "projectId is required when mode='resume'" };
    }
    if (!requestedType) {
      return { ok: false, error: "type is required when mode='resume' so the caller can choose the target subagent." };
    }
    typeName = requestedType;
  }

  const maxSpawnDepth = Number.isFinite(Number(cfg.maxSpawnDepth)) ? Number(cfg.maxSpawnDepth) : 2;

  if (mode !== "resume" && agentDepth >= maxSpawnDepth) {
    logSubagent("warn", "getSubAgent", "depth_limit_reached", { agentDepth, maxSpawnDepth, typeName });
    return { ok: false, error: `Spawn depth limit reached (depth=${agentDepth}, max=${maxSpawnDepth}). This agent may not spawn further subagents.` };
  }
  if (mode !== "resume" && agentType && agentType === typeName) {
    logSubagent("warn", "getSubAgent", "same_type_blocked", {
      typeName,
      agentType,
      projectId: projectId || null,
      callerTurnId: callerTurnId || null
    });

    return { ok: false, error: `A subagent of type "${typeName}" may not spawn another subagent of the same type.` };
  }

  const channelId = explicitChannel || String(types[typeName] || types["generic"] || "").trim();

  if (!channelId) {
    logSubagent("error", "getSubAgent", "no_channel_configured", { typeName });
    return {
      ok: false,
      error: `No channel configured for subagent type "${typeName}". Set toolsconfig.getSubAgent.types.${typeName} in core.json.`
    };
  }

  if (projectId) {
    const _spawnJobKeys = listKeys("job:");
    for (const _spawnKey of _spawnJobKeys) {
      const _spawnJob = getItem(_spawnKey);
      if (_spawnJob?.projectId === projectId && _spawnJob?.status === "running") {
        logSubagent("warn", "getSubAgent", "project_already_running", { projectId, runningJobId: _spawnJob.jobId, typeName });
        return {
          ok: false,
          error: `You are already running inside project ${projectId} (job: ${_spawnJob.jobId}). Do not spawn additional subagents for this project — the full project context is already loaded in your conversation. Work with what you have and return your result directly.`
        };
      }
    }
  }

  const spawnUrl = _apiBase + String(cfg.asyncSpawnPath || "/api/spawn");
  const _parentContextChannelId = String(wo.callerContextChannelId || wo.contextChannelId || "").trim();

  logSubagent("info", "getSubAgent", "spawn_sending", {
    typeName,
    channelId,
    projectId:              projectId || null,
    resume:                 mode === "resume",
    mode,
    callerChannelId:        callerChannelId || null,
    callerFlow:             String(wo.callerFlow || wo.flow || "") || null,
    callerContextChannelId: _parentContextChannelId || null,
    agentDepth:             nextAgentDepth,
    includeCallerContext,
  });

  const projectContextPromptTemplate = typeof cfg.projectContextPrompt === "string" ? cfg.projectContextPrompt.trim() : "";
  const systemPromptAddition = projectId && projectContextPromptTemplate
    ? projectContextPromptTemplate.replace(/\$\{projectId\}/g, projectId)
    : undefined;

  const _spawnBody = JSON.stringify({
    channelId,
    payload:                fullPayload,
    userId:                 String(wo.userId || ""),
    guildId:                String(wo.guildId || ""),
    authorDisplayname:      String(wo.authorDisplayname || ""),
    projectId:              mode === "resume" ? projectId : undefined,
    systemPromptAddition,
    callerChannelId:        callerChannelId || undefined,
    callerChannelIds:       callerChannelIds.length ? callerChannelIds : undefined,
    callerTurnId:           callerTurnId || undefined,
    callerFlow:             String(wo.callerFlow || wo.flow || ""),
    callerContextChannelId: _parentContextChannelId || undefined,
    includeCallerContext:   includeCallerContext || undefined,
    contextSourceChannelId: includeCallerContext ? (contextSourceChannelId || undefined) : undefined,
    contextSourceChannelIds: includeCallerContext && contextSourceChannelIds.length
      ? contextSourceChannelIds
      : undefined,
    callerPayload:          callerPayloadRaw ? callerPayloadRaw.slice(0, 4000) : undefined,
    agentDepth:             nextAgentDepth,
    agentType:              typeName,
  });

  try {
    const _spawnTimeoutMs = Math.max(5000, Number.isFinite(Number(cfg.spawnTimeoutMs)) ? Number(cfg.spawnTimeoutMs) : 10000);
    const _spawnRes  = await fetchWithTimeout(spawnUrl, { method: "POST", headers, body: _spawnBody }, _spawnTimeoutMs);
    const _spawnData = await _spawnRes.json().catch(() => ({}));

    if (!_spawnRes.ok || !_spawnData.ok) {
      const _spawnErr = _spawnData.error || `HTTP ${_spawnRes.status}`;
      logSubagent("error", "getSubAgent", "spawn_http_error", { typeName, channelId, projectId: projectId || null, error: _spawnErr, httpStatus: _spawnRes.status });
      return { ok: false, error: _spawnErr, type: typeName, channelId };
    }

    log(`Subagent spawned — job: ${_spawnData.jobId}, project: ${_spawnData.projectId}`);
    logSubagent("info", "getSubAgent", "spawn_ok", {
      typeName,
      channelId,
      jobId:     _spawnData.jobId,
      projectId: _spawnData.projectId,
    });

    return {
      ok:        true,
      jobId:     _spawnData.jobId,
      projectId: _spawnData.projectId,
      status:    "started",
      message:   "Working on it — result will be delivered when complete.",
      type:      typeName,
      channelId,
      _meta: {
        event: "subagent_started",
        visibility: "internal"
      }
    };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    logSubagent("error", "getSubAgent", "spawn_exception", {
      typeName, channelId, projectId: projectId || null,
      error: isAbort ? "timeout" : (e?.message || String(e)),
      isTimeout: isAbort,
    });
    return {
      ok:    false,
      error: isAbort ? "Spawn request timed out" : (e?.message || String(e)),
      type:  typeName,
      channelId,
    };
  }
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
