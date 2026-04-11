/**************************************************************/
/* filename: "00020-core-channel-gate.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/






import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "core-channel-gate";


export default async function getChannelGate(coreData) {
  const workingObject = coreData?.workingObject || {};
  const log = getPrefixedLogger(workingObject, import.meta.url);

  const channelId = String(workingObject?.channelId ?? "");
  const isAllowed = !!workingObject.channelAllowed;

  if (!isAllowed) {
    workingObject.stop = true;
    workingObject.stopReason = "channel_not_allowed";
    log("Channel not allowed → stop=true", "warn", { moduleName: MODULE_NAME, channelId });
  } else {
    log("Channel allowed → continue", "info", { moduleName: MODULE_NAME, channelId });
  }

  return coreData;
}
