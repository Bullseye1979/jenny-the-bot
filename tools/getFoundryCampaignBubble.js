/**************************************************************/
/* filename: "getFoundryCampaignBubble.js"                   */
/* Version 1.0                                               */
/* Purpose: Build a campaign bubble from the currently       */
/* selected Foundry journals in a dedicated specialist       */
/* context at call time.                                     */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";
import { invokeFoundrySpecialist } from "./_foundry-specialist-client.js";

const MODULE_NAME = "getFoundryCampaignBubble";

function getTrimmed(value) {
  return String(value || "").trim();
}

function buildPrompt(query, selected) {
  const entries = Array.isArray(selected?.entries) ? selected.entries : [];
  const entryBlocks = entries.map((entry) => {
    const pages = Array.isArray(entry?.pages) ? entry.pages : [];
    const pageText = pages
      .map((page) => {
        const text = getTrimmed(page?.text || "");
        return text ? `Page: ${page?.name || "Unnamed"}\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    return [
      `Journal ${entry?.order || "?"}/${entry?.totalSelected || entries.length}: ${entry?.name || "Unnamed"}`,
      Array.isArray(entry?.folderPath) && entry.folderPath.length ? `Path: ${entry.folderPath.join(" / ")}` : "",
      pageText
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");

  return [
    "Build a compact Foundry campaign story bubble from the selected journals below.",
    "Answer only from these selected journals plus any small status-file references you choose to load.",
    "Focus on temporal and spatial proximity, the earliest still-unresolved local play state, nearby likely events, and what should be checked next if the selection is insufficient.",
    "Keep the result concise and playable for the next 10 to 15 turns.",
    `Question: ${query}`,
    "",
    "Selected journals:",
    entryBlocks || "(none selected)"
  ].join("\n");
}

async function getInvoke(args, coreData) {
  const prompt = getTrimmed(args?.prompt || args?.query);
  if (!prompt) {
    return { ok: false, error: "prompt is required." };
  }

  const selected = await invokeFoundryTool(MODULE_NAME, "selectedjournals", {
    channelKey: args?.channelKey,
    includeContent: true
  }, coreData);

  if (!selected?.ok) {
    return selected;
  }

  const selectedCount = Number(selected?.count || 0);
  if (selectedCount < 1) {
    return {
      ok: true,
      response: "",
      note: "No Foundry journals are currently selected."
    };
  }

  return invokeFoundrySpecialist("campaign", {
    channelId: args?.channelId,
    prompt: buildPrompt(prompt, selected)
  }, coreData, {
    timeoutMs: 300000,
    doNotWriteToContext: true
  });
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
