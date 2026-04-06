import fs from "node:fs";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import { deleteSubagent, getSubagentManagerData, listSubagents, saveSubagent } from "../shared/webpage/subagent-manager.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-subagent-manager";

function getStr(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getBasePath(cfg) {
  const value = getStr(cfg.basePath ?? "/subagents").trim();
  return value && value.startsWith("/") ? value.replace(/\/+$/, "") : "/subagents";
}

function buildDeniedHtml(menuHtml, basePath) {
  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Subagent Manager</title>" +
    getThemeHeadScript() +
    "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
    "<header><h1>🧩 Subagent Manager</h1>" + menuHtml + "</header>" +
    "<div style=\"margin-top:var(--hh);padding:16px\">" +
    "<div style=\"padding:16px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg2)\">" +
    "<strong>Access denied</strong><br><span style=\"color:var(--muted)\">Your Discord role does not have access to this page.</span>" +
    "</div></div></body></html>";
}

function buildPageHtml(opts) {
  const basePath = String(opts.basePath || "/subagents").replace(/\/+$/, "") || "/subagents";
  const menuHtml = opts.menuHtml || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Subagent Manager</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
.sam-wrap{margin-top:var(--hh);padding:12px 14px 40px}
.sam-grid{display:grid;grid-template-columns:260px 1fr;gap:12px;align-items:start}
.sam-panel{border:1px solid var(--bdr);border-radius:12px;background:var(--bg2);overflow:hidden}
.sam-head{padding:12px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:8px}
.sam-head strong{font-size:14px}
.sam-list{list-style:none;margin:0;padding:0;max-height:calc(100dvh - var(--hh) - 120px);overflow:auto}
.sam-item{padding:10px 14px;border-bottom:1px solid var(--bdr);cursor:pointer}
.sam-item:last-child{border-bottom:none}
.sam-item:hover{background:var(--bg3)}
.sam-item.active{background:rgba(59,130,246,.12);border-left:3px solid var(--accent);padding-left:11px}
.sam-item-title{font-weight:600;font-size:13px;color:var(--txt)}
.sam-item-meta{font-size:11px;color:var(--muted);margin-top:3px;font-family:monospace}
.sam-actions{display:flex;gap:8px;flex-wrap:wrap}
.sam-actions button{padding:7px 12px}
.sam-body{padding:14px}
.sam-form{display:grid;gap:12px}
.sam-row{display:grid;grid-template-columns:160px 1fr;gap:10px;align-items:start}
.sam-row label{font-size:12px;color:var(--muted);padding-top:8px}
.sam-row input,.sam-row textarea{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.sam-row textarea{min-height:200px;resize:vertical;font-family:monospace;font-size:12px;line-height:1.45}
.sam-note{font-size:12px;color:var(--muted)}
.sam-status{font-size:12px;color:var(--muted)}
@media (max-width: 900px){
  .sam-grid{grid-template-columns:1fr}
  .sam-list{max-height:none}
  .sam-row{grid-template-columns:1fr}
  .sam-row label{padding-top:0}
}
</style>
</head>
<body>
<header>
  <h1>🧩 Subagent Manager</h1>
${menuHtml ? "  " + menuHtml : ""}
</header>
<div class="sam-wrap">
  <div class="sam-grid">
    <aside class="sam-panel">
      <div class="sam-head">
        <strong>Subagents</strong>
        <button class="btn btn-s" onclick="createNewSubagent()">New</button>
      </div>
      <ul class="sam-list" id="subagent-list">
        <li class="sam-item"><div class="sam-item-title">Loading…</div></li>
      </ul>
    </aside>
    <section class="sam-panel">
      <div class="sam-head">
        <strong id="editor-title">Editor</strong>
        <div class="sam-actions">
          <span id="save-status" class="sam-status"></span>
          <button class="btn btn-s" onclick="reloadSelected()">Reload</button>
          <button class="btn btn-s" onclick="deleteCurrent()">Delete</button>
          <button class="btn btn-s" onclick="saveCurrent()">Save</button>
        </div>
      </div>
      <div class="sam-body">
        <div class="sam-note">This page creates, updates, and removes subagent channel entries in <code>core.json</code> and the matching blocks in <code>manifests/getSubAgent.json</code>.</div>
        <div class="sam-form" style="margin-top:12px">
          <div class="sam-row">
            <label for="type-key">Type key</label>
            <input id="type-key" type="text" placeholder="history">
          </div>
          <div class="sam-row">
            <label for="channel-id">Channel ID</label>
            <input id="channel-id" type="text" placeholder="subagent-history">
          </div>
          <div class="sam-row">
            <label for="core-title">Core title</label>
            <input id="core-title" type="text" placeholder="Subagent: History">
          </div>
          <div class="sam-row">
            <label for="manifest-block">Manifest block JSON</label>
            <textarea id="manifest-block" spellcheck="false"></textarea>
          </div>
          <div class="sam-row">
            <label for="overrides-json">Core overrides JSON</label>
            <textarea id="overrides-json" spellcheck="false"></textarea>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>
var BASE = ${JSON.stringify(basePath)};
var currentTypeKey = '';
var loadedTypeKey = '';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, ms) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(function(){ t.classList.remove('on'); }, ms || 2400);
}
function setStatus(text) {
  document.getElementById('save-status').textContent = text || '';
}
function setEditorTitle(text) {
  document.getElementById('editor-title').textContent = text || 'Editor';
}
function tryPretty(value) {
  return JSON.stringify(value == null ? {} : value, null, 2);
}
function readForm() {
  var typeKey = document.getElementById('type-key').value.trim();
  var channelId = document.getElementById('channel-id').value.trim();
  var title = document.getElementById('core-title').value.trim();
  var manifestBlockText = document.getElementById('manifest-block').value.trim() || '{}';
  var overridesText = document.getElementById('overrides-json').value.trim() || '{}';
  return {
    previousTypeKey: loadedTypeKey || typeKey,
    typeKey: typeKey,
    channelId: channelId,
    title: title,
    manifestBlock: JSON.parse(manifestBlockText),
    overrides: JSON.parse(overridesText)
  };
}
function writeForm(data) {
  document.getElementById('type-key').value = data && data.typeKey ? data.typeKey : '';
  document.getElementById('channel-id').value = data && data.channelId ? data.channelId : '';
  document.getElementById('core-title').value = data && data.title ? data.title : '';
  document.getElementById('manifest-block').value = tryPretty(data && data.manifestBlock ? data.manifestBlock : {});
  document.getElementById('overrides-json').value = tryPretty(data && data.overrides ? data.overrides : {});
  currentTypeKey = data && data.typeKey ? data.typeKey : '';
  loadedTypeKey = currentTypeKey;
  setEditorTitle(currentTypeKey ? ('Editing ' + currentTypeKey) : 'New subagent');
}
function highlightCurrent() {
  document.querySelectorAll('.sam-item').forEach(function(node) {
    node.classList.remove('active');
    if (node.getAttribute('data-type-key') === currentTypeKey) node.classList.add('active');
  });
}
function loadList() {
  return fetch(BASE + '/api/list')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      var items = Array.isArray(data.items) ? data.items : [];
      var list = document.getElementById('subagent-list');
      if (!items.length) {
        list.innerHTML = '<li class="sam-item"><div class="sam-item-title">No subagents found</div></li>';
        return;
      }
      list.innerHTML = items.map(function(item) {
        return '<li class="sam-item" data-type-key="' + esc(item.typeKey) + '" onclick="selectSubagent(this.getAttribute(\\'data-type-key\\'))">' +
          '<div class="sam-item-title">' + esc(item.typeKey) + '</div>' +
          '<div class="sam-item-meta">' + esc(item.channelId || '') + '</div>' +
          '</li>';
      }).join('');
      highlightCurrent();
    });
}
function selectSubagent(typeKey) {
  currentTypeKey = typeKey;
  highlightCurrent();
  setStatus('Loading…');
  fetch(BASE + '/api/get?type=' + encodeURIComponent(typeKey))
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Failed to load subagent');
      writeForm(data.item);
      highlightCurrent();
      setStatus('');
    })
    .catch(function(err) {
      setStatus('Load failed');
      toast(err.message, 5000);
    });
}
function createNewSubagent() {
  writeForm({
    typeKey: '',
    channelId: '',
    title: '',
    manifestBlock: {
      title: '',
      manifestDescription: ''
    },
    overrides: {}
  });
  currentTypeKey = '';
  loadedTypeKey = '';
  highlightCurrent();
  setStatus('');
}
function reloadSelected() {
  if (!currentTypeKey) {
    createNewSubagent();
    return;
  }
  selectSubagent(currentTypeKey);
}
function saveCurrent() {
  var payload;
  try {
    payload = readForm();
  } catch (err) {
    toast('Invalid JSON: ' + err.message, 5000);
    return;
  }
  setStatus('Saving…');
  fetch(BASE + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Save failed');
      writeForm(data.item);
      return loadList().then(function() {
        currentTypeKey = data.item.typeKey;
        highlightCurrent();
        setStatus('Saved');
        toast('Subagent saved');
      });
    })
    .catch(function(err) {
      setStatus('Save failed');
      toast(err.message, 5000);
    });
}
function deleteCurrent() {
  var typeKey = document.getElementById('type-key').value.trim();
  if (!typeKey) return;
  if (!confirm('Delete subagent "' + typeKey + '"?')) return;
  setStatus('Deleting…');
  fetch(BASE + '/api/delete?type=' + encodeURIComponent(typeKey), { method: 'DELETE' })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Delete failed');
      createNewSubagent();
      return loadList().then(function() {
        setStatus('Deleted');
        toast('Subagent deleted');
      });
    })
    .catch(function(err) {
      setStatus('Delete failed');
      toast(err.message, 5000);
    });
}
loadList().then(function(){ createNewSubagent(); });
</script>
</body>
</html>`;
}

export default async function getWebpageSubagentManager(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3127);
  const basePath = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : ["admin"];

  if (Number(wo.http?.port) !== port) return coreData;

  const method = getStr(wo.http?.method || "GET").toUpperCase();
  const url = getStr(wo.http?.url || "/");
  const urlPath = url.split("?")[0];

  if (!urlPath.startsWith(basePath)) return coreData;

  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
      body: fs.readFileSync(cssFile, "utf-8")
    };
    wo.web = wo.web || {};
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (!getIsAllowedRoles(wo, allowedRoles)) {
    if (!wo.webAuth?.userId) {
      wo.http.response = { status: 302, headers: { Location: "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
    } else if (urlPath.startsWith(basePath + "/api/")) {
      setJsonResp(wo, 403, { ok: false, error: "forbidden" });
    } else {
      const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
      wo.http.response = {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: buildDeniedHtml(menuHtml, basePath)
      };
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    try {
      setJsonResp(wo, 200, { ok: true, items: await listSubagents() });
    } catch (error) {
      log("subagent list failed", String(error?.message || error));
      setJsonResp(wo, 500, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/get") {
    try {
      const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
      const type = getStr(params.get("type")).trim();
      setJsonResp(wo, 200, { ok: true, item: await getSubagentManagerData(type) });
    } catch (error) {
      setJsonResp(wo, 400, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/save") {
    try {
      setJsonResp(wo, 200, { ok: true, item: await saveSubagent(wo.http?.json || {}) });
    } catch (error) {
      log("subagent save failed", String(error?.message || error));
      setJsonResp(wo, 400, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "DELETE" && urlPath === basePath + "/api/delete") {
    try {
      const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
      await deleteSubagent(getStr(params.get("type")).trim());
      setJsonResp(wo, 200, { ok: true });
    } catch (error) {
      log("subagent delete failed", String(error?.message || error));
      setJsonResp(wo, 400, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    const menuHtml = getMenuHtml(wo.web?.menu || [], basePath, wo.webAuth?.role || "", null, null, wo.webAuth);
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: buildPageHtml({ basePath, menuHtml })
    };
    wo.web = wo.web || {};
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}
