/**************************************************************/
/* filename: "openBrowserTab.js"                             */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "openBrowserTab";
const ACTION_TTL_MS = 30 * 1000;

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const userId = String(coreData?.workingObject?.userId || "").trim();
  const url = String(args?.url || "").trim();

  if (!userId) {
    return { ok: false, error: "no_user_id", message: "No user identity available. Please log in via the web interface first." };
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

  const key = `browser-action:user:${userId}`;
  putItem({ type: "openTab", url, expiresAt: Date.now() + ACTION_TTL_MS }, key);
  log.info({ userId, url }, "browser tab action stored");

  return { ok: true, message: `A new tab with ${url} will open in your browser shortly (requires Jenny extension and web login).` };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
