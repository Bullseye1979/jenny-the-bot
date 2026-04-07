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
.sam-wrap{margin-top:var(--hh);padding:12px 14px 40px;overflow-x:hidden}
.sam-grid{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:12px;align-items:start;width:100%;min-width:0}
.sam-panel{border:1px solid var(--bdr);border-radius:12px;background:var(--bg2);overflow:hidden;min-width:0}
.sam-head{padding:12px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:8px}
.sam-head strong{font-size:14px}
.sam-list{list-style:none;margin:0;padding:0;max-height:calc(100dvh - var(--hh) - 120px);overflow:auto}
.sam-item{padding:10px 14px;border-bottom:1px solid var(--bdr);cursor:pointer;width:100%;display:block}
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
.sam-row input{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.sam-note{font-size:12px;color:var(--muted)}
.sam-status{font-size:12px;color:var(--muted)}
.sam-editor-host{border:1px solid var(--bdr);border-radius:10px;background:var(--bg);padding:10px}
.sam-editor-toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.sam-editor-toolbar button{font-size:11px;padding:4px 10px}
.cs{border:1px solid var(--bdr);border-radius:8px;margin-bottom:8px;background:var(--bg2);overflow:hidden}
.cs-hdr{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;user-select:none;background:var(--bg2)}
.cs.open>.cs-hdr{border-radius:8px 8px 0 0}
.cs-hdr:hover{background:var(--bg3)}
.cs-arrow{font-size:10px;transition:transform .15s;display:inline-block;color:var(--muted)}
.cs.open>.cs-hdr>.cs-arrow{transform:rotate(90deg)}
.cs-title{font-weight:600;font-size:13px;flex:1;color:var(--txt)}
.cs-badge{font-size:11px;color:var(--muted);background:rgba(128,128,128,.15);border-radius:10px;padding:1px 7px}
.cs-body{display:none;padding:10px 14px 12px;grid-gap:7px}
.cs.open>.cs-body{display:grid}
.cs .cs{margin-bottom:4px}
.cs .cs .cs-hdr{background:var(--bg)}
.cs .cs .cs .cs-hdr{background:var(--bg2)}
.cf{display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:start}
.cf label{font-size:12px;color:var(--muted);padding-top:5px;word-break:break-word;overflow-wrap:anywhere}
.cf input[type=text],.cf input[type=number],.cf input[type=password]{width:100%;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:13px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.cf textarea{width:100%;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:12px;font-family:monospace;line-height:1.4;background:var(--bg);color:var(--txt);resize:vertical;min-height:54px;box-sizing:border-box}
.cf input[type=checkbox]{margin-top:6px;width:16px;height:16px;cursor:pointer;accent-color:var(--accent)}
.cfg-pw-row{display:flex;gap:4px;width:100%}
.cfg-pw-row input{flex:1;min-width:0}
.cfg-eye{padding:3px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--txt);cursor:pointer;font-size:13px;line-height:1.4}
.cfg-tags{display:flex;flex-wrap:wrap;gap:4px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);min-height:32px;align-items:center}
.cfg-tag{display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;border-radius:12px;padding:2px 4px 2px 9px;font-size:12px;line-height:1.4}
.cfg-tag-del{background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;padding:0 5px;font-size:15px;line-height:1}
.cfg-tag-del:hover{color:#fff}
.cfg-tag-inp{border:none;background:none;outline:none;font-size:12px;min-width:60px;color:var(--txt);padding:0 2px}
.cs-edit{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 3px;border-radius:4px;flex-shrink:0;opacity:.65}
.cs-edit:hover{opacity:1;color:var(--accent)}
.cs-title-inp{flex:1;border:1px solid var(--accent);border-radius:4px;padding:1px 6px;font-size:13px;font-weight:600;background:var(--bg2);color:var(--txt);min-width:60px;outline:none}
.cs-del{margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:17px;line-height:1;padding:0 2px;border-radius:4px;flex-shrink:0}
.cs-del:hover{color:#c00;background:rgba(200,0,0,.08)}
.cf-del{background:none;border:none;color:var(--muted);cursor:pointer;font-size:17px;line-height:1;padding:0 4px;border-radius:4px;align-self:center}
.cf-del:hover{color:#c00;background:rgba(200,0,0,.08)}
.cf.cf-d{grid-template-columns:160px 1fr auto}
.cs-add-bar{display:flex;gap:6px;padding:4px 0 0;margin-top:2px;border-top:1px dashed var(--bdr)}
.cs-add-bar button{font-size:11px;padding:2px 8px;border:1px dashed var(--bdr);border-radius:5px;background:none;color:var(--muted);cursor:pointer}
.cs-add-bar button:hover{color:var(--accent);border-color:var(--accent);background:rgba(128,128,255,.07)}
@media (max-width: 900px){
  html,body{overflow-x:hidden;overflow-y:auto}
  .sam-wrap{padding:12px 0 40px}
  .sam-grid{display:flex;flex-direction:column;gap:12px;width:100%}
  .sam-panel{width:100%;max-width:100%;border-left:none;border-right:none;border-radius:0}
  .sam-head{padding:12px 14px}
  .sam-list{max-height:none}
  .sam-item{width:100%;box-sizing:border-box}
  .sam-body{padding:14px}
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
    <aside class="sam-panel" id="subagent-list-panel">
      <div class="sam-head">
        <strong>Subagents</strong>
        <button class="btn btn-s" onclick="createNewSubagent()">New</button>
      </div>
      <ul class="sam-list" id="subagent-list">
        <li class="sam-item"><div class="sam-item-title">Loading…</div></li>
      </ul>
    </aside>
    <section class="sam-panel" id="subagent-editor-panel">
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
            <label>Manifest block</label>
            <div class="sam-editor-host">
              <div class="sam-editor-toolbar">
                <button class="btn btn-s" type="button" onclick="expandEditor('manifest')">Expand all</button>
                <button class="btn btn-s" type="button" onclick="collapseEditor('manifest')">Collapse all</button>
              </div>
              <div id="manifest-editor"></div>
            </div>
          </div>
          <div class="sam-row">
            <label>Core overrides</label>
            <div class="sam-editor-host">
              <div class="sam-editor-toolbar">
                <button class="btn btn-s" type="button" onclick="expandEditor('overrides')">Expand all</button>
                <button class="btn btn-s" type="button" onclick="collapseEditor('overrides')">Collapse all</button>
              </div>
              <div id="overrides-editor"></div>
            </div>
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
var MANIFEST_DATA = {};
var OVERRIDES_DATA = {};
var SECRET_RE = /key|secret|token|password|bearer/i;
var TITLE_FIELDS = ['_title','name','label','id','channelId','channelMatch','text','cron','path','title','type'];
var TEXTAREA_LEN = 120;

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
function focusEditorOnMobile() {
  if (window.innerWidth > 900) return;
  var panel = document.getElementById('subagent-editor-panel');
  if (!panel) return;
  requestAnimationFrame(function() {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
function getEditorState(kind) {
  return kind === 'manifest' ? MANIFEST_DATA : OVERRIDES_DATA;
}
function setEditorState(kind, value) {
  if (kind === 'manifest') MANIFEST_DATA = value || {};
  else OVERRIDES_DATA = value || {};
}
function getEditorHost(kind) {
  return document.getElementById(kind === 'manifest' ? 'manifest-editor' : 'overrides-editor');
}
function getAtPath(obj, path) {
  var cur = obj;
  for (var i = 0; i < path.length; i++) {
    if (cur == null) return undefined;
    cur = cur[path[i]];
  }
  return cur;
}
function setAtPath(obj, path, val) {
  var cur = obj;
  for (var i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = val;
}
function renderAndFocus(kind, path) {
  renderEditor(kind);
  if (!path || !path.length) return;
  var pathStr = JSON.stringify(path);
  requestAnimationFrame(function() {
    var sections = getEditorHost(kind).querySelectorAll('.cs[data-cfgpath]');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getAttribute('data-cfgpath') === pathStr) {
        sections[i].classList.add('open');
        sections[i].scrollIntoView({ behavior: 'instant', block: 'nearest' });
        break;
      }
    }
  });
}
function removeAtEditorPath(kind, path) {
  var data = getEditorState(kind);
  if (!path || !path.length) return;
  var parent = path.length > 1 ? getAtPath(data, path.slice(0, -1)) : data;
  var key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(key, 1);
  else if (parent && typeof parent === 'object') delete parent[key];
  renderEditor(kind);
}
function addToEditorObject(kind, path, name, value) {
  var data = getEditorState(kind);
  var obj = path.length ? getAtPath(data, path) : data;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  obj[name] = value;
  renderAndFocus(kind, path);
}
function addItemToEditorArray(kind, path) {
  var data = getEditorState(kind);
  var arr = path.length ? getAtPath(data, path) : data;
  if (!Array.isArray(arr)) return;
  arr.push({});
  renderAndFocus(kind, path);
}
function getTitle(key, obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (var i = 0; i < TITLE_FIELDS.length; i++) {
      var f = TITLE_FIELDS[i];
      if (typeof obj[f] === 'string' && obj[f]) return obj[f];
    }
  }
  return key != null ? String(key) : 'Item';
}
function isFlat(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== null && typeof arr[i] === 'object') return false;
  }
  return true;
}
function isPassword(key) {
  return SECRET_RE.test(String(key));
}
function needsTextarea(val) {
  var s = String(val == null ? '' : val);
  return s.indexOf('\\n') >= 0 || s.length > TEXTAREA_LEN;
}
function mkSection(titleText, depth, defaultOpen) {
  var section = document.createElement('div');
  section.className = 'cs';
  if (defaultOpen) section.classList.add('open');
  var hdr = document.createElement('div');
  hdr.className = 'cs-hdr';
  hdr.innerHTML = '<span class="cs-arrow">&#9658;</span><span class="cs-title">' + esc(titleText) + '</span>';
  hdr.onclick = function() { section.classList.toggle('open'); };
  var body = document.createElement('div');
  body.className = 'cs-body';
  section.appendChild(hdr);
  section.appendChild(body);
  return { section: section, hdr: hdr, body: body };
}
function renderFlatArray(kind, key, arr, path) {
  var wrap = document.createElement('div');
  wrap.className = 'cf cf-d';
  var lbl = document.createElement('label');
  lbl.textContent = key;
  wrap.appendChild(lbl);
  var tags = document.createElement('div');
  tags.className = 'cfg-tags';
  function refresh() {
    tags.innerHTML = '';
    var cur = getAtPath(getEditorState(kind), path);
    if (!Array.isArray(cur)) cur = [];
    cur.forEach(function(item, i) {
      var tag = document.createElement('span');
      tag.className = 'cfg-tag';
      tag.innerHTML = esc(String(item == null ? 'null' : item)) + '<button class="cfg-tag-del" title="Remove">&#215;</button>';
      (function(idx) {
        tag.querySelector('button').onclick = function() {
          cur.splice(idx, 1);
          refresh();
        };
      })(i);
      tags.appendChild(tag);
    });
    var inp = document.createElement('input');
    inp.className = 'cfg-tag-inp';
    inp.type = 'text';
    inp.placeholder = '+ add';
    inp.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var v = inp.value.trim().replace(/,$/, '');
        if (v) {
          cur.push(v);
          refresh();
        }
      } else if (e.key === 'Backspace' && !inp.value && cur.length) {
        cur.pop();
        refresh();
      }
    };
    tags.appendChild(inp);
  }
  refresh();
  wrap.appendChild(tags);
  var del = document.createElement('button');
  del.className = 'cf-del';
  del.type = 'button';
  del.title = 'Remove';
  del.innerHTML = '&#215;';
  del.onclick = function() {
    if (!confirm('Remove "' + key + '"?')) return;
    removeAtEditorPath(kind, path);
  };
  wrap.appendChild(del);
  return wrap;
}
function renderField(kind, key, value, path) {
  var wrap = document.createElement('div');
  wrap.className = 'cf cf-d';
  var lbl = document.createElement('label');
  lbl.textContent = key;
  wrap.appendChild(lbl);
  var ctrl;
  if (value === null || value === undefined) {
    ctrl = document.createElement('input');
    ctrl.type = 'text';
    ctrl.value = 'null';
    ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value === 'null' ? null : ctrl.value); };
  } else if (typeof value === 'boolean') {
    ctrl = document.createElement('input');
    ctrl.type = 'checkbox';
    ctrl.checked = value;
    ctrl.onchange = function() { setAtPath(getEditorState(kind), path, ctrl.checked); };
  } else if (typeof value === 'number') {
    ctrl = document.createElement('input');
    ctrl.type = 'number';
    ctrl.value = String(value);
    ctrl.step = Number.isInteger(value) ? '1' : 'any';
    ctrl.onchange = function() { setAtPath(getEditorState(kind), path, Number(ctrl.value)); };
  } else {
    var s = String(value == null ? '' : value);
    if (isPassword(key)) {
      ctrl = document.createElement('div');
      ctrl.className = 'cfg-pw-row';
      var inp = document.createElement('input');
      inp.type = 'password';
      inp.value = s;
      inp.oninput = function() { setAtPath(getEditorState(kind), path, inp.value); };
      var eye = document.createElement('button');
      eye.className = 'cfg-eye';
      eye.type = 'button';
      eye.innerHTML = '&#128065;';
      eye.onclick = function() { inp.type = inp.type === 'password' ? 'text' : 'password'; };
      ctrl.appendChild(inp);
      ctrl.appendChild(eye);
    } else if (needsTextarea(s)) {
      ctrl = document.createElement('textarea');
      ctrl.value = s;
      ctrl.rows = Math.min(Math.max((s.match(/\\n/g) || []).length + 2, 3), 14);
      ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value); };
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'text';
      ctrl.value = s;
      ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value); };
    }
  }
  wrap.appendChild(ctrl);
  var del = document.createElement('button');
  del.className = 'cf-del';
  del.type = 'button';
  del.title = 'Remove';
  del.innerHTML = '&#215;';
  del.onclick = function() {
    if (!confirm('Remove "' + key + '"?')) return;
    removeAtEditorPath(kind, path);
  };
  wrap.appendChild(del);
  return wrap;
}
function renderObject(kind, key, obj, path, depth) {
  var s = mkSection(getTitle(key, obj), depth, depth < 1);
  s.section.setAttribute('data-cfgpath', JSON.stringify(path));
  if ('_title' in obj) {
    var titleSpan = s.hdr.querySelector('.cs-title');
    var pencil = document.createElement('button');
    pencil.className = 'cs-edit';
    pencil.type = 'button';
    pencil.title = 'Edit title';
    pencil.innerHTML = '&#9998;';
    pencil.onclick = function(e) {
      e.stopPropagation();
      var cur = String(getAtPath(getEditorState(kind), path.concat(['_title'])) != null ? getAtPath(getEditorState(kind), path.concat(['_title'])) : '');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = cur;
      inp.className = 'cs-title-inp';
      titleSpan.replaceWith(inp);
      pencil.style.display = 'none';
      inp.focus();
      inp.select();
      var committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        setAtPath(getEditorState(kind), path.concat(['_title']), inp.value);
        var span = document.createElement('span');
        span.className = 'cs-title';
        span.textContent = getTitle(key, obj);
        inp.replaceWith(span);
        titleSpan = span;
        pencil.style.display = '';
      }
      inp.onblur = commit;
      inp.onkeydown = function(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { inp.value = cur; commit(); }
      };
    };
    s.hdr.appendChild(pencil);
  }
  if (path.length > 0) {
    var del = document.createElement('button');
    del.className = 'cs-del';
    del.type = 'button';
    del.title = 'Remove block';
    del.innerHTML = '&#215;';
    del.onclick = function(e) {
      e.stopPropagation();
      var label = key != null ? String(key) : getTitle(null, obj);
      if (!confirm('Remove "' + label + '"?')) return;
      removeAtEditorPath(kind, path);
    };
    s.hdr.appendChild(del);
  }
  Object.keys(obj).forEach(function(k) {
    if (k === '__description' || k === '_title') return;
    s.body.appendChild(renderEditorValue(kind, k, obj[k], path.concat([k]), depth + 1));
  });
  var addBar = document.createElement('div');
  addBar.className = 'cs-add-bar';
  var btnAttr = document.createElement('button');
  btnAttr.type = 'button';
  btnAttr.textContent = '+ Attribute';
  btnAttr.onclick = function() {
    var name = prompt('Attribute name:');
    if (!name || !name.trim()) return;
    var val = prompt('Value:', '');
    if (val === null) return;
    addToEditorObject(kind, path, name.trim(), val);
  };
  var btnBlock = document.createElement('button');
  btnBlock.type = 'button';
  btnBlock.textContent = '+ Block';
  btnBlock.onclick = function() {
    var name = prompt('Block name:');
    if (!name || !name.trim()) return;
    addToEditorObject(kind, path, name.trim(), {});
  };
  addBar.appendChild(btnAttr);
  addBar.appendChild(btnBlock);
  s.body.appendChild(addBar);
  return s.section;
}
function renderObjectArray(kind, key, arr, path, depth) {
  var s = mkSection(key, depth, false);
  s.section.setAttribute('data-cfgpath', JSON.stringify(path));
  var badge = document.createElement('span');
  badge.className = 'cs-badge';
  badge.textContent = arr.length;
  s.hdr.appendChild(badge);
  if (path.length > 0) {
    var del = document.createElement('button');
    del.className = 'cs-del';
    del.type = 'button';
    del.title = 'Remove array';
    del.innerHTML = '&#215;';
    del.onclick = function(e) {
      e.stopPropagation();
      if (!confirm('Remove "' + key + '"?')) return;
      removeAtEditorPath(kind, path);
    };
    s.hdr.appendChild(del);
  }
  arr.forEach(function(item, i) {
    var childPath = path.concat([i]);
    if (item && typeof item === 'object' && !Array.isArray(item)) s.body.appendChild(renderObject(kind, null, item, childPath, depth + 1));
    else s.body.appendChild(renderField(kind, '[' + i + ']', item, childPath));
  });
  var addBar = document.createElement('div');
  addBar.className = 'cs-add-bar';
  var btnItem = document.createElement('button');
  btnItem.type = 'button';
  btnItem.textContent = '+ Add item';
  btnItem.onclick = function() { addItemToEditorArray(kind, path); };
  addBar.appendChild(btnItem);
  s.body.appendChild(addBar);
  return s.section;
}
function renderEditorValue(kind, key, value, path, depth) {
  if (Array.isArray(value)) return isFlat(value) ? renderFlatArray(kind, key, value, path) : renderObjectArray(kind, key, value, path, depth);
  if (value && typeof value === 'object') return renderObject(kind, key, value, path, depth);
  return renderField(kind, key, value, path);
}
function renderEditor(kind) {
  var data = getEditorState(kind);
  var host = getEditorHost(kind);
  host.innerHTML = '';
  Object.keys(data || {}).forEach(function(k) {
    if (k === '__description') return;
    host.appendChild(renderEditorValue(kind, k, data[k], [k], 0));
  });
}
function expandEditor(kind) {
  getEditorHost(kind).querySelectorAll('.cs').forEach(function(node){ node.classList.add('open'); });
}
function collapseEditor(kind) {
  getEditorHost(kind).querySelectorAll('.cs').forEach(function(node){ node.classList.remove('open'); });
}
function readForm() {
  var typeKey = document.getElementById('type-key').value.trim();
  var channelId = document.getElementById('channel-id').value.trim();
  var title = document.getElementById('core-title').value.trim();
  return {
    previousTypeKey: loadedTypeKey || typeKey,
    typeKey: typeKey,
    channelId: channelId,
    title: title,
    manifestBlock: MANIFEST_DATA || {},
    overrides: OVERRIDES_DATA || {}
  };
}
function writeForm(data) {
  document.getElementById('type-key').value = data && data.typeKey ? data.typeKey : '';
  document.getElementById('channel-id').value = data && data.channelId ? data.channelId : '';
  document.getElementById('core-title').value = data && data.title ? data.title : '';
  setEditorState('manifest', data && data.manifestBlock ? data.manifestBlock : {});
  setEditorState('overrides', data && data.overrides ? data.overrides : {});
  renderEditor('manifest');
  renderEditor('overrides');
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
      focusEditorOnMobile();
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
  focusEditorOnMobile();
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
