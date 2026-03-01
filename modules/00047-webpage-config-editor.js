"use strict";

import { getConfigEditorHtml, readJsonFile, writeJsonFile, isAuthorized } from "../shared/webpage/interface.js";
import { getItem, putItem } from "../core/registry.js";

const MODULE_NAME = "webpage-config-editor";

/********************************************************************************************************************
* functionSignature: setSendNow (wo)
* Purpose: Sends the HTTP response immediately and marks the request as handled.
********************************************************************************************************************/
async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return;
  const { res } = entry;
  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "application/json" };
  const body    = r.body    ?? "";
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/********************************************************************************************************************
* functionSignature: setJsonResp (wo, status, data)
* Purpose: Sets a JSON response on the workingObject.
********************************************************************************************************************/
function setJsonResp(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

/********************************************************************************************************************
* functionSignature: getWebpageConfigEditor (coreData)
* Purpose: Handles all requests arriving on the config-editor port.
*          Routes: GET /  →  config editor SPA
*                  GET /api/config  →  read core.json
*                  POST /api/config →  write core.json
********************************************************************************************************************/
export default async function getWebpageConfigEditor(coreData) {
  const wo  = coreData?.workingObject || {};

  /* Only active in the webpage flow */
  if (wo?.flow !== "webpage") return coreData;

  const cfg   = coreData?.config?.[MODULE_NAME] || {};
  const port  = Number(cfg.port  ?? 3111);
  const token = String(cfg.token ?? "").trim();
  const label = String(cfg.label ?? "⚙️ Config").trim();
  const cfgFile = cfg.configPath
    ? String(cfg.configPath)
    : (new URL("../core.json", import.meta.url)).pathname.replace(/^\/([A-Za-z]:)/, "$1");

  /* Always add ourselves to the nav menu (cross-port linking) */
  if (Array.isArray(wo.web?.menu)) {
    wo.web.menu.push({ label, port, path: "/" });
  }

  /* Only handle requests arriving on our port */
  if (wo.http?.port !== port) return coreData;

  /* Skip if another module already handled this request */
  if (wo.jump) return coreData;

  const method  = String(wo.http?.method  ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];
  const headers = wo.http?.headers ?? {};

  /* Auth guard */
  if (!isAuthorized({ headers }, token)) {
    setJsonResp(wo, 401, { error: "unauthorized" });
    wo.http.response.headers["WWW-Authenticate"] = "Basic realm=\"Jenny Admin\"";
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET / or /index.html  →  Serve SPA ---- */
  if (method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getConfigEditorHtml()
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /api/config ---- */
  if (method === "GET" && urlPath === "/api/config") {
    const result = readJsonFile(cfgFile);
    if (!result.ok) { setJsonResp(wo, 500, { error: result.error }); }
    else            { setJsonResp(wo, 200, result.data); }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /api/config ---- */
  if (method === "POST" && urlPath === "/api/config") {
    /* wo.http.json is pre-parsed by flows/webpage.js; fall back to manual parse of rawBody */
    let data = wo.http?.json ?? null;
    if (data === null) {
      const rawBody = String(wo.http?.rawBody ?? wo.http?.body ?? "");
      try { data = JSON.parse(rawBody); }
      catch (e) {
        setJsonResp(wo, 400, { error: "Invalid JSON: " + String(e?.message || e) });
        wo.jump = true;
        await setSendNow(wo);
        return coreData;
      }
    }
    const result = writeJsonFile(cfgFile, data);
    if (!result.ok) { setJsonResp(wo, 500, { error: result.error }); }
    else            { setJsonResp(wo, 200, { ok: true }); }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* Unknown path on this port — let other modules or webpage-output handle it */
  return coreData;
}
