/************************************************************************************
/* filename: "core-channel-config.js"                                              *
/* Version 1.0                                                                     *
/* Purpose: Per-channel overrides; compute channelallowed from workingObject.id;   *
/*          DM uses id "DM"; flow required; DMs default to "discord". Empty        *
/*          strings ("") are treated as intentional overrides (no fallback).       *
/************************************************************************************/
/************************************************************************************
/*                                                                                  *
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-channel-config";

/************************************************************************************
/* functionSignature: getChannelConfig (coreData)                                   *
/* Applies per-channel overrides onto coreData.workingObject                        *
/************************************************************************************/
export default async function getChannelConfig(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const cfg = coreData?.config?.["core-channel-config"];
  if (!cfg || typeof cfg !== "object") return coreData;

  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") return coreData;

  const channelId = String(workingObject?.id ?? "");
  const userId = String(workingObject?.userId ?? workingObject?.userid ?? "");
  let flow = String(workingObject?.flow ?? "");

  const chType = workingObject?.channelType;
  const isDM =
    workingObject?.isDM === true ||
    String(chType ?? "").toUpperCase() === "DM" ||
    chType === 1 ||
    (!workingObject?.guildId && !!userId);

  const effectiveChannelId = isDM ? "DM" : channelId;

  if (!flow && isDM) {
    flow = "discord";
    workingObject.flow = flow;
    log("Flow was empty for DM — defaulted to 'discord'", "info", { moduleName: MODULE_NAME });
  }

  if (!flow) {
    workingObject.channelallowed = false;
    log("Missing flow context — channelallowed=false", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  workingObject.channelallowed = false;

  if (!effectiveChannelId) {
    log("Missing channel id — channelallowed=false", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (!Object.prototype.hasOwnProperty.call(channels, effectiveChannelId)) {
    log("Channel is not listed — channelallowed=false", "warn", {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId
    });
    return coreData;
  }

  const entries = channels[effectiveChannelId];
  if (!Array.isArray(entries) || entries.length === 0) {
    workingObject.channelallowed = true;
    log("Channel listed without rules — channelallowed=true", "info", {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId
    });
    return coreData;
  }

  let applied = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const userIds = Array.isArray(entry.userIds) ? entry.userIds.map(String) : [];
    const flows = Array.isArray(entry.flows) ? entry.flows.map(String) : null;

    const userMatch =
      userIds.length === 0 ||
      userIds.includes("ALL") ||
      (userId && userIds.includes(userId));

    const flowMatch = !flows || flows.length === 0 || flows.includes(flow);

    if (userMatch && flowMatch && entry.overrides && typeof entry.overrides === "object") {
      const { channelallowed: _c, allow: _a, ...rawOverrides } = entry.overrides;
      for (const [k, v] of Object.entries(rawOverrides)) {
        if (v === undefined || v === null) continue;
        workingObject[k] = v;
      }
      applied++;
    }
  }

  workingObject.channelallowed = true;

  log(
    applied > 0 ? "Applied overrides — channelallowed=true" : "No matching rules — channelallowed=true (baseline)",
    applied > 0 ? "info" : "warn",
    {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId,
      userId: userId || "unknown",
      flow,
      applied
    }
  );

  return coreData;
}
