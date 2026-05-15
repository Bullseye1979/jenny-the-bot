/************************************************************************************/
/* filename: foundry-bridge.js                                                      */
/* Version 2.0                                                                      */
/* Purpose: Dedicated HTTP bridge flow for Foundry polling/result callbacks.        */
/* Hardcoded loops: Encounter → Initiative → Combat → Reaction                     */
/* AI handles: story, decisions, clarifications. Engine handles: flow.             */
/************************************************************************************/

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { claimNextFoundryBridgeRequest, completeFoundryBridgeRequest, getFoundryBridgeConfig } from "../shared/foundry-bridge.js";
import { getSecret } from "../core/secrets.js";
import { getContext, setContext, setPurgeContext } from "../core/context.js";
import { getNewUlid } from "../core/utils.js";
import {
  buildCharacterMarkdown,
  buildPartyStateMarkdown,
  buildProgressMarkdown,
  buildStoryBubbleMarkdown,
  createInitialRoundState,
  ensureFoundryMarkdownFiles,
  getFoundryStatusDir,
  readRoundState,
  resetFoundryNotebook,
  writeCharacterMarkdown,
  writeRoundState
} from "../core/foundry-rounds.js";

// Timer registry for reaction windows keyed by channelKey
const combatTimers = new Map();

function clearCombatTimer(channelKey) {
  const t = combatTimers.get(channelKey);
  if (t) {
    clearTimeout(t);
    combatTimers.delete(channelKey);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function getJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  setCorsHeaders(res);
  res.end(JSON.stringify(body));
}

function getReadBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > max) {
        aborted = true;
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

function getBearerToken(req) {
  const auth = String(req.headers?.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

async function isBridgeBearerValid(req, baseCore, flowCfg) {
  const bridgeCfg = getFoundryBridgeConfig(baseCore?.workingObject || {}, flowCfg);
  const alias = String(bridgeCfg.apiSecret || "").trim();
  if (!alias) return false;
  const secret = await getSecret(baseCore?.workingObject, alias);
  if (!secret) return false;
  return getBearerToken(req) === secret;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function normalize(value) {
  return String(value ?? "").trim();
}

function getSlug(value, fallback = "foundry") {
  return normalize(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function getJsonFenceContent(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw;
}

function safeParseJson(text, fallback = null) {
  try {
    return JSON.parse(getJsonFenceContent(text));
  } catch {
    return fallback;
  }
}

function getPlayerLabel(player) {
  return normalize(player?.characterName || player?.userName || player?.userId || "Player");
}

/** True when the player signals they are done and want to proceed without more follow-ups. */
function isOkSignal(text) {
  const t = normalize(text).toLowerCase();
  return /^(ok|okay|ready|fertig|weiter|go|proceed|ja|yes|done|continue|los|bereit|skip)[!.]*$/.test(t);
}

/**
 * Parses a DM override command from a message.
 * Syntax: !dm <command>  or  /dm <command>
 * Returns { command, arg } or null if not an override.
 */
function parseOverrideCommand(text) {
  const t = normalize(text);
  const match = t.match(/^[!/]dm\s+(\S+)(?:\s+(.*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: normalize(match[2] || "") };
}

function getRoundInputText(payload) {
  if (typeof payload?.content === "string" && payload.content.trim()) return payload.content.trim();
  if (typeof payload?.payload === "string" && payload.payload.trim()) return payload.payload.trim();
  return "";
}

function extractFirstRollTotal(message) {
  if (Array.isArray(message?.rolls)) {
    const first = message.rolls.find((entry) => Number.isFinite(Number(entry?.total)));
    if (first) return Number(first.total);
  }
  const text = [message?.content, message?.rollSummary].map((v) => String(v || "")).join("\n");
  const match = text.match(/(?:=|:\s*)(-?\d+)(?!.*(?:=|:\s*)(-?\d+))/);
  if (match) return Number(match[1]);
  return null;
}

// ─── Specialist channels ───────────────────────────────────────────────────────

function getSpecialistChannels(channelId) {
  const base = getSlug(channelId);
  return {
    campaign: `subagent-foundry-campaign-${base}`,
    party: `subagent-foundry-party-${base}`,
    ops: `subagent-foundry-ops-${base}`,
    director: `subagent-foundry-director-${base}`,
    narrator: `subagent-foundry-narrator-${base}`
  };
}

// ─── State sync ───────────────────────────────────────────────────────────────

function syncInitiativeStateFromResult(state, result, playerEntries = []) {
  state.initiative.combatId = normalize(result?.combat?.id || state.initiative.combatId);
  state.initiative.turnOrder = (Array.isArray(result?.combatants) ? [...result.combatants] : [])
    .sort((a, b) => {
      const left = Number(a?.initiative);
      const right = Number(b?.initiative);
      if (Number.isFinite(right) && Number.isFinite(left)) return right - left;
      if (Number.isFinite(right)) return 1;
      if (Number.isFinite(left)) return -1;
      return 0;
    });
  state.initiative.currentTurnIndex = Number(result?.combat?.turn ?? state.initiative.currentTurnIndex ?? 0);
  state.initiative.actorBindings = state.initiative.turnOrder.map((combatant) => ({
    combatantId: normalize(combatant?.id),
    name: normalize(combatant?.name),
    actorId: normalize(combatant?.actorId),
    actorUuid: normalize(combatant?.actorUuid),
    userId: (playerEntries || []).find((entry) =>
      (normalize(entry.actorId) && normalize(entry.actorId) === normalize(combatant?.actorId))
        || getPlayerLabel(entry).toLowerCase() === normalize(combatant?.name).toLowerCase()
    )?.userId || "",
    hasPlayerOwner: combatant?.hasPlayerOwner === true,
    actorSnapshot: combatant?.actorSnapshot || null
  }));
}

// ─── Foundry bridge helpers ────────────────────────────────────────────────────

async function postBotMessagesToFoundry(baseWo, messages = []) {
  const bridgeCfg = getFoundryBridgeConfig(baseWo);
  const channelKey = normalize(bridgeCfg.channelKey || baseWo?.channelId);
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((entry) => ({
      text: normalize(entry?.text || entry),
      type: normalize(entry?.type || "botmessage"),
      meta: entry?.meta || {}
    }))
    .filter((entry) => entry.text && entry.text.length > 0);
  if (!channelKey || !cleanMessages.length) return;
  const { enqueueFoundryBridgeRequest } = await import("../shared/foundry-bridge.js");
  await enqueueFoundryBridgeRequest(baseWo, "botmessage", { messages: cleanMessages }, {
    tool: "foundry-round-engine",
    channelKey
  });
}

async function invokeFoundryAction(baseWo, action, payload) {
  const { enqueueFoundryBridgeRequest, awaitFoundryBridgeResponse } = await import("../shared/foundry-bridge.js");
  const queued = await enqueueFoundryBridgeRequest(baseWo, action, payload, {
    tool: "foundry-round-engine",
    channelKey: normalize(payload?.channelKey || getFoundryBridgeConfig(baseWo).channelKey || baseWo?.channelId)
  });
  if (!queued?.ok) return queued;
  return await awaitFoundryBridgeResponse(queued.requestId, 120000, 500);
}

// ─── AI runners ───────────────────────────────────────────────────────────────

async function runApiTurn(baseCore, runFlow, createRunCore, options = {}) {
  const channelId = normalize(options.channelId);
  const payload = normalize(options.payload);
  if (!channelId || !payload) return { ok: false, error: "channelId and payload are required." };
  const coreData = typeof createRunCore === "function"
    ? createRunCore()
    : { config: baseCore?.config || {}, workingObject: structuredClone(baseCore?.workingObject || {}) };
  const workingObject = coreData.workingObject || {};
  workingObject.flow = "api";
  workingObject.payload = payload;
  workingObject.channelId = channelId;
  workingObject.channelType = "API";
  workingObject.isDM = false;
  workingObject.guildId = "";
  workingObject.userId = normalize(options.userId || "foundry-engine");
  workingObject.timestamp = new Date().toISOString();
  if (options.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;
  if (options.callerChannelId) workingObject.callerChannelId = normalize(options.callerChannelId);
  if (options.systemPromptAddition) workingObject.systemPromptAddition = String(options.systemPromptAddition);
  if (options.workingObjectPatch && typeof options.workingObjectPatch === "object") {
    Object.assign(workingObject, options.workingObjectPatch);
  }
  await runFlow("api", coreData);
  return {
    ok: true,
    response: normalize(workingObject.response),
    toolCallLog: Array.isArray(workingObject.toolCallLog) ? workingObject.toolCallLog : [],
    workingObject
  };
}

async function runDirectorJson(baseCore, runFlow, createRunCore, state, prompt) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.director,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-director",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  return safeParseJson(res?.response, null);
}

async function runNarratorText(baseCore, runFlow, createRunCore, state, prompt) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.narrator,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-narrator",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  return normalize(res?.response);
}

/**
 * Asks the director AI whether the player's submitted action is clear enough to resolve.
 * Returns { accepted: bool, message: string }.
 * context is a short label like "exploration_action" or "combat_action".
 * history is [{ role: "player"|"dm", text: string }].
 */
async function runActionEvaluator(baseCore, runFlow, createRunCore, state, context, playerLabel, history) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const prompt = [
    "You are a D&D DM deciding whether a player's action description is clear enough to resolve.",
    `Context: ${context}`,
    `Player: ${playerLabel}`,
    "Conversation history:",
    history.map((e) => `${e.role === "player" ? playerLabel : "DM"}: ${e.text}`).join("\n"),
    "",
    "Return JSON only: { \"accepted\": true|false, \"message\": \"...\" }",
    "accepted=true: action is specific enough. message = brief acknowledgment (max 1 sentence).",
    "accepted=false: need more info. message = single short clarifying question.",
    "Accept if the action type and target are roughly clear. Reject only if truly ambiguous."
  ].join("\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.director,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-evaluator",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const parsed = safeParseJson(res?.response, null);
  if (parsed && typeof parsed.accepted === "boolean") {
    return {
      accepted: Boolean(parsed.accepted),
      message: normalize(parsed.message) || (parsed.accepted ? `${playerLabel}, got it.` : "Could you clarify?")
    };
  }
  return { accepted: true, message: normalize(res?.response) || `${playerLabel}, got it.` };
}

// ─── Markdown state writer ────────────────────────────────────────────────────

async function writeFoundryMarkdownState(workingObject, state) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(path.join(statusDir, "foundry-progress.md"), buildProgressMarkdown(state), "utf8");
  await fs.writeFile(path.join(statusDir, "foundry-storybubble.md"), buildStoryBubbleMarkdown(state.lastScene || {}), "utf8");
  await fs.writeFile(path.join(statusDir, "foundry-party-state.md"), buildPartyStateMarkdown(state.session || {}), "utf8");
}

// ─── Character & session init ─────────────────────────────────────────────────

async function writePartyCharacterFiles(baseCore, runFlow, createRunCore, workingObject, session) {
  const players = Array.isArray(session?.players) ? session.players : [];
  const channels = getSpecialistChannels(session?.channelId);
  for (const player of players) {
    const fileSlug = getSlug(player?.characterName || player?.userName || player?.userId, "character");
    player.fileSlug = fileSlug;
    if (player.actorSummary) {
      const markdown = buildCharacterMarkdown(player, {
        name: player.actorSummary?.name,
        classSummary: player.actorSummary?.type,
        race: player.actorSummary?.system?.details?.race,
        level: player.actorSummary?.system?.details?.level,
        ac: player.actorSummary?.system?.attributes?.ac,
        hp: `${player.actorSummary?.system?.attributes?.hp?.value ?? "-"} / ${player.actorSummary?.system?.attributes?.hp?.max ?? "-"}`,
        passivePerception: player.actorSummary?.system?.skills?.prc?.passive,
        notes: [
          `Foundry actor: ${normalize(player.actorSummary?.name) || "-"}`,
          `Actor ID: ${normalize(player.actorId) || "-"}`
        ]
      });
      await writeCharacterMarkdown(workingObject, player, markdown);
      continue;
    }
    const markdown = buildCharacterMarkdown(player, {
      notes: ["No Foundry actor was linked for this player during session sync."]
    });
    await writeCharacterMarkdown(workingObject, player, markdown);
  }
}

async function syncCampaignStickyContext(workingObject, session) {
  const channelId = normalize(session?.campaignChannelId);
  if (!channelId) return { importedCount: 0 };
  const entries = Array.isArray(session?.journals) ? session.journals : [];
  let purgedCount = await setPurgeContext({
    ...workingObject, channelId, contextChannelId: channelId, subchannel: undefined
  });
  let importedCount = 0;
  for (const entry of entries) {
    const content = normalize(entry?.text);
    if (!content) continue;
    const header = [
      `Campaign order: ${entry?.order || "?"} of ${entry?.totalSelected || entries.length}`,
      `Journal: ${normalize(entry?.name) || "Unnamed"}`,
      Array.isArray(entry?.folderPath) && entry.folderPath.length ? `Path: ${entry.folderPath.join(" / ")}` : ""
    ].filter(Boolean).join("\n");
    await setContext({
      ...workingObject, channelId, contextChannelId: channelId,
      userId: normalize(workingObject?.userId || "foundry-campaign-sync")
    }, {
      role: "user",
      userId: normalize(workingObject?.userId || "foundry-campaign-sync"),
      content: `${header}\n\n${content}`,
      sticky: true
    });
    importedCount += 1;
  }
  return { purgedCount, importedCount };
}

async function getCampaignBubble(baseCore, runFlow, createRunCore, state, question) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const prompt = [
    "Build a compact current-scene bubble for live D&D play.",
    `Question: ${normalize(question) || "Where does the party currently begin and what is immediately relevant?"}`,
    `Current location hint: ${normalize(state?.session?.progress?.currentLocation) || "-"}`,
    `Current objective hint: ${normalize(state?.session?.progress?.currentObjective) || "-"}`,
    `Current chapter hint: ${normalize(state?.session?.progress?.currentChapter) || "-"}`,
    "Respond in JSON with keys: location, objective, chapter, summary, nearbyEvents, nearbyNpcs, nearbyHazards, nextBeats, drift, loadNext, sourceAnchor."
  ].join("\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.campaign,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-campaign",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const parsed = safeParseJson(res?.response, {});
  return {
    location: normalize(parsed?.location),
    objective: normalize(parsed?.objective),
    chapter: normalize(parsed?.chapter),
    summary: normalize(parsed?.summary || res?.response),
    nearbyEvents: normalize(parsed?.nearbyEvents),
    nearbyNpcs: normalize(parsed?.nearbyNpcs),
    nearbyHazards: normalize(parsed?.nearbyHazards),
    nextBeats: normalize(parsed?.nextBeats),
    drift: normalize(parsed?.drift),
    loadNext: normalize(parsed?.loadNext),
    sourceAnchor: normalize(parsed?.sourceAnchor),
    generatedAt: new Date().toISOString()
  };
}

async function initializeFoundrySession(baseCore, runFlow, createRunCore, workingObject, body) {
  const session = {
    channelId: normalize(body?.channelId),
    channelKey: normalize(body?.channelKey || body?.channelId),
    journals: Array.isArray(body?.journals) ? body.journals : [],
    players: Array.isArray(body?.players) ? body.players : [],
    currentLocation: normalize(body?.currentLocation),
    currentObjective: normalize(body?.currentObjective),
    currentChapter: normalize(body?.currentChapter)
  };
  const channels = getSpecialistChannels(session.channelId);
  session.campaignChannelId = channels.campaign;
  session.partyChannelId = channels.party;
  session.opsChannelId = channels.ops;
  session.progress = {
    currentLocation: session.currentLocation,
    currentObjective: session.currentObjective,
    currentChapter: session.currentChapter
  };
  await ensureFoundryMarkdownFiles(workingObject);
  const contextSync = await syncCampaignStickyContext(workingObject, session);
  await writePartyCharacterFiles(baseCore, runFlow, createRunCore, workingObject, session);
  let state = createInitialRoundState(session);
  state.lastScene = await getCampaignBubble(baseCore, runFlow, createRunCore, state, "Build the opening local story bubble for the current campaign state.");
  await writeFoundryMarkdownState(workingObject, state);
  state = await writeRoundState(workingObject, state);
  const openBeat = normalize(state.currentBeat || state.lastScene?.summary || state.lastScene?.location || state.session?.progress?.currentLocation || "the current location");
  const sceneOpener = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "You are opening an exploration round for a multiplayer D&D session.",
    "RULES: Describe ONLY what is immediately in front of the party. Do not summarize the campaign or describe future events.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT BEAT (authoritative — base your narration on this): ${openBeat}`,
    "Write 1 to 3 short plain-text sentences describing only the immediate playable situation."
  ].join("\n"));
  const opener = buildExplorationTurnPrompt(state, sceneOpener);
  return { state, opener, contextSync };
}

// ─── Player helpers ────────────────────────────────────────────────────────────

function getActivePlayer(state) {
  const players = Array.isArray(state?.session?.players) ? state.session.players : [];
  const index = Number(state?.round?.activePlayerIndex || 0);
  return players[index] || null;
}

function doesMessageBelongToPlayer(message, player) {
  const messageUserId = normalize(message?.authorUserId || message?.userId || message?.speakerUserId);
  const messageActorId = normalize(message?.speakerActorId);
  const messageAlias = normalize(message?.speakerAlias || message?.authorName);
  const playerUserId = normalize(player?.userId);
  const playerActorId = normalize(player?.actorId);
  const playerCharacter = normalize(player?.characterName);
  const playerUserName = normalize(player?.userName);
  if (messageUserId && playerUserId && messageUserId === playerUserId) return true;
  if (messageActorId && playerActorId && messageActorId === playerActorId) return true;
  if (messageAlias && playerCharacter && messageAlias.toLowerCase() === playerCharacter.toLowerCase()) return true;
  if (messageAlias && playerUserName && messageAlias.toLowerCase() === playerUserName.toLowerCase()) return true;
  return false;
}

function getActiveCombatantBinding(state) {
  const turnOrder = Array.isArray(state?.initiative?.turnOrder) ? state.initiative.turnOrder : [];
  const actorBindings = Array.isArray(state?.initiative?.actorBindings) ? state.initiative.actorBindings : [];
  const currentTurnIndex = Math.max(0, Number(state?.initiative?.currentTurnIndex || 0));
  const activeCombatant = turnOrder[currentTurnIndex] || null;
  if (!activeCombatant) return null;
  const binding = actorBindings.find((entry) =>
    normalize(entry?.combatantId) === normalize(activeCombatant?.id)
      || normalize(entry?.actorId) === normalize(activeCombatant?.actorId)
      || normalize(entry?.name).toLowerCase() === normalize(activeCombatant?.name).toLowerCase()
  ) || null;
  if (binding) {
    return {
      ...binding,
      userId: normalize(binding.userId),
      actorId: normalize(binding.actorId),
      characterName: normalize(binding.name),
      userName: normalize(binding.name)
    };
  }
  return {
    combatantId: normalize(activeCombatant?.id),
    actorId: normalize(activeCombatant?.actorId),
    characterName: normalize(activeCombatant?.name),
    userName: normalize(activeCombatant?.name),
    userId: "",
    hasPlayerOwner: activeCombatant?.hasPlayerOwner === true,
    actorSnapshot: activeCombatant?.actorSnapshot || null
  };
}

function isPlayerControlledCombatant(state, binding) {
  if (!binding) return false;
  if (normalize(binding?.userId)) return true;
  if (binding?.hasPlayerOwner === true) return true;
  const players = Array.isArray(state?.session?.players) ? state.session.players : [];
  return players.some((entry) =>
    (normalize(entry?.actorId) && normalize(entry.actorId) === normalize(binding?.actorId))
      || getPlayerLabel(entry).toLowerCase() === normalize(binding?.characterName || binding?.userName || binding?.name).toLowerCase()
  );
}

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildExplorationTurnPrompt(state, sceneText = "") {
  const activePlayer = getActivePlayer(state);
  const roundNumber = Math.max(1, Number(state?.round?.number || 1));
  const promptLine = `${getPlayerLabel(activePlayer)} steps into focus. What are you doing?`;
  return [normalize(sceneText), `Exploration round ${roundNumber}.`, promptLine].filter(Boolean).join("\n");
}

function buildInitiativePrompt(state, text = "") {
  const pending = Array.isArray(state?.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [];
  const active = pending.find((entry) => entry.initiative == null) || null;
  if (!active) return normalize(text);
  return [normalize(text), `Initiative: ${getPlayerLabel(active)}, roll initiative!`].filter(Boolean).join("\n");
}

function buildCombatTurnPrompt(state, activeCombatant, text = "") {
  const activeName = normalize(activeCombatant?.name || activeCombatant?.characterName);
  if (!activeName) return normalize(text);
  return [normalize(text), `${activeName}, you're up. What are you doing?`].filter(Boolean).join("\n");
}

// ─── ENCOUNTER LOOP ────────────────────────────────────────────────────────────

async function advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resolutionText = "") {
  state.mode = "exploration";
  state.phase = "awaiting_action";
  state.round.number = Math.max(1, Number(state.round?.number || 1) + 1);
  state.round.step = "action";
  state.round.activePlayerIndex = 0;
  state.round.awaitingPlayerIds = state.session.players.map((entry) => entry.userId);
  state.round.acceptedActions = [];
  state.round.pendingClarifications = [];
  state.round.openReactionWindow = null;
  state.round.actionFollowupHistory = [];
  await writeFoundryMarkdownState(workingObject, state);
  await writeRoundState(workingObject, state);
  const nowBeat = normalize(state.currentBeat || state.lastScene?.summary || state.lastScene?.location || state.session?.progress?.currentLocation || "current location");
  const scenePrompt = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "You are the DM narrator for a multiplayer D&D session.",
    "RULES: Your narration must match the current beat exactly. Do NOT advance to a future location. Do NOT contradict what already happened.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT BEAT (authoritative — do not override): ${nowBeat}`,
    resolutionText ? `What just happened: ${resolutionText}` : "",
    "Write at most 2 short plain-text sentences that set the scene as described in the current beat."
  ].filter(Boolean).join("\n"));
  return buildExplorationTurnPrompt(state, scenePrompt);
}

async function resolveExplorationRound(baseCore, runFlow, createRunCore, workingObject, state) {
  const actions = Array.isArray(state?.round?.acceptedActions) ? state.round.acceptedActions : [];
  // Query available Foundry actors so the director can use exact names
  let availableActorNames = "";
  try {
    const actorsRes = await invokeFoundryAction(workingObject, "actors", {
      channelKey: state.session.channelKey,
      limit: 80
    });
    if (Array.isArray(actorsRes?.actors) && actorsRes.actors.length) {
      availableActorNames = actorsRes.actors.map((a) => normalize(a?.name)).filter(Boolean).join(", ");
    }
  } catch { /* non-fatal — director works without it */ }

  const currentLocation = normalize(state.lastScene?.location || state.session?.progress?.currentLocation || "unknown location");
  const director = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Resolve a multiplayer D&D exploration round. ADVANCE THE STORY ONE BEAT AT A TIME.",
    "",
    "HARD RULES — follow these without exception:",
    "1. Only describe what happens in the next 1-5 in-game minutes at the CURRENT location. Never skip ahead.",
    "2. Travel is NOT instant. If players decide to go somewhere, the next beat is 'they set out' or 'they are en route' — NOT 'they arrive'.",
    "3. NPCs at other locations cannot speak, react, or interact. Only NPCs physically present at the current location can act.",
    "4. Quest progression is gradual: receive quest → discuss → prepare → begin travel → travel → arrive → etc. Never jump steps.",
    "5. sceneUpdate.location must remain the CURRENT location unless the party has literally just finished traveling in THIS beat.",
    "6. Set modeSwitch='initiative' ONLY if an enemy is actively hostile and physically present RIGHT NOW. Surrendered, fleeing, or already defeated enemies do NOT count. If the player tries to attack surrendered enemies, resolve it narratively without combat mode.",
    "7. For 'enemies' and 'allies' fields: use ONLY names from the available Foundry actors list below. If you need multiple of the same type (e.g. 3 cultists), repeat the name 3 times. If no actor list is provided, use your best guess.",
    "",
    availableActorNames ? `Available Foundry actors (EXACT names — only pick from this list): ${availableActorNames}` : "",
    `Current party location: ${currentLocation}`,
    `Current scene JSON:\n${JSON.stringify(state.lastScene, null, 2)}`,
    `Party roster JSON:\n${JSON.stringify(state.session.players, null, 2)}`,
    `Player action submissions JSON:\n${JSON.stringify(actions, null, 2)}`,
    "",
    "Return JSON only with keys:",
    "{",
    '  "modeSwitch": "exploration" | "initiative",',
    '  "currentBeat": "1-2 sentences describing EXACTLY where the party is and what is happening right now — this becomes the authoritative scene anchor for the next turn",',
    '  "summary": "DM-only summary of what happens NOW (one beat, current location only)",',
    '  "activeThreats": "short threat summary or empty string",',
    '  "clarifications": [{"userId":"","userName":"","prompt":"","rollNeeded":"","dc":"","reason":""}],',
    '  "npcRolls": [{"label":"","notation":"","visibility":"gmroll"}],',
    '  "enemies": ["exact Foundry token name of hostile combatant 1", "..."],',
    '  "allies": ["exact Foundry token name of allied NPC 1", "..."],',
    '  "sceneUpdate": {"location":"current location — only change if party just finished traveling","objective":"","chapter":"","summary":"what is immediately visible/audible NOW","nearbyEvents":"","nearbyNpcs":"","nearbyHazards":"","nextBeats":"","drift":"","loadNext":"","sourceAnchor":""}',
    "}"
  ].join("\n")) || {};

  const npcRollResults = [];
  for (const rollSpec of Array.isArray(director.npcRolls) ? director.npcRolls : []) {
    const rollRes = await invokeFoundryAction(workingObject, "roll", {
      channelKey: state.session.channelKey,
      notation: normalize(rollSpec?.notation),
      label: normalize(rollSpec?.label) || "NPC roll",
      visibility: normalize(rollSpec?.visibility) || "gmroll",
      emitChatMessage: false
    });
    npcRollResults.push(rollRes);
  }

  const clarifications = (Array.isArray(director.clarifications) ? director.clarifications : [])
    .map((entry) => ({
      userId: normalize(entry?.userId),
      userName: normalize(entry?.userName),
      prompt: normalize(entry?.prompt),
      rollNeeded: normalize(entry?.rollNeeded),
      dc: normalize(entry?.dc),
      reason: normalize(entry?.reason),
      response: ""
    }))
    .filter((entry) => entry.userId && entry.prompt);

  if (director.currentBeat) {
    state.currentBeat = normalize(director.currentBeat);
  }

  state.lastResolution = {
    summary: normalize(director.summary),
    activeThreats: normalize(director.activeThreats),
    modeSwitch: normalize(director.modeSwitch || "exploration"),
    npcRollResults
  };

  if (director.sceneUpdate && typeof director.sceneUpdate === "object") {
    state.lastScene = { ...state.lastScene, ...director.sceneUpdate, generatedAt: new Date().toISOString() };
  }

  if (clarifications.length) {
    state.phase = "awaiting_clarification";
    state.round.step = "clarification";
    state.round.pendingClarifications = clarifications;
    state.round.activePlayerIndex = 0;
    await writeFoundryMarkdownState(workingObject, state);
    await writeRoundState(workingObject, state);
    const first = clarifications[0];
    return {
      messages: [{
        text: `${first.userName || "Player"}, ${first.prompt}${first.rollNeeded ? ` Roll ${first.rollNeeded}${first.dc ? ` (DC ${first.dc})` : ""}.` : ""}`,
        type: "bot"
      }]
    };
  }

  const resBeat = normalize(director.currentBeat || state.currentBeat || state.lastScene?.summary || state.lastScene?.location || "the current location");
  const resolutionText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Present the resolution of a D&D exploration round in plain text for Foundry chat.",
    "RULES: Your narration must match the current beat exactly. Do NOT jump to a destination or skip story steps. Do NOT contradict what the director summary says.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT BEAT (authoritative): ${resBeat}`,
    `Director resolution summary:\n${normalize(director.summary) || "-"}`,
    `NPC roll results JSON:\n${JSON.stringify(npcRollResults, null, 2)}`,
    "Write 2 to 4 short sentences narrating exactly this beat."
  ].join("\n"));

  if (normalize(director.modeSwitch).toLowerCase() === "initiative") {
    return await startInitiativeMode(baseCore, runFlow, createRunCore, workingObject, state, director, resolutionText);
  }

  const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resolutionText);
  return {
    messages: [
      { text: resolutionText, type: "bot" },
      { text: nextPrompt, type: "bot" }
    ]
  };
}

/** Commits a player's exploration action and advances to the next player or resolves the round. */
async function commitExplorationAction(baseCore, runFlow, createRunCore, workingObject, state, activePlayer, actionText) {
  state.round.actionFollowupHistory = [];
  state.round.acceptedActions.push({
    userId: activePlayer.userId,
    userName: activePlayer.userName,
    characterName: activePlayer.characterName,
    text: actionText,
    rollTotal: null,
    createdAt: new Date().toISOString()
  });
  const nextIndex = Number(state.round.activePlayerIndex || 0) + 1;
  if (nextIndex < state.session.players.length) {
    state.round.activePlayerIndex = nextIndex;
    await writeRoundState(workingObject, state);
    const next = getActivePlayer(state);
    return { accepted: true, messages: [{ text: `${getPlayerLabel(next)}, was tust du?`, type: "bot" }] };
  }
  return { accepted: true, ...(await resolveExplorationRound(baseCore, runFlow, createRunCore, workingObject, state)) };
}

/**
 * Handles exploration follow-up: AI asked a clarifying question, player responded.
 * Player can say "ok" to short-circuit and commit the most recent substantive action.
 */
async function handleExplorationActionFollowup(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activePlayer = getActivePlayer(state);
  if (!doesMessageBelongToPlayer(message, activePlayer)) return { accepted: false, messages: [] };

  const inputText = getRoundInputText(message);
  const playerLabel = getPlayerLabel(activePlayer);
  const history = Array.isArray(state.round.actionFollowupHistory) ? state.round.actionFollowupHistory : [];
  history.push({ role: "player", text: inputText });
  state.round.actionFollowupHistory = history;

  if (isOkSignal(inputText)) {
    const substantive = history.slice().reverse().find((e) => e.role === "player" && !isOkSignal(e.text));
    const actionText = substantive?.text || inputText;
    state.phase = "awaiting_action";
    return commitExplorationAction(baseCore, runFlow, createRunCore, workingObject, state, activePlayer, actionText);
  }

  const evaluation = await runActionEvaluator(baseCore, runFlow, createRunCore, state, "exploration_action", playerLabel, history);
  if (!evaluation.accepted) {
    history.push({ role: "dm", text: evaluation.message });
    await writeRoundState(workingObject, state);
    return { accepted: true, messages: [{ text: evaluation.message, type: "bot" }] };
  }

  state.phase = "awaiting_action";
  return commitExplorationAction(baseCore, runFlow, createRunCore, workingObject, state, activePlayer, inputText);
}

async function continueClarificationRound(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const pending = Array.isArray(state?.round?.pendingClarifications) ? state.round.pendingClarifications : [];
  const active = pending[Number(state.round?.activePlayerIndex || 0)] || null;
  if (!active) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, active)) return { accepted: false, messages: [] };

  active.response = getRoundInputText(message) || String(extractFirstRollTotal(message) ?? "");
  const nextIndex = Number(state.round.activePlayerIndex || 0) + 1;
  if (nextIndex < pending.length) {
    state.round.activePlayerIndex = nextIndex;
    await writeRoundState(workingObject, state);
    const next = pending[nextIndex];
    return {
      accepted: true,
      messages: [{
        text: `${next.userName || "Player"}, ${next.prompt}${next.rollNeeded ? ` Roll ${next.rollNeeded}${next.dc ? ` (DC ${next.dc})` : ""}.` : ""}`,
        type: "bot"
      }]
    };
  }

  const clarBeat = normalize(state.currentBeat || state.lastScene?.summary || state.lastScene?.location || "the current location");
  const resolutionText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Resolve a D&D exploration round after clarification and player roll responses.",
    "RULES: Only describe what is happening RIGHT NOW. Do not skip ahead. Do NOT end with a question.",
    `CURRENT BEAT (authoritative): ${clarBeat}`,
    `Original round actions JSON:\n${JSON.stringify(state.round.acceptedActions, null, 2)}`,
    `Clarification responses JSON:\n${JSON.stringify(pending, null, 2)}`,
    `Director summary:\n${normalize(state?.lastResolution?.summary) || "-"}`,
    "Write 2 to 4 short plain-text sentences."
  ].join("\n"));

  const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resolutionText);
  return {
    accepted: true,
    messages: [
      { text: resolutionText, type: "bot" },
      { text: nextPrompt, type: "bot" }
    ]
  };
}

// ─── INITIATIVE LOOP ───────────────────────────────────────────────────────────

async function startInitiativeMode(baseCore, runFlow, createRunCore, workingObject, state, director, resolutionText) {
  // Guard: if no players are registered for this session, we cannot open a combat tracker
  if (!Array.isArray(state.session.players) || state.session.players.length === 0) {
    state.mode = "exploration";
    state.phase = "awaiting_action";
    await writeRoundState(workingObject, state);
    const noPlayerMsg = "Kein Spieler ist in der aktuellen Szene registriert — der Combat Tracker wurde nicht geöffnet. Bitte stelle sicher, dass Spieler in der Szene sind und synchronisiere die Session erneut (session-sync).";
    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resolutionText);
    return {
      messages: [
        { text: resolutionText, type: "bot" },
        { text: noPlayerMsg, type: "bot" },
        { text: nextPrompt, type: "bot" }
      ]
    };
  }

  state.mode = "initiative";
  state.phase = "awaiting_player_initiative";
  state.initiative.pendingInitiatives = state.session.players.map((entry) => ({
    userId: entry.userId,
    userName: entry.userName,
    actorId: entry.actorId || "",
    characterName: entry.characterName || entry.userName,
    initiative: null
  }));
  state.initiative.currentTurnIndex = -1;
  state.initiative.pendingReactions = [];
  state.initiative.lastAttackResult = null;
  state.initiative.lastPlayerAction = null;
  state.initiative.turnFollowupHistory = [];

  const actorRefs = state.session.players.map((entry) => normalize(entry.actorId)).filter(Boolean);
  // Players without actorId: send by name so Foundry can find them via fuzzy match on game.actors
  const playerNamesForEnsure = state.session.players
    .filter((entry) => !normalize(entry.actorId))
    .map((entry) => normalize(entry.characterName || entry.userName))
    .filter(Boolean);
  // Support both old "combatants" and new split "enemies"/"allies" from director
  const enemyNames = Array.isArray(director?.enemies)
    ? director.enemies.map((e) => normalize(e)).filter(Boolean)
    : Array.isArray(director?.combatants)
      ? director.combatants.map((e) => normalize(e)).filter(Boolean)
      : [];
  const allyNames = Array.isArray(director?.allies) ? director.allies.map((e) => normalize(e)).filter(Boolean) : [];
  const allNpcNames = [...enemyNames, ...allyNames];

  const ensureRes = await invokeFoundryAction(workingObject, "initiative", {
    channelKey: state.session.channelKey,
    operation: "ensure",
    actorRefs,
    playerNames: playerNamesForEnsure,
    npcNames: allNpcNames
  });
  syncInitiativeStateFromResult(state, ensureRes, state.session.players);

  // Check what Foundry actually added to the tracker
  const combatantsReturned = Array.isArray(ensureRes?.combatants) ? ensureRes.combatants : [];
  if (!state.initiative.combatId && combatantsReturned.length === 0) {
    console.warn("[foundry-bridge] startInitiativeMode: ensure returned no combatants — combat tracker may not be open in Foundry");
  }

  // Count how many expected NPCs were actually found in the tracker
  const foundNpcNames = combatantsReturned
    .filter((c) => !state.session.players.some((p) =>
      normalize(p.actorId) === normalize(c.actorId) ||
      getPlayerLabel(p).toLowerCase() === normalize(c.name).toLowerCase()
    ))
    .map((c) => normalize(c.name));
  const missingEnemies = enemyNames.filter((n) => !foundNpcNames.some((f) => f.toLowerCase() === n.toLowerCase()));
  const missingAllies = allyNames.filter((n) => !foundNpcNames.some((f) => f.toLowerCase() === n.toLowerCase()));
  const missingAll = [...missingEnemies, ...missingAllies];

  let nscWarning = "";
  if (missingAll.length > 0) {
    // Query available actors to show in the warning for debugging
    let availableHint = "";
    try {
      const actorsRes = await invokeFoundryAction(workingObject, "actors", {
        channelKey: state.session.channelKey,
        limit: 80
      });
      const npcActorNames = (Array.isArray(actorsRes?.actors) ? actorsRes.actors : [])
        .filter((a) => !a?.hasPlayerOwner)
        .map((a) => normalize(a?.name))
        .filter(Boolean);
      if (npcActorNames.length) availableHint = ` | Verfügbare NPC-Actors in game.actors: ${npcActorNames.join(", ")}`;
    } catch { /* non-fatal */ }
    const parts = [];
    if (missingEnemies.length) parts.push(`Feinde: ${missingEnemies.join(", ")}`);
    if (missingAllies.length) parts.push(`Verbündete: ${missingAllies.join(", ")}`);
    nscWarning = `⚠️ NSCs nicht gefunden: ${parts.join(" | ")}${availableHint}`;
  }

  // Roll initiative for all NPCs immediately
  const npcInitiatives = [];
  for (const combatant of Array.isArray(ensureRes?.combatants) ? ensureRes.combatants : []) {
    const name = normalize(combatant?.name);
    const isPlayer = state.session.players.some((entry) =>
      name === getPlayerLabel(entry) || normalize(combatant?.actorId) === normalize(entry.actorId)
    );
    if (isPlayer) continue;

    const rollRes = await invokeFoundryAction(workingObject, "roll", {
      channelKey: state.session.channelKey,
      actorRef: combatant?.actorId || combatant?.name,
      rollType: "initiative",
      label: `Initiative: ${name}`,
      visibility: "gmroll",
      emitChatMessage: false
    });
    const initTotal = Number(rollRes?.total);
    if (!Number.isFinite(initTotal)) continue;

    npcInitiatives.push({
      combatantRef: combatant?.actorId || combatant?.name,
      initiative: initTotal,
      name
    });

    const setRes = await invokeFoundryAction(workingObject, "initiative", {
      channelKey: state.session.channelKey,
      operation: "set",
      combatRef: state.initiative.combatId || state.initiative.combatName,
      initiatives: [{ actorRef: combatant?.actorId || combatant?.name, name, initiative: initTotal }],
      activateHighest: false
    });
    syncInitiativeStateFromResult(state, setRes, state.session.players);
  }
  state.initiative.npcInitiatives = npcInitiatives;
  await writeRoundState(workingObject, state);

  const trackerMsg = state.initiative.combatId
    ? `⚔️ Combat Tracker geöffnet (ID: ${state.initiative.combatId}). Initiative-Runde beginnt!`
    : "⚔️ Combat Tracker wird geöffnet. Initiative-Runde beginnt!";
  const playerCount = state.initiative.pendingInitiatives.length;
  const npcCount = npcInitiatives.length;
  const rosterMsg = `Kämpfer: ${playerCount} Spieler, ${npcCount} NSC${npcCount !== 1 ? "s" : ""}.`;

  const messages = [
    { text: resolutionText, type: "bot" },
    { text: `${trackerMsg} ${rosterMsg}`, type: "bot" }
  ];
  if (nscWarning) messages.push({ text: nscWarning, type: "bot" });
  messages.push({ text: buildInitiativePrompt(state), type: "bot" });

  return { messages };
}

/** Sets all collected initiatives in Foundry and transitions to the first combat turn. */
async function finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, workingObject, state, prefixMessages = []) {
  const pending = Array.isArray(state.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [];
  const allInitiatives = [
    ...pending.map((entry) => ({
      actorRef: normalize(entry.actorId) || getPlayerLabel(entry),
      name: getPlayerLabel(entry),
      initiative: entry.initiative ?? 0
    })),
    ...(Array.isArray(state?.initiative?.npcInitiatives) ? state.initiative.npcInitiatives.map((e) => ({
      combatantRef: normalize(e.combatantRef),
      name: normalize(e.name),
      initiative: e.initiative
    })) : [])
  ];

  const setRes = await invokeFoundryAction(workingObject, "initiative", {
    channelKey: state.session.channelKey,
    operation: "set",
    combatRef: state.initiative.combatId || state.initiative.combatName,
    initiatives: allInitiatives,
    activateHighest: true
  });

  state.phase = "combat_turn_prompt";
  state.initiative.turnFollowupHistory = [];
  syncInitiativeStateFromResult(state, setRes, state.session.players);

  const turnOrderSummary = state.initiative.turnOrder
    .map((c, i) => `${i + 1}. ${normalize(c.name)} (${c.initiative ?? "?"})`)
    .join(", ");
  const orderMsg = turnOrderSummary ? `Initiative order: ${turnOrderSummary}` : "Initiative is set!";

  const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, workingObject, state);
  return {
    accepted: true,
    messages: [
      ...prefixMessages.map((text) => ({ text, type: "bot" })),
      { text: orderMsg, type: "bot" },
      ...(advanced.messages.length ? advanced.messages : [{ text: "Combat begins. First combatant, you're up!", type: "bot" }])
    ]
  };
}

/**
 * Collects player initiative rolls one by one (round-robin).
 * Re-asks if the input is not a valid number.
 * After all players rolled, sets initiatives in Foundry and starts combat.
 */
async function continueInitiativeCollection(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const pending = Array.isArray(state?.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [];
  const current = pending.find((entry) => entry.initiative == null);
  if (!current) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, current)) return { accepted: false, messages: [] };

  const initiative = extractFirstRollTotal(message);
  if (!Number.isFinite(initiative)) {
    return {
      accepted: true,
      messages: [{ text: `${getPlayerLabel(current)}, please send your initiative as a roll or a number.`, type: "bot" }]
    };
  }

  current.initiative = initiative;

  // Set incrementally so Foundry tracker updates live
  const incrementalSetRes = await invokeFoundryAction(workingObject, "initiative", {
    channelKey: state.session.channelKey,
    operation: "set",
    combatRef: state.initiative.combatId || state.initiative.combatName,
    initiatives: [{
      actorRef: normalize(current.actorId) || getPlayerLabel(current),
      name: getPlayerLabel(current),
      initiative
    }],
    activateHighest: false
  });
  syncInitiativeStateFromResult(state, incrementalSetRes, state.session.players);

  const next = pending.find((entry) => entry.initiative == null);
  if (next) {
    await writeRoundState(workingObject, state);
    return { accepted: true, messages: [{ text: buildInitiativePrompt(state), type: "bot" }] };
  }

  // All players have rolled — finalize and start combat
  return await finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, workingObject, state);
}

// ─── COMBAT LOOP ───────────────────────────────────────────────────────────────

/**
 * Auto-advances through NPC turns until a player combatant is active.
 * For each NPC: narrates the turn via AI, then advances in Foundry.
 */
async function advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, workingObject, state) {
  const messages = [];
  const maxSteps = Math.max(1, (Array.isArray(state?.initiative?.turnOrder) ? state.initiative.turnOrder.length : 0) + 2);

  for (let step = 0; step < maxSteps; step += 1) {
    const activeBinding = getActiveCombatantBinding(state);
    if (!activeBinding) break;

    if (isPlayerControlledCombatant(state, activeBinding)) {
      const promptText = buildCombatTurnPrompt(state, {
        name: activeBinding.characterName || activeBinding.userName
      });
      messages.push({ text: promptText, type: "bot" });
      await writeRoundState(workingObject, state);
      return { state, messages };
    }

    // NPC turn: AI narrates, Foundry advances
    const npcName = normalize(activeBinding.characterName || activeBinding.userName || "Enemy");
    const npcText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
      "Resolve an NPC or enemy combat turn in one short plain-text sentence.",
      `Combatant: ${npcName}`,
      `Actor snapshot JSON:\n${JSON.stringify(activeBinding.actorSnapshot || {}, null, 2)}`,
      "Describe only the immediate hostile or tactical action. No markdown. Do NOT end with a question."
    ].join("\n")) || `${npcName} acts.`;
    messages.push({ text: npcText, type: "bot" });

    const nextRes = await invokeFoundryAction(workingObject, "initiative", {
      channelKey: state.session.channelKey,
      operation: "next",
      combatRef: state.initiative.combatId || state.initiative.combatName
    });
    syncInitiativeStateFromResult(state, nextRes, state.session.players);
  }

  // Fell off the end — either all combatants acted or the active player has no turn in the tracker.
  // Check whether any player binding exists in the turn order at all.
  const hasAnyPlayerInTracker = Array.isArray(state.initiative?.actorBindings) &&
    state.initiative.actorBindings.some((b) => isPlayerControlledCombatant(state, b));

  if (!hasAnyPlayerInTracker) {
    // Player was not found in the combat tracker — give GM actionable guidance.
    messages.push({
      text: "⚠️ Kein Spieler-Combatant im Combat Tracker gefunden. Mögliche Ursachen: Actor existiert nicht in game.actors, oder session-sync wurde ohne actorId durchgeführt. Nutze '!dm skip' um zur nächsten Runde zu springen, oder '!dm reset' um zurück zu Exploration zu gehen.",
      type: "bot"
    });
    // Keep phase at combat_turn_prompt so !dm commands still work
  } else {
    messages.push({ text: "Alle Kämpfer haben diese Runde agiert.", type: "bot" });
  }
  await writeRoundState(workingObject, state);
  return { state, messages };
}

/**
 * Player declared a combat action. Evaluates if it is clear enough.
 * If unclear: enters combat_turn_followup phase and asks a clarifying question.
 * If clear (or ok signal): commits action and starts the combat resolution chain.
 */
async function handleCombatTurnPrompt(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const actionText = getRoundInputText(message);
  const playerLabel = normalize(activeBinding.characterName || activeBinding.userName);

  if (!isOkSignal(actionText)) {
    const history = [{ role: "player", text: actionText }];
    const evaluation = await runActionEvaluator(baseCore, runFlow, createRunCore, state, "combat_action", playerLabel, history);
    if (!evaluation.accepted) {
      state.phase = "combat_turn_followup";
      state.initiative.turnFollowupHistory = [
        ...history,
        { role: "dm", text: evaluation.message }
      ];
      await writeRoundState(workingObject, state);
      return { accepted: true, messages: [{ text: evaluation.message, type: "bot" }] };
    }
  }

  return await commitCombatAction(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, actionText);
}

/**
 * Handles combat follow-up: player answered the AI's clarifying question.
 * Player can say "ok" to commit the last substantive action and skip further questions.
 */
async function handleCombatTurnFollowup(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const inputText = getRoundInputText(message);
  const playerLabel = normalize(activeBinding.characterName || activeBinding.userName);
  const history = Array.isArray(state.initiative.turnFollowupHistory) ? [...state.initiative.turnFollowupHistory] : [];
  history.push({ role: "player", text: inputText });

  if (isOkSignal(inputText)) {
    const substantive = history.slice().reverse().find((e) => e.role === "player" && !isOkSignal(e.text));
    const actionText = substantive?.text || inputText;
    return await commitCombatAction(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, actionText);
  }

  const evaluation = await runActionEvaluator(baseCore, runFlow, createRunCore, state, "combat_action", playerLabel, history);
  if (!evaluation.accepted) {
    history.push({ role: "dm", text: evaluation.message });
    state.initiative.turnFollowupHistory = history;
    await writeRoundState(workingObject, state);
    return { accepted: true, messages: [{ text: evaluation.message, type: "bot" }] };
  }

  return await commitCombatAction(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, inputText);
}

/** Commits the player's combat action and enters the attack-resolution chain. */
async function commitCombatAction(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, actionText) {
  const playerLabel = normalize(activeBinding.characterName || activeBinding.userName);
  state.initiative.lastPlayerAction = {
    combatantId: normalize(activeBinding.combatantId),
    actorId: normalize(activeBinding.actorId),
    name: playerLabel,
    text: actionText,
    createdAt: new Date().toISOString()
  };
  state.initiative.turnFollowupHistory = [];
  return await startCombatResolution(baseCore, runFlow, createRunCore, workingObject, state);
}

/**
 * COMBAT RESOLUTION CHAIN (hardcoded, AI-narrated):
 * 1. Director determines rolls needed.
 * 2. Attack rolls are made via Foundry immediately.
 * 3. Attack announcement posted → reaction window opens (10s).
 * 4. [Timer 1] Hit/miss posted → second reaction window (10s).
 * 5. [Timer 2] Damage applied, turn advanced, next combatant prompted.
 */
async function startCombatResolution(baseCore, runFlow, createRunCore, workingObject, state) {
  const activeBinding = getActiveCombatantBinding(state);
  const lastAction = state.initiative.lastPlayerAction;

  const combatDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "You are resolving a D&D 5e combat action. Determine what dice rolls are needed.",
    `Active combatant: ${normalize(activeBinding?.characterName || activeBinding?.userName)}`,
    `Actor snapshot: ${JSON.stringify(activeBinding?.actorSnapshot || {}, null, 2)}`,
    `Declared action: ${normalize(lastAction?.text)}`,
    `Combat turn order (current index ${state.initiative.currentTurnIndex}): ${JSON.stringify(state.initiative.turnOrder?.map((c) => c.name), null, 2)}`,
    "Return JSON only:",
    `{`,
    `  "attackRolls": [{"notation":"1d20+5","label":"Attack roll","visibility":"public"}],`,
    `  "damageRolls": [{"notation":"1d8+3","label":"Longsword damage","visibility":"public"}],`,
    `  "attackAnnouncement": "One sentence announcing the attack (present tense, dramatic)",`,
    `  "combatEnds": false`,
    `}`
  ].join("\n")) || {};

  // Make attack rolls immediately so the numbers exist for the hit announcement
  const attackRollResults = [];
  for (const rollSpec of Array.isArray(combatDir.attackRolls) ? combatDir.attackRolls : []) {
    const rollRes = await invokeFoundryAction(workingObject, "roll", {
      channelKey: state.session.channelKey,
      notation: normalize(rollSpec.notation) || "1d20",
      label: normalize(rollSpec.label) || "Attack",
      actorRef: activeBinding?.actorId || activeBinding?.characterName,
      visibility: normalize(rollSpec.visibility) || "public",
      emitChatMessage: true
    });
    attackRollResults.push({ spec: rollSpec, result: rollRes });
  }

  state.initiative.lastAttackResult = {
    combatDir,
    attackRollResults,
    damageRollResults: []
  };
  state.initiative.pendingReactions = [];
  state.phase = "combat_reaction_pre";
  state.initiative.reactionWindowExpiresAt = Date.now() + 10000;
  await writeRoundState(workingObject, state);

  const announcement = normalize(combatDir.attackAnnouncement) ||
    `${normalize(activeBinding?.characterName || activeBinding?.userName)} attacks!`;

  // Schedule hit announcement after 10 seconds
  const timerKey = state.session.channelKey || workingObject.channelId;
  clearCombatTimer(timerKey);
  const capturedWo = { ...workingObject };
  combatTimers.set(timerKey, setTimeout(() => {
    fireCombatHitAnnouncement(baseCore, runFlow, createRunCore, capturedWo, timerKey).catch((err) => {
      console.error("[foundry-bridge] fireCombatHitAnnouncement error:", err);
    });
  }, 10000));

  return {
    accepted: true,
    messages: [{ text: `${announcement} (Reactions? 10 seconds...)`, type: "bot" }]
  };
}

/** Timer callback: announce hit or miss, open second reaction window. */
async function fireCombatHitAnnouncement(baseCore, runFlow, createRunCore, capturedWo, timerKey) {
  clearCombatTimer(timerKey);

  let state;
  try {
    state = await readRoundState(capturedWo);
  } catch (err) {
    console.error("[foundry-bridge] fireCombatHitAnnouncement: cannot read state", err);
    return;
  }

  if (state.phase !== "combat_reaction_pre") return;

  const lastAction = state.initiative.lastPlayerAction || {};
  const lastResult = state.initiative.lastAttackResult || {};
  const reactions = Array.isArray(state.initiative.pendingReactions) ? state.initiative.pendingReactions : [];

  const hitText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Announce whether a D&D 5e attack hit or missed based on the roll.",
    `Attacker: ${normalize(lastAction.name)}`,
    `Declared action: ${normalize(lastAction.text)}`,
    `Attack roll results: ${JSON.stringify(lastResult.attackRollResults || [], null, 2)}`,
    reactions.length ? `Pre-attack reactions declared: ${JSON.stringify(reactions, null, 2)}` : "",
    "Write 1-2 short plain-text sentences. End with '(Reactions? 10 seconds...)'."
  ].filter(Boolean).join("\n"));

  state.phase = "combat_reaction_post";
  state.initiative.reactionWindowExpiresAt = Date.now() + 10000;
  await writeRoundState(capturedWo, state);

  await postBotMessagesToFoundry(capturedWo, [
    { text: hitText || "The attack resolves! (Reactions? 10 seconds...)", type: "bot" }
  ]);

  combatTimers.set(timerKey, setTimeout(() => {
    fireCombatDamageAndAdvance(baseCore, runFlow, createRunCore, capturedWo, timerKey).catch((err) => {
      console.error("[foundry-bridge] fireCombatDamageAndAdvance error:", err);
    });
  }, 10000));
}

/** Timer callback: apply damage, advance turn, prompt next combatant or end combat. */
async function fireCombatDamageAndAdvance(baseCore, runFlow, createRunCore, capturedWo, timerKey) {
  clearCombatTimer(timerKey);

  let state;
  try {
    state = await readRoundState(capturedWo);
  } catch (err) {
    console.error("[foundry-bridge] fireCombatDamageAndAdvance: cannot read state", err);
    return;
  }

  if (state.phase !== "combat_reaction_post") return;

  const lastAction = state.initiative.lastPlayerAction || {};
  const lastResult = state.initiative.lastAttackResult || {};
  const reactions = Array.isArray(state.initiative.pendingReactions) ? state.initiative.pendingReactions : [];

  // Make damage rolls
  const damageRollResults = [];
  for (const rollSpec of Array.isArray(lastResult.combatDir?.damageRolls) ? lastResult.combatDir.damageRolls : []) {
    const rollRes = await invokeFoundryAction(capturedWo, "roll", {
      channelKey: state.session.channelKey,
      notation: normalize(rollSpec.notation) || "1d6",
      label: normalize(rollSpec.label) || "Damage",
      visibility: normalize(rollSpec.visibility) || "public",
      emitChatMessage: true
    });
    damageRollResults.push({ spec: rollSpec, result: rollRes });
  }

  const damageText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Describe the final outcome of a D&D 5e combat attack.",
    `Attacker: ${normalize(lastAction.name)}, action: ${normalize(lastAction.text)}`,
    `Damage roll results: ${JSON.stringify(damageRollResults, null, 2)}`,
    reactions.length ? `Post-hit reactions: ${JSON.stringify(reactions, null, 2)}` : "",
    "Write 1-2 short plain-text sentences describing the damage and any dramatic effects."
  ].filter(Boolean).join("\n"));

  // Check if combat ends (all non-player combatants defeated, or director flagged it)
  const activeNpcs = Array.isArray(state.initiative.turnOrder)
    ? state.initiative.turnOrder.filter((c) => !c.defeated && !c.hasPlayerOwner)
    : [];
  const combatShouldEnd = activeNpcs.length === 0 || lastResult.combatDir?.combatEnds === true;

  if (combatShouldEnd) {
    await invokeFoundryAction(capturedWo, "initiative", {
      channelKey: state.session.channelKey,
      operation: "end",
      combatRef: state.initiative.combatId || state.initiative.combatName
    }).catch(() => {});

    const endText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
      "Combat has ended. Write 2-3 sentences describing the aftermath.",
      "The players are victorious (or the enemies have fled). Transition back to exploration."
    ].join("\n"));

    state.mode = "exploration";
    state.phase = "awaiting_action";
    state.initiative.pendingReactions = [];
    state.initiative.lastAttackResult = null;
    await writeRoundState(capturedWo, state);

    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, capturedWo, state, endText);
    await postBotMessagesToFoundry(capturedWo, [
      { text: damageText || "The attack lands.", type: "bot" },
      { text: endText || "Combat ends.", type: "bot" },
      { text: nextPrompt, type: "bot" }
    ]);
    return;
  }

  // Advance to next combatant
  const nextRes = await invokeFoundryAction(capturedWo, "initiative", {
    channelKey: state.session.channelKey,
    operation: "next",
    combatRef: state.initiative.combatId || state.initiative.combatName
  });
  syncInitiativeStateFromResult(state, nextRes, state.session.players);

  state.phase = "combat_turn_prompt";
  state.initiative.pendingReactions = [];
  state.initiative.lastAttackResult = null;
  state.initiative.turnFollowupHistory = [];
  await writeRoundState(capturedWo, state);

  const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, capturedWo, state);
  await postBotMessagesToFoundry(capturedWo, [
    { text: damageText || "The attack lands.", type: "bot" },
    ...advanced.messages
  ]);
}

// ─── REACTION LOOP ─────────────────────────────────────────────────────────────

/**
 * Handles any player message during a reaction window.
 * The reaction is stored and factored into the next narration.
 * The timer still fires on schedule — reactions do not reset the clock.
 */
async function handleCombatReactionWindow(workingObject, state, message) {
  const inputText = getRoundInputText(message);
  const authorName = normalize(message?.speakerAlias || message?.authorName || "Player");

  if (!Array.isArray(state.initiative.pendingReactions)) {
    state.initiative.pendingReactions = [];
  }
  state.initiative.pendingReactions.push({
    from: authorName,
    text: inputText,
    createdAt: new Date().toISOString()
  });
  await writeRoundState(workingObject, state);

  return {
    accepted: true,
    messages: [{ text: `${authorName}, reaction noted.`, type: "bot" }]
  };
}

// ─── DM OVERRIDE ───────────────────────────────────────────────────────────────

/**
 * Handles !dm <command> override messages. Bypasses all player-ownership checks.
 *
 * Commands:
 *   !dm status  — show current mode/phase/state
 *   !dm reset   — return to exploration mode, clear combat state
 *   !dm skip    — skip stuck player: in initiative → assign initiative 10; in combat → advance turn; in exploration → skip player
 *   !dm next    — alias for skip in combat turns
 */
async function handleDmOverride(baseCore, runFlow, createRunCore, workingObject, state, override) {
  const { command } = override;

  // ── !dm status ─────────────────────────────────────────────────────────────
  if (command === "status") {
    const pendingInits = (Array.isArray(state.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [])
      .filter((e) => e.initiative == null)
      .map((e) => getPlayerLabel(e));
    const lines = [
      `mode: ${state.mode}, phase: ${state.phase}`,
      `players: ${state.session?.players?.length || 0}`,
      `combatId: ${state.initiative?.combatId || "-"}`,
      `turnIndex: ${state.initiative?.currentTurnIndex ?? "-"}`,
      pendingInits.length ? `awaiting initiative: ${pendingInits.join(", ")}` : ""
    ].filter(Boolean);
    return { accepted: true, messages: [{ text: `🎲 DM Status:\n${lines.join("\n")}`, type: "bot" }] };
  }

  // ── !dm reset / !dm explore ────────────────────────────────────────────────
  if (command === "reset" || command === "explore") {
    clearCombatTimer(state.session?.channelKey || workingObject.channelId);
    state.mode = "exploration";
    state.phase = "awaiting_action";
    state.round.activePlayerIndex = 0;
    state.round.acceptedActions = [];
    state.round.pendingClarifications = [];
    state.round.actionFollowupHistory = [];
    if (state.initiative) {
      state.initiative.pendingReactions = [];
      state.initiative.lastAttackResult = null;
      state.initiative.turnFollowupHistory = [];
    }
    await writeRoundState(workingObject, state);
    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, "");
    return {
      accepted: true,
      messages: [
        { text: "🎲 DM Override: Kampfmodus beendet — zurück zu Exploration.", type: "bot" },
        { text: nextPrompt, type: "bot" }
      ]
    };
  }

  // ── !dm skip / !dm next ────────────────────────────────────────────────────
  if (command === "skip" || command === "next") {
    // In initiative collection: skip the current pending player (assign initiative 10)
    if (state.mode === "initiative" && state.phase === "awaiting_player_initiative") {
      const pending = Array.isArray(state.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [];
      const current = pending.find((e) => e.initiative == null);
      if (!current) {
        return { accepted: true, messages: [{ text: "🎲 DM Override: Alle Initiative-Würfe bereits erfasst.", type: "bot" }] };
      }
      current.initiative = 10;
      const skippedMsg = `🎲 DM Override: ${getPlayerLabel(current)} Initiative auf 10 gesetzt (übersprungen).`;

      // Also push a minimal set-call to Foundry so the tracker updates
      await invokeFoundryAction(workingObject, "initiative", {
        channelKey: state.session.channelKey,
        operation: "set",
        combatRef: state.initiative.combatId || state.initiative.combatName,
        initiatives: [{ actorRef: normalize(current.actorId) || getPlayerLabel(current), name: getPlayerLabel(current), initiative: 10 }],
        activateHighest: false
      }).catch(() => {});

      const next = pending.find((e) => e.initiative == null);
      if (next) {
        await writeRoundState(workingObject, state);
        return {
          accepted: true,
          messages: [
            { text: skippedMsg, type: "bot" },
            { text: buildInitiativePrompt(state), type: "bot" }
          ]
        };
      }
      // All players done — finalize and start combat
      return await finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, workingObject, state, [skippedMsg]);
    }

    // In combat turn (any phase): advance to next combatant
    if (state.mode === "initiative") {
      clearCombatTimer(state.session?.channelKey || workingObject.channelId);
      const nextRes = await invokeFoundryAction(workingObject, "initiative", {
        channelKey: state.session.channelKey,
        operation: "next",
        combatRef: state.initiative.combatId || state.initiative.combatName
      });
      syncInitiativeStateFromResult(state, nextRes, state.session.players);
      state.phase = "combat_turn_prompt";
      state.initiative.pendingReactions = [];
      state.initiative.lastAttackResult = null;
      state.initiative.turnFollowupHistory = [];
      await writeRoundState(workingObject, state);
      const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, workingObject, state);
      return {
        accepted: true,
        messages: [
          { text: "🎲 DM Override: Aktuellen Zug übersprungen.", type: "bot" },
          ...advanced.messages
        ]
      };
    }

    // In exploration: skip current player's action slot
    if (state.mode === "exploration" && (state.phase === "awaiting_action" || state.phase === "awaiting_action_followup")) {
      const activePlayer = getActivePlayer(state);
      const skippedName = getPlayerLabel(activePlayer);
      state.phase = "awaiting_action";
      const result = await commitExplorationAction(
        baseCore, runFlow, createRunCore, workingObject, state,
        activePlayer || { userId: "dm-skip", userName: "Übersprungen", characterName: "Übersprungen" },
        "[übersprungen]"
      );
      return {
        ...result,
        messages: [
          { text: `🎲 DM Override: ${skippedName} übersprungen.`, type: "bot" },
          ...(Array.isArray(result.messages) ? result.messages : [])
        ]
      };
    }

    return { accepted: true, messages: [{ text: `🎲 DM Override: Skip in Phase '${state.phase}' nicht anwendbar.`, type: "bot" }] };
  }

  // ── Unknown command ────────────────────────────────────────────────────────
  return {
    accepted: true,
    messages: [{
      text: "🎲 DM Override — verfügbare Befehle: !dm status | !dm reset | !dm skip | !dm next",
      type: "bot"
    }]
  };
}

// ─── MAIN ROUND INPUT ROUTER ───────────────────────────────────────────────────

async function handleRoundInput(baseCore, runFlow, createRunCore, workingObject, message) {
  const state = await readRoundState(workingObject);

  // ── DM Override (checked before all phase routing) ──────────────────────────
  const inputText = getRoundInputText(message);
  const override = parseOverrideCommand(inputText);
  if (override) {
    return await handleDmOverride(baseCore, runFlow, createRunCore, workingObject, state, override);
  }

  // ── Encounter loop ──────────────────────────────────────────────────────────

  if (state.mode === "exploration" && state.phase === "awaiting_action") {
    const activePlayer = getActivePlayer(state);
    if (!doesMessageBelongToPlayer(message, activePlayer)) return { accepted: false, messages: [] };

    const inputText = getRoundInputText(message);
    const playerLabel = getPlayerLabel(activePlayer);

    if (!isOkSignal(inputText)) {
      const history = [{ role: "player", text: inputText }];
      const evaluation = await runActionEvaluator(baseCore, runFlow, createRunCore, state, "exploration_action", playerLabel, history);
      if (!evaluation.accepted) {
        state.phase = "awaiting_action_followup";
        state.round.actionFollowupHistory = [...history, { role: "dm", text: evaluation.message }];
        await writeRoundState(workingObject, state);
        return { accepted: true, messages: [{ text: evaluation.message, type: "bot" }] };
      }
    }

    return { accepted: true, ...(await commitExplorationAction(baseCore, runFlow, createRunCore, workingObject, state, activePlayer, inputText)) };
  }

  if (state.mode === "exploration" && state.phase === "awaiting_action_followup") {
    return await handleExplorationActionFollowup(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  if (state.mode === "exploration" && state.phase === "awaiting_clarification") {
    return await continueClarificationRound(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  // ── Initiative loop ─────────────────────────────────────────────────────────

  if (state.mode === "initiative" && state.phase === "awaiting_player_initiative") {
    return await continueInitiativeCollection(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  // ── Combat loop ─────────────────────────────────────────────────────────────

  if (state.mode === "initiative" && state.phase === "combat_turn_prompt") {
    return await handleCombatTurnPrompt(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  if (state.mode === "initiative" && state.phase === "combat_turn_followup") {
    return await handleCombatTurnFollowup(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  // ── Reaction loop ────────────────────────────────────────────────────────────

  if (state.mode === "initiative" &&
    (state.phase === "combat_reaction_pre" || state.phase === "combat_reaction_post")) {
    return await handleCombatReactionWindow(workingObject, state, message);
  }

  return { accepted: false, messages: [] };
}

// ─── HTTP SERVER ───────────────────────────────────────────────────────────────

export default async function getFoundryBridgeFlow(baseCore, runFlow, createRunCore) {
  const flowCfg = baseCore?.config?.["foundry-bridge"] || {};
  const host = String(flowCfg.host || "0.0.0.0");
  const port = Number(flowCfg.port || 3134);
  const bridgeCfg = getFoundryBridgeConfig(baseCore?.workingObject || {}, flowCfg);
  const chatPath = bridgeCfg.chatPath || "/foundry-bridge/chat";
  const pollPath = bridgeCfg.pollPath || "/foundry-bridge/poll";
  const resultPath = bridgeCfg.resultPath || "/foundry-bridge/result";
  const contextImportPath = bridgeCfg.contextImportPath || "/foundry-bridge/context-import";
  const campaignResetPath = bridgeCfg.campaignResetPath || "/foundry-bridge/campaign-reset";
  const sessionSyncPath = bridgeCfg.sessionSyncPath || "/foundry-bridge/session-sync";
  const roundInputPath = bridgeCfg.roundInputPath || "/foundry-bridge/round-input";
  const healthPath = String(flowCfg.healthPath || "/foundry-bridge/health");

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      setCorsHeaders(res);
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === "GET" && req.url === healthPath) {
      return getJson(res, 200, { ok: true, service: "foundry-bridge", version: "2.0" });
    }

    if (req.method === "POST" && req.url === chatPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req, 2 * 1024 * 1024));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelId = String(parsedBody?.channelId || "").trim();
        const payload = String(parsedBody?.payload || "").trim();
        if (!channelId || !payload) {
          return getJson(res, 400, { ok: false, error: "channelId_and_payload_required" });
        }

        const coreData = typeof createRunCore === "function"
          ? createRunCore()
          : { config: baseCore?.config || {}, workingObject: structuredClone(baseCore?.workingObject || {}) };
        const workingObject = coreData.workingObject || {};
        workingObject.flow = "api";
        workingObject.payload = payload;
        workingObject.channelId = channelId;
        workingObject.channelType = "API";
        workingObject.isDM = false;
        workingObject.guildId = String(parsedBody?.guildId || "");
        workingObject.userId = String(parsedBody?.userId || "foundry-user");
        workingObject.timestamp = new Date().toISOString();
        if (parsedBody.subchannel) workingObject.subchannel = String(parsedBody.subchannel).trim();
        if (parsedBody.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;
        if (parsedBody.contextChannelId) workingObject.contextChannelId = String(parsedBody.contextChannelId);
        if (parsedBody.systemPromptAddition) workingObject.systemPromptAddition = String(parsedBody.systemPromptAddition);
        if (parsedBody.callerChannelId) workingObject.callerChannelId = String(parsedBody.callerChannelId);
        if (Array.isArray(parsedBody.callerChannelIds)) workingObject.callerChannelIds = parsedBody.callerChannelIds.map((v) => String(v)).filter(Boolean);
        if (parsedBody.callerTurnId) workingObject.callerTurnId = String(parsedBody.callerTurnId);
        if (parsedBody.agentDepth !== undefined) workingObject.agentDepth = Math.max(0, Number(parsedBody.agentDepth) || 0);
        if (parsedBody.agentType) workingObject.agentType = String(parsedBody.agentType);
        if (parsedBody.callerFlow) workingObject.callerFlow = String(parsedBody.callerFlow);
        if (parsedBody.toolcallScope) workingObject.toolcallScope = String(parsedBody.toolcallScope);
        if (parsedBody.toolStatusScope) workingObject.toolStatusScope = String(parsedBody.toolStatusScope);
        if (parsedBody.statusScope) workingObject.statusScope = String(parsedBody.statusScope);
        if (parsedBody.toolStatusChannelOverride) workingObject.toolStatusChannelOverride = String(parsedBody.toolStatusChannelOverride);

        await runFlow("api", coreData);

        const silenceToken = String(workingObject.modSilence || "[silence]");
        let text = String(workingObject.response || "").trim();
        if (!text || text === silenceToken) {
          const snapshotWo = {
            ...(baseCore?.workingObject || {}), channelId, contextChannelId: channelId, contextSize: 50
          };
          const msgs = await getContext(snapshotWo).catch(() => []);
          let lastAssistant = null;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "assistant") { lastAssistant = msgs[i]; break; }
          }
          text = String(lastAssistant?.text || "").trim();
        }

        return getJson(res, 200, {
          ok: true,
          flow: "foundry-bridge",
          channelId,
          turnId: workingObject.turnId,
          channelAllowed: workingObject.channelAllowed,
          response: text && text !== silenceToken ? text : "",
          toolCallLog: Array.isArray(workingObject.toolCallLog) ? workingObject.toolCallLog : undefined,
          primaryImageUrl: typeof workingObject.primaryImageUrl === "string" && workingObject.primaryImageUrl ? workingObject.primaryImageUrl : undefined
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_chat_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === sessionSyncPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req, 10 * 1024 * 1024));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelId = normalize(parsedBody?.channelId);
        if (!channelId) return getJson(res, 400, { ok: false, error: "channelId_required" });
        const workingObject = { ...(baseCore?.workingObject || {}) };
        workingObject.flow = "foundry-bridge";
        workingObject.turnId = getNewUlid();
        workingObject.channelId = channelId;
        workingObject.contextChannelId = channelId;
        workingObject.userId = normalize(parsedBody?.userId || "foundry-session-sync");
        workingObject.timestamp = new Date().toISOString();
        const initialized = await initializeFoundrySession(baseCore, runFlow, createRunCore, workingObject, parsedBody);
        return getJson(res, 200, {
          ok: true,
          service: "foundry-bridge",
          channelId,
          opener: initialized.opener,
          state: initialized.state,
          importedJournalCount: Number(initialized?.contextSync?.importedCount || 0),
          purgedJournalRows: Number(initialized?.contextSync?.purgedCount || 0)
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_session_sync_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === roundInputPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req, 2 * 1024 * 1024));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelId = normalize(parsedBody?.channelId);
        if (!channelId) return getJson(res, 400, { ok: false, error: "channelId_required" });
        const workingObject = { ...(baseCore?.workingObject || {}) };
        workingObject.flow = "foundry-bridge";
        workingObject.turnId = getNewUlid();
        workingObject.channelId = channelId;
        workingObject.contextChannelId = channelId;
        workingObject.userId = normalize(parsedBody?.userId || "foundry-round-input");
        workingObject.timestamp = new Date().toISOString();
        const result = await handleRoundInput(baseCore, runFlow, createRunCore, workingObject, {
          authorUserId: parsedBody?.authorUserId,
          userId: parsedBody?.authorUserId,
          authorName: parsedBody?.authorName,
          speakerAlias: parsedBody?.speakerAlias,
          speakerActorId: parsedBody?.speakerActorId,
          speakerUserId: parsedBody?.speakerUserId,
          content: parsedBody?.content,
          rollSummary: parsedBody?.rollSummary,
          rolls: Array.isArray(parsedBody?.rolls) ? parsedBody.rolls : []
        });
        return getJson(res, 200, {
          ok: true,
          service: "foundry-bridge",
          channelId,
          accepted: result?.accepted === true,
          messages: Array.isArray(result?.messages)
            ? result.messages.filter((m) => normalize(m?.text))
            : []
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_round_input_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "GET" && (req.url === pollPath || req.url.startsWith(pollPath + "?"))) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      try {
        const pollUrl = new URL(req.url, `http://localhost:${port}`);
        const channelKey = String(pollUrl.searchParams.get("channelKey") || "").trim();
        if (!channelKey) return getJson(res, 400, { ok: false, error: "channelKey_required" });
        const leaseMs = Number(pollUrl.searchParams.get("leaseMs") || "") || bridgeCfg.claimLeaseMs;
        const result = await claimNextFoundryBridgeRequest(channelKey, leaseMs);
        return getJson(res, 200, result);
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_poll_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === resultPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelKey = String(parsedBody?.channelKey || "").trim();
        const requestId = String(parsedBody?.requestId || "").trim();
        if (!channelKey || !requestId) {
          return getJson(res, 400, { ok: false, error: "channelKey_and_requestId_required" });
        }
        const result = await completeFoundryBridgeRequest(channelKey, requestId, parsedBody?.response);
        return getJson(res, result.ok ? 200 : 400, result);
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_result_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === contextImportPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req, 5 * 1024 * 1024));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelId = String(parsedBody?.channelId || "").trim();
        const entries = Array.isArray(parsedBody?.entries) ? parsedBody.entries : [];
        const replaceContext = parsedBody?.replaceContext === true;
        if (!channelId || (!entries.length && !replaceContext)) {
          return getJson(res, 400, { ok: false, error: "channelId_required_and_entries_required_unless_replaceContext" });
        }
        const workingObject = { ...(baseCore?.workingObject || {}) };
        workingObject.flow = "foundry-bridge";
        workingObject.turnId = getNewUlid();
        workingObject.channelId = channelId;
        workingObject.contextChannelId = String(parsedBody?.contextChannelId || channelId).trim();
        workingObject.userId = String(parsedBody?.userId || "foundry-context-import").trim();
        workingObject.timestamp = new Date().toISOString();
        if (parsedBody.subchannel) workingObject.subchannel = String(parsedBody.subchannel);
        let purgedCount = 0;
        if (replaceContext) {
          const purgeWo = parsedBody?.purgeWholeChannel === true
            ? { ...workingObject, subchannel: undefined }
            : workingObject;
          purgedCount = await setPurgeContext(purgeWo);
        }
        const imported = [];
        for (const item of entries) {
          const content = String(item?.content || "").trim();
          if (!content) continue;
          await setContext(workingObject, {
            role: String(item?.role || parsedBody?.role || "user"),
            userId: String(item?.userId || workingObject.userId),
            content,
            sticky: item?.sticky === true || parsedBody?.sticky === true
          });
          imported.push({
            role: String(item?.role || parsedBody?.role || "user"),
            chars: content.length,
            sticky: item?.sticky === true || parsedBody?.sticky === true
          });
        }
        return getJson(res, 200, {
          ok: true,
          service: "foundry-bridge",
          channelId,
          purgedCount,
          importedCount: imported.length,
          imported
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_context_import_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === campaignResetPath) {
      if (!await isBridgeBearerValid(req, baseCore, flowCfg)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(await getReadBody(req));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }
      try {
        const channelId = String(parsedBody?.channelId || "").trim();
        if (!channelId) return getJson(res, 400, { ok: false, error: "channelId_required" });
        const extraChannelIds = Array.isArray(parsedBody?.extraChannelIds)
          ? parsedBody.extraChannelIds.map((v) => String(v || "").trim()).filter(Boolean)
          : [];
        const workingObject = { ...(baseCore?.workingObject || {}) };
        workingObject.flow = "foundry-bridge";
        workingObject.turnId = getNewUlid();
        workingObject.channelId = channelId;
        workingObject.contextChannelId = channelId;
        workingObject.userId = String(parsedBody?.userId || "foundry-campaign-reset").trim();
        workingObject.timestamp = new Date().toISOString();

        // Cancel any running combat timers for this channel
        clearCombatTimer(channelId);

        let purgedContextRows = await setPurgeContext(workingObject);
        for (const extraChannelId of extraChannelIds) {
          purgedContextRows += await setPurgeContext({ ...workingObject, channelId: extraChannelId, contextChannelId: extraChannelId });
        }
        const deletedFiles = await resetFoundryNotebook(workingObject);
        return getJson(res, 200, {
          ok: true,
          service: "foundry-bridge",
          channelId,
          extraChannelIds,
          purgedContextRows,
          deletedFiles,
          recreatedFiles: ["foundry-progress.md", "foundry-conditions.md", "foundry-combat-state.md", "foundry-party-state.md", "foundry-storybubble.md", "foundry-round-state.json"]
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "foundry_campaign_reset_failed", reason: e?.message || String(e) });
      }
    }

    return getJson(res, 404, { ok: false, error: "not_found" });
  });

  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(port, host);
}
