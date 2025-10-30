/***************************************************************
/* filename: "getTime.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Return current UTC time (ISO 8601) as tool output  *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

const MODULE_NAME = "getTime";

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Returns { now: <ISO string> } in UTC                        *
/***************************************************************/
async function getInvoke(args, coreData) {
  const now = new Date().toISOString();
  return { now };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Return the current time in UTC (ISO 8601).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
