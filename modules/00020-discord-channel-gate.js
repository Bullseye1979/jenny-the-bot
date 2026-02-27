/***************************************************************
/* filename: "discord-channel-gate.js"                         *
/* Version 1.0                                                 *
/* Purpose: Stop flow when a channel is not allowed and log it *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-channel-gate";

/***************************************************************
/* functionSignature: getChannelGate (coreData)                *
/* Sets stop=true when channel is not allowed; logs outcome    *
/***************************************************************/
export default async function getChannelGate(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const channelId = String(workingObject?.channelID ?? "");
  const isAllowed = !!workingObject.channelallowed;

  if (!isAllowed) {
    workingObject.stop = true;
    log("Channel not allowed → stop=true", "warn", { moduleName: MODULE_NAME, channelId });
  } else {
    log("Channel allowed → continue", "info", { moduleName: MODULE_NAME, channelId });
  }

  return coreData;
}
