/***************************************************************/
/* filename: "toolcall.js"                                     *
/* Version 1.0                                                 *
/* Purpose: Global watcher for tool calls; polls registry      *
/*          and triggers the configured flow when tool         *
/*          presence OR identity changes.                      *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";
import { getStr, getNum, getNewUlid } from "../core/utils.js";

const MODULE_NAME = "toolcall";


function getHasToolValue(val) {
  if (!val) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return true;
    if (typeof val.tool === "string" && val.tool.trim()) return true;
  }
  return false;
}


function getToolIdentity(val) {
  if (!val) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return val.name.trim();
    if (typeof val.tool === "string" && val.tool.trim()) return val.tool.trim();
    try {
      return JSON.stringify(val);
    } catch {
      return "[object tool]";
    }
  }
  return String(val);
}


function getConfigFlowName(baseCore) {
  const s = baseCore?.config?.[MODULE_NAME]?.flowName;
  return (typeof s === "string" && s.trim()) ? s.trim() : MODULE_NAME;
}


async function setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef, flowName }) {
  try {
    const val = await getItem(registryKey);
    const hasTool = getHasToolValue(val);
    const identity = hasTool ? getToolIdentity(val) : "";
    if (hasTool !== lastStateRef.hasTool || identity !== lastStateRef.identity) {
      log(`toolcall state changed → hasTool=${hasTool}, identity="${identity}"`, "info", { moduleName: MODULE_NAME });
      const rc = createRunCore();
      const wo = rc.workingObject || (rc.workingObject = {});
      const nowIso = new Date().toISOString();
wo.turnId = getNewUlid();
      wo.timestamp = nowIso;
      wo.flow = flowName;
      wo.updateStatus = true;
      wo.toolcallState = { hasTool, value: val, identity };
      await runFlow(flowName, rc);
      lastStateRef.hasTool = hasTool;
      lastStateRef.identity = identity;
    }
  } catch (e) {
    log(`toolcall watcher error: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
  } finally {
    setTimeout(() => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef, flowName }), pollMs);
  }
}


export default async function getToolcallFlow(baseCore, runFlow, createRunCore) {
  const log = getPrefixedLogger(baseCore?.workingObject || {}, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || {};
  const pollMs = Math.max(100, getNum(cfg.pollMs, 400));
  const registryKey = getStr(cfg.registryKey, "status:tool");
  const initialDelayMs = getNum(cfg.initialDelayMs, 500);
  const lastStateRef = { hasTool: false, identity: "" };
  const flowName = getConfigFlowName(baseCore);
  setTimeout(() => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef, flowName }), initialDelayMs);
}
