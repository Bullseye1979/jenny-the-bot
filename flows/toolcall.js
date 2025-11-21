/***************************************************************/
/* filename: "toolcall.js"                                     *
/* Version 1.0                                                 *
/* Purpose: Global watcher for tool calls; polls registry and  *
/*          triggers the "toolcall" flow when tool presence    *
/*          OR identity changes.                               *
/***************************************************************/

/***************************************************************/
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "toolcall";

/***************************************************************/
/* functionSignature: getNum (v, d)                            *
/* Parses a number or returns the default                      *
/***************************************************************/
function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/***************************************************************/
/* functionSignature: getStr (v, d)                            *
/* Returns a non-empty string or the default                   *
/***************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/***************************************************************/
/* functionSignature: getHasToolValue (val)                    *
/* Checks whether a registry value effectively contains a tool *
/***************************************************************/
function getHasToolValue(val) {
  if (!val) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return true;
    if (typeof val.tool === "string" && val.tool.trim()) return true;
  }
  return false;
}

/***************************************************************/
/* functionSignature: getToolIdentity (val)                    *
/* Returns a stable identity string for the current tool value *
/***************************************************************/
function getToolIdentity(val) {
  if (!val) return "";
  if (typeof val === "string") return val.trim();

  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return val.name.trim();
    if (typeof val.tool === "string" && val.tool.trim()) return val.tool.trim();
    // Fallback: stabilize on JSON, falls mal mehr Infos drin sind
    try {
      return JSON.stringify(val);
    } catch {
      return "[object tool]";
    }
  }

  return String(val);
}

/***************************************************************/
/* functionSignature: setTick (args)                           *
/* Poll loop body that detects changes and triggers the flow   *
/***************************************************************/
async function setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef }) {
  try {
    const val = await getItem(registryKey);
    const hasTool = getHasToolValue(val);
    const identity = hasTool ? getToolIdentity(val) : "";

    // Reagieren, wenn:
    //  - Präsenz sich ändert (false <-> true) ODER
    //  - Tool weiterhin vorhanden, aber Identität (Name) anders ist
    if (hasTool !== lastStateRef.hasTool || identity !== lastStateRef.identity) {
      log(
        `toolcall state changed → hasTool=${hasTool}, identity="${identity}"`,
        "info",
        { moduleName: MODULE_NAME }
      );
      const rc = createRunCore();
      rc.workingObject.updateStatus = true;
      rc.workingObject.toolcallState = { hasTool, value: val, identity };
      await runFlow(MODULE_NAME, rc);
      lastStateRef.hasTool = hasTool;
      lastStateRef.identity = identity;
    }
  } catch (e) {
    log(`toolcall watcher error: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
  } finally {
    setTimeout(
      () => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef }),
      pollMs
    );
  }
}

/***************************************************************/
/* functionSignature: getToolcallFlow (baseCore, runFlow, createRunCore) *
/* Starts the watcher that polls the registry for tool state   *
/***************************************************************/
export default async function getToolcallFlow(baseCore, runFlow, createRunCore) {
  const log = getPrefixedLogger(baseCore?.workingObject || {}, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || baseCore?.config?.toolcall || {};
  const pollMs = Math.max(100, getNum(cfg.pollMs, 400));
  const registryKey = getStr(cfg.registryKey, "status:tool");
  const initialDelayMs = getNum(cfg.initialDelayMs, 500);

  // lastStateRef hält nun Präsenz UND Identität
  const lastStateRef = { hasTool: false, identity: "" };

  setTimeout(
    () => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef }),
    initialDelayMs
  );
}
