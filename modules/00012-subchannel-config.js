








/**************************************************************/
/* filename: "00012-subchannel-config.js"                    */
/* Version 1.0                                               */
/* Purpose: Subchannel runtime hook. Subchannels now scope    */
/*          context only and no longer load prompts from DB.  */
/**************************************************************/

const MODULE_NAME = "subchannel-config";


export default async function getSubchannelConfig(coreData) {
  const wo = coreData?.workingObject || {};

  const subchannel = typeof wo.subchannel === "string" ? wo.subchannel.trim() : "";
  if (!subchannel) return coreData;

  return coreData;
}
