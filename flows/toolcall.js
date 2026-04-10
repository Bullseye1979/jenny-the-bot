/***************************************************************/
/* filename: "toolcall.js"                                     *
/* Version 1.0                                                 *
/* Purpose: Global watcher for tool calls; polls registry      *
/*          and triggers the configured flow when tool         *
/*          presence OR identity changes.                      *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "toolcall";
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);


function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCK[Number(x % 32n)];
    x = x / 32n;
  }
  return out.join("");
}


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


function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}


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


function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}


function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}


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
  const a = baseCore?.config?.[MODULE_NAME]?.flowName;
  const b = baseCore?.config?.toolcall?.flowName;
  const s = typeof a === "string" ? a.trim() : typeof b === "string" ? b.trim() : "";
  return s || MODULE_NAME;
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
  const cfg = baseCore?.config?.[MODULE_NAME] || baseCore?.config?.toolcall || {};
  const pollMs = Math.max(100, getNum(cfg.pollMs, 400));
  const registryKey = getStr(cfg.registryKey, "status:tool");
  const initialDelayMs = getNum(cfg.initialDelayMs, 500);
  const lastStateRef = { hasTool: false, identity: "" };
  const flowName = getConfigFlowName(baseCore);
  setTimeout(() => setTick({ pollMs, registryKey, createRunCore, runFlow, log, lastStateRef, flowName }), initialDelayMs);
}
