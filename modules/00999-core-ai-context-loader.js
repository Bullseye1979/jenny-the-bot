/************************************************************************************
/* filename: "core-ai-context-loader.js"                                           *
/* Version 1.0                                                                     *
/* Purpose: Pre-loads the conversation context (snapshot) from the context DB into *
/*          wo._contextSnapshot before any core-ai module runs.                    *
/*                                                                                 *
/*          Modules positioned between 00999 and the core-ai modules (01000–01003) *
/*          can inspect and modify wo._contextSnapshot before the AI sees it,      *
/*          enabling context injection / filtering at pipeline level.              *
/*                                                                                 *
/*          All core-ai modules retain a direct getContext() fallback so that      *
/*          synthetic pipelines (e.g. wiki image generation) which call getCoreAi  *
/*          directly — without running the module pipeline — continue to work.     *
/*                                                                                 *
/* Flow: discord, discord-voice, discord-status, api, bard-label-gen, webpage      *
/************************************************************************************/
import { getContext } from "../core/context.js";

const MODULE_NAME = "core-ai-context-loader";


export default async function getCoreAiContextLoader(coreData) {
  const wo = coreData?.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];

  /* Idempotent — already populated by an earlier run or a calling module */
  if (Array.isArray(wo._contextSnapshot)) return coreData;

  /* No payload → no AI call will happen, skip the DB round-trip */
  if (!String(wo?.payload ?? "").trim()) return coreData;

  /* No channelID → context cannot be queried; leave _contextSnapshot unset so
     each ai module can produce its own error for the missing id case */
  const channelId = String(wo?.channelID ?? "").trim();
  if (!channelId) {
    wo._contextSnapshot = [];
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "Skipped: no channelID — _contextSnapshot set to []"
    });
    return coreData;
  }

  try {
    const snapshot = await getContext(wo);
    wo._contextSnapshot = Array.isArray(snapshot) ? snapshot : [];
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Context loaded: ${wo._contextSnapshot.length} row(s) for channel "${channelId}"`
    });
  } catch (e) {
    wo._contextSnapshot = [];
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `getContext failed — _contextSnapshot set to []: ${e?.message || String(e)}`
    });
  }

  return coreData;
}
