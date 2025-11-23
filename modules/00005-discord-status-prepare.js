/**********************************************************************************************************************
/* filename: "discord-status-prepare.js"                                                                              *
/* Version 1.0                                                                                                        *
/* Purpose: Prepare AI prompt for Discord presence generation via core-ai-completions                                  *
/**********************************************************************************************************************/
/**********************************************************************************************************************
/*                                                                                                                    *
/**********************************************************************************************************************/

const MODULE_NAME = "discord-status-prepare";

/**********************************************************************************************************************
/* functionSignature: getPrefixedLogger (wo, moduleUrl)                                                               *
/* Returns a logger function that prefixes entries with module info, level, and metadata                               *
/**********************************************************************************************************************/
function getPrefixedLogger(wo, moduleUrl) {
  return function log(message, level = "info", meta = {}) {
    const prefix = `[${MODULE_NAME}]`;
    const where = moduleUrl ? String(moduleUrl) : "";
    const details = { ...meta, channelId: wo?.channelId, id: wo?.id };
    const entry = { level, message, where, ...details };
    try {
      const line = `${prefix} ${level.toUpperCase()}: ${message} ${JSON.stringify(entry)}`;
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else if (level === "debug") {
        console.debug(line);
      } else {
        console.log(line);
      }
    } catch {}
  };
}

/**********************************************************************************************************************
/* functionSignature: getStr (v, d)                                                                                   *
/* Returns a non-empty string or default                                                                              *
/**********************************************************************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/**********************************************************************************************************************
/* functionSignature: getCleanAllowedChannels (cfg)                                                                   *
/* Normalizes cfg.allowedChannels to a cleaned string array or null                                                   *
/**********************************************************************************************************************/
function getCleanAllowedChannels(cfg) {
  if (!Array.isArray(cfg?.allowedChannels)) return null;
  const cleaned = cfg.allowedChannels
    .map(v => String(v ?? "").trim())
    .filter(v => v.length > 0);
  return cleaned;
}

/**********************************************************************************************************************
/* functionSignature: getRandomChannel (list)                                                                         *
/* Returns one random element from a non-empty list                                                                   *
/**********************************************************************************************************************/
function getRandomChannel(list) {
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

/**********************************************************************************************************************
/* functionSignature: getDiscordStatusPrepareFlow (baseCore)                                                          *
/* Prepares workingObject for status generation using config.discord-status-prepare                                    *
/**********************************************************************************************************************/
export default async function getDiscordStatusPrepareFlow(baseCore) {
  const workingObject = baseCore.workingObject || (baseCore.workingObject = {});
  const log = getPrefixedLogger(workingObject, typeof import !== "undefined" ? import.meta.url : "");

  const config = baseCore?.config?.["discord-status-prepare"] || {};
  const allowedList = getCleanAllowedChannels(config);

  if (!allowedList || allowedList.length === 0) {
    workingObject.Response = "STOP";
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
  workingObject.channelId = targetChannel;

  workingObject.payload = prompt;
  workingObject.updateStatus = "true";
  workingObject.Tools = [];
  workingObject.doNotWriteToContext = true;

  log(
    `prepared status prompt (len=${prompt.length}) for randomly chosen channel ${targetChannel} (pool size=${allowedList.length})`,
    "debug",
    { moduleName: MODULE_NAME }
  );

  return baseCore;
}
