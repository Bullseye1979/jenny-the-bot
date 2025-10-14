/***************************************************************
/* filename: "00010-discord-channel-config.js"                 *
/* Version 1.0                                                 *
/* Purpose: Per-channel overrides; determine channelallowed    *
/*          solely from workingObject.id (no message access).  *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-channel-config";

/***************************************************************
/* functionSignature: getChannelConfig (coreData)              *
/* Applies per-channel overrides onto coreData.workingObject   *
/***************************************************************/
export default async function getChannelConfig(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const cfg = coreData?.config?.["discord-channel-config"];
  if (!cfg || typeof cfg !== "object") return coreData;

  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") return coreData;

  const channelId = String(workingObject?.id ?? "");
  const userId = String(workingObject?.userId ?? workingObject?.userid ?? "");
  const flow = String(workingObject?.flow ?? "");

  workingObject.channelallowed = false;

  if (!channelId || !flow) {
    log("Missing channel or flow context — channelallowed=false", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (Object.prototype.hasOwnProperty.call(channels, channelId)) {
    workingObject.channelallowed = true;
    log("Channel is listed — channelallowed=true", "info", { moduleName: MODULE_NAME, channelId });
  } else {
    log("Channel is not listed — channelallowed=false", "warn", { moduleName: MODULE_NAME, channelId });
    return coreData;
  }

  const entries = channels[channelId];
  if (!Array.isArray(entries) || entries.length === 0) return coreData;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const userIds = Array.isArray(entry.userIds) ? entry.userIds.map(String) : [];
    const flows = Array.isArray(entry.flows) ? entry.flows.map(String) : null;

    const userMatch =
      userIds.length === 0 || userIds.includes("ALL") || (userId && userIds.includes(userId));
    const flowMatch = !flows || flows.length === 0 || flows.includes(flow);

    if (userMatch && flowMatch && entry.overrides && typeof entry.overrides === "object") {
      Object.assign(workingObject, entry.overrides);
      log("Applied overrides", "info", {
        moduleName: MODULE_NAME,
        channelId,
        userId: userId || "unknown",
        flow
      });
    }
  }

  return coreData;
}
