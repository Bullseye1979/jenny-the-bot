/************************************************************************************/
/* filename: "core-channel-config.js"                                              */
/* Version: 1.0                                                                    */
/* Purpose: Per-channel overrides for workingObject. Supports:                     */
/*          1) channels[<channelId>] = [rules...]                                  */
/*          2) rules referencing channelIDs (rule.channelIDs or rule.overrides.    */
/*             channelIDs) across all channel groups                               */
/*          Multiple matching rules are applied cumulatively; later wins.          */
/*          Arrays are ALWAYS replaced (never merged).                             */
/*          DMs use effective channel id "DM"; flow required; DMs default to       */
/*          "discord".                                                            */
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-channel-config";

/************************************************************************************/
/* functionSignature: isPlainObject (v)                                              */
/* Returns true if v is a plain object                                               */
/************************************************************************************/
function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype;
}

/************************************************************************************/
/* functionSignature: normalizeStr (v)                                               */
/* Normalizes a value into a trimmed string                                          */
/************************************************************************************/
function normalizeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/************************************************************************************/
/* functionSignature: normalizeStrList (v)                                           */
/* Normalizes a value into a list of trimmed strings                                 */
/************************************************************************************/
function normalizeStrList(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => normalizeStr(x)).filter(Boolean);
}

/************************************************************************************/
/* functionSignature: deepMergePlain (target, source)                                */
/* Deep merges plain objects; arrays are replaced; null/undefined are ignored        */
/************************************************************************************/
function deepMergePlain(target, source) {
  const out = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) return out;

  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || v === null) continue;

    const cur = out[k];

    if (isPlainObject(cur) && isPlainObject(v)) {
      out[k] = deepMergePlain(cur, v);
      continue;
    }

    if (Array.isArray(v)) {
      out[k] = v.slice();
      continue;
    }

    out[k] = v;
  }

  return out;
}

/************************************************************************************/
/* functionSignature: getEntryMatch (entry, userId, flow)                            */
/* Determines whether a config entry applies to the current context                  */
/************************************************************************************/
function getEntryMatch(entry, userId, flow) {
  if (!entry || typeof entry !== "object") return false;

  const userIds = normalizeStrList(entry.userIds);
  const flows = normalizeStrList(entry.flows);

  const userMatch =
    userIds.length === 0 ||
    userIds.includes("ALL") ||
    (userId && userIds.includes(userId));

  const flowMatch =
    flows.length === 0 ||
    (flow && flows.includes(flow));

  return userMatch && flowMatch;
}

/************************************************************************************/
/* functionSignature: getMentionsChannel (entry, channelId)                          */
/* Returns true if entry references channelId via channelIDs                         */
/************************************************************************************/
function getMentionsChannel(entry, channelId) {
  if (!entry || typeof entry !== "object") return false;

  const direct = normalizeStrList(entry.channelIDs);
  if (direct.includes(channelId)) return true;

  const ov = entry?.overrides;
  const ovIds = normalizeStrList(ov?.channelIDs);
  if (ovIds.includes(channelId)) return true;

  return false;
}

/************************************************************************************/
/* functionSignature: getChannelEntries (channels, channelId)                        */
/* Returns { entries, listed } using key-based and channelIDs-based definitions      */
/************************************************************************************/
function getChannelEntries(channels, channelId) {
  const out = [];

  const direct = channels?.[channelId];
  const directIsArray = Array.isArray(direct);

  if (directIsArray) out.push(...direct);

  let referenced = false;

  if (channels && typeof channels === "object") {
    for (const [key, val] of Object.entries(channels)) {
      if (key === channelId) continue;
      if (!Array.isArray(val)) continue;

      for (const entry of val) {
        if (getMentionsChannel(entry, channelId)) {
          referenced = true;
          out.push(entry);
        }
      }
    }
  }

  return { entries: out, listed: directIsArray || referenced };
}

/************************************************************************************/
/* functionSignature: getMergedOverrides (entries, userId, flow)                     */
/* Builds a single overrides object from all matching entries (later wins)           */
/************************************************************************************/
function getMergedOverrides(entries, userId, flow) {
  const list = Array.isArray(entries) ? entries : [];
  let merged = {};
  const matched = [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!getEntryMatch(entry, userId, flow)) continue;

    const ov = entry?.overrides;
    if (ov && typeof ov === "object") {
      merged = deepMergePlain(merged, ov);
    }

    matched.push({
      index: i,
      description: normalizeStr(entry?.__description) || "rule",
      flows: normalizeStrList(entry?.flows),
      userIds: normalizeStrList(entry?.userIds)
    });
  }

  return { merged, matched };
}

/************************************************************************************/
/* functionSignature: applyOverrides (workingObject, overrides)                      */
/* Applies merged overrides onto workingObject; toolsconfig is deep-merged           */
/************************************************************************************/
function applyOverrides(workingObject, overrides) {
  if (!overrides || typeof overrides !== "object") return 0;

  const { channelallowed: _c, allow: _a, ...rawOverrides } = overrides;

  let appliedKeys = 0;

  for (const [k, v] of Object.entries(rawOverrides)) {
    if (v === undefined || v === null) continue;

    if (k === "toolsconfig" && isPlainObject(v)) {
      workingObject.toolsconfig = deepMergePlain(workingObject.toolsconfig, v);
      appliedKeys++;
      continue;
    }

    if (Array.isArray(v)) {
      workingObject[k] = v.slice();
      appliedKeys++;
      continue;
    }

    workingObject[k] = v;
    appliedKeys++;
  }

  return appliedKeys;
}

/************************************************************************************/
/* functionSignature: getChannelConfig (coreData)                                    */
/* Applies per-channel overrides onto coreData.workingObject                         */
/************************************************************************************/
export default async function getChannelConfig(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const cfg = coreData?.config?.["core-channel-config"];
  if (!cfg || typeof cfg !== "object") return coreData;

  const channels = cfg.channels;
  if (!channels || typeof channels !== "object") return coreData;

  const channelId = normalizeStr(workingObject?.id);
  const userId = normalizeStr(workingObject?.userId ?? workingObject?.userid);
  let flow = normalizeStr(workingObject?.flow);

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

  const { entries, listed } = getChannelEntries(channels, effectiveChannelId);

  if (!listed) {
    log("Channel is not listed — channelallowed=false", "warn", {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId
    });
    return coreData;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    workingObject.channelallowed = true;
    log("Channel listed without rules — channelallowed=true", "info", {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId
    });
    return coreData;
  }

  const { merged, matched } = getMergedOverrides(entries, userId, flow);
  const appliedKeys = applyOverrides(workingObject, merged);

  workingObject.channelallowed = true;

  log(
    matched.length > 0
      ? "Applied cumulative overrides — channelallowed=true"
      : "No matching rules — channelallowed=true (baseline)",
    matched.length > 0 ? "info" : "warn",
    {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId,
      userId: userId || "unknown",
      flow,
      matches: matched.length,
      appliedKeys,
      matchedRules: matched.map(x => ({ index: x.index, description: x.description }))
    }
  );

  return coreData;
}
