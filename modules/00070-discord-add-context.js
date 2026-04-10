/**************************************************************/
/* filename: "00070-discord-add-context.js"                         */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/






import { setContext } from "../core/context.js";
import { getPrefixedLogger } from "../core/logging.js";

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
  const log = getPrefixedLogger(wo, import.meta.url);
  const text = typeof wo?.payload === "string" ? wo.payload.trim() : "";
  log("Begin append message to context");
  if (!wo.db || !wo.flow || !wo.channelID || !text) {
    log("Missing required fields: db, flow, id, or payload", "error");
    return coreData;
  }
  const files = getAttachmentUrlsFromWO(wo);
  const role = "user";
  const turnId = typeof wo.turnId === "string" && wo.turnId ? wo.turnId : undefined;
  const record = {
    ts: getString(wo.timestamp || ""),
    role,
    turnId: turnId,
    content: getString(text),
    authorName: getString(wo.authorDisplayName || wo.authorDisplayname || ""),
    channelId: getString(wo.channelID || ""),
    messageId: getString(wo.messageId || ""),
    replyToId: getString(wo.replyToId || "") || undefined,
    files: files.length ? files : undefined,
    mentions: Array.isArray(wo.mentions) && wo.mentions.length ? wo.mentions.map(getString).filter(Boolean) : undefined,
    source: wo.voiceTranscribed === true ? "voice-transcription" : getString(wo.source ?? wo.flow ?? "app")
  };
  try {
    await setContext(wo, record);
    log("Message appended to context");
  } catch (err) {
    log(`Context write failed: ${err?.message || String(err)}`, "error");
  }
  return coreData;
}
