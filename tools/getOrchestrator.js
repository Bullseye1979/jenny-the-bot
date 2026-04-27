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

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const prompt = String(args?.prompt || "").trim();
  const type   = String(args?.type || cfg.defaultType || "generic").trim();

  if (!prompt) return { ok: false, error: "prompt is required" };

  const types           = cfg.types && typeof cfg.types === "object" ? cfg.types : {};
  const baseChannelId   = String(types[type] || "").trim();
  if (!baseChannelId) {
    return {
      ok:    false,
      error: `No channel configured for orchestrator type "${type}". Configure toolsconfig.getOrchestrator.types.${type} in core.json.`,
    };
  }

  const channelId = `${baseChannelId}-${randomBytes(6).toString("hex")}`;

  if (wo.aborted) return { ok: false, error: "Pipeline aborted" };

  const apiBase      = String(cfg.apiUrl || "http://localhost:3400");
  const apiSecretKey = String(cfg.apiSecret || "").trim();
  const apiSecret    = apiSecretKey ? await getSecret(wo, apiSecretKey) : "";

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  const timeoutMs = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;

  const callerChannelId  = String(wo.callerChannelId || wo.channelId || "");
  const callerChannelIds = Array.isArray(wo.channelIds) ? wo.channelIds.filter(Boolean) : [];
  const body = JSON.stringify({
    channelId,
    payload: prompt,
    userId:           String(wo.userId  || ""),
    guildId:          String(wo.guildId || ""),
    callerChannelId,
    callerChannelIds,
  });

  log(`Orchestrator start: type="${type}" channel="${channelId}"`);

  try {
    const res  = await fetchWithTimeout(apiBase + "/api", { method: "POST", headers, body }, timeoutMs);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const err = data.error || `HTTP ${res.status}`;
      log(`Orchestrator failed: ${err}`, "warn");
      return { ok: false, count: 0, has_more: false, next_start_ctx_id: null, rows: [], error: err };
    }

    const response = String(data.response || "");
    log(`Orchestrator done: type="${type}" responseLen=${response.length}`);
    return { ok: true, count: 1, has_more: false, next_start_ctx_id: null, rows: [response] };
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    log(`Orchestrator error: ${isAbort ? "timeout" : (e?.message || String(e))}`, "error");
    return { ok: false, count: 0, has_more: false, next_start_ctx_id: null, rows: [], error: isAbort ? "Orchestrator timed out" : (e?.message || String(e)) };
  }
}

export default { name: MODULE_NAME, invoke: getInvoke };
