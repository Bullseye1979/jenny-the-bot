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

const MODULE_NAME = "getOrchestrator";


function getSpecialistToolName(cfg) {
  return String(cfg?.specialistToolName || "getSpecialists").trim() || "getSpecialists";
}

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

function getWorkingObjectPatch(wo) {
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
  return Object.keys(patch).length > 0 ? patch : undefined;
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};
  const specialistToolName = getSpecialistToolName(cfg);

  const prompt       = String(args?.prompt || "").trim();
  const approvedPlan = String(args?.approvedPlan || args?.plan || "").trim();
  const type         = String(args?.type || cfg.defaultType || "generic").trim();
  const mode         = String(args?.mode || cfg.defaultMode || "execute").trim().toLowerCase();

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

  const finalPrompt = mode === "plan"
    ? [
        "PLAN MODE ONLY.",
        "Do not execute anything.",
        `Do not call ${specialistToolName}.`,
        "Return only the plan that should later be approved by the user.",
        "Output must begin with 'PLAN:' and include a 'TODO:' section exactly as shown.",
        "Do not add any extra explanation, commentary, or apology.",
        "Format the plan as a TODO list.",
        "Each line should start with 'TODO:' followed by the task description.",
        "Group related tasks on the same line if they can be executed in parallel.",
        "Separate sequential tasks on different lines.",
        "",
        "USER REQUEST:",
        prompt
      ].join("\n")
    : approvedPlan
      ? [
          "EXECUTION MODE.",
          "The user has approved the following plan.",
          "Execute this approved plan now.",
          "Do not ask for approval again.",
          "Parse the APPROVED PLAN to identify the TODO list.",
          "Execute each TODO item in order:",
          `  - For lines with multiple comma-separated tasks, run them in parallel using ${specialistToolName}.`,
          `  - For lines with a single task, run it sequentially using ${specialistToolName}.`,
          `  - Wait for each ${specialistToolName} call to complete before proceeding to the next TODO item.`,
          `  - After each ${specialistToolName} call, use the returned results to construct prompts for subsequent TODO items.`,
          "  - Ensure each specialist prompt is self-contained and includes all necessary input data.",
          `You must call ${specialistToolName} for each TODO item. Do not skip any.`,
          "",
          "APPROVED PLAN:",
          approvedPlan,
          "",
          "ORIGINAL REQUEST:",
          prompt
        ].join("\n")
      : prompt;

  const apiBase      = String(cfg.apiUrl || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret || "").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const timeoutMs = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;

  const callerChannelId  = String(wo.callerChannelId || wo.channelId || "");
  const callerChannelIds = Array.isArray(wo.channelIds) ? wo.channelIds.filter(Boolean) : [];
  const parentDepth      = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const statusKey        = String(wo.toolStatusChannelOverride || "").trim();
  const statusScope      = String(wo.toolcallScope || wo.callerFlow || wo.flow || "").trim();
  const workingObjectPatch = getWorkingObjectPatch(wo);
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
