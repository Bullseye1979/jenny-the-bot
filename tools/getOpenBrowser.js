/**************************************************************/
/* filename: "getOpenBrowser.js"                             */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "getOpenBrowser";
const ACTION_TTL_MS = 30 * 1000;

function getBrowserCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{7,63}$/.test(code)) return "";
  return code;
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const authUserId = String(coreData?.workingObject?.webAuth?.userId || "").trim();
  const runtimeUserId = String(coreData?.workingObject?.userId || "").trim();
  const browserCode = getBrowserCode(args?.browserCode);
  const url = String(args?.url || "").trim();

  const identity = authUserId
    ? { type: "user", value: authUserId }
    : (browserCode ? { type: "code", value: browserCode } : (runtimeUserId ? { type: "user", value: runtimeUserId } : null));

  if (!identity) {
    return { ok: false, error: "no_browser_identity", message: "No browser identity available. Use web login or provide browserCode." };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: "invalid_url", message: "Invalid URL provided." };
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { ok: false, error: "invalid_url_scheme", message: "Only https:// and http:// URLs are allowed." };
  }

  const key = `browser-action:${identity.type}:${identity.value}`;
  putItem({ type: "openTab", url, expiresAt: Date.now() + ACTION_TTL_MS }, key);
  log("browser tab action stored", "info", { identity: identity.type, url });

  return { ok: true, message: `A new tab with ${url} will open in your browser shortly (requires Jenny extension).` };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
