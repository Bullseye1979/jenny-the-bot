/**********************************************************************************/
/* filename: getSubAgent.js                                                        *
/* Version 1.0                                                                     *
/* Purpose: Spawns an isolated AI subagent by routing a task through the bot's    *
/*          internal API flow. Each subagent type maps to a dedicated channel      *
/*          configured with its own tool palette and system prompt.                *
/*                                                                                 *
/*          Orchestration context: callers may pass an `orchestration` object to   *
/*          give the subagent explicit scope, tool locks, and artifact hand-offs.  *
/*          This prevents subagents from re-doing work assigned to others and      *
/*          eliminates duplicate side effects (double image generation, etc.).     *
/*                                                                                 *
/* Config (toolsconfig.getSubAgent):                                               *
/*   apiUrl      - Internal API base URL (default: http://localhost:3400)          *
/*   apiSecret   - Bearer token key name for internal API auth (resolved via DB)   *
/*   timeoutMs   - Max wait time in ms for subagent response (default: 120000)     *
/*   types       - Map of type name to channelID, e.g.:                           *
/*                 { "research": "subagent-research", "generate": "subagent-generate" } *
/*                                                                                 *
/* Orchestration context schema (orchestration parameter):                         *
/*   global_goal        - The overall user request this subagent is part of       *
/*   your_task          - Exact deliverable this subagent must produce            *
/*   your_role          - Role label for this subagent (e.g. "image generation")  *
/*   do_only            - Array of strings: what this subagent is allowed to do   *
/*   do_not             - Array of strings: explicit prohibitions                 *
/*   existing_artifacts - Map of artifact type → URL/value already produced       *
/*   assigned_to_others - Array of task descriptions handled by other subagents   *
/*   tool_locks         - Map of tool name → reason string (must not be called)   *
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
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const task            = String(args?.task    || "").trim();
  const typeName        = String(args?.type    || "research").trim();
  const explicitChannel = String(args?.channel_id || "").trim();
  const orchestration   = args?.orchestration ?? null;

  if (!task) return { ok: false, error: "task is required" };
  if (wo.aborted) return { ok: false, error: "Pipeline aborted — parent context disconnected" };

  const maxSpawnDepth = Number.isFinite(Number(cfg.maxSpawnDepth)) ? Number(cfg.maxSpawnDepth) : 2;
  const agentDepth    = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const agentType     = String(wo.agentType || "").trim();

  if (agentDepth >= maxSpawnDepth) {
    return { ok: false, error: `Spawn depth limit reached (depth=${agentDepth}, max=${maxSpawnDepth}). This agent may not spawn further subagents.` };
  }
  if (agentType && agentType === typeName) {
    return { ok: false, error: `A subagent of type "${typeName}" may not spawn another subagent of the same type.` };
  }

  const types     = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const channelId = explicitChannel || String(types[typeName] || types["research"] || "").trim();

  if (!channelId) {
    return {
      ok: false,
      error: `No channel configured for subagent type "${typeName}". Set toolsconfig.getSubAgent.types.${typeName} in core.json.`
    };
  }

  const apiUrl       = String(cfg.apiUrl || wo.apiBaseUrl || "http://localhost:3400") + "/api";
  const apiSecretKey = String(cfg.apiSecret || "").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";
  const timeoutMs    = Math.max(5000, Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 120000);

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

  const body = JSON.stringify({
    channelID:           channelId,
    payload:             fullPayload,
    userId:              String(wo.userId || ""),
    guildId:             String(wo.guildId || ""),
    doNotWriteToContext: true,
    callerChannelId:     callerChannelId || undefined,
    callerChannelIds:    callerChannelIds.length ? callerChannelIds : undefined,
    callerTurnId:        callerTurnId || undefined,
    agentDepth:          agentDepth + 1,
    agentType:           typeName
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res  = await fetch(apiUrl, { method: "POST", headers, body, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `HTTP ${res.status}`,
        type: typeName,
        channel_id: channelId
      };
    }

    const result = String(data.response || "").trim();
    if (!result || result === "[Empty AI response]") return { ok: false, error: "Subagent returned empty response", type: typeName, channel_id: channelId };

    const _primaryUrl = typeof data.primaryImageUrl === "string" && data.primaryImageUrl ? data.primaryImageUrl : null;
    if (_primaryUrl) wo.primaryImageUrl = _primaryUrl;

    const toolCallLog = Array.isArray(data.toolCallLog) ? data.toolCallLog : undefined;

    if (toolCallLog && toolCallLog.length) {
      const rows = toolCallLog.map(e => {
        const icon = e.status === "success" ? "✅" : (e.status === "failed" ? "❌" : "⚠️");
        const ms   = e.duration_ms >= 1000 ? `${(e.duration_ms / 1000).toFixed(1)}s` : `${e.duration_ms}ms`;
        const task = e.task ? ` — ${e.task}` : "";
        return `${icon} **${e.tool}** (${ms})${task}`;
      });
      const block = `**${typeName} subtask log:**\n` + rows.join("\n");
      if (!Array.isArray(wo._pendingSubtaskLogs)) wo._pendingSubtaskLogs = [];
      wo._pendingSubtaskLogs.push(block);
    }

    const _resultWithPrimary = _primaryUrl && !result.includes(_primaryUrl)
      ? `PRIMARY_RESULT: ${_primaryUrl}\n\n${result}`
      : result;

    return { ok: true, type: typeName, channel_id: channelId, result: _resultWithPrimary };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? `Subagent timed out after ${timeoutMs}ms` : (e?.message || String(e)),
      type: typeName,
      channel_id: channelId
    };
  } finally {
    clearTimeout(timer);
  }
}


export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
