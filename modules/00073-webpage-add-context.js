/************************************************************************************/
/* filename: 00073-webpage-add-context.js                                           */
/* Version 1.0                                                                      */
/* Purpose: Append the current webpage user payload to the DB context with          */
/*          role=user. Called directly from webpage-chat before any AI module       */
/*          runs, so context writing is independent of the AI path chosen.          */
/*          userId is resolved by context.js from wo.webAuth.userId automatically.  */
/************************************************************************************/

import { setContext } from "../core/context.js";


export async function getWebpageAddContext(wo, channelID, subchannelId, payload) {
  if (!wo.db || !channelID || !payload) return;

  const contextWo = {
    ...wo,
    channelID,
    subchannel: subchannelId || null
  };

  const record = {
    ts:         String(wo.timestamp || ""),
    role:       "user",
    turn_id:    typeof wo.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined,
    content:    String(payload),
    authorName: String(wo.webAuth?.username || wo.webAuth?.displayName || ""),
    channelId:  String(channelID),
    messageId:  "",
    source:     "webpage-chat"
  };

  try {
    await setContext(contextWo, record);
  } catch {}
}
