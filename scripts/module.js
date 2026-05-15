const MODULE_ID = "jenny-foundry-bridge";
const SOCKET_NAME = `module.${MODULE_ID}`;
const TEMP_COMBAT_ACTOR_FLAG = "temporaryCombatActor";
const SOURCE_COMBAT_ACTOR_ID_FLAG = "sourceCombatActorId";
const COMBAT_INSTANCE_KEY_FLAG = "combatInstanceKey";

const SETTING_KEYS = {
  channelKey: "channelKey",
  sharedSecret: "sharedSecret",
  transportMode: "transportMode",
  botBaseUrl: "botBaseUrl",
  botApiSecret: "botApiSecret",
  playChannelId: "playChannelId",
  contextLimit: "contextLimit",
  pollIntervalMs: "pollIntervalMs",
  externalCharacters: "externalCharacters",
  playerBindings: "playerBindings",
  emitChatRolls: "emitChatRolls",
  selectedJournalEntries: "selectedJournalEntries",
  selectedPlayers: "selectedPlayers"
};

let pollTimer = null;
let pollInFlight = false;

function log(...args) {
  console.log(`[${MODULE_ID}]`, ...args);
}

function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

function normalize(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBotChatContent(text) {
  const normalized = normalize(text);
  if (!normalized) return "";
  return escapeHtml(normalized).replace(/\r\n|\r|\n/g, "<br>");
}

function getSlug(value) {
  return normalize(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "foundry";
}

function getFoundrySpecialistChannel(kind, baseChannelId) {
  return `subagent-foundry-${kind}-${getSlug(baseChannelId)}`;
}

function getFoundryContextUserId() {
  return `foundry-${normalize(game.world?.id || game.user?.id || "world")}`;
}

function sanitizeFoundryRichText(value) {
  let text = String(value ?? "");
  if (!text) return "";

  text = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1");
  text = text.replace(/@UUID\[[^\]]+\]/g, "");
  text = text.replace(/@(?:JournalEntryPage|JournalEntry|Actor|Item|Scene)\[[^\]]+\]\{([^}]+)\}/g, "$1");
  text = text.replace(/@(?:JournalEntryPage|JournalEntry|Actor|Item|Scene)\[[^\]]+\]/g, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<li>/gi, "- ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  return normalize(text);
}

function getPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBotEndpoint(pathname) {
  const baseUrl = normalize(getSetting(SETTING_KEYS.botBaseUrl)).replace(/\/+$/, "");
  if (!baseUrl) return "";
  return `${baseUrl}/${normalize(pathname).replace(/^\/+/, "")}`;
}

function getLocalized(key) {
  return game.i18n.localize(key);
}

function getRoleLabel(role) {
  if (role === "assistant") return "GM";
  if (role === "user") return "Player";
  return role || "Message";
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getExternalCharacterMap() {
  const raw = getSetting(SETTING_KEYS.externalCharacters);
  const parsed = safeJsonParse(raw || "[]", []);
  return Array.isArray(parsed) ? parsed : [];
}

function getPlayerBindings() {
  const raw = getSetting(SETTING_KEYS.playerBindings);
  const parsed = safeJsonParse(raw || "{}", {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function savePlayerBindings(bindings) {
  const value = JSON.stringify(bindings || {}, null, 2);
  await game.settings.set(MODULE_ID, SETTING_KEYS.playerBindings, value);
}

function getSelectedJournalEntries() {
  const raw = getSetting(SETTING_KEYS.selectedJournalEntries);
  const parsed = safeJsonParse(raw || "[]", []);
  return Array.isArray(parsed) ? parsed.map((value) => normalize(value)).filter(Boolean) : [];
}

async function saveSelectedJournalEntries(selected) {
  const value = JSON.stringify(Array.isArray(selected) ? selected.map((entry) => normalize(entry)).filter(Boolean) : [], null, 2);
  await game.settings.set(MODULE_ID, SETTING_KEYS.selectedJournalEntries, value);
}

function getSelectedPlayers() {
  const raw = getSetting(SETTING_KEYS.selectedPlayers);
  const parsed = safeJsonParse(raw || "[]", []);
  return Array.isArray(parsed) ? parsed.map((value) => normalize(value)).filter(Boolean) : [];
}

async function saveSelectedPlayers(selected) {
  const value = JSON.stringify(Array.isArray(selected) ? selected.map((entry) => normalize(entry)).filter(Boolean) : [], null, 2);
  await game.settings.set(MODULE_ID, SETTING_KEYS.selectedPlayers, value);
}

function getPlayerUsers() {
  const users = Array.from(game.users ?? [])
    .filter((user) => !user.isGM)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (game.user && !users.some((user) => String(user.id || "") === String(game.user.id || ""))) {
    users.unshift(game.user);
  }

  return users;
}

function getPlayerActors() {
  return Array.from(game.actors ?? [])
    .filter((actor) => actor?.hasPlayerOwner === true || getPlayerUsers().some((user) => user.character?.id === actor.id))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getAllActors() {
  return Array.from(game.actors ?? [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function normalizeActorLookup(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getPlayerBindingRows() {
  const bindings = getPlayerBindings();
  const selectedPlayers = new Set(getSelectedPlayers().map((value) => value.toLowerCase()));
  const actorOptions = getAllActors().map((actor) => ({
    value: actor.id,
    label: actor.name
  }));

  return getPlayerUsers().map((user) => {
    const binding = bindings[user.id] || {};
    const actorId = normalize(binding.actorId || user.character?.id || "");
    return {
      userId: user.id,
      userName: user.name,
      selected: selectedPlayers.has(String(user.id || "").toLowerCase()),
      actorId,
      actorOptions: actorOptions.map((option) => ({
        ...option,
        selected: option.value === actorId
      }))
    };
  });
}

function matchesRef(candidate, ref) {
  const a = normalize(candidate).toLowerCase();
  const b = normalize(ref).toLowerCase();
  return !!a && !!b && a === b;
}

function findExternalCharacter(ref) {
  return getExternalCharacterMap().find((entry) =>
    matchesRef(entry?.characterRef, ref) ||
    matchesRef(entry?.actorId, ref) ||
    matchesRef(entry?.name, ref)
  ) || null;
}

function getActorByRef(ref) {
  const normalized = normalize(ref);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  const compact = normalizeActorLookup(normalized);
  return game.actors.get(normalized)
    || getAllActors().find((actor) => normalize(actor.name).toLowerCase() === lowered)
    || getAllActors().find((actor) => normalizeActorLookup(actor.name) === compact)
    || getAllActors().find((actor) => normalize(actor.name).toLowerCase().includes(lowered))
    || getAllActors().find((actor) => normalizeActorLookup(actor.name).includes(compact))
    || null;
}

function getActorItemsByType(actor, type) {
  return actor?.items?.filter((item) => item.type === type) ?? [];
}

function getAbilityBlock(actor) {
  const abilities = actor?.system?.abilities || {};
  const out = {};
  for (const [key, value] of Object.entries(abilities)) {
    out[key] = {
      value: value?.value ?? null,
      mod: value?.mod ?? null,
      proficient: value?.proficient ?? null,
      save: value?.save ?? null
    };
  }
  return out;
}

function getSkillBlock(actor) {
  const skills = actor?.system?.skills || {};
  const out = {};
  for (const [key, value] of Object.entries(skills)) {
    out[key] = {
      value: value?.value ?? null,
      mod: value?.mod ?? null,
      passive: value?.passive ?? null,
      ability: value?.ability ?? null
    };
  }
  return out;
}

function getResourceSummary(actor) {
  const resources = actor?.system?.resources || {};
  const out = {};
  for (const [key, value] of Object.entries(resources)) {
    out[key] = {
      label: value?.label ?? null,
      value: value?.value ?? null,
      max: value?.max ?? null
    };
  }
  return out;
}

function getSpellSummary(actor) {
  const spells = actor?.system?.spells || {};
  const out = {};
  for (const [key, value] of Object.entries(spells)) {
    out[key] = {
      value: value?.value ?? null,
      max: value?.max ?? null,
      override: value?.override ?? null
    };
  }
  return out;
}

function summarizeActor(actor) {
  const system = actor?.system || {};
  return {
    ok: true,
    source: "foundry",
    actorId: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,
    img: actor.img,
    system: {
      details: {
        level: system?.details?.level ?? null,
        cr: system?.details?.cr ?? null,
        race: system?.details?.race ?? null,
        background: system?.details?.background ?? null,
        alignment: system?.details?.alignment ?? null
      },
      attributes: {
        ac: system?.attributes?.ac?.value ?? null,
        hp: {
          value: system?.attributes?.hp?.value ?? null,
          max: system?.attributes?.hp?.max ?? null,
          temp: system?.attributes?.hp?.temp ?? null,
          tempmax: system?.attributes?.hp?.tempmax ?? null
        },
        movement: system?.attributes?.movement ?? null,
        prof: system?.attributes?.prof ?? null,
        initiative: system?.attributes?.init ?? null,
        exhaustion: system?.attributes?.exhaustion ?? null,
        inspiration: system?.attributes?.inspiration ?? null,
        senses: system?.attributes?.senses ?? null,
        spellcasting: system?.attributes?.spellcasting ?? null
      },
      abilities: getAbilityBlock(actor),
      skills: getSkillBlock(actor),
      resources: getResourceSummary(actor),
      spells: getSpellSummary(actor)
    },
    items: {
      weapons: getActorItemsByType(actor, "weapon").map((item) => ({
        id: item.id,
        name: item.name,
        img: item.img
      })),
      spells: getActorItemsByType(actor, "spell").map((item) => ({
        id: item.id,
        name: item.name,
        img: item.img,
        level: item.system?.level ?? null
      })),
      equipment: getActorItemsByType(actor, "equipment").map((item) => ({
        id: item.id,
        name: item.name,
        img: item.img
      }))
    },
    effects: actor?.effects?.map((effect) => ({
      id: effect.id,
      name: effect.name,
      disabled: effect.disabled,
      icon: effect.img
    })) ?? []
  };
}

function scoreTextMatch(text, query) {
  const haystack = normalize(text).toLowerCase();
  const needle = normalize(query).toLowerCase();
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.includes(needle)) return 50;
  return needle.split(/\s+/).filter(Boolean).reduce((score, token) => score + (haystack.includes(token) ? 10 : 0), 0);
}

function buildSearchCorpus(scope) {
  const any = normalize(scope || "any").toLowerCase();
  const corpus = [];

  if (["any", "journal"].includes(any)) {
    for (const journal of game.journal ?? []) {
      corpus.push({
        type: "journal",
        id: journal.id,
        uuid: journal.uuid,
        name: journal.name,
        text: `${journal.name}\n${journal.pages?.map((page) => page.text?.content || page.text?.markdown || "").join("\n") || ""}`
      });
    }
  }

  if (["any", "scene"].includes(any)) {
    for (const scene of game.scenes ?? []) {
      corpus.push({
        type: "scene",
        id: scene.id,
        uuid: scene.uuid,
        name: scene.name,
        text: `${scene.name}\n${scene?.notes?.map((note) => note.text || "").join("\n") || ""}`
      });
    }
  }

  if (["any", "actor"].includes(any)) {
    for (const actor of game.actors ?? []) {
      corpus.push({
        type: "actor",
        id: actor.id,
        uuid: actor.uuid,
        name: actor.name,
        text: `${actor.name}\n${actor?.system?.details?.biography?.value || ""}`
      });
    }
  }

  if (["any", "item"].includes(any)) {
    for (const item of game.items ?? []) {
      corpus.push({
        type: "item",
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        text: `${item.name}\n${item?.system?.description?.value || ""}`
      });
    }
  }

  return corpus;
}

function getJournalEntries() {
  return Array.from(game.journal ?? []);
}

function getJournalFolders() {
  return Array.from(game.folders ?? []).filter((folder) => folder.type === "JournalEntry");
}

function getPageText(page) {
  return sanitizeFoundryRichText(page?.text?.content || page?.text?.markdown || page?.src || "");
}

function getBoundedNumber(value, fallback, min = 0, max = 20000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function getTextWindow(text, offset = 0, maxChars = 6000) {
  const source = String(text || "");
  const safeOffset = getBoundedNumber(offset, 0, 0, Math.max(0, source.length));
  const safeMaxChars = getBoundedNumber(maxChars, 6000, 200, 20000);
  const slice = source.slice(safeOffset, safeOffset + safeMaxChars);
  const nextOffset = safeOffset + slice.length;
  return {
    text: slice || null,
    offset: safeOffset,
    maxChars: safeMaxChars,
    totalChars: source.length,
    truncated: nextOffset < source.length,
    nextOffset: nextOffset < source.length ? nextOffset : null
  };
}

function findJournalByRef(ref) {
  const normalized = normalize(ref);
  if (!normalized) return null;
  return getJournalEntries().find((entry) =>
    matchesRef(entry.id, normalized) ||
    matchesRef(entry.uuid, normalized) ||
    matchesRef(entry.name, normalized)
  ) || null;
}

function findJournalPage(entry, pageRef) {
  const normalized = normalize(pageRef);
  if (!normalized || !entry?.pages) return null;
  return entry.pages.find((page) =>
    matchesRef(page.id, normalized) ||
    matchesRef(page.uuid, normalized) ||
    matchesRef(page.name, normalized)
  ) || null;
}

function summarizeJournalEntry(entry, includePages = false, pagePreviewChars = 800) {
  const pages = Array.from(entry?.pages ?? []);
  return {
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    pageCount: pages.length,
    pages: includePages ? pages.map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name,
      type: page.type || null,
      sort: page.sort ?? null,
      excerpt: (getPageText(page) || "").slice(0, pagePreviewChars) || null,
      totalChars: (getPageText(page) || "").length
    })) : pages.map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name,
      type: page.type || null,
      sort: page.sort ?? null
    }))
  };
}

function getSortedJournalEntries() {
  return getJournalEntries()
    .sort((a, b) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
}

function getSortedPages(entry) {
  return Array.from(entry?.pages ?? []).sort((a, b) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0));
}

function getSortedEntriesInFolder(folderId) {
  return getJournalEntries()
    .filter((entry) => String(entry?.folder?._id || entry?.folder?.id || entry?.folder || "") === String(folderId || ""))
    .sort((a, b) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
}

function getSortedChildFolders(folderId) {
  return getJournalFolders()
    .filter((folder) => String(folder?.folder?._id || folder?.folder?.id || folder?.folder || "") === String(folderId || ""))
    .sort((a, b) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0) || String(a?.name || "").localeCompare(String(b?.name || "")));
}

function getJournalEntriesInTreeOrder(folderId = "") {
  const ordered = [];
  const childFolders = getSortedChildFolders(folderId);
  for (const folder of childFolders) {
    ordered.push(...getJournalEntriesInTreeOrder(folder.id));
  }
  ordered.push(...getSortedEntriesInFolder(folderId));
  return ordered;
}

function getFolderById(folderId) {
  if (!folderId) return null;
  return getJournalFolders().find((folder) => String(folder.id || "") === String(folderId)) || null;
}

function getFolderPath(folder) {
  const names = [];
  let current = folder || null;
  while (current) {
    names.unshift(String(current.name || "").trim());
    const parentId = String(current?.folder?._id || current?.folder?.id || current?.folder || "").trim();
    current = parentId ? getFolderById(parentId) : null;
  }
  return names.filter(Boolean);
}

function getEntryFolderPath(entry) {
  const folderId = String(entry?.folder?._id || entry?.folder?.id || entry?.folder || "").trim();
  if (!folderId) return [];
  const folder = getFolderById(folderId);
  return getFolderPath(folder);
}

function getEntryCorpusText(entry) {
  return Array.from(entry?.pages ?? [])
    .map((page) => `${page?.name || ""}\n${getPageText(page) || ""}`)
    .join("\n\n");
}

function getEntrySummary(entry, maxChars = 320) {
  const corpus = normalize(getEntryCorpusText(entry));
  if (!corpus) return null;
  const firstParagraph = corpus.split(/\n\s*\n/).map((part) => normalize(part)).find(Boolean) || corpus;
  return firstParagraph.slice(0, maxChars) || null;
}

function summarizeJournalFolderNode(folder) {
  const childFolders = getSortedChildFolders(folder.id);
  const childEntries = getSortedEntriesInFolder(folder.id);
  return {
    nodeType: "folder",
    id: folder.id,
    name: folder.name,
    path: getFolderPath(folder),
    parentFolderId: String(folder?.folder?._id || folder?.folder?.id || folder?.folder || "") || null,
    childFolderRefs: childFolders.map((child) => ({
      id: child.id,
      name: child.name,
      path: getFolderPath(child)
    })),
    childEntryRefs: childEntries.map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      path: getEntryFolderPath(entry),
      directReadRef: {
        entryRef: entry.uuid || entry.id || entry.name
      }
    }))
  };
}

function summarizeJournalCrawlEntry(entry) {
  const pages = getSortedPages(entry);
  return {
    nodeType: "entry",
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    path: getEntryFolderPath(entry),
    chapter: getChapterLabel(entry),
    category: getNavigationCategory(entry),
    purposeHint: getPurposeHint(entry),
    pageCount: pages.length,
    summary: getEntrySummary(entry, 320),
    directReadRef: {
      entryRef: entry.uuid || entry.id || entry.name
    },
    pageRefs: pages.map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name,
      directReadRef: {
        entryRef: entry.uuid || entry.id || entry.name,
        pageRef: page.uuid || page.id || page.name
      }
    }))
  };
}

function collectCrawlNodes(folderId, nodes) {
  const childFolders = getSortedChildFolders(folderId);
  const childEntries = getSortedEntriesInFolder(folderId);

  for (const folder of childFolders) {
    nodes.push(summarizeJournalFolderNode(folder));
    collectCrawlNodes(folder.id, nodes);
  }

  for (const entry of childEntries) {
    nodes.push(summarizeJournalCrawlEntry(entry));
  }
}

function getJournalCrawlNodes() {
  const nodes = [];
  collectCrawlNodes("", nodes);

  const rootEntries = getSortedEntriesInFolder("");
  for (const entry of rootEntries) {
    nodes.push(summarizeJournalCrawlEntry(entry));
  }

  return nodes;
}

function summarizeJournalOutlineEntry(entry) {
  const pages = getSortedPages(entry);
  return {
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    folderPath: getEntryFolderPath(entry),
    pageCount: pages.length,
    pages: pages.map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name,
      type: page.type || null,
      sort: page.sort ?? null,
      excerpt: (getPageText(page) || "").slice(0, 400) || null
    }))
  };
}

function getEntrypointScore(entry) {
  const title = String(entry?.name || "");
  const text = getEntryCorpusText(entry);
  let score = 0;
  score += scoreTextMatch(title, "start here");
  score += scoreTextMatch(title, "introduction");
  score += scoreTextMatch(title, "intro");
  score += scoreTextMatch(title, "beginning");
  score += scoreTextMatch(title, "opening scene");
  score += scoreTextMatch(title, "current situation");
  score += scoreTextMatch(title, "chapter 1");
  score += scoreTextMatch(title, "adventure begins");
  score += scoreTextMatch(text, "start here");
  score += scoreTextMatch(text, "opening scene");
  score += scoreTextMatch(text, "current situation");
  score += scoreTextMatch(text, "chapter 1");
  score += scoreTextMatch(text, "adventure begins");
  score += scoreTextMatch(text, "boxed text");
  return score;
}

function getAnchorScore(entry, query) {
  const title = String(entry?.name || "");
  const text = getEntryCorpusText(entry);
  return scoreTextMatch(title, query) + scoreTextMatch(text, query);
}

function getNavigationCategory(entry) {
  const haystack = `${String(entry?.name || "")}\n${getEntryCorpusText(entry)}`.toLowerCase();
  if (/(table of contents|contents|overview|index|appendix|gazetteer|reference|lore|background|city guide|setting)/i.test(haystack)) {
    return "orientation";
  }
  if (/(current situation|start here|opening scene|adventure begins|chapter 1|hook|boxed text|beginning|resume)/i.test(haystack)) {
    return "entrypoint";
  }
  if (/(encounter|scene|location|travel|dungeon|event|quest|mission|chapter)/i.test(haystack)) {
    return "story";
  }
  return "unknown";
}

function getChapterLabel(entry) {
  const folderPath = getEntryFolderPath(entry);
  const title = String(entry?.name || "").trim();
  const chapterMatch = title.match(/\b(ch(?:apter)?\.?\s*\d+[a-z]?|act\.?\s*\d+[a-z]?|part\.?\s*\d+[a-z]?)\b/i);
  if (chapterMatch) return chapterMatch[1];
  if (folderPath.length) return folderPath[0];
  return "Ungrouped";
}

function getPurposeHint(entry) {
  const category = getNavigationCategory(entry);
  switch (category) {
    case "entrypoint":
      return "Likely playable entry or resume point";
    case "orientation":
      return "Orientation or reference material";
    case "story":
      return "Story-driving journal or scene material";
    default:
      return "Journal content requires targeted reading";
  }
}

function summarizeNavigationRef(entry) {
  const firstPage = getSortedPages(entry)[0] || null;
  return {
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    folderPath: getEntryFolderPath(entry),
    chapter: getChapterLabel(entry),
    category: getNavigationCategory(entry),
    purposeHint: getPurposeHint(entry),
    firstPage: firstPage ? {
      id: firstPage.id,
      uuid: firstPage.uuid,
      name: firstPage.name,
      excerpt: (getPageText(firstPage) || "").slice(0, 400) || null
    } : null
  };
}

function buildChapterMap(entries) {
  const chapters = new Map();
  for (const entry of entries) {
    const label = getChapterLabel(entry);
    if (!chapters.has(label)) {
      chapters.set(label, {
        chapter: label,
        journalCount: 0,
        journals: []
      });
    }
    const chapter = chapters.get(label);
    chapter.journalCount += 1;
    chapter.journals.push(summarizeNavigationRef(entry));
  }
  return Array.from(chapters.values()).sort((a, b) => String(a.chapter).localeCompare(String(b.chapter)));
}

function getRecommendedNextJournalRefs(entries, query, limit) {
  const scored = entries
    .map((entry, index) => {
      const anchorScore = query ? getAnchorScore(entry, query) : 0;
      const entrypointScore = getEntrypointScore(entry);
      const category = getNavigationCategory(entry);
      const categoryBonus = category === "entrypoint" ? 80 : category === "story" ? 40 : 0;
      return {
        entry,
        score: anchorScore + entrypointScore + categoryBonus - index
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ entry, score }) => ({
    ...summarizeNavigationRef(entry),
    score
  }));
}

function buildSceneAnchorQuery(payload = {}) {
  const parts = [
    normalize(payload?.query),
    normalize(payload?.currentLocation),
    normalize(payload?.chapterHint),
    normalize(payload?.objective),
    normalize(payload?.recentEvent)
  ].filter(Boolean);

  if (parts.length) return parts.join(" | ");
  const activeSceneName = normalize(game.scenes?.current?.name);
  return activeSceneName || "";
}

function getSceneAnchorScore(entry, compositeQuery, chapterHint) {
  const category = getNavigationCategory(entry);
  const chapter = getChapterLabel(entry);
  let score = 0;

  if (compositeQuery) {
    score += getAnchorScore(entry, compositeQuery);
  }

  if (chapterHint && String(chapter).toLowerCase().includes(String(chapterHint).toLowerCase())) {
    score += 120;
  }

  if (category === "story") score += 90;
  if (category === "entrypoint") score += 45;
  if (category === "orientation") score -= 120;

  return score;
}

function summarizeAnchorCandidate(entry, score) {
  return {
    ...summarizeNavigationRef(entry),
    score,
    pages: getSortedPages(entry).slice(0, 3).map((page) => ({
      id: page.id,
      uuid: page.uuid,
      name: page.name,
      excerpt: (getPageText(page) || "").slice(0, 700) || null
    }))
  };
}

function findFirstJournalEntryInFolder(folderId) {
  const directEntries = getSortedEntriesInFolder(folderId);
  if (directEntries.length) return directEntries[0];

  const childFolders = getSortedChildFolders(folderId);
  for (const child of childFolders) {
    const entry = findFirstJournalEntryInFolder(child.id);
    if (entry) return entry;
  }
  return null;
}

function findJournalEntryPoint() {
  const rootEntries = getSortedEntriesInFolder("");
  if (rootEntries.length) return rootEntries[0];

  const rootFolders = getSortedChildFolders("");
  for (const folder of rootFolders) {
    const entry = findFirstJournalEntryInFolder(folder.id);
    if (entry) return entry;
  }
  return null;
}

const JENNY_COMBAT_NAME = "Jenny Combat";

function getCurrentFoundryScene() {
  return canvas?.scene || game.scenes?.current || null;
}

function getBoundPlayerActorIds() {
  return Object.values(getPlayerBindings())
    .map((binding) => normalize(binding?.actorId))
    .filter(Boolean);
}

function getTokenActor(tokenDoc) {
  return tokenDoc?.actor || game.actors?.get(tokenDoc?.actorId) || null;
}

function isPlayerToken(tokenDoc, boundPlayerActorIds = []) {
  const actor = getTokenActor(tokenDoc);
  const actorId = normalize(actor?.id || tokenDoc?.actorId);
  return actor?.hasPlayerOwner === true || boundPlayerActorIds.some((id) => matchesRef(id, actorId));
}

function buildCombatantSeed(tokenDoc) {
  const actor = getTokenActor(tokenDoc);
  return {
    tokenId: tokenDoc?.id || null,
    actorId: actor?.id || tokenDoc?.actorId || null,
    hidden: tokenDoc?.hidden === true,
    defeated: tokenDoc?.combatant?.isDefeated === true
  };
}

function buildActorCombatantSeed(actor) {
  return {
    tokenId: null,
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    instanceKey: getCombatInstanceKey(actor) || null,
    hidden: false,
    defeated: false
  };
}

function getCombatantMatchKey(entry) {
  return normalize(entry?.tokenId || entry?.actorId || entry?.actorName || entry?.name);
}

function isTemporaryCombatActor(actor) {
  return actor?.getFlag?.(MODULE_ID, TEMP_COMBAT_ACTOR_FLAG) === true;
}

function getSourceCombatActorId(actor) {
  return normalize(actor?.getFlag?.(MODULE_ID, SOURCE_COMBAT_ACTOR_ID_FLAG));
}

function getCombatInstanceKey(actor) {
  return normalize(actor?.getFlag?.(MODULE_ID, COMBAT_INSTANCE_KEY_FLAG));
}

function getActorInitiativeBonus(actor) {
  const init = actor?.system?.attributes?.init;
  const dexMod = Number(actor?.system?.abilities?.dex?.mod);
  const candidates = [
    init?.mod,
    init?.value,
    init?.bonus,
    init?.total,
    init,
    dexMod
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function buildInitiativeNotationForActor(actor) {
  const bonus = getActorInitiativeBonus(actor);
  if (!bonus) return "1d20";
  return `1d20${bonus >= 0 ? "+" : ""}${bonus}`;
}

async function ensureInstancedCombatActor(sourceActor, instanceKey = "", displayName = "") {
  if (!sourceActor?.id) return null;
  const sourceId = normalize(sourceActor.id);
  const normalizedInstanceKey = normalize(instanceKey);
  const existing = getAllActors().find((actor) =>
    isTemporaryCombatActor(actor)
      && getSourceCombatActorId(actor) === sourceId
      && getCombatInstanceKey(actor) === normalizedInstanceKey
  );
  if (existing) return existing;

  const sourceData = sourceActor.toObject();
  delete sourceData._id;
  return Actor.create({
    ...sourceData,
    name: normalize(displayName) || sourceActor.name,
    folder: null,
    sort: 0,
    ownership: sourceData.ownership || {},
    flags: {
      ...(sourceData.flags || {}),
      [MODULE_ID]: {
        ...(sourceData.flags?.[MODULE_ID] || {}),
        [TEMP_COMBAT_ACTOR_FLAG]: true,
        [SOURCE_COMBAT_ACTOR_ID_FLAG]: sourceId,
        [COMBAT_INSTANCE_KEY_FLAG]: normalizedInstanceKey
      }
    }
  });
}

function getActorConditionLabels(actor) {
  return Array.from(actor?.effects ?? [])
    .map((effect) => normalize(effect?.name || effect?.label))
    .filter(Boolean);
}

function buildCombatantActorSnapshot(combatant) {
  const actor = combatant?.actor || null;
  if (!actor) return null;
  return {
    actorId: actor.id || null,
    actorUuid: actor.uuid || null,
    actorName: actor.name || combatant?.name || null,
    temporary: isTemporaryCombatActor(actor),
    sourceActorId: getSourceCombatActorId(actor) || null,
    instanceKey: getCombatInstanceKey(actor) || null,
    hp: {
      value: actor.system?.attributes?.hp?.value ?? null,
      max: actor.system?.attributes?.hp?.max ?? null,
      temp: actor.system?.attributes?.hp?.temp ?? null
    },
    ac: actor.system?.attributes?.ac?.value ?? actor.system?.attributes?.ac ?? null,
    conditions: getActorConditionLabels(actor)
  };
}

function resolveCombatantByRef(combat, ref) {
  const normalizedRef = normalize(ref);
  if (!normalizedRef || !combat) return null;
  return Array.from(combat.combatants ?? []).find((combatant) =>
    matchesRef(combatant.id, normalizedRef)
    || matchesRef(combatant.actor?.id, normalizedRef)
    || matchesRef(combatant.actor?.uuid, normalizedRef)
    || matchesRef(combatant.tokenId, normalizedRef)
    || matchesRef(combatant.name, normalizedRef)
    || matchesRef(combatant.actor?.name, normalizedRef)
  ) || null;
}

function getInitiativeCombat(combatRef) {
  const normalizedRef = normalize(combatRef);
  if (normalizedRef) {
    return game.combats?.get(normalizedRef)
      || game.combats?.find((entry) => matchesRef(entry.name, normalizedRef))
      || null;
  }
  return game.combat || game.combats?.active || game.combats?.find((entry) => matchesRef(entry.name, JENNY_COMBAT_NAME)) || null;
}

async function ensureJennyCombat(combatRef) {
  let combat = getInitiativeCombat(combatRef);
  if (combat) return combat;

  const scene = getCurrentFoundryScene();
  combat = await Combat.create({
    name: normalize(combatRef) || JENNY_COMBAT_NAME,
    scene: scene?.id || null,
    active: true
  });
  return combat;
}

async function getInitiativeSeeds(scope, actorRefs = [], npcNames = [], playerNames = []) {
  const seeds = [];
  const seenKeys = new Set();
  const boundPlayerActorIds = getBoundPlayerActorIds();
  const allowPlayers = ["all", "players", "unset", "unset-players"].includes(scope);
  const explicitActors = actorRefs
    .map((ref) => getActorByRef(ref))
    .filter(Boolean);

  if (allowPlayers) {
    for (const actorId of boundPlayerActorIds) {
      const actor = getActorByRef(actorId);
      if (!actor) continue;
      const seed = buildActorCombatantSeed(actor);
      const key = getCombatantMatchKey(seed);
      if (key && !seenKeys.has(key)) {
        seeds.push(seed);
        seenKeys.add(key);
      }
    }
  }

  for (const actor of explicitActors) {
    const playerOwned = actor?.hasPlayerOwner === true || boundPlayerActorIds.some((id) => matchesRef(id, actor.id));
    const combatActor = playerOwned ? actor : await ensureInstancedCombatActor(actor);
    if (!combatActor) continue;
    if (scope === "players" || scope === "unset-players") {
      if (!playerOwned) continue;
    } else if (scope === "npcs" || scope === "unset-npcs") {
      if (playerOwned) continue;
    }

    const seed = buildActorCombatantSeed(combatActor);
    const key = getCombatantMatchKey(seed);
    if (key && !seenKeys.has(key)) {
      seeds.push(seed);
      seenKeys.add(key);
    }
  }

  const npcInstanceCounts = new Map();
  for (const name of npcNames.map((entry) => normalize(entry)).filter(Boolean)) {
    const sourceActor = getActorByRef(name);
    if (!sourceActor) continue;
    const playerOwned = sourceActor?.hasPlayerOwner === true || boundPlayerActorIds.some((id) => matchesRef(id, sourceActor.id));
    if (scope === "players" || scope === "unset-players") continue;
    if ((scope === "npcs" || scope === "unset-npcs" || scope === "all" || scope === "unset") && playerOwned) continue;
    const currentCount = Number(npcInstanceCounts.get(sourceActor.id) || 0) + 1;
    npcInstanceCounts.set(sourceActor.id, currentCount);
    const displayName = currentCount > 1 ? `${sourceActor.name} ${currentCount}` : sourceActor.name;
    const actor = await ensureInstancedCombatActor(sourceActor, `${sourceActor.id}:${currentCount}`, displayName);
    if (!actor) continue;
    const seed = buildActorCombatantSeed(actor);
    const key = getCombatantMatchKey(seed);
    if (key && !seenKeys.has(key)) {
      seeds.push(seed);
      seenKeys.add(key);
    }
  }

  for (const name of playerNames.map((entry) => normalize(entry)).filter(Boolean)) {
    if (!(scope === "all" || scope === "players" || scope === "unset" || scope === "unset-players")) continue;
    const actor = getActorByRef(name);
    if (!actor) continue;
    const seed = buildActorCombatantSeed(actor);
    const key = getCombatantMatchKey(seed);
    if (key && !seenKeys.has(key)) {
      seeds.push(seed);
      seenKeys.add(key);
    }
  }

  return seeds;
}

async function ensureCombatantsOnCombat(combat, seeds) {
  const existingKeys = new Set(
    Array.from(combat?.combatants ?? [])
      .map((combatant) => getCombatantMatchKey(combatant))
      .filter(Boolean)
  );

  const toCreate = seeds
    .filter((seed) => !seed.defeated)
    .filter((seed) => {
      const key = getCombatantMatchKey(seed);
      return key && !existingKeys.has(key);
    })
    .map((seed) => ({
      tokenId: seed.tokenId || null,
      actorId: seed.actorId || null,
      hidden: seed.hidden === true
    }));

  if (toCreate.length) {
    await combat.createEmbeddedDocuments("Combatant", toCreate);
  }
}

async function handleInitiative(payload) {
  const combatRef = normalize(payload?.combatRef);
  const mode = normalize(payload?.mode || "full").toLowerCase();
  const operation = normalize(payload?.operation || "read").toLowerCase();
  const scope = normalize(payload?.scope || (operation === "roll" || operation === "ensure" ? "all" : "unset")).toLowerCase();
  const actorRefs = Array.isArray(payload?.actorRefs) ? payload.actorRefs.map((ref) => normalize(ref)).filter(Boolean) : [];
  const npcNames = Array.isArray(payload?.npcNames) ? payload.npcNames.map((name) => normalize(name)).filter(Boolean) : [];
  const playerNames = Array.isArray(payload?.playerNames) ? payload.playerNames.map((name) => normalize(name)).filter(Boolean) : [];
  const initiatives = Array.isArray(payload?.initiatives) ? payload.initiatives : [];
  let combat = getInitiativeCombat(combatRef);

  if (operation === "end" || operation === "delete" || operation === "remove") {
    if (!combat) {
      return {
        ok: true,
        source: "foundry",
        action: "initiative",
        operation,
        ended: false,
        reason: "no_active_combat"
      };
    }

    const tempActors = Array.from(combat.combatants ?? [])
      .map((combatant) => combatant.actor)
      .filter((actor) => actor && isTemporaryCombatActor(actor));
    const combatId = combat.id;
    const combatName = combat.name;
    await combat.delete();
    for (const actor of tempActors) {
      await actor.delete().catch(() => {});
    }
    return {
      ok: true,
      source: "foundry",
      action: "initiative",
      operation,
      ended: true,
      combatId,
      combatName
    };
  }

  if (operation === "next" || operation === "advance") {
    if (!combat) {
      return {
        ok: true,
        source: "foundry",
        action: "initiative",
        operation,
        advanced: false,
        reason: "no_active_combat"
      };
    }
    await combat.nextTurn();
    combat = game.combats?.get(combat.id) || combat;
  }

  if (operation === "ensure" || operation === "roll" || operation === "set") {
    combat = await ensureJennyCombat(combatRef);
    const seeds = await getInitiativeSeeds(scope, actorRefs, npcNames, playerNames);
    await ensureCombatantsOnCombat(combat, seeds);
    if (combat.started !== true) {
      await combat.startCombat();
    }
    combat = game.combats?.get(combat.id) || combat;
  }

  if (!combat) {
    return {
      ok: true,
      source: "foundry",
      action: "initiative",
      active: false,
      combat: null
    };
  }

  if (operation === "roll") {
    const playerBindingActorIds = Object.values(getPlayerBindings())
      .map((binding) => normalize(binding?.actorId))
      .filter(Boolean);

    const selectedCombatants = Array.from(combat.combatants ?? []).filter((combatant) => {
      const actorId = normalize(combatant.actor?.id);
      const explicitActorMatch = actorRefs.length > 0 && actorRefs.some((ref) => matchesRef(ref, actorId) || matchesRef(ref, combatant.actor?.name));
      const isBoundPlayerActor = playerBindingActorIds.some((id) => matchesRef(id, actorId));
      const hasPlayerOwner = combatant.players?.length > 0 || combatant.actor?.hasPlayerOwner === true || isBoundPlayerActor;
      const isUnset = combatant.initiative == null;

      if (explicitActorMatch) return true;
      if (scope === "all") return true;
      if (scope === "players") return hasPlayerOwner;
      if (scope === "npcs") return !hasPlayerOwner;
      if (scope === "unset-players") return isUnset && hasPlayerOwner;
      if (scope === "unset-npcs") return isUnset && !hasPlayerOwner;
      return isUnset;
    });

    const combatantIds = selectedCombatants.map((combatant) => combatant.id).filter(Boolean);
    if (!combatantIds.length) {
      return {
        ok: true,
        source: "foundry",
        action: "initiative",
        operation,
        rolled: false,
        scope,
        reason: "no_matching_combatants"
      };
    }

    await combat.rollInitiative(combatantIds);
    combat = game.combats?.get(combat.id) || combat;
  }

  if (operation === "set") {
    const activateHighest = payload?.activateHighest === true || payload?.finalize === true;
    const updates = initiatives
      .map((entry) => {
        const combatant = resolveCombatantByRef(
          combat,
          entry?.combatantRef || entry?.actorRef || entry?.tokenRef || entry?.name
        );
        const initiative = Number(entry?.initiative);
        if (!combatant || !Number.isFinite(initiative)) return null;
        return {
          _id: combatant.id,
          initiative
        };
      })
      .filter(Boolean);

    if (!updates.length) {
      return {
        ok: true,
        source: "foundry",
        action: "initiative",
        operation,
        updated: false,
        reason: "no_matching_initiatives"
      };
    }

    await combat.updateEmbeddedDocuments("Combatant", updates);
    combat = game.combats?.get(combat.id) || combat;
    if (activateHighest) {
      if (typeof combat.setupTurns === "function") {
        await combat.setupTurns();
        combat = game.combats?.get(combat.id) || combat;
      }
      const turns = Array.from(combat.turns ?? []);
      const highestIndex = turns.findIndex((entry) => Number.isFinite(Number(entry?.initiative)));
      if (highestIndex >= 0) {
        await combat.update({
          round: Math.max(1, Number(combat.round || 1)),
          turn: highestIndex
        });
        combat = game.combats?.get(combat.id) || combat;
      }
    }
  }

  const turnIndexById = new Map(
    Array.from(combat.turns ?? []).map((combatant, index) => [combatant.id, index])
  );
  const combatants = Array.from(combat.combatants ?? []).map((combatant, index) => ({
    id: combatant.id,
    name: combatant.name,
    actorId: combatant.actor?.id || null,
    actorUuid: combatant.actor?.uuid || null,
    tokenId: combatant.tokenId || null,
    initiative: combatant.initiative ?? null,
    defeated: combatant.isDefeated === true,
    hidden: combatant.hidden === true,
    hasPlayerOwner: combatant.players?.length > 0,
    turnIndex: turnIndexById.get(combatant.id) ?? index,
    actorSnapshot: buildCombatantActorSnapshot(combatant)
  }));

  const activeCombatant = combat.turns?.[combat.turn] || null;
  const base = {
    ok: true,
    source: "foundry",
    action: "initiative",
    active: true,
    combat: {
      id: combat.id,
      uuid: combat.uuid,
      sceneId: combat.scene?.id || combat.sceneId || null,
      sceneName: combat.scene?.name || null,
      round: combat.round ?? null,
      turn: combat.turn ?? null,
      started: combat.started === true,
      combatantCount: combatants.length
    },
    activeCombatant: activeCombatant ? {
      id: activeCombatant.id,
      name: activeCombatant.name,
      actorId: activeCombatant.actor?.id || null,
      actorUuid: activeCombatant.actor?.uuid || null,
      initiative: activeCombatant.initiative ?? null
    } : null
  };

  if (mode === "active") return base;
  if (mode === "summary") {
    return {
      ...base,
      combatants: combatants.map((entry) => ({
        id: entry.id,
        name: entry.name,
        initiative: entry.initiative,
        defeated: entry.defeated,
        turnIndex: entry.turnIndex
      }))
    };
  }

  return {
    ...base,
    operation,
    combatants
  };
}

async function handleJournal(payload) {
  const operation = normalize(payload?.operation).toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(payload?.limit) || 10));
  const query = normalize(payload?.query);
  const entryRef = normalize(payload?.entryRef);
  const pageRef = normalize(payload?.pageRef);
  const cursor = Math.max(0, Number(payload?.cursor) || 0);
  const offset = getBoundedNumber(payload?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const maxChars = getBoundedNumber(payload?.maxChars, 6000, 200, 20000);

  if (!["list", "search", "read", "scan", "outline", "entrypoints", "anchors", "storynavigation", "currentsceneanchor", "crawl"].includes(operation)) {
    return { ok: false, error: "operation must be list, search, read, scan, outline, entrypoints, anchors, storynavigation, currentsceneanchor, or crawl." };
  }

  if (operation === "list") {
    const entries = getSortedJournalEntries()
      .slice(0, limit)
      .map((entry) => summarizeJournalEntry(entry, false));
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      count: entries.length,
      entries
    };
  }

  if (operation === "scan") {
    const entries = getSortedJournalEntries();
    const slice = entries.slice(cursor, cursor + limit).map((entry) => summarizeJournalEntry(entry, true, 600));
    const nextCursor = cursor + slice.length;
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      total: entries.length,
      cursor,
      pagePreviewChars: 600,
      nextCursor: nextCursor < entries.length ? nextCursor : null,
      hasMore: nextCursor < entries.length,
      count: slice.length,
      entries: slice
    };
  }

  if (operation === "outline") {
    const entries = getSortedJournalEntries()
      .slice(cursor, cursor + limit)
      .map((entry) => summarizeJournalOutlineEntry(entry));
    const total = getSortedJournalEntries().length;
    const nextCursor = cursor + entries.length;
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      total,
      cursor,
      nextCursor: nextCursor < total ? nextCursor : null,
      hasMore: nextCursor < total,
      count: entries.length,
      entries
    };
  }

  if (operation === "crawl") {
    const nodes = getJournalCrawlNodes();
    const slice = nodes.slice(cursor, cursor + limit);
    const nextCursor = cursor + slice.length;
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      total: nodes.length,
      cursor,
      nextCursor: nextCursor < nodes.length ? nextCursor : null,
      hasMore: nextCursor < nodes.length,
      count: slice.length,
      nodes: slice,
      rootFolderRefs: getSortedChildFolders("").map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: getFolderPath(folder)
      })),
      rootEntryRefs: getSortedEntriesInFolder("").map((entry) => ({
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name,
        path: getEntryFolderPath(entry),
        directReadRef: {
          entryRef: entry.uuid || entry.id || entry.name
        }
      }))
    };
  }

  if (operation === "entrypoints") {
    const results = getSortedJournalEntries()
      .map((entry) => ({
        entry,
        score: getEntrypointScore(entry)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry, score }) => ({
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name,
        folderPath: getEntryFolderPath(entry),
        score,
        firstPage: getSortedPages(entry)[0] ? {
          id: getSortedPages(entry)[0].id,
          uuid: getSortedPages(entry)[0].uuid,
          name: getSortedPages(entry)[0].name,
          excerpt: (getPageText(getSortedPages(entry)[0]) || "").slice(0, 600) || null
        } : null
      }));

    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      count: results.length,
      results
    };
  }

  if (operation === "anchors") {
    if (!query) return { ok: false, error: "query is required for anchors." };
    const results = getSortedJournalEntries()
      .map((entry) => ({
        entry,
        score: getAnchorScore(entry, query)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry, score }) => ({
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name,
        folderPath: getEntryFolderPath(entry),
        score,
        pages: getSortedPages(entry).slice(0, 3).map((page) => ({
          id: page.id,
          uuid: page.uuid,
          name: page.name,
          excerpt: (getPageText(page) || "").slice(0, 600) || null
        }))
      }));

    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      query,
      count: results.length,
      results
    };
  }

  if (operation === "storynavigation") {
    const entries = getSortedJournalEntries();
    const chapterMap = buildChapterMap(entries);
    const entrypoints = entries
      .map((entry) => ({
        entry,
        score: getEntrypointScore(entry)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry, score }) => ({
        ...summarizeNavigationRef(entry),
        score
      }));

    const anchorCandidates = query
      ? entries
          .map((entry) => ({
            entry,
            score: getAnchorScore(entry, query)
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ entry, score }) => ({
            ...summarizeNavigationRef(entry),
            score
          }))
      : [];

    const orientationEntries = entries
      .filter((entry) => getNavigationCategory(entry) === "orientation")
      .slice(0, limit)
      .map((entry) => summarizeNavigationRef(entry));

    const fallbackEntry = findJournalEntryPoint();
    const recommendedNextJournalRefs = getRecommendedNextJournalRefs(entries, query, limit);

    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      query: query || null,
      summary: {
        totalJournals: entries.length,
        chapterCount: chapterMap.length,
        recommendedMode: query ? "anchor" : "entrypoint",
        notes: [
          "Use entrypoints to find real playable starts or resume points.",
          "Use anchorCandidates and recommendedNextJournalRefs to choose which exact journals to read next.",
          "Treat orientationEntries as campaign map material, not as scenes to run directly."
        ]
      },
      entrypoints,
      anchorCandidates,
      orientationEntries,
      chapterMap,
      recommendedNextJournalRefs,
      fallbackEntryPoint: fallbackEntry ? summarizeNavigationRef(fallbackEntry) : null
    };
  }

  if (operation === "currentsceneanchor") {
    const entries = getSortedJournalEntries();
    const compositeQuery = buildSceneAnchorQuery(payload);
    const chapterHint = normalize(payload?.chapterHint);

    const candidates = entries
      .map((entry) => ({
        entry,
        score: getSceneAnchorScore(entry, compositeQuery, chapterHint)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry, score }) => summarizeAnchorCandidate(entry, score));

    const primary = candidates[0] || null;
    const journalsToReadNext = (primary ? [primary] : [])
      .concat(
        getRecommendedNextJournalRefs(entries, compositeQuery, limit)
          .filter((entry) => !primary || entry.uuid !== primary.uuid)
          .slice(0, Math.max(0, limit - (primary ? 1 : 0)))
      )
      .slice(0, limit);

    const warnings = [];
    if (!compositeQuery) {
      warnings.push("No explicit scene query was provided; the anchor falls back to the active Foundry scene name or broad campaign heuristics.");
    }
    if (primary?.category === "orientation") {
      warnings.push("Top candidate looks like orientation/reference material; verify with a direct read before narrating.");
    }
    if (!primary) {
      warnings.push("No strong scene anchor candidate was found. Use story navigation, then scan or read more journals before continuing play.");
    }

    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      query: compositeQuery || null,
      activeScene: game.scenes?.current ? {
        id: game.scenes.current.id,
        uuid: game.scenes.current.uuid,
        name: game.scenes.current.name
      } : null,
      currentAnchor: primary,
      supportingCandidates: candidates.slice(primary ? 1 : 0),
      journalsToReadNext,
      warnings
    };
  }

  if (operation === "search") {
    if (!query) return { ok: false, error: "query is required for journal search." };
    const results = getJournalEntries()
      .map((entry) => {
        const pageHits = Array.from(entry.pages ?? []).map((page) => {
          const text = getPageText(page);
          const score = scoreTextMatch(page.name, query) + scoreTextMatch(text, query);
          return score > 0 ? {
            id: page.id,
            uuid: page.uuid,
            name: page.name,
            score,
            excerpt: text.slice(0, 1200) || null
          } : null;
        }).filter(Boolean).sort((a, b) => b.score - a.score);

        const entryScore = scoreTextMatch(entry.name, query) + pageHits.reduce((sum, hit) => sum + hit.score, 0);
        return entryScore > 0 ? {
          id: entry.id,
          uuid: entry.uuid,
          name: entry.name,
          score: entryScore,
          pages: pageHits.slice(0, 5)
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      query,
      count: results.length,
      results
    };
  }

  let entry = entryRef ? findJournalByRef(entryRef) : null;
  if (!entry && query) {
    entry = getJournalEntries()
      .map((candidate) => ({
        entry: candidate,
        score:
          scoreTextMatch(candidate.name, query) +
          Array.from(candidate.pages ?? []).reduce((sum, page) => {
            const pageText = getPageText(page);
            return sum + scoreTextMatch(page.name, query) + scoreTextMatch(pageText, query);
          }, 0)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.entry || null;
  }

  let usedFallbackEntryPoint = false;
  if (!entry) {
    entry = findJournalEntryPoint();
    usedFallbackEntryPoint = !!entry;
  }

  if (!entry) return { ok: false, error: "No matching journal entry found and no fallback journal entry point exists." };

  const page = pageRef ? findJournalPage(entry, pageRef) : null;
  if (pageRef && !page) {
    return { ok: false, error: "No matching journal page found in the requested entry." };
  }

  const firstPage = !pageRef ? getSortedPages(entry)[0] || null : null;

  if (page) {
    const textWindow = getTextWindow(getPageText(page), offset, maxChars);
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      entry: {
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name
      },
      page: {
        id: page.id,
        uuid: page.uuid,
        name: page.name,
        type: page.type || null,
        ...textWindow
      },
      pagination: {
        offset: textWindow.offset,
        maxChars: textWindow.maxChars,
        totalChars: textWindow.totalChars,
        truncated: textWindow.truncated,
        nextOffset: textWindow.nextOffset
      }
    };
  }

  if (firstPage) {
    const textWindow = getTextWindow(getPageText(firstPage), offset, maxChars);
    return {
      ok: true,
      source: "foundry",
      action: "journal",
      operation,
      fallbackEntryPoint: usedFallbackEntryPoint,
      entry: {
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name
      },
      page: {
        id: firstPage.id,
        uuid: firstPage.uuid,
        name: firstPage.name,
        type: firstPage.type || null,
        ...textWindow
      },
      pagination: {
        offset: textWindow.offset,
        maxChars: textWindow.maxChars,
        totalChars: textWindow.totalChars,
        truncated: textWindow.truncated,
        nextOffset: textWindow.nextOffset
      }
    };
  }

  return {
    ok: true,
    source: "foundry",
    action: "journal",
    operation,
    fallbackEntryPoint: usedFallbackEntryPoint,
    entry: summarizeJournalEntry(entry, true)
  };
}

function applyRollModifiers(notation, payload) {
  const advantage = payload?.advantage === true;
  const disadvantage = payload?.disadvantage === true;
  if (advantage === disadvantage) return notation;

  const match = String(notation || "").trim().match(/^1d20(\s*[+-]\s*.+)?$/i);
  if (!match) return notation;

  const suffix = match[1] || "";
  return `${advantage ? "2d20kh" : "2d20kl"}${suffix}`;
}

function coerceRollNotation(rawNotation) {
  const input = normalize(rawNotation);
  if (!input) return "";

  const unwrapped = input
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .trim();

  if (/^[0-9dDkKhHlL+\-*/().,\s]+$/.test(unwrapped)) {
    return unwrapped.replace(/,/g, ".");
  }

  const candidate = unwrapped.match(/\d+\s*d\s*\d+(?:\s*k[hl]\s*\d*)?(?:\s*[+\-*/]\s*\d+)?/i);
  if (candidate?.[0]) {
    return candidate[0].replace(/,/g, ".").trim();
  }

  return unwrapped.replace(/,/g, ".");
}

async function handleRoll(payload) {
  const actor = payload?.actorRef ? getActorByRef(payload.actorRef) : null;
  const rollType = normalize(payload?.rollType).toLowerCase();
  let notation = coerceRollNotation(payload?.notation);
  if (!notation && rollType === "initiative" && actor) {
    notation = buildInitiativeNotationForActor(actor);
  }
  if (!notation) return { ok: false, error: "notation is required." };

  const effectiveNotation = applyRollModifiers(notation, payload);
  let roll;
  try {
    roll = await (new Roll(effectiveNotation)).evaluate();
  } catch (error) {
    return {
      ok: false,
      source: "foundry",
      action: "roll",
      error: `invalid roll notation: ${error?.message || String(error)}`,
      notation,
      effectiveNotation,
      label: normalize(payload?.label) || null
    };
  }
  const emitChatRolls = getSetting(SETTING_KEYS.emitChatRolls) === true;
  const rollMode = normalize(payload?.visibility) || CONST.DICE_ROLL_MODES.PUBLIC;
  const emitChatMessage = payload?.emitChatMessage !== false;
  const shouldCreateChatMessage = emitChatMessage || emitChatRolls;
  let chatMessage = null;

  if (shouldCreateChatMessage) {
    const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
    chatMessage = await roll.toMessage({
      speaker,
      flavor: normalize(payload?.label) || "Jenny bridge roll",
      flags: {
        [MODULE_ID]: {
          botGenerated: true
        }
      }
    }, {
      rollMode
    });
  }

  return {
    ok: true,
    source: "foundry",
    action: "roll",
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    notation,
    effectiveNotation,
    label: normalize(payload?.label) || null,
    visibility: rollMode,
    emittedChatMessage: shouldCreateChatMessage,
    chatMessageId: chatMessage?.id || null,
    total: roll.total,
    formula: roll.formula,
    result: roll.result,
    dice: roll.dice.map((die) => ({
      class: die.constructor?.name ?? "Die",
      faces: die.faces,
      number: die.number,
      results: die.results?.map((entry) => ({
        result: entry.result,
        active: entry.active
      })) ?? []
    }))
  };
}

async function handleCharacter(payload) {
  const ref = normalize(payload?.characterRef);
  if (!ref) return { ok: false, error: "characterRef is required." };

  const external = findExternalCharacter(ref);
  if (external) {
    return {
      ok: true,
      source: normalize(external.source) || "external",
      routed: true,
      characterRef: ref,
      route: external
    };
  }

  const actor = getActorByRef(ref);
  if (!actor) {
    return { ok: false, error: `No actor found for '${ref}'.` };
  }

  return summarizeActor(actor);
}

function summarizeActorReference(actor) {
  const system = actor?.system || {};
  return {
    id: actor?.id || null,
    uuid: actor?.uuid || null,
    name: actor?.name || null,
    type: actor?.type || null,
    img: actor?.img || null,
    hasPlayerOwner: actor?.hasPlayerOwner === true,
    level: system?.details?.level ?? null,
    cr: system?.details?.cr ?? null,
    ac: system?.attributes?.ac?.value ?? null,
    hp: {
      value: system?.attributes?.hp?.value ?? null,
      max: system?.attributes?.hp?.max ?? null
    }
  };
}

async function handleActors(payload) {
  const query = normalize(payload?.query).toLowerCase();
  const type = normalize(payload?.type).toLowerCase();
  const ownedOnly = payload?.ownedOnly === true;
  const combatEligibleOnly = payload?.combatEligibleOnly === true;
  const limit = Math.max(1, Math.min(100, Number(payload?.limit) || 30));

  const actors = getAllActors()
    .filter((actor) => !type || normalize(actor?.type).toLowerCase() === type)
    .filter((actor) => !ownedOnly || actor?.hasPlayerOwner === true)
    .filter((actor) => !query || normalize(actor?.name).toLowerCase().includes(query))
    .filter((actor) => !combatEligibleOnly || Boolean(actor?.id))
    .slice(0, limit)
    .map((actor) => summarizeActorReference(actor));

  return {
    ok: true,
    source: "foundry",
    action: "actors",
    query: query || null,
    type: type || null,
    count: actors.length,
    actors
  };
}

async function handleCampaignInfo(payload) {
  const query = normalize(payload?.query);
  if (!query) return { ok: false, error: "query is required." };

  const limit = Math.max(1, Math.min(20, Number(payload?.limit) || 5));
  const corpus = buildSearchCorpus(payload?.scope);
  const matches = corpus
    .map((entry) => ({
      ...entry,
      score: scoreTextMatch(entry.name, query) + scoreTextMatch(entry.text, query)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      score: entry.score,
      excerpt: normalize(entry.text).slice(0, 1000) || null
    }));

  return {
    ok: true,
    source: "foundry",
    action: "campaignInfo",
    query,
    count: matches.length,
    results: matches,
    activeScene: game.scenes?.current ? {
      id: game.scenes.current.id,
      name: game.scenes.current.name,
      uuid: game.scenes.current.uuid
    } : null
  };
}

async function handleRequest(request = {}) {
  const action = normalize(request?.action).toLowerCase();
  const payload = request?.payload || {};
  const expectedChannelKey = normalize(getSetting(SETTING_KEYS.channelKey));
  const actualChannelKey = normalize(request?.channelKey);
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  const providedSecret = normalize(request?.sharedSecret);

  if (expectedChannelKey && actualChannelKey && expectedChannelKey !== actualChannelKey) {
    return { ok: false, error: "channelKey mismatch." };
  }

  if (sharedSecret && providedSecret && sharedSecret !== providedSecret) {
    return { ok: false, error: "sharedSecret mismatch." };
  }

  switch (action) {
    case "botmessage":
      await postFoundryBotMessages(payload?.messages || []);
      return {
        ok: true,
        action: "botmessage",
        count: Array.isArray(payload?.messages) ? payload.messages.length : 0
      };
    case "roll":
      return handleRoll(payload);
    case "character":
      return handleCharacter(payload);
    case "actors":
      return handleActors(payload);
    case "initiative":
      return handleInitiative(payload);
    case "journal":
      return handleJournal(payload);
    case "selectedjournals":
      return handleSelectedJournals(payload);
    case "selectedplayers":
      return handleSelectedPlayers(payload);
    case "campaigninfo":
      return handleCampaignInfo(payload);
    default:
      return { ok: false, error: `Unsupported action '${action}'.` };
  }
}

async function submitBridgeResult(requestId, channelKey, response) {
  const url = getBotEndpoint("/foundry-bridge/result");
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  if (!url || !sharedSecret) return;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sharedSecret}`
    },
    body: JSON.stringify({
      requestId,
      channelKey,
      response
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Result submit failed: HTTP ${resp.status} ${text}`);
  }
}

async function postBridgeJson(pathname, payload) {
  const url = getBotEndpoint(pathname);
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  if (!url) throw new Error("Bot base URL is not configured.");
  if (!sharedSecret) throw new Error("Shared secret is not configured.");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sharedSecret}`
    },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!resp.ok) {
    throw new Error(`Bot API failed: HTTP ${resp.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function syncFoundrySession(payload) {
  return postBridgeJson("/foundry-bridge/session-sync", payload);
}

async function sendRoundInput(payload) {
  return postBridgeJson("/foundry-bridge/round-input", payload);
}

async function importBotContextEntries(payload) {
  const url = getBotEndpoint("/foundry-bridge/context-import");
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  if (!url) throw new Error("Bot base URL is not configured.");
  if (!sharedSecret) throw new Error("Shared secret is not configured.");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sharedSecret}`
    },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!resp.ok) {
    throw new Error(`Context import failed: HTTP ${resp.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function resetCampaignState(payload = {}) {
  const url = getBotEndpoint("/foundry-bridge/campaign-reset");
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  if (!url) throw new Error("Bot base URL is not configured.");
  if (!sharedSecret) throw new Error("Shared secret is not configured.");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sharedSecret}`
    },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!resp.ok) {
    throw new Error(`Campaign reset failed: HTTP ${resp.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function loadBotContext() {
  const channelId = normalize(getSetting(SETTING_KEYS.playChannelId) || getSetting(SETTING_KEYS.channelKey));
  const apiSecret = normalize(getSetting(SETTING_KEYS.botApiSecret));
  const contextLimit = getPositiveInt(getSetting(SETTING_KEYS.contextLimit), 20);
  const url = getBotEndpoint(`/context?channelId=${encodeURIComponent(channelId)}&limit=${contextLimit}`);
  if (!url) throw new Error("Bot base URL is not configured.");
  if (!apiSecret) throw new Error("Bot API secret is not configured.");
  if (!channelId) throw new Error("Play channel ID is not configured.");

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiSecret}`
    }
  });

  const raw = await resp.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!resp.ok) {
    throw new Error(`Context load failed: HTTP ${resp.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  return Array.isArray(parsed?.messages) ? parsed.messages : [];
}

async function pollBridgeOnce() {
  if (pollInFlight) return;
  if (!game.user?.isGM) return;

  const transportMode = normalize(getSetting(SETTING_KEYS.transportMode)).toLowerCase();
  if (transportMode !== "polling") return;

  const channelKey = normalize(getSetting(SETTING_KEYS.channelKey));
  const sharedSecret = normalize(getSetting(SETTING_KEYS.sharedSecret));
  const url = getBotEndpoint(`/foundry-bridge/poll?channelKey=${encodeURIComponent(channelKey)}`);

  if (!channelKey || !sharedSecret || !url) return;

  pollInFlight = true;
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sharedSecret}`
      }
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Poll failed: HTTP ${resp.status} ${text}`);
    }

    const data = await resp.json();
    const request = data?.request || null;
    if (!request?.requestId) return;

    const response = await handleRequest({
      action: request.action,
      channelKey: request.channelKey,
      payload: request.payload
    });

    await submitBridgeResult(request.requestId, request.channelKey, response);
  } catch (error) {
    log("Polling error", error);
  } finally {
    pollInFlight = false;
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  if (!game.user?.isGM) return;
  const transportMode = normalize(getSetting(SETTING_KEYS.transportMode)).toLowerCase();
  if (transportMode !== "polling") return;
  const intervalMs = getPositiveInt(getSetting(SETTING_KEYS.pollIntervalMs), 1500);
  pollTimer = setInterval(() => {
    pollBridgeOnce().catch((error) => log("Polling loop error", error));
  }, intervalMs);
  pollBridgeOnce().catch((error) => log("Initial poll error", error));
}

function getJournalImportOptions() {
  const selectedRefs = new Set(getSelectedJournalEntries().map((value) => value.toLowerCase()));
  return getJournalEntriesInTreeOrder().map((entry) => {
    const path = getEntryFolderPath(entry);
    const label = path.length ? `${path.join(" / ")} / ${entry.name}` : entry.name;
    const value = entry.uuid || entry.id || entry.name;
    return {
      value,
      label,
      selected: selectedRefs.has(String(value || "").toLowerCase())
    };
  });
}

function buildJournalImportText(entry) {
  const parts = [];
  parts.push(entry.name);
  const path = getEntryFolderPath(entry);
  if (path.length) parts.push(path.join(" / "));
  for (const page of getSortedPages(entry)) {
    const pageText = normalize(getPageText(page));
    if (!pageText) continue;
    parts.push(page.name);
    parts.push(pageText);
  }
  return parts.filter(Boolean).join("\n\n");
}

function splitTextIntoImportChunks(text, maxChars = 120000) {
  const source = String(text || "");
  const limit = getBoundedNumber(maxChars, 120000, 2000, 250000);
  if (!source) return [];

  const chunks = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(source.length, offset + limit);
    if (end < source.length) {
      const preferredBreak = source.lastIndexOf("\n\n", end);
      if (preferredBreak > offset + 1000) {
        end = preferredBreak;
      }
    }
    const chunk = source.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

function getSelectedJournalRefsFromRoot(root) {
  return Array.from(root?.querySelectorAll?.("input[name='journalEntries']:checked") || [])
    .map((input) => normalize(input.value))
    .filter(Boolean);
}

function getSelectedPlayersFromRoot(root) {
  return Array.from(root?.querySelectorAll?.("input[name='selectedPlayer']:checked") || [])
    .map((input) => normalize(input.value))
    .filter(Boolean);
}

function resolveJournalEntriesFromRefs(selectedRefs) {
  const selectedRefSet = new Set((selectedRefs || []).map((ref) => normalize(ref).toLowerCase()).filter(Boolean));
  return getJournalEntriesInTreeOrder().filter((entry) => {
    const refs = [entry.uuid, entry.id, entry.name].map((value) => normalize(value).toLowerCase()).filter(Boolean);
    return refs.some((ref) => selectedRefSet.has(ref));
  });
}

async function importJournalEntriesIntoContext(channelId, entries, setStatus) {
  const imported = [];
  const chronologicalEntries = Array.from(entries || []);
  const importEntries = [...chronologicalEntries].reverse();
  const totalEntries = chronologicalEntries.length;
  const entryOrderMap = new Map(chronologicalEntries.map((entry, index) => [entry.id, index + 1]));

  for (let entryIndex = 0; entryIndex < importEntries.length; entryIndex += 1) {
    const entry = importEntries[entryIndex];
    const chronologicalIndex = entryOrderMap.get(entry.id) || (totalEntries - entryIndex);
    const importText = buildJournalImportText(entry);
    const chunks = splitTextIntoImportChunks(importText);

    if (!chunks.length) continue;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const chunkLabel = chunks.length > 1 ? ` (part ${chunkIndex + 1}/${chunks.length})` : "";
      const sequenceLabel = `Journal ${chronologicalIndex}/${totalEntries}`;
      if (setStatus) {
        setStatus(`Importing ${sequenceLabel}: ${entry.name}${chunkLabel}...`);
      }

      log("Importing journal chunk", {
        entry: entry.name,
        entryIndex: chronologicalIndex,
        totalEntries,
        chunkIndex: chunkIndex + 1,
        totalChunks: chunks.length,
        chars: chunk.length
      });

      const payload = {
        channelId,
        contextChannelId: channelId,
        userId: getFoundryContextUserId(),
        subchannel: "foundry-journal-import",
        replaceContext: entryIndex === 0 && chunkIndex === 0,
        purgeWholeChannel: entryIndex === 0 && chunkIndex === 0,
        sticky: true,
        role: "user",
        entries: [{
          role: "user",
          sticky: true,
          content: `Campaign order: ${chronologicalIndex} of ${totalEntries}\nJournal import: ${entry.name}${chunkLabel}\n\n${chunk}`
        }]
      };

      const result = await importBotContextEntries(payload);
      const importedCount = Number(result?.importedCount || 0);
      if (importedCount > 0) {
        imported.push({
          entryName: entry.name,
          chunkIndex: chunkIndex + 1,
          totalChunks: chunks.length,
          chars: chunk.length
        });
      }

      await sleep(10);
    }
  }

  return imported;
}

function getPlayerBindingsFromRoot(root) {
  const bindings = {};
  for (const user of getPlayerUsers()) {
    const userId = String(user.id || "");
    const selected = root?.querySelector?.(`[name='selectedPlayer'][value='${userId}']`)?.checked === true;
    const actorId = normalize(root?.querySelector?.(`[name='binding-actor-${userId}']`)?.value || "");
    bindings[userId] = { selected, actorId };
  }
  return bindings;
}

async function importPlayerBindingsIntoContext(channelId, bindings, setStatus) {
  const imported = [];
  const users = getPlayerUsers();
  const rosterLines = [];

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const binding = bindings[user.id] || {};
    if (binding.selected !== true) continue;
    const actor = binding.actorId ? getActorByRef(binding.actorId) : (user.character || null);
    if (actor) {
      if (setStatus) setStatus(`Importing player binding ${index + 1}/${users.length}: ${user.name} -> ${actor.name}`);
      rosterLines.push([
        `Player: ${user.name}`,
        `Foundry user ID: ${user.id}`,
        "Source: Foundry actor",
        `Actor: ${actor.name}`,
        `Actor ID: ${actor.id}`,
        `Type: ${actor.type || "character"}`,
        `Race: ${actor.system?.details?.race || "-"}`,
        `Background: ${actor.system?.details?.background || "-"}`,
        `Level: ${actor.system?.details?.level ?? "-"}`,
        `AC: ${actor.system?.attributes?.ac?.value ?? "-"}`,
        `HP: ${actor.system?.attributes?.hp?.value ?? "-"}/${actor.system?.attributes?.hp?.max ?? "-"}`,
        `Passive Perception: ${actor.system?.skills?.prc?.passive ?? "-"}`
      ].join("\n"));
    } else {
      if (setStatus) setStatus(`Importing player binding ${index + 1}/${users.length}: ${user.name} -> missing Foundry actor`);
      rosterLines.push([
        `Player: ${user.name}`,
        `Foundry user ID: ${user.id}`,
        "Source: Foundry actor",
        "Actor: missing",
        "Actor ID: missing"
      ].join("\n"));
    }
    imported.push({ userName: user.name, source: "foundry" });
  }

  if (!rosterLines.length) return imported;

  const content = [
    "Party roster binding",
    `Party size: ${rosterLines.length}`,
    ...rosterLines.map((line, index) => `Member ${index + 1}\n${line}`)
  ].join("\n\n");

  const result = await importBotContextEntries({
    channelId,
    contextChannelId: channelId,
    userId: getFoundryContextUserId(),
    subchannel: "foundry-player-bindings",
    replaceContext: true,
    purgeWholeChannel: true,
    sticky: true,
    role: "user",
    entries: [{
      role: "user",
      sticky: true,
      content
    }]
  });

  if (Number(result?.importedCount || 0) <= 0) {
    return [];
  }

  return imported;
}

async function handleSelectedJournals(payload = {}) {
  const includeContent = payload?.includeContent !== false;
  const selectedRefs = new Set(getSelectedJournalEntries().map((value) => value.toLowerCase()));
  const entries = getJournalEntriesInTreeOrder()
    .filter((entry) => {
      const refs = [entry.uuid, entry.id, entry.name].map((value) => normalize(value).toLowerCase()).filter(Boolean);
      return refs.some((ref) => selectedRefs.has(ref));
    })
    .map((entry, index, all) => {
      const path = getEntryFolderPath(entry);
      const pages = getSortedPages(entry).map((page) => ({
        id: page.id,
        uuid: page.uuid,
        name: page.name,
        text: includeContent ? normalize(getPageText(page)) : undefined,
        chars: normalize(getPageText(page)).length
      }));
      return {
        order: index + 1,
        totalSelected: all.length,
        id: entry.id,
        uuid: entry.uuid,
        name: entry.name,
        folderPath: path,
        pageCount: pages.length,
        text: includeContent ? buildJournalImportText(entry) : undefined,
        chars: includeContent ? buildJournalImportText(entry).length : 0,
        pages
      };
    });

  return {
    ok: true,
    source: "foundry",
    action: "selectedjournals",
    count: entries.length,
    entries
  };
}

async function handleSelectedPlayers() {
  const selectedUsers = new Set(getSelectedPlayers().map((value) => value.toLowerCase()));
  const bindings = getPlayerBindings();
  const players = getPlayerUsers()
    .filter((user) => selectedUsers.has(String(user.id || "").toLowerCase()))
    .map((user) => {
      const binding = bindings[user.id] || {};
      const actor = binding.actorId ? getActorByRef(binding.actorId) : (user.character || null);
      return {
        userId: user.id,
        userName: user.name,
        characterName: normalize(actor?.name || ""),
        source: "foundry",
        actorId: actor?.id || normalize(binding.actorId || user.character?.id || ""),
        actorSummary: actor ? summarizeActor(actor) : null
      };
    });

  return {
    ok: true,
    source: "foundry",
    action: "selectedplayers",
    count: players.length,
    players
  };
}

function isPrimaryBridgeGm() {
  if (!game.user?.isGM) return false;
  const activeGms = Array.from(game.users ?? [])
    .filter((user) => user.isGM && user.active)
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  return activeGms[0]?.id === game.user.id;
}

function isBotGeneratedChatMessage(message) {
  return message?.getFlag?.(MODULE_ID, "botGenerated") === true;
}

function buildChatPayloadFromMessage(message) {
  const authorName = normalize(message?.speaker?.alias || message?.author?.name || "Player");
  const content = sanitizeFoundryRichText(message?.content || "");
  const flavor = sanitizeFoundryRichText(message?.flavor || "");
  const rollSummary = Array.from(message?.rolls ?? [])
    .map((roll) => `${roll.formula} = ${roll.total}`)
    .filter(Boolean)
    .join("; ");
  return normalize([
    `[authorName: ${authorName}]`,
    flavor,
    content,
    rollSummary ? `[Roll] ${rollSummary}` : ""
  ].filter(Boolean).join("\n"));
}

async function postFoundryBotMessages(messages = []) {
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((entry) => ({
      text: normalize(entry?.text || entry),
      alias: normalize(entry?.alias || "Dungeon Master")
    }))
    .filter((entry) => entry.text);

  for (const entry of cleanMessages) {
    const content = formatBotChatContent(entry.text);
    if (!content) continue;
    await ChatMessage.create({
      user: game.user?.id,
      speaker: { alias: entry.alias },
      content,
      flags: {
        [MODULE_ID]: {
          botGenerated: true
        }
      }
    });
  }
}

async function handleChatDrivenBotTurn(message) {
  if (!isPrimaryBridgeGm()) return;
  if (isBotGeneratedChatMessage(message)) return;
  if (message?.system === true) return;

  const channelId = normalize(getSetting(SETTING_KEYS.playChannelId) || getSetting(SETTING_KEYS.channelKey));
  if (!channelId) return;

  const result = await sendRoundInput({
    channelId,
    channelKey: normalize(getSetting(SETTING_KEYS.channelKey)),
    userId: getFoundryContextUserId(),
    authorUserId: normalize(message?.author?.id || message?.speaker?.actor || message?.speaker?.user),
    authorName: normalize(message?.speaker?.alias || message?.author?.name || "Player"),
    speakerAlias: normalize(message?.speaker?.alias || ""),
    speakerActorId: normalize(message?.speaker?.actor || ""),
    speakerUserId: normalize(message?.speaker?.user || message?.author?.id || ""),
    content: sanitizeFoundryRichText(message?.content || ""),
    rollSummary: Array.from(message?.rolls ?? []).map((roll) => `${roll.formula} = ${roll.total}`).join("; "),
    rolls: Array.from(message?.rolls ?? []).map((roll) => ({
      formula: roll.formula,
      total: roll.total
    }))
  });

  await postFoundryBotMessages(result?.messages || []);
}

function getApplicationRoot(app) {
  const direct = app?.element;
  if (direct?.querySelector) return direct;
  const jq0 = app?.element?.[0];
  if (jq0?.querySelector) return jq0;
  const legacy0 = app?._element?.[0];
  if (legacy0?.querySelector) return legacy0;
  return null;
}

class JennyLegacyGameMasterPanel extends Application {
  constructor(options = {}) {
    super(options);
    this._busy = false;
    this._statusText = getLocalized("JENNY_FOUNDRY_BRIDGE.UI.StatusReady");
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-gm-panel`,
      template: "modules/jenny-foundry-bridge/templates/jenny-gm-panel.hbs",
      title: getLocalized("JENNY_FOUNDRY_BRIDGE.UI.OpenPanel"),
      width: 720,
      height: 760,
      resizable: true,
      popOut: true
    });
  }

  async getData() {
    return {
      title: getLocalized("JENNY_FOUNDRY_BRIDGE.UI.OpenPanel"),
      userName: game.user?.name || "Unknown",
      channelId: normalize(getSetting(SETTING_KEYS.playChannelId) || getSetting(SETTING_KEYS.channelKey)),
      journalOptions: getJournalImportOptions(),
      playerBindings: getPlayerBindingRows(),
      busy: this._busy,
      statusText: this._statusText
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("button[data-action='refresh-panel']").on("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.render();
    });
    html.find("button[data-action='apply-session']").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.applySession();
    });
    html.find("button[data-action='end-campaign']").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      log("Jenny GM legacy click", { action: "end-campaign" });
      await this.endCampaign();
    });
  }

  async applySession() {
    if (this._busy) return;
    const root = getApplicationRoot(this);
    if (!root) return;

    const selectedJournalRefs = getSelectedJournalRefsFromRoot(root);
    const selectedPlayers = getSelectedPlayersFromRoot(root);
    const bindings = getPlayerBindingsFromRoot(root);

    this._busy = true;
    this._statusText = "Applying Foundry session...";
    await super.render(false);

    try {
      await saveSelectedJournalEntries(selectedJournalRefs);
      await saveSelectedPlayers(selectedPlayers);
      await savePlayerBindings(bindings);

      const channelId = normalize(getSetting(SETTING_KEYS.playChannelId) || getSetting(SETTING_KEYS.channelKey));
      const journalSelection = await handleSelectedJournals({ includeContent: true });
      const playerSelection = await handleSelectedPlayers();
      const result = await syncFoundrySession({
        channelId,
        channelKey: normalize(getSetting(SETTING_KEYS.channelKey)),
        userId: getFoundryContextUserId(),
        journals: Array.isArray(journalSelection?.entries) ? journalSelection.entries : [],
        players: Array.isArray(playerSelection?.players) ? playerSelection.players : []
      });

      await postFoundryBotMessages(result?.opener ? [{ text: result.opener }] : []);
      const journalCount = Number(journalSelection?.count || 0);
      const playerCount = Number(playerSelection?.count || 0);
      this._statusText = `Session applied with ${journalCount} journal${journalCount === 1 ? "" : "s"} and ${playerCount} player${playerCount === 1 ? "" : "s"}.`;
      ui.notifications?.info?.(this._statusText);
    } catch (error) {
      log("Session apply failed", error);
      this._statusText = `${getLocalized("JENNY_FOUNDRY_BRIDGE.UI.StatusError")}: ${error?.message || String(error)}`;
      ui.notifications?.error?.(this._statusText);
    } finally {
      this._busy = false;
      await super.render(false);
    }
  }

  async endCampaign() {
    if (this._busy) return;
    this._busy = true;
    this._statusText = "Ending campaign and clearing Foundry state...";
    await super.render(false);
    try {
      const channelId = normalize(getSetting(SETTING_KEYS.playChannelId) || getSetting(SETTING_KEYS.channelKey));
      const extraChannelIds = [
        getFoundrySpecialistChannel("campaign", channelId),
        getFoundrySpecialistChannel("party", channelId),
        getFoundrySpecialistChannel("ops", channelId),
        getFoundrySpecialistChannel("director", channelId),
        getFoundrySpecialistChannel("narrator", channelId)
      ];
      const result = await resetCampaignState({
        channelId,
        extraChannelIds,
        userId: getFoundryContextUserId()
      });
      await saveSelectedJournalEntries([]);
      await saveSelectedPlayers([]);
      this._statusText = `Campaign ended. Cleared ${Number(result?.purgedContextRows || 0)} context rows and removed ${Array.isArray(result?.deletedFiles) ? result.deletedFiles.length : 0} Foundry status files.`;
      ui.notifications?.info?.(this._statusText);
    } catch (error) {
      log("Campaign reset failed", error);
      this._statusText = `${getLocalized("JENNY_FOUNDRY_BRIDGE.UI.StatusError")}: ${error?.message || String(error)}`;
      ui.notifications?.error?.(this._statusText);
    } finally {
      this._busy = false;
      await super.render(false);
    }
  }
}

let gmPanel = null;

function openGameMasterPanel() {
  if (!gmPanel) gmPanel = new JennyLegacyGameMasterPanel();
  gmPanel.render(true);
  return gmPanel;
}

function installSettingsButton(app, html) {
  if (!game.user?.isGM) return;

  const root = html?.[0] || html;
  if (!root?.querySelector) return;
  if (root.querySelector(`.${MODULE_ID}-settings-button`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `jenny-open-panel-button ${MODULE_ID}-settings-button`;
  button.innerHTML = `<i class="fas fa-comments"></i> ${getLocalized("JENNY_FOUNDRY_BRIDGE.UI.OpenPanel")}`;
  button.title = getLocalized("JENNY_FOUNDRY_BRIDGE.UI.OpenPanelHint");
  button.addEventListener("click", () => openGameMasterPanel());

  const settingsRoot =
    root.querySelector("#settings-documentation") ||
    root.querySelector(".settings") ||
    root.querySelector(".directory-footer") ||
    root.querySelector("section");

  if (settingsRoot?.appendChild) {
    settingsRoot.appendChild(button);
  }
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEYS.channelKey, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.ChannelKey.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.ChannelKey.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "foundry"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.sharedSecret, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.SharedSecret.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.SharedSecret.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.transportMode, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.TransportMode.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.TransportMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      manual: "manual",
      socket: "socket",
      relay: "relay",
      polling: "polling"
    },
    default: "manual"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.botBaseUrl, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.BotBaseUrl.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.BotBaseUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.botApiSecret, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.BotApiSecret.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.BotApiSecret.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.playChannelId, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.PlayChannelId.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.PlayChannelId.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "foundry"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.contextLimit, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.ContextLimit.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.ContextLimit.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 20
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.pollIntervalMs, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.PollIntervalMs.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.PollIntervalMs.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1500
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.externalCharacters, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.ExternalCharacters.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.ExternalCharacters.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "[]"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.playerBindings, {
    scope: "world",
    config: false,
    type: String,
    default: "{}"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.selectedJournalEntries, {
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.selectedPlayers, {
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.emitChatRolls, {
    name: "JENNY_FOUNDRY_BRIDGE.Settings.EmitChatRolls.Name",
    hint: "JENNY_FOUNDRY_BRIDGE.Settings.EmitChatRolls.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

Hooks.once("init", () => {
  registerSettings();
  log("Initializing");
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      handleRequest,
      summarizeActor,
      getActorByRef,
      getExternalCharacterMap,
      openGameMasterPanel
    };
  }

  game.socket.on(SOCKET_NAME, async (request, callback) => {
    const response = await handleRequest(request);
    if (typeof callback === "function") callback(response);
  });

  Hooks.on("createChatMessage", (message) => {
    handleChatDrivenBotTurn(message).catch((error) => log("Chat-driven bot turn failed", error));
  });

  // Re-render the GM panel when actors are created or deleted so the dropdown stays current
  const refreshGmPanel = () => {
    Object.values(ui.windows || {}).forEach((app) => {
      if (app?.id === `${MODULE_ID}-gm-panel`) app.render();
    });
  };
  Hooks.on("createActor", refreshGmPanel);
  Hooks.on("deleteActor", refreshGmPanel);

  startPolling();
  log("Ready");
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  const tokenControls = controls.find((control) => control.name === "token") || controls[0];
  if (!tokenControls) return;
  if (!Array.isArray(tokenControls.tools)) tokenControls.tools = [];
  tokenControls.tools.push({
    name: "open-jenny-gm",
    title: getLocalized("JENNY_FOUNDRY_BRIDGE.UI.OpenPanel"),
    icon: "fas fa-comments",
    button: true,
    onClick: () => openGameMasterPanel()
  });
});

Hooks.on("renderSettings", (app, html) => {
  installSettingsButton(app, html);
});
