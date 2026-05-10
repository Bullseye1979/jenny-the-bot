/**************************************************************/
/* filename: "getOrchestrator.js"                            */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/*                                                           */
/* Runs a synchronous orchestrator for complex multi-step    */
/* tasks. Blocks the caller until the orchestrator is done.  */
/* The orchestrator has access to getSpecialists to spawn    */
/* parallel specialist workers.                              */
/**************************************************************/

import { randomBytes }       from "node:crypto";
import { getSecret }         from "../core/secrets.js";
import { fetchWithTimeout }  from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSpecialistDispatcherToolName } from "../core/tool-links.js";

const MODULE_NAME = "getOrchestrator";


function getErrorResult(code, message, details = {}) {
  return {
    ok: false,
    count: 0,
    has_more: false,
    next_start_ctx_id: null,
    rows: [],
    error: String(message || code || "unknown_error"),
    error_status: {
      source: MODULE_NAME,
      code: String(code || "unknown_error"),
      message: String(message || code || "unknown_error")
    },
    ...details
  };
}


function getIsInvalidOrchestratorResponse(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  return s === "[Empty AI response]"
    || s.startsWith("[Max Loops Hit]")
    || s.startsWith("[Max Tool Calls Hit]");
}

function getWorkingObjectPatch(wo, cfg) {
  if (!wo || typeof wo !== "object") return undefined;
  const patch = {};
  if (wo.toolsconfig && typeof wo.toolsconfig === "object") {
    patch.toolsconfig = JSON.parse(JSON.stringify(wo.toolsconfig));
  }
  if (Array.isArray(wo.channelIds)) {
    patch.channelIds = [...wo.channelIds];
  }
  if (Array.isArray(wo.callerChannelIds)) {
    patch.callerChannelIds = [...wo.callerChannelIds];
  }
  if (wo.callerChannelId && typeof wo.callerChannelId === "string") {
    patch.callerChannelId = wo.callerChannelId;
  }
  patch.bypassTriggerGate = true;
  // subAgentOverrides: caller can force model/endpoint on all sub-agents spawned from this channel
  const overrides = cfg?.subAgentOverrides;
  if (overrides && typeof overrides === "object") {
    const allowed = ["model", "endpoint", "endpointResponses", "useAiModule", "apiKey", "maxTokens", "temperature"];
    for (const key of allowed) {
      if (overrides[key] != null) patch[key] = overrides[key];
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function getPromptMatchedType(prompt, cfg) {
  const routes = Array.isArray(cfg?.promptTypeRoutes) ? cfg.promptTypeRoutes : [];
  const haystack = String(prompt || "").trim().toLowerCase();
  if (!haystack) return "";
  for (const route of routes) {
    const type = String(route?.type || "").trim();
    const patterns = Array.isArray(route?.match)
      ? route.match
      : route?.match != null
        ? [route.match]
        : [];
    if (!type || !patterns.length) continue;
    for (const pattern of patterns) {
      const needle = String(pattern || "").trim().toLowerCase();
      if (needle && haystack.includes(needle)) return type;
    }
  }
  return "";
}

function getApplyTemplate(template, values) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values?.[key] || ""));
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};
  const specialistToolName = getSpecialistDispatcherToolName(wo) || "the configured specialist dispatch tool";

  const prompt       = String(args?.prompt || "").trim();
  const approvedPlan = String(args?.approvedPlan || args?.plan || "").trim();
  const requestedType = String(args?.type || "").trim();
  const inferredType  = requestedType ? "" : getPromptMatchedType(prompt, cfg);
  const type          = String(requestedType || inferredType || cfg.defaultType || "generic").trim();
  const requestedMode = String(args?.mode || "").trim().toLowerCase();
  const forcedMode    = String(cfg.forceMode || "").trim().toLowerCase();
  let mode            = String(requestedMode || cfg.defaultMode || "execute").trim().toLowerCase();

  if (inferredType) {
    log(`Orchestrator type inferred from prompt: "${inferredType}"`, "info");
  }

  if (forcedMode === "plan" || forcedMode === "execute") {
    if (requestedMode && requestedMode !== forcedMode) {
      log(`Orchestrator mode override: requested="${requestedMode}" forced="${forcedMode}"`, "warn");
    }
    mode = forcedMode;
  } else if (cfg.allowPlan === false && mode === "plan") {
    log('Orchestrator mode override: requested="plan" but allowPlan=false, using "execute"', "warn");
    mode = "execute";
  }

  if (!prompt) return getErrorResult("prompt_missing", "prompt is required");
  if (mode !== "plan" && mode !== "execute") {
    return getErrorResult("mode_invalid", 'mode must be "plan" or "execute"');
  }

  const types           = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const planTypes       = cfg.planTypes && typeof cfg.planTypes === "object" ? cfg.planTypes : {};
  const routedType      = mode === "plan"
    ? String(planTypes[type] || types[`${type}-plan`] || `${type}-plan`).trim()
    : type;
  const baseChannelId   = String(types[routedType] || "").trim();
  if (!baseChannelId) {
    return getErrorResult(
      "orchestrator_channel_missing",
      `No channel configured for orchestrator type "${routedType}". Configure toolsconfig.getOrchestrator.types.${routedType} in core.json.`
    );
  }

  const channelId = `${baseChannelId}-${randomBytes(6).toString("hex")}`;

  if (wo.aborted) return getErrorResult("pipeline_aborted", "Pipeline aborted");

  const planPromptTemplate = String(cfg?.planPromptTemplate || "").trim();
  const executeApprovedPlanTemplate = String(cfg?.executeApprovedPlanTemplate || "").trim();
  const finalPrompt = mode === "plan"
    ? (planPromptTemplate
      ? getApplyTemplate(planPromptTemplate, { prompt, specialistToolName }).trim()
      : prompt)
    : approvedPlan
      ? (executeApprovedPlanTemplate
        ? getApplyTemplate(executeApprovedPlanTemplate, { prompt, approvedPlan, specialistToolName }).trim()
        : approvedPlan + "\n\n" + prompt)
      : prompt;

  const apiBase      = String(cfg.apiUrl    || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret ?? "API_SECRET").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const timeoutMs = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;

  const callerChannelId  = String(wo.callerChannelId || wo.channelId || "");
  const callerChannelIds = Array.isArray(wo.channelIds) ? wo.channelIds.filter(Boolean) : [];
  const parentDepth      = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const statusKey        = String(wo.toolStatusChannelOverride || "").trim();
  const statusScope      = String(wo.toolcallScope || wo.callerFlow || wo.flow || "").trim();
  const workingObjectPatch = getWorkingObjectPatch(wo, cfg);
  const body = JSON.stringify({
    channelId,
    payload: finalPrompt,
    userId:           String(wo.userId  || ""),
    guildId:          String(wo.guildId || ""),
    callerChannelId,
    callerChannelIds,
    callerTurnId:     String(wo.turnId || wo.callerTurnId || ""),
    callerFlow:       String(wo.flow || ""),
    agentDepth:       parentDepth + 1,
    agentType:        type,
    toolcallScope:    statusScope,
    ...(statusKey ? { toolStatusChannelOverride: statusKey } : {}),
    ...(workingObjectPatch ? { workingObjectPatch } : {}),
  });

  log(`Orchestrator start: mode="${mode}" type="${routedType}" channel="${channelId}"`);

  try {
    const res  = await fetchWithTimeout(apiBase + "/api", { method: "POST", headers, body }, timeoutMs);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const err = data.error || `HTTP ${res.status}`;
      log(`Orchestrator failed: ${err}`, "warn");
      return getErrorResult("orchestrator_http_error", err, {
        error_status: {
          source: MODULE_NAME,
          code: "orchestrator_http_error",
          message: String(err || `HTTP ${res.status}`),
          httpStatus: res.status
        }
      });
    }

    const response = String(data.response || "");
    if (getIsInvalidOrchestratorResponse(response)) {
      const err = response || "Orchestrator returned empty response";
      log(`Orchestrator failed: ${err}`, "warn");
      return getErrorResult("orchestrator_empty_response", err);
    }

    log(`Orchestrator done: mode="${mode}" type="${routedType}" responseLen=${response.length}`);
    return { ok: true, count: 1, has_more: false, next_start_ctx_id: null, rows: [response] };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    log(`Orchestrator error: ${isAbort ? "timeout" : (e?.message || String(e))}`, "error");
    return getErrorResult(isAbort ? "orchestrator_timeout" : "orchestrator_request_error", isAbort ? "Orchestrator timed out" : (e?.message || String(e)));
  }
}

export default { name: MODULE_NAME, invoke: getInvoke };
