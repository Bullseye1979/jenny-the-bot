/**************************************************************/
/* filename: "getFoundryPlayerBubble.js"                     */
/* Version 1.0                                               */
/* Purpose: Build a player/character bubble from the         */
/* currently selected Foundry players in a dedicated         */
/* specialist context at call time.                          */
/**************************************************************/

import { invokeFoundryTool } from "./_foundry-client.js";
import { invokeFoundrySpecialist } from "./_foundry-specialist-client.js";

const MODULE_NAME = "getFoundryPlayerBubble";

function getTrimmed(value) {
  return String(value || "").trim();
}

function buildPrompt(query, selected) {
  const players = Array.isArray(selected?.players) ? selected.players : [];
  const playerBlocks = players.map((player) => [
    `Player: ${player?.userName || "Unknown"}`,
    `Foundry user ID: ${player?.userId || "-"}`,
    `Source: ${player?.source || "-"}`,
    `Actor ID: ${player?.actorId || "-"}`,
    `DnDBeyond ID: ${player?.dndbeyondId || "-"}`,
    player?.actorSummary ? `Foundry actor summary JSON:\n${JSON.stringify(player.actorSummary, null, 2)}` : ""
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  return [
    "Answer the player or character question using the selected player roster below.",
    "If a player is DnDBeyond-bound, resolve them through getDnDBeyondCharacter when needed.",
    "If a player is Foundry-bound, resolve them through Foundry actor tools when needed.",
    "Keep the answer concise and focused on the current play need.",
    `Question: ${query}`,
    "",
    "Selected players:",
    playerBlocks || "(none selected)"
  ].join("\n");
}

async function getInvoke(args, coreData) {
  const prompt = getTrimmed(args?.prompt || args?.query);
  if (!prompt) {
    return { ok: false, error: "prompt is required." };
  }

  const selected = await invokeFoundryTool(MODULE_NAME, "selectedplayers", {
    channelKey: args?.channelKey
  }, coreData);

  if (!selected?.ok) {
    return selected;
  }

  const selectedCount = Number(selected?.count || 0);
  if (selectedCount < 1) {
    return {
      ok: true,
      response: "",
      note: "No Foundry players are currently selected."
    };
  }

  return invokeFoundrySpecialist("party", {
    channelId: args?.channelId,
    prompt: buildPrompt(prompt, selected)
  }, coreData, {
    timeoutMs: 180000,
    doNotWriteToContext: true
  });
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
