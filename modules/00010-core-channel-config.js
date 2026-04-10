/**************************************************************/
/* filename: "00010-core-channel-config.js"                         */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/






import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-channel-config";


function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype;
}


function normalizeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}


function normalizeStrList(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => normalizeStr(x)).filter(Boolean);
}


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


function matchChannel(node, channelId) {
  const list = normalizeStrList(node?.channelMatch);
  if (list.length === 0) return false;
  return includesCI(list, channelId);
}


function matchFlow(node, flow) {
  const list = normalizeStrList(node?.flowMatch);
  if (list.length === 0) return false;
  return includesCI(list, flow);
}


function matchUser(node, userId) {
  const list = normalizeStrList(node?.userMatch);
  if (list.length === 0) return false;
  return list.includes(normalizeStr(userId));
}


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


function getEffectiveChannelId(workingObject) {
  const id = normalizeStr(
    workingObject?.channelID ??
    workingObject?.message?.channelId
  );

  const chType = workingObject?.channelType;
  const isDM =
    workingObject?.isDM === true ||
    String(chType ?? "").toUpperCase() === "DM" ||
    chType === 1 ||
    (workingObject?.isDM !== false && !workingObject?.guildId && !!normalizeStr(workingObject?.userId));

  return isDM ? "DM" : id;
}


function ensureFlow(workingObject, effectiveChannelId, log) {
  const overrideFlow = normalizeStr(workingObject?.overrideFlow);
  if (overrideFlow) return overrideFlow;

  let flow = normalizeStr(workingObject?.flow);

  if (!flow && normalizeStr(effectiveChannelId).toUpperCase() === "DM") {
    flow = "discord";
    workingObject.flow = flow;
    log("Flow was empty for DM — defaulted to 'discord'", "info", { moduleName: MODULE_NAME });
  }

  return flow;
}


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


export function applyChannelConfig(workingObject, config, channelId, flow, userId) {
  const channels = config?.["core-channel-config"]?.channels;
  if (!Array.isArray(channels) || !channelId || !flow) return;
  if (!channels.some(ch => matchChannel(ch, channelId))) return;
  applyStrictHierarchy(workingObject, channels, channelId, flow, userId || "");
  workingObject.channelallowed = true;
}


export default async function getChannelConfig(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const cfg = coreData?.config?.["core-channel-config"];
  if (!cfg || typeof cfg !== "object") return coreData;

  const channels = cfg.channels;
  if (!Array.isArray(channels)) return coreData;

  const userId = normalizeStr(workingObject?.userId);
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
