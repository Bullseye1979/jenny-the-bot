/**************************************************************/
/* filename: "00051-webpage-dashboard.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";
import { setSendNow, getUserRoleLabels, getIsAllowedRoles } from "../shared/webpage/utils.js";
import { getStr } from "../core/utils.js";

const MODULE_NAME = "webpage-dashboard";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_ROOT   = path.join(__dirname, "..", "logs");
const EVENTS_DIR  = path.join(LOGS_ROOT, "events");
const PIPELINE_DIR = path.join(LOGS_ROOT, "pipeline");
const EVENTS_RE   = /^events-(\d+)\.log$/;
const PIPELINE_RE = /^pipeline-(\d+)\.log$/;


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

function getShortId(value, n = 10) {
  const s = getStr(value).trim();
  if (!s) return "";
  return s.length > n ? s.slice(0, n) : s;
}


function getFlowTitle(f) {
  const agent = getStr(f.agentType).trim();
  if (agent) return agent;
  const ch = getStr(f.channelId).trim();
  return ch || getStr(f.flowName).trim() || "flow";
}


function getNodeKey(f) {
  const parts = [
    getStr(f?.runId).trim(),
    getStr(f?.turnId).trim(),
    getStr(f?.channelId).trim(),
    getStr(f?.flowName).trim(),
    getStr(f?.runIndex).trim()
  ].filter(Boolean);
  return parts.join("|") || "node";
}


function getGroupKey(f) {
  return [
    getStr(f.callerChannelId || f.channelId).trim(),
    getStr(f.callerFlow || f.flowName).trim(),
    getStr(f.flowName).trim()
  ].join("|");
}


function getIsDashboardRuntimeFlow(f) {
  return getStr(f?.flowName).trim() === "toolcall";
}


function buildFlowTree(flows) {
  const nodes = flows.map((f, i) => ({
    f,
    i,
    children: [],
    parent: null,
    groupKey: getGroupKey(f),
    siblingCount: 1
  }));
  const byTurn = new Map();
  const byChannel = new Map();
  for (const node of nodes) {
    const turnId = getStr(node.f.turnId).trim();
    const channelId = getStr(node.f.channelId).trim();
    if (turnId && !byTurn.has(turnId)) byTurn.set(turnId, node);
    if (channelId && !byChannel.has(channelId)) byChannel.set(channelId, node);
  }
  for (const node of nodes) {
    const callerTurnId = getStr(node.f.callerTurnId).trim();
    const callerChannelId = getStr(node.f.callerChannelId).trim();
    const parent = (callerTurnId && byTurn.get(callerTurnId)) || (callerChannelId && byChannel.get(callerChannelId)) || null;
    if (parent && parent !== node) {
      node.parent = parent;
      parent.children.push(node);
    }
  }
  const groups = new Map();
  for (const node of nodes) {
    const key = node.groupKey;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  for (const node of nodes) node.siblingCount = groups.get(node.groupKey) || 1;
  return nodes.filter(node => !node.parent);
}


function getCalledTools(f) {
  const activeName = getStr(f.activeTool?.name || f.activeTool?.tool).trim();
  const calls = Array.isArray(f.toolCallLog) ? f.toolCallLog : [];
  const out = calls
    .map((c, i) => ({
      name: getStr(c?.tool || c?.name).trim(),
      status: getStr(c?.status).trim(),
      durationMs: Number(c?.durationMs),
      task: getStr(c?.task).trim(),
      active: false,
      index: i + 1
    }))
    .filter(c => c.name);
  if (activeName) {
    const last = out[out.length - 1];
    if (!last || last.name !== activeName || last.status) {
      out.push({
        name: activeName,
        status: "running",
        durationMs: 0,
        task: "",
        active: true,
        index: out.length + 1
      });
    } else {
      last.active = true;
      last.status = last.status || "running";
    }
  }
  return out.slice(-8);
}


function getCallStatusCls(call) {
  if (call.active || call.status === "running") return "st-run";
  if (call.status === "failed" || call.status === "error" || call.status === "returned_error") return "st-err";
  return "st-done";
}


function renderToolCallCard(call) {
  const cls = getCallStatusCls(call);
  const duration = Number.isFinite(call.durationMs) && call.durationMs > 0 ? getFmtElapsed(call.durationMs) : "";
  const badge = call.active || call.status === "running"
    ? "&#x25B6;&nbsp;tool"
    : (cls === "st-err" ? "&#x2716;&nbsp;tool" : "&#x2714;&nbsp;tool");
  const detail = [
    call.status ? `<span><span class="dlbl">status:</span> ${escHtml(call.status)}</span>` : "",
    duration ? `<span><span class="dlbl">time:</span> ${escHtml(duration)}</span>` : "",
    call.task ? `<span><span class="dlbl">task:</span> ${escHtml(call.task)}</span>` : ""
  ].filter(Boolean).join("");
  return `<div class="dnode dcallnode">
<div class="dflow dcall ${cls}" data-flow="toolcall">
  <div class="drow1">
    <div class="dname">${escHtml(call.name)}<span class="didx">call #${escHtml(String(call.index || 1))}</span></div>
    <span class="dbadge">${badge}</span>
  </div>${detail ? `
  <div class="ddetail">${detail}</div>` : ""}
</div>
</div>`;
}


function renderFlowCard(node, depth = 0) {
  const f = node.f || {};
  const total   = f.total || 0;
  const done    = (f.ok || 0) + (f.fail || 0) + (f.skip || 0);
  const pct     = total > 0 ? Math.round((done / total) * 100) : (f.phase === "done" ? 100 : 0);
  const cls     = getFlowStatusCls(f);
  const badge   = getFlowBadge(f);
  const elapsed = getFmtElapsed(f.elapsedMs || 0);
  const activeTool = getStr(f.activeTool?.name || f.activeTool?.tool).trim();
  const calledTools = getCalledTools(f);
  const depthLabel = Number.isFinite(Number(f.agentDepth)) ? Number(f.agentDepth) : 0;
  const childCount = node.children.length;
  const parallelInfo = node.siblingCount > 1 ? `${node.siblingCount} parallel` : "";

  const meta = [
    f.channelId ? `<span><span class="dlbl">channel:</span> ${escHtml(f.channelId)}</span>` : "",
    f.callerChannelId ? `<span><span class="dlbl">parent:</span> ${escHtml(f.callerChannelId)}</span>` : "",
    f.callerFlow ? `<span><span class="dlbl">caller:</span> ${escHtml(f.callerFlow)}</span>` : "",
    f.agentType ? `<span><span class="dlbl">agent:</span> ${escHtml(f.agentType)}</span>` : "",
    `<span><span class="dlbl">depth:</span> ${escHtml(String(depthLabel))}</span>`,
    activeTool ? `<span><span class="dlbl">tool:</span> <strong>${escHtml(activeTool)}</strong></span>` : "",
    parallelInfo ? `<span><span class="dlbl">runs:</span> ${escHtml(parallelInfo)}</span>` : "",
    childCount ? `<span><span class="dlbl">children:</span> ${escHtml(String(childCount))}</span>` : ""
  ].filter(Boolean).join("");

  const detail = [
    f.current ? `<span><span class="dlbl">cur:</span> ${escHtml(f.current)}</span>` : "",
    f.lastModule ? `<span><span class="dlbl">last:</span> ${escHtml(f.lastModule)}</span>` : "",
    f.turnId ? `<span><span class="dlbl">turn:</span> ${escHtml(getShortId(f.turnId, 12))}</span>` : "",
    f.callerTurnId ? `<span><span class="dlbl">parent turn:</span> ${escHtml(getShortId(f.callerTurnId, 12))}</span>` : "",
    f.lastError ? `<span class="derr">${escHtml(f.lastError)}</span>` : ""
  ].filter(Boolean).join("");

  const callCards = calledTools.map(call => renderToolCallCard(call)).join("\n");
  const childCards = node.children.map(child => renderFlowCard(child, depth + 1)).join("\n");
  const children = callCards || childCards
    ? `<div class="dchildren">${[callCards, childCards].filter(Boolean).join("\n")}</div>`
    : "";
  const card = `<div class="dflow ${cls}" data-flow="${escHtml(f.flowName)}">
  <div class="drow1">
    <span class="dtwist" aria-hidden="true"></span>
    <div class="dname">${escHtml(getFlowTitle(f))}<span class="didx">${escHtml(f.flowName || "")} #${f.runIndex || 1}</span></div>
    <span class="dbadge">${badge}</span>
    <span class="dsteps">${f.ok || 0}/${total}</span>
    <span class="dtime">${elapsed}</span>
  </div>
  <div class="dprog">
    <div class="dbar"><div class="dfill" style="width:${pct}%"></div></div>
    <span class="dpct">${pct}%</span>
  </div>
  <div class="dmeta">${meta}</div>${detail ? `
  <div class="ddetail">${detail}</div>` : ""}
</div>`;

  if (!children) return `<div class="dnode">${card}</div>`;

  return `<details class="dnode dbranch" data-node-key="${escHtml(getNodeKey(f))}">
<summary>${card}</summary>
${children}
</details>`;
}


function buildDashboardHtml(data, menu, role, basePath, refreshSec, webAuth) {
  const ts      = data?.ts ? new Date(data.ts).toLocaleString() : "—";
  const memRss  = escHtml(data?.mem?.rssStr  || "—");
  const memHeap = escHtml(data?.mem?.heapStr || "—");
  const flows   = Array.isArray(data?.flows) ? data.flows : [];
  const menuHtml = getMenuHtml(menu, basePath, role, null, null, webAuth);

  const visibleFlows = flows.filter(f => !getIsDashboardRuntimeFlow(f));
  const hiddenRuntimeCount = flows.length - visibleFlows.length;
  const treeRoots = buildFlowTree(visibleFlows);
  const runningCount = visibleFlows.filter(f => f.phase !== "done" && !f.finishedAt).length;
  const agentCount = visibleFlows.filter(f => getStr(f.agentType).trim()).length;
  const activeToolCount = visibleFlows.filter(f => getStr(f.activeTool?.name || f.activeTool?.tool).trim()).length;

  const flowCards = visibleFlows.length
    ? treeRoots.map(node => renderFlowCard(node, 0)).join("\n")
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
.dflows{display:flex;flex-direction:column;gap:8px}
.dnode{position:relative;margin-left:0}
.dchildren>.dnode{margin-left:18px}
.dbranch>summary{display:block;list-style:none;cursor:pointer}
.dbranch>summary::-webkit-details-marker{display:none}
.dnode:before{
  content:"";position:absolute;left:-10px;top:0;bottom:0;
  border-left:1px solid var(--bdr);display:block;
}
.dflows>.dnode:before{display:none}
.dchildren{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.dflow{
  background:var(--card);border:1px solid var(--bdr);border-left-width:4px;
  border-radius:var(--r);padding:10px 12px;
  display:flex;flex-direction:column;gap:6px;
}
.drow1{display:flex;align-items:center;gap:8px;min-width:0}
.dtwist{
  width:12px;height:12px;display:inline-flex;align-items:center;justify-content:center;
  color:var(--muted);font-size:12px;line-height:1;flex-shrink:0;
}
.dtwist:before{content:"";display:block;width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:6px solid currentColor;transition:transform .15s}
.dbranch[open]>summary .dtwist:before{transform:rotate(90deg)}
.dnode:not(.dbranch) .dtwist{visibility:hidden}
.dname{
  font-weight:700;font-size:13px;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.didx{font-size:10px;color:var(--muted);font-weight:normal;margin-left:6px}
.dbadge{
  font-size:11px;font-weight:700;padding:2px 8px;
  border-radius:4px;white-space:nowrap;flex-shrink:0;
}
.dsteps,.dtime{font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0}
.dprog{display:flex;align-items:center;gap:8px}
.dbar{flex:1;height:6px;background:var(--bdr);border-radius:3px;overflow:hidden;min-width:0}
.dfill{height:100%;border-radius:3px;transition:width .4s}
.dpct{font-size:11px;color:var(--muted);width:30px;text-align:right;flex-shrink:0}
.dmeta,.ddetail{display:flex;gap:8px 12px;flex-wrap:wrap;font-size:11px;color:var(--muted);min-width:0}
.dmeta span,.ddetail span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dlbl{color:#94a3b8}
.derr{color:var(--dan);font-weight:600}
.dcall{border-left-style:dashed;background:color-mix(in srgb,var(--card) 86%,var(--bg) 14%)}
.dcall .dname{font-weight:650}
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
  var TREE_KEY = 'dash-tree-open';

  function loadHidden() {
    try { return JSON.parse(localStorage.getItem(KEY) || '["webpage"]'); }
    catch { return ['webpage']; }
  }
  function loadOpen() {
    try { return JSON.parse(localStorage.getItem(TREE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveOpen(opened) {
    try { localStorage.setItem(TREE_KEY, JSON.stringify(opened)); } catch {}
  }
  function applyTreeState() {
    var opened = loadOpen();
    Array.prototype.slice.call(document.querySelectorAll('details.dbranch[data-node-key]')).forEach(function(node) {
      var key = node.getAttribute('data-node-key') || '';
      if (!key) return;
      if (opened.indexOf(key) !== -1) node.setAttribute('open', '');
      node.addEventListener('toggle', function() {
        var latest = loadOpen();
        var idx = latest.indexOf(key);
        if (node.open && idx === -1) latest.push(key);
        if (!node.open && idx !== -1) latest.splice(idx, 1);
        saveOpen(latest.slice(-500));
      });
    });
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
    applyTreeState();
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
    <div class="dstat">Flows<strong>${escHtml(String(visibleFlows.length))}</strong></div>
    <div class="dstat">Running<strong>${escHtml(String(runningCount))}</strong></div>
    <div class="dstat">Agents<strong>${escHtml(String(agentCount))}</strong></div>
    <div class="dstat">Active Tools<strong>${escHtml(String(activeToolCount))}</strong></div>
    <div class="dstat">Hidden Runtime<strong>${escHtml(String(hiddenRuntimeCount))}</strong></div>
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

  function refresh(autoSelectNewest) {
    var type = currentTab;
    fetchFileList(type, function(err, files) {
      if (err) { stat.textContent = 'Error: ' + err.message; return; }
      var prevN = sel.value;
      sel.innerHTML = buildOpts(files);
      if (!files.length) { stat.textContent = 'No log files found.'; return; }
      if (autoSelectNewest || !prevN || !files.some(function(f){ return String(f.n) === prevN; })) {
        sel.selectedIndex = 0;
      } else {
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
    if (!wo.webAuth?.userId) {
      wo.http.response = { status: 302, headers: { "Location": "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
    } else if (urlPath.startsWith(basePath + "/api/")) {
      wo.http.response = { status: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "forbidden" }) };
    } else {
      const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
      wo.http.response = {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
              "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
              "<title>Dashboard</title>" + getThemeHeadScript() +
              "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
              "<header><h1>\uD83D\uDCCA Dashboard</h1>" + menuHtml + "</header>" +
              "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
              "<div style=\"text-align:center;color:var(--txt)\">" +
              "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
              "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
              "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">← Back to home</a>" +
              "</div></div></body></html>"
      };
    }
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
