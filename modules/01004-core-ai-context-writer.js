/**************************************************************/
/* filename: "01004-core-ai-context-writer.js"                      */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


import { setContext } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-ai-context-writer";


export default async function getCoreAiContextWriter(coreData) {
  const wo = coreData?.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  const queue = Array.isArray(wo._contextPersistQueue) ? wo._contextPersistQueue : null;

  
  if (!queue || queue.length === 0) return coreData;

  if (wo?.doNotWriteToContext === true) {
    log(`doNotWriteToContext=true — skipped context persistence for ${queue.length} turn(s).`);
    return coreData;
  }

  let failed = 0;
  for (const turn of queue) {
    try { await setContext(wo, turn); }
    catch (e) {
      failed++;
      log(`Persist failed (role=${turn.role}): ${e?.message || String(e)}`, "warn");
    }
  }

  log(`Context persisted: ${queue.length - failed} of ${queue.length} turn(s)${failed ? `, ${failed} failed` : ""}`);

  
  wo._contextPersistQueue = [];

  return coreData;
}
