/**************************************************************/
/* filename: "submitFinalAnswer.js"                          */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/*                                                           */
/* Called by orchestrator agents when they have finished     */
/* synthesising all specialist results and are ready to      */
/* deliver the final response to the user.                   */
/* Setting wo.__finalAnswer signals the poll-helper to       */
/* forward the response instead of discarding it.           */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { logSubagent }       from "../core/subagent-logger.js";

const MODULE_NAME = "submitFinalAnswer";

async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo  = coreData?.workingObject || {};

  const response = String(args?.response || "").trim();

  if (!response) {
    logSubagent("warn", MODULE_NAME, "invoke_rejected", { reason: "response_empty" });
    return { ok: false, error: "response is required — provide the full synthesised answer as the response parameter." };
  }

  logSubagent("info", MODULE_NAME, "invoke_called", {
    responseLen: response.length,
    responsePreview: response.slice(0, 120),
  });

  // Signal to runParentChain that this orchestrator run produced a deliverable answer.
  wo.__finalAnswer = response;

  log(`Final answer registered (${response.length} chars)`);
  logSubagent("info", MODULE_NAME, "final_answer_set", { responseLen: response.length });

  return {
    ok: true,
    message: "Final answer accepted. Delivery will proceed after this tool call completes.",
    _meta: { event: "final_answer_submitted", visibility: "internal" }
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
