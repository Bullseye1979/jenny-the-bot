/****************************************************************************************************************
* filename: "core-admin-commands.js"                                                                           *
* Version 1.0                                                                                                  *
* Purpose: Generic "/..." admin commands for non-discord flows. Parses workingObject.payload for slash          *
*          commands, executes admin actions for CURRENT workingObject.id only, sets stop + response fields,     *
*          and returns.                                                                                        *
****************************************************************************************************************/

/****************************************************************************************************************
*                                                                                                              *
****************************************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { setPurgeContext, setFreezeContext } from "../core/context.js";

/****************************************************************************************************************
* functionSignature: getStr(value)                                                                             *
* Purpose: Returns a string; empty string for nullish values.                                                   *
****************************************************************************************************************/
function getStr(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}

/****************************************************************************************************************
* functionSignature: setStop(workingObject, responseText, responseValue?)                                      *
* Purpose: Marks the workingObject as stopped and sets response fields.                                         *
****************************************************************************************************************/
function setStop(workingObject, responseText, responseValue = "STOP") {
  workingObject.stop = true;

  const text = getStr(responseText);
  workingObject.response = text;
  workingObject.responseText = text;

  workingObject.response = getStr(responseValue);
}

/****************************************************************************************************************
* functionSignature: getSlashCommand(payload)                                                                  *
* Purpose: Parses and returns the slash command name from the payload or null.                                  *
****************************************************************************************************************/
function getSlashCommand(payload) {
  const s = getStr(payload).trim();
  if (!s.startsWith("/")) return null;

  const token = s.split(/\s+/g)[0] || "";
  const cmd = token.slice(1).trim().toLowerCase();

  return cmd || null;
}

/****************************************************************************************************************
* functionSignature: getCoreAdminCommands(coreData)                                                            *
* Purpose: Executes admin actions for the current id based on parsed slash commands.                            *
****************************************************************************************************************/
export default async function getCoreAdminCommands(coreData) {
  const workingObject = coreData?.workingObject || {};

  const log = getPrefixedLogger(workingObject, import.meta.url);
  void log;

  const payload = getStr(workingObject.payload).trim();
  if (!payload) return coreData;

  const cmd = getSlashCommand(payload);
  if (!cmd) return coreData;

  const id = getStr(workingObject.id).trim();
  if (!id) {
    setStop(workingObject, "admin command failed: missing id");
    return coreData;
  }

  workingObject.admin = { command: cmd, raw: payload };

  try {
    if (cmd === "purgedb") {
      const purgeWO = { ...workingObject, id };
      const deleted = await setPurgeContext(purgeWO);

      const deletedCount = Number.isFinite(deleted) ? Number(deleted) : 0;
      const countText = String(deletedCount);

      setStop(workingObject, countText, countText+" items removed ");
      return coreData;
    }

    if (cmd === "freeze") {
      const freezeWO = { ...workingObject, id };
      await setFreezeContext(freezeWO);

      setStop(workingObject, `freeze ok (id=${id})`);
      return coreData;
    }

    workingObject.admin = undefined;
    return coreData;
  } catch (e) {
    setStop(workingObject, `admin command failed: ${e?.message || String(e)}`);
    return coreData;
  }
}
