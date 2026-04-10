/**************************************************************/
/* filename: "subagent-manager.js"                                  */
/* Version 1.0                                               */
/* Purpose: Shared helper implementation.                   */
/**************************************************************/
"use strict";

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE_FILE = join(ROOT_DIR, "core.json");
const MANIFESTS_DIR = join(ROOT_DIR, "manifests");
const GET_SUBAGENT_MANIFEST_NAME = "getSubAgent";

const DEFAULT_GET_SUBAGENT_DESCRIPTION_BASE =
  "Spawns an isolated AI subagent to handle a complex or multi-step task. Always fire-and-forget — returns immediately with jobId plus internal project metadata in the tool response. The result is delivered back to this Discord channel when the subagent completes.\n\n" +
  "MODE:\n" +
  "- mode='normal' (default): starts a NEW project/job. Any provided projectId is ignored.\n" +
  "- mode='resume': resumes an EXISTING project via projectId and reuses its stored context. The caller still chooses the target subagent type for the follow-up task.\n\n" +
  "DIRECT TOOLS FIRST: Use available tools directly for simple single-step tasks (getTavily for web search, getImage for a single image, etc.). Only use getSubAgent when the task requires tools not available here, is multi-step, or will take significant time.\n\n" +
  "NEVER write code inline in your response — any coding task must go through getSubAgent(type: 'develop').\n\n" +
  "AFTER SPAWNING: When getSubAgent returns with status=started, acknowledge this to the user in your current character and persona. Do NOT expose projectId values in normal user-facing text. Treat projectId as internal metadata unless the user explicitly asks for it. Stay fully in character (Old English, roleplay, etc.) as defined by your system prompt.\n\n" +
  "RESUME: Only call getSubAgent with mode='resume' when the user asks to continue/follow up/work further on a project outcome that is not already fully answerable from current context. If the user asks for metadata that is already visible in context (e.g., project ID, job ID, status, links), answer directly from context and DO NOT spawn a new subagent.\n\n" +
  "CONTEXT SCAN BEFORE EVERY CALL: Before writing the task field, scan the recent conversation for any artifact URLs, ARTIFACTS blocks, file URLs, image URLs, or ZIP URLs produced by previous subagent calls. Pass all relevant ones into the task — subagents cannot see the conversation history and will regenerate everything from scratch if you omit them.\n\n" +
  "ONE CALL PER DELIVERABLE: Each subagent call produces one output. Do not split a single deliverable across multiple calls.\n\n" +
  "NESTED CALLS: If you are already running inside a project context (systemPromptAddition mentions a project-ID), only call getSubAgent for genuinely independent sub-tasks that require a different tool palette. Never use getSubAgent to summarise, analyse, or continue work that is already visible in your loaded context — do that directly.\n\n" +
  "SEQUENTIAL DEPENDENCIES: If subagent B needs the result of subagent A, call A first, wait for its result, then pass it explicitly in B's task.";

const DEFAULT_SUBAGENT_MANIFEST_DESCRIPTIONS = {
  history: "Use ONLY when the user EXPLICITLY asks for historical data (history, old events, past time ranges), asks for specific people/places/objects/topics/events from prior sessions that are not available in the current context, or when solving the task strictly requires searching older context information. Do NOT trigger history just because the user says 'summary', 'context', or similarly vague memory-like wording.",
  research: "Web search, webpage fetch, YouTube, route planning, and location lookups.",
  generate: "PDF and document assembly.",
  media: "Image generation, animation, video, and token creation. Pass all sequential steps in ONE task.",
  atlassian: "Jira and Confluence.",
  microsoft: "Microsoft 365 / Graph API.",
  develop: "Any code writing, fixing, or modification task.",
  patch: "One targeted change to one file URL, typically only from within a 'develop' subagent.",
  orchestrate: "Independent parts requiring different tool sets simultaneously.",
  test: "Dummy subagent for testing the pipeline without API costs.",
  generic: "General-purpose subagent for tasks that do not fit a more specific specialist."
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(text) {
  return JSON.parse(text);
}

function writePrettyJson(filePath, data) {
  return writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function sanitizeManifestName(name) {
  const value = String(name || "").trim();
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error("Invalid manifest name");
  }
  return value;
}

function sanitizeTypeKey(typeKey) {
  const value = String(typeKey || "").trim();
  if (!/^[a-z][a-z0-9-]*$/i.test(value)) throw new Error("Invalid subagent type key");
  return value;
}

function sanitizeChannelId(channelId, fallbackTypeKey) {
  const raw = String(channelId || "").trim() || ("subagent-" + fallbackTypeKey);
  if (!/^[A-Za-z0-9:_-]+$/.test(raw)) throw new Error("Invalid channel ID");
  return raw;
}

function getTitleFromTypeKey(typeKey) {
  return String(typeKey || "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripAvailableTypesSection(text) {
  const value = String(text || "");
  const marker = "\n\nAvailable types";
  const idx = value.indexOf(marker);
  return idx >= 0 ? value.slice(0, idx).trim() : value.trim();
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCoreChannelConfig(coreJson) {
  if (!coreJson.config || typeof coreJson.config !== "object") coreJson.config = {};
  const cfg = ensureObject(coreJson.config["core-channel-config"]);
  coreJson.config["core-channel-config"] = cfg;
  cfg.channels = ensureArray(cfg.channels);
  return cfg;
}

function getSubagentTypeMap(coreJson) {
  if (!coreJson.workingObject || typeof coreJson.workingObject !== "object") coreJson.workingObject = {};
  const wo = coreJson.workingObject;
  wo.toolsconfig = ensureObject(wo.toolsconfig);
  wo.toolsconfig.getSubAgent = ensureObject(wo.toolsconfig.getSubAgent);
  wo.toolsconfig.getSubAgent.types = ensureObject(wo.toolsconfig.getSubAgent.types);
  return wo.toolsconfig.getSubAgent.types;
}

function findChannelIndex(channels, channelId) {
  return channels.findIndex(entry => {
    const match = entry?.channelMatch;
    if (Array.isArray(match)) return match.includes(channelId);
    return String(match || "").trim() === channelId;
  });
}

function getManifestDescription(block, typeKey) {
  const raw = String(
    block?.manifestDescription ??
    block?.description ??
    DEFAULT_SUBAGENT_MANIFEST_DESCRIPTIONS[typeKey] ??
    ("Description for subagent type '" + typeKey + "'.")
  ).trim();
  const value = /^Description for subagent type /i.test(raw)
    ? String(DEFAULT_SUBAGENT_MANIFEST_DESCRIPTIONS[typeKey] || raw).trim()
    : raw;
  return value || DEFAULT_SUBAGENT_MANIFEST_DESCRIPTIONS[typeKey] || ("Description for subagent type '" + typeKey + "'.");
}

function normalizeManifestBlock(typeKey, channelId, block) {
  const source = ensureObject(block);
  const next = cloneJson(source);
  next.type = typeKey;
  next.channelId = channelId;
  if (!String(next.title || "").trim()) next.title = getTitleFromTypeKey(typeKey);
  next.manifestDescription = getManifestDescription(next, typeKey);
  return next;
}

function syncGetSubagentManifest(manifestJson, coreJson) {
  const next = cloneJson(manifestJson);
  const types = getSubagentTypeMap(coreJson);
  const order = Object.keys(types);
  const existingBlocks = ensureObject(next.xSubagents);
  const syncedBlocks = {};

  for (const typeKey of order) {
    syncedBlocks[typeKey] = normalizeManifestBlock(typeKey, String(types[typeKey] || ""), existingBlocks[typeKey]);
  }

  next.xSubagents = syncedBlocks;
  next.xBaseDescription = stripAvailableTypesSection(next.xBaseDescription || next.description || DEFAULT_GET_SUBAGENT_DESCRIPTION_BASE) || DEFAULT_GET_SUBAGENT_DESCRIPTION_BASE;
  next.description = next.xBaseDescription +
    (order.length
      ? "\n\nAvailable types (for mode='normal'):\n" + order.map(typeKey => "- '" + typeKey + "': " + getManifestDescription(syncedBlocks[typeKey], typeKey)).join("\n")
      : "");

  next.parameters = ensureObject(next.parameters);
  next.parameters.type = "object";
  next.parameters.properties = ensureObject(next.parameters.properties);
  next.parameters.properties.type = ensureObject(next.parameters.properties.type);
  next.parameters.properties.type.type = "string";
  next.parameters.properties.type.description = "Subagent type/tool palette. Required in both modes and selected by the caller based on the task.";
  next.parameters.properties.type.enum = order;
  next.parameters.required = Array.isArray(next.parameters.required) && next.parameters.required.length ? next.parameters.required : ["type"];
  next.parameters.additionalProperties = false;

  return next;
}

async function readCoreJson() {
  return readJson(await readFile(CORE_FILE, "utf-8"));
}

async function writeCoreJson(coreJson) {
  await writePrettyJson(CORE_FILE, coreJson);
}

async function listManifestNames() {
  const files = await readdir(MANIFESTS_DIR);
  return files
    .filter(name => name.endsWith(".json"))
    .map(name => name.slice(0, -5))
    .sort((a, b) => a.localeCompare(b));
}

async function readManifest(name) {
  const safeName = sanitizeManifestName(name);
  const filePath = join(MANIFESTS_DIR, safeName + ".json");
  return readJson(await readFile(filePath, "utf-8"));
}

async function writeManifest(name, json) {
  const safeName = sanitizeManifestName(name);
  const filePath = join(MANIFESTS_DIR, safeName + ".json");
  await writePrettyJson(filePath, json);
}

async function getSubagentManagerData(typeKey) {
  const coreJson = await readCoreJson();
  const manifestJson = syncGetSubagentManifest(await readManifest(GET_SUBAGENT_MANIFEST_NAME), coreJson);
  const types = getSubagentTypeMap(coreJson);
  const channels = getCoreChannelConfig(coreJson).channels;
  const key = sanitizeTypeKey(typeKey);
  const channelId = sanitizeChannelId(types[key], key);
  const channelIndex = findChannelIndex(channels, channelId);
  const channelEntry = channelIndex >= 0 ? channels[channelIndex] : {};
  const manifestBlock = normalizeManifestBlock(key, channelId, manifestJson.xSubagents?.[key]);

  return {
    typeKey: key,
    channelId,
    title: String(channelEntry?._title || ("Subagent: " + getTitleFromTypeKey(key))).trim(),
    overrides: ensureObject(channelEntry?.overrides),
    manifestBlock
  };
}

async function listSubagents() {
  const coreJson = await readCoreJson();
  const manifestJson = syncGetSubagentManifest(await readManifest(GET_SUBAGENT_MANIFEST_NAME), coreJson);
  const types = getSubagentTypeMap(coreJson);
  const channels = getCoreChannelConfig(coreJson).channels;

  return Object.keys(types).map(typeKey => {
    const channelId = sanitizeChannelId(types[typeKey], typeKey);
    const channelIndex = findChannelIndex(channels, channelId);
    const channelEntry = channelIndex >= 0 ? channels[channelIndex] : {};
    const manifestBlock = normalizeManifestBlock(typeKey, channelId, manifestJson.xSubagents?.[typeKey]);
    return {
      typeKey,
      channelId,
      title: String(channelEntry?._title || ("Subagent: " + getTitleFromTypeKey(typeKey))).trim(),
      manifestTitle: String(manifestBlock.title || getTitleFromTypeKey(typeKey)).trim(),
      manifestDescription: getManifestDescription(manifestBlock, typeKey)
    };
  });
}

async function saveSubagent(input) {
  const coreJson = await readCoreJson();
  const manifestJson = await readManifest(GET_SUBAGENT_MANIFEST_NAME);
  const types = getSubagentTypeMap(coreJson);
  const channelConfig = getCoreChannelConfig(coreJson);
  const channels = channelConfig.channels;

  const nextTypeKey = sanitizeTypeKey(input?.typeKey);
  const previousTypeKey = input?.previousTypeKey ? sanitizeTypeKey(input.previousTypeKey) : nextTypeKey;
  const nextChannelId = sanitizeChannelId(input?.channelId, nextTypeKey);
  const title = String(input?.title || ("Subagent: " + getTitleFromTypeKey(nextTypeKey))).trim() || ("Subagent: " + getTitleFromTypeKey(nextTypeKey));
  const overrides = ensureObject(input?.overrides);
  const manifestBlock = normalizeManifestBlock(nextTypeKey, nextChannelId, input?.manifestBlock);

  const previousChannelId = types[previousTypeKey] ? sanitizeChannelId(types[previousTypeKey], previousTypeKey) : "";
  if (previousTypeKey && previousTypeKey !== nextTypeKey) {
    delete types[previousTypeKey];
  }

  if (previousChannelId && previousChannelId !== nextChannelId) {
    const prevIndex = findChannelIndex(channels, previousChannelId);
    if (prevIndex >= 0) channels.splice(prevIndex, 1);
  }

  types[nextTypeKey] = nextChannelId;

  const nextChannelEntry = {
    channelMatch: [nextChannelId],
    overrides,
    _title: title
  };

  const existingIndex = findChannelIndex(channels, nextChannelId);
  if (existingIndex >= 0) channels[existingIndex] = nextChannelEntry;
  else channels.push(nextChannelEntry);

  const nextManifest = cloneJson(manifestJson);
  nextManifest.xSubagents = ensureObject(nextManifest.xSubagents);
  if (previousTypeKey && previousTypeKey !== nextTypeKey) delete nextManifest.xSubagents[previousTypeKey];
  nextManifest.xSubagents[nextTypeKey] = manifestBlock;
  const syncedManifest = syncGetSubagentManifest(nextManifest, coreJson);

  await writeCoreJson(coreJson);
  await writeManifest(GET_SUBAGENT_MANIFEST_NAME, syncedManifest);

  return getSubagentManagerData(nextTypeKey);
}

async function deleteSubagent(typeKey) {
  const key = sanitizeTypeKey(typeKey);
  const coreJson = await readCoreJson();
  const manifestJson = await readManifest(GET_SUBAGENT_MANIFEST_NAME);
  const types = getSubagentTypeMap(coreJson);
  const channelConfig = getCoreChannelConfig(coreJson);
  const channels = channelConfig.channels;
  const channelId = types[key] ? sanitizeChannelId(types[key], key) : "";

  delete types[key];

  if (channelId) {
    const channelIndex = findChannelIndex(channels, channelId);
    if (channelIndex >= 0) channels.splice(channelIndex, 1);
  }

  const nextManifest = cloneJson(manifestJson);
  nextManifest.xSubagents = ensureObject(nextManifest.xSubagents);
  delete nextManifest.xSubagents[key];
  const syncedManifest = syncGetSubagentManifest(nextManifest, coreJson);

  await writeCoreJson(coreJson);
  await writeManifest(GET_SUBAGENT_MANIFEST_NAME, syncedManifest);
}

export {
  CORE_FILE,
  MANIFESTS_DIR,
  GET_SUBAGENT_MANIFEST_NAME,
  listManifestNames,
  readManifest,
  writeManifest,
  readCoreJson,
  writeCoreJson,
  listSubagents,
  getSubagentManagerData,
  saveSubagent,
  deleteSubagent,
  syncGetSubagentManifest
};
