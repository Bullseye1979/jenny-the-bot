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
/* Parses the AI response into up to 3 valid mood labels and writes them to        *
/* bard:labels:{guildId} in the registry.                                          *
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

  // Parse: "battle,tension,dark" → ["battle", "tension", "dark"]
  // Tokens longer than 25 chars are LLM error responses mangled into one string — discard them.
  // Deduplicate to avoid repeated tokens from malformed LLM output.
  const raw = [...new Set(
    response
      .split(",")
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
      .filter(t => t.length > 0 && t.length <= 25)
  )];

  const labels   = raw.filter(t => validTags.size === 0 || validTags.has(t)).slice(0, 3);
  const rejected = raw.filter(t => validTags.size > 0 && !validTags.has(t)).slice(0, 5);

  if (rejected.length) {
    log(`rejected invalid tags for guild ${guildId}: ${rejected.join(",")}`, "warn", { moduleName: MODULE_NAME });
  }

  if (!labels.length) {
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
