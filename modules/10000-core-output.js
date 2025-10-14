/***************************************************************
/* filename: "10000-core-output.js"                            *
/* Version 1.0                                                 *
/* Purpose: Safe console dump of coreData with redaction and   *
/*          lightweight message snapshot (no WO mutation).     *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

const MODULE_NAME = "core-output";

/***************************************************************
/* functionSignature: setLog (wo, message, level, extra)       *
/* Appends a structured log entry into wo.logging              *
/***************************************************************/
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
/* Redacts secrets and truncates very long strings             *
/***************************************************************/
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
/* functionSignature: getMessageSnapshot (message)             *
/* Creates a lightweight snapshot of a Discord.js message      *
/***************************************************************/
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
/* Produces a JSON replacer handling circulars and masking     *
/***************************************************************/
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
/* Injects key path metadata to support targeted redaction     *
/***************************************************************/
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
/* functionSignature: getCoreOutput (coreData)                 *
/* Logs a safe JSON view of coreData and returns coreData      *
/***************************************************************/
export default async function getCoreOutput(coreData) {
  const wo = coreData.workingObject || {};
  const forLog = {
    ...coreData,
    workingObject: {
      ...(coreData.workingObject || {}),
      message: getMessageSnapshot(coreData?.workingObject?.message)
    }
  };
  try {
    const proxy = getWithKeyPath(forLog, "");
    const safeJson = JSON.stringify(proxy, getSafeReplacerFactory(), 2);
    console.log("\n================ CORE DATA DUMP ================\n");
    console.log(safeJson);
    console.log("\n================================================\n");
    setLog(wo, "Core data dumped to console (refs masked, secrets redacted, WO untouched).", "info");
  } catch (err) {
    console.error("Error serializing coreData:", err?.message || String(err));
    setLog(wo, `Serialization error: ${err?.message || String(err)}`, "error");
  }
  return coreData;
}
