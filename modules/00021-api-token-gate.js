/**************************************************************
/* filename: "api-token-gate.js"                              *
/* Version 1.0                                                *
/* Purpose: Block API requests whose Authorization: Bearer    *
/*          token does not match workingObject.apiSecret.     *
/*          No-op when apiSecret is empty (gate disabled).    *
/*          Only runs for the "api" flow.                     *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "api-token-gate";

/**************************************************************
/* functionSignature: getApiSecret (wo)                       *
/* Reads apiSecret from workingObject; empty = gate disabled. *
/**************************************************************/
function getApiSecret(wo) {
  return String(wo?.apiSecret || "").trim();
}

/**************************************************************
/* functionSignature: getBearerToken (wo)                     *
/* Extracts Bearer token from workingObject.httpAuthorization *
/**************************************************************/
function getBearerToken(wo) {
  const auth = String(wo?.httpAuthorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

/**************************************************************
/* functionSignature: getApiTokenGate (coreData)              *
/* Gates the pipeline when the Bearer token is wrong/missing. *
/**************************************************************/
export default async function getApiTokenGate(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (String(wo?.flow || "") !== "api") return coreData;

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
  wo.stop    = true;
  wo.blocked = true;
  wo.apiGated = true;

  return coreData;
}
