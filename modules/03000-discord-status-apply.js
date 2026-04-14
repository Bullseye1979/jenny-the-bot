/**************************************************************/
/* filename: "03000-discord-status-apply.js"                        */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/





import * as registry from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getStr, getNum } from "../core/utils.js";

const MODULE_NAME = "discord-status-apply";
const REGISTRY_TOOL_KEY = "status:tool";
const REGISTRY_AI_KEY = "status:ai";
const CLIENT_REF = "discord:client";

const getItem = registry.getItem;
const setItem = typeof registry.setItem === "function" ? registry.setItem : null;


function getBool(v, d) {
  return typeof v === "boolean" ? v : d;
}


async function getToolStatusFromRegistry() {
  if (typeof getItem !== "function") {
    return { hasTool: false, toolName: "", toolFlow: "", toolScope: "" };
  }
  try {
    const tool = await getItem(REGISTRY_TOOL_KEY);
    const scopedKey = typeof tool === "object" && tool
      ? String(tool.statusKey || tool.channelId || (String(tool.flow || "").trim() === "discord" ? "discord" : "")).trim()
      : "";
    const scopedTool = scopedKey ? await getItem(REGISTRY_TOOL_KEY + ":" + scopedKey) : null;
    const effectiveTool = scopedTool || tool;
    const name = typeof effectiveTool === "string" ? effectiveTool : (effectiveTool?.name || "");
    const toolName = String(name || "").trim();
    const toolFlow = typeof effectiveTool === "object" && effectiveTool ? String(effectiveTool.flow || "") : "";
    const toolScope = typeof effectiveTool === "object" && effectiveTool ? String(effectiveTool.scope || "") : "";
    return { hasTool: !!toolName, toolName, toolFlow, toolScope };
  } catch {
    return { hasTool: false, toolName: "", toolFlow: "", toolScope: "" };
  }
}


function getPresenceTextForTool(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}


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


function getStatusFromResponse(resp, maxChars) {
  let t = String(resp || "").trim();
  if (!t) return "";
  if (/^\[empty(\s+ai)?\s+response\]$/i.test(t)) return "...";
  const firstLine = t.split(/\r?\n/)[0].trim();
  const unquoted = firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!maxChars || maxChars <= 0) return unquoted;
  return unquoted.length > maxChars ? unquoted.slice(0, maxChars).trim() : unquoted;
}


let lastUpdateAt = 0;
let lastAiStatusInMemory = "";

export default async function getDiscordStatusApplyFlow(baseCore) {
  const wo = baseCore.workingObject || (baseCore.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg = baseCore?.config?.[MODULE_NAME] || {};

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

  const { hasTool, toolName, toolFlow, toolScope } = await getToolStatusFromRegistry();
  const effectiveToolScope = String(toolScope || toolFlow || "");
  const allowedScopes = Array.isArray(cfg.allowedScopes) ? cfg.allowedScopes : [];
  const allowedFlows = Array.isArray(cfg.allowedFlows) ? cfg.allowedFlows : [];
  const hasExplicitScopeFilter = allowedScopes.length > 0;
  const toolAllowed = hasTool && (
    hasExplicitScopeFilter
      ? allowedScopes.includes(effectiveToolScope)
      : (allowedFlows.length === 0 || allowedFlows.includes(effectiveToolScope))
  );

  if (toolAllowed) {
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
