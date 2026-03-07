/************************************************************************************
/* filename: webpage-menu.js                                                       *
/* Version 1.0                                                                     *
/* Purpose: Global menu provider for webpage flows; filters items by webAuth role. *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/

/************************************************************************************/
/*                                                                                 *
/************************************************************************************/
/* filename: "webpage-menu.js"                                */
/* Version 1.3                                                */
/* Purpose: Global menu provider. Sets wo.web.menu from config */
/*          and filters by wo.webAuth.role (if present).       */
/*          Fallback: if role is missing => build all items    */
/*          and ignore role restrictions.                      */
/**************************************************************/

"use strict";

const MODULE_NAME = "webpage-menu";

/**************************************************************/
/* functionSignature: getNormFlow (wo)                        */
/**************************************************************/
function getNormFlow(wo) {
  return String(wo?.flow || "").trim().toLowerCase();
}

/************************************************************************************/
/* functionSignature: getNormRoleOrEmpty (wo)                                      *
/* the normalized role string or empty string when not set.                        *
/************************************************************************************/
function getNormRoleOrEmpty(wo) {
  return String(wo?.webAuth?.role || "").trim().toLowerCase();
}

/**************************************************************/
/* functionSignature: getIsAllowed (role, rolesArr)           */
/**************************************************************/
function getIsAllowed(role, rolesArr) {
  const roles = Array.isArray(rolesArr)
    ? rolesArr.map(r => String(r || "").trim().toLowerCase()).filter(Boolean)
    : [];

  /* No restriction configured => visible */
  if (!roles.length) return true;

  /* Fallback: role not known => ignore restrictions */
  if (!role) return true;

  /* admin sees everything */
  if (role === "admin") return true;

  /* strict: must match explicitly */
  return roles.includes(role);
}

/**************************************************************/
/* functionSignature: getWebpageMenu (coreData)               */
/**************************************************************/
export default async function getWebpageMenu(coreData) {
  const wo = coreData?.workingObject || {};

  const flow = getNormFlow(wo);
  if (!flow || !flow.startsWith("webpage")) return coreData;

  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];

  const role = getNormRoleOrEmpty(wo);

  if (!wo.web) wo.web = {};

  wo.web.menu = items
    .map(it => ({
      text:  String(it?.text || it?.label || it?.name || "").trim(),
      link:  String(it?.link || it?.href  || it?.url  || "").trim(),
      roles: Array.isArray(it?.roles) ? it.roles : []
    }))
    .filter(it => it.text && it.link)
    .filter(it => getIsAllowed(role, it.roles));

  return coreData;
}