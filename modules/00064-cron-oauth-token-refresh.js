/**************************************************************/
/* filename: "00064-cron-oauth-token-refresh.js"             */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/
"use strict";

import { getPrefixedLogger } from "../core/logging.js";
import {
  getEnsureOAuthPool,
  ensureOAuthTables,
  listOAuthTokensExpiringSoon,
  getOAuthRegistration,
  refreshUserToken
} from "../shared/oauth/oauth-manager.js";

const MODULE_NAME = "cron-oauth-token-refresh";


export default async function cronOauthTokenRefresh(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  if (wo?.flow !== "cron-oauth-token-refresh") return coreData;

  const log      = getPrefixedLogger(wo, import.meta.url);
  const bufferMs = (Number(cfg.refreshBufferMinutes) || 10) * 60 * 1000;
  const cutoff   = Date.now() + bufferMs;

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureOAuthTables(pool);
  } catch (e) {
    log(`[${MODULE_NAME}] DB connect error: ${e?.message || e}`, "error");
    return coreData;
  }

  let rows;
  try {
    rows = await listOAuthTokensExpiringSoon(pool, cutoff);
  } catch (e) {
    log(`[${MODULE_NAME}] Query error: ${e?.message || e}`, "error");
    return coreData;
  }

  if (!rows || rows.length === 0) return coreData;

  for (const row of rows) {
    const provider = String(row.provider || "");
    const userId   = String(row.user_id  || "");

    if (!provider || !userId) continue;

    let reg;
    try {
      reg = await getOAuthRegistration(pool, provider);
    } catch (e) {
      log(`[${MODULE_NAME}] Could not load registration for provider "${provider}": ${e?.message || e}`, "error");
      continue;
    }

    if (!reg) {
      log(`[${MODULE_NAME}] No registration found for provider "${provider}" — skipping`, "warn");
      continue;
    }

    try {
      await refreshUserToken(pool, reg, row);
      log(`[${MODULE_NAME}] Refreshed token for provider="${provider}" user="${userId}"`, "info");
    } catch (e) {
      log(`[${MODULE_NAME}] Refresh failed for provider="${provider}" user="${userId}": ${e?.message || e}`, "error");
    }
  }

  return coreData;
}
