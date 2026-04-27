/**************************************************************/
/* filename: "02999-core-tool-status-clear.js"                */
/* Version 1.0                                                */
/* Purpose: Clears active tool status after AI runtime.        */
/**************************************************************/

import { getItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-tool-status-clear";


async function deleteIfOwned(key, token) {
  if (!key || !token) return;
  try {
    const current = await getItem(key);
    if (current?.token === token) await deleteItem(key);
  } catch {}
}


export default async function getCoreToolStatusClear(coreData) {
  const wo = coreData?.workingObject || {};
  const active = wo._activeToolStatus;
  if (!active?.token) return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);
  const statusKey = String(active.statusKey || "").trim();

  if (wo._activeToolStatusTimer) {
    try { clearTimeout(wo._activeToolStatusTimer); } catch {}
    delete wo._activeToolStatusTimer;
  }

  if (active.hasGlobalStatus !== false) {
    await deleteIfOwned("status:tool", active.token);
  }
  if (statusKey) {
    await deleteIfOwned("status:tool:" + statusKey, active.token);
  }

  if (wo._dashboardActiveTool?.token === active.token) delete wo._dashboardActiveTool;
  delete wo._activeToolStatus;

  log("cleared active tool status after AI runtime", "debug", { moduleName: MODULE_NAME, statusKey });
  return coreData;
}
