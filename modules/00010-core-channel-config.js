/************************************************************************************/
/* filename: "core-channel-config.js"                                              */
/* Version: 1                                                                      */
/* Purpose: Strict hierarchical overrides for workingObject.                        */
/*          Hierarchy: Channel -> Flow -> User                                      */
/*          Rules:                                                                  */
/*          - Channel applies for the channel regardless of flow                    */
/*          - Within a matched channel entry, exactly ONE flow rule is applied      */
/*            (last matching flow rule wins)                                        */
/*          - Within that flow rule, exactly ONE user rule is applied               */
/*            (last matching user rule wins)                                        */
/*          - Arrays are ALWAYS replaced; plain objects are deep-merged             */
/*          - "channelIDs" is NOT used for matching (context/bleeding elsewhere)    */
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-channel-config";

/************************************************************************************/
/* functionSignature: isPlainObject (v)                                             */
/* Returns true if v is a plain object                                              */
/************************************************************************************/
function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype;
}

/************************************************************************************/
/* functionSignature: normalizeStr (v)                                              */
/* Normalizes a value into a trimmed string                                         */
/************************************************************************************/
function normalizeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/************************************************************************************/
/* functionSignature: normalizeStrList (v)                                          */
/* Normalizes a value into a list of trimmed strings                                */
/************************************************************************************/
function normalizeStrList(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => normalizeStr(x)).filter(Boolean);
}

/************************************************************************************/
/* functionSignature: includesCI (list, value)                                      */
/* Case-insensitive includes for string lists                                       */
/************************************************************************************/
function includesCI(list, value) {
  const v = normalizeStr(value);
  if (!v) return false;

  const vu = v.toUpperCase();
  for (let i = 0; i < list.length; i++) {
    const li = normalizeStr(list[i]);
    if (!li) continue;
    if (li.toUpperCase() === vu) return true;
  }
  return false;
}

/************************************************************************************/
/* functionSignature: deepMergePlain (target, source)                               */
/* Deep merges plain objects; arrays replaced; null/undefined ignored               */
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

    if (isPlainObject(v)) {
      out[k] = deepMergePlain({}, v);
      continue;
    }

    out[k] = v;
  }

  return out;
}

/************************************************************************************/
/* functionSignature: matchChannel (node, channelId)                                */
/* Matches effectiveChannelId against node.channelMatch                             */
/************************************************************************************/
function matchChannel(node, channelId) {
  const list = normalizeStrList(node?.channelMatch);
  if (list.length === 0) return false;
  return list.includes(normalizeStr(channelId));
}

/************************************************************************************/
/* functionSignature: matchFlow (node, flow)                                        */
/* Matches flow against node.flowMatch (case-insensitive)                           */
/************************************************************************************/
function matchFlow(node, flow) {
  const list = normalizeStrList(node?.flowMatch);
  if (list.length === 0) return false;
  return includesCI(list, flow);
}

/************************************************************************************/
/* functionSignature: matchUser (node, userId)                                      */
/* Matches userId against node.userMatch                                            */
/************************************************************************************/
function matchUser(node, userId) {
  const list = normalizeStrList(node?.userMatch);
  if (list.length === 0) return false;
  return list.includes(normalizeStr(userId));
}

/************************************************************************************/
/* functionSignature: applyOverrides (workingObject, overrides)                     */
/* Applies overrides onto workingObject (objects deep-merged, arrays replaced)      */
/************************************************************************************/
function applyOverrides(workingObject, overrides) {
  if (!isPlainObject(workingObject)) return 0;
  if (!isPlainObject(overrides)) return 0;

  const { channelallowed: _c, allow: _a, ...rawOverrides } = overrides;

  let appliedKeys = 0;

  for (const [k, v] of Object.entries(rawOverrides)) {
    if (v === undefined || v === null) continue;

    if (Array.isArray(v)) {
      workingObject[k] = v.slice();
      appliedKeys++;
      continue;
    }

    if (isPlainObject(v) && isPlainObject(workingObject[k])) {
      workingObject[k] = deepMergePlain(workingObject[k], v);
      appliedKeys++;
      continue;
    }

    if (isPlainObject(v)) {
      workingObject[k] = deepMergePlain({}, v);
      appliedKeys++;
      continue;
    }

    workingObject[k] = v;
    appliedKeys++;
  }

  return appliedKeys;
}

/************************************************************************************/
/* functionSignature: getEffectiveChannelId (workingObject)                         */
/* Returns channel id or "DM"                                                      */
/************************************************************************************/
function getEffectiveChannelId(workingObject) {
  const id = normalizeStr(workingObject?.id);

  const chType = workingObject?.channelType;
  const isDM =
    workingObject?.isDM === true ||
    String(chType ?? "").toUpperCase() === "DM" ||
    chType === 1 ||
    (!workingObject?.guildId && !!normalizeStr(workingObject?.userId ?? workingObject?.userid));

  return isDM ? "DM" : id;
}

/************************************************************************************/
/* functionSignature: ensureFlow (workingObject, effectiveChannelId, log)           */
/* Ensures flow exists; for DM defaults to "discord"                                */
/************************************************************************************/
function ensureFlow(workingObject, effectiveChannelId, log) {
  let flow = normalizeStr(workingObject?.flow);

  if (!flow && normalizeStr(effectiveChannelId).toUpperCase() === "DM") {
    flow = "discord";
    workingObject.flow = flow;
    log("Flow was empty for DM — defaulted to 'discord'", "info", { moduleName: MODULE_NAME });
  }

  return flow;
}

/************************************************************************************/
/* functionSignature: pickLastMatchingIndex (list, matcherFn)                       */
/* Returns { index, count } where index is last matching element index              */
/************************************************************************************/
function pickLastMatchingIndex(list, matcherFn) {
  const arr = Array.isArray(list) ? list : [];
  let index = -1;
  let count = 0;

  for (let i = 0; i < arr.length; i++) {
    if (!matcherFn(arr[i])) continue;
    index = i;
    count++;
  }

  return { index, count };
}

/************************************************************************************/
/* functionSignature: applyStrictHierarchy (workingObject, cfgChannels, channelId,  */
/*                         flow, userId)                                            */
/* Channel -> exactly one Flow (last match) -> exactly one User (last match)         */
/************************************************************************************/
function applyStrictHierarchy(workingObject, cfgChannels, channelId, flow, userId) {
  const channels = Array.isArray(cfgChannels) ? cfgChannels : [];

  const matchedRules = [];
  const warnings = [];

  let appliedKeys = 0;

  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    if (!matchChannel(ch, channelId)) continue;

    appliedKeys += applyOverrides(workingObject, ch?.overrides);

    matchedRules.push({
      level: "channel",
      path: { c },
      description: normalizeStr(ch?.__description) || normalizeStr(ch?.description) || "channel"
    });

    const flows = Array.isArray(ch?.flows) ? ch.flows : [];
    const flowPick = pickLastMatchingIndex(flows, fl => matchFlow(fl, flow));

    if (flowPick.count > 1) {
      warnings.push({
        type: "multipleFlowMatches",
        channelPath: { c },
        flow,
        matches: flowPick.count,
        pickedIndex: flowPick.index
      });
    }

    if (flowPick.index < 0) continue;

    const fl = flows[flowPick.index];
    appliedKeys += applyOverrides(workingObject, fl?.overrides);

    matchedRules.push({
      level: "flow",
      path: { c, f: flowPick.index },
      description: normalizeStr(fl?.__description) || normalizeStr(fl?.description) || "flow"
    });

    const users = Array.isArray(fl?.users) ? fl.users : [];
    const userPick = pickLastMatchingIndex(users, us => matchUser(us, userId));

    if (userPick.count > 1) {
      warnings.push({
        type: "multipleUserMatches",
        channelPath: { c, f: flowPick.index },
        userId: userId || "unknown",
        matches: userPick.count,
        pickedIndex: userPick.index
      });
    }

    if (userPick.index < 0) continue;

    const us = users[userPick.index];
    appliedKeys += applyOverrides(workingObject, us?.overrides);

    matchedRules.push({
      level: "user",
      path: { c, f: flowPick.index, u: userPick.index },
      description: normalizeStr(us?.__description) || normalizeStr(us?.description) || "user"
    });
  }

  return { appliedKeys, matchedRules, warnings };
}

/************************************************************************************/
/* functionSignature: getChannelConfig (coreData)                                   */
/* Applies hierarchical overrides onto coreData.workingObject                        */
/************************************************************************************/
export default async function getChannelConfig(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const cfg = coreData?.config?.["core-channel-config"];
  if (!cfg || typeof cfg !== "object") return coreData;

  const channels = cfg.channels;
  if (!Array.isArray(channels)) return coreData;

  const userId = normalizeStr(workingObject?.userId ?? workingObject?.userid);
  const effectiveChannelId = getEffectiveChannelId(workingObject);
  const flow = ensureFlow(workingObject, effectiveChannelId, log);

  workingObject.channelallowed = false;

  if (!effectiveChannelId) {
    log("Missing channel id — channelallowed=false", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (!flow) {
    log("Missing flow context — channelallowed=false", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const anyChannelMatch = channels.some(ch => matchChannel(ch, effectiveChannelId));
  if (!anyChannelMatch) {
    log("Channel is not listed — channelallowed=false", "warn", {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId
    });
    return coreData;
  }

  const { appliedKeys, matchedRules, warnings } = applyStrictHierarchy(
    workingObject,
    channels,
    effectiveChannelId,
    flow,
    userId
  );

  workingObject.channelallowed = true;

  const level = warnings.length > 0 ? "warn" : (matchedRules.length > 0 ? "info" : "warn");

  log(
    "Applied strict hierarchy — channelallowed=true",
    level,
    {
      moduleName: MODULE_NAME,
      channelId: effectiveChannelId,
      userId: userId || "unknown",
      flow,
      matches: matchedRules.length,
      appliedKeys,
      matchedRules,
      warnings
    }
  );

  return coreData;
}
