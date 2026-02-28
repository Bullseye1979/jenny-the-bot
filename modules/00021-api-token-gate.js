/**************************************************************
/* filename: "api-token-gate.js"                              *
/* Version 2.0                                                *
/* Purpose: Block API requests based on two conditions:       *
/*   1. apiEnabled = 0  → always blocked (channel disabled    *
/*                        for API access), regardless of      *
/*                        apiSecret or Bearer token.          *
/*   2. apiEnabled = 1  → allowed when apiSecret is empty     *
/*                        (gate disabled) or Bearer token     *
/*                        matches apiSecret.                  *
/*          Only runs for the "api" flow.                     *
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "api-token-gate";

/**************************************************************
/* functionSignature: getApiEnabled (wo)                      *
/* Returns the numeric apiEnabled flag. Defaults to 1 when    *
/* not set (backward-compatible: channel allowed by default). *
/**************************************************************/
function getApiEnabled(wo) {
  const v = wo?.apiEnabled;
  if (v === undefined || v === null || v === "") return 1;
  return Number(v);
}

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
/* Gates the pipeline:                                        *
/*   apiEnabled=0 → always blocked (hard channel lock).       *
/*   apiEnabled=1 → blocked only when apiSecret is set and    *
/*                  Bearer token does not match.              *
/**************************************************************/
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
