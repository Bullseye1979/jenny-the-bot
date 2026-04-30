/**************************************************************/
/* filename: "getBrowserStatus.js"                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "getBrowserStatus";

function getBrowserCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{7,63}$/.test(code)) return "";
  return code;
}

function getStatusByKey(key) {
  const status = key ? getItem(key) : null;
  if (!status) return null;
  if (status.expiresAt && Date.now() > status.expiresAt) return null;
  return status;
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const userId = String(coreData?.workingObject?.webAuth?.userId || coreData?.workingObject?.userId || "").trim();
  const browserCode = getBrowserCode(args?.browserCode);

  const userKey = userId ? `browser-status:user:${userId}` : "";
  const codeKey = browserCode ? `browser-status:code:${browserCode}` : "";
  const userStatus = getStatusByKey(userKey);
  const codeStatus = userStatus ? null : getStatusByKey(codeKey);
  const status = userStatus || codeStatus;
  const identity = userStatus ? "user" : (codeStatus ? "code" : "none");

  log("browser status retrieved", "info", { identity, userId: userId || undefined, hasStatus: !!status });

  if (!userId && !browserCode) {
    return { ok: false, error: "no_browser_identity", message: "No browser identity available. Use web login or provide browserCode." };
  }

  if (!status) {
    return { ok: true, status: null, message: "No browser status available. The extension may be inactive, status reporting may be disabled, or the browser code may be stale." };
  }

  return { ok: true, status: { url: status.url, title: status.title, ts: status.ts } };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
