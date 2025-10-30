/***************************************************************
/* filename: "core-output.js"                                  *
/* Version 1.0                                                 *
/* Purpose: Safely dumps coreData with redaction, rolling logs,*
/*          and error mirroring without mutating workingObject.*
/***************************************************************/

/***************************************************************
/*                                                             *
/***************************************************************/

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "core-output";
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(DIRNAME, "..", "logs");
const OBJECTS_DIR = path.join(LOG_DIR, "objects");
const ERROR_FILE = path.join(OBJECTS_DIR, "error.log");
const FILE_BASENAME = "objects";
const FILE_EXT = ".log";
const FILE_RE = /^objects-(\d+)\.log$/;

let WRITE_CHAIN = Promise.resolve();

/***************************************************************
/* functionSignature: setLog (wo, message, level, extra)       *
/* Appends a structured entry to wo.logging                    *
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

/***************************************************************
/* functionSignature: getRedact (value, keyPath)               *
/* Redacts secrets and truncates large strings                 *
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

/***************************************************************
/* functionSignature: getMessageSnapshot (m)                   *
/* Produces a lightweight, safe snapshot of a message object   *
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

/***************************************************************
/* functionSignature: getSafeReplacerFactory ()                *
/* Creates a JSON replacer that redacts and handles cycles     *
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

/***************************************************************
/* functionSignature: getWithKeyPath (obj, keyPath)            *
/* Wraps objects to carry a dotted key path for redaction      *
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

/***************************************************************
/* functionSignature: getVerifyWritable (dir)                  *
/* Verifies directory is writable; throws on failure           *
/**************************************************************/
async function getVerifyWritable(dir) {
  await fsp.access(dir);
  await fsp.access(dir, fsp.constants ? fsp.constants.W_OK : 2);
}

/***************************************************************
/* functionSignature: setEnsureDirs ()                         *
/* Ensures log directories exist                               *
/**************************************************************/
async function setEnsureDirs() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.mkdir(OBJECTS_DIR, { recursive: true });
  await getVerifyWritable(LOG_DIR);
  await getVerifyWritable(OBJECTS_DIR);
}

/***************************************************************
/* functionSignature: getBuildObjectsPath (index)              *
/* Builds a full path for objects-N.log                        *
/**************************************************************/
function getBuildObjectsPath(index) {
  return path.join(OBJECTS_DIR, `${FILE_BASENAME}-${index}${FILE_EXT}`);
}

/***************************************************************
/* functionSignature: getListLogFiles ()                       *
/* Lists existing rolling object log files                     *
/**************************************************************/
async function getListLogFiles() {
  await setEnsureDirs();
  const out = [];
  const entries = await fsp.readdir(OBJECTS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const m = ent.name.match(FILE_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx)) continue;
    out.push({ name: ent.name, index: idx, full: path.join(OBJECTS_DIR, ent.name) });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/***************************************************************
/* functionSignature: getFileSize (p)                          *
/* Returns file size in bytes or 0 if not found                *
/**************************************************************/
async function getFileSize(p) {
  const st = await fsp.stat(p).catch(() => null);
  return st?.size || 0;
}

/***************************************************************
/* functionSignature: setAppendRolling (text)                  *
/* Appends to rolling objects-N.log, keeping only last two     *
/**************************************************************/
async function setAppendRolling(text) {
  await setEnsureDirs();
  const files = await getListLogFiles();
  let currentIdx = files.length ? files[files.length - 1].index : 1;
  let currentPath = getBuildObjectsPath(currentIdx);
  const payload = Buffer.from(text, "utf8");
  const needed = payload.length;
  let size = await getFileSize(currentPath);
  if (size === 0 && files.length === 0) {
    await fsp.writeFile(currentPath, "");
  }
  if (size + needed > MAX_FILE_BYTES) {
    currentIdx = currentIdx + 1;
    currentPath = getBuildObjectsPath(currentIdx);
    await fsp.writeFile(currentPath, "");
    const updated = await getListLogFiles();
    const toKeep = updated.slice(-2).map(f => f.index);
    const toDelete = updated.filter(f => !toKeep.includes(f.index));
    for (const f of toDelete) {
      await fsp.rm(f.full, { force: true }).catch(() => {});
    }
  }
  await fsp.appendFile(currentPath, payload);
  return currentPath;
}

/***************************************************************
/* functionSignature: setEnqueueWrite (fn)                     *
/* Serializes file writes to avoid race conditions             *
/**************************************************************/
function setEnqueueWrite(fn) {
  WRITE_CHAIN = WRITE_CHAIN.then(fn, fn);
  return WRITE_CHAIN;
}

/***************************************************************
/* functionSignature: getNormalizeWOLogItem (x)                *
/* Normalizes a wo.logging entry for error mirroring           *
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

/***************************************************************
/* functionSignature: getToOneLineError (e)                    *
/* Formats a normalized error entry into a one-line string     *
/**************************************************************/
function getToOneLineError(e) {
  const ts = e.timestamp || new Date().toISOString();
  const mod = e.module || MODULE_NAME;
  const msg = (e.message || "").replace(/\s+/g, " ").trim();
  const reason = typeof e.context?.reason === "string" ? ` reason="${e.context.reason.replace(/\s+/g, " ").trim()}"` : "";
  const ctxBits = [];
  if (e.context?.guildId) ctxBits.push(`guildId=${e.context.guildId}`);
  if (e.context?.channelId) ctxBits.push(`channelId=${e.context.channelId}`);
  const prefix = e.prefix ? ` ${e.prefix}` : "";
  const ctx = ctxBits.length ? ` ctx={${ctxBits.join(",")}}` : "";
  return `[${ts}] [ERROR] ${mod}:${prefix} ${msg}${reason}${ctx}`;
}

/***************************************************************
/* functionSignature: setMirrorErrorsToConsoleAndFile (wo, rec)*
/* Mirrors errors to stderr and rewrites logs/objects/error.log*/
/**************************************************************/
async function setMirrorErrorsToConsoleAndFile(wo, fullRecordForErrorFile) {
  const arr = Array.isArray(wo?.logging) ? wo.logging : [];
  const normalized = arr.map(getNormalizeWOLogItem);
  const errors = normalized.filter(e => e.severity === "error");
  if (!errors.length) return;

  for (const e of errors) {
    console.error(getToOneLineError(e));
  }

  await setEnsureDirs();

  const header =
    "================ ERROR SNAPSHOT ================\n" +
    `timestamp=${new Date().toISOString()}\n` +
    "===============================================\n";
  const lines = errors.map(getToOneLineError).join("\n") + "\n";
  const payload = header + lines +
    "================ LAST CORE DUMP ================\n" +
    fullRecordForErrorFile +
    "================================================\n";

  await setEnqueueWrite(() => fsp.writeFile(ERROR_FILE, payload, "utf8"));
}

/***************************************************************
/* functionSignature: getCoreOutput (coreData)                 *
/* Appends a safe coreData dump to rolling log and mirrors errs*/
/**************************************************************/
export default async function getCoreOutput(coreData) {
  const wo = coreData.workingObject || {};
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
    safeJson = JSON.stringify({ stringifyError: String(e?.message || e), fallback: "[unstringifiable]" });
    setLog(wo, "Failed to stringify coreData; wrote fallback payload.", "error", { reason: "stringify-failed" });
  }
  const record =
    "\n================ CORE DATA DUMP ================\n" +
    safeJson +
    "\n================================================\n";
  try {
    const pathWritten = await setEnqueueWrite(() => setAppendRolling(record));
    setLog(wo, "Core data appended to rolling log file.", "info", {
      path: pathWritten,
      maxFileBytes: MAX_FILE_BYTES,
      policy: "2-file rolling, oldest removed on third"
    });
  } catch (e) {
    setLog(wo, "Failed to append core data to rolling log.", "error", { reason: String(e?.message || e) });
    console.error(`[core-output] write failed: ${String(e?.message || e)}`);
  }
  try {
    await setMirrorErrorsToConsoleAndFile(wo, record);
  } catch (e) {
    setLog(wo, "Failed to mirror errors to console/file.", "error", { reason: String(e?.message || e) });
  }
  return coreData;
}
