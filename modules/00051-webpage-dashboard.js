/************************************************************************************/
/* filename: webpage-dashboard.js                                                    *
/* Version 1.0                                                                       *
/* Purpose: Live bot telemetry dashboard served as a webpage; reads structured       *
/*          data from registry key dashboard:state (written by main.js).             *
/************************************************************************************/

/************************************************************************************/
/*                                                                                   *
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "webpage-dashboard";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/************************************************************************************/
/* functionSignature: getStr (v)                                                     *
/* Returns a string; empty string for nullish                                        *
/************************************************************************************/
function getStr(v) { return v == null ? "" : String(v); }

/************************************************************************************/
/* functionSignature: escHtml (s)                                                    *
/* Escapes HTML special characters                                                   *
/************************************************************************************/
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/************************************************************************************/
/* functionSignature: getUserRoleLabels (wo)                                         *
/* Returns all role labels for the current user                                      *
/************************************************************************************/
function getUserRoleLabels(wo) {
  const out = [], seen = new Set();
  const primary = getStr(wo?.webAuth?.role).trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = getStr(r).trim().toLowerCase();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  return out;
}

/************************************************************************************/
/* functionSignature: getIsAllowed (wo, allowedRoles)                               *
/* Returns true if the user has one of the allowed roles, or no roles required      *
/************************************************************************************/
function getIsAllowed(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set(getUserRoleLabels(wo));
  return req.some(r => have.has(getStr(r).trim().toLowerCase()));
}

/************************************************************************************/
/* functionSignature: getBasePath (cfg)                                              *
/* Returns the configured base path with leading slash, no trailing slash           *
/************************************************************************************/
function getBasePath(cfg) {
  const bp = getStr(cfg.basePath ?? "/dashboard").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/dashboard";
}

/************************************************************************************/
/* functionSignature: setSendNow (wo)                                                *
/* Writes the HTTP response back via the registered response object                  *
/************************************************************************************/
async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = getItem(key);
  if (!entry?.res) return;
  const { res } = entry;
  if (res.writableEnded || res.headersSent) return;
  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "text/html; charset=utf-8" };
  const body    = r.body    ?? "";
  try {
    res.writeHead(status, headers);
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  } catch {}
}

/************************************************************************************/
/* functionSignature: getFmtElapsed (ms)                                             *
/* Formats elapsed milliseconds as a human-readable duration string                  *
/************************************************************************************/
function getFmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/************************************************************************************/
/* functionSignature: getFlowStatusCls (f)                                           *
/* Returns a CSS class for the flow card based on its status                         *
/************************************************************************************/
function getFlowStatusCls(f) {
  if (f.fail > 0) return "st-err";
  if (f.stopped) return "st-stp";
  if (f.phase === "done") return "st-done";
  return "st-run";
}

/************************************************************************************/
/* functionSignature: getFlowBadge (f)                                               *
/* Returns an HTML badge label for the flow status                                   *
/************************************************************************************/
function getFlowBadge(f) {
  if (f.fail > 0) return "&#x2716;&nbsp;Error";
  if (f.stopped) return "&#x25A0;&nbsp;stopped";
  if (f.phase === "done") return "&#x2714;&nbsp;done";
  if (f.phase === "jump") return "&#x25B6;&nbsp;jump";
  return "&#x25B6;&nbsp;running";
}

/************************************************************************************/
/* functionSignature: buildDashboardHtml (data, menu, role, basePath, refreshSec)   *
/* Builds the full HTML page for the dashboard                                       *
/************************************************************************************/
function buildDashboardHtml(data, menu, role, basePath, refreshSec) {
  const ts      = data?.ts ? new Date(data.ts).toLocaleString() : "—";
  const memRss  = escHtml(data?.mem?.rssStr  || "—");
  const memHeap = escHtml(data?.mem?.heapStr || "—");
  const flows   = Array.isArray(data?.flows) ? data.flows : [];
  const menuHtml = getMenuHtml(menu, basePath, role);

  const flowCards = flows.length
    ? flows.map(f => {
        const total   = f.total || 0;
        const done    = (f.ok || 0) + (f.fail || 0) + (f.skip || 0);
        const pct     = total > 0 ? Math.round((done / total) * 100) : (f.phase === "done" ? 100 : 0);
        const cls     = getFlowStatusCls(f);
        const badge   = getFlowBadge(f);
        const elapsed = getFmtElapsed(f.elapsedMs || 0);

        const cur     = f.current    ? `<span class="dlbl">cur:</span> ${escHtml(f.current)}`    : "";
        const lastMod = f.lastModule ? `<span class="dlbl">last:</span> ${escHtml(f.lastModule)}` : "";
        const errTxt  = f.lastError  ? `<span class="derr">${escHtml(f.lastError)}</span>`        : "";
        const detail  = [cur, lastMod, errTxt].filter(Boolean).join("&nbsp;&nbsp;");

        return `<div class="dflow ${cls}" data-flow="${escHtml(f.flowName)}">
  <div class="drow1">
    <div class="dname">${escHtml(f.flowName)}<span class="didx">#${f.runIndex || 1}</span></div>
    <span class="dbadge">${badge}</span>
    <span class="dsteps">${f.ok || 0}/${total}</span>
    <span class="dtime">${elapsed}</span>
  </div>
  <div class="dprog">
    <div class="dbar"><div class="dfill" style="width:${pct}%"></div></div>
    <span class="dpct">${pct}%</span>
  </div>${detail ? `
  <div class="ddetail">${detail}</div>` : ""}
</div>`;
      }).join("\n")
    : `<div class="dempty">No flows recorded yet.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="refresh" content="${refreshSec}">
<title>Dashboard &#8212; Jenny</title>
<link rel="stylesheet" href="${basePath}/style.css">
<style>
.dwrap{
  margin-top:var(--hh);
  height:calc(100vh - var(--hh));
  height:calc(100dvh - var(--hh));
  overflow-y:auto;padding:12px;
  display:flex;flex-direction:column;gap:10px;
}
.dstats{display:flex;gap:6px;flex-wrap:wrap}
.dstat{
  background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);
  padding:7px 12px;font-size:11px;color:var(--muted);
  white-space:nowrap;flex:1;min-width:120px;
}
.dstat strong{display:block;font-size:15px;color:var(--txt);font-weight:700;margin-top:1px}
.dflows{display:flex;flex-direction:column;gap:6px}
.dflow{
  background:var(--card);border:1px solid var(--bdr);border-left-width:4px;
  border-radius:var(--r);padding:10px 12px;
  display:flex;flex-direction:column;gap:6px;
}
.drow1{display:flex;align-items:center;gap:8px;min-width:0}
.dname{
  font-weight:700;font-size:13px;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.didx{font-size:10px;color:var(--muted);font-weight:normal;margin-left:3px}
.dbadge{
  font-size:11px;font-weight:700;padding:2px 8px;
  border-radius:4px;white-space:nowrap;flex-shrink:0;
}
.dsteps,.dtime{font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0}
.dprog{display:flex;align-items:center;gap:8px}
.dbar{flex:1;height:6px;background:var(--bdr);border-radius:3px;overflow:hidden;min-width:0}
.dfill{height:100%;border-radius:3px;transition:width .4s}
.dpct{font-size:11px;color:var(--muted);width:30px;text-align:right;flex-shrink:0}
.ddetail{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlbl{color:#94a3b8}
.derr{color:var(--dan);font-weight:600}
.dempty{
  background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);
  padding:32px 20px;text-align:center;color:var(--muted);font-size:13px;
}
.dcontrols{display:flex;gap:12px;flex-wrap:wrap}
.dtoggle{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}
.dtoggle input{cursor:pointer;accent-color:var(--acc)}
.dfoot{text-align:right;font-size:11px;color:var(--muted);margin-top:auto;padding:0 2px}
.st-run {border-left-color:#3b82f6}
.st-run  .dbadge{background:#eff6ff;color:#2563eb}
.st-run  .dfill{background:#3b82f6}
.st-done{border-left-color:#10b981}
.st-done .dbadge{background:#f0fdf4;color:#16a34a}
.st-done .dfill{background:#10b981}
.st-err {border-left-color:#ef4444}
.st-err  .dbadge{background:#fef2f2;color:#dc2626}
.st-err  .dfill{background:#ef4444}
.st-stp {border-left-color:#f59e0b}
.st-stp  .dbadge{background:#fef9c3;color:#d97706}
.st-stp  .dfill{background:#f59e0b}
@media(max-width:520px){
  .dwrap{padding:8px;gap:8px}
  .dstat{min-width:calc(50% - 3px)}
  .dsteps,.dtime{display:none}
}
html.dhide-webpage .dflow[data-flow="webpage"]{display:none}
</style>
<script>
/* Runs synchronously before first paint — no flash */
try{var __dh=JSON.parse(localStorage.getItem('dash-hidden-flows')||'["webpage"]');__dh.forEach(function(f){document.documentElement.classList.add('dhide-'+f)});}catch{}
</script>
<script>
(function(){
  var KEY = 'dash-hidden-flows';

  function loadHidden() {
    try { return JSON.parse(localStorage.getItem(KEY) || '["webpage"]'); }
    catch { return ['webpage']; }
  }
  function applyClasses(hidden) {
    ['webpage'].forEach(function(f) {
      document.documentElement.classList.toggle('dhide-' + f, hidden.indexOf(f) !== -1);
    });
  }
  function toggle(flowName, hide) {
    var hidden = loadHidden();
    var idx = hidden.indexOf(flowName);
    if (hide && idx === -1) hidden.push(flowName);
    if (!hide && idx !== -1) hidden.splice(idx, 1);
    try { localStorage.setItem(KEY, JSON.stringify(hidden)); } catch {}
    applyClasses(hidden);
  }
  document.addEventListener('DOMContentLoaded', function() {
    var hidden = loadHidden();
    var cb = document.getElementById('dcb-webpage');
    if (cb) {
      cb.checked = hidden.indexOf('webpage') !== -1;
      cb.addEventListener('change', function() { toggle('webpage', cb.checked); });
    }
  });
})();
</script>
</head>
<body>
<header>
  <h1>Dashboard</h1>
  ${menuHtml}
</header>
<div class="dwrap">
  <div class="dstats">
    <div class="dstat">Updated<strong>${escHtml(ts)}</strong></div>
    <div class="dstat">RSS<strong>${memRss}</strong></div>
    <div class="dstat">Heap<strong>${memHeap}</strong></div>
    <div class="dstat">Flows<strong>${escHtml(String(flows.length))}</strong></div>
  </div>
  <div class="dcontrols">
    <label class="dtoggle"><input type="checkbox" id="dcb-webpage"> Hide HTTP flows (webpage)</label>
  </div>
  <div class="dflows">
${flowCards}
  </div>
  <div class="dfoot">Auto-Refresh: ${escHtml(String(refreshSec))}s</div>
</div>
</body>
</html>`;
}

/************************************************************************************/
/* functionSignature: getWebpageDashboard (coreData)                                 *
/* Serves the live telemetry dashboard at the configured basePath and port           *
/************************************************************************************/
export default async function getWebpageDashboard(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3115);
  const basePath     = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : ["admin"];
  const refreshSec   = Number(cfg.refreshSeconds ?? 5);

  if (Number(wo.http?.port) !== port) return coreData;

  const url     = getStr(wo.http?.url || "/");
  const method  = getStr(wo.http?.method || "GET").toUpperCase();
  const urlPath = url.split("?")[0];

  if (!urlPath.startsWith(basePath)) return coreData;

  if (method === "GET" && urlPath === basePath + "/style.css") {
    try {
      const cssPath = fileURLToPath(new URL("../shared/webpage/style.css", import.meta.url));
      const css = fs.readFileSync(cssPath, "utf-8");
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
        body: css
      };
    } catch {
      wo.http.response = {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Not Found"
      };
    }
    wo.stop = true;
    await setSendNow(wo);
    return coreData;
  }

  wo.stop = true;

  if (!getIsAllowed(wo, allowedRoles)) {
    wo.http.response = {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "403 Forbidden"
    };
    await setSendNow(wo);
    return coreData;
  }

  if (method !== "GET") {
    wo.http.response = {
      status: 405,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "405 Method Not Allowed"
    };
    await setSendNow(wo);
    return coreData;
  }

  const data    = getItem("dashboard:state") || null;
  const menu    = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
  const role    = getStr(wo?.webAuth?.role || "");
  const html    = buildDashboardHtml(data, menu, role, basePath, refreshSec);

  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html
  };

  await setSendNow(wo);
  return coreData;
}
