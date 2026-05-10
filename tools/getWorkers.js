/**************************************************************/
/* filename: "getWorkers.js"                                  */
/* Version 1.0                                                */
/* Purpose: LLM-callable tool implementation.                 */
/*                                                            */
/* Wraps a single tool call in its own isolated AI context.   */
/* For use within specialist contexts only — derives its      */
/* channel config from the calling specialist automatically.  */
/* Workers always run with contextSize=0 and maxLoops=2.      */
/**************************************************************/

import { randomBytes }       from "node:crypto";
import { getSecret }         from "../core/secrets.js";
import { fetchWithTimeout }  from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getWorkers";

function getErrorResult(code, message, details = {}) {
  return {
    ok: false,
    error: String(message || code || "unknown_error"),
    error_status: {
      source: MODULE_NAME,
      code: String(code || "unknown_error"),
      message: String(message || code || "unknown_error")
    },
    ...details
  };
}

function getIsRetryableWorkerError(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  return text.includes("[empty ai response]")
    || text.includes("[max loops hit]")
    || text.includes("worker timed out")
    || text.includes("aborterror")
    || text.includes("http 502")
    || text.includes("http 503")
    || text.includes("http 504");
}

const CASCADED_OVERRIDE_FIELDS = ["model", "endpoint", "endpointResponses", "useAiModule", "apiKey", "maxTokens", "temperature"];

function getWorkingObjectPatch(wo) {
  const patch = {};
  if (Array.isArray(wo.tools)) {
    patch.tools = wo.tools.filter(toolName => String(toolName || "").trim() !== MODULE_NAME);
  }
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
  for (const key of CASCADED_OVERRIDE_FIELDS) {
    if (wo[key] != null) patch[key] = wo[key];
  }
  return patch;
}

async function getRunSingleWorker({ jobID, prompt }, { wo, cfg, apiBase, apiSecret, timeoutMs, maxRetries, log }) {
  const channelId = `subagent-worker-${randomBytes(6).toString("hex")}`;

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const callerChannelId  = String(wo.channelId || "");
  const callerChannelIds = Array.isArray(wo.channelIds) ? wo.channelIds.filter(Boolean) : [];
  const parentDepth      = Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0;
  const statusKey        = String(wo.toolStatusChannelOverride || "").trim();
  const statusScope      = String(wo.toolcallScope || wo.callerFlow || wo.flow || "").trim();

  const body = JSON.stringify({
    channelId,
    payload: prompt,
    userId:           String(wo.userId  || ""),
    guildId:          String(wo.guildId || ""),
    callerChannelId,
    callerChannelIds,
    callerTurnId:     String(wo.turnId || wo.callerTurnId || ""),
    callerFlow:       String(wo.flow || ""),
    agentDepth:       parentDepth + 1,
    agentType:        "worker",
    toolcallScope:    statusScope,
    ...(statusKey ? { toolStatusChannelOverride: statusKey } : {}),
    workingObjectPatch: getWorkingObjectPatch(wo),
  });

  log(`Worker start: jobID=${jobID ?? "?"} channel="${channelId}"`);

  let lastFailure = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res  = await fetchWithTimeout(apiBase + "/api", { method: "POST", headers, body }, timeoutMs);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        const error = data.error || `HTTP ${res.status}`;
        lastFailure = {
          jobID,
          ok: false,
          error,
          attempts: attempt + 1,
          retryable: getIsRetryableWorkerError(error),
          error_status: {
            source: MODULE_NAME,
            code: "worker_http_error",
            message: String(error || `HTTP ${res.status}`),
            httpStatus: res.status
          }
        };
      } else {
        const responseText = String(data.response || "");
        if (!responseText || responseText.startsWith("[Empty AI response]") || responseText.startsWith("[Max Loops Hit]")) {
          const error = responseText || "Worker returned empty response";
          lastFailure = {
            jobID,
            ok: false,
            error,
            attempts: attempt + 1,
            retryable: getIsRetryableWorkerError(error),
            error_status: {
              source: MODULE_NAME,
              code: "worker_empty_response",
              message: String(error || "Worker returned empty response")
            }
          };
        } else {
          log(`Worker done: jobID=${jobID ?? "?"} responseLen=${responseText.length}`);
          return { jobID, ok: true, response: responseText, attempts: attempt + 1 };
        }
      }
    } catch (e) {
      const isAbort = e?.name === "AbortError";
      const error   = isAbort ? "Worker timed out" : (e?.message || String(e));
      lastFailure = {
        jobID,
        ok: false,
        error,
        attempts: attempt + 1,
        retryable: getIsRetryableWorkerError(error),
        error_status: {
          source: MODULE_NAME,
          code: isAbort ? "worker_timeout" : "worker_request_error",
          message: String(error || "Worker request failed")
        }
      };
    }

    if (!lastFailure?.retryable || attempt >= maxRetries) break;
    log(`Retrying worker jobID=${jobID ?? "?"} after transient failure: ${lastFailure.error}`, "warn");
  }

  return lastFailure || {
    jobID,
    ok: false,
    error: "Worker failed",
    attempts: maxRetries + 1,
    retryable: false,
    error_status: {
      source: MODULE_NAME,
      code: "worker_failed",
      message: "Worker failed"
    }
  };
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const workers = Array.isArray(args?.workers) ? args.workers : null;
  if (!workers) {
    return getErrorResult("workers_missing", "workers array is required");
  }

  if (workers.length === 0) {
    return getErrorResult("workers_empty", "workers array must not be empty");
  }

  const apiBase      = String(cfg.apiUrl || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret ?? "API_SECRET").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";
  const timeoutMs    = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;
  const maxRetries   = Number.isFinite(Number(cfg.maxRetries)) && Number(cfg.maxRetries) >= 0
    ? Math.floor(Number(cfg.maxRetries))
    : 1;
  const maxConcurrent = Number.isFinite(Number(cfg.maxConcurrent)) && Number(cfg.maxConcurrent) >= 1
    ? Math.floor(Number(cfg.maxConcurrent))
    : 3;

  const ctx = { wo, cfg, apiBase, apiSecret, timeoutMs, maxRetries, log };

  const results = [];
  for (let i = 0; i < workers.length; i += maxConcurrent) {
    const batch = workers.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(({ jobID, prompt }) => {
        const p = String(prompt || "").trim();
        if (!p) {
          return Promise.resolve({
            jobID,
            ok: false,
            error: "prompt is required",
            attempts: 0,
            error_status: { source: MODULE_NAME, code: "prompt_missing", message: "prompt is required" }
          });
        }
        return getRunSingleWorker({ jobID, prompt: p }, ctx);
      })
    );
    results.push(...batchResults);
  }

  const nOk = results.filter(r => r.ok).length;
  const allOk = nOk === results.length;
  const failedResults = results.filter(r => !r.ok);
  const failedSummary = failedResults.length > 0
    ? failedResults.map(r => `jobID=${r.jobID ?? "?"}: ${r.error}`).join("; ")
    : null;

  return {
    ok: allOk,
    count: results.length,
    rows: results,
    complete: nOk,
    failed: results.length - nOk,
    ...(failedSummary ? { error: failedSummary, worker_errors: failedResults } : {})
  };
}

export default { name: MODULE_NAME, invoke: getInvoke };
