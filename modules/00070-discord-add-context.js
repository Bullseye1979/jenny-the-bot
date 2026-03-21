/********************************************************************************
/* filename: "discord-add-context.js"                                           *
/* Version 1.0                                                                  *
/* Purpose: Append the current user payload to the DB context with role=user    *
/*          and preserved turn_id when present.                                 *
/********************************************************************************/
import { setContext } from "../core/context.js";

const MODULE_NAME = "discord-add-context";


function getString(value) {
  return value == null ? "" : String(value);
}


function getAttachmentUrlsFromWO(wo) {
  if (!Array.isArray(wo?.fileUrls)) return [];
  return wo.fileUrls.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
}


export default async function getDiscordAddContext(coreData) {
  const wo = coreData?.workingObject || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];
  const ts = String(wo?.timestamp || new Date().toISOString());
  const text = typeof wo?.payload === "string" ? wo.payload.trim() : "";
  wo.logging.push({ timestamp: ts, severity: "info", module: MODULE_NAME, exitStatus: "started", message: "Begin append message to context" });
  if (!wo.db || !wo.flow || !wo.channelID || !text) {
    wo.logging.push({ timestamp: ts, severity: "error", module: MODULE_NAME, exitStatus: "failed", message: "Missing required fields: db, flow, id, or payload" });
    return coreData;
  }
  const files = getAttachmentUrlsFromWO(wo);
  const role = "user";
  const turnId = typeof wo.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  const record = {
    ts: getString(wo.timestamp || ""),
    role,
    turn_id: turnId,
    content: getString(text),
    userId: getString(wo.userId || ""),
    authorName: getString(wo.authorDisplayName || wo.authorDisplayname || ""),
    channelId: getString(wo.channelID || ""),
    messageId: getString(wo.messageId || ""),
    replyToId: getString(wo.replyToId || "") || undefined,
    files: files.length ? files : undefined,
    mentions: Array.isArray(wo.mentions) && wo.mentions.length ? wo.mentions.map(getString).filter(Boolean) : undefined,
    source: getString(wo.source ?? wo.flow ?? "app")
  };
  try {
    await setContext(wo, record);
    wo.logging.push({ timestamp: ts, severity: "info", module: MODULE_NAME, exitStatus: "success", message: "Message appended to context" });
  } catch (err) {
    wo.logging.push({ timestamp: ts, severity: "error", module: MODULE_NAME, exitStatus: "failed", message: `Context write failed: ${err?.message || String(err)}` });
  }
  return coreData;
}
