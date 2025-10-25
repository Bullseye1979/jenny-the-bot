/***************************************************************
/* filename: "01050-discord-status.js"                         *
/* Version 1.0                                                 *
/* Purpose: Flow that listens for a registry tool name change  *
/*          and updates Discord presence every 0.3 seconds     *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-status";
const REGISTRY_KEY = "status:tool";
const CLIENT_REF = "discord:client";

/***************************************************************
/* functionSignature: getPresenceText (toolName, mapping)      *
/* Resolves presence text using mapping or a default template  *
/***************************************************************/
function getPresenceText(toolName, mapping) {
  const name = String(toolName || "").trim();
  if (!name) return "";
  if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, name)) {
    return String(mapping[name]);
  }
  return `Working: ${name}`;
}

/***************************************************************
/* functionSignature: setApplyPresence (client, text, status)  *
/* Applies presence to the Discord client                      *
/***************************************************************/
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

/***************************************************************
/* functionSignature: getStartWatcher (cfg, log)               *
/* Starts a 0.3s change-triggered watcher over registry value  *
/***************************************************************/
function getStartWatcher(cfg, log) {
  const mapping = cfg?.mapping || {};
  const status = typeof cfg?.status === "string" && cfg.status ? cfg.status : "online";
  const pollMsCfg = Number.isFinite(cfg?.pollMs) ? Number(cfg.pollMs) : 300;
  const pollMs = Math.max(300, pollMsCfg);
  let lastValue = "__init__";
  let lastClientId = "__none__";

  async function tick() {
    try {
      const client = await getItem(CLIENT_REF);
      const tool = await getItem(REGISTRY_KEY);
      const value = typeof tool === "string" ? tool : (tool?.name || "");
      const text = getPresenceText(value, mapping);
      const cid = client?.user?.id || "unknown";
      if (value !== lastValue || cid !== lastClientId) {
        const ok = await setApplyPresence(client, text, status);
        if (ok) {
          log(`presence set → "${text || "idle"}"`, "info", { moduleName: MODULE_NAME });
          lastValue = value;
          lastClientId = cid;
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

/***************************************************************
/* functionSignature: getDiscordStatusFlow (base, run, make)   *
/* Flow entry: watch registry key and update presence          *
/***************************************************************/
export default async function getDiscordStatusFlow(baseCore, runFlow, createRunCore) {
  const rc = createRunCore();
  const log = getPrefixedLogger(rc.workingObject, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || {};
  getStartWatcher(cfg, log);
}
