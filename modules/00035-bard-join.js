/************************************************************************************/
/* filename: 00035-bard-join.js                                                            *
/* Version 1.0                                                                       *
/* Purpose: Handles /bardstart and /bardstop in the discord-admin flow.             *
/*          Creates or removes headless bard sessions (no voice channel required).  *
/************************************************************************************/

import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-join";


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


export default async function getBardAdminJoin(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    if (wo?.flow !== "discord-admin") return coreData;

    const cmd = String(wo?.admin?.command || "").toLowerCase();
    if (cmd !== "bardstart" && cmd !== "bardstop") return coreData;

    const guildId       = String(wo?.admin?.guildId   || "");
    const textChannelId = String(wo?.admin?.channelId || wo?.channelID || "");

    if (!guildId) {
      log("bardstart/bardstop failed: missing guildId", "error", { moduleName: MODULE_NAME });
      wo.response = "";
      return coreData;
    }

    const sessionKey = `bard:session:${guildId}`;
    let live = null;
    try { live = await getItem(sessionKey); } catch { live = null; }

    if (cmd === "bardstop") {
      try { if (live?._trackTimer) clearTimeout(live._trackTimer); } catch {}
      try { await deleteItem(sessionKey); } catch {}
      try { await deleteItem(`bard:labels:${guildId}`); } catch {}
      try { await deleteItem(`bard:lastrun:${guildId}`); } catch {}
      try { await deleteItem(`bard:nowplaying:${guildId}`); } catch {}
      try { await deleteItem(`bard:stream:${guildId}`); } catch {}
      await setRemoveBardSessionKey(sessionKey);
      log("bardstop: bard session terminated", "info", { moduleName: MODULE_NAME, guildId });
      wo.response = "";
      return coreData;
    }

    if (live) {
      try { if (live._trackTimer) clearTimeout(live._trackTimer); } catch {}
      try { await deleteItem(sessionKey); } catch {}
      await setRemoveBardSessionKey(sessionKey);
    }

    const liveSession = {
      guildId,
      textChannelId,
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try { await putItem(liveSession, sessionKey); } catch {}
    await setAddBardSessionKey(sessionKey);

    log("bardstart: bard session created", "info", {
      moduleName: MODULE_NAME,
      sessionKey,
      guildId,
      textChannelId
    });

    wo.response = "";
    return coreData;

  } catch (e) {
    const elog = getPrefixedLogger(coreData?.workingObject || {}, import.meta.url);
    elog("bardstart/bardstop unexpected error", "error", { moduleName: MODULE_NAME, reason: e?.message });
    (coreData?.workingObject || {}).response = "";
    return coreData;
  }
}
