/**************************************************************/
/* filename: "getFoundryOps.js"                              */
/* Version 1.0                                               */
/* Purpose: Run low-context Foundry operational tasks.       */
/**************************************************************/

import { invokeFoundrySpecialist } from "./_foundry-specialist-client.js";

const MODULE_NAME = "getFoundryOps";

async function getInvoke(args, coreData) {
  return invokeFoundrySpecialist("ops", args, coreData, {
    timeoutMs: 300000,
    doNotWriteToContext: true
  });
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
