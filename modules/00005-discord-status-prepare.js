/************************************************************************************
/* filename: discord-status-prepare.js                                             *
/* Version 1.0                                                                     *
/* Purpose: Prepare AI prompt for Discord presence generation via core-completions *
/************************************************************************************/
/************************************************************************************/
/************************************************************************************/

const MODULE_NAME = "discord-status-prepare";

/************************************************************************************
/* functionSignature: getPrefixedLogger (wo, moduleUrl)                            *
/* Returns a logger function with prefixed module info and metadata                *
/************************************************************************************/
function getPrefixedLogger(wo, moduleUrl) {
  return function log(message, level = "info", meta = {}) {
    const prefix = `[${MODULE_NAME}]`;
    const where = moduleUrl ? String(moduleUrl) : "";
    const details = { ...meta, channelID: wo?.channelID };
    const entry = { level, message, where, ...details };
  };
}

/************************************************************************************
/* functionSignature: getStr (v, d)                                                *
/* Returns v when it is a non-empty string; otherwise returns d                    *
/************************************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/************************************************************************************
/* functionSignature: getCleanAllowedChannels (cfg)                                *
/* Normalizes cfg.allowedChannels to a trimmed string array or null                *
/************************************************************************************/
function getCleanAllowedChannels(cfg) {
  if (!Array.isArray(cfg?.allowedChannels)) return null;
  const cleaned = cfg.allowedChannels
    .map(v => String(v ?? "").trim())
    .filter(v => v.length > 0);
  return cleaned;
}

/************************************************************************************
/* functionSignature: getRandomChannel (list)                                      *
/* Returns one random element from a non-empty array                               *
/************************************************************************************/
function getRandomChannel(list) {
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

/************************************************************************************
/* functionSignature: getDiscordStatusPrepareFlow (baseCore)                       *
/* Prepares workingObject for Discord status generation from configuration         *
/************************************************************************************/
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
  workingObject.channelID = targetChannel;

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
