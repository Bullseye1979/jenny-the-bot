/**********************************************************************************/
/* filename: getTime.js                                                            *
/* Version 1.0                                                                     *
/* Purpose: Return current UTC time (ISO 8601) as tool output.                     *
/**********************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getTime";


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const now = new Date().toISOString();
  return { now };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
