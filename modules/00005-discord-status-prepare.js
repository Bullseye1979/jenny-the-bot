/**************************************************************/
/* filename: "00005-discord-status-prepare.js"                      */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/






import { getPrefixedLogger } from "../core/logging.js";
import { getStr } from "../core/utils.js";

const MODULE_NAME = "discord-status-prepare";


function getCleanAllowedChannels(cfg) {
  if (!Array.isArray(cfg?.allowedChannels)) return null;
  const cleaned = cfg.allowedChannels
    .map(v => String(v ?? "").trim())
    .filter(v => v.length > 0);
  return cleaned;
}


function getRandomChannel(list) {
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}


export default async function getDiscordStatusPrepareFlow(baseCore) {
  baseCore = baseCore || {};
  const workingObject = baseCore.workingObject || (baseCore.workingObject = {});

  let moduleUrl = MODULE_NAME;
  try {
    if (import.meta && import.meta.url) {
      moduleUrl = import.meta.url;
    }
  } catch {}

  const log = getPrefixedLogger(workingObject, moduleUrl);

  const cfgRoot = baseCore.config || workingObject.config || {};
  const config = cfgRoot["discord-status-prepare"] || {};
  const allowedList = getCleanAllowedChannels(config);

  if (!allowedList || allowedList.length === 0) {
    workingObject.response = "STOP";
    workingObject.stop = true;
    log("allowedChannels empty or not configured → set STOP and abort", "info", { moduleName: MODULE_NAME });
    return baseCore;
  }

  const prompt = getStr(config.prompt, "").trim();
  if (!prompt) {
    log("no prompt configured in config.discord-status-prepare.prompt; skipping", "warn", { moduleName: MODULE_NAME });
    return baseCore;
  }

  const targetChannel = getRandomChannel(allowedList);

  workingObject.id = targetChannel;
  workingObject.channelId = targetChannel;

  workingObject.payload = prompt;
  workingObject.updateStatus = "true";

  workingObject.tools = [];
  workingObject.doNotWriteToContext = true;

  log(
    `prepared status prompt (len=${prompt.length}) for randomly chosen channel ${targetChannel} (pool size=${allowedList.length})`,
    "debug",
    { moduleName: MODULE_NAME }
  );

  return baseCore;
}
