/************************************************************************************
/* filename: 00999-core-ai-context-loader.js                                           *
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
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-ai-context-loader";


export default async function getCoreAiContextLoader(coreData) {
  const wo = coreData?.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  if (Array.isArray(wo._contextSnapshot)) return coreData;

  if (!String(wo?.payload ?? "").trim()) return coreData;

  /* No channelID yet — leave _contextSnapshot unset so AI modules fall back to
     getContext(wo) themselves once channelID is known (e.g. set by 00048 later) */
  const channelId = String(wo?.channelID ?? "").trim();
  if (!channelId) {
    log("Skipped: no channelID — AI modules will load context themselves");
    return coreData;
  }

  try {
    const snapshot = await getContext(wo);
    wo._contextSnapshot = Array.isArray(snapshot) ? snapshot : [];
    log(`Context loaded: ${wo._contextSnapshot.length} row(s) for channel "${channelId}"`);
  } catch (e) {
    wo._contextSnapshot = [];
    log(`getContext failed — _contextSnapshot set to []: ${e?.message || String(e)}`, "warn");
  }

  return coreData;
}
