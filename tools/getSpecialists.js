/**************************************************************/
/* filename: "getSpecialists.js"                             */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/*                                                           */
/* Runs multiple specialist AI workers in parallel.          */
/* Available within orchestrator contexts only.              */
/* All specialists run concurrently and results are returned */
/* when all have completed (synchronous from caller's view). */
/**************************************************************/

import { randomBytes }       from "node:crypto";
import { getSecret }         from "../core/secrets.js";
import { fetchWithTimeout }  from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSpecialistsPaginationState } from "../shared/ai/utils.js";

const MODULE_NAME = "getSpecialists";

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


function getIsRetryableSpecialistError(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  return text.includes("[empty ai response]")
    || text.includes("[max loops hit]")
    || text.includes("specialist timed out")
    || text.includes("aborterror")
    || text.includes("http 502")
    || text.includes("http 503")
    || text.includes("http 504");
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const specialists = Array.isArray(args?.specialists) ? args.specialists : [];
  if (!specialists.length) {
    return getErrorResult("specialists_missing", 'specialists array is required and must not be empty. Example: [{"type":"context-research","jobID":1,"prompt":"start=2025-11-01 end=2025-11-30"}]');
  }

  const allEmpty = specialists.every(s => !String(s?.type || "").trim() && !String(s?.prompt || "").trim());
  if (allEmpty) {
    return getErrorResult(
      "specialists_invalid",
      `All ${specialists.length} specialist entries are missing required fields. Each entry must be an object with: "type" (string, e.g. "context-research"), "jobID" (integer), "prompt" (string with the task). Example: [{"type":"context-research","jobID":1,"prompt":"start=2025-11-01 end=2025-11-30"},{"type":"context-research","jobID":2,"prompt":"start=2025-12-01 end=2025-12-31"}]`
    );
  }

  const types          = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const defaultType    = String(cfg.defaultType || "").trim();
  const apiBase        = String(cfg.apiUrl || "http://localhost:3400");
  const apiSecretKey   = String(cfg.apiSecret || "").trim();
  const apiSecret      = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";
  const timeoutMs      = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;
  const maxConcurrent  = Number.isFinite(Number(cfg.maxConcurrent)) && Number(cfg.maxConcurrent) > 0
    ? Math.floor(Number(cfg.maxConcurrent))
    : 3;
  const maxRetriesPerSpecialist = Number.isFinite(Number(cfg.maxRetriesPerSpecialist)) && Number(cfg.maxRetriesPerSpecialist) >= 0
    ? Math.floor(Number(cfg.maxRetriesPerSpecialist))
    : 1;

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  log(`Launching ${specialists.length} specialist(s) in batches of ${maxConcurrent}`);

  const runSpec = async (spec) => {
    const type   = String(spec?.type || defaultType || "").trim();
    const jobID  = spec?.jobID  ?? null;
    const prompt = String(spec?.prompt || "").trim();

    if (!type || !prompt) {
      const received = JSON.stringify(spec ?? null).slice(0, 300);
      return {
        jobID,
        type: type || "?",
        ok: false,
        error: `type and prompt are required for each specialist. Received: ${received}`,
        error_status: {
          source: MODULE_NAME,
          code: "specialist_input_invalid",
          message: `type and prompt are required for each specialist. Received: ${received}`
        }
      };
    }

    const baseChannelId = String(types[type] || "").trim();
    if (!baseChannelId) {
      return {
        jobID,
        type,
        ok:    false,
        error: `No channel configured for specialist type "${type}". Configure toolsconfig.getSpecialists.types.${type} in core.json.`,
        error_status: {
          source: MODULE_NAME,
          code: "specialist_channel_missing",
          message: `No channel configured for specialist type "${type}". Configure toolsconfig.getSpecialists.types.${type} in core.json.`
        }
      };
    }

    const channelId        = `${baseChannelId}-${randomBytes(6).toString("hex")}`;
    const callerChannelId  = String(wo.callerChannelId || wo.channelId || "");
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
      agentType:        type,
      toolcallScope:    statusScope,
      ...(statusKey ? { toolStatusChannelOverride: statusKey } : {}),
    });

    let lastFailure = null;
    for (let attempt = 0; attempt <= maxRetriesPerSpecialist; attempt++) {
      try {
        const res  = await fetchWithTimeout(apiBase + "/api", { method: "POST", headers, body }, timeoutMs);
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
          const error = data.error || `HTTP ${res.status}`;
          lastFailure = {
            jobID,
            type,
            ok: false,
            error,
            attempts: attempt + 1,
            retryable: getIsRetryableSpecialistError(error),
            error_status: {
              source: MODULE_NAME,
              code: "specialist_http_error",
              message: String(error || `HTTP ${res.status}`),
              httpStatus: res.status
            }
          };
        } else {
          const responseText = String(data.response || "");
          if (!responseText || responseText.startsWith("[Empty AI response]") || responseText.startsWith("[Max Loops Hit]")) {
            const error = responseText || "Specialist returned empty response";
            lastFailure = {
              jobID,
              type,
              ok: false,
              error,
              attempts: attempt + 1,
              retryable: getIsRetryableSpecialistError(error),
              error_status: {
                source: MODULE_NAME,
                code: "specialist_empty_response",
                message: String(error || "Specialist returned empty response")
              }
            };
          } else {
            return { jobID, type, ok: true, response: responseText, attempts: attempt + 1 };
          }
        }
      } catch (e) {
        const isAbort = e?.name === "AbortError";
        const error = isAbort ? "Specialist timed out" : (e?.message || String(e));
        lastFailure = {
          jobID,
          type,
          ok: false,
          error,
          attempts: attempt + 1,
          retryable: getIsRetryableSpecialistError(error),
          error_status: {
            source: MODULE_NAME,
            code: isAbort ? "specialist_timeout" : "specialist_request_error",
            message: String(error || "Specialist request failed")
          }
        };
      }

      if (!lastFailure?.retryable || attempt >= maxRetriesPerSpecialist) break;
      log(`Retrying specialist jobID=${jobID ?? "?"} type="${type}" after transient failure: ${lastFailure.error}`, "warn");
    }

    return lastFailure || {
      jobID,
      type,
      ok: false,
      error: "Specialist failed",
      attempts: maxRetriesPerSpecialist + 1,
      retryable: false,
      error_status: {
        source: MODULE_NAME,
        code: "specialist_failed",
        message: "Specialist failed"
      }
    };
  };

  const results = [];
  for (let i = 0; i < specialists.length; i += maxConcurrent) {
    const batch = specialists.slice(i, i + maxConcurrent);
    log(`Batch ${Math.floor(i / maxConcurrent) + 1}: running specialists ${i + 1}–${i + batch.length}`);
    const batchResults = await Promise.all(batch.map(runSpec));
    results.push(...batchResults);
  }

  const allOk   = results.every(r => r.ok);
  const nOk     = results.filter(r => r.ok).length;
  const failedResults = results.filter(r => !r.ok);

  const failedSummary = allOk
    ? undefined
    : failedResults.map(r => `[${r.type || "?"}] ${r.error}`).join("; ");
  const paginationState = getSpecialistsPaginationState({ rows: results });
  const retryPendingItems = failedResults
    .filter(r => r.retryable !== false)
    .map(r => {
      const original = specialists.find(spec => String(spec?.jobID ?? "") === String(r.jobID ?? "") && String(spec?.type || defaultType || "").trim() === String(r.type || "").trim())
        || specialists.find(spec => String(spec?.jobID ?? "") === String(r.jobID ?? ""));
      return {
        jobID: r.jobID ?? null,
        type: r.type || defaultType || "",
        prompt: String(original?.prompt || "").trim(),
        error: String(r.error || "").trim(),
        attempts: Number.isFinite(Number(r.attempts)) ? Number(r.attempts) : undefined
      };
    })
    .filter(item => item.type && item.prompt);
  const continuationPending = paginationState.pending || retryPendingItems.length > 0;
  const continuationPrompt = paginationState.pending
    ? [
        "The previous getSpecialists result is incomplete.",
        "Do not synthesize or finalize.",
        "Call getSpecialists again only for the still-pending windows.",
        "For each pending window, use prompt format exactly: start=<assignedStart> end=<assignedEnd> startCtxId=<nextPageId>.",
        "Pending windows:",
        ...paginationState.pendingItems.slice(0, 24).map(item =>
          `- jobID=${item.jobID ?? "?"} start=${item.assignedStart || "?"} end=${item.assignedEnd || "?"} nextPageId=${item.nextPageId ?? "?"} status=${item.status || "PARTIAL"}`
        )
      ].join("\n")
    : retryPendingItems.length
      ? [
          "Some specialist workers failed transiently and need to be retried.",
          "Do not synthesize or finalize yet.",
          "Call getSpecialists again only for the failed specialist jobs below, reusing the same type, jobID, and prompt.",
          "Failed specialists:"
        ].concat(
          retryPendingItems.slice(0, 24).map(item =>
            `- jobID=${item.jobID ?? "?"} type=${item.type} attempts=${item.attempts ?? "?"} error=${item.error || "unknown"}`
          )
        ).join("\n")
    : "";

  log(`Specialists done: ${nOk}/${results.length} succeeded`);

  return {
    ok: allOk,
    count: results.length,
    has_more: false,
    next_start_ctx_id: null,
    rows: results,
    complete: nOk,
    failed: results.length - nOk,
    pagination_pending: paginationState.pending,
    pagination_pending_count: paginationState.pendingCount,
    pagination_parse_failures: paginationState.parseFailures,
    pending_pages: paginationState.pendingItems,
    continuation_pending: continuationPending,
    pending_specialists: retryPendingItems,
    requires_followup_tool: continuationPending ? MODULE_NAME : "",
    continuation_prompt: continuationPrompt,
    ...(failedSummary ? {
      error: failedSummary,
      error_status: {
        source: MODULE_NAME,
        code: "specialists_failed",
        message: failedSummary
      },
      specialist_errors: failedResults.map(r => ({
        jobID: r.jobID ?? null,
        type: r.type || "",
        error: String(r.error || "").trim(),
        attempts: Number.isFinite(Number(r.attempts)) ? Number(r.attempts) : undefined,
        retryable: r.retryable === true,
        error_status: r.error_status || undefined
      }))
    } : {})
  };
}

export default { name: MODULE_NAME, invoke: getInvoke };
