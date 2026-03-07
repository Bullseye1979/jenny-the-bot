/****************************************************************************************************************
 * filename: bard-voice-gate.js
 * version: 1.0
 * purpose: Gates the discord-voice flow before the gdpr-gate.
 *          If the speaking user is the Bard bot itself (playing music into the channel),
 *          the pipeline is stopped gracefully so the audio is not transcribed by Jenny.
 ****************************************************************************************************************/

/****************************************************************************************************************
 * versioning:
 ****************************************************************************************************************/

import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "bard-voice-gate";

/****************************************************************************************************************
 * functionSignature: getBardVoiceGate(coreData)
 * purpose: Stops the discord-voice pipeline if the speaker is the Bard bot.
 ****************************************************************************************************************/
export default async function getBardVoiceGate(coreData) {
  const wo = coreData?.workingObject || {};

  if (String(wo?.flow || "") !== "discord-voice") return coreData;

  const speakerId = String(wo?.userId || "");
  if (!speakerId) return coreData;

  let bardClient = null;
  try { bardClient = await getItem("bard:client"); } catch { bardClient = null; }

  if (!bardClient?.user?.id) return coreData;

  if (speakerId === String(bardClient.user.id)) {
    const log = getPrefixedLogger(wo, import.meta.url);
    log("bard voice gate: skipping bard bot audio", "info", { moduleName: MODULE_NAME, speakerId });
    wo.stop = true;
  }

  return coreData;
}
