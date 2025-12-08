/**************************************************************
/* filename: "core-output.js"                                 *
/* Version 1.0                                                *
/* Purpose: Safely dumps coreData with redaction, rolling logs,*
/*          per-flow object logs and per-flow last-object file *
/*          without mutating workingObject.                   *
/**************************************************************/

/**************************************************************
/*                                                          *
/**************************************************************/

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "core-output";
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(DIRNAME, "..", "logs");
const OBJECTS_DIR = path.join(LOG_DIR, "objects");
const FILE_BASENAME = "objects";
const FILE_EXT = ".log";
const FILE_RE = /^objects-(\d+)\.log$/;
const EVENT_BASENAME = "events";
const EVENT_EXT = ".log";
const EVENT_RE = /^events-(\d+)\.log$/;
const LAST_OBJECT_NAME = "last-object.json";

let WRITE_CHAIN = Promise.resolve();

/**************************************************************
/* functionSignature: setLog (wo, message, level, extra)     *
/* Appends a structured entry to wo.logging                  *
/**************************************************************/
function setLog(wo, message, level = "info", extra = {}) {
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: level,
    module: MODULE_NAME,
    exitStatus: level === "error" ? "failed" : "success",
    message,
    ...(Object.keys(extra).length ? { context: extra } : {})
  });
}

/**************************************************************
/* functionSignature: getRedact (value, keyPath)             *
/* Redacts secrets and truncates large strings               *
/**************************************************************/
function getRedact(value, keyPath) {
  if (typeof value !== "string") return value;
  const lowerPath = String(keyPath || "").toLowerCase();
  if (
    lowerPath.endsWith(".apikey") ||
    lowerPath.endsWith(".api_key") ||
    lowerPath.includes("authorization")
  ) {
    if (value.startsWith("sk-")) return "sk-***redacted***";
    if (/^bearer\s+/i.test(value)) return "Bearer ***redacted***";
    return "***redacted***";
  }
  const MAX = 4000;
  if (value.length > MAX) return value.slice(0, MAX) + ` … [truncated ${value.length - MAX} chars]`;
  return value;
}

/**************************************************************
/* functionSignature: getMessageSnapshot (m)                 *
/* Produces a lightweight, safe snapshot of a message object *
/**************************************************************/
function getMessageSnapshot(m) {
  if (!m) return m;
  const isPlain = m && typeof m === "object" && m.constructor?.name === "Object";
  if (isPlain) return m;
  return {
    id: m?.id ?? "",
    channelId: m?.channelId ?? "",
    author: {
      id: m?.author?.id ?? "",
      username: m?.author?.username ?? "",
      discriminator: m?.author?.discriminator ?? ""
    },
    content: typeof m?.content === "string" ? m.content : ""
  };
}

/**************************************************************
/* functionSignature: getSafeReplacerFactory ()              *
/* Creates a JSON replacer that redacts and handles cycles   *
/**************************************************************/
function getSafeReplacerFactory() {
  const seen = new WeakSet();
  return function safeReplacer(key, value) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[[Circular]]";
      seen.add(value);
    }
    if (key === "client") return "[DiscordClientRef]";
    if (value && typeof value === "object") {
      const ctor = value.constructor && value.constructor.name;
      if (ctor === "Client") return "[DiscordClientInstance]";
      if (ctor === "Socket") return "[Socket]";
      if (ctor === "EventEmitter") return "[EventEmitter]";
    }
    if (key === "refs" && value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value)) out[k] = `[RegistryRef:${k}=${String(value[k])}]`;
      return out;
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
    if (typeof value === "bigint") {
      const n = Number(value);
      return Number.isSafeInteger(n) ? n : value.toString();
    }
    if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 6).join("\n") : undefined
      };
    }
    if (value && typeof value === "object" && value.headers && typeof value.headers === "object") {
      const h = { ...value.headers };
      for (const hk of Object.keys(h)) if (hk.toLowerCase() === "authorization") h[hk] = "Bearer ***redacted***";
      return { ...value, headers: h };
    }
    const keyPath = this && this.__keyPath ? `${this.__keyPath}.${key}` : key;
    if (typeof value === "string") return getRedact(value, String(keyPath || key));
    return value;
  };
}

/**************************************************************
/* functionSignature: getWithKeyPath (obj, keyPath)          *
/* Wraps objects to carry a dotted key path for redaction     *
/**************************************************************/
function getWithKeyPath(obj, keyPath = "") {
  if (obj && typeof obj === "object") {
    const proxy = Array.isArray(obj) ? [] : Object.create(Object.getPrototypeOf(obj));
    Object.defineProperty(proxy, "__keyPath", { value: keyPath, enumerable: false });
    for (const k of Object.keys(obj)) {
      const child = obj[k];
      proxy[k] = child && typeof child === "object" ? getWithKeyPath(child, keyPath ? `${keyPath}.${k}` : k) : child;
    }
    return proxy;
  }
  return obj;
}

/**************************************************************
/* functionSignature: getVerifyWritable (dir)                *
/* Verifies directory is writable; throws on failure         *
/**************************************************************/
async function getVerifyWritable(dir) {
  await fsp.access(dir);
  await fsp.access(dir, fsp.constants ? fsp.constants.W_OK : 2);
}

/**************************************************************
/* functionSignature: setEnsureDirs ()                       *
/* Ensures base log directories exist                        *
/**************************************************************/
async function setEnsureDirs() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(OBJECTS_DIR, { recursive: true });
  await getVerifyWritable(LOG_DIR);
  await getVerifyWritable(OBJECTS_DIR);
}

/**************************************************************
/* functionSignature: getFlowKey (coreData)                  *
/* Derives a stable, filesystem-safe flow key                *
/**************************************************************/
function getFlowKey(coreData) {
  const wo = coreData?.workingObject || {};
  const raw =
    coreData?.flowKey ||
    coreData?.flowName ||
    coreData?.flowId ||
    wo.flowKey ||
    wo.flowName ||
    wo.flowId ||
    "default";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

/**************************************************************
/* functionSignature: getFlowObjectsDir (flowKey)            *
/* Returns directory for a specific flow's object logs       *
/**************************************************************/
function getFlowObjectsDir(flowKey) {
  return path.join(OBJECTS_DIR, flowKey);
}

/**************************************************************
/* functionSignature: getBuildObjectsPath (index, flowKey)   *
/* Builds a full path for objects-N.log for a given flow     *
/**************************************************************/
function getBuildObjectsPath(index, flowKey) {
  return path.join(getFlowObjectsDir(flowKey), `${FILE_BASENAME}-${index}${FILE_EXT}`);
}

/**************************************************************
/* functionSignature: getListLogFiles (flowKey)              *
/* Lists existing rolling object log files for a flow        *
/**************************************************************/
async function getListLogFiles(flowKey) {
  await setEnsureDirs();
  const flowDir = getFlowObjectsDir(flowKey);
  await fsp.mkdir(flowDir, { recursive: true });
  const out = [];
  const entries = await fsp.readdir(flowDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const m = ent.name.match(FILE_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx)) continue;
    out.push({ name: ent.name, index: idx, full: path.join(flowDir, ent.name) });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/**************************************************************
/* functionSignature: getFileSize (p)                        *
/* Returns file size in bytes or 0 if not found              *
/**************************************************************/
async function getFileSize(p) {
  const st = await fsp.stat(p).catch(() => null);
  return st?.size || 0;
}

/**************************************************************
/* functionSignature: setAppendRolling (text, flowKey)       *
/* Appends to rolling objects-N.log per flow, keep last two  *
/**************************************************************/
async function setAppendRolling(text, flowKey) {
  await setEnsureDirs();
  const flowDir = getFlowObjectsDir(flowKey);
  await fsp.mkdir(flowDir, { recursive: true });
  await getVerifyWritable(flowDir);
  const files = await getListLogFiles(flowKey);
  let currentIdx = files.length ? files[files.length - 1].index : 1;
  let currentPath = getBuildObjectsPath(currentIdx, flowKey);
  const payload = Buffer.from(text, "utf8");
  const needed = payload.length;
  let size = await getFileSize(currentPath);
  if (size === 0 && files.length === 0) {
    await fsp.writeFile(currentPath, "");
  }
  if (size + needed > MAX_FILE_BYTES) {
    currentIdx = currentIdx + 1;
    currentPath = getBuildObjectsPath(currentIdx, flowKey);
    await fsp.writeFile(currentPath, "");
    const updated = await getListLogFiles(flowKey);
    const toKeep = updated.slice(-2).map(f => f.index);
    const toDelete = updated.filter(f => !toKeep.includes(f.index));
    for (const f of toDelete) {
      await fsp.rm(f.full, { force: true }).catch(() => {});
    }
  }
  await fsp.appendFile(currentPath, payload);
  return currentPath;
}

/**************************************************************
/* functionSignature: setWriteLastObject (flowKey, safeJson) *
/* Writes the last-object.json for a flow                    *
/**************************************************************/
async function setWriteLastObject(flowKey, safeJson) {
  await setEnsureDirs();
  const flowDir = getFlowObjectsDir(flowKey);
  await fsp.mkdir(flowDir, { recursive: true });
  const lastPath = path.join(flowDir, LAST_OBJECT_NAME);
  const payload = Buffer.from(safeJson + "\n", "utf8");
  await fsp.writeFile(lastPath, payload);
  return lastPath;
}

/**************************************************************
/* functionSignature: setEnqueueWrite (fn)                   *
/* Serializes file writes to avoid race conditions           *
/**************************************************************/
function setEnqueueWrite(fn) {
  WRITE_CHAIN = WRITE_CHAIN.then(fn, fn);
  return WRITE_CHAIN;
}

/**************************************************************
/* functionSignature: getNormalizeWOLogItem (x)              *
/* Normalizes entries from wo.logging for readable log       *
/**************************************************************/
function getNormalizeWOLogItem(x) {
  const sev = (x?.severity ?? x?.level ?? "").toString().toLowerCase();
  return {
    timestamp: x?.timestamp || x?.ts || new Date().toISOString(),
    severity: sev || "info",
    module: x?.module || x?.moduleName || MODULE_NAME,
    message: x?.message || "",
    prefix: x?.prefix || "",
    context: x?.context || {}
  };
}

/**************************************************************
/* functionSignature: getToOneLineLog (e)                    *
/* Formats a normalized log entry into a one-line string     *
/**************************************************************/
function getToOneLineLog(e) {
  const ts = e.timestamp || new Date().toISOString();
  const level = (e.severity || "info").toUpperCase();
  const mod = e.module || MODULE_NAME;
  const msg = (e.message || "").replace(/\s+/g, " ").trim();
  const reason =
    typeof e.context?.reason === "string"
      ? ` reason="${getRedact(e.context.reason, "context.reason")}"`
      : "";
  const ctxBits = [];
  if (e.context?.guildId) ctxBits.push(`guildId=${e.context.guildId}`);
  if (e.context?.channelId) ctxBits.push(`channelId=${e.context.channelId}`);
  const prefix = e.prefix ? ` ${e.prefix}` : "";
  const ctx = ctxBits.length ? ` ctx={${ctxBits.join(",")}}` : "";
  return `[${ts}] [${level}] ${mod}:${prefix} ${getRedact(msg, "message")}${reason}${ctx}`;
}

/**************************************************************
/* functionSignature: getReadableLogBlock (wo)               *
/* Builds a readable log block from wo.logging               *
/**************************************************************/
function getReadableLogBlock(wo) {
  const arr = Array.isArray(wo?.logging) ? wo.logging : [];
  if (!arr.length) return "";
  const normalized = arr.map(getNormalizeWOLogItem);
  const lines = normalized.map(getToOneLineLog).join("\n");
  const header =
    "================ READABLE LOG ================\n" +
    `timestamp=${new Date().toISOString()}\n` +
    "==============================================\n";
  const footer =
    "\n==============================================\n";
  return header + lines + footer;
}

/**************************************************************
/* functionSignature: getBuildEventsPath (index)             *
/* Builds a full path for events-N.log in logs/              *
/**************************************************************/
function getBuildEventsPath(index) {
  return path.join(LOG_DIR, `${EVENT_BASENAME}-${index}${EVENT_EXT}`);
}

/**************************************************************
/* functionSignature: getListEventFiles ()                   *
/* Lists existing rolling events log files in logs/          *
/**************************************************************/
async function getListEventFiles() {
  await setEnsureDirs();
  const out = [];
  const entries = await fsp.readdir(LOG_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const m = ent.name.match(EVENT_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx)) continue;
    out.push({ name: ent.name, index: idx, full: path.join(LOG_DIR, ent.name) });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/**************************************************************
/* functionSignature: setAppendReadableLog (text)            *
/* Appends to rolling events-N.log in logs/, keep last two   *
/**************************************************************/
async function setAppendReadableLog(text) {
  await setEnsureDirs();
  const files = await getListEventFiles();
  let currentIdx = files.length ? files[files.length - 1].index : 1;
  let currentPath = getBuildEventsPath(currentIdx);
  const payload = Buffer.from(text, "utf8");
  const needed = payload.length;
  let size = await getFileSize(currentPath);
  if (size === 0 && files.length === 0) {
    await fsp.writeFile(currentPath, "");
  }
  if (size + needed > MAX_FILE_BYTES) {
    currentIdx = currentIdx + 1;
    currentPath = getBuildEventsPath(currentIdx);
    await fsp.writeFile(currentPath, "");
    const updated = await getListEventFiles();
    const toKeep = updated.slice(-2).map(f => f.index);
    const toDelete = updated.filter(f => !toKeep.includes(f.index));
    for (const f of toDelete) {
      await fsp.rm(f.full, { force: true }).catch(() => {});
    }
  }
  await fsp.appendFile(currentPath, payload);
  return currentPath;
}

/**************************************************************
/* functionSignature: getCoreOutput (coreData)               *
/* Appends a safe coreData dump to per-flow rolling log,     *
/* writes per-flow last-object.json, and appends readable log*
/**************************************************************/
export default async function getCoreOutput(coreData) {
  const wo = coreData.workingObject || {};
  const flowKey = getFlowKey(coreData);
  const forLog = {
    ...coreData,
    workingObject: {
      ...(coreData.workingObject || {}),
      message: getMessageSnapshot(coreData?.workingObject?.message)
    }
  };
  const proxy = getWithKeyPath(forLog, "");
  let safeJson = "";
  try {
    safeJson = JSON.stringify(proxy, getSafeReplacerFactory(), 2);
  } catch (e) {
    safeJson = JSON.stringify({
      stringifyError: String(e?.message || e),
      fallback: "[unstringifiable]"
    });
    setLog(wo, "Failed to stringify coreData; wrote fallback payload.", "error", {
      reason: "stringify-failed"
    });
  }
  const record =
    "\n================ CORE DATA DUMP ================\n" +
    safeJson +
    "\n================================================\n";
  try {
    const pathWritten = await setEnqueueWrite(() => setAppendRolling(record, flowKey));
    setLog(wo, "Core data appended to per-flow rolling log file.", "info", {
      path: pathWritten,
      flowKey,
      maxFileBytes: MAX_FILE_BYTES,
      policy: "2-file rolling per flow, oldest removed on third"
    });
  } catch (e) {
    setLog(wo, "Failed to append core data to per-flow rolling log.", "error", {
      flowKey,
      reason: String(e?.message || e)
    });
  }
  try {
    const lastPath = await setEnqueueWrite(() => setWriteLastObject(flowKey, safeJson));
    setLog(wo, "Last object for flow written.", "info", {
      path: lastPath,
      flowKey
    });
  } catch (e) {
    setLog(wo, "Failed to write last object for flow.", "error", {
      flowKey,
      reason: String(e?.message || e)
    });
  }
  const readable = getReadableLogBlock(wo);
  if (readable) {
    try {
      const pathReadable = await setEnqueueWrite(() => setAppendReadableLog(readable));
      setLog(wo, "Readable log appended to events file.", "info", {
        path: pathReadable,
        maxFileBytes: MAX_FILE_BYTES,
        policy: "2-file rolling, oldest removed on third"
      });
    } catch (e) {
      setLog(wo, "Failed to append readable log.", "error", { reason: String(e?.message || e) });
    }
  }
  return coreData;
}
