/**************************************************************/
/* filename: "getMyConnections.js"                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger }                              from "../core/logging.js";
import { getEnsureOAuthPool, ensureOAuthTables,
         listOAuthRegistrations, getOAuthToken }          from "../shared/oauth/oauth-manager.js";

const MODULE_NAME = "getMyConnections";


async function getInvoke(args, coreData) {
  const wo     = coreData?.workingObject || {};
  const log    = getPrefixedLogger(wo, import.meta.url);
  const userId = String(wo?.userId || "").trim();

  if (!userId) {
    return {
      ok:    false,
      error: "No user context available. This tool only works inside a user-triggered conversation."
    };
  }

  log(`[${MODULE_NAME}] checking connections for user=${userId}`, "info");

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureOAuthTables(pool);
  } catch (e) {
    return { ok: false, error: `DB connection failed: ${e?.message || e}` };
  }

  const allRegs      = await listOAuthRegistrations(pool);
  const authCodeRegs = allRegs.filter((r) => r.flow === "auth_code");

  if (!authCodeRegs.length) {
    return {
      ok:          true,
      connections: [],
      note:        "No user-connectable OAuth providers are configured. An admin can add auth_code providers at /oauth."
    };
  }

  const connections = [];
  for (const reg of authCodeRegs) {
    const token = await getOAuthToken(pool, reg.name, userId);
    if (!token) continue;

    const now       = Date.now();
    const expired   = Number(token.expires_at || 0) < now;
    const renewable = expired && !!token.refresh_token;

    connections.push({
      name:        reg.name,
      description: reg.description || null,
      scope:       reg.scope       || null,
      status:      expired ? (renewable ? "expired_renewable" : "expired") : "active"
    });
  }

  if (!connections.length) {
    return {
      ok:          true,
      connections: [],
      note:        `User has not connected any OAuth providers yet. They can do so at /connections.`
    };
  }

  return { ok: true, connections };
}


export default { name: MODULE_NAME, invoke: getInvoke };
