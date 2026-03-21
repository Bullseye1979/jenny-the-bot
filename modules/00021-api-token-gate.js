/************************************************************************************
/* filename: api-token-gate.js                                                     *
/* Version 1.0                                                                     *
/* Purpose: Gates API requests: apiEnabled=0 always blocks; apiEnabled=1 checks    *
/*          Bearer token against apiSecret. Only runs for the "api" flow.          *
/************************************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "api-token-gate";


function getApiEnabled(wo) {
  const v = wo?.apiEnabled;
  if (v === undefined || v === null || v === "") return 1;
  return Number(v);
}


function getApiSecret(wo) {
  return String(wo?.apiSecret || "").trim();
}


function getBearerToken(wo) {
  const auth = String(wo?.httpAuthorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}


export default async function getApiTokenGate(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (String(wo?.flow || "") !== "api") return coreData;

  const enabled = getApiEnabled(wo);

  if (enabled === 0) {
    log("apiEnabled=0 — channel blocked from API access", "warn", { moduleName: MODULE_NAME });
    wo.stop     = true;
    wo.blocked  = true;
    wo.apiGated = true;
    return coreData;
  }

  const secret = getApiSecret(wo);
  if (!secret) {
    log("apiSecret not set — gate disabled", "debug", { moduleName: MODULE_NAME });
    return coreData;
  }

  const token = getBearerToken(wo);
  if (token === secret) {
    log("Bearer token valid — access granted", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  log("Bearer token invalid or missing — access denied", "warn", { moduleName: MODULE_NAME });
  wo.stop     = true;
  wo.blocked  = true;
  wo.apiGated = true;

  return coreData;
}
