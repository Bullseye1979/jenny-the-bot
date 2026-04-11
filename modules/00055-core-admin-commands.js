/**************************************************************/
/* filename: "00055-core-admin-commands.js"                         */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/












import { getPrefixedLogger } from "../core/logging.js";
import { rebuildDerivedContextSet, setPurgeContext, setFreezeContext } from "../core/context.js";

const MODULE_NAME = "core-admin-commands";

function getStr(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return String(value); } catch { return ""; }
}

function setStop(workingObject, responseText, responseValue = "STOP") {
  workingObject.stop       = true;
  workingObject.stopReason = "admin_command_handled";
  const text = getStr(responseText);
  workingObject.response    = getStr(responseValue);
  workingObject.responseText = text;
}

function getSlashCommand(payload) {
  const s = getStr(payload).trim();
  if (!s.startsWith("/")) return null;
  const token = s.split(/\s+/g)[0] || "";
  const cmd = token.slice(1).trim().toLowerCase();
  return cmd || null;
}

function getIsDMContext(wo) {
  return !!(wo?.DM || wo?.isDM || wo?.channelType === 1 ||
            String(wo?.channelType ?? "").toUpperCase() === "DM" ||
            (!wo?.guildId && !!wo?.userId));
}


export default async function getCoreAdminCommands(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);
  const flow    = getStr(workingObject.flow);
  const payload = getStr(workingObject.payload).trim();

  if (flow === "discord-admin") {
    const cmd = getStr(workingObject.admin?.command).toLowerCase();
    if (cmd !== "purgedb" && cmd !== "freeze" && cmd !== "rebuilddb") return coreData;

    const id = getStr(workingObject.admin?.channelId || workingObject.channelId).trim();
    if (!id) {
      log("admin command failed", "error", { moduleName: MODULE_NAME, cmd, reason: "missing channel id" });
      workingObject.response = "";
      return coreData;
    }

    try {
      if (cmd === "purgedb") {
        const deleted = await setPurgeContext({ ...workingObject, channelId: id });
        log("db purge done", "info", { moduleName: MODULE_NAME, channelId: id, deleted });
        workingObject.response = "";
        return coreData;
      }
      if (cmd === "freeze") {
        await setFreezeContext({ ...workingObject, channelId: id });
        log("freeze done", "info", { moduleName: MODULE_NAME, channelId: id });
        workingObject.response = "";
        return coreData;
      }
      if (cmd === "rebuilddb") {
        const results = await rebuildDerivedContextSet({ ...workingObject, channelId: id });
        log("db rebuild done", "info", { moduleName: MODULE_NAME, channelId: id, rebuilt: results.length });
        workingObject.response = "";
        return coreData;
      }
    } catch (e) {
      log("admin command failed", "error", { moduleName: MODULE_NAME, cmd, reason: e?.message || String(e) });
      workingObject.response = "";
      return coreData;
    }
    return coreData;
  }

  if (flow === "discord") {
    if (!getIsDMContext(workingObject)) return coreData;
    if (!/^!(purgedb|rebuilddb)$/i.test(payload))   return coreData;

    const id = getStr(workingObject.channelId).trim();
    if (!id) {
      workingObject.response   = "STOP";
      workingObject.stop       = true;
      workingObject.stopReason = "admin_command_handled";
      return coreData;
    }

    try {
      if (/^!rebuilddb$/i.test(payload)) {
        const results = await rebuildDerivedContextSet({ ...workingObject, channelId: id });
        log("db rebuild done (DM)", "info", { moduleName: MODULE_NAME, channelId: id, rebuilt: results.length });
      } else {
        const deleted = await setPurgeContext({ ...workingObject, channelId: id });
        log("db purge done (DM)", "info", { moduleName: MODULE_NAME, channelId: id, deleted });
      }
    } catch (e) {
      log("db admin command failed (DM)", "error", { moduleName: MODULE_NAME, reason: e?.message || String(e) });
    }
    workingObject.response   = "STOP";
    workingObject.stop       = true;
    workingObject.stopReason = "admin_command_handled";
    return coreData;
  }

  if (!payload) return coreData;
  const cmd = getSlashCommand(payload);
  if (!cmd) return coreData;

  const id = getStr(workingObject.channelId).trim();
  if (!id) {
    setStop(workingObject, "admin command failed: missing id");
    return coreData;
  }

  workingObject.admin = { command: cmd, raw: payload };

  try {
    if (cmd === "purgedb") {
      const deleted = await setPurgeContext({ ...workingObject, channelId: id });
      const countText = String(Number.isFinite(deleted) ? deleted : 0);
      setStop(workingObject, countText, countText + " items removed");
      return coreData;
    }
    if (cmd === "freeze") {
      await setFreezeContext({ ...workingObject, channelId: id });
      setStop(workingObject, `freeze ok (id=${id})`);
      return coreData;
    }
    if (cmd === "rebuilddb") {
      const results = await rebuildDerivedContextSet({ ...workingObject, channelId: id });
      setStop(workingObject, `rebuild ok (${results.length} context scopes)`);
      return coreData;
    }
    workingObject.admin = undefined;
    return coreData;
  } catch (e) {
    setStop(workingObject, `admin command failed: ${e?.message || String(e)}`);
    return coreData;
  }
}
