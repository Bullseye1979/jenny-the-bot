/**************************************************************/
/* filename: "getFoundryCampaignCrawler.js"                  */
/* Version 1.0                                               */
/* Purpose: Build a Foundry campaign tree markdown via the   */
/* existing Jenny /api runtime and the foundry-journal       */
/* specialist channel.                                       */
/**************************************************************/

import { randomBytes } from "node:crypto";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getFoundryCampaignCrawler";
const CASCADED_OVERRIDE_FIELDS = ["model", "endpoint", "endpointResponses", "useAiModule", "apiKey", "maxTokens", "temperature"];

function getErrorResult(code, message, details = {}) {
  return {
    ok: false,
    error: String(message || code || "unknown_error"),
    error_status: {
      source: MODULE_NAME,
      code: String(code || "unknown_error"),
      message: String(message || code || "unknown_error")
    },
    ...details
  };
}

function getTrimmed(value) {
  return String(value || "").trim();
}

function getWorkingObjectPatch(wo) {
  if (!wo || typeof wo !== "object") return undefined;
  const patch = {};
  if (wo.toolsconfig && typeof wo.toolsconfig === "object") {
    patch.toolsconfig = JSON.parse(JSON.stringify(wo.toolsconfig));
  }
  if (Array.isArray(wo.channelIds)) patch.channelIds = [...wo.channelIds];
  if (Array.isArray(wo.callerChannelIds)) patch.callerChannelIds = [...wo.callerChannelIds];
  if (wo.callerChannelId && typeof wo.callerChannelId === "string") patch.callerChannelId = wo.callerChannelId;
  patch.bypassTriggerGate = true;
  for (const key of CASCADED_OVERRIDE_FIELDS) {
    if (wo[key] != null) patch[key] = wo[key];
  }
  return patch;
}

function getPrompt({
  outputPath,
  query,
  channelKey,
  rebuild = true
}) {
  return [
    "Build a Foundry campaign navigation tree markdown file from the full Foundry journal corpus.",
    `Output path: \`${outputPath}\`.`,
    `Foundry bridge channel key: \`${channelKey}\`.`,
    rebuild ? "Treat this as a full rebuild of the target file." : "Update the existing target file conservatively if it already exists.",
    query ? `Focus hint: ${query}` : "No focus hint was provided; cover the full campaign tree.",
    "",
    "Required workflow:",
    "1. Use `getFoundryJournal` with `operation='crawl'` and continue with `nextCursor` until `hasMore=false`.",
    "2. Build a tree-shaped markdown navigation file with folder hierarchy, journal entries, short summaries, and direct read references.",
    "3. For important entries whose crawl summary is too vague, use `getFoundryJournal` with `operation='read'` in paginated form to refine the short summary.",
    "4. Preserve journal names exactly as found in Foundry.",
    "5. Write the result to the requested markdown file. If it is too large, write it in ordered chunks with `getFile` using `chunkIndex` and `totalChunks`.",
    "6. Verify the final file with `getFileContent` and do not stop until the whole tree is present.",
    "",
    "Required markdown structure:",
    "# Foundry Campaign Tree",
    "",
    "## Summary",
    "- Campaign / module title if inferable",
    "- High-level premise",
    "- How to use this file for navigation",
    "",
    "## Root Navigation",
    "- Root folders",
    "- Root entries",
    "",
    "## Tree",
    "- Represent folders and journal entries as a nested tree using headings and flat bullets.",
    "- For each entry include:",
    "  - Exact journal name",
    "  - Folder path",
    "  - Short summary in 1-3 sentences",
    "  - Category / purpose hint if known",
    "  - Direct journal read reference",
    "  - Page references",
    "  - Links to relevant subentries or neighboring entries",
    "",
    "## Entry Points",
    "- Likely playable starts or resume points",
    "",
    "## Navigation Hints",
    "- Which journals to read next for scenes, locations, factions, NPCs, and chapter transitions",
    "",
    "Return a concise success message plus the final output path after the file is written and verified."
  ].join("\n");
}

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};
  const specialistsCfg = wo?.toolsconfig?.getSpecialists || {};
  const specialistBase = getTrimmed(cfg.channelId || specialistsCfg?.types?.["foundry-journal"]);
  if (!specialistBase) {
    return getErrorResult("crawler_channel_missing", "No Foundry journal specialist channel is configured.");
  }

  const outputPath = getTrimmed(args?.outputPath || cfg.outputPath || "dm-notebook/status/foundry-campaign-tree.md");
  const query = getTrimmed(args?.query || "");
  const channelKey = getTrimmed(args?.channelKey || wo?.toolsconfig?.getFoundryBridge?.channelKey || "foundry");
  const apiBase = getTrimmed(cfg.apiUrl || specialistsCfg.apiUrl || "http://localhost:3400");
  const apiSecretAlias = getTrimmed(cfg.apiSecret || specialistsCfg.apiSecret || "API_SECRET");
  const apiSecret = apiSecretAlias ? await getSecret(wo, apiSecretAlias) : "";
  const timeoutMs = Number.isFinite(Number(cfg.timeoutMs)) ? Number(cfg.timeoutMs) : 604800000;
  const channelId = `${specialistBase}-${randomBytes(6).toString("hex")}`;

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers.Authorization = `Bearer ${apiSecret}`;

  const body = JSON.stringify({
    channelId,
    payload: getPrompt({
      outputPath,
      query,
      channelKey,
      rebuild: args?.rebuild !== false
    }),
    userId: String(wo.userId || ""),
    guildId: String(wo.guildId || ""),
    callerChannelId: String(wo.channelId || ""),
    callerChannelIds: Array.isArray(wo.channelIds) ? wo.channelIds.filter(Boolean) : [],
    callerTurnId: String(wo.turnId || wo.callerTurnId || ""),
    callerFlow: String(wo.flow || ""),
    agentDepth: (Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0) + 1,
    agentType: "foundry-journal",
    toolcallScope: String(wo.toolcallScope || wo.callerFlow || wo.flow || "").trim(),
    ...(wo.toolStatusChannelOverride ? { toolStatusChannelOverride: String(wo.toolStatusChannelOverride).trim() } : {}),
    workingObjectPatch: getWorkingObjectPatch(wo)
  });

  log(`Starting Foundry campaign crawler in channel "${channelId}" targeting "${outputPath}"`);

  try {
    const res = await fetchWithTimeout(`${apiBase}/api`, { method: "POST", headers, body }, timeoutMs);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return getErrorResult("crawler_http_error", data.error || `HTTP ${res.status}`, {
        httpStatus: res.status,
        details: data
      });
    }

    const responseText = String(data.response || "");
    if (!responseText || responseText.startsWith("[Empty AI response]") || responseText.startsWith("[Max Loops Hit]")) {
      return getErrorResult("crawler_empty_response", responseText || "Crawler returned empty response", {
        channelId,
        outputPath
      });
    }

    return {
      ok: true,
      channelId,
      outputPath,
      response: responseText
    };
  } catch (error) {
    return getErrorResult("crawler_request_failed", error?.message || String(error), {
      channelId,
      outputPath
    });
  }
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
