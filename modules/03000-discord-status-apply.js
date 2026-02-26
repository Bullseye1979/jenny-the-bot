/**********************************************************************************************************************
/* filename: "discord-status-apply.js"                                                                                *
/* Version 1.0                                                                                                        *
/* Purpose: Apply Discord presence using AI-generated status in workingObject.response                                *
/**********************************************************************************************************************/
/**********************************************************************************************************************
/*                                                                                                                    *
/**********************************************************************************************************************/

import * as registry from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-status-apply";
const REGISTRY_TOOL_KEY = "status:tool";
const REGISTRY_AI_KEY = "status:ai";
const CLIENT_REF = "discord:client";

const getItem = registry.getItem;
const setItem = typeof registry.setItem === "function" ? registry.setItem : null;

/**********************************************************************************************************************
/* functionSignature: getStr (v, d)                                                                                   *
/* Returns a non-empty string or default                                                                              *
/**********************************************************************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/**********************************************************************************************************************
/* functionSignature: getNum (v, d)                                                                                   *
/* Parses a number or returns default                                                                                 *
/**********************************************************************************************************************/
function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**********************************************************************************************************************
/* functionSignature: getBool (v, d)                                                                                  *
/* Returns a boolean or default                                                                                       *
/**********************************************************************************************************************/
function getBool(v, d) {
  return typeof v === "boolean" ? v : d;
}

/**********************************************************************************************************************
/* functionSignature: getToolStatusFromRegistry ()                                                                    *
/* Reads current tool status from registry                                                                            *
/**********************************************************************************************************************/
async function getToolStatusFromRegistry() {
  if (typeof getItem !== "function") {
    return { hasTool: false, toolName: "" };
  }
  try {
    const tool = await getItem(REGISTRY_TOOL_KEY);
    const name = typeof tool === "string" ? tool : tool?.name || "";
    const toolName = String(name || "").trim();
    return { hasTool: !!toolName, toolName };
  } catch {
    return { hasTool: false, toolName: "" };
  }
}

/**********************************************************************************************************************
/* functionSignature: getPresenceTextForTool (toolName, mapping)                                                      *
/* Maps tool name to presence text or builds a default                                                                *
/**********************************************************************************************************************/
function getPresenceTextForTool(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}

/**********************************************************************************************************************
/* functionSignature: setDiscordPresence (text, status, log)                                                          *
/* Sets Discord user presence via client from registry                                                                *
/**********************************************************************************************************************/
let lastPresenceText = "";
async function setDiscordPresence(text, status, log) {
  if (typeof getItem !== "function") {
    log("registry.getItem not available; cannot resolve discord client", "error", { moduleName: MODULE_NAME });
    return;
  }
  let client;
  try {
    client = await getItem(CLIENT_REF);
  } catch (e) {
    log(`failed to get discord client from registry: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
    return;
  }
  if (!client?.user || typeof client.user.setPresence !== "function") {
    log("no valid discord client available; cannot set presence", "debug", { moduleName: MODULE_NAME });
    return;
  }
  const presenceText = getStr(text, "").trim() || " ";
  const presenceStatus = getStr(status, "online");
  if (presenceText === lastPresenceText) {
    log(`presence unchanged → "${presenceText}" [${presenceStatus}]`, "debug", { moduleName: MODULE_NAME });
    return;
  }
  try {
    await client.user.setPresence({ status: presenceStatus, activities: [{ name: presenceText, type: 0 }] });
    lastPresenceText = presenceText;
    log(`set presence to: "${presenceText}" [${presenceStatus}]`, "info", { moduleName: MODULE_NAME });
  } catch (e) {
    log(`failed to set Discord presence: ${e?.message || String(e)}`, "error", { moduleName: MODULE_NAME });
  }
}

/**********************************************************************************************************************
/* functionSignature: getStatusFromResponse (resp, maxChars)                                                          *
/* Extracts a single short status line from workingObject.response                                                    *
/**********************************************************************************************************************/
function getStatusFromResponse(resp, maxChars) {
  let t = String(resp || "").trim();
  if (!t) return "";
  const firstLine = t.split(/\r?\n/)[0].trim();
  const unquoted = firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!maxChars || maxChars <= 0) return unquoted;
  return unquoted.length > maxChars ? unquoted.slice(0, maxChars).trim() : unquoted;
}

/**********************************************************************************************************************
/* functionSignature: getDiscordStatusApplyFlow (baseCore)                                                            *
/* Flow entry: reads AI-generated response and updates Discord presence                                               *
/**********************************************************************************************************************/
let lastUpdateAt = 0;
let lastAiStatusInMemory = "";

export default async function getDiscordStatusApplyFlow(baseCore) {
  const wo = baseCore.workingObject || (baseCore.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg =
    baseCore?.config?.["discord-status-apply"] ||
    baseCore?.config?.["discord-status-set"] ||
    baseCore?.config?.["cron-discord-status"] ||
    {};

  const now = Date.now();
  const updateStatusFlag = String(wo.updateStatus || "").toLowerCase() === "true";

  const placeholderEnabled = getBool(cfg.placeholderEnabled, true);
  const placeholderText = getStr(cfg.placeholderText, " // xbullseyegaming.de // ");
  const status = getStr(cfg.status, "online");
  const mapping = cfg.mapping || {};
  const minUpdateGapMs = getNum(cfg.minUpdateGapMs, 30000);

  if (!updateStatusFlag && now - lastUpdateAt < minUpdateGapMs) {
    log(`skip presence update (minUpdateGapMs=${minUpdateGapMs} not reached)`, "debug", { moduleName: MODULE_NAME });
    return;
  }

  const { hasTool, toolName } = await getToolStatusFromRegistry();

  if (hasTool) {
    const mappedText = getPresenceTextForTool(toolName, mapping);
    await setDiscordPresence(mappedText, status, log);
    lastUpdateAt = now;
    return;
  }

  const maxChars = getNum(cfg?.aiGenerator?.maxChars ?? cfg.maxChars, 40);

  let aiStatus = getStatusFromResponse(wo.response, maxChars);

  if (!aiStatus) {
    let regVal = "";
    if (typeof getItem === "function") {
      try {
        const rv = await getItem(REGISTRY_AI_KEY);
        if (rv) regVal = getStr(rv, "");
      } catch {}
    }
    aiStatus = getStr(aiStatus || regVal || lastAiStatusInMemory, "");
  }

  if (aiStatus) {
    lastAiStatusInMemory = aiStatus;
    if (setItem) {
      try {
        await setItem(REGISTRY_AI_KEY, aiStatus);
      } catch (e) {
        log(`failed to store AI status in registry: ${e?.message || String(e)}`, "warn", { moduleName: MODULE_NAME });
      }
    }
    await setDiscordPresence(aiStatus, status, log);
    lastUpdateAt = now;
  } else if (placeholderEnabled) {
    await setDiscordPresence(placeholderText, status, log);
    lastUpdateAt = now;
  } else {
    log("no status to set (response empty, placeholder disabled)", "debug", { moduleName: MODULE_NAME });
  }
}
