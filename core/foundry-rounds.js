/**************************************************************/
/* filename: "foundry-rounds.js"                             */
/* Version 1.0                                               */
/* Purpose: Shared Foundry round-engine persistence helpers. */
/**************************************************************/

import fs from "node:fs/promises";
import path from "node:path";
import { getUserDir } from "./file.js";

const STATUS_DIRNAME = "status";
const PARTY_DIRNAME = "party";
const ROUND_STATE_FILENAME = "foundry-round-state.json";

export const FOUNDRY_MD_TEMPLATES = {
  "foundry-progress.md": `# Foundry Progress

## Campaign
- Title:
- Module:
- Current chapter:
- Current scene:

## Party State
- Current location:
- Current objective:
- Active NPCs:
- Active threats:

## Confirmed World State
- Last confirmed in-world state:
- Immediate hazards:
- Resolved threads:
- Unresolved threads:

## Source Anchor
- Current journal entry:
- Current journal page:
- Current story anchor:
- Why this anchor is authoritative:
- Next journals or sections to check:

## Recent Timeline
- Most recent confirmed event:
- Previous confirmed event:
- Pending player decisions:
`,
  "foundry-conditions.md": `# Foundry Conditions

## Active Round Context
- Combat active:
- Round:
- Turn:
- Active combatant:

## Party Conditions
- Character:
  - Conditions:
  - Concentration:
  - Temporary effects:
  - Notes:

## NPC Conditions
- NPC / Monster:
  - Conditions:
  - Concentration:
  - Temporary effects:
  - Notes:
`,
  "foundry-combat-state.md": `# Foundry Combat State

## Combat Summary
- Combat active:
- Scene:
- Round:
- Turn:
- Active combatant:

## NPC / Monster State
- Name:
  - Actor ID:
  - Initiative:
  - HP current:
  - HP max:
  - Temp HP:
  - AC:
  - Conditions:
  - Concentration:
  - Notes:
`,
  "foundry-party-state.md": `# Foundry Party State

## Party Roster
- Party size:
- Active players:
- Active characters:

## Character Files
- Index:
`,
  "foundry-storybubble.md": `# Foundry Story Bubble

## Scope
- Current location:
- Current objective:
- Current chapter:
- Bubble age:

## Nearby Story
- Immediate scene:
- Nearby likely events:
- Nearby NPCs:
- Nearby hazards:

## Next Likely Beats
- Most likely next beats:
- If players drift:
- If the bubble is insufficient, load next:
`
};

function normalize(value) {
  return String(value ?? "").trim();
}

function slugify(value, fallback = "entry") {
  const out = normalize(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return out || fallback;
}

export function getFoundryNotebookRoot(workingObject) {
  return path.join(getUserDir(workingObject), "dm-notebook");
}

export function getFoundryStatusDir(workingObject) {
  return path.join(getFoundryNotebookRoot(workingObject), STATUS_DIRNAME);
}

export function getFoundryPartyDir(workingObject) {
  return path.join(getFoundryNotebookRoot(workingObject), PARTY_DIRNAME);
}

export function getRoundStatePath(workingObject) {
  return path.join(getFoundryStatusDir(workingObject), ROUND_STATE_FILENAME);
}

export async function ensureFoundryNotebookLayout(workingObject) {
  await fs.mkdir(getFoundryStatusDir(workingObject), { recursive: true });
  await fs.mkdir(getFoundryPartyDir(workingObject), { recursive: true });
}

export async function ensureFoundryMarkdownFiles(workingObject) {
  await ensureFoundryNotebookLayout(workingObject);
  for (const [filename, content] of Object.entries(FOUNDRY_MD_TEMPLATES)) {
    const target = path.join(getFoundryStatusDir(workingObject), filename);
    try {
      await fs.access(target);
    } catch {
      await fs.writeFile(target, content, "utf8");
    }
  }
}

export function createInitialRoundState(session = {}) {
  const players = Array.isArray(session.players) ? session.players : [];
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    sessionAppliedAt: nowIso,
    updatedAt: nowIso,
    mode: "exploration",
    phase: "awaiting_action",
    round: {
      number: 1,
      step: "action",
      activePlayerIndex: 0,
      awaitingPlayerIds: players.map((entry) => entry.userId),
      acceptedActions: [],
      pendingClarifications: [],
      openReactionWindow: null
    },
    initiative: {
      combatName: "Jenny Combat",
      combatId: null,
      round: 0,
      currentTurnIndex: -1,
      turnOrder: [],
      pendingInitiatives: [],
      actorBindings: []
    },
    session: {
      channelId: normalize(session.channelId),
      channelKey: normalize(session.channelKey || session.channelId),
      campaignChannelId: normalize(session.campaignChannelId),
      partyChannelId: normalize(session.partyChannelId),
      opsChannelId: normalize(session.opsChannelId),
      journals: Array.isArray(session.journals) ? session.journals : [],
      players,
      progress: {
        currentLocation: normalize(session.currentLocation),
        currentObjective: normalize(session.currentObjective),
        currentChapter: normalize(session.currentChapter)
      }
    },
    lastScene: {
      summary: "",
      prompt: "",
      sourceAnchor: "",
      nearbyHooks: []
    },
    lastResolution: null
  };
}

export async function readRoundState(workingObject) {
  const target = getRoundStatePath(workingObject);
  const raw = await fs.readFile(target, "utf8");
  return JSON.parse(raw);
}

export async function writeRoundState(workingObject, state) {
  const next = {
    ...(state || {}),
    updatedAt: new Date().toISOString()
  };
  await ensureFoundryNotebookLayout(workingObject);
  await fs.writeFile(getRoundStatePath(workingObject), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function resetFoundryNotebook(workingObject) {
  const statusDir = getFoundryStatusDir(workingObject);
  const partyDir = getFoundryPartyDir(workingObject);
  const deletedFiles = [];

  const deleteMatching = async (dir, predicate) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!predicate(entry.name)) continue;
      await fs.unlink(path.join(dir, entry.name)).catch(() => {});
      deletedFiles.push(path.join(path.basename(dir), entry.name));
    }
  };

  await deleteMatching(statusDir, (name) => /^foundry-.*\.(md|json)$/i.test(name));
  await deleteMatching(partyDir, (name) => /\.md$/i.test(name));
  await ensureFoundryMarkdownFiles(workingObject);
  await writeRoundState(workingObject, createInitialRoundState({}));
  return deletedFiles;
}

export function toMarkdownList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalize(value))
    .filter(Boolean)
    .map((value) => `- ${value}`)
    .join("\n");
}

export function buildPartyStateMarkdown(session) {
  const players = Array.isArray(session?.players) ? session.players : [];
  return [
    "# Foundry Party State",
    "",
    "## Party Roster",
    `- Party size: ${players.length}`,
    `- Active players: ${players.map((entry) => normalize(entry.userName)).filter(Boolean).join(", ") || "-"}`,
    `- Active characters: ${players.map((entry) => normalize(entry.characterName || entry.userName)).filter(Boolean).join(", ") || "-"}`,
    "",
    "## Character Files",
    ...players.map((entry) => `- ${normalize(entry.userName)}: party/${slugify(entry.fileSlug || entry.userName)}.md`)
  ].join("\n");
}

export function buildProgressMarkdown(state) {
  const progress = state?.session?.progress || {};
  const scene = state?.lastScene || {};
  return [
    "# Foundry Progress",
    "",
    "## Campaign",
    `- Title: ${normalize(progress.title) || "-"}`,
    `- Module: ${normalize(progress.module) || "-"}`,
    `- Current chapter: ${normalize(progress.currentChapter) || "-"}`,
    `- Current scene: ${normalize(scene.summary) || "-"}`,
    "",
    "## Party State",
    `- Current location: ${normalize(progress.currentLocation) || "-"}`,
    `- Current objective: ${normalize(progress.currentObjective) || "-"}`,
    `- Active NPCs: ${Array.isArray(scene.nearbyHooks) ? scene.nearbyHooks.join(", ") || "-" : "-"}`,
    `- Active threats: ${normalize(state?.lastResolution?.activeThreats) || "-"}`
  ].join("\n");
}

export function buildStoryBubbleMarkdown(scene) {
  const hooks = Array.isArray(scene?.nearbyHooks) ? scene.nearbyHooks : [];
  return [
    "# Foundry Story Bubble",
    "",
    "## Scope",
    `- Current location: ${normalize(scene?.location) || "-"}`,
    `- Current objective: ${normalize(scene?.objective) || "-"}`,
    `- Current chapter: ${normalize(scene?.chapter) || "-"}`,
    `- Bubble age: ${normalize(scene?.generatedAt) || "-"}`,
    "",
    "## Nearby Story",
    `- Immediate scene: ${normalize(scene?.summary) || "-"}`,
    `- Nearby likely events: ${normalize(scene?.nearbyEvents) || "-"}`,
    `- Nearby NPCs: ${normalize(scene?.nearbyNpcs) || "-"}`,
    `- Nearby hazards: ${normalize(scene?.nearbyHazards) || "-"}`,
    "",
    "## Next Likely Beats",
    `- Most likely next beats: ${normalize(scene?.nextBeats) || "-"}`,
    `- If players drift: ${normalize(scene?.drift) || "-"}`,
    `- If the bubble is insufficient, load next: ${normalize(scene?.loadNext) || "-"}`
  ].join("\n");
}

export function buildCharacterMarkdown(player, details) {
  const summary = details && typeof details === "object" ? details : {};
  const lines = [
    `# ${normalize(player?.characterName || player?.userName || "Character")}`,
    "",
    `- Player: ${normalize(player?.userName) || "-"}`,
    `- Source: ${normalize(player?.source) || "-"}`,
    `- Foundry user ID: ${normalize(player?.userId) || "-"}`,
    `- Actor ID: ${normalize(player?.actorId) || "-"}`,
    `- DnDBeyond ID: ${normalize(player?.dndbeyondId) || "-"}`,
    ""
  ];

  if (summary.name) lines.push(`- Character: ${normalize(summary.name)}`);
  if (summary.classSummary) lines.push(`- Class: ${normalize(summary.classSummary)}`);
  if (summary.race) lines.push(`- Race: ${normalize(summary.race)}`);
  if (summary.level) lines.push(`- Level: ${normalize(summary.level)}`);
  if (summary.ac) lines.push(`- AC: ${normalize(summary.ac)}`);
  if (summary.hp) lines.push(`- HP: ${normalize(summary.hp)}`);
  if (summary.passivePerception) lines.push(`- Passive Perception: ${normalize(summary.passivePerception)}`);

  if (Array.isArray(summary.notes) && summary.notes.length) {
    lines.push("", "## Notes", ...summary.notes.map((entry) => `- ${normalize(entry)}`));
  }

  if (summary.rawMarkdown) {
    lines.push("", "## Raw Summary", summary.rawMarkdown);
  }

  return lines.join("\n");
}

export function getCharacterFileName(player) {
  return `${slugify(player?.fileSlug || player?.userName || player?.userId || "character")}.md`;
}

export async function writeCharacterMarkdown(workingObject, player, markdown) {
  await ensureFoundryNotebookLayout(workingObject);
  const filename = getCharacterFileName(player);
  const target = path.join(getFoundryPartyDir(workingObject), filename);
  await fs.writeFile(target, String(markdown || "").trim() + "\n", "utf8");
  return { filename, target };
}
