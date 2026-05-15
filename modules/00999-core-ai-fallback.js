/**************************************************************/
/* filename: "00999-core-ai-fallback.js"                     */
/* Version 1.0                                               */
/* Purpose: Resolve AI fallback before any AI module runs.   */
/**************************************************************/
import { getPrefixedLogger } from "../core/logging.js";
import { applyAiFallbackOverrides } from "../core/ai-fallback.js";

const MODULE_NAME = "core-ai-fallback";

export default async function getCoreAiFallback(coreData) {
  let wo = coreData?.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  wo = await applyAiFallbackOverrides(wo, {
    log,
    moduleName: MODULE_NAME,
    endpoint: wo?.endpointResponses || wo?.endpoint
  });

  coreData.workingObject = wo;
  return coreData;
}
