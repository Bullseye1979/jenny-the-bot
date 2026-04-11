/**************************************************************/
/* filename: "logging.js"                                           */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper.                     */
/**************************************************************/







import path            from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "logging";


function getEnsureLoggingArray(workingObject) {
  if (!workingObject || typeof workingObject !== "object") {
    throw new Error("[logging] workingObject is required");
  }
  if (!Array.isArray(workingObject.logging)) {
    workingObject.logging = [];
  }
  return workingObject.logging;
}


function getNowIso() {
  return new Date().toISOString();
}


function getModuleNameParts(moduleUrl) {
  try {
    const filename = fileURLToPath(moduleUrl);
    const base = path.basename(filename, path.extname(filename));
    const dashIndex = base.indexOf("-");
    if (dashIndex > 0) {
      const prefix = base.slice(0, dashIndex);
      const name = base.slice(dashIndex + 1) || base;
      return { prefix, name, base };
    }
    return { prefix: null, name: base, base };
  } catch {
    return { prefix: null, name: "module", base: "module" };
  }
}


function getLogPrefix(maybePrefix, name) {
  return maybePrefix ? `[${maybePrefix}:${name}]` : `[${name}]`;
}


export function setLog(workingObject, entry) {
  const arr = getEnsureLoggingArray(workingObject);
  const base = typeof entry === "string"
    ? { level: "info", message: entry }
    : (entry && typeof entry === "object" ? entry : { level: "info", message: String(entry) });

  const level = typeof base.level === "string" ? base.level : "info";
  const message = typeof base.message === "string" ? base.message : "";
  const prefix = typeof base.prefix === "string" ? base.prefix : undefined;
  const context = base.context && typeof base.context === "object" ? base.context : undefined;

  const item = {
    ts: getNowIso(),
    level,
    message,
    moduleName: MODULE_NAME,
    ...(prefix ? { prefix } : {}),
    ...(context ? { context } : {})
  };

  arr.push(item);
  return item;
}


export function getPrefixedLogger(workingObject, moduleUrl) {
  getEnsureLoggingArray(workingObject);
  const { prefix, name } = getModuleNameParts(moduleUrl);
  const finalPrefix = getLogPrefix(prefix, name);

  return function setLogLine(messageOrEntry, level = "info", context) {
    if (typeof messageOrEntry === "string") {
      return setLog(workingObject, { level, message: messageOrEntry, prefix: finalPrefix, context, moduleName: MODULE_NAME });
    }
    const obj = messageOrEntry && typeof messageOrEntry === "object" ? { ...messageOrEntry } : { message: String(messageOrEntry) };
    if (!obj.level) obj.level = level;
    obj.prefix = finalPrefix;
    obj.moduleName = MODULE_NAME;
    return setLog(workingObject, obj);
  };
}


export function getFilePrefixFromUrl(moduleUrl) {
  const { prefix, name } = getModuleNameParts(moduleUrl);
  return getLogPrefix(prefix, name);
}


export function setLogInfo(workingObject, message, context) {
  return setLog(workingObject, { level: "info", message, context, moduleName: MODULE_NAME });
}


export function setLogWarn(workingObject, message, context) {
  return setLog(workingObject, { level: "warn", message, context, moduleName: MODULE_NAME });
}


export function setLogError(workingObject, message, context) {
  return setLog(workingObject, { level: "error", message, context, moduleName: MODULE_NAME });
}

export default {
  setLog,
  getPrefixedLogger,
  getFilePrefixFromUrl,
  setLogInfo,
  setLogWarn,
  setLogError
};
