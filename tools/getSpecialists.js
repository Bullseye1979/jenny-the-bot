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

const MODULE_NAME = "getSpecialists";

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const specialists = Array.isArray(args?.specialists) ? args.specialists : [];
  if (!specialists.length) {
    return { ok: false, error: 'specialists array is required and must not be empty. Example: [{"type":"context-research","jobID":1,"prompt":"start=2025-11-01 end=2025-11-30"}]' };
  }

  const allEmpty = specialists.every(s => !String(s?.type || "").trim() && !String(s?.prompt || "").trim());
  if (allEmpty) {
    return {
      ok: false,
      error: `All ${specialists.length} specialist entries are missing required fields. Each entry must be an object with: "type" (string, e.g. "context-research"), "jobID" (integer), "prompt" (string with the task). Example: [{"type":"context-research","jobID":1,"prompt":"start=2025-11-01 end=2025-11-30"},{"type":"context-research","jobID":2,"prompt":"start=2025-12-01 end=2025-12-31"}]`,
    };
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

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  log(`Launching ${specialists.length} specialist(s) in batches of ${maxConcurrent}`);

  const runSpec = async (spec) => {
    const type   = String(spec?.type || defaultType || "").trim();
    const jobID  = spec?.jobID  ?? null;
    const prompt = String(spec?.prompt || "").trim();

    if (!type || !prompt) {
      const received = JSON.stringify(spec ?? null).slice(0, 300);
      return { jobID, type: type || "?", ok: false, error: `type and prompt are required for each specialist. Received: ${received}` };
    }

    const baseChannelId = String(types[type] || "").trim();
    if (!baseChannelId) {
      return {
        jobID,
        type,
        ok:    false,
        error: `No channel configured for specialist type "${type}". Configure toolsconfig.getSpecialists.types.${type} in core.json.`,
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

    try {
      const res  = await fetchWithTimeout(apiBase + "/api", { method: "POST", headers, body }, timeoutMs);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        return { jobID, type, ok: false, error: data.error || `HTTP ${res.status}` };
      }

      const responseText = String(data.response || "");
      if (!responseText || responseText.startsWith("[Empty AI response]") || responseText.startsWith("[Max Loops Hit]")) {
        return { jobID, type, ok: false, error: responseText || "Specialist returned empty response" };
      }
      return { jobID, type, ok: true, response: responseText };
    } catch (e) {
      const isAbort = e?.name === "AbortError";
      return { jobID, type, ok: false, error: isAbort ? "Specialist timed out" : (e?.message || String(e)) };
    }
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

  const failedSummary = allOk
    ? undefined
    : results.filter(r => !r.ok).map(r => `[${r.type || "?"}] ${r.error}`).join("; ");

  log(`Specialists done: ${nOk}/${results.length} succeeded`);

  return {
    ok: allOk,
    count: results.length,
    has_more: false,
    next_start_ctx_id: null,
    rows: results,
    complete: nOk,
    failed: results.length - nOk,
    ...(failedSummary ? { error: failedSummary } : {})
  };
}

export default { name: MODULE_NAME, invoke: getInvoke };
