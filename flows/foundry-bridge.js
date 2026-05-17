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
 * Detects which turn components (movement, bonus action) are already present
 * in a free-form combat declaration so the completion loop only asks about
 * what is actually missing.
 *
 * Returns { hasMovement, hasBonusAction }.
 */
function detectTurnComponents(text) {
  const t = normalize(text).toLowerCase();

  // Movement: German and English movement words/phrases
  const hasMovement = /\b(geh|gehe|lauf|laufe|beweg|bewege|renn|renne|sprint|dash|move|walk|run|approach|retreat|flee|stepp|trete|näher|heran|heranbeweg|positionier|zurück|vorwärts|seitwärts|towards|toward|away from|schleich|kriech|teleport|misty step|jump|springe)\b/.test(t)
    || /\b\d+\s*(fuß|foot|feet|ft|meter|felder|squares?|schritt)\b/.test(t); // "30 Fuß" / "6 Felder"

  // Bonus action: German and English bonus-action keywords
  const hasBonusAction = /\b(bonus|bonusaktion|bonus-aktion|off.?hand|zweite.?hand|nebenhand|cunning action|cunning|zusatz.?aktion|zusätzlich.*(angriff|aktion)|zweiter angriff|doppel.?angriff|schild.?zauber|shield spell|nick|shove|push|grapple als bonus|unarmed bonus|handkante|zweite waffe|handaxt|dolch als bonus)\b/.test(t);

  return { hasMovement, hasBonusAction };
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

// ─── Combat math helpers ──────────────────────────────────────────────────────

/** Parses "+5", "-1", "10" etc. → integer or null. */
function parseAttackBonus(toHit) {
  if (toHit == null) return null;
  const n = parseInt(String(toHit).trim().replace(/^\+/, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Finds the best-matching attack in an actorSnapshot by name (fuzzy). Falls back to first. */
function matchAttack(actorSnapshot, attackName) {
  const attacks = Array.isArray(actorSnapshot?.attacks) ? actorSnapshot.attacks : [];
  if (!attacks.length) return null;
  if (!attackName) return attacks[0];
  const lower = normalize(attackName).toLowerCase();
  return attacks.find((a) => normalize(a?.name).toLowerCase() === lower)
    || attacks.find((a) => normalize(a?.name).toLowerCase().includes(lower))
    || attacks[0];
}

/** Returns the AC of a named combatant from state.initiative.actorBindings, or null. */
function markReactionUsed(state, name) {
  if (!state.reactions) return;
  state.reactions.available = (state.reactions.available || []).filter((n) => n !== name);
  if (!(state.reactions.used || []).includes(name)) {
    state.reactions.used = [...(state.reactions.used || []), name];
  }
}

function restoreReaction(state, name) {
  if (!state.reactions) return;
  if (!(state.reactions.available || []).includes(name)) {
    state.reactions.available = [...(state.reactions.available || []), name];
  }
  state.reactions.used = (state.reactions.used || []).filter((n) => n !== name);
}

function getTargetAC(state, targetName) {
  if (!targetName) return null;
  const lower = normalize(targetName).toLowerCase();
  const bindings = state.initiative?.actorBindings || [];

  // 1. Exact match
  let b = bindings.find((b) =>
    normalize(b?.name).toLowerCase() === lower
    || normalize(b?.characterName).toLowerCase() === lower
  );
  // 2. Partial / first-word match (handles "Elara Nightwhisper" vs "Elara")
  if (!b) {
    b = bindings.find((b) => {
      const name = normalize(b?.name || b?.characterName).toLowerCase();
      return name.startsWith(lower) || lower.startsWith(name.split(" ")[0]);
    });
  }
  // 3. Contains match
  if (!b) {
    b = bindings.find((b) => {
      const name = normalize(b?.name || b?.characterName).toLowerCase();
      return name.includes(lower) || lower.includes(name);
    });
  }
  return b?.actorSnapshot?.ac ?? null;
}

/**
 * Returns true for attacks that are bonus damage sources rather than standalone weapon attacks.
 * These should never be chosen as the primary attack name — they are rolled after the weapon.
 */
function isBonusDamageAttack(name) {
  return /sneak attack|divine smite|hunter.?s mark|hex|colossus slayer|piercer|crusher|slasher|great weapon fighting|sharpshooter/i.test(String(name || ""));
}

/** Doubles the dice count in a damage notation for critical hits: "1d8+3" → "2d8+3". */
function critDamageNotation(notation) {
  return String(notation || "").replace(/(\d+)d(\d+)/g, (_, n, d) => `${Number(n) * 2}d${d}`);
}

// ─── Specialist channels ───────────────────────────────────────────────────────

function getSpecialistChannels(channelId) {
  const base = getSlug(channelId);
  return {
    campaign:  `subagent-foundry-campaign-${base}`,
    party:     `subagent-foundry-party-${base}`,
    ops:       `subagent-foundry-ops-${base}`,
    director:  `subagent-foundry-director-${base}`,
    narrator:  `subagent-foundry-narrator-${base}`,
    situation: `subagent-foundry-situation-${base}`,
    combat:    `subagent-foundry-combat-${base}`
  };
}

/**
 * Returns the appropriate specialist channel for AI calls based on current mode.
 * exploration / undefined → situation channel
 * initiative (combat)    → combat channel
 */
function getContextChannel(state) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  if (state?.mode === "initiative") return channels.combat;
  return channels.situation;
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

async function runDirectorJson(baseCore, runFlow, createRunCore, state, prompt, channelOverride = null) {
  const channelId = channelOverride || getContextChannel(state);
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-director",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  return safeParseJson(res?.response, null);
}

async function runNarratorText(baseCore, runFlow, createRunCore, state, prompt, channelOverride = null) {
  const channelId = channelOverride || getContextChannel(state);
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId,
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
    channelId: getContextChannel(state),
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

// ─── Situation / History / Characters / Reactions writers ─────────────────────

async function writeSituationMd(workingObject, state) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  const sit = state.situation || {};
  const lines = [
    "# Current Situation\n",
    `**Round:** ${state.round?.number || 1} | **Mode:** ${state.mode || "exploration"}`,
    `**Updated:** ${sit.generatedAt || new Date().toISOString()}`,
    "",
    "## What Is Happening Right Now",
    normalize(sit.current) || "_Not yet determined._",
    "",
    "## What Is Possible Next",
    ...(Array.isArray(sit.nextPossible) && sit.nextPossible.length
      ? sit.nextPossible.map((s, i) => `${i + 1}. ${s}`)
      : ["_Not yet determined._"])
  ];
  await fs.writeFile(path.join(statusDir, "foundry-situation.md"), lines.join("\n"), "utf8");
}

async function appendHistoryMd(workingObject, entry) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  const filePath = path.join(statusDir, "foundry-history.md");
  const line = `[${new Date().toISOString()}] Round ${entry?.round || "?"} (${entry?.mode || "?"}) — ${normalize(entry?.text)}\n`;
  await fs.appendFile(filePath, line, "utf8");
}

function bridgeLog(workingObject, ...lines) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const entries = lines.filter(Boolean).map((line) => `[${ts}] ${String(line)}`);
  if (!entries.length) return;
  invokeFoundryAction(workingObject, "log", { operation: "append", entries }).catch(() => {});
}

async function writeCharactersMd(workingObject, actorStats = [], sessionPlayers = []) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  const md = buildActorStatsMarkdown(actorStats, sessionPlayers);
  await fs.writeFile(
    path.join(statusDir, "foundry-characters.md"),
    `# Current Characters\n_Updated: ${new Date().toISOString()}_\n\n${md || "_No character data loaded._"}`,
    "utf8"
  );
}

async function writeReactionsMd(workingObject, state) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  const rx = state.reactions || { available: [], used: [] };
  const lines = [
    "# Reactions",
    `_Round ${state.round?.number || "?"} — Turn ${state.initiative?.currentTurnIndex ?? "?"}_`,
    "",
    `**Available:** ${rx.available.length ? rx.available.join(", ") : "none"}`,
    `**Used this round:** ${rx.used.length ? rx.used.join(", ") : "none"}`
  ];
  await fs.writeFile(path.join(statusDir, "foundry-reactions.md"), lines.join("\n"), "utf8");
}

// ─── World-state + channel fuel functions ─────────────────────────────────────

/** Reads foundry-world-state.md from the status dir. Returns empty string if not found. */
async function readWorldState(workingObject) {
  const statusDir = getFoundryStatusDir(workingObject);
  try {
    return await fs.readFile(path.join(statusDir, "foundry-world-state.md"), "utf8");
  } catch {
    return "";
  }
}

/** Writes foundry-world-state.md to the status dir. */
async function writeWorldState(workingObject, content) {
  const statusDir = getFoundryStatusDir(workingObject);
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(path.join(statusDir, "foundry-world-state.md"), content, "utf8");
}

/**
 * AI regenerates the compact world-state.md document.
 * Uses the campaign channel (has full journal context) to stay grounded.
 * event: 1-sentence description of what just changed (location leave, NPC death, etc.).
 */
async function runWorldStateUpdate(baseCore, runFlow, createRunCore, workingObject, state, event = "") {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const current = await readWorldState(workingObject);
  const prompt = [
    "You are maintaining a compact living world-state document for an active D&D session.",
    "Update the document to reflect the latest event. Be concise — max 300 words.",
    "Keep permanent facts (named NPCs, locations, faction relations) and REMOVE outdated transient details.",
    current ? `CURRENT WORLD STATE:\n${current}` : "No previous world state — create a new compact summary.",
    event ? `LATEST EVENT: ${event}` : "",
    `Session location: ${normalize(state?.lastScene?.location || state?.session?.progress?.currentLocation || "unknown")}`,
    "Return ONLY the updated world-state markdown — no preamble, no explanation."
  ].filter(Boolean).join("\n\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.campaign,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-world-state",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const updated = normalize(res?.response);
  if (updated) {
    await writeWorldState(
      workingObject,
      `# World State\n_Updated: ${new Date().toISOString()}_\n\n${updated}`
    );
  }
  return updated;
}

/**
 * Purges the situation channel and refuels it with:
 *   1. world-state.md as the first sticky block
 *   2. Campaign-derived context for the current location as a second sticky block
 */
async function fuelSituationChannel(baseCore, runFlow, createRunCore, workingObject, state, location = "") {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const sitChannelId = channels.situation;
  const sitWo = { ...workingObject, channelId: sitChannelId, contextChannelId: sitChannelId };

  await setPurgeContext(sitWo);

  // Sticky 1: world state
  const worldState = await readWorldState(workingObject);
  if (worldState) {
    await setContext(sitWo, {
      role: "user",
      userId: "foundry-fuel",
      content: worldState,
      sticky: true
    });
  }

  // Sticky 2: location context from campaign channel, corrected by world state
  //
  // IMPORTANT: The campaign journals describe the world as written (pre-play).
  // The world-state.md contains what actually happened during the session
  // (NPC deaths, completed quests, changed relationships, etc.).
  // The campaign AI must reconcile both: use journals for static location facts,
  // but override any NPC status, quest state, or faction situation that the
  // world state contradicts.
  const locationHint = normalize(location || state?.lastScene?.location || state?.session?.progress?.currentLocation || "current location");
  const locationRes = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.campaign,
    payload: [
      `Build a complete DM situation brief for the current location: "${locationHint}".`,
      "This brief is the authoritative context for ALL decisions in this location — exploration AND combat.",
      "Cover ALL of the following sections. Use headings. Be thorough — this is a reference document, not a summary.",
      "",
      "## Static Location Facts",
      "Layout, notable features, atmosphere, lighting, terrain, exits, locked doors, traps.",
      "",
      "## NPCs Present",
      "For each NPC: name, role, current status (alive/dead/fled), motivation, disposition toward party, what they know.",
      "",
      "## Encounter Rules (CRITICAL for combat)",
      "Any special rules that apply if combat breaks out here:",
      "- Reinforcements: who arrives, when (e.g. 'after 3 rounds'), from where",
      "- Retreat conditions: when do enemies flee or surrender",
      "- Environmental hazards during combat (collapsing floor, fire, traps that can be triggered)",
      "- Ambush positions or surprise conditions",
      "- Any timed events (alarm bells, patrol returning, etc.)",
      "If no special encounter rules exist, write: none.",
      "",
      "## Quest / Objective Relevance",
      "What quests or objectives can be advanced here. What the party is looking for.",
      "",
      "## Immediately Actionable",
      "What the party can do right now without travel or preparation.",
      "",
      "RECONCILIATION RULES (mandatory):",
      "1. Use journal context as primary source for static facts.",
      "2. The WORLD STATE below reflects what actually happened in play. It OVERRIDES journals on NPC status, quest state, faction situation.",
      "3. Dead NPCs stay dead. Completed quests stay completed. Do not contradict the world state.",
      "",
      worldState ? `CURRENT WORLD STATE (authoritative):\n${worldState}` : ""
    ].filter(Boolean).join("\n"),
    userId: state?.session?.channelId || "foundry-fuel",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const locationContext = normalize(locationRes?.response);
  if (locationContext) {
    await setContext(sitWo, {
      role: "user",
      userId: "foundry-fuel",
      content: `## Location Brief: ${locationHint}\n\n${locationContext}`,
      sticky: true
    });
  }
}

/**
 * Hardcoded (no AI selection): reads all messages from the situation channel
 * and appends them as a scene archive entry in the campaign channel.
 * Then triggers a world-state update.
 */
async function writeSituationToCampaign(baseCore, runFlow, createRunCore, workingObject, state, event = "") {
  const channels = getSpecialistChannels(state?.session?.channelId);

  // Read situation channel messages
  const sitWo = { ...workingObject, channelId: channels.situation, contextChannelId: channels.situation, contextSize: 100 };
  const messages = await getContext(sitWo).catch(() => []);

  if (messages.length) {
    const summary = messages
      .map((m) => normalize(m?.content || m?.text || ""))
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (summary) {
      const campWo = { ...workingObject, channelId: channels.campaign, contextChannelId: channels.campaign };
      const location = normalize(state?.lastScene?.location || state?.session?.progress?.currentLocation || "unknown location");
      await setContext(campWo, {
        role: "user",
        userId: "foundry-archive",
        content: `## Scene Archive — ${location} [${new Date().toISOString()}]\n\n${summary}`,
        sticky: true
      });
    }
  }

  // Update world state (non-blocking on failure)
  if (event) {
    await runWorldStateUpdate(baseCore, runFlow, createRunCore, workingObject, state, event).catch(() => {});
  }
}

/**
 * Purges the combat channel and refuels it with:
 *   1. world-state.md sticky
 *   2. Situation channel messages (last 5) as sticky context
 *   3. Combatant stats sticky
 */
async function fuelCombatChannel(baseCore, runFlow, createRunCore, workingObject, state, director = {}) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const combatChannelId = channels.combat;
  const combatWo = { ...workingObject, channelId: combatChannelId, contextChannelId: combatChannelId };

  await setPurgeContext(combatWo);

  // Sticky 1: world state
  const worldState = await readWorldState(workingObject);
  if (worldState) {
    await setContext(combatWo, {
      role: "user",
      userId: "foundry-fuel",
      content: worldState,
      sticky: true
    });
  }

  // Sticky 2: compact combat brief — built directly from the director output that triggered
  // this combat. No AI call, no channel read. The director already decided what's happening.
  const briefParts = [];
  const location = normalize(state.lastScene?.location || state.session?.progress?.currentLocation || "");
  if (location) briefParts.push(`**Location:** ${location}`);
  const beat = normalize(director.currentBeat || state.currentBeat || state.lastScene?.summary || "");
  if (beat) briefParts.push(`**Situation:** ${beat}`);
  const enemyNames = Array.isArray(director.enemies) ? director.enemies.map((e) => normalize(e)).filter(Boolean) : [];
  const allyNames = Array.isArray(director.allies) ? director.allies.map((e) => normalize(e)).filter(Boolean) : [];
  if (enemyNames.length) briefParts.push(`**Enemies:** ${enemyNames.join(", ")}`);
  if (allyNames.length) briefParts.push(`**Allies:** ${allyNames.join(", ")}`);
  const threats = normalize(director.activeThreats || "");
  if (threats) briefParts.push(`**Active threats:** ${threats}`);
  // Terrain / nearby hazards from scene
  const hazards = normalize(state.lastScene?.nearbyHazards || "");
  const events = normalize(state.lastScene?.nearbyEvents || "");
  if (hazards) briefParts.push(`**Hazards:** ${hazards}`);
  if (events) briefParts.push(`**Ongoing events:** ${events}`);

  if (briefParts.length) {
    await setContext(combatWo, {
      role: "user",
      userId: "foundry-fuel",
      content: `## Combat Situation\n\n${briefParts.join("\n")}`,
      sticky: true
    });
  }

  // Sticky 3: combatant stats
  const actorStats = await fetchAndCacheActorStats(workingObject, state).catch(() => null);
  const statsMarkdown = buildActorStatsMarkdown(actorStats || [], state.session?.players || []);
  if (statsMarkdown) {
    await setContext(combatWo, {
      role: "user",
      userId: "foundry-fuel",
      content: `## Combatant Stats\n\n${statsMarkdown}`,
      sticky: true
    });
  }
}

/**
 * Writes the combat outcome back to the situation channel as a regular message
 * and triggers a world-state update (non-blocking).
 */
async function writeCombatResultToSituation(baseCore, runFlow, createRunCore, workingObject, state, result = "") {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const sitWo = { ...workingObject, channelId: channels.situation, contextChannelId: channels.situation };
  const content = `## Combat Result — Round ${state.round?.number || "?"} [${new Date().toISOString()}]\n\n${normalize(result) || "Combat concluded."}`;
  await setContext(sitWo, {
    role: "user",
    userId: "foundry-combat-result",
    content,
    sticky: false
  });
  await runWorldStateUpdate(baseCore, runFlow, createRunCore, workingObject, state, result).catch(() => {});
}

// ─── Situation analysis + roll validator + NPC reaction decider ────────────────

/**
 * AI analyses the current state and returns:
 *   current      — 1–3 sentences describing what is happening right now
 *   nextPossible — array of 2–5 concrete next-step options (prevents story jumping)
 *   involvedActorRefs — actor IDs/names currently in the scene
 */
async function runSituationAnalysis(baseCore, runFlow, createRunCore, state, actions = []) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  // Situation analysis always belongs in the situation channel (exploration context)
  const currentLocation = normalize(state.lastScene?.location || state.session?.progress?.currentLocation || "unknown location");
  const prompt = [
    "Analyse the current D&D session state and return structured JSON.",
    `Current location: ${currentLocation}`,
    `Last known beat: ${normalize(state.currentBeat || state.lastScene?.summary || "")}`,
    actions.length ? `Latest player actions:\n${actions.map((a) => `- ${a.characterName || a.userName}: ${a.text}`).join("\n")}` : "",
    "Return JSON only:",
    "{",
    '  "current": "1-3 sentences — what is literally happening right now at the current location",',
    '  "nextPossible": ["option 1", "option 2", "option 3"],',
    '  "involvedActorRefs": ["exact actor name or ID currently present in the scene"]',
    "}",
    "RULES:",
    "- nextPossible must be concrete immediate possibilities, NOT multi-step future events",
    "- nextPossible options must all be reachable from the CURRENT location in the next 5 minutes",
    "- Do NOT include options that require travel or preparation not yet done",
    "- involvedActorRefs: only characters physically present right now"
  ].filter(Boolean).join("\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: channels.situation,
    payload: prompt,
    userId: state?.session?.channelId || "foundry-situation",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  return safeParseJson(res?.response, { current: "", nextPossible: [], involvedActorRefs: [] });
}

/**
 * Validates a player's dice roll against their character stats.
 * rollType: "initiative" | "attack" | "damage" | "skill" | "save"
 * Returns { valid, message }.
 */
async function runRollValidator(baseCore, runFlow, createRunCore, state, player, rollType, rollTotal, notation) {
  const charName = normalize(player?.characterName || player?.userName || "Player");

  // Code-first range check — skip AI for obvious impossibilities
  const simpleMatch = String(notation || "").trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (simpleMatch && Number.isFinite(rollTotal)) {
    const numDice = Number(simpleMatch[1]);
    const dieSize = Number(simpleMatch[2]);
    const modifier = simpleMatch[3] ? Number(simpleMatch[3]) : 0;
    const minPossible = numDice + modifier;
    const maxPossible = numDice * dieSize + modifier;
    if (rollTotal < minPossible - 1 || rollTotal > maxPossible + 1) {
      return {
        valid: false,
        message: `${charName}, a roll of ${rollTotal} is outside the possible range for \`${notation}\` (${minPossible}–${maxPossible}). Please check and re-roll.`
      };
    }
    // Within range — no need to call AI
    return { valid: true, message: "" };
  }

  // Read characters.md for context (non-fatal if missing)
  let charContext = "";
  try {
    const statusDir = getFoundryStatusDir({ channelId: state?.session?.channelId });
    charContext = await fs.readFile(path.join(statusDir, "foundry-characters.md"), "utf8");
  } catch { /* no character file yet */ }

  const prompt = [
    "Validate a D&D 5e dice roll for plausibility against the character's stats.",
    `Character: ${charName}`,
    `Roll type: ${rollType}`,
    `Notation: ${notation}`,
    `Reported total: ${rollTotal}`,
    charContext ? `Character stats (from foundry-characters.md):\n${charContext.slice(0, 1500)}` : "",
    "Return JSON only: { \"valid\": true|false, \"message\": \"\" }",
    "valid=true if the total is within the possible range for this notation + character modifier.",
    "valid=false with a friendly message if clearly impossible (e.g. 1d20+3 cannot produce 25).",
    "If character stats are unavailable, default to valid=true."
  ].filter(Boolean).join("\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: getContextChannel(state),
    payload: prompt,
    userId: state?.session?.channelId || "foundry-validator",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const parsed = safeParseJson(res?.response, null);
  if (parsed && typeof parsed.valid === "boolean") return parsed;
  return { valid: true, message: "" }; // default allow
}

/**
 * For PC turns: AI immediately decides if any NPC has a valid reaction to the PC's action.
 * Returns array of reactions to execute (may be empty).
 */
async function runNpcReactionDecider(baseCore, runFlow, createRunCore, state, attackInfo) {
  const channels = getSpecialistChannels(state?.session?.channelId);
  const available = (state.reactions?.available || []).filter((name) => {
    const b = (state.initiative?.actorBindings || []).find((b) => normalize(b.name).toLowerCase() === name.toLowerCase());
    return b && !isPlayerControlledCombatant(state, b);
  });
  if (!available.length) return [];
  const prompt = [
    "Decide if any NPC should use their reaction to a player's attack in D&D 5e.",
    `Available NPCs with reactions: ${available.join(", ")}`,
    `Attack: ${normalize(attackInfo?.attacker)} → ${normalize(attackInfo?.target)}, action: ${normalize(attackInfo?.action)}`,
    `Result: ${attackInfo?.isHit ? "HIT" : "MISS"}${attackInfo?.damage ? `, ${attackInfo.damage} damage` : ""}`,
    "Return JSON only: { \"reactions\": [{ \"character\": \"\", \"action\": \"\", \"notation\": \"\" }] }",
    "Only include NPCs with a meaningful reaction ability (Parry, Shield spell, Counterspell, etc.).",
    "Return empty reactions array if no NPC has a valid reaction here."
  ].filter(Boolean).join("\n");
  const res = await runApiTurn(baseCore, runFlow, createRunCore, {
    channelId: getContextChannel(state),
    payload: prompt,
    userId: state?.session?.channelId || "foundry-reaction-decider",
    doNotWriteToContext: true,
    callerChannelId: state?.session?.channelId
  });
  const parsed = safeParseJson(res?.response, null);
  return Array.isArray(parsed?.reactions) ? parsed.reactions : [];
}

/**
 * After a PC hits and rolls primary damage, checks whether additional damage rolls are needed
 * (Sneak Attack, Divine Smite, Hunter's Mark, Hex, etc.).
 * Returns an array of { label, notation, prompt } objects, or [] if none apply.
 * Skips the AI call entirely when the character has no known bonus damage sources.
 */
async function runBonusDamageCheck(baseCore, runFlow, createRunCore, state, activeBinding, attackName, isCrit) {
  const snap = activeBinding?.actorSnapshot || {};
  const allAttacks = Array.isArray(snap.attacks) ? snap.attacks : [];
  const bonusSources = allAttacks.filter((a) => isBonusDamageAttack(normalize(a.name)));
  const hasSpellSlots = snap.spellSlots && Object.keys(snap.spellSlots).some(
    (k) => (snap.spellSlots[k]?.value ?? 0) > 0
  );
  // Quick exit: no known bonus damage sources → skip AI call
  if (!bonusSources.length && !hasSpellSlots) return [];

  const bonusStr = bonusSources.map((a) => `${a.name}: ${a.damage || "?"}`).join(", ");
  const slotsStr = hasSpellSlots
    ? Object.entries(snap.spellSlots)
        .filter(([, v]) => v.value > 0)
        .map(([k, v]) => `L${k.replace("spell", "")}:${v.value}`)
        .join(" ")
    : "";

  const prompt = [
    "Determine if additional damage rolls are needed after this D&D 5e weapon attack hit.",
    `Attacker: ${normalize(activeBinding.characterName || activeBinding.userName)}`,
    `Weapon used: ${attackName}`,
    isCrit ? "This was a CRITICAL HIT — bonus dice are doubled." : "",
    bonusStr ? `Bonus damage sources: ${bonusStr}` : "",
    slotsStr ? `Spell slots available: ${slotsStr}` : "",
    "RULES:",
    "- Sneak Attack: only if the player confirms sneak attack conditions are met",
    "- Divine Smite: only if the paladin chooses to expend a spell slot (they decide after the hit)",
    "- Hunter's Mark / Hex: automatic if the target is marked — include without asking",
    "- Only include rolls that are applicable to THIS attack",
    "Return JSON only:",
    '{ "bonusRolls": [{ "label": "Sneak Attack", "notation": "3d6", "prompt": "Does Sneak Attack apply? If yes, roll sneak attack damage." }] }',
    "Return empty bonusRolls array if no bonus damage applies to this specific attack."
  ].filter(Boolean).join("\n");

  const res = await runDirectorJson(baseCore, runFlow, createRunCore, state, prompt).catch(() => null);
  return Array.isArray(res?.bonusRolls) ? res.bonusRolls.filter((r) => r.notation && r.label) : [];
}

// ─── Actor stats cache ────────────────────────────────────────────────────────

/**
 * Formats full actor stats as a compact Markdown block for inline use in AI prompts.
 * Separates player characters from NPCs/enemies.
 */
function buildActorStatsMarkdown(actors = [], sessionPlayers = []) {
  if (!Array.isArray(actors) || !actors.length) return "";
  const playerActorIds = new Set((sessionPlayers || []).map((p) => normalize(p.actorId)).filter(Boolean));
  const pcs = actors.filter((a) => a?.hasPlayerOwner || playerActorIds.has(normalize(a?.id)));
  const npcs = actors.filter((a) => !a?.hasPlayerOwner && !playerActorIds.has(normalize(a?.id)));
  const lines = [];

  function formatActor(a) {
    if (!a) return;
    const hpStr = `HP: ${a.hp?.value ?? "?"}/${a.hp?.max ?? "?"}${a.hp?.temp ? ` (+${a.hp.temp} temp)` : ""}`;
    const acStr = `AC: ${a.ac ?? "?"}`;
    const profStr = a.proficiencyBonus ? `PB: +${a.proficiencyBonus}` : "";
    const tagStr = a.cr != null ? `CR ${a.cr}` : a.level != null ? `L${a.level}` : "";
    lines.push(`### ${normalize(a.name) || "Unknown"}${tagStr ? ` [${tagStr}]` : ""} — ${hpStr} | ${acStr}${profStr ? ` | ${profStr}` : ""}`);

    // Ability scores
    if (a.abilities && Object.keys(a.abilities).length) {
      const abilParts = Object.entries(a.abilities).map(([k, v]) => {
        const modStr = v.mod != null ? (v.mod >= 0 ? `+${v.mod}` : `${v.mod}`) : "?";
        return `${k.toUpperCase()} ${v.value ?? "?"}(${modStr})`;
      });
      lines.push(`Abilities: ${abilParts.join(" | ")}`);
      const saveParts = Object.entries(a.abilities)
        .filter(([, v]) => v.save != null)
        .map(([k, v]) => `${k.toUpperCase()} ${v.save >= 0 ? `+${v.save}` : v.save}`);
      if (saveParts.length) lines.push(`Saves: ${saveParts.join(", ")}`);
    }

    // Attacks
    if (Array.isArray(a.attacks) && a.attacks.length) {
      const atkParts = a.attacks.map((atk) => {
        const parts = [normalize(atk.name)];
        if (atk.toHit) parts.push(atk.toHit);
        if (atk.damage) parts.push(`(${atk.damage})`);
        if (atk.range) parts.push(`${atk.range} ft`);
        return parts.join(" ");
      });
      lines.push(`Attacks: ${atkParts.join(" | ")}`);
    }

    // Spell slots
    if (a.spellSlots && Object.keys(a.spellSlots).length) {
      const slotParts = Object.entries(a.spellSlots)
        .map(([k, v]) => `L${k.replace("spell", "")}:${v.value}/${v.max}`);
      lines.push(`Spell slots: ${slotParts.join(" ")}`);
    }

    // Conditions
    if (Array.isArray(a.conditions) && a.conditions.length) {
      lines.push(`Conditions: ${a.conditions.join(", ")}`);
    }
    lines.push("");
  }

  if (pcs.length) {
    lines.push("## Player Characters\n");
    pcs.forEach(formatActor);
  }
  if (npcs.length) {
    lines.push("## NPCs & Enemies\n");
    npcs.forEach(formatActor);
  }
  return lines.join("\n");
}

/**
 * Fetches full D&D5e stats for all active combatants from Foundry, writes
 * foundry-combat-actors.md to the status dir, and updates actorSnapshot on
 * each binding so subsequent AI calls have fresh HP/AC/attack data.
 * Returns the raw actors array or null on failure.
 */
async function fetchAndCacheActorStats(workingObject, state) {
  const bindings = Array.isArray(state.initiative?.actorBindings) ? state.initiative.actorBindings : [];
  // Prefer actorUuid so the module can use fromUuidSync and get the correct token-actor instance
  // (including live HP for unlinked tokens). Fall back to actorId, then name.
  const actorRefs = bindings
    .map((b) => normalize(b.actorUuid) || normalize(b.actorId) || normalize(b.name))
    .filter(Boolean);
  if (!actorRefs.length) return null;

  let actorStats;
  try {
    const res = await invokeFoundryAction(workingObject, "actor-stats", {
      channelKey: state.session.channelKey,
      actorRefs
    });
    if (!Array.isArray(res?.actors) || !res.actors.length) return null;
    actorStats = res.actors;
  } catch { return null; }

  // Write markdown file for context
  const statusDir = getFoundryStatusDir(workingObject);
  const md = buildActorStatsMarkdown(actorStats, state.session?.players || []);
  if (md) {
    await fs.mkdir(statusDir, { recursive: true });
    await fs.writeFile(path.join(statusDir, "foundry-combat-actors.md"), md, "utf8").catch(() => {});
  }

  // Update actorBindings with fresh snapshot data
  for (const binding of bindings) {
    const fresh = actorStats.find((a) =>
      (normalize(a?.id) && normalize(a.id) === normalize(binding.actorId))
      || normalize(a?.name).toLowerCase() === normalize(binding.name).toLowerCase()
    );
    if (fresh) {
      binding.actorSnapshot = {
        ...(binding.actorSnapshot || {}),
        hp: fresh.hp,
        ac: fresh.ac,
        speed: fresh.speed,
        conditions: fresh.conditions,
        abilities: fresh.abilities,
        attacks: fresh.attacks,
        spellSlots: fresh.spellSlots,
        proficiencyBonus: fresh.proficiencyBonus
      };
    }
  }

  return actorStats;
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
  session.situationChannelId = channels.situation;
  session.combatChannelId = channels.combat;
  session.progress = {
    currentLocation: session.currentLocation,
    currentObjective: session.currentObjective,
    currentChapter: session.currentChapter
  };
  await ensureFoundryMarkdownFiles(workingObject);
  const contextSync = await syncCampaignStickyContext(workingObject, session);
  await writePartyCharacterFiles(baseCore, runFlow, createRunCore, workingObject, session);
  let state = createInitialRoundState(session);
  // ── Neue Architektur: Zusatz-State-Felder ──────────────────────────────────
  state.situation = { current: "", nextPossible: [], generatedAt: "" };
  state.history = [];
  state.reactions = { available: [], used: [] };
  state.round.pendingPlayerRolls = [];
  // ──────────────────────────────────────────────────────────────────────────
  state.lastScene = await getCampaignBubble(baseCore, runFlow, createRunCore, state, "Build the opening local story bubble for the current campaign state.");
  state.currentBeat = normalize(state.lastScene?.summary || state.lastScene?.location || session.currentLocation || "the current location");
  // Build initial world state (non-fatal)
  await runWorldStateUpdate(baseCore, runFlow, createRunCore, workingObject, state,
    `Session started at: ${normalize(session.currentLocation || state.lastScene?.location || "unknown location")}`
  ).catch(() => {});

  // Fuel the situation channel with world state + location context
  await fuelSituationChannel(baseCore, runFlow, createRunCore, workingObject, state,
    normalize(session.currentLocation || state.lastScene?.location || "")
  ).catch(() => {});

  // Run situation analysis so foundry-situation.md is populated from the start
  const initSituation = await runSituationAnalysis(baseCore, runFlow, createRunCore, state, []).catch(() => null);
  if (initSituation?.current) {
    state.situation = { current: initSituation.current, nextPossible: initSituation.nextPossible || [], generatedAt: new Date().toISOString() };
    state.currentBeat = initSituation.current;
  }
  // Fetch + write initial character stats
  const initActorRefs = [...session.players.map((p) => normalize(p.actorId) || normalize(p.characterName)).filter(Boolean)];
  if (initActorRefs.length) {
    try {
      const statsRes = await invokeFoundryAction(workingObject, "actor-stats", { channelKey: session.channelKey, actorRefs: initActorRefs });
      if (Array.isArray(statsRes?.actors)) await writeCharactersMd(workingObject, statsRes.actors, session.players);
    } catch { /* non-fatal */ }
  }
  await writeFoundryMarkdownState(workingObject, state);
  await writeSituationMd(workingObject, state);
  state = await writeRoundState(workingObject, state);
  // Opener narration anchored to situation
  const openBeat = normalize(state.currentBeat || state.lastScene?.location || session.currentLocation || "the current location");
  const sceneOpener = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "You are opening an exploration round for a multiplayer D&D session.",
    "RULES: Describe ONLY what is immediately in front of the party. Do not summarize the campaign.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT SITUATION (authoritative): ${openBeat}`,
    "Write 1 to 3 short plain-text sentences describing only the immediate playable situation."
  ].join("\n"));
  if (sceneOpener) {
    state.currentBeat = sceneOpener;
    await writeRoundState(workingObject, state);
    await appendHistoryMd(workingObject, { round: 1, mode: "exploration", text: `Session gestartet: ${sceneOpener}` });
  }
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
  state.round.pendingPlayerRolls = [];
  await writeFoundryMarkdownState(workingObject, state);
  await writeRoundState(workingObject, state);
  await writeSituationMd(workingObject, state);
  const nowBeat = normalize(state.currentBeat || state.lastScene?.summary || state.lastScene?.location || state.session?.progress?.currentLocation || "current location");
  const scenePrompt = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "You are the DM narrator for a multiplayer D&D session.",
    "RULES: Your narration must match the current beat exactly. Do NOT advance to a future location. Do NOT contradict what already happened.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT BEAT (authoritative — do not override): ${nowBeat}`,
    resolutionText ? `What just happened: ${resolutionText}` : "",
    "Write at most 2 short plain-text sentences that set the scene as described in the current beat."
  ].filter(Boolean).join("\n"));
  // Keep currentBeat anchored to what was just narrated so the next director call
  // continues from here rather than drifting to a new scene.
  if (scenePrompt) {
    state.currentBeat = scenePrompt;
    await writeRoundState(workingObject, state);
    await appendHistoryMd(workingObject, { round: state.round.number, mode: "exploration", text: scenePrompt });
  }
  return buildExplorationTurnPrompt(state, scenePrompt);
}

async function resolveExplorationRound(baseCore, runFlow, createRunCore, workingObject, state) {
  const actions = Array.isArray(state?.round?.acceptedActions) ? state.round.acceptedActions : [];
  let availableActorNames = "";
  try {
    const actorsRes = await invokeFoundryAction(workingObject, "actors", {
      channelKey: state.session.channelKey,
      limit: 80
    });
    if (Array.isArray(actorsRes?.actors) && actorsRes.actors.length) {
      availableActorNames = actorsRes.actors.map((a) => normalize(a?.name)).filter(Boolean).join(", ");
    }
  } catch { /* non-fatal */ }

  const currentLocation = normalize(state.lastScene?.location || state.session?.progress?.currentLocation || "unknown location");
  const currentBeatForDirector = normalize(state.currentBeat || state.lastScene?.summary || currentLocation);

  // ── Call 1: fast decision — mode, beat, threats, combatants ─────────────────
  // Kept small so small models can focus. Returns 7 keys only.
  const directorDecision = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Resolve a multiplayer D&D exploration round. ADVANCE THE STORY ONE BEAT AT A TIME.",
    "",
    "HARD RULES — follow these without exception:",
    "1. Only describe what happens in the next 1-5 in-game minutes at the CURRENT location. Never skip ahead.",
    "2. Travel is NOT instant. If players decide to go somewhere, the next beat is 'they set out' or 'they are en route' — NOT 'they arrive'.",
    "3. NPCs at other locations cannot speak, react, or interact. Only NPCs physically present can act.",
    "4. Quest progression is gradual — never jump steps.",
    "5. Set modeSwitch='initiative' ONLY if an enemy is actively hostile and physically present RIGHT NOW.",
    "6. For 'enemies' and 'allies': use ONLY names from the available Foundry actors list. Repeat names for multiples.",
    "7. 'currentBeat' must be the DIRECT NEXT STEP from the authoritative beat below. Never open a new scene.",
    "",
    `CURRENT AUTHORITATIVE BEAT: ${currentBeatForDirector}`,
    "",
    availableActorNames ? `Available Foundry actors (EXACT names): ${availableActorNames}` : "",
    `Current party location: ${currentLocation}`,
    `Player action submissions JSON:\n${JSON.stringify(actions, null, 2)}`,
    "",
    "Return JSON only — 7 keys, nothing else:",
    "{",
    '  "modeSwitch": "exploration" | "initiative",',
    '  "leaveLocation": false,',
    '  "currentBeat": "1-2 sentences: EXACTLY where the party is and what is happening right now",',
    '  "summary": "DM-only summary of what happens NOW (one beat)",',
    '  "activeThreats": "short threat summary or empty string",',
    '  "enemies": ["exact Foundry token name"],',
    '  "allies": ["exact Foundry token name"]',
    "}",
    "leaveLocation: true ONLY when the party has JUST completed travel to a new location in THIS beat."
  ].join("\n")) || {};

  const switchingToInitiative = normalize(directorDecision.modeSwitch).toLowerCase() === "initiative";

  // ── Call 2: details — only when staying in exploration ──────────────────────
  // Skipped entirely on mode-switch to keep combat startup fast.
  let directorDetails = {};
  if (!switchingToInitiative) {
    directorDetails = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
      "You are completing the details phase of a D&D exploration round resolution.",
      "The beat has already been decided. Your job: decide if any player rolls or clarifications are needed.",
      "",
      `CURRENT BEAT (already decided): ${normalize(directorDecision.currentBeat || currentBeatForDirector)}`,
      `Director summary: ${normalize(directorDecision.summary || "")}`,
      `Current party location: ${currentLocation}`,
      `Party roster JSON:\n${JSON.stringify(state.session.players, null, 2)}`,
      `Player action submissions JSON:\n${JSON.stringify(actions, null, 2)}`,
      `Current scene JSON:\n${JSON.stringify(state.lastScene, null, 2)}`,
      "",
      "Return JSON only — 4 keys, nothing else:",
      "{",
      '  "clarifications": [{"userId":"","userName":"","prompt":"","rollNeeded":"","dc":"","reason":""}],',
      '  "npcRolls": [{"label":"","notation":"","visibility":"gmroll"}],',
      '  "pendingPlayerRolls": [{"userId":"","characterName":"","type":"skill|save|attack|check","notation":"e.g. 1d20+3","dc":"10","label":"Perception Check"}],',
      '  "sceneUpdate": {"location":"current location — only change if party just finished traveling","objective":"","chapter":"","summary":"what is immediately visible/audible NOW","nearbyEvents":"","nearbyNpcs":"","nearbyHazards":"","nextBeats":"","drift":"","loadNext":"","sourceAnchor":""}',
      "}",
      "Leave clarifications, npcRolls, pendingPlayerRolls as empty arrays if not needed."
    ].join("\n")) || {};
  }

  // Merge into a unified director object so the rest of the function is unchanged
  const director = { ...directorDecision, ...directorDetails };

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

  // Collect player rolls requested by the director
  const pendingPlayerRolls = (Array.isArray(director.pendingPlayerRolls) ? director.pendingPlayerRolls : [])
    .map((entry) => {
      const rawDc = Number(entry?.dc);
      return {
        userId: normalize(entry?.userId),
        characterName: normalize(entry?.characterName),
        type: normalize(entry?.type) || "check",
        notation: normalize(entry?.notation) || "1d20",
        // Clamp DC to valid D&D range; leave empty if not provided
        dc: Number.isFinite(rawDc) && rawDc > 0
          ? String(Math.max(5, Math.min(30, rawDc)))
          : "",
        label: normalize(entry?.label) || "Roll",
        response: null
      };
    })
    .filter((entry) => entry.userId && entry.notation);

  state.lastResolution = {
    summary: normalize(director.summary),
    activeThreats: normalize(director.activeThreats),
    modeSwitch: normalize(director.modeSwitch || "exploration"),
    npcRollResults
  };

  if (director.sceneUpdate && typeof director.sceneUpdate === "object") {
    state.lastScene = { ...state.lastScene, ...director.sceneUpdate, generatedAt: new Date().toISOString() };
  }

  // leaveLocation: dump situation to campaign, update world state, refuel situation channel
  if (director.leaveLocation === true) {
    const leaveEvent = `Party moved to: ${normalize(state.lastScene?.location || "new location")}. ${normalize(director.currentBeat || "")}`;
    // Non-blocking — session continues regardless
    writeSituationToCampaign(baseCore, runFlow, createRunCore, workingObject, state, leaveEvent).catch(() => {});
    fuelSituationChannel(baseCore, runFlow, createRunCore, workingObject, state, normalize(state.lastScene?.location || "")).catch(() => {});
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
  // switchingToInitiative already declared above from Call 1

  const enemyNames = Array.isArray(director.enemies) ? [...new Set(director.enemies.map((e) => normalize(e)).filter(Boolean))] : [];
  const allyNames = Array.isArray(director.allies) ? [...new Set(director.allies.map((e) => normalize(e)).filter(Boolean))] : [];

  const resolutionText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Present the resolution of a D&D exploration round in plain text for Foundry chat.",
    "RULES: Your narration must match the current beat exactly. Do NOT jump to a destination or skip story steps. Do NOT contradict what the director summary says.",
    "Do NOT end with a question like 'What do you do?' — the system adds the player prompt automatically.",
    `CURRENT BEAT (authoritative): ${resBeat}`,
    `Director resolution summary:\n${normalize(director.summary) || "-"}`,
    `NPC roll results JSON:\n${JSON.stringify(npcRollResults, null, 2)}`,
    switchingToInitiative && enemyNames.length
      ? `Combat is starting. NAME the following enemies explicitly in your narration: ${enemyNames.join(", ")}. Do not call them 'assailants' or 'attackers' — use their names.`
      : "",
    "Write 2 to 4 short sentences narrating exactly this beat."
  ].filter(Boolean).join("\n"));

  if (switchingToInitiative) {
    // Build a clear combatant announcement before initiative rolls
    const enemyLine = enemyNames.length ? `⚔️ Feinde: ${enemyNames.join(", ")}` : "";
    const allyLine = allyNames.length ? `🛡️ Verbündete: ${allyNames.join(", ")}` : "";
    const combatantAnnouncement = ["Kampf beginnt!", enemyLine, allyLine].filter(Boolean).join("\n");
    return await startInitiativeMode(baseCore, runFlow, createRunCore, workingObject, state, director, resolutionText, combatantAnnouncement);
  }

  // If the director requests player rolls, enter awaiting_player_dice before advancing
  if (pendingPlayerRolls.length > 0) {
    state.phase = "awaiting_player_dice";
    state.round.pendingPlayerRolls = pendingPlayerRolls;
    state.round.activePlayerIndex = 0;
    await writeRoundState(workingObject, state);
    const first = pendingPlayerRolls[0];
    const dcText = first.dc ? ` (DC ${first.dc})` : "";
    return {
      messages: [
        { text: resolutionText, type: "bot" },
        { text: `${first.characterName || first.userId}, roll ${first.label}: \`${first.notation}\`${dcText}`, type: "bot" }
      ]
    };
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

/**
 * Handles awaiting_player_dice phase: director requested one or more player rolls.
 * Players roll in Foundry → round-input arrives → validate → advance to next or resolve.
 */
async function handlePlayerDiceRoll(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const rolls = Array.isArray(state.round?.pendingPlayerRolls) ? state.round.pendingPlayerRolls : [];
  const current = rolls.find((r) => r.response == null);
  if (!current) {
    // All done — continue to narrator + next prompt
    const resText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
      "Resolve a D&D exploration round after all requested player rolls.",
      "RULES: Only describe what is happening RIGHT NOW. Do not skip ahead. Do NOT end with a question.",
      `CURRENT BEAT (authoritative): ${normalize(state.currentBeat || state.lastScene?.summary || "the current location")}`,
      `Director summary: ${normalize(state?.lastResolution?.summary) || "-"}`,
      `Player roll results: ${JSON.stringify(rolls, null, 2)}`,
      "Write 2 to 4 short plain-text sentences."
    ].join("\n"));
    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resText);
    return { accepted: true, messages: [{ text: resText, type: "bot" }, { text: nextPrompt, type: "bot" }] };
  }

  if (!doesMessageBelongToPlayer(message, { userId: current.userId, userName: current.characterName, characterName: current.characterName })) {
    return { accepted: false, messages: [] };
  }

  const rollTotal = extractFirstRollTotal(message);
  if (!Number.isFinite(rollTotal)) {
    return {
      accepted: true,
      messages: [{ text: `${current.characterName}, please send your roll as a Foundry dice roll or number.`, type: "bot" }]
    };
  }

  // Run plausibility validator
  const validation = await runRollValidator(baseCore, runFlow, createRunCore, state, current, current.type, rollTotal, current.notation).catch(() => ({ valid: true, message: "" }));
  if (!validation.valid) {
    return {
      accepted: true,
      messages: [{ text: validation.message || `${current.characterName}, that roll looks off — please check and re-roll.`, type: "bot" }]
    };
  }

  current.response = rollTotal;
  await appendHistoryMd(workingObject, { round: state.round.number, mode: "exploration", text: `${current.characterName} rolled ${current.label}: ${rollTotal}` });

  // Check for next pending roll
  const next = rolls.find((r) => r.response == null);
  if (next) {
    state.round.pendingPlayerRolls = rolls;
    await writeRoundState(workingObject, state);
    const dcText = next.dc ? ` (DC ${next.dc})` : "";
    return {
      accepted: true,
      messages: [{ text: `${next.characterName || next.userId}, roll ${next.label}: \`${next.notation}\`${dcText}`, type: "bot" }]
    };
  }

  // All rolls done — narrate outcome + advance
  state.round.pendingPlayerRolls = rolls;
  await writeRoundState(workingObject, state);

  const resText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Resolve a D&D exploration round after all requested player rolls.",
    "RULES: Only describe what is happening RIGHT NOW. Do not skip ahead. Do NOT end with a question.",
    `CURRENT BEAT (authoritative): ${normalize(state.currentBeat || state.lastScene?.summary || "the current location")}`,
    `Director summary: ${normalize(state?.lastResolution?.summary) || "-"}`,
    `Player roll results: ${JSON.stringify(rolls, null, 2)}`,
    "Write 2 to 4 short plain-text sentences."
  ].join("\n"));
  const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, resText);
  return { accepted: true, messages: [{ text: resText, type: "bot" }, { text: nextPrompt, type: "bot" }] };
}

// ─── INITIATIVE LOOP ───────────────────────────────────────────────────────────

async function startInitiativeMode(baseCore, runFlow, createRunCore, workingObject, state, director, resolutionText, combatantAnnouncement = "") {
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

  // Fetch and cache full actor stats for all combatants now that the tracker is populated.
  // This writes foundry-combat-actors.md and enriches actorBinding.actorSnapshot.
  await fetchAndCacheActorStats(workingObject, state).catch(() => {});
  await writeRoundState(workingObject, state);

  // Fuel combat channel with world state + combat situation brief + combatant stats
  await fuelCombatChannel(baseCore, runFlow, createRunCore, workingObject, state, director).catch(() => {});

  const trackerMsg = state.initiative.combatId
    ? `⚔️ Combat Tracker geöffnet (ID: ${state.initiative.combatId}). Initiative-Runde beginnt!`
    : "⚔️ Combat Tracker wird geöffnet. Initiative-Runde beginnt!";
  const playerCount = state.initiative.pendingInitiatives.length;
  const npcCount = npcInitiatives.length;
  const rosterMsg = `Kämpfer: ${playerCount} Spieler, ${npcCount} NSC${npcCount !== 1 ? "s" : ""}.`;

  const messages = [
    { text: resolutionText, type: "bot" }
  ];
  if (combatantAnnouncement) messages.push({ text: combatantAnnouncement, type: "bot" });
  messages.push({ text: `${trackerMsg} ${rosterMsg}`, type: "bot" });
  if (nscWarning) messages.push({ text: nscWarning, type: "bot" });
  messages.push({ text: buildInitiativePrompt(state), type: "bot" });

  // Start 60s auto-assign timer for first pending player
  const initTimerKey = state.session.channelKey || workingObject.channelId;
  clearCombatTimer(initTimerKey);
  const capturedInitWo = { ...workingObject };
  combatTimers.set(initTimerKey, setTimeout(() => {
    fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedInitWo, initTimerKey).catch(console.error);
  }, 60000));

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

  // Init reactions: all combatants start with reactions available
  const allCombatantNames = (Array.isArray(state.initiative.turnOrder) ? state.initiative.turnOrder : [])
    .map((c) => normalize(c.name))
    .filter(Boolean);
  if (!state.reactions) state.reactions = { available: [], used: [] };
  state.reactions.available = allCombatantNames;
  state.reactions.used = [];
  await writeReactionsMd(workingObject, state).catch(() => {});

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

  // Player responded — clear the auto-assign timer
  const initTimerKey = state.session.channelKey || workingObject.channelId;
  clearCombatTimer(initTimerKey);

  const initiative = extractFirstRollTotal(message);
  if (!Number.isFinite(initiative)) {
    // Invalid input — restart timer and re-ask
    const capturedWo = { ...workingObject };
    combatTimers.set(initTimerKey, setTimeout(() => {
      fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedWo, initTimerKey).catch(console.error);
    }, 60000));
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
    // Start timer for the next pending player
    const capturedWo = { ...workingObject };
    combatTimers.set(initTimerKey, setTimeout(() => {
      fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedWo, initTimerKey).catch(console.error);
    }, 60000));
    return { accepted: true, messages: [{ text: buildInitiativePrompt(state), type: "bot" }] };
  }

  // All players have rolled — finalize and start combat (timer already cleared above)
  return await finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, workingObject, state);
}

/**
 * Timer callback: auto-assign initiative for a player who didn't respond within 60s.
 * Rolls 1d20 + DEX modifier from their snapshot, or uses 10 as a neutral fallback.
 * Restarts the timer for the next pending player, or finalizes combat if all are done.
 */
async function fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedWo, timerKey) {
  clearCombatTimer(timerKey);
  let state;
  try {
    state = await readRoundState(capturedWo);
  } catch { return; }
  if (state.mode !== "initiative" || state.phase !== "awaiting_player_initiative") return;

  const pending = Array.isArray(state.initiative?.pendingInitiatives) ? state.initiative.pendingInitiatives : [];
  const current = pending.find((e) => e.initiative == null);
  if (!current) return;

  const binding = (state.initiative.actorBindings || []).find((b) =>
    normalize(b.userId) === normalize(current.userId) ||
    normalize(b.characterName).toLowerCase() === normalize(current.characterName || current.userName).toLowerCase()
  );
  const dexMod = binding?.actorSnapshot?.abilities?.dex?.mod ?? 0;
  const autoInitiative = Math.max(1, Math.floor(Math.random() * 20) + 1 + dexMod);
  current.initiative = autoInitiative;

  await invokeFoundryAction(capturedWo, "initiative", {
    channelKey: state.session.channelKey,
    operation: "set",
    combatRef: state.initiative.combatId || state.initiative.combatName,
    initiatives: [{ actorRef: normalize(current.actorId) || getPlayerLabel(current), name: getPlayerLabel(current), initiative: autoInitiative }],
    activateHighest: false
  }).catch(() => {});

  const skipMsg = `⏱️ ${getPlayerLabel(current)}: keine Initiative-Antwort — automatisch ${autoInitiative} zugewiesen.`;
  const next = pending.find((e) => e.initiative == null);
  if (next) {
    await writeRoundState(capturedWo, state);
    clearCombatTimer(timerKey);
    combatTimers.set(timerKey, setTimeout(() => {
      fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedWo, timerKey).catch(console.error);
    }, 60000));
    await postBotMessagesToFoundry(capturedWo, [
      { text: skipMsg, type: "bot" },
      { text: buildInitiativePrompt(state), type: "bot" }
    ]);
  } else {
    const result = await finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, capturedWo, state, [skipMsg]);
    await postBotMessagesToFoundry(capturedWo, Array.isArray(result.messages) ? result.messages : []);
  }
}

// ─── COMBAT LOOP ───────────────────────────────────────────────────────────────

/**
 * Checks the currently active combatant:
 * - If it's a player: emits the turn prompt and returns.
 * - If it's an NPC: fires startNpcCombatTurn which runs the same attack/reaction
 *   timer chain as a player turn. The chain self-advances via fireCombatDamageAndAdvance.
 * - If no active binding exists: emits a warning with !dm guidance.
 */
async function advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, workingObject, state) {
  const activeBinding = getActiveCombatantBinding(state);

  if (!activeBinding) {
    const hasAnyPlayerInTracker = Array.isArray(state.initiative?.actorBindings) &&
      state.initiative.actorBindings.some((b) => isPlayerControlledCombatant(state, b));
    await writeRoundState(workingObject, state);
    if (!hasAnyPlayerInTracker) {
      return {
        state,
        messages: [{
          text: "⚠️ Kein Spieler-Combatant im Combat Tracker gefunden. Mögliche Ursachen: Actor existiert nicht in game.actors, oder session-sync wurde ohne actorId durchgeführt. Nutze '!dm skip' um zur nächsten Runde zu springen, oder '!dm reset' um zurück zu Exploration zu gehen.",
          type: "bot"
        }]
      };
    }
    return { state, messages: [{ text: "Alle Kämpfer haben diese Runde agiert.", type: "bot" }] };
  }

  if (isPlayerControlledCombatant(state, activeBinding)) {
    const promptText = buildCombatTurnPrompt(state, {
      name: activeBinding.characterName || activeBinding.userName
    });
    await writeRoundState(workingObject, state);
    return { state, messages: [{ text: promptText, type: "bot" }] };
  }

  // NPC turn: run the same attack/reaction/damage timer chain as a player turn
  return await startNpcCombatTurn(baseCore, runFlow, createRunCore, workingObject, state, activeBinding);
}

/**
 * Drives an NPC's combat turn through the full attack/reaction/damage chain.
 * The NPC's action is decided by the director AI; then startCombatResolution
 * handles rolls, posts messages, and schedules the 10 s reaction timers exactly
 * as it does for player turns. fireCombatDamageAndAdvance → advanceCombatUntilPlayerTurn
 * continues the chain automatically.
 */
async function startNpcCombatTurn(baseCore, runFlow, createRunCore, workingObject, state, activeBinding) {
  const npcName = normalize(activeBinding.characterName || activeBinding.userName || "Enemy");

  // Build a compact stat block for this NPC from the cached snapshot
  const snap = activeBinding.actorSnapshot || {};
  const npcStatLines = [];
  if (snap.hp) npcStatLines.push(`HP: ${snap.hp.value ?? "?"}/${snap.hp.max ?? "?"} | AC: ${snap.ac ?? "?"}`);
  if (snap.abilities) {
    const ab = snap.abilities;
    npcStatLines.push(
      `STR ${ab.str?.value ?? "?"}(${ab.str?.mod != null ? (ab.str.mod >= 0 ? `+${ab.str.mod}` : ab.str.mod) : "?"}) | ` +
      `DEX ${ab.dex?.value ?? "?"}(${ab.dex?.mod != null ? (ab.dex.mod >= 0 ? `+${ab.dex.mod}` : ab.dex.mod) : "?"}) | ` +
      `CON ${ab.con?.value ?? "?"}(${ab.con?.mod != null ? (ab.con.mod >= 0 ? `+${ab.con.mod}` : ab.con.mod) : "?"})`
    );
  }
  if (Array.isArray(snap.attacks) && snap.attacks.length) {
    npcStatLines.push(`Attacks: ${snap.attacks.map((a) => [a.name, a.toHit, a.damage ? `(${a.damage})` : ""].filter(Boolean).join(" ")).join(" | ")}`);
  }
  if (Array.isArray(snap.conditions) && snap.conditions.length) {
    npcStatLines.push(`Conditions: ${snap.conditions.join(", ")}`);
  }

  // Build target options from combatants that are player-controlled
  const targetOptions = (state.initiative.actorBindings || [])
    .filter((b) => isPlayerControlledCombatant(state, b))
    .map((b) => normalize(b.name));

  // Ask the director what the NPC does this turn
  const npcActionDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Decide what action an NPC takes on their D&D 5e combat turn.",
    `NPC: ${npcName}`,
    npcStatLines.length ? `NPC stats:\n${npcStatLines.join("\n")}` : "",
    targetOptions.length ? `Possible targets (player characters): ${targetOptions.join(", ")}` : "",
    `Combat turn order (current index ${state.initiative.currentTurnIndex}): ${JSON.stringify((state.initiative.turnOrder || []).map((c) => c.name), null, 2)}`,
    `Current beat: ${normalize(state.currentBeat || state.lastScene?.summary || "ongoing combat")}`,
    "Use the NPC's actual listed attacks if available. Pick the most tactically appropriate one.",
    "Return JSON only:",
    '{ "action": "What the NPC does — which attack, against which target, and any tactical detail (1–2 sentences)", "targetName": "name of primary target" }'
  ].filter(Boolean).join("\n")) || {};

  const actionText = normalize(npcActionDir?.action) || `${npcName} attacks!`;

  // Wire up lastPlayerAction exactly as commitCombatAction does for player turns
  state.initiative.lastPlayerAction = {
    combatantId: normalize(activeBinding.combatantId),
    actorId: normalize(activeBinding.actorId),
    name: npcName,
    text: actionText,
    isNpc: true,
    createdAt: new Date().toISOString()
  };
  state.initiative.turnFollowupHistory = [];

  // Delegate to the shared resolution chain (rolls → pre-reaction window → hit → post-reaction window → damage → advance)
  return await startCombatResolution(baseCore, runFlow, createRunCore, workingObject, state);
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

  // If this looks like a question rather than an action declaration, answer it briefly
  // and keep the turn prompt open. A question contains "?" or starts with a question word.
  const isLikelyQuestion = actionText.includes("?")
    || /^(what|wie|was|warum|why|how|can i|kann ich|darf ich|which|welche|wer|who)\b/i.test(actionText.trim());
  if (isLikelyQuestion && !isOkSignal(actionText)) {
    const snap = activeBinding?.actorSnapshot || {};
    const snapHint = snap.attacks?.length
      ? `${playerLabel}'s attacks: ${snap.attacks.map((a) => [a.name, a.toHit].filter(Boolean).join(" ")).join(", ")}`
      : "";
    const answer = await runNarratorText(baseCore, runFlow, createRunCore, state, [
      "A player has a question on their combat turn. Answer briefly (1-2 sentences) using the current combat state.",
      `Player (${playerLabel}) asks: "${actionText}"`,
      snapHint,
      `Current combat context: ${normalize(state.currentBeat || state.lastScene?.summary || "ongoing combat")}`,
      "Answer concisely. Then prompt them to declare their action."
    ].join("\n"));
    return {
      accepted: true,
      messages: [{ text: answer || `${playerLabel}, what is your action this turn?`, type: "bot" }]
    };
  }

  if (!isOkSignal(actionText)) {
    const history = [{ role: "player", text: actionText }];
    const evaluation = await runActionEvaluator(baseCore, runFlow, createRunCore, state, "combat_action", playerLabel, history);
    if (!evaluation.accepted) {
      // Action needs clarification — stay in followup for clarification (not completion)
      state.initiative.awaitingTurnCompletion = false;
      state.phase = "combat_turn_followup";
      state.initiative.turnFollowupHistory = [
        ...history,
        { role: "dm", text: evaluation.message }
      ];
      await writeRoundState(workingObject, state);
      return { accepted: true, messages: [{ text: evaluation.message, type: "bot" }] };
    }
  }

  // Action is clear — commit immediately. Remaining turn components (move/bonus) are
  // offered as the OUTER loop after the attack + damage resolve, not before.
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
    // "ok" during clarification — commit the last substantive input
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

  // Clarification done — commit (outer loop for move/bonus runs after resolution)
  return await commitCombatAction(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, inputText);
}

/**
 * After the PC's attack (and optional damage) resolves, advance the turn and prompt next combatant.
 * Resets the active combatant's reaction availability.
 * prefixMessages: messages to prepend before the next-turn prompt.
 */
async function finalizePcTurnAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, prefixMessages = []) {
  // Restore reaction for the active combatant (their turn is done)
  const activeName = normalize(activeBinding.characterName || activeBinding.userName);
  restoreReaction(state, activeName);
  await writeReactionsMd(workingObject, state).catch(() => {});

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
  state.initiative.turnEndMissing = null;
  await writeRoundState(workingObject, state);

  const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, workingObject, state);
  return { accepted: true, messages: [...prefixMessages, ...advanced.messages] };
}

/**
 * OUTER TURN LOOP — phase: combat_awaiting_turn_end
 *
 * After the PC's action has been fully resolved (attack + damage, or miss), ask ONCE
 * whether they want to use remaining turn resources (move, bonus action).
 * Player says 'ready/fertig/ok' to end immediately, or declares what they want to do.
 * After one additional declaration the turn always advances (ask at most once).
 * Questions are answered and the phase stays open.
 */
async function handleCombatAwaitingTurnEnd(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const inputText = getRoundInputText(message);
  const playerLabel = normalize(activeBinding.characterName || activeBinding.userName);

  // "ready/ok/fertig" → end turn immediately
  if (isOkSignal(inputText)) {
    return await finalizePcTurnAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding);
  }

  // Question → answer briefly, stay in turn-end phase
  const isQuestion = inputText.includes("?")
    || /^(what|wie|was|warum|why|how|can i|kann ich|darf ich|which|welche|wer|who)\b/i.test(inputText.trim());
  if (isQuestion) {
    const remaining = [];
    const miss = state.initiative.turnEndMissing || {};
    if (!miss.hasMovement) remaining.push("movement");
    if (!miss.hasBonusAction) remaining.push("bonus action");
    const answer = await runNarratorText(baseCore, runFlow, createRunCore, state, [
      "A player has a question during their turn-end phase in D&D combat.",
      `Player (${playerLabel}) asks: "${inputText}"`,
      remaining.length ? `Remaining available: ${remaining.join(", ")}` : "Their turn resources are expended.",
      "Answer briefly in 1-2 sentences, then remind them they can declare remaining actions or say 'ready' to end their turn."
    ].join("\n"));
    return { accepted: true, messages: [{ text: answer || `${playerLabel}, declare your remaining action or say 'ready'.`, type: "bot" }] };
  }

  // Player declared an additional action (movement, bonus action, etc.)
  // Narrate it briefly, then always advance — the outer loop fires at most once.
  const supplementalNarration = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    `${playerLabel} also does: "${inputText}"`,
    "Narrate this in 1 dramatic present-tense sentence. No roll results, no hit/miss."
  ].join("\n"));

  return await finalizePcTurnAndAdvance(
    baseCore, runFlow, createRunCore, workingObject, state, activeBinding,
    supplementalNarration ? [{ text: supplementalNarration, type: "bot" }] : []
  );
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
  return await startCombatResolutionPc(baseCore, runFlow, createRunCore, workingObject, state);
}

/**
 * PC COMBAT RESOLUTION: Director picks attack + flavor, bot asks player to roll in Foundry.
 * Player rolls attack → combat_awaiting_attack_roll → hit/miss check → combat_awaiting_damage_roll
 * This keeps player dice in player hands while the bot handles all math.
 */
async function startCombatResolutionPc(baseCore, runFlow, createRunCore, workingObject, state) {
  let activeBinding = getActiveCombatantBinding(state);
  const lastAction = state.initiative.lastPlayerAction;

  // If the snapshot is missing or has no attacks/abilities, try a fresh fetch now
  const snapEmpty = !activeBinding?.actorSnapshot?.attacks?.length && !activeBinding?.actorSnapshot?.abilities;
  if (snapEmpty) {
    await fetchAndCacheActorStats(workingObject, state).catch(() => {});
    await writeRoundState(workingObject, state);
    activeBinding = getActiveCombatantBinding(state); // re-read after refresh
  }

  // Build compact attacker stat block from cached snapshot
  const snap = activeBinding?.actorSnapshot || {};
  const snapLines = [];
  if (snap.hp) snapLines.push(`HP: ${snap.hp.value ?? "?"}/${snap.hp.max ?? "?"} | AC: ${snap.ac ?? "?"} | PB: ${snap.proficiencyBonus != null ? `+${snap.proficiencyBonus}` : "?"}`);
  if (snap.abilities) {
    const ab = snap.abilities;
    const mods = ["str", "dex", "con", "int", "wis", "cha"]
      .map((k) => `${k.toUpperCase()} ${ab[k]?.mod != null ? (ab[k].mod >= 0 ? `+${ab[k].mod}` : ab[k].mod) : "?"}`)
      .join(" | ");
    snapLines.push(`Modifiers: ${mods}`);
  }
  if (Array.isArray(snap.attacks) && snap.attacks.length) {
    snapLines.push(`Known attacks: ${snap.attacks.map((a) => [a.name, a.toHit, a.damage ? `(${a.damage})` : ""].filter(Boolean).join(" ")).join(" | ")}`);
  }

  // Try to detect which weapon the player explicitly named in their action text.
  // Bonus damage abilities (Sneak Attack, Divine Smite, etc.) are excluded — they are
  // rolled AFTER the weapon attack, never chosen as the primary attack.
  const declaredTextLower = normalize(lastAction?.text).toLowerCase();
  const attacks = Array.isArray(snap.attacks) ? snap.attacks : [];
  const weaponAttacks = attacks.filter((a) => !isBonusDamageAttack(normalize(a.name)));
  const playerMentionedAttack = weaponAttacks.find((a) => {
    const aName = normalize(a.name).toLowerCase();
    return declaredTextLower.includes(aName)
      || aName.split(/\s+/).some((w) => w.length > 3 && declaredTextLower.includes(w));
  }) || null;
  const weaponAttackNames = weaponAttacks.map((a) => `"${normalize(a.name)}"`).join(", ");

  const combatDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Choose the combat action for a D&D 5e PLAYER turn. Your ONLY job: pick which attack and which target.",
    "HARD RULES — no exceptions:",
    "1. Pick attackName EXACTLY from the VALID WEAPON ATTACKS list. Do NOT pick bonus damage abilities.",
    "2. NEVER pick Sneak Attack, Divine Smite, Hunter's Mark, Hex, or similar as attackName — these are bonus damage, not standalone attacks.",
    "3. Do NOT invent saving throws, skill checks, spell saves, or any other mechanics.",
    "4. The player rolls all dice — you only pick name + target + flavor sentence.",
    "5. NEVER substitute a spell for a declared physical weapon attack.",
    playerMentionedAttack
      ? `MANDATORY OVERRIDE: The player explicitly named "${normalize(playerMentionedAttack.name)}" — attackName MUST be exactly "${normalize(playerMentionedAttack.name)}". Any other value is wrong.`
      : `VALID WEAPON ATTACKS (only these are allowed): ${weaponAttackNames || "none — use empty string"}`,
    `Active combatant: ${normalize(activeBinding?.characterName || activeBinding?.userName)}`,
    snapLines.length ? `Attacker stats:\n${snapLines.join("\n")}` : "No snapshot available — use unarmed strike as fallback.",
    `Declared action: ${normalize(lastAction?.text)}`,
    `Active opponents: ${(state.initiative?.actorBindings || []).filter((b) => !isPlayerControlledCombatant(state, b)).map((b) => normalize(b.name)).join(", ") || "none"}`,
    "Return JSON only — nothing else:",
    `{`,
    `  "attackName": "exact name from Known attacks list, or empty string",`,
    `  "targetName": "name of the target combatant",`,
    `  "flavor": "One dramatic present-tense sentence — NO roll results, NO hit/miss, NO mechanics",`,
    `  "hasAdvantage": false,`,
    `  "hasDisadvantage": false,`,
    `  "combatEnds": false`,
    `}`
  ].filter(Boolean).join("\n")) || {};

  // Code-level override: if the player explicitly named a weapon, use it regardless of what the
  // director returned. If director returned a bonus-damage ability, fall back to first weapon.
  const directorAttack = matchAttack(activeBinding?.actorSnapshot, combatDir.attackName);
  const attack = playerMentionedAttack
    || (directorAttack && !isBonusDamageAttack(normalize(directorAttack.name)) ? directorAttack : null)
    || weaponAttacks[0]
    || directorAttack;
  let attackBonus = parseAttackBonus(attack?.toHit);
  if (attackBonus === null) {
    const snap = activeBinding?.actorSnapshot || {};
    const pb = snap.proficiencyBonus ?? 2;
    const strMod = snap.abilities?.str?.mod ?? 0;
    const dexMod = snap.abilities?.dex?.mod ?? 0;
    attackBonus = pb + Math.max(strMod, dexMod);
  }
  const notation = combatDir.hasAdvantage
    ? `2d20kh1+${attackBonus}`
    : combatDir.hasDisadvantage
      ? `2d20kl1+${attackBonus}`
      : `1d20+${attackBonus}`;

  state.initiative.lastAttackResult = { combatDir, attackRollResult: null, isHit: null, isCrit: false, attack, pendingNotation: notation };
  state.initiative.pendingReactions = [];
  state.phase = "combat_awaiting_attack_roll";
  await writeRoundState(workingObject, state);

  const flavor = normalize(combatDir.flavor) ||
    `${normalize(activeBinding?.characterName || activeBinding?.userName)} attacks${combatDir.targetName ? ` ${combatDir.targetName}` : ""}!`;
  const targetAcHint = getTargetAC(state, combatDir.targetName);
  const acHint = targetAcHint != null ? ` (target AC: ${targetAcHint})` : "";

  return {
    accepted: true,
    messages: [{ text: `${flavor}\n🎲 **${normalize(activeBinding?.characterName || activeBinding?.userName)}**, roll attack: \`${notation}\`${acHint}`, type: "bot" }]
  };
}

/**
 * COMBAT RESOLUTION CHAIN (NPC / auto-rolled):
 * 1. Director determines rolls needed.
 * 2. Attack rolls are made via Foundry immediately.
 * 3. Attack announcement posted → reaction window opens (10s).
 * 4. [Timer 1] Hit/miss posted → second reaction window (10s).
 * 5. [Timer 2] Damage applied, turn advanced, next combatant prompted.
 */
async function startCombatResolution(baseCore, runFlow, createRunCore, workingObject, state) {
  const activeBinding = getActiveCombatantBinding(state);
  const lastAction = state.initiative.lastPlayerAction;

  // Build compact attacker stat block from cached snapshot
  const snap = activeBinding?.actorSnapshot || {};
  const snapLines = [];
  if (snap.hp) snapLines.push(`HP: ${snap.hp.value ?? "?"}/${snap.hp.max ?? "?"} | AC: ${snap.ac ?? "?"} | PB: ${snap.proficiencyBonus != null ? `+${snap.proficiencyBonus}` : "?"}`);
  if (snap.abilities) {
    const ab = snap.abilities;
    const mods = ["str", "dex", "con", "int", "wis", "cha"]
      .map((k) => `${k.toUpperCase()} ${ab[k]?.mod != null ? (ab[k].mod >= 0 ? `+${ab[k].mod}` : ab[k].mod) : "?"}`)
      .join(" | ");
    snapLines.push(`Modifiers: ${mods}`);
  }
  if (Array.isArray(snap.attacks) && snap.attacks.length) {
    snapLines.push(`Known attacks: ${snap.attacks.map((a) => [a.name, a.toHit, a.damage ? `(${a.damage})` : ""].filter(Boolean).join(" ")).join(" | ")}`);
  }
  if (snap.spellSlots && Object.keys(snap.spellSlots).length) {
    const slots = Object.entries(snap.spellSlots).map(([k, v]) => `L${k.replace("spell", "")}:${v.value}/${v.max}`).join(" ");
    snapLines.push(`Spell slots: ${slots}`);
  }

  // Pre-resolve the attack from the snapshot BEFORE the director call so we have
  // a concrete anchor. If attacks exist, prefer attacks[0] as a starting point —
  // the director can choose a different one from the list, but matchAttack will
  // still fall back to attacks[0] if the director hallucinates an unknown name.
  const snapAttacksForNpc = Array.isArray(snap.attacks) ? snap.attacks : [];
  const preferredNpcAttack = snapAttacksForNpc.length > 0 ? snapAttacksForNpc[0] : null;

  // Build exact attack name list for the prompt — prevents hallucination entirely
  const npcAttackNames = snapAttacksForNpc.map((a) => normalize(a.name));

  // Director only picks WHICH attack and WHO to target — the bot handles all dice.
  const combatDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Choose the combat action for a D&D 5e turn. The engine will handle all dice rolls.",
    "RULES — no exceptions:",
    "1. attackName MUST be EXACTLY one of the names in the VALID ATTACK NAMES list. Copy it character-for-character.",
    "2. Do NOT invent or rephrase weapon names. If in doubt, use the first name in the list.",
    "3. The flavor sentence MUST use the exact weapon name. No substitutions.",
    `Active combatant: ${normalize(activeBinding?.characterName || activeBinding?.userName)}`,
    snapLines.length ? `Attacker stats:\n${snapLines.join("\n")}` : "",
    npcAttackNames.length
      ? `VALID ATTACK NAMES (only these are allowed — copy exactly): ${npcAttackNames.map((n) => `"${n}"`).join(", ")}`
      : "No weapon data available — use empty string for attackName.",
    `Declared action: ${normalize(lastAction?.text)}`,
    `Active opponents: ${(state.initiative?.actorBindings || []).filter((b) => !isPlayerControlledCombatant(state, b)).map((b) => normalize(b.name)).join(", ") || "none"}`,
    `Active players: ${(state.initiative?.actorBindings || []).filter((b) => isPlayerControlledCombatant(state, b)).map((b) => normalize(b.name)).join(", ") || "none"}`,
    "Return JSON only:",
    `{`,
    `  "attackName": "exact name from VALID ATTACK NAMES list, or empty string",`,
    `  "targetName": "name of the target combatant",`,
    `  "flavor": "One dramatic present-tense sentence — NO roll results, NO hit/miss",`,
    `  "hasAdvantage": false,`,
    `  "hasDisadvantage": false,`,
    `  "combatEnds": false`,
    `}`
  ].filter(Boolean).join("\n")) || {};

  // Strict exact-name match — prevents the director from hallucinating attack names.
  // Only fall back to preferredNpcAttack (attacks[0]) if director returns unknown name.
  const exactMatch = snapAttacksForNpc.find(
    (a) => normalize(a.name).toLowerCase() === normalize(combatDir.attackName || "").toLowerCase()
  );
  const preResolvedAttack = exactMatch || preferredNpcAttack || matchAttack(activeBinding?.actorSnapshot, combatDir.attackName);

  state.initiative.lastAttackResult = { combatDir, attackRollResult: null, isHit: null, isCrit: false, attack: preResolvedAttack };
  state.initiative.pendingReactions = [];
  state.phase = "combat_reaction_pre";
  state.initiative.reactionWindowExpiresAt = Date.now() + 10000;
  await writeRoundState(workingObject, state);

  const flavor = normalize(combatDir.flavor) ||
    `${normalize(activeBinding?.characterName || activeBinding?.userName)} attacks${combatDir.targetName ? ` ${combatDir.targetName}` : ""}!`;

  // Timer 1: roll the attack (10 s reaction window first)
  const timerKey = state.session.channelKey || workingObject.channelId;
  clearCombatTimer(timerKey);
  const capturedWo = { ...workingObject };
  combatTimers.set(timerKey, setTimeout(() => {
    fireCombatAttackRoll(baseCore, runFlow, createRunCore, capturedWo, timerKey).catch((err) => {
      console.error("[foundry-bridge] fireCombatAttackRoll error:", err);
    });
  }, 10000));

  return {
    accepted: true,
    messages: [{ text: `${flavor} (Reactions? 10 seconds...)`, type: "bot" }]
  };
}

/**
 * Timer callback: roll the attack, compare vs target AC, announce hit or miss.
 * On hit  → opens second reaction window (10 s) → fireCombatDamageAndAdvance.
 * On miss → advances turn immediately, no damage rolled.
 */
async function fireCombatAttackRoll(baseCore, runFlow, createRunCore, capturedWo, timerKey) {
  clearCombatTimer(timerKey);

  let state;
  try {
    state = await readRoundState(capturedWo);
  } catch (err) {
    console.error("[foundry-bridge] fireCombatAttackRoll: cannot read state", err);
    return;
  }
  if (state.phase !== "combat_reaction_pre") return;

  const lastAction = state.initiative.lastPlayerAction || {};
  const lastResult = state.initiative.lastAttackResult || {};
  const combatDir = lastResult.combatDir || {};
  const reactions = Array.isArray(state.initiative.pendingReactions) ? state.initiative.pendingReactions : [];

  // Re-read attacker binding (turn index may still be the same)
  const activeBinding = getActiveCombatantBinding(state);
  // Use the pre-resolved attack stored in lastAttackResult (prevents hallucination re-resolution).
  // Fall back to matchAttack only if nothing was pre-stored.
  const attack = lastResult.attack || matchAttack(activeBinding?.actorSnapshot, combatDir.attackName);
  let attackBonus = parseAttackBonus(attack?.toHit);
  // Fallback: compute bonus from snapshot ability scores when no attack data available
  if (attackBonus === null) {
    const snap = activeBinding?.actorSnapshot || {};
    const pb = snap.proficiencyBonus ?? 2;
    const strMod = snap.abilities?.str?.mod ?? 0;
    const dexMod = snap.abilities?.dex?.mod ?? 0;
    attackBonus = pb + Math.max(strMod, dexMod);
  }

  let attackRollResult = null;
  let isHit = false;
  let isCrit = false;

  {
    const notation = combatDir.hasAdvantage
      ? `2d20kh1+${attackBonus}`
      : combatDir.hasDisadvantage
        ? `2d20kl1+${attackBonus}`
        : `1d20+${attackBonus}`;
    attackRollResult = await invokeFoundryAction(capturedWo, "roll", {
      channelKey: state.session.channelKey,
      notation,
      label: `${attack?.name || "Attack"} — ${normalize(lastAction.name)}`,
      actorRef: activeBinding?.actorId || activeBinding?.characterName,
      visibility: "public",
      emitChatMessage: true
    });
    let total = Number(attackRollResult?.total ?? 0);

    // Silvery Barbs / forced reroll: roll again and take the LOWER result
    if (lastResult.reactionForceReroll === true) {
      const rerollRes = await invokeFoundryAction(capturedWo, "roll", {
        channelKey: state.session.channelKey,
        notation,
        label: `${attack?.name || "Attack"} (forced reroll) — ${normalize(lastAction.name)}`,
        actorRef: activeBinding?.actorId || activeBinding?.characterName,
        visibility: "public",
        emitChatMessage: true
      }).catch(() => null);
      const rerollTotal = Number(rerollRes?.total ?? Infinity);
      if (Number.isFinite(rerollTotal) && rerollTotal < total) {
        total = rerollTotal;
        attackRollResult = { ...attackRollResult, total };
      }
    }

    // Attacker check roll (e.g. high-level Counterspell ability save) — informational only
    if (lastResult.reactionAttackerRollNotation) {
      await invokeFoundryAction(capturedWo, "roll", {
        channelKey: state.session.channelKey,
        notation: lastResult.reactionAttackerRollNotation,
        label: `${normalize(lastAction.name)} — reaction check`,
        visibility: "public",
        emitChatMessage: true
      }).catch(() => null);
    }

    const targetAC = getTargetAC(state, combatDir.targetName);
    // Critical hit/miss: nat-20/1 via total-minus-bonus
    const rawD20 = total - attackBonus;
    isCrit = rawD20 === 20;
    const isFumble = rawD20 === 1;
    // If targetAC is unknown, default to miss — never guess a hit.
    isHit = isFumble ? false : isCrit ? true : targetAC != null ? total >= targetAC : false;
    // Apply reaction effects decided by AI (numeric, no hardcoded enum)
    const reactionAcBoost = Number(lastResult.reactionAcBoost ?? 0);
    if (isHit && !isCrit && reactionAcBoost > 0 && targetAC != null) {
      if (total < targetAC + reactionAcBoost) isHit = false;
    }
    if (lastResult.reactionCounterspell === true) isHit = false;
  }

  // Store results
  lastResult.attackRollResult = attackRollResult;
  lastResult.isHit = isHit;
  lastResult.isCrit = isCrit;
  lastResult.attack = attack;
  state.initiative.lastAttackResult = lastResult;

  const targetAC = getTargetAC(state, combatDir.targetName);
  const rollSummary = attackRollResult
    ? `Rolled ${attackRollResult.total}${targetAC != null ? ` vs AC ${targetAC}` : ""}`
    : "";

  const resultText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Announce the result of a D&D 5e attack roll in 1 sentence.",
    `Attacker: ${normalize(lastAction.name)}, attack: ${attack?.name || "strike"}`,
    rollSummary,
    `Result: ${isCrit ? "CRITICAL HIT" : isHit ? "HIT" : "MISS"}`,
    reactions.length ? `Reactions declared: ${JSON.stringify(reactions)}` : "",
    isHit ? "End the sentence with '(Reactions? 10 seconds...)'" : "Do NOT describe damage."
  ].filter(Boolean).join("\n"));

  if (isHit) {
    state.phase = "combat_reaction_post";
    state.initiative.reactionWindowExpiresAt = Date.now() + 10000;
    await writeRoundState(capturedWo, state);
    await postBotMessagesToFoundry(capturedWo, [
      { text: resultText || `The attack hits! (Reactions? 10 seconds...)`, type: "bot" }
    ]);
    combatTimers.set(timerKey, setTimeout(() => {
      fireCombatDamageAndAdvance(baseCore, runFlow, createRunCore, capturedWo, timerKey).catch((err) => {
        console.error("[foundry-bridge] fireCombatDamageAndAdvance error:", err);
      });
    }, 10000));
  } else {
    // Miss — no damage, advance turn immediately
    state.phase = "combat_turn_prompt";
    state.initiative.pendingReactions = [];
    state.initiative.lastAttackResult = null;
    state.initiative.turnFollowupHistory = [];
    const nextRes = await invokeFoundryAction(capturedWo, "initiative", {
      channelKey: state.session.channelKey,
      operation: "next",
      combatRef: state.initiative.combatId || state.initiative.combatName
    });
    syncInitiativeStateFromResult(state, nextRes, state.session.players);
    await writeRoundState(capturedWo, state);
    const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, capturedWo, state);
    await postBotMessagesToFoundry(capturedWo, [
      { text: resultText || "The attack misses!", type: "bot" },
      ...advanced.messages
    ]);
  }
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

  // Roll damage using the matched attack's actual notation
  const attack = lastResult.attack;
  const isCrit = lastResult.isCrit === true;
  const damageNotation = attack?.damage
    ? (isCrit ? critDamageNotation(normalize(attack.damage)) : normalize(attack.damage))
    : "1d6"; // fallback if no damage info
  const damageLabel = `${attack?.name || "Damage"} — ${normalize(lastAction.name)}${isCrit ? " (CRIT)" : ""}`;

  const damageRollResult = await invokeFoundryAction(capturedWo, "roll", {
    channelKey: state.session.channelKey,
    notation: damageNotation,
    label: damageLabel,
    visibility: "public",
    emitChatMessage: true
  });

  // Re-fetch actor stats so HP changes are reflected in the next turn
  await fetchAndCacheActorStats(capturedWo, state).catch(() => {});

  let totalDamage = Number(damageRollResult?.total ?? 0);

  // Apply reaction effects decided by AI
  const reactionHalfDamage = lastResult.reactionHalfDamage === true;
  if (reactionHalfDamage) totalDamage = Math.floor(totalDamage / 2);
  const reactionDamageReduction = Number(lastResult.reactionDamageReduction ?? 0);
  if (reactionDamageReduction > 0) totalDamage = Math.max(0, totalDamage - reactionDamageReduction);

  // Apply damage to the target's HP in Foundry
  const npcDmgTarget = lastResult.combatDir?.targetName;
  if (npcDmgTarget) {
    const applyRes = await invokeFoundryAction(capturedWo, "apply-damage", {
      channelKey: state.session.channelKey,
      targetRef: npcDmgTarget,
      damage: totalDamage,
      isCrit
    }).catch(() => null);
    bridgeLog(capturedWo, `[npc_damage] ${normalize(lastAction.name)} → ${npcDmgTarget}: ${totalDamage} dmg${isCrit ? " CRIT" : ""}${applyRes?.hpAfter != null ? ` | HP now: ${applyRes.hpAfter}` : ""}${applyRes?.ok === false ? ` | ERR: ${applyRes.error}` : ""}`);
  }

  // For NPC attacks: let AI decide if any PC has a reaction (Shield spell, Uncanny Dodge, etc.)
  const npcAttackInfo = {
    attackerName: normalize(lastAction.name),
    targetName: lastResult.combatDir?.targetName || "",
    attackName: attack?.name || "attack",
    damage: totalDamage,
    isCrit
  };
  const npcTurnReactions = await runNpcReactionDecider(baseCore, runFlow, createRunCore, state, npcAttackInfo).catch(() => []);
  const reactionLines = [];
  for (const reaction of npcTurnReactions) {
    const rName = normalize(reaction?.characterName);
    const rText = normalize(reaction?.action);
    if (!rName || !rText) continue;
    markReactionUsed(state, rName);
    reactionLines.push(`⚡ **${rName}** reacts: ${rText}`);
    if (reaction.notation) {
      const rr = await invokeFoundryAction(capturedWo, "roll", {
        channelKey: state.session.channelKey,
        notation: normalize(reaction.notation),
        label: `${rName} reaction`,
        visibility: "public",
        emitChatMessage: true
      }).catch(() => null);
      if (rr?.total != null) reactionLines.push(`${rName} rolled: ${rr.total}`);
    }
  }
  await writeReactionsMd(capturedWo, state).catch(() => {});
  await appendHistoryMd(capturedWo, { round: state.round?.number, mode: "initiative", text: `${normalize(lastAction.name)} → ${lastResult.combatDir?.targetName || "target"} HIT for ${totalDamage}` }).catch(() => {});

  const damageText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Describe the outcome of a D&D 5e hit in 1-2 sentences.",
    `Attacker: ${normalize(lastAction.name)}, attack: ${attack?.name || "strike"}`,
    `Target: ${lastResult.combatDir?.targetName || "the enemy"}`,
    `Damage: ${totalDamage}${isCrit ? " (critical hit)" : ""}${reactionHalfDamage ? " (halved by reaction)" : ""}${reactionDamageReduction > 0 ? ` (reduced by ${reactionDamageReduction})` : ""}`,
    reactions.length ? `Post-hit reactions: ${JSON.stringify(reactions)}` : "",
    reactionLines.length ? `AI-decided reactions: ${reactionLines.join("; ")}` : "",
    "State the damage total. Describe the effect dramatically. Do NOT say what happens next."
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
    state.reactions = { available: [], used: [] };
    await writeReactionsMd(capturedWo, state).catch(() => {});
    await appendHistoryMd(capturedWo, { round: state.round?.number, mode: "initiative", text: "Kampf beendet." }).catch(() => {});
    await writeRoundState(capturedWo, state);

    // Write combat result to situation channel + purge combat channel
    const combatResultSummary = normalize(endText || "Combat concluded. Party victorious.");
    await writeCombatResultToSituation(baseCore, runFlow, createRunCore, capturedWo, state, combatResultSummary).catch(() => {});
    const channels = getSpecialistChannels(state?.session?.channelId);
    const combatWo = { ...capturedWo, channelId: channels.combat, contextChannelId: channels.combat };
    await setPurgeContext(combatWo).catch(() => {});

    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, capturedWo, state, endText);
    await postBotMessagesToFoundry(capturedWo, [
      { text: damageText || "The attack lands.", type: "bot" },
      ...reactionLines.map((t) => ({ text: t, type: "bot" })),
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

  // Reset the attacker's reaction for the next round
  const attackerName = normalize(lastAction.name);
  restoreReaction(state, attackerName);
  await writeReactionsMd(capturedWo, state).catch(() => {});

  state.phase = "combat_turn_prompt";
  state.initiative.pendingReactions = [];
  state.initiative.lastAttackResult = null;
  state.initiative.turnFollowupHistory = [];
  await writeRoundState(capturedWo, state);

  const advanced = await advanceCombatUntilPlayerTurn(baseCore, runFlow, createRunCore, capturedWo, state);
  await postBotMessagesToFoundry(capturedWo, [
    { text: damageText || "The attack lands.", type: "bot" },
    ...reactionLines.map((t) => ({ text: t, type: "bot" })),
    ...advanced.messages
  ]);
}

// ─── PC ROLL PHASES ────────────────────────────────────────────────────────────

/**
 * Handles combat_awaiting_attack_roll: player has rolled attack in Foundry.
 * Validates the roll, compares vs target AC, posts hit/miss, transitions to
 * combat_awaiting_damage_roll on hit or advances turn on miss.
 */
async function handleCombatAwaitingAttackRoll(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const rollTotal = extractFirstRollTotal(message);
  if (!Number.isFinite(rollTotal)) {
    // Player has a question or comment — answer briefly, then re-ask for the roll
    const inputText = getRoundInputText(message);
    const charName = normalize(activeBinding.characterName || activeBinding.userName);
    if (inputText.length > 4) {
      const lastResult = state.initiative.lastAttackResult || {};
      const notation = lastResult.pendingNotation || "1d20+bonus";
      const quickReply = await runNarratorText(baseCore, runFlow, createRunCore, state, [
        "A player has a question or comment during their attack roll phase. Answer in 1 sentence, then remind them what to roll.",
        `Player (${charName}) said: "${inputText}"`,
        `Expected roll: attack roll with notation ${notation}`,
        `Target: ${lastResult.combatDir?.targetName || "the enemy"}`,
        "Be concise. Answer the question if possible. End with a reminder to roll."
      ].join("\n"));
      return { accepted: true, messages: [{ text: quickReply || `${charName}, roll your attack: \`${notation}\``, type: "bot" }] };
    }
    return { accepted: true, messages: [{ text: `${charName}, please send your attack roll from Foundry.`, type: "bot" }] };
  }

  const lastResult = state.initiative.lastAttackResult || {};
  const combatDir = lastResult.combatDir || {};
  const attack = lastResult.attack;
  let attackBonus = parseAttackBonus(attack?.toHit);
  if (attackBonus === null) {
    const snap = activeBinding?.actorSnapshot || {};
    const pb = snap.proficiencyBonus ?? 2;
    attackBonus = pb + Math.max(snap.abilities?.str?.mod ?? 0, snap.abilities?.dex?.mod ?? 0);
  }

  // Plausibility check
  const playerEntry = (state.session?.players || []).find((p) => normalize(p.actorId) === normalize(activeBinding.actorId) || normalize(p.userId) === normalize(activeBinding.userId)) || { characterName: activeBinding.characterName };
  const validation = await runRollValidator(baseCore, runFlow, createRunCore, state, playerEntry, "attack", rollTotal, lastResult.pendingNotation || `1d20+${attackBonus}`).catch(() => ({ valid: true, message: "" }));
  if (!validation.valid) {
    return { accepted: true, messages: [{ text: validation.message || `${normalize(activeBinding.characterName)}, that attack roll looks off — please check and re-roll.`, type: "bot" }] };
  }

  const targetAC = getTargetAC(state, combatDir.targetName);
  const rawD20 = rollTotal - attackBonus;
  const isCrit = rawD20 === 20;
  const isFumble = rawD20 === 1;
  // If targetAC is unknown, default to miss — never guess a hit.
  const isHit = isFumble ? false : isCrit ? true : targetAC != null ? rollTotal >= targetAC : false;

  lastResult.attackRollResult = { total: rollTotal };
  lastResult.isHit = isHit;
  lastResult.isCrit = isCrit;
  state.initiative.lastAttackResult = lastResult;

  bridgeLog(workingObject, `[attack_roll] ${normalize(activeBinding.characterName)} rolled ${rollTotal}${targetAC != null ? ` vs AC ${targetAC}` : ""} → ${isCrit ? "CRIT HIT" : isHit ? "HIT" : "MISS"} | ${attack?.name || "attack"} → ${combatDir.targetName || "?"}`);

  const rollSummary = `Rolled ${rollTotal}${targetAC != null ? ` vs AC ${targetAC}` : ""}`;
  const resultText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Announce the result of a D&D 5e attack roll in 1 sentence.",
    `Attacker: ${normalize(activeBinding.characterName || activeBinding.userName)}, attack: ${attack?.name || "strike"}`,
    rollSummary,
    `Result: ${isCrit ? "CRITICAL HIT" : isHit ? "HIT" : "MISS"}`,
    isHit ? "Do NOT describe damage yet. End the sentence with the hit result." : "Do NOT describe damage."
  ].filter(Boolean).join("\n"));

  if (isHit) {
    // Determine damage notation
    const damageNotation = attack?.damage
      ? (isCrit ? critDamageNotation(normalize(attack.damage)) : normalize(attack.damage))
      : "1d6";
    lastResult.damageNotation = damageNotation;
    state.initiative.lastAttackResult = lastResult;
    state.phase = "combat_awaiting_damage_roll";
    await writeRoundState(workingObject, state);
    const critTag = isCrit ? " **(CRITICAL HIT!)**" : "";
    return {
      accepted: true,
      messages: [
        { text: resultText || "The attack hits!", type: "bot" },
        { text: `${critTag}\n🎲 **${normalize(activeBinding.characterName || activeBinding.userName)}**, roll damage: \`${damageNotation}\``, type: "bot" }
      ]
    };
  } else {
    // Miss — outer loop: ask about remaining turn components before advancing
    await appendHistoryMd(workingObject, { round: state.round?.number, mode: "initiative", text: `${normalize(activeBinding.characterName)} attacked ${combatDir.targetName || "target"} — MISS (${rollTotal})` });
    state.initiative.pendingReactions = [];
    state.initiative.lastAttackResult = null;
    state.initiative.turnFollowupHistory = [];

    const declaredOnMiss = normalize(state.initiative.lastPlayerAction?.text || "");
    const { hasMovement: missMov, hasBonusAction: missBonus } = detectTurnComponents(declaredOnMiss);
    const missMissing = [];
    if (!missMov) missMissing.push("move");
    if (!missBonus) missMissing.push("use a bonus action");

    if (missMissing.length > 0) {
      state.phase = "combat_awaiting_turn_end";
      state.initiative.turnEndMissing = { hasMovement: missMov, hasBonusAction: missBonus };
      await writeRoundState(workingObject, state);
      const attackerName = normalize(activeBinding.characterName || activeBinding.userName);
      return {
        accepted: true,
        messages: [
          { text: resultText || "The attack misses!", type: "bot" },
          { text: `${attackerName}, do you also want to ${missMissing.join(" or ")}? Say **'ready'** to end your turn.`, type: "bot" }
        ]
      };
    }

    // All components covered — advance immediately
    return await finalizePcTurnAndAdvance(
      baseCore, runFlow, createRunCore, workingObject, state, activeBinding,
      [{ text: resultText || "The attack misses!", type: "bot" }]
    );
  }
}

/**
 * Handles combat_awaiting_damage_roll: player has rolled damage in Foundry.
 * Validates, narrates, runs NPC reaction decider, updates reactions.md, advances turn.
 */
async function handleCombatAwaitingDamageRoll(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const rollTotal = extractFirstRollTotal(message);
  if (!Number.isFinite(rollTotal)) {
    // Player has a question or comment — answer briefly, then re-ask for the roll
    const inputText = getRoundInputText(message);
    const charName = normalize(activeBinding.characterName || activeBinding.userName);
    if (inputText.length > 4) {
      const lastResult = state.initiative.lastAttackResult || {};
      const damageNotation = lastResult.damageNotation || lastResult.attack?.damage || "damage dice";
      const quickReply = await runNarratorText(baseCore, runFlow, createRunCore, state, [
        "A player has a question or comment during their damage roll phase. Answer in 1 sentence, then remind them what to roll.",
        `Player (${charName}) said: "${inputText}"`,
        `Expected roll: damage roll with notation ${damageNotation}`,
        "Be concise. Answer the question if possible. End with a reminder to roll."
      ].join("\n"));
      return { accepted: true, messages: [{ text: quickReply || `${charName}, roll your damage: \`${damageNotation}\``, type: "bot" }] };
    }
    return { accepted: true, messages: [{ text: `${charName}, please send your damage roll from Foundry.`, type: "bot" }] };
  }

  const lastResult = state.initiative.lastAttackResult || {};
  const combatDir = lastResult.combatDir || {};
  const attack = lastResult.attack;
  const isCrit = lastResult.isCrit === true;
  const damageNotation = lastResult.damageNotation || (attack?.damage ? (isCrit ? critDamageNotation(normalize(attack.damage)) : normalize(attack.damage)) : "1d6");

  // Plausibility check
  const playerEntry = (state.session?.players || []).find((p) => normalize(p.actorId) === normalize(activeBinding.actorId) || normalize(p.userId) === normalize(activeBinding.userId)) || { characterName: activeBinding.characterName };
  const validation = await runRollValidator(baseCore, runFlow, createRunCore, state, playerEntry, "damage", rollTotal, damageNotation).catch(() => ({ valid: true, message: "" }));
  if (!validation.valid) {
    return { accepted: true, messages: [{ text: validation.message || `${normalize(activeBinding.characterName)}, that damage roll looks off — please check and re-roll.`, type: "bot" }] };
  }

  await appendHistoryMd(workingObject, { round: state.round?.number, mode: "initiative", text: `${normalize(activeBinding.characterName)} → ${combatDir.targetName || "target"} HIT for ${rollTotal} (${attack?.name || "attack"})` });

  // Check for bonus damage sources (Sneak Attack, Divine Smite, etc.)
  const bonusRolls = await runBonusDamageCheck(baseCore, runFlow, createRunCore, state, activeBinding, attack?.name || "attack", isCrit).catch(() => []);
  if (bonusRolls.length > 0) {
    lastResult.pendingBonusDamageRolls = bonusRolls;
    lastResult.primaryDamage = rollTotal;
    state.initiative.lastAttackResult = lastResult;
    state.phase = "combat_awaiting_bonus_damage";
    await writeRoundState(workingObject, state);
    const first = bonusRolls[0];
    const firstNotation = isCrit ? critDamageNotation(first.notation) : first.notation;
    const charName = normalize(activeBinding.characterName || activeBinding.userName);
    return { accepted: true, messages: [{ text: `${charName}, ${normalize(first.prompt) || `roll ${first.label}: \`${firstNotation}\``}`, type: "bot" }] };
  }

  return finalizeDamageAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, rollTotal, lastResult);
}

// ─── PC BONUS DAMAGE PHASE ────────────────────────────────────────────────────

/**
 * Handles combat_awaiting_bonus_damage: collects additional damage rolls (Sneak Attack,
 * Divine Smite, etc.) after the primary damage roll. Validates each, then narrates and
 * advances the turn with the combined total.
 */
async function handleCombatAwaitingBonusDamage(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const activeBinding = getActiveCombatantBinding(state);
  if (!activeBinding) return { accepted: false, messages: [] };
  if (!doesMessageBelongToPlayer(message, activeBinding)) return { accepted: false, messages: [] };

  const lastResult = state.initiative.lastAttackResult || {};
  const bonusRolls = Array.isArray(lastResult.pendingBonusDamageRolls) ? lastResult.pendingBonusDamageRolls : [];
  const current = bonusRolls.find((r) => r.response == null);
  const charName = normalize(activeBinding.characterName || activeBinding.userName);

  // No pending roll — shouldn't happen, but advance cleanly
  if (!current) {
    const totalDamage = (lastResult.primaryDamage || 0) + bonusRolls.reduce((s, r) => s + (r.response || 0), 0);
    return finalizeDamageAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, totalDamage, lastResult);
  }

  const rollTotal = extractFirstRollTotal(message);
  if (!Number.isFinite(rollTotal)) {
    const inputText = getRoundInputText(message);
    if (inputText.length > 4) {
      const answer = await runNarratorText(baseCore, runFlow, createRunCore, state, [
        `Player (${charName}) said: "${inputText}" during their bonus damage roll phase.`,
        `Expected roll: ${current.label} (${current.notation})`,
        "Answer briefly in 1 sentence, then ask them to roll."
      ].join("\n"));
      return { accepted: true, messages: [{ text: answer || `${charName}, roll ${current.label}: \`${current.notation}\``, type: "bot" }] };
    }
    return { accepted: true, messages: [{ text: `${charName}, please send your ${current.label} roll from Foundry.`, type: "bot" }] };
  }

  // Plausibility check
  const playerEntry = (state.session?.players || []).find((p) =>
    normalize(p.actorId) === normalize(activeBinding.actorId) || normalize(p.userId) === normalize(activeBinding.userId)
  ) || { characterName: activeBinding.characterName };
  const validation = await runRollValidator(baseCore, runFlow, createRunCore, state, playerEntry, "damage", rollTotal, current.notation).catch(() => ({ valid: true, message: "" }));
  if (!validation.valid) {
    return { accepted: true, messages: [{ text: validation.message || `${charName}, that ${current.label} roll looks off — please check and re-roll.`, type: "bot" }] };
  }

  current.response = rollTotal;
  await appendHistoryMd(workingObject, { round: state.round?.number, mode: "initiative", text: `${charName} ${current.label}: ${rollTotal}` }).catch(() => {});

  const next = bonusRolls.find((r) => r.response == null);
  if (next) {
    state.initiative.lastAttackResult = lastResult;
    await writeRoundState(workingObject, state);
    const isCritNext = lastResult.isCrit === true;
    const notation = isCritNext ? critDamageNotation(next.notation) : next.notation;
    return { accepted: true, messages: [{ text: `${charName}, ${normalize(next.prompt) || `roll ${next.label}: \`${notation}\``}`, type: "bot" }] };
  }

  // All bonus rolls collected — compute total and advance
  const totalDamage = (lastResult.primaryDamage || 0) + bonusRolls.reduce((s, r) => s + (r.response || 0), 0);
  const bonusSummary = bonusRolls.map((r) => `${r.label}: ${r.response}`).join(", ");
  await appendHistoryMd(workingObject, { round: state.round?.number, mode: "initiative", text: `${charName} total damage: ${totalDamage} (${bonusSummary})` }).catch(() => {});
  return finalizeDamageAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, totalDamage, lastResult, bonusSummary);
}

/**
 * Shared end-of-damage resolution: narrate, NPC reactions, combat-end check, advance turn.
 * Used by both handleCombatAwaitingDamageRoll and handleCombatAwaitingBonusDamage.
 */
async function finalizeDamageAndAdvance(baseCore, runFlow, createRunCore, workingObject, state, activeBinding, totalDamage, lastResult, bonusSummary = "") {
  const combatDir = lastResult.combatDir || {};
  const attack = lastResult.attack;
  const isCrit = lastResult.isCrit === true;
  const charName = normalize(activeBinding.characterName || activeBinding.userName);

  // Apply damage to the target's HP in Foundry
  if (combatDir.targetName) {
    const applyRes = await invokeFoundryAction(workingObject, "apply-damage", {
      channelKey: state.session.channelKey,
      targetRef: combatDir.targetName,
      damage: totalDamage,
      isCrit
    }).catch(() => null);
    bridgeLog(workingObject, `[pc_damage] ${charName} → ${combatDir.targetName}: ${totalDamage} dmg${isCrit ? " CRIT" : ""}${applyRes?.hpAfter != null ? ` | HP now: ${applyRes.hpAfter}` : ""}${applyRes?.ok === false ? ` | ERR: ${applyRes.error}` : ""}`);
  }

  const damageText = await runNarratorText(baseCore, runFlow, createRunCore, state, [
    "Describe the outcome of a D&D 5e hit in 1-2 sentences.",
    `Attacker: ${charName}, attack: ${attack?.name || "strike"}`,
    `Target: ${combatDir.targetName || "the enemy"}`,
    `Damage: ${totalDamage}${isCrit ? " (critical hit)" : ""}`,
    bonusSummary ? `Bonus damage breakdown: ${bonusSummary}` : "",
    "State the total damage. Describe the effect dramatically. Do NOT say what happens next."
  ].filter(Boolean).join("\n"));

  // NPC reaction decider
  const attackInfo = { attackerName: charName, targetName: combatDir.targetName || "", attackName: attack?.name || "attack", damage: totalDamage, isCrit };
  const npcReactions = await runNpcReactionDecider(baseCore, runFlow, createRunCore, state, attackInfo).catch(() => []);
  const reactionMessages = [];
  for (const reaction of npcReactions) {
    const rName = normalize(reaction?.characterName);
    const rText = normalize(reaction?.action);
    if (!rName || !rText) continue;
    markReactionUsed(state, rName);
    reactionMessages.push({ text: `⚡ **${rName}** reacts: ${rText}`, type: "bot" });
    if (reaction.notation) {
      const rr = await invokeFoundryAction(workingObject, "roll", {
        channelKey: state.session.channelKey,
        notation: normalize(reaction.notation),
        label: `${rName} reaction`,
        visibility: "public",
        emitChatMessage: true
      }).catch(() => null);
      if (rr?.total != null) reactionMessages.push({ text: `${rName} rolled: ${rr.total}`, type: "bot" });
    }
  }
  await writeReactionsMd(workingObject, state).catch(() => {});
  await fetchAndCacheActorStats(workingObject, state).catch(() => {});

  // Check combat end
  const activeNpcs = Array.isArray(state.initiative.turnOrder)
    ? state.initiative.turnOrder.filter((c) => !c.defeated && !c.hasPlayerOwner)
    : [];
  const combatShouldEnd = activeNpcs.length === 0 || combatDir.combatEnds === true;

  if (combatShouldEnd) {
    await invokeFoundryAction(workingObject, "initiative", {
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
    state.reactions = { available: [], used: [] };
    await writeReactionsMd(workingObject, state).catch(() => {});
    await writeRoundState(workingObject, state);
    await appendHistoryMd(workingObject, { round: state.round?.number, mode: "initiative", text: "Kampf beendet." });
    const combatResultSummary = normalize(endText || "Combat concluded. Party victorious.");
    await writeCombatResultToSituation(baseCore, runFlow, createRunCore, workingObject, state, combatResultSummary).catch(() => {});
    const channels = getSpecialistChannels(state?.session?.channelId);
    await setPurgeContext({ ...workingObject, channelId: channels.combat, contextChannelId: channels.combat }).catch(() => {});
    const nextPrompt = await advanceToNextExplorationPrompt(baseCore, runFlow, createRunCore, workingObject, state, endText);
    return { accepted: true, messages: [{ text: damageText || "The attack lands.", type: "bot" }, ...reactionMessages, { text: endText || "Combat ends.", type: "bot" }, { text: nextPrompt, type: "bot" }] };
  }

  // Outer loop: remaining turn components
  state.initiative.pendingReactions = [];
  state.initiative.lastAttackResult = null;
  state.initiative.turnFollowupHistory = [];
  const declaredText = normalize(state.initiative.lastPlayerAction?.text || "");
  const { hasMovement, hasBonusAction } = detectTurnComponents(declaredText);
  const missing = [];
  if (!hasMovement) missing.push("move");
  if (!hasBonusAction) missing.push("use a bonus action");

  if (missing.length > 0) {
    state.phase = "combat_awaiting_turn_end";
    state.initiative.turnEndMissing = { hasMovement, hasBonusAction };
    await writeRoundState(workingObject, state);
    return {
      accepted: true,
      messages: [
        { text: damageText || "The attack lands.", type: "bot" },
        ...reactionMessages,
        { text: `${charName}, do you also want to ${missing.join(" or ")}? Say **'ready'** to end your turn.`, type: "bot" }
      ]
    };
  }
  return await finalizePcTurnAndAdvance(
    baseCore, runFlow, createRunCore, workingObject, state, activeBinding,
    [{ text: damageText || "The attack lands.", type: "bot" }, ...reactionMessages]
  );
}

// ─── REACTION LOOP ─────────────────────────────────────────────────────────────

/**
 * Handles any player message during a reaction window.
 *
 * AI analyses the declared reaction. If it can be resolved immediately (Shield, Uncanny Dodge)
 * the effect is applied and the timer keeps running. If more information is needed (rolls,
 * choices) the pending timer is cleared and we enter combat_reaction_followup so the
 * player can supply what's missing. The timer is restarted with a short delay once the
 * loop is resolved.
 */
async function handleCombatReactionWindow(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const inputText = getRoundInputText(message);
  const authorName = normalize(message?.speakerAlias || message?.authorName || "Player");

  if (!Array.isArray(state.initiative.pendingReactions)) {
    state.initiative.pendingReactions = [];
  }

  // Resolve authorName → canonical binding name (handles "Elara" vs "Elara Nightwhisper")
  const senderBinding = (state.initiative.actorBindings || []).find((b) => {
    const bName = normalize(b.name || b.characterName).toLowerCase();
    const aLower = authorName.toLowerCase();
    return bName === aLower
      || bName.startsWith(aLower)
      || aLower.startsWith(bName.split(" ")[0]);
  });
  const canonicalName = senderBinding ? normalize(senderBinding.name || senderBinding.characterName) : authorName;

  // Gate: only allow if this character has a reaction available this round.
  // This prevents out-of-turn interference and non-combatants from reacting.
  const hasReactionAvailable = (state.reactions?.available || []).some(
    (n) => n.toLowerCase() === canonicalName.toLowerCase()
  );
  if (!hasReactionAvailable) {
    return { accepted: false, messages: [] };
  }

  // Check: has this character already used their reaction this turn?
  const alreadyReacted = (state.reactions?.used || []).some(
    (n) => n.toLowerCase() === canonicalName.toLowerCase()
  );
  if (alreadyReacted) {
    return { accepted: true, messages: [{ text: `${authorName}, you have already used your reaction this turn.`, type: "bot" }] };
  }

  // Plausibility: is this actually a reaction declaration?
  const looksLikeReaction = inputText.length > 2 && !/^(ok|yes|no|lol|haha|\?|!)$/i.test(inputText.trim());
  if (!looksLikeReaction) {
    return { accepted: true, messages: [{ text: `${authorName}: react now (e.g. "Shield", "Uncanny Dodge") or let it pass.`, type: "bot" }] };
  }

  // PAUSE the combat timer as soon as a real reaction attempt arrives.
  // This gives the player time to complete the loop without the timer firing underneath them.
  // The timer is restarted (3s) by resolveReaction once the loop is done,
  // or restarted (10s) below if the reaction is outright invalid.
  const timerKey = state.session.channelKey || workingObject.channelId;
  clearCombatTimer(timerKey);

  const lastAction = state.initiative.lastPlayerAction || {};
  const originalPhase = state.phase;
  const history = [{ role: "player", text: inputText }];

  // Build reactor stat context — include spell slots so the AI can validate spells
  const reactorBinding = (state.initiative.actorBindings || []).find((b) =>
    normalize(b.name).toLowerCase() === authorName.toLowerCase() ||
    normalize(b.characterName).toLowerCase() === authorName.toLowerCase()
  );
  const reactorSnap = reactorBinding?.actorSnapshot || {};
  const reactorStatParts = [];
  if (reactorSnap.hp) reactorStatParts.push(`HP ${reactorSnap.hp.value}/${reactorSnap.hp.max}, AC ${reactorSnap.ac ?? "?"}`);
  if (reactorSnap.spellSlots && Object.keys(reactorSnap.spellSlots).length) {
    const slotStr = Object.entries(reactorSnap.spellSlots)
      .filter(([, v]) => v.value > 0)
      .map(([k, v]) => `L${k.replace("spell", "")}:${v.value}/${v.max}`)
      .join(" ");
    if (slotStr) reactorStatParts.push(`Spell slots available: ${slotStr}`);
  }
  if (Array.isArray(reactorSnap.attacks) && reactorSnap.attacks.length) {
    reactorStatParts.push(`Attacks: ${reactorSnap.attacks.map((a) => a.name).join(", ")}`);
  }
  const reactorStatLine = reactorStatParts.length ? `${authorName} stats: ${reactorStatParts.join(" | ")}` : "";

  const reactionDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "A player declared a D&D 5e reaction during combat. Evaluate and process it.",
    `Reactor: ${authorName}`,
    `Reaction declared: "${inputText}"`,
    `Phase: ${originalPhase === "combat_reaction_pre" ? "BEFORE attack roll" : "AFTER hit — BEFORE damage"}`,
    `Attacker: ${normalize(lastAction.name)}`,
    reactorStatLine,
    "VALIDATION RULES (read carefully):",
    "1. DEFAULT TO valid: true. Players know their own characters.",
    "2. Shield spell: always valid BEFORE the attack roll (combat_reaction_pre). Costs a 1st-level slot.",
    "3. Uncanny Dodge: always valid AFTER a hit (combat_reaction_pre is wrong phase for it).",
    "4. Only set valid: false if the reaction is MECHANICALLY IMPOSSIBLE here (e.g. Shield after damage is rolled, or using Counterspell without spell slots).",
    "5. If you are UNSURE whether the player has the ability, set valid: true and proceed.",
    "If valid: decide if the reaction needs a roll (Counterspell at high level needs a spellcasting roll). Most reactions (Shield, Uncanny Dodge, Parry) need no roll.",
    "Return JSON only:",
    '{',
    '  "valid": true,',
    '  "acknowledgment": "1 short dramatic in-world sentence confirming or (if truly invalid) explaining",',
    '  "complete": true,',
    '  "nextPrompt": "what to ask next — only set if complete is false and a roll/choice is needed",',
    '  "rollNotation": "e.g. 1d20+5 — only if a roll is the very next step"',
    '}'
  ].join("\n")).catch(() => null);

  const acknowledgment = normalize(reactionDir?.acknowledgment) || `${authorName} reacts!`;
  const complete = reactionDir?.complete !== false;

  // Reaction is mechanically impossible — reject and give player 10s to try something else
  if (reactionDir?.valid === false) {
    combatTimers.set(timerKey, setTimeout(() => {
      const retryFn = originalPhase === "combat_reaction_pre" ? fireCombatAttackRoll : fireCombatDamageAndAdvance;
      retryFn(baseCore, runFlow, createRunCore, { ...workingObject }, timerKey).catch(console.error);
    }, 10000));
    return { accepted: true, messages: [{ text: `⚡ ${acknowledgment}`, type: "bot" }] };
  }

  // Reaction accepted — enter followup to resolve it (timer stays paused until resolveReaction restarts it)
  history.push({ role: "dm", text: acknowledgment });
  state.initiative.reactionFollowup = { reactorName: canonicalName, originalPhase, history, timerKey };
  state.phase = "combat_reaction_followup";
  await writeRoundState(workingObject, state);

  if (complete) {
    // No further input needed — resolve immediately
    return resolveReaction(baseCore, runFlow, createRunCore, workingObject, state, null);
  }

  // Needs more info (roll, choice) — prompt the player; timer stays paused
  if (reactionDir?.nextPrompt) history.push({ role: "dm", text: reactionDir.nextPrompt });
  state.initiative.reactionFollowup = { reactorName: authorName, originalPhase, history, timerKey };
  await writeRoundState(workingObject, state);

  const messages = [{ text: `⚡ ${acknowledgment}`, type: "bot" }];
  if (reactionDir?.nextPrompt) messages.push({ text: reactionDir.nextPrompt, type: "bot" });
  else if (reactionDir?.rollNotation) messages.push({ text: `${authorName}, roll: \`${reactionDir.rollNotation}\``, type: "bot" });
  return { accepted: true, messages };
}

/**
 * Handles the combat_reaction_followup loop. Player supplies rolls or answers.
 * The AI evaluates completeness each iteration. When done it decides the full
 * mechanical outcome (no enums — the AI returns numeric values directly).
 */
async function handleCombatReactionFollowup(baseCore, runFlow, createRunCore, workingObject, state, message) {
  const followup = state.initiative.reactionFollowup || {};
  const { reactorName } = followup;

  if (message) {
    const authorName = normalize(message?.speakerAlias || message?.authorName || "");
    if (reactorName && authorName && authorName.toLowerCase() !== reactorName.toLowerCase()) {
      return { accepted: false, messages: [] };
    }
    const rollTotal = extractFirstRollTotal(message);
    const responseText = rollTotal != null ? `Roll result: ${rollTotal}` : getRoundInputText(message);
    const history = Array.isArray(followup.history) ? [...followup.history] : [];
    history.push({ role: "player", text: responseText });
    followup.history = history;
    state.initiative.reactionFollowup = followup;
  }

  return resolveReaction(baseCore, runFlow, createRunCore, workingObject, state, null);
}

/**
 * Core reaction resolution loop. Called by both the window handler (instant complete)
 * and the followup handler (after each player response).
 * The AI returns numeric mechanical values — no hardcoded effect strings.
 */
async function resolveReaction(baseCore, runFlow, createRunCore, workingObject, state, _unused) {
  const followup = state.initiative.reactionFollowup || {};
  const { reactorName, originalPhase, history = [], timerKey } = followup;
  const lastAction = state.initiative.lastPlayerAction || {};

  const evalDir = await runDirectorJson(baseCore, runFlow, createRunCore, state, [
    "Resolve a D&D 5e reaction. Use the conversation history to determine the mechanical outcome.",
    `Reactor: ${reactorName}`,
    `Phase: ${originalPhase === "combat_reaction_pre" ? "BEFORE attack roll" : "AFTER hit — BEFORE damage"}`,
    `Attacker: ${normalize(lastAction.name)}`,
    `Conversation:\n${history.map((e) => `${e.role === "player" ? reactorName : "DM"}: ${e.text}`).join("\n")}`,
    "Decide if you have all information needed (complete: true) or still need something (complete: false).",
    "When complete: determine the EXACT mechanical numbers based on the D&D 5e rules for this reaction.",
    "Return JSON only:",
    '{',
    '  "complete": true,',
    '  "resolution": "1 dramatic sentence describing the final outcome",',
    '  "nextPrompt": "what to ask next — only set if complete is false",',
    '  "forceAttackerReroll": false,',
    '  "attackerRollNotation": "",',
    '  "acBoost": 0,',
    '  "halfDamage": false,',
    '  "cancelAttack": false,',
    '  "damageReduction": 0',
    '}'
  ].join("\n")).catch(() => null);

  const complete = evalDir?.complete !== false;

  if (!complete) {
    state.initiative.reactionFollowup = followup;
    await writeRoundState(workingObject, state);
    const nextQ = normalize(evalDir?.nextPrompt) || "Please provide the required information.";
    // Safety timeout: if the player never responds, advance after 60s
    const capturedKeyIncomplete = timerKey || state.session.channelKey || workingObject.channelId;
    const capturedWoIncomplete = { ...workingObject };
    clearCombatTimer(capturedKeyIncomplete);
    combatTimers.set(capturedKeyIncomplete, setTimeout(() => {
      const nextFn = originalPhase === "combat_reaction_pre" ? fireCombatAttackRoll : fireCombatDamageAndAdvance;
      nextFn(baseCore, runFlow, createRunCore, capturedWoIncomplete, capturedKeyIncomplete).catch(console.error);
    }, 60000));
    return { accepted: true, messages: [{ text: nextQ, type: "bot" }] };
  }

  // Apply whatever the AI decided — no enums, pure numbers/booleans
  if (!state.initiative.lastAttackResult) state.initiative.lastAttackResult = {};
  const r = state.initiative.lastAttackResult;
  if (Number(evalDir?.acBoost) > 0)         r.reactionAcBoost = (r.reactionAcBoost || 0) + Number(evalDir.acBoost);
  if (evalDir?.halfDamage === true)          r.reactionHalfDamage = true;
  if (evalDir?.cancelAttack === true)        r.reactionCounterspell = true;
  if (Number(evalDir?.damageReduction) > 0)  r.reactionDamageReduction = (r.reactionDamageReduction || 0) + Number(evalDir.damageReduction);
  if (evalDir?.forceAttackerReroll === true) r.reactionForceReroll = true;
  if (normalize(evalDir?.attackerRollNotation)) r.reactionAttackerRollNotation = normalize(evalDir.attackerRollNotation);

  state.initiative.pendingReactions.push({
    from: reactorName,
    text: history.filter((e) => e.role === "player").map((e) => e.text).join(" / "),
    acBoost: evalDir?.acBoost || 0,
    halfDamage: evalDir?.halfDamage || false,
    cancelAttack: evalDir?.cancelAttack || false,
    damageReduction: evalDir?.damageReduction || 0,
    createdAt: new Date().toISOString()
  });

  // Mark this character's reaction as used so they can't react a second time this round
  markReactionUsed(state, reactorName);

  state.phase = originalPhase;
  state.initiative.reactionFollowup = null;
  await writeReactionsMd(workingObject, state).catch(() => {});
  await writeRoundState(workingObject, state);

  const resolution = normalize(evalDir?.resolution) || `${reactorName}'s reaction resolves!`;

  // Restart the combat timer (3 s) so combat continues after the reaction loop
  const capturedWo = { ...workingObject };
  const capturedKey = timerKey || state.session.channelKey || workingObject.channelId;
  clearCombatTimer(capturedKey);
  combatTimers.set(capturedKey, setTimeout(() => {
    const nextFn = originalPhase === "combat_reaction_pre" ? fireCombatAttackRoll : fireCombatDamageAndAdvance;
    nextFn(baseCore, runFlow, createRunCore, capturedWo, capturedKey).catch((err) => {
      console.error("[foundry-bridge] reaction timer restart error:", err);
    });
  }, 3000));

  return { accepted: true, messages: [{ text: `⚡ ${resolution}`, type: "bot" }] };
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
    const pendingRolls = (Array.isArray(state.round?.pendingPlayerRolls) ? state.round.pendingPlayerRolls : [])
      .filter((r) => r.response == null)
      .map((r) => `${r.characterName}: ${r.label}`);
    const reactionsAvail = Array.isArray(state.reactions?.available) ? state.reactions.available.join(", ") : "-";
    const lines = [
      `mode: ${state.mode}, phase: ${state.phase}`,
      `players: ${state.session?.players?.length || 0}`,
      `combatId: ${state.initiative?.combatId || "-"}`,
      `turnIndex: ${state.initiative?.currentTurnIndex ?? "-"}`,
      pendingInits.length ? `awaiting initiative: ${pendingInits.join(", ")}` : "",
      pendingRolls.length ? `awaiting rolls: ${pendingRolls.join(", ")}` : "",
      `reactions available: ${reactionsAvail}`,
      state.initiative?.turnEndMissing ? `turn-end pending: ${[!state.initiative.turnEndMissing.hasMovement ? "move" : "", !state.initiative.turnEndMissing.hasBonusAction ? "bonus action" : ""].filter(Boolean).join(", ")}` : "",
      state.situation?.current ? `situation: ${state.situation.current.slice(0, 80)}…` : ""
    ].filter(Boolean);
    return { accepted: true, messages: [{ text: `🎲 DM Status:\n${lines.join("\n")}`, type: "bot" }] };
  }

  // ── !dm reset / !dm explore ────────────────────────────────────────────────
  if (command === "reset" || command === "explore") {
    clearCombatTimer(state.session?.channelKey || workingObject.channelId);
    // Clear the Foundry log journal on session reset
    await invokeFoundryAction(workingObject, "log", { operation: "clear" }).catch(() => {});
    // Purge combat channel context when resetting to exploration
    const resetChannels = getSpecialistChannels(state?.session?.channelId);
    const combatResetWo = { ...workingObject, channelId: resetChannels.combat, contextChannelId: resetChannels.combat };
    await setPurgeContext(combatResetWo).catch(() => {});
    state.mode = "exploration";
    state.phase = "awaiting_action";
    state.round.activePlayerIndex = 0;
    state.round.acceptedActions = [];
    state.round.pendingClarifications = [];
    state.round.actionFollowupHistory = [];
    state.round.pendingPlayerRolls = [];
    if (state.initiative) {
      state.initiative.pendingReactions = [];
      state.initiative.lastAttackResult = null;
      state.initiative.turnFollowupHistory = [];
      state.initiative.reactionFollowup = null;
    }
    if (!state.reactions) state.reactions = { available: [], used: [] };
    await writeReactionsMd(workingObject, state).catch(() => {});
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
      clearCombatTimer(state.session?.channelKey || workingObject.channelId);
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
        // Restart 60s timer for the next pending player
        const dmSkipTimerKey = state.session?.channelKey || workingObject.channelId;
        const capturedDmWo = { ...workingObject };
        combatTimers.set(dmSkipTimerKey, setTimeout(() => {
          fireAutoAssignInitiative(baseCore, runFlow, createRunCore, capturedDmWo, dmSkipTimerKey).catch(console.error);
        }, 60000));
        return {
          accepted: true,
          messages: [
            { text: skippedMsg, type: "bot" },
            { text: buildInitiativePrompt(state), type: "bot" }
          ]
        };
      }
      // All players done — finalize and start combat (timer already cleared)
      return await finalizeInitiativeAndStartCombat(baseCore, runFlow, createRunCore, workingObject, state, [skippedMsg]);
    }

    // In combat turn (any phase, including reaction followup): advance to next combatant
    if (state.mode === "initiative") {
      clearCombatTimer(state.session?.channelKey || workingObject.channelId);
      state.initiative.reactionFollowup = null;
      state.initiative.turnEndMissing = null;
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
  let state;
  try {
    state = await readRoundState(workingObject);
  } catch {
    return { accepted: true, messages: [{ text: "⚠️ Session state could not be read. Use `!dm reset` to reinitialize or re-run session-sync.", type: "bot" }] };
  }
  if (!state || !state.mode) {
    return { accepted: true, messages: [{ text: "⚠️ No active session found. Please run session-sync first.", type: "bot" }] };
  }

  // ── DM Override (checked before all phase routing) ──────────────────────────
  const inputText = getRoundInputText(message);
  bridgeLog(workingObject, `[${state.mode}/${state.phase}] "${inputText.slice(0, 100)}" from="${message?.speakerAlias || message?.authorName || "?"}" rolls=${JSON.stringify((message?.rolls || []).map((r) => r?.total))}`);
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

  if (state.mode === "exploration" && state.phase === "awaiting_player_dice") {
    return await handlePlayerDiceRoll(baseCore, runFlow, createRunCore, workingObject, state, message);
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

  // ── PC roll phases ───────────────────────────────────────────────────────────

  if (state.mode === "initiative" && state.phase === "combat_awaiting_attack_roll") {
    return await handleCombatAwaitingAttackRoll(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  if (state.mode === "initiative" && state.phase === "combat_awaiting_damage_roll") {
    return await handleCombatAwaitingDamageRoll(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  if (state.mode === "initiative" && state.phase === "combat_awaiting_bonus_damage") {
    return await handleCombatAwaitingBonusDamage(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  // ── Outer turn loop (move / bonus action after resolution) ───────────────────

  if (state.mode === "initiative" && state.phase === "combat_awaiting_turn_end") {
    return await handleCombatAwaitingTurnEnd(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  // ── Reaction loop ────────────────────────────────────────────────────────────

  if (state.mode === "initiative" &&
    (state.phase === "combat_reaction_pre" || state.phase === "combat_reaction_post")) {
    return await handleCombatReactionWindow(baseCore, runFlow, createRunCore, workingObject, state, message);
  }

  if (state.mode === "initiative" && state.phase === "combat_reaction_followup") {
    return await handleCombatReactionFollowup(baseCore, runFlow, createRunCore, workingObject, state, message);
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
