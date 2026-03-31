/************************************************************************************/
/* filename: 00035-bard-join.js                                                     */
/* Version 1.0                                                                      */
/* Purpose: Handles bardstart / bardstop across all configured flows.               */
/*          Creates or removes channel-based bard sessions (no voice channel        */
/*          required). Supports discord-admin (slash command), discord and webpage. */
/*                                                                                  */
/* Config (config["bard-join"]):                                                    */
/*   flow          — array of flow names to subscribe to (default: all three)      */
/*   commandPrefix — prefix char(s) for text flows (default: ["!", "/"])            */
/*   allowedRoles  — role/permission whitelist for non-admin flows (default: [])   */
/************************************************************************************/

import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME    = "bard-join";
const DEFAULT_PREFIX = ["!", "/"];


/* ── registry helpers ─────────────────────────────────────────────────────── */

async function getBardRegistry() {
  const key = "bard:registry";
  let reg = null;
  try { reg = await getItem(key); } catch { reg = null; }
  if (!reg || typeof reg !== "object" || !Array.isArray(reg.list)) {
    reg = { list: [] };
    try { await putItem(reg, key); } catch {}
  }
  return reg;
}

async function setAddBardSessionKey(sessionKey) {
  const key = "bard:registry";
  const reg = await getBardRegistry();
  if (!reg.list.includes(sessionKey)) {
    reg.list.push(sessionKey);
    try { await putItem(reg, key); } catch {}
  }
}

async function setRemoveBardSessionKey(sessionKey) {
  const key = "bard:registry";
  const reg = await getBardRegistry();
  reg.list = (reg.list || []).filter(k => k !== sessionKey);
  try { await putItem(reg, key); } catch {}
}


/* ── command detection ────────────────────────────────────────────────────── */

function getDetectCommand(wo, cfg) {
  // discord-admin: slash command
  if (wo.flow === "discord-admin" && wo.admin?.command) {
    const cmd = String(wo.admin.command).toLowerCase();
    if (cmd === "bardstart" || cmd === "bardstop") return cmd;
    return null;
  }

  // Text-based flows: check wo.message or wo.payload (api flow via webpage-chat proxy)
  const raw = String(wo.message || wo.payload || "").trim();
  if (!raw) return null;

  const prefixes = Array.isArray(cfg.commandPrefix) && cfg.commandPrefix.length
    ? cfg.commandPrefix
    : DEFAULT_PREFIX;

  const lower = raw.toLowerCase();
  for (const p of prefixes) {
    const pp = String(p).toLowerCase();
    if (lower.startsWith(pp + "bardstart")) return "bardstart";
    if (lower.startsWith(pp + "bardstop"))  return "bardstop";
  }
  // Also accept bare word (exact match)
  if (lower === "bardstart") return "bardstart";
  if (lower === "bardstop")  return "bardstop";

  return null;
}

function getChannelId(wo) {
  return String(wo?.admin?.channelId || wo?.channelID || "");
}


/* ── main export ──────────────────────────────────────────────────────────── */

export default async function getBardJoin(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  try {
    const cmd = getDetectCommand(wo, cfg);
    if (!cmd) return coreData;

    const channelId    = getChannelId(wo);
    const isAdminFlow  = wo.flow === "discord-admin";

    if (!channelId) {
      log("bardstart/bardstop failed: missing channelId", "error", { moduleName: MODULE_NAME, flow: wo.flow });
      wo.response = "";
      if (!isAdminFlow) wo.stop = true;
      return coreData;
    }

    const sessionKey = `bard:session:${channelId}`;
    let live = null;
    try { live = await getItem(sessionKey); } catch { live = null; }

    if (cmd === "bardstop") {
      try { if (live?._trackTimer) clearTimeout(live._trackTimer); } catch {}
      try { await deleteItem(sessionKey); } catch {}
      try { await deleteItem(`bard:labels:${channelId}`); } catch {}
      try { await deleteItem(`bard:lastrun:${channelId}`); } catch {}
      try { await deleteItem(`bard:nowplaying:${channelId}`); } catch {}
      try { await deleteItem(`bard:stream:${channelId}`); } catch {}
      await setRemoveBardSessionKey(sessionKey);
      log("bardstop: bard session terminated", "info", { moduleName: MODULE_NAME, channelId, flow: wo.flow });
      wo.response = isAdminFlow ? "" : "🎵 Bard stopped.";
      if (!isAdminFlow) wo.stop = true;
      return coreData;
    }

    // bardstart
    if (live) {
      try { if (live._trackTimer) clearTimeout(live._trackTimer); } catch {}
      try { await deleteItem(sessionKey); } catch {}
      await setRemoveBardSessionKey(sessionKey);
    }

    const liveSession = {
      textChannelId: channelId,
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try { await putItem(liveSession, sessionKey); } catch {}
    await setAddBardSessionKey(sessionKey);

    log("bardstart: bard session created", "info", {
      moduleName: MODULE_NAME, sessionKey, channelId, flow: wo.flow
    });

    wo.response = isAdminFlow ? "" : "🎵 Bard started.";
    if (!isAdminFlow) wo.stop = true;
    return coreData;

  } catch (e) {
    const elog = getPrefixedLogger(coreData?.workingObject || {}, import.meta.url);
    elog("bardstart/bardstop unexpected error", "error", { moduleName: MODULE_NAME, reason: e?.message });
    (coreData?.workingObject || {}).response = "";
    return coreData;
  }
}
