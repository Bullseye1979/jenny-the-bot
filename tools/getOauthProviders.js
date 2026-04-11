/**************************************************************/
/* filename: "getOauthProviders.js"                          */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger }                              from "../core/logging.js";
import { getEnsureOAuthPool, ensureOAuthTables,
         listOAuthRegistrations }                         from "../shared/oauth/oauth-manager.js";
import { ensureExposureTable, listExposed }               from "../shared/tools/tool-exposure.js";

const MODULE_NAME = "getOauthProviders";


async function getInvoke(args, coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  log(`[${MODULE_NAME}] listing exposed OAuth providers`, "info");

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureOAuthTables(pool);
    await ensureExposureTable(pool);
  } catch (e) {
    return { ok: false, error: `DB connection failed: ${e?.message || e}` };
  }

  const exposedNames = await listExposed(pool, MODULE_NAME);

  if (!exposedNames.length) {
    return {
      ok:        true,
      providers: [],
      note:      "No OAuth providers are currently exposed to the AI. An admin can configure this at /tool-exposure."
    };
  }

  const allRegistrations = await listOAuthRegistrations(pool);
  const providers = allRegistrations
    .filter((r) => r.flow === "client_credentials" && exposedNames.includes(r.name))
    .map((r) => ({
      name:        r.name,
      description: r.description || null,
      scope:       r.scope       || null
    }));

  return { ok: true, providers };
}


export default { name: MODULE_NAME, invoke: getInvoke };
