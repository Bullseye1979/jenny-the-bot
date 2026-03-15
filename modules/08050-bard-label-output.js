/************************************************************************************/
/* filename: bard-label-output.js                                                  */
/* Version 1.0                                                                     */
/* Purpose: Output module for the bard-label-gen flow. Reads wo.response from     */
/*          core-ai-completions, parses the comma-separated tag list, validates    */
/*          against wo._bardValidTags, and writes bard:labels:{guildId} to the    */
/*          registry. Also writes bard:lastrun:{guildId} only on success, so that  */
/*          a failed AI call does not advance the context window and cause the     */
/*          system to get permanently stuck with no new context to process.        */
/************************************************************************************/

import { getItem, putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-label-output";

/************************************************************************************/
/* functionSignature: getStr(v)                                                    *
/* Returns string value; empty string for nullish.                                 *
/************************************************************************************/
function getStr(v) {
  return v == null ? "" : String(v);
}

/************************************************************************************/
/* functionSignature: getBardLabelOutput(coreData)                                 *
/* Parses the AI response into a 6-position structured label array and writes it   *
/* to bard:labels:{guildId} in the registry.                                       *
/* Label structure: [location, situation, mood1, mood2, mood3, mood4]              *
/* Positions 0-1 (location/situation) may be empty strings.                        *
/* Positions 2-5 (moods) are validated against validTags; invalid = blanked.      *
/************************************************************************************/
export default async function getBardLabelOutput(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (getStr(wo?.flow) !== "bard-label-gen") return coreData;

  const guildId      = getStr(wo._bardGuildId);
  const validList    = Array.isArray(wo._bardValidTags)   ? wo._bardValidTags   : [];
  const validTags    = new Set(validList);
  const locationSet  = new Set(Array.isArray(wo._bardLocations)  ? wo._bardLocations  : []);
  const situationSet = new Set(Array.isArray(wo._bardSituations) ? wo._bardSituations : []);
  const response     = getStr(wo.response).trim();

  if (!guildId) {
    log("no _bardGuildId on workingObject — skipping label write", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (!response) {
    log(`no AI response for guild ${guildId} — skipping label write`, "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  // Parse structured 6-position response: "tavern,combat,dark,tense,intense,battle"
  // Positions 0-1 (location, situation) may be empty strings → wildcard.
  // Positions 2-5 (moods) are validated against validTags; invalid or overlong tags → blank.
  const rawParts = response.split(",").slice(0, 6);
  while (rawParts.length < 6) rawParts.push(""); // pad to 6 if AI returned fewer

  const sanitized = rawParts.map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""));

  // Position rescue: scan ALL 6 positions and assign each value to the correct
  // slot purely by category membership, regardless of where the AI placed it.
  // Example: ['', 'dungeon', 'joy', 'fun', 'tense', 'battle']
  //   → 'dungeon' ∈ locationSet  → loc = 'dungeon'
  //   → 'battle'  ∈ situationSet → sit = 'battle'
  //   → result:   ['dungeon', 'battle', 'joy', 'fun', 'tense', '']
  let loc = "";
  let sit = "";
  const moodValues   = [];
  const usedIndices  = new Set();

  for (let i = 0; i < sanitized.length; i++) {
    const v = sanitized[i];
    if (!v || v.length > 25) continue;
    if (!loc && locationSet.size > 0 && locationSet.has(v)) {
      loc = v;
      usedIndices.add(i);
      if (i !== 0) log(`rescued location "${loc}" from position ${i} for guild ${guildId}`, "info", { moduleName: MODULE_NAME });
    } else if (!sit && situationSet.size > 0 && situationSet.has(v)) {
      sit = v;
      usedIndices.add(i);
      if (i !== 1) log(`rescued situation "${sit}" from position ${i} for guild ${guildId}`, "info", { moduleName: MODULE_NAME });
    } else if (moodValues.length < 4 && validTags.size > 0 && validTags.has(v)) {
      moodValues.push(v);
      usedIndices.add(i);
    }
  }

  // Fallback: unknown words at original positions 0/1 accepted as-is
  // (AI invented a new location/situation word not yet in the library)
  if (!loc && sanitized[0] && !usedIndices.has(0)) loc = sanitized[0];
  if (!sit && sanitized[1] && !usedIndices.has(1)) sit = sanitized[1];

  // Carry-forward: if the AI left location/situation empty ("I don't know"),
  // inherit the last known value from the stored labels so the label state
  // doesn't degrade to empty when the AI is uncertain.
  // Mood slots are NOT carried forward — empty mood = "unknown this cycle".
  if (!loc || !sit) {
    try {
      const prev = await getItem(`bard:labels:${guildId}`);
      const prevLabels = Array.isArray(prev?.labels) ? prev.labels : [];
      if (!loc && prevLabels[0]) loc = String(prevLabels[0]);
      if (!sit && prevLabels[1]) sit = String(prevLabels[1]);
    } catch {}
  }

  while (moodValues.length < 4) moodValues.push("");
  const labels = [loc, sit, ...moodValues];

  const rejected = sanitized.slice(2)
    .filter((v, i) => v && !usedIndices.has(i + 2) && validTags.size > 0 && !validTags.has(v) && v.length <= 25)
    .slice(0, 5);

  if (rejected.length) {
    log(`rejected invalid mood tags for guild ${guildId}: ${rejected.join(",")}`, "warn", { moduleName: MODULE_NAME });
  }

  if (!labels.some(Boolean)) {
    log(`AI returned no valid labels for guild ${guildId} (raw: "${response}")`, "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const labelsEntry = {
    labels,
    rejected,
    guildId,
    updatedAt: new Date().toISOString()
  };

  await putItem(labelsEntry, `bard:labels:${guildId}`);

  log(`labels written for guild ${guildId}: ${labels.join(",")}`, "info", {
    moduleName: MODULE_NAME,
    labels,
    guildId
  });

  // Write lastrun timestamp only after a successful label write.
  // bard-cron intentionally does NOT write this so that a failed AI call
  // does not advance the context window — the next run would otherwise find
  // no new messages and skip forever (stuck-lastrun bug).
  const lastRunKey = getStr(wo._bardLastRunKey);
  const lastRunTs  = getStr(wo._bardLastRunTs);
  if (lastRunKey && lastRunTs) {
    try {
      await putItem({ ts: lastRunTs, guildId }, lastRunKey);
    } catch (e) {
      log(`failed to write lastrun for guild ${guildId}: ${e?.message}`, "warn", { moduleName: MODULE_NAME });
    }
  }

  return coreData;
}
