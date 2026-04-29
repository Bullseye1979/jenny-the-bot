/**************************************************************/
/* filename: "getBrowserStatus.js"                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "getBrowserStatus";


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const userId = String(coreData?.workingObject?.webAuth?.userId || coreData?.workingObject?.userId || "").trim();

  if (!userId) {
    return { ok: false, error: "no_user_id", message: "No user identity available." };
  }

  const key = `browser-status:user:${userId}`;
  const status = getItem(key);

  log("browser status retrieved", "info", { userId, hasStatus: !!status });

  if (!status) {
    return { ok: true, status: null, message: "No browser status available. The user may not have the Jenny extension active or status reporting may be disabled." };
  }

  if (status.expiresAt && Date.now() > status.expiresAt) {
    return { ok: true, status: null, message: "Browser status has expired." };
  }

  return { ok: true, status: { url: status.url, title: status.title, ts: status.ts } };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
