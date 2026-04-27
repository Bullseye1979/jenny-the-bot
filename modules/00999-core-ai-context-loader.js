/**************************************************************/
/* filename: "00999-core-ai-context-loader.js"                      */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/
import { getContext } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-ai-context-loader";

export default async function getCoreAiContextLoader(coreData) {
  const wo = coreData?.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  if (Array.isArray(wo?._contextSnapshot)) return coreData;
  if (!String(wo?.payload ?? "").trim()) return coreData;

  const channelId = String(wo?.channelId ?? "").trim();
  if (!channelId) {
    log("Skipped: no channelId available for context preload");
    return coreData;
  }

  try {
    const snapshot = await getContext(wo);
    wo._contextSnapshot = Array.isArray(snapshot) ? snapshot : [];
    log(`Context loaded: ${wo._contextSnapshot.length} row(s) for channel "${channelId}"`);
  } catch (error) {
    wo._contextSnapshot = [];
    log(`getContext failed and returned an empty snapshot: ${error?.message || String(error)}`, "warn");
  }

  return coreData;
}
