/**************************************************************/
/* filename: "getApiBearers.js"                              */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger }                from "../core/logging.js";
import { getEnsureOAuthPool }               from "../shared/oauth/oauth-manager.js";
import { ensureExposureTable, listExposed } from "../shared/tools/tool-exposure.js";
import { listSecrets }                      from "../core/secrets.js";

const MODULE_NAME = "getApiBearers";


async function getInvoke(args, coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  log(`[${MODULE_NAME}] listing exposed API bearer names`, "info");

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureExposureTable(pool);
  } catch (e) {
    return { ok: false, error: `DB connection failed: ${e?.message || e}` };
  }

  const exposedNames = await listExposed(pool, MODULE_NAME);

  if (!exposedNames.length) {
    return {
      ok:      true,
      bearers: [],
      note:    "No API keys are currently exposed to the AI. An admin can configure this at /tool-exposure."
    };
  }

  let allSecrets;
  try {
    allSecrets = await listSecrets(wo);
  } catch (e) {
    return { ok: false, error: `Failed to list secrets: ${e?.message || e}` };
  }

  const secretsByName = new Map(allSecrets.map((s) => [s.name, s]));
  const bearers = exposedNames
    .filter((name) => secretsByName.has(name))
    .map((name) => ({
      name,
      description: secretsByName.get(name)?.description || null
    }));

  return { ok: true, bearers };
}


export default { name: MODULE_NAME, invoke: getInvoke };
