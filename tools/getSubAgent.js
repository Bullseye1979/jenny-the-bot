/**********************************************************************************/
/* filename: getSubAgent.js                                                        *
/* Version 1.1                                                                     *
/* Purpose: Spawns an isolated AI subagent as a fire-and-forget async job.        *
/*          Always async — result is delivered back to the originating channel     *
/*          when complete. For simple single-step tasks use direct tools instead.  *
/*                                                                                 *
/*          Orchestration context: callers may pass an `orchestration` object to   *
/*          give the subagent explicit scope, tool locks, and artifact hand-offs.  *
/*          This prevents subagents from re-doing work assigned to others and      *
/*          eliminates duplicate side effects (double image generation, etc.).     *
/*                                                                                 *
/* Config (toolsconfig.getSubAgent):                                               *
/*   apiUrl         - Internal API base URL (default: http://localhost:3400)       *
/*   apiSecret      - Bearer token key name for internal API auth (resolved via DB)*
/*   asyncSpawnPath - Path for spawn endpoint (default: /api/spawn)               *
/*   spawnTimeoutMs - Timeout for the spawn HTTP call (default: 10000)            *
/*   types          - Map of type name to channelID, e.g.:                        *
/*                    { "research": "subagent-research", "develop": "subagent-develop" } *
/*                                                                                 *
/* Adding a new subagent type:                                                     *
/*   1. Add an entry to toolsconfig.getSubAgent.types in core.json:               *
/*      "mytool": "subagent-mytool"                                                *
/*   2. Add a channel block in config.core-channel-config.channels:               *
/*      { "channelMatch": ["subagent-mytool"], "overrides": { "tools": [...],     *
/*        "apiEnabled": 1, "apiSecret": "API_SECRET", ... } }                     *
/*   3. No Discord channel is required — the channel name is virtual.             *
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getItem, listKeys } from "../core/registry.js";
import { logSubagent } from "../core/subagent-logger.js";

const MODULE_NAME = "getSubAgent";


function buildOrchestrationBlock(orchestration, turnId) {
  const lines = ["[ORCHESTRATION CONTEXT]"];

  if (turnId) lines.push(`turn_id: ${turnId}`);

  const o = typeof orchestration === "string"
    ? (() => { try { return JSON.parse(orchestration); } catch { return null; } })()
    : (orchestration && typeof orchestration === "object" ? orchestration : null);

  if (!o) {
    lines.push("[/ORCHESTRATION CONTEXT]");
    return lines.join("\n");
  }

  if (o.global_goal)  lines.push(`global_goal: "${o.global_goal}"`);
  if (o.your_task)    lines.push(`your_task: "${o.your_task}"`);
  if (o.your_role)    lines.push(`your_role: ${o.your_role}`);

  if (Array.isArray(o.do_only) && o.do_only.length) {
    lines.push("do_only:");
    for (const item of o.do_only) lines.push(`  - ${item}`);
  }

  if (Array.isArray(o.do_not) && o.do_not.length) {
    lines.push("do_not:");
    for (const item of o.do_not) lines.push(`  - ${item}`);
  }

  if (o.existing_artifacts && typeof o.existing_artifacts === "object") {
    const entries = Object.entries(o.existing_artifacts);
    if (entries.length) {
      lines.push("existing_artifacts:");
      for (const [k, v] of entries) lines.push(`  ${k}: ${v}`);
    }
  }

  if (Array.isArray(o.assigned_to_others) && o.assigned_to_others.length) {
    lines.push("assigned_to_others (DO NOT redo these):");
    for (const item of o.assigned_to_others) lines.push(`  - ${item}`);
  }

  if (o.tool_locks && typeof o.tool_locks === "object") {
    const locks = Object.entries(o.tool_locks);
    if (locks.length) {
      lines.push("tool_locks (MUST NOT call these tools):");
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
  const projectId = args?.projectId ? String(args.projectId).trim() : "";
  const explicitChannel = String(args?.channel_id || "").trim();
  const orchestration   = args?.orchestration ?? null;
  const requestedType = String(args?.type || "").trim();
  const typeName = projectId
    ? "resume"
    : (requestedType || "generic");

  const _invokeCallerChannelId = String(wo.callerChannelId || wo.channelID || "").trim();
  logSubagent("info", "getSubAgent", "invoke_called", {
    typeName,
    requestedType:       requestedType || null,
    projectId:           projectId || null,
    callerChannelId:     _invokeCallerChannelId || null,
    callerFlow:          String(wo.callerFlow || wo.flow || "") || null,
    callerContextChanID: String(wo.contextChannelID || "") || null,
    agentDepth:          Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0,
    agentType:           String(wo.agentType || "") || null,
    taskLen:             task.length,
    hasOrchestration:    orchestration !== null,
  });

  if (!task) {
    logSubagent("warn", "getSubAgent", "invoke_rejected", { reason: "task_empty" });
    return { ok: false, error: "task is required" };
  }
  if (wo.aborted) {
    logSubagent("warn", "getSubAgent", "invoke_rejected", { reason: "pipeline_aborted", callerChannelId: _invokeCallerChannelId });
    return { ok: false, error: "Pipeline aborted — parent context disconnected" };
  }

  const _apiBase     = String(cfg.apiUrl || wo.apiBaseUrl || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret || "").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const callerChannelId  = String(wo.callerChannelId || wo.channelID || "").trim();
  const callerChannelIds = Array.isArray(wo.channelIds)
    ? wo.channelIds.map(c => String(c || "").trim()).filter(Boolean)
    : [];

  const callerTurnId = String(wo.callerTurnId || wo.turn_id || "").trim();

  let fullPayload = task;
  if (orchestration !== null && orchestration !== undefined) {
    const block = buildOrchestrationBlock(orchestration, callerTurnId);
    fullPayload = `${block}\n\n[YOUR TASK]\n${task}\n[/YOUR TASK]`;
  }

  const types      = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const agentDepth = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const agentType  = String(wo.agentType || "").trim();

  if (projectId && !explicitChannel && !types.resume) {
    logSubagent("error", "getSubAgent", "resume_type_missing", { projectId, requestedType: requestedType || null });
    return {
      ok: false,
      error: "Resume routing requires toolsconfig.getSubAgent.types.resume to be configured (or pass channel_id explicitly)."
    };
  }

  const maxSpawnDepth = Number.isFinite(Number(cfg.maxSpawnDepth)) ? Number(cfg.maxSpawnDepth) : 2;

  if (agentDepth >= maxSpawnDepth) {
    logSubagent("warn", "getSubAgent", "depth_limit_reached", { agentDepth, maxSpawnDepth, typeName });
    return { ok: false, error: `Spawn depth limit reached (depth=${agentDepth}, max=${maxSpawnDepth}). This agent may not spawn further subagents.` };
  }
  if (agentType && agentType === typeName) {
    logSubagent("warn", "getSubAgent", "same_type_blocked", { typeName, agentType });
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
  const _parentContextChannelID = String(wo.contextChannelID || "").trim();

  logSubagent("info", "getSubAgent", "spawn_sending", {
    typeName,
    channelId,
    projectId:              projectId || null,
    resume:                 !!projectId,
    callerChannelId:        callerChannelId || null,
    callerFlow:             String(wo.callerFlow || wo.flow || "") || null,
    callerContextChannelID: _parentContextChannelID || null,
    agentDepth:             agentDepth + 1,
  });

  const _levelContextLine = `Execution context: You are running as subagent type "${typeName}" at depth ${agentDepth + 1}. Parent type: "${agentType || "root"}" (depth ${agentDepth}). Resume is level-1 only; never spawn a child with type "resume".`;
  const _resumeContextLine = projectId
    ? `Context: You are operating within project context "project-${projectId}". The full conversation history for this project is loaded into your context above. IMPORTANT: Before asking the user for any URLs, file paths, or artifact references — scan your loaded conversation history first. All previously produced URLs and ARTIFACTS blocks from prior turns are available there. Use them directly. Only ask the user if the information is genuinely absent from your context. You may call tools freely using URLs found in your context. Only spawn a new subagent via getSubAgent for genuinely independent sub-tasks that require a different tool palette.`
    : "";

  const _systemPromptAddition = [_levelContextLine, _resumeContextLine]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const _spawnBody = JSON.stringify({
    channelID:              channelId,
    payload:                fullPayload,
    userId:                 String(wo.userId || ""),
    guildId:                String(wo.guildId || ""),
    authorDisplayname:      String(wo.authorDisplayname || ""),
    projectId:              projectId || undefined,
    systemPromptAddition:   _systemPromptAddition || undefined,
    callerChannelId:        callerChannelId || undefined,
    callerChannelIds:       callerChannelIds.length ? callerChannelIds : undefined,
    callerTurnId:           callerTurnId || undefined,
    callerFlow:             String(wo.callerFlow || wo.flow || ""),
    callerContextChannelID: _parentContextChannelID || undefined,
    callerPayload:          String(wo.payload || "").slice(0, 500) || undefined,
    agentDepth:             agentDepth + 1,
    agentType:              typeName,
  });

  try {
    const _spawnTimeoutMs = Math.max(5000, Number.isFinite(Number(cfg.spawnTimeoutMs)) ? Number(cfg.spawnTimeoutMs) : 10000);
    const _spawnRes  = await fetchWithTimeout(spawnUrl, { method: "POST", headers, body: _spawnBody }, _spawnTimeoutMs);
    const _spawnData = await _spawnRes.json().catch(() => ({}));

    if (!_spawnRes.ok || !_spawnData.ok) {
      const _spawnErr = _spawnData.error || `HTTP ${_spawnRes.status}`;
      logSubagent("error", "getSubAgent", "spawn_http_error", { typeName, channelId, projectId: projectId || null, error: _spawnErr, httpStatus: _spawnRes.status });
      return { ok: false, error: _spawnErr, type: typeName, channel_id: channelId };
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
      channel_id: channelId,
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
      channel_id: channelId,
    };
  }
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
