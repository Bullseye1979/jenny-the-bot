"use strict";

import fs from "node:fs";
import { getMenuHtml, readJsonFile, writeJsonFile } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "webpage-config-editor";

/********************************************************************************************************************
* functionSignature: setSendNow (wo)
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
********************************************************************************************************************/
function setJsonResp(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

/********************************************************************************************************************
* functionSignature: setNotFound (wo)
********************************************************************************************************************/
function setNotFound(wo) {
  wo.http.response = {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: "Not Found"
  };
}

/********************************************************************************************************************
* functionSignature: getIsAdmin (wo)
********************************************************************************************************************/
function getIsAdmin(wo) {
  return String(wo?.webAuth?.role || "").trim().toLowerCase() === "admin";
}

/********************************************************************************************************************
* functionSignature: getBasePath (cfg)
********************************************************************************************************************/
function getBasePath(cfg) {
  const bp = String(cfg.basePath ?? "/config").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/,"") : "/config";
}

/********************************************************************************************************************
* functionSignature: getConfigFile (cfg)
********************************************************************************************************************/
function getConfigFile(cfg) {
  if (cfg.file) return String(cfg.file);
  if (cfg.configPath) return String(cfg.configPath);
  return (new URL("../core.json", import.meta.url)).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}

/********************************************************************************************************************
* functionSignature: getWebpageConfigEditor (coreData)
********************************************************************************************************************/
export default async function getWebpageConfigEditor(coreData) {
  const wo  = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg    = coreData?.config?.[MODULE_NAME] || {};
  const port   = Number(cfg.port ?? 3111);
  const basePath = getBasePath(cfg);
  const cfgFile = getConfigFile(cfg);

  if (Number(wo.http?.port) !== port) return coreData;
  if (wo.jump) return coreData;

  const method  = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  /* Never intercept auth paths on loginPort */
  if (urlPath === "/auth" || urlPath.startsWith("/auth/")) return coreData;

  /* Deep-link protection (stealth) */
  if (!getIsAdmin(wo)) {
    if (urlPath === basePath || urlPath.startsWith(basePath + "/")) {
      setNotFound(wo);
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    return coreData;
  }

  /* ---- GET /config/style.css ---- */
  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
      body: fs.readFileSync(cssFile, "utf-8")
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /config ---- */
  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: getConfigHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, configBase: basePath })
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /config/api/config ---- */
  if (method === "GET" && urlPath === basePath + "/api/config") {
    const result = readJsonFile(cfgFile);
    if (!result.ok) setJsonResp(wo, 500, { error: result.error });
    else setJsonResp(wo, 200, result.data);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /config/api/config ---- */
  if (method === "POST" && urlPath === basePath + "/api/config") {
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
    if (!result.ok) setJsonResp(wo, 500, { error: result.error });
    else setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}

/********************************************************************************************************************
* functionSignature: getConfigHtml (opts)
* Purpose: Lightweight JSON config editor (textarea) + shared menu. Uses {configBase}/style.css.
********************************************************************************************************************/
function getConfigHtml(opts) {
  const configBase = String(opts?.configBase || "/config").replace(/\/+$/,"") || "/config";
  const activePath = String(opts?.activePath || configBase) || configBase;
  const role       = String(opts?.role || "").trim();
  const rightHtml =
  '<span id="status-lbl" style="font-size:12px;color:var(--muted)"></span>' +
  '<button id="save-btn" disabled onclick="saveConfig()">Saved</button>';

  const menuHtml = getMenuHtml(opts?.menu || [], activePath, role, rightHtml);

  return (
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>Jenny — Config</title>\n' +
'<link rel="stylesheet" href="' + configBase + '/style.css">\n' +
'<style>\n' +
'/* small page-specific layout */\n' +
'.cfg-wrap{margin-top:var(--hh);height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));display:flex;flex-direction:column;gap:10px;padding:12px;overflow:hidden}\n' +
'.cfg-actions{display:flex;gap:8px;align-items:center}\n' +
'.cfg-actions .btn{padding:6px 12px}\n' +
'.cfg-text{flex:1;width:100%;border:1px solid var(--bdr);border-radius:8px;padding:10px;font-family:monospace;font-size:12px;line-height:1.45;resize:none;overflow:auto;background:#fff;color:var(--txt)}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <h1>Jenny</h1>\n' +
(menuHtml ? ('  ' + menuHtml + '\n') : '') +
'</header>\n' +
'\n' +
'<div class="cfg-wrap">\n' +
'  <div class="cfg-actions">\n' +
'    <button class="btn btn-s" onclick="loadConfig()">↻ Reload</button>\n' +
'    <span style="color:var(--muted);font-size:12px">Editing: ' + configBase + '/api/config</span>\n' +
'  </div>\n' +
'  <textarea id="cfg-text" class="cfg-text" spellcheck="false"></textarea>\n' +
'</div>\n' +
'\n' +
'<div id="toast" class="toast"></div>\n' +
'\n' +
'<script>\n' +
'var CONFIG_BASE="' + configBase + '";\n' +
'var dirty=false;\n' +
'function toast(msg, ms){ var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on"); setTimeout(function(){ t.classList.remove("on"); }, ms||2400); }\n' +
'function setDirty(v){ dirty=!!v; var b=document.getElementById("save-btn"); if(dirty){ b.disabled=false; b.textContent="Save"; b.className="dirty"; document.getElementById("status-lbl").textContent="Unsaved changes"; } else { b.disabled=true; b.textContent="Saved"; b.className=""; document.getElementById("status-lbl").textContent=""; } }\n' +
'function loadConfig(){\n' +
'  fetch(CONFIG_BASE + "/api/config")\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(d){\n' +
'      document.getElementById("cfg-text").value = JSON.stringify(d, null, 2);\n' +
'      setDirty(false);\n' +
'      toast("Loaded");\n' +
'    })\n' +
'    .catch(function(e){ toast("Load error: " + e.message, 5000); });\n' +
'}\n' +
'function saveConfig(){\n' +
'  var b=document.getElementById("save-btn");\n' +
'  b.disabled=true; b.textContent="Saving...";\n' +
'  var raw=document.getElementById("cfg-text").value;\n' +
'  var obj=null;\n' +
'  try{ obj=JSON.parse(raw); }catch(e){ toast("Invalid JSON: " + e.message, 6000); b.textContent="Save"; b.disabled=false; b.className="dirty"; return; }\n' +
'  fetch(CONFIG_BASE + "/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)})\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(d){\n' +
'      if(d && d.ok){ setDirty(false); toast("Config saved"); }\n' +
'      else { toast("Error: " + ((d && d.error) || "?"), 6000); b.textContent="Save"; b.disabled=false; b.className="dirty"; }\n' +
'    })\n' +
'    .catch(function(e){ toast("Save failed: " + e.message, 6000); b.textContent="Save"; b.disabled=false; b.className="dirty"; });\n' +
'}\n' +
'document.getElementById("cfg-text").addEventListener("input", function(){ setDirty(true); });\n' +
'document.addEventListener("keydown", function(e){ if((e.ctrlKey||e.metaKey) && e.key==="s"){ e.preventDefault(); if(dirty) saveConfig(); } });\n' +
'loadConfig();\n' +
'</script>\n' +
'</body>\n' +
'</html>'
  );
}
