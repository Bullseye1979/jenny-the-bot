/**************************************************************
/* filename: "getBan.js"                                      *
/* Version 1.0                                                *
/* Purpose: Send a ban request to the configured admin via DM *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getItem } from "../core/registry.js";

const MODULE_NAME = "getBan";

function getStr(v, d = "") { return (typeof v === "string" && v.length) ? v : d; }
function getNowIso() { return new Date().toISOString(); }
function getPreview(s, max = 400) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + " …[truncated]" : t;
}

/**************************************************************
/* functionSignature: getPayload (wo, reason)                 *
/* Collects user/context info for the ban DM                  *
/**************************************************************/
function getPayload(wo, reason) {
  const userId      = getStr(wo?.message?.author?.id) || getStr(wo?.message?.authorId) || getStr(wo?.User?.id) || "";
  const userTag     = getStr(wo?.message?.authorTag) || getStr(wo?.User?.tag);
  const userName    = getStr(wo?.authorDisplayname) || getStr(wo?.message?.author?.username) || getStr(wo?.User?.username) || "unknown";
  const userMention = userId ? `<@${userId}>` : "n/a";
  const userMsg     = getStr(wo?.message?.content) || getStr(wo?.payload) || "";
  const guildId     = getStr(wo?.message?.guildId) || getStr(wo?.Guild?.id) || "";
  const channelId   = getStr(wo?.message?.channelId) || getStr(wo?.Channel?.id) || "";
  const messageUrl  = getStr(wo?.message?.url) || getStr(wo?.Message?.url) || "";

  return {
    type: "ban_request",
    timestamp: getNowIso(),
    user: userName,
    userId,
    userTag,
    userMention,
    guildId,
    channelId,
    messageUrl,
    reason: getStr(reason || "Inappropriate behaviour"),
    userMessage: userMsg,
    aiPreview: getPreview(getStr(wo?.Response || ""), 400)
  };
}

/**************************************************************
/* functionSignature: getInvoke (args, coreData)              *
/* Sends DM to admin; returns { user, reason }                *
/**************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const reasonProvided = getStr(args?.reason || "");
  const effectiveReason = reasonProvided || "Inappropriate behaviour";

  const adminId = getStr(wo?.ModAdmin || "");
  const clientRef = getStr(wo?.clientRef || "");
  const client = clientRef ? getItem(clientRef) : null;

  const payload = getPayload(wo, effectiveReason);

  let adminDmSent = false;
  let adminDmError = null;

  if (client && adminId) {
    try {
      const adminUser = await client.users.fetch(adminId);
      const dmText =
`[BAN-REQUEST]
Reason: ${payload.reason}

User: ${payload.user} ${payload.userTag ? `(${payload.userTag})` : ""} ${payload.userId ? `[#${payload.userId}]` : ""}
Mention: ${payload.userMention}
Guild: ${payload.guildId || "unknown"}
Channel: ${payload.channelId || "unknown"}
Jump: ${payload.messageUrl || "n/a"}

User Message:
${payload.userMessage || "(empty)"}

AI (preview): ${payload.aiPreview}`;
      await adminUser.send({ content: dmText });
      adminDmSent = true;
    } catch (e) {
      adminDmError = e?.message || String(e);
    }
  }

  try {
    if (!Array.isArray(wo.logging)) wo.logging = [];
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: adminDmSent ? "warn" : "error",
      module: MODULE_NAME,
      exitStatus: adminDmSent ? "success" : "failed",
      message: adminDmSent ? "Ban request DM sent to admin" : "Failed to send ban request DM",
      details: { adminId: adminId || null, clientRef: clientRef || null, error: adminDmError || null, reason: effectiveReason }
    });
  } catch {}

  return adminDmSent
    ? { ok: true, user: payload.user, reason: effectiveReason }
    : { ok: false, user: payload.user, reason: effectiveReason, error: adminDmError || "No client/admin configured" };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Request a user ban by notifying the configured admin via DM. Reason is optional but recommended. Returns the user name and the resolved reason.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Short reason for the ban request. Defaults to 'Inappropriate behaviour' if omitted." }
        },
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
