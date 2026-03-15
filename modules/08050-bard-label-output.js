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

import { putItem } from "../core/registry.js";
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

  const guildId   = getStr(wo._bardGuildId);
  const validList = Array.isArray(wo._bardValidTags) ? wo._bardValidTags : [];
  const validTags = new Set(validList);
  const response  = getStr(wo.response).trim();

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

  const labels = rawParts.map((t, i) => {
    const clean = t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (i < 2) return clean; // location + situation: accept any sanitized value (or empty)
    if (!clean || clean.length > 25) return ""; // malformed or empty mood → blank
    if (validTags.size > 0 && !validTags.has(clean)) return ""; // unknown mood tag → blank
    return clean;
  });

  const rejected = rawParts.slice(2).map(t => {
    const clean = t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return (clean && clean.length <= 25 && validTags.size > 0 && !validTags.has(clean)) ? clean : null;
  }).filter(Boolean).slice(0, 5);

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
