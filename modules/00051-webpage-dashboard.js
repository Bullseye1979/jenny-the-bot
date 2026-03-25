/************************************************************************************/
/* filename: 00051-webpage-dashboard.js                                                    *
/* Version 1.0                                                                       *
/* Purpose: Live bot telemetry dashboard served as a webpage; reads structured       *
/*          data from registry key dashboard:state (written by main.js).             *
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";
import { setSendNow, getUserRoleLabels, getIsAllowedRoles } from "../shared/webpage/utils.js";

const MODULE_NAME = "webpage-dashboard";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_ROOT   = path.join(__dirname, "..", "logs");
const EVENTS_DIR  = path.join(LOGS_ROOT, "events");
const PIPELINE_DIR = path.join(LOGS_ROOT, "pipeline");
const EVENTS_RE   = /^events-(\d+)\.log$/;
const PIPELINE_RE = /^pipeline-(\d+)\.log$/;


function getStr(v) { return v == null ? "" : String(v); }



function getBasePath(cfg) {
  const bp = getStr(cfg.basePath ?? "/dashboard").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/dashboard";
}



function getFmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}


function getFlowStatusCls(f) {
  if (f.fail > 0) return "st-err";
  if (f.stopped) return "st-stp";
  if (f.phase === "done") return "st-done";
  return "st-run";
}


function getFlowBadge(f) {
  if (f.fail > 0) return "&#x2716;&nbsp;Error";
  if (f.stopped) return "&#x25A0;&nbsp;stopped";
  if (f.phase === "done") return "&#x2714;&nbsp;done";
  if (f.phase === "jump") return "&#x25B6;&nbsp;jump";
  return "&#x25B6;&nbsp;running";
}


function buildDashboardHtml(data, menu, role, basePath, refreshSec, webAuth) {
  const ts      = data?.ts ? new Date(data.ts).toLocaleString() : "—";
  const memRss  = escHtml(data?.mem?.rssStr  || "—");
  const memHeap = escHtml(data?.mem?.heapStr || "—");
  const flows   = Array.isArray(data?.flows) ? data.flows : [];
  const menuHtml = getMenuHtml(menu, basePath, role, null, null, webAuth);

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
${getThemeHeadScript()}
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


function getLogFileList(dir, re) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && re.test(e.name))
      .map(e => {
        const n = Number(e.name.match(re)[1]);
        const full = path.join(dir, e.name);
        const size = (() => { try { return fs.statSync(full).size; } catch { return 0; } })();
        return { n, name: e.name, size };
      })
      .sort((a, b) => a.n - b.n);
  } catch {
    return [];
  }
}


function getLogFileText(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const MAX = 512 * 1024;
    if (content.length > MAX) return "[... truncated — showing last 512 KB ...]\n" + content.slice(-MAX);
    return content;
  } catch {
    return "";
  }
}


function buildLogViewerHtml(menu, role, basePath, webAuth) {
  const menuHtml = getMenuHtml(menu, basePath, role, null, null, webAuth);
  const evtFiles  = getLogFileList(EVENTS_DIR,  EVENTS_RE);
  const pipeFiles = getLogFileList(PIPELINE_DIR, PIPELINE_RE);

  function fileOpts(files, type) {
    if (!files.length) return `<option disabled>— no files —</option>`;
    return files.map(f =>
      `<option value="${escHtml(String(f.n))}" data-type="${type}">${escHtml(f.name)} (${(f.size / 1024).toFixed(1)} KB)</option>`
    ).reverse().join("");
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Logs &#8212; Jenny</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
.lwrap{margin-top:var(--hh);height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));overflow:hidden;display:flex;flex-direction:column;padding:10px;gap:8px}
.ltabs{display:flex;gap:6px;flex-shrink:0}
.ltab{padding:5px 14px;border-radius:6px;border:1px solid var(--bdr);background:var(--card);cursor:pointer;font-size:12px;font-weight:600;color:var(--muted);user-select:none;transition:background .15s}
.ltab.active{background:var(--acc);color:#fff;border-color:var(--acc)}
.lbar{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap}
.lbar select{flex:1;min-width:180px;padding:4px 8px;border-radius:6px;border:1px solid var(--bdr);background:var(--card);color:var(--txt);font-size:12px}
.lbar button{padding:4px 12px;border-radius:6px;border:1px solid var(--bdr);background:var(--card);color:var(--txt);font-size:12px;cursor:pointer}
.lbar button:hover{background:var(--acc);color:#fff;border-color:var(--acc)}
.lbar label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px;cursor:pointer}
.lbox{flex:1;overflow-y:auto;background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);padding:8px 10px;font-family:monospace;font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all}
.lbox .ll-err{color:#f87171;font-weight:600}
.lbox .ll-warn{color:#fbbf24;font-weight:600}
.lbox .ll-add{color:#4ade80}
.lbox .ll-del{color:#f87171}
.lbox .ll-hdr{color:#67e8f9;font-weight:700}
.lbox .ll-sep{color:var(--muted)}
.lbox .ll-dim{color:var(--muted)}
.lstat{font-size:11px;color:var(--muted);flex-shrink:0}
</style>
</head>
<body>
<header>
  <h1>Logs</h1>
  ${menuHtml}
</header>
<div class="lwrap">
  <div class="ltabs">
    <div class="ltab active" data-tab="events">Events</div>
    <div class="ltab" data-tab="pipeline">Pipeline Diffs</div>
  </div>
  <div class="lbar">
    <select id="lfile">
      <optgroup label="Events" id="lg-events">${fileOpts(evtFiles, "events")}</optgroup>
    </select>
    <button id="lreload">&#8635; Reload</button>
    <label><input type="checkbox" id="lautoscroll" checked> Auto-scroll</label>
    <span class="lstat" id="lstat"></span>
  </div>
  <div class="lbox" id="lbox"><span class="ll-dim">Select a file and click Reload.</span></div>
</div>
<script>
(function(){
  var tabs   = document.querySelectorAll('.ltab');
  var sel    = document.getElementById('lfile');
  var box    = document.getElementById('lbox');
  var stat   = document.getElementById('lstat');
  var reload = document.getElementById('lreload');
  var scroll = document.getElementById('lautoscroll');

  var currentTab = 'events';
  var pollTimer  = null;
  var POLL_MS    = 3000;

  function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function colorize(text) {
    var lines = text.split('\\n');
    return lines.map(function(ln) {
      if (/^\\s*\\[ERROR\\]/.test(ln))   return '<span class="ll-err">'  + escH(ln) + '</span>';
      if (/^\\s*\\[WARN\\]/.test(ln))    return '<span class="ll-warn">' + escH(ln) + '</span>';
      if (/^---/.test(ln))              return '<span class="ll-hdr">'  + escH(ln) + '</span>';
      if (/^={4,}/.test(ln))            return '<span class="ll-sep">'  + escH(ln) + '</span>';
      if (/^\\+/.test(ln))              return '<span class="ll-add">'  + escH(ln) + '</span>';
      if (/^-/.test(ln))               return '<span class="ll-del">'  + escH(ln) + '</span>';
      return escH(ln);
    }).join('\\n');
  }

  function scrollToBottom() {
    setTimeout(function() { box.scrollTop = box.scrollHeight; }, 50);
  }

  // Always fetch the live file list from the API (never use stale embedded data)
  function fetchFileList(type, cb) {
    fetch('${basePath}/logs/api?type=' + type)
      .then(function(r){ return r.json(); })
      .then(function(d){ cb(null, (d[type] || []).slice().sort(function(a,b){ return a.n - b.n; })); })
      .catch(function(e){ cb(e, []); });
  }

  function buildOpts(files) {
    if (!files.length) return '<option disabled value="">— no files —</option>';
    return files.slice().reverse().map(function(f) {
      return '<option value="' + f.n + '">' + escH(f.name) + ' (' + (f.size/1024).toFixed(1) + ' KB)</option>';
    }).join('');
  }

  function loadContent(type, n, cb) {
    fetch('${basePath}/logs/api?type=' + type + '&file=' + n)
      .then(function(r){ return r.json(); })
      .then(function(d){ cb(null, d.content || ''); })
      .catch(function(e){ cb(e, ''); });
  }

  // Refresh file list, optionally auto-select newest, then load content
  function refresh(autoSelectNewest) {
    var type = currentTab;
    fetchFileList(type, function(err, files) {
      if (err) { stat.textContent = 'Error: ' + err.message; return; }
      var prevN = sel.value;
      sel.innerHTML = buildOpts(files);
      if (!files.length) { stat.textContent = 'No log files found.'; return; }
      if (autoSelectNewest || !prevN || !files.some(function(f){ return String(f.n) === prevN; })) {
        // Auto-select the newest (first option after reverse sort = highest n)
        sel.selectedIndex = 0;
      } else {
        // Re-select the previously selected file
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === prevN) { sel.selectedIndex = i; break; }
        }
      }
      var n = sel.value;
      loadContent(type, n, function(err2, txt) {
        if (err2) { stat.textContent = 'Error: ' + err2.message; return; }
        box.innerHTML = colorize(txt);
        stat.textContent = txt.length + ' chars';
        if (scroll.checked) scrollToBottom();
      });
    });
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function() { refresh(false); }, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  scroll.addEventListener('change', function() {
    if (scroll.checked) { refresh(false); startPoll(); }
    else stopPoll();
  });

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      sel.innerHTML = '<option disabled>Loading…</option>';
      box.innerHTML = '<span class="ll-dim">Loading…</span>';
      stat.textContent = '';
      refresh(true);
    });
  });

  reload.addEventListener('click', function() { refresh(true); });

  // Initial load
  refresh(true);
  if (scroll.checked) startPoll();
})();
</script>
</body>
</html>`;
}


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
    wo.stop = true; wo.stopReason = "dashboard_request_handled";
    await setSendNow(wo);
    return coreData;
  }

  wo.stop = true; wo.stopReason = "dashboard_request_handled";

  if (!getIsAllowedRoles(wo, allowedRoles)) {
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

  // --- Log viewer routes ---
  if (urlPath === basePath + "/logs/api") {
    const qp    = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const type  = qp.get("type") || "events";
    const fileN = qp.get("file");
    if (fileN !== null) {
      const dir = type === "pipeline" ? PIPELINE_DIR : EVENTS_DIR;
      const re  = type === "pipeline" ? PIPELINE_RE : EVENTS_RE;
      const n   = Number(fileN);
      const basename = type === "pipeline" ? `pipeline-${n}.log` : `events-${n}.log`;
      if (!Number.isFinite(n) || !re.test(basename)) {
        wo.http.response = { status: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "invalid file" }) };
      } else {
        const content = getLogFileText(path.join(dir, basename));
        wo.http.response = { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ content }) };
      }
    } else {
      const eFiles = getLogFileList(EVENTS_DIR,  EVENTS_RE);
      const pFiles = getLogFileList(PIPELINE_DIR, PIPELINE_RE);
      wo.http.response = { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ events: eFiles, pipeline: pFiles }) };
    }
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath === basePath + "/logs") {
    const menu    = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
    const role    = getStr(wo?.webAuth?.role || "");
    const html    = buildLogViewerHtml(menu, role, basePath, wo.webAuth);
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, body: html };
    await setSendNow(wo);
    return coreData;
  }
  // --- End log viewer routes ---

  const data    = getItem("dashboard:state") || null;
  const menu    = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
  const role    = getStr(wo?.webAuth?.role || "");
  const html    = buildDashboardHtml(data, menu, role, basePath, refreshSec, wo.webAuth);

  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html
  };

  await setSendNow(wo);
  return coreData;
}
