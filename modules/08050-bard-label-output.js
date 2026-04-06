










import { getItem, putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-label-output";


function getStr(v) {
  return v == null ? "" : String(v);
}


export default async function getBardLabelOutput(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (getStr(wo?.flow) !== "bard-label-gen") return coreData;

  const channelId    = getStr(wo._bardChannelId);
  const validList    = Array.isArray(wo._bardValidTags)   ? wo._bardValidTags   : [];
  const validTags    = new Set(validList);
  const locationSet  = new Set(Array.isArray(wo._bardLocations)  ? wo._bardLocations  : []);
  const situationSet = new Set(Array.isArray(wo._bardSituations) ? wo._bardSituations : []);
  const response     = getStr(wo.response).trim();

  if (!channelId) {
    log("no _bardChannelId on workingObject — skipping label write", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (!response) {
    log(`no AI response for channel ${channelId} — skipping label write`, "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const rawParts = response.split(",").slice(0, 6);
  while (rawParts.length < 6) rawParts.push("");

  const sanitized = rawParts.map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""));

  let prevLabels = [];
  try {
    const prev = await getItem(`bard:labels:${channelId}`);
    prevLabels = Array.isArray(prev?.labels) ? prev.labels : [];
  } catch {}
  const prevLoc = (prevLabels[0] || "").toLowerCase();
  const prevSit = (prevLabels[1] || "").toLowerCase();

  let loc = "";
  let sit = "";
  const moodValues  = [];
  const usedIndices = new Set();

  for (let i = 0; i < sanitized.length; i++) {
    const v = sanitized[i];
    if (!v || v.length > 25) continue;
    if (!loc && locationSet.size > 0 && locationSet.has(v)) {
      loc = v; usedIndices.add(i);
      if (i !== 0) log(`rescued location "${loc}" from position ${i} for channel ${channelId}`, "info", { moduleName: MODULE_NAME });
    } else if (!sit && situationSet.size > 0 && situationSet.has(v)) {
      sit = v; usedIndices.add(i);
      if (i !== 1) log(`rescued situation "${sit}" from position ${i} for channel ${channelId}`, "info", { moduleName: MODULE_NAME });
    }
  }

  if (loc && loc === prevLoc && locationSet.size > 0) {
    for (let i = 0; i < sanitized.length; i++) {
      if (usedIndices.has(i)) continue;
      const v = sanitized[i];
      if (!v || v.length > 25) continue;
      if (locationSet.has(v) && v !== loc) {
        log(`location scene-change: "${loc}" → "${v}" for channel ${channelId}`, "info", { moduleName: MODULE_NAME });
        usedIndices.delete(sanitized.indexOf(loc));
        loc = v; usedIndices.add(i);
        break;
      }
    }
  }
  if (sit && sit === prevSit && situationSet.size > 0) {
    for (let i = 0; i < sanitized.length; i++) {
      if (usedIndices.has(i)) continue;
      const v = sanitized[i];
      if (!v || v.length > 25) continue;
      if (situationSet.has(v) && v !== sit) {
        log(`situation scene-change: "${sit}" → "${v}" for channel ${channelId}`, "info", { moduleName: MODULE_NAME });
        usedIndices.delete(sanitized.indexOf(sit));
        sit = v; usedIndices.add(i);
        break;
      }
    }
  }

  for (let i = 2; i < sanitized.length; i++) {
    if (usedIndices.has(i)) continue;
    const v = sanitized[i];
    if (!v || v.length > 25) continue;
    if (moodValues.length < 4 && validTags.size > 0 && validTags.has(v)
        && !locationSet.has(v) && !situationSet.has(v)) {
      moodValues.push(v); usedIndices.add(i);
    }
  }

  if (!loc && sanitized[0] && !usedIndices.has(0)) { loc = sanitized[0]; usedIndices.add(0); }
  if (!sit && sanitized[1] && !usedIndices.has(1)) { sit = sanitized[1]; usedIndices.add(1); }

  if (!loc && prevLabels[0]) loc = String(prevLabels[0]);
  if (!loc) {
    try {
      const stream = await getItem(`bard:stream:${channelId}`);
      const songTags = Array.isArray(stream?.trackTags) ? stream.trackTags : [];
      const isSelectedAsDefault = !!stream?.selectedAsDefault;
      if (!isSelectedAsDefault && songTags[0]) { loc = String(songTags[0]); log(`location fallback from current song: "${loc}" for channel ${channelId}`, "info", { moduleName: MODULE_NAME }); }
    } catch {}
  }
  if (!loc && locationSet.size > 0) {
    const locs = [...locationSet];
    loc = locs[Math.floor(Math.random() * locs.length)];
    log(`location initialized to random value "${loc}" for channel ${channelId}`, "info", { moduleName: MODULE_NAME });
  }

  while (moodValues.length < 4) moodValues.push("");
  const labels = [loc, sit, ...moodValues];

  const rejected = sanitized.slice(2)
    .filter((v, i) => v && !usedIndices.has(i + 2) && validTags.size > 0 && !validTags.has(v) && v.length <= 25)
    .slice(0, 5);

  if (rejected.length) {
    log(`rejected invalid mood tags for channel ${channelId}: ${rejected.join(",")}`, "warn", { moduleName: MODULE_NAME });
  }

  if (!labels.some(Boolean)) {
    log(`AI returned no valid labels for channel ${channelId} (raw: "${response}")`, "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const labelsEntry = {
    labels,
    rejected,
    channelId,
    updatedAt: new Date().toISOString()
  };

  await putItem(labelsEntry, `bard:labels:${channelId}`);

  log(`labels written for channel ${channelId}: ${labels.join(",")}`, "info", {
    moduleName: MODULE_NAME,
    labels,
    channelId
  });

  const lastRunKey = getStr(wo._bardLastRunKey);
  const lastRunTs  = getStr(wo._bardLastRunTs);
  if (lastRunKey && lastRunTs) {
    try {
      await putItem({ ts: lastRunTs, channelId }, lastRunKey);
    } catch (e) {
      log(`failed to write lastrun for channel ${channelId}: ${e?.message}`, "warn", { moduleName: MODULE_NAME });
    }
  }

  return coreData;
}
