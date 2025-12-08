/***************************************************************/
/* filename: "toolcall.js"                                     *
/* Version 1.0                                                 *
/* Purpose: Global watcher for tool calls; polls registry      *
/*          and triggers the configured flow when tool         *
/*          presence OR identity changes.                      *
/***************************************************************/

/***************************************************************/
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "toolcall";
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);

/***************************************************************/
/* functionSignature: getUlidEncodeTime (ms)                  *
/* Encodes a millisecond timestamp into 10 base32 chars       *
/***************************************************************/
function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCK[Number(x % 32n)];
    x = x / 32n;
  }
  return out.join("");
}

/***************************************************************/
/* functionSignature: getUlidEncodeRandom80ToBase32 (rand)    *
/* Encodes 80 random bits into 16 base32 chars                *
/***************************************************************/
function getUlidEncodeRandom80ToBase32(rand) {
  const out = [];
  let acc = 0;
  let bits = 0;
  let i = 0;
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) {
      acc = (acc << 8) | rand[i++];
      bits += 8;
    } else {
      const v = (acc >> (bits - 5)) & 31;
      bits -= 5;
      out.push(CROCK[v]);
    }
  }
  return out.slice(0, 16).join("");
}

/***************************************************************/
/* functionSignature: getUlidRandom80 ()                      *
/* Produces 80 random bits as Uint8Array(10)                  *
/***************************************************************/
function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

/***************************************************************/
/* functionSignature: getNewUlid ()                           *
/* Generates a 26-character monotonic ULID                    *
/***************************************************************/
function getNewUlid() {
  const now = Date.now();
  let rand = getUlidRandom80();
  if (now === __ulid_lastTime) {
    for (let i = 9; i >= 0; i--) {
      if (__ulid_lastRand[i] === 255) {
        __ulid_lastRand[i] = 0;
        continue;
      }
      __ulid_lastRand[i]++;
      break;
    }
    rand = __ulid_lastRand;
  } else {
    __ulid_lastTime = now;
    __ulid_lastRand = rand;
  }
  return getUlidEncodeTime(now) + getUlidEncodeRandom80ToBase32(rand);
}

/***************************************************************/
/* functionSignature: getNum (v, d)                           *
/* Parses a number or returns the default                     *
/***************************************************************/
function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/***************************************************************/
/* functionSignature: getStr (v, d)                           *
/* Returns a non-empty string or the default                  *
/***************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/***************************************************************/
/* functionSignature: getHasToolValue (val)                   *
/* True if a registry value effectively contains a tool       *
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
/* functionSignature: getToolIdentity (val)                   *
/* Returns a stable identity string for the tool value        *
/***************************************************************/
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

/***************************************************************/
/* functionSignature: getConfigFlowName (baseCore)            *
/* Reads flowName from config["toolcall"] or config.toolcall  *
/* and falls back to MODULE_NAME                               *
/***************************************************************/
function getConfigFlowName(baseCore) {
  const a = baseCore?.config?.[MODULE_NAME]?.flowName;
  const b = baseCore?.config?.toolcall?.flowName;
  const s = typeof a === "string" ? a.trim() : typeof b === "string" ? b.trim() : "";
  return s || MODULE_NAME;
}

/***************************************************************/
/* functionSignature: setTick (args)                          *
/* Poll loop that detects changes and triggers the flow       *
/***************************************************************/
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
      wo.turn_id = getNewUlid();
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

/***************************************************************/
/* functionSignature: getToolcallFlow (baseCore, runFlow,     *
/*                     createRunCore)                         *
/* Starts the watcher that polls registry for tool state      *
/***************************************************************/
export default async function getToolcallFlow(baseCore, runFlow, createRunCore) {
  const log = getPrefixedLogger(baseCore?.workingObject || {}, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || baseCore?.config?.toolcall || {};
  const pollMs = Math.max(100, getNum(cfg.pollMs, 400));
  const registryKey = getStr(cfg.registryKey, "status:tool");
  const initialDelayMs = getNum(cfg.initialDelayMs, 500);
  const lastStateRef = { hasTool: false, identity: "" };
  const flowName = getConfigFlowName(baseCore);
  setTimeout(() => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef, flowName }), initialDelayMs);
}
