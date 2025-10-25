/***************************************************************
/* filename: "discord-add-context.js"                          *
/* Version 1.0                                                 *
/* Purpose: Append current user payload to DB context using    *
/*          workingObject fields only (Discord-agnostic)       *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { setContext } from "../core/context.js";

const MODULE_NAME = "discord-add-context";

/***************************************************************
/* functionSignature: getString (value)                        *
/* Returns a safe string representation                        *
/***************************************************************/
function getString(value) {
  return value == null ? "" : String(value);
}

/***************************************************************
/* functionSignature: getAttachmentUrlsFromWO (wo)             *
/* Extracts attachment URLs from workingObject.fileURLs        *
/***************************************************************/
function getAttachmentUrlsFromWO(wo) {
  if (!Array.isArray(wo?.fileURLs)) return [];
  return wo.fileURLs
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
}

/***************************************************************
/* functionSignature: getDiscordAddContext (coreData)          *
/* Persists incoming user payload to the context store         *
/***************************************************************/
export default async function getDiscordAddContext(coreData) {
  const wo = coreData?.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const text = typeof wo?.payload === "string" ? wo.payload.trim() : "";

  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Begin append message to context"
  });

  if (!wo.db || !wo.flow || !wo.id || !text) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Missing required fields: db, flow, id, or payload"
    });
    return coreData;
  }

  const files = getAttachmentUrlsFromWO(wo);

  const record = {
    role: "user",
    content: getString(text),
    userId: getString(wo.userid || wo.userId || ""),
    authorName: getString(wo.authorDisplayname || wo.authorDisplayName || wo.authorName || ""),
    channelId: getString(wo.channelID || wo.id || ""),
    messageId: getString(wo.messageId || ""),
    replyToId: getString(wo.replyToId || "") || undefined,
    files: files.length ? files : undefined,
    mentions:
      Array.isArray(wo.mentions) && wo.mentions.length
        ? wo.mentions.map(getString).filter(Boolean)
        : undefined,
    source: getString(wo.source ?? wo.flow ?? "app")
  };

  try {
    await setContext(wo, record);
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "Message appended to context"
    });
  } catch (err) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Context write failed: ${err?.message || String(err)}`
    });
  }

  return coreData;
}
