/************************************************************************************
/* filename: 01004-core-ai-context-writer.js                                           *
/* Version 1.0                                                                     *
/* Purpose: Persists the conversation turns queued by core-ai-* modules into the   *
/*          context DB. Each core-ai module (01000–01003) pushes assistant and tool *
/*          turns into wo._contextPersistQueue during its run; this module drains   *
/*          the queue afterwards.                                                   *
/*                                                                                 *
/*          Modules positioned between the last core-ai module and 01004 can       *
/*          inspect or modify wo._contextPersistQueue before it is written, enabling*
/*          post-processing of AI responses at pipeline level.                     *
/*                                                                                 *
/* Flow: discord, discord-voice, discord-status, api, bard-label-gen, webpage      *
/************************************************************************************/
import { setContext } from "../core/context.js";

const MODULE_NAME = "core-ai-context-writer";


export default async function getCoreAiContextWriter(coreData) {
  const wo = coreData?.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const queue = Array.isArray(wo._contextPersistQueue) ? wo._contextPersistQueue : null;

  /* Nothing queued — no AI module ran or nothing was produced */
  if (!queue || queue.length === 0) return coreData;

  if (wo?.doNotWriteToContext === true) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `doNotWriteToContext=true — skipped context persistence for ${queue.length} turn(s).`
    });
    return coreData;
  }

  let failed = 0;
  for (const turn of queue) {
    try { await setContext(wo, turn); }
    catch (e) {
      failed++;
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "warn",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Persist failed (role=${turn.role}): ${e?.message || String(e)}`
      });
    }
  }

  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: `Context persisted: ${queue.length - failed} of ${queue.length} turn(s)${failed ? `, ${failed} failed` : ""}`
  });

  /* Clear queue so a second run of this module is a no-op */
  wo._contextPersistQueue = [];

  return coreData;
}
