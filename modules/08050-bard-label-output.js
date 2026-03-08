/************************************************************************************/
/* filename: bard-label-output.js                                                  *
/* Version 1.0                                                                     *
/* Purpose: Output module for the bard-label-gen flow. Reads wo.response from     *
/*          core-ai-completions, parses the comma-separated tag list, validates    *
/*          against wo._bardValidTags, and writes bard:labels:{guildId} to the    *
/*          registry.                                                               *
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
  const raw = response
    .split(",")
    .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean);

  const labels   = raw.filter(t => validTags.size === 0 || validTags.has(t)).slice(0, 3);
  const rejected = raw.filter(t => validTags.size > 0 && !validTags.has(t));

  if (rejected.length) {
    log(`rejected invalid tags for guild ${guildId}: ${rejected.join(",")}`, "warn", { moduleName: MODULE_NAME });
  }

  if (!labels.length) {
    log(`AI returned no valid labels for guild ${guildId} (raw: "${response}")`, "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const labelsEntry = {
    labels,
    guildId,
    updatedAt: new Date().toISOString()
  };

  await putItem(labelsEntry, `bard:labels:${guildId}`);

  log(`labels written for guild ${guildId}: ${labels.join(",")}`, "info", {
    moduleName: MODULE_NAME,
    labels,
    guildId
  });

  return coreData;
}
