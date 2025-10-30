/**************************************************************************************
/* filename: "discord-status.js"                                                      *
/* Version 1.0                                                                        *
/* Purpose: Flow that listens for a registry tool name change and updates Discord     *
/*          presence; optional random status lines configured ONLY via config         *
/**************************************************************************************/
/**************************************************************************************
/*                                                                                    *
/**************************************************************************************/

import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-status";
const REGISTRY_KEY = "status:tool";
const CLIENT_REF  = "discord:client";

/**************************************************************************************
/* functionSignature: getPresenceText (toolName, mapping)                              *
/* Resolves presence text using a mapping or default template                          *
/**************************************************************************************/
function getPresenceText(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}

/**************************************************************************************
/* functionSignature: getNum (v, d)                                                    *
/* Returns a finite number or the provided default                                     *
/**************************************************************************************/
function getNum(v, d) { return Number.isFinite(v) ? Number(v) : d; }

/**************************************************************************************
/* functionSignature: getStr (v, d)                                                    *
/* Returns a non-empty string or the provided default                                  *
/**************************************************************************************/
function getStr(v, d) { return (typeof v === "string" && v.length) ? v : d; }

/**************************************************************************************
/* functionSignature: getBool (v, d)                                                   *
/* Returns a boolean or the provided default                                           *
/**************************************************************************************/
function getBool(v, d){ return (typeof v === "boolean") ? v : d; }

/**************************************************************************************
/* functionSignature: pickRandom (list, last)                                          *
/* Picks a random string from list, avoiding repeating the last when possible          *
/**************************************************************************************/
function pickRandom(list, last = "") {
  const L = Array.isArray(list) ? list.filter(s => typeof s === "string" && s.trim().length) : [];
  if (!L.length) return "";
  let s = L[Math.floor(Math.random() * L.length)];
  if (L.length > 1 && s === last) {
    s = L[(Math.floor(Math.random() * (L.length - 1)) + 1) % L.length];
  }
  return s;
}

/**************************************************************************************
/* functionSignature: addJitter (ms, pct)                                              *
/* Adds +/- pct jitter to a base duration in milliseconds                              *
/**************************************************************************************/
function addJitter(ms, pct = 0.2) {
  const p = Math.max(0, Math.min(0.9, pct));
  const delta = Math.round(ms * p);
  return Math.max(1000, ms + Math.floor((Math.random() * 2 - 1) * delta));
}

/**************************************************************************************
/* functionSignature: setApplyPresence (client, text, status)                          *
/* Applies presence to the Discord client                                              *
/**************************************************************************************/
async function setApplyPresence(client, text, status = "online") {
  if (!client || !client.user || typeof client.user.setPresence !== "function") return false;
  const activities = text ? [{ type: 4, name: text }] : [];
  try {
    await client.user.setPresence({ activities, status });
    return true;
  } catch {
    return false;
  }
}

/**************************************************************************************
/* functionSignature: getStartWatcher (cfg, log)                                       *
/* Starts polling registry and updates presence; mapping has precedence                 *
/**************************************************************************************/
function getStartWatcher(cfg, log) {
  const mapping = cfg?.mapping || {};
  const status  = getStr(cfg?.status, "online");
  const pollMs  = Math.max(100, getNum(cfg?.pollMs, 300));

  const randomEnabled    = getBool(cfg?.randomEnabled, true);
  const randomLines      = Array.isArray(cfg?.randomLines) ? cfg.randomLines.filter(s => typeof s === "string" && s.trim().length) : [];
  const randomIntervalMs = Math.max(5000, getNum(cfg?.randomIntervalMs, 60000));
  const randomJitterPct  = Math.max(0, Math.min(0.9, getNum(cfg?.randomJitterPct, 0.25)));

  let lastToolName      = "__init__";
  let lastClientId      = "__none__";
  let lastPresenceText  = "";
  let nextRandomDueAt   = Date.now() + addJitter(randomIntervalMs, randomJitterPct);

  async function tick() {
    try {
      const client   = await getItem(CLIENT_REF);
      const tool     = await getItem(REGISTRY_KEY);
      const toolName = typeof tool === "string" ? tool : (tool?.name || "");
      const hasTool  = !!String(toolName || "").trim();

      let text = "";
      if (hasTool) {
        text = getPresenceText(toolName, mapping);
      } else if (randomEnabled && randomLines.length > 0) {
        const now = Date.now();
        const toolCleared = !!lastToolName && lastToolName !== "__init__";
        const needImmediate = toolCleared || !lastPresenceText;
        if (needImmediate || now >= nextRandomDueAt) {
          text = pickRandom(randomLines, lastPresenceText);
          nextRandomDueAt = now + addJitter(randomIntervalMs, randomJitterPct);
        } else {
          text = lastPresenceText;
        }
      } else {
        text = "";
      }

      const cid = client?.user?.id || "unknown";
      const changed = (toolName !== lastToolName) || (cid !== lastClientId) || (text !== lastPresenceText);

      if (changed) {
        const ok = await setApplyPresence(client, text, status);
        if (ok) {
          log(`presence set → "${text || "idle"}"`, "info", { moduleName: MODULE_NAME });
          lastToolName     = toolName;
          lastClientId     = cid;
          lastPresenceText = text;
        }
      }
    } catch (e) {
      log("presence update failed", "error", { moduleName: MODULE_NAME, error: e?.message || String(e) });
    } finally {
      setTimeout(tick, pollMs);
    }
  }

  setTimeout(tick, 0);
}

/**************************************************************************************
/* functionSignature: getDiscordStatusFlow (baseCore, runFlow, createRunCore)         *
/* Entry point: starts watcher to update presence based on registry                    *
/**************************************************************************************/
export default async function getDiscordStatusFlow(baseCore, runFlow, createRunCore) {
  const rc  = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || {};
  getStartWatcher(cfg, log);
}
