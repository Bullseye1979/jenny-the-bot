/**************************************************************/
/* filename: "00066-webpage-manifests.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/
import fs from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getStr } from "../core/utils.js";

const _manifestDir = join(dirname(fileURLToPath(import.meta.url)), "../manifests");

async function listManifestNames() {
  const files = await readdir(_manifestDir);
  return files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
}

async function readManifest(name) {
  if (!name || !/^[a-zA-Z0-9_\-.]+$/.test(name)) throw new Error("Invalid manifest name");
  const raw = await readFile(join(_manifestDir, name + ".json"), "utf-8");
  return JSON.parse(raw);
}

async function writeManifest(name, data) {
  if (!name || !/^[a-zA-Z0-9_\-.]+$/.test(name)) throw new Error("Invalid manifest name");
  await writeFile(join(_manifestDir, name + ".json"), JSON.stringify(data, null, 2), "utf-8");
}

const MODULE_NAME = "webpage-manifests";

function getBasePath(cfg) {
  const value = getStr(cfg.basePath ?? "/manifests").trim();
  return value && value.startsWith("/") ? value.replace(/\/+$/, "") : "/manifests";
}

function buildDeniedHtml(menuHtml, activePath, webAuth) {
  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Manifest Editor</title>" +
    getThemeHeadScript() +
    "<link rel=\"stylesheet\" href=\"" + activePath + "/style.css\"></head><body>" +
    "<header><h1>📄 Manifest Editor</h1>" + menuHtml + "</header>" +
    "<div style=\"margin-top:var(--hh);padding:16px\">" +
    "<div style=\"padding:16px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg2)\">" +
    "<strong>Access denied</strong><br><span style=\"color:var(--muted)\">Your Discord role does not have access to this page.</span>" +
    "</div></div></body></html>";
}

function buildPageHtml(opts) {
  const basePath = String(opts.basePath || "/manifests").replace(/\/+$/, "") || "/manifests";
  const menuHtml = opts.menuHtml || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Manifest Editor</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
.cfg-wrap{margin-top:var(--hh);height:calc(100dvh - var(--hh));overflow-y:auto;padding:12px 14px 40px}
.cfg-topbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.cfg-select{min-width:220px;max-width:100%;border:1px solid var(--bdr);border-radius:6px;padding:6px 10px;font-size:13px;background:var(--bg);color:var(--txt)}
.cfg-note{font-size:12px;color:var(--muted)}
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
</style>
</head>
<body>
<header>
  <h1>📄 Manifest Editor</h1>
${menuHtml ? "  " + menuHtml : ""}
</header>
<div class="cfg-wrap">
  <div class="cfg-topbar">
    <select id="manifest-select" class="cfg-select" onchange="onManifestChange()">
      <option value="">Select a manifest</option>
    </select>
    <button class="btn btn-s" onclick="loadManifestList()">Reload list</button>
    <button class="btn btn-s" onclick="loadSelectedManifest()">Reload manifest</button>
    <button class="btn btn-s" onclick="expandAll()">Expand all</button>
    <button class="btn btn-s" onclick="collapseAll()">Collapse all</button>
    <span id="status-lbl" style="font-size:12px;color:var(--muted)"></span>
    <button id="save-btn" disabled onclick="saveManifest()">Saved</button>
  </div>
  <div class="cfg-note">Structured manifest editor. Select a manifest from the list and edit its fields directly.</div>
  <div id="cfg-tree" style="margin-top:10px"></div>
</div>
<div id="toast" class="toast"></div>
<script>
var BASE = ${JSON.stringify(basePath)};
var DATA = null;
var dirty = false;
var currentManifest = "";
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
function setDirty(v) {
  dirty = !!v;
  var btn = document.getElementById('save-btn');
  var lbl = document.getElementById('status-lbl');
  if (!currentManifest) {
    btn.disabled = true;
    btn.textContent = 'Saved';
    lbl.textContent = '';
    return;
  }
  if (dirty) {
    btn.disabled = false;
    btn.textContent = 'Save';
    btn.className = 'dirty';
    lbl.textContent = 'Unsaved changes in ' + currentManifest;
  } else {
    btn.disabled = true;
    btn.textContent = 'Saved';
    btn.className = '';
    lbl.textContent = currentManifest ? ('Editing ' + currentManifest) : '';
  }
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
function removeAtPath(path) {
  if (!path || !path.length) return;
  var parent = path.length > 1 ? getAtPath(DATA, path.slice(0, -1)) : DATA;
  var key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(key, 1);
  else if (parent && typeof parent === 'object') delete parent[key];
  setDirty(true);
  var sy = window.scrollY;
  render(DATA);
  requestAnimationFrame(function() { window.scrollTo(0, sy); });
}
function addToObject(path, name, value) {
  var obj = path.length ? getAtPath(DATA, path) : DATA;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  obj[name] = value;
  setDirty(true);
  renderAndFocus(path);
}
function addItemToArray(path) {
  var arr = path.length ? getAtPath(DATA, path) : DATA;
  if (!Array.isArray(arr)) return;
  arr.push({});
  setDirty(true);
  renderAndFocus(path);
}
function renderAndFocus(path) {
  render(DATA);
  if (!path || !path.length) return;
  var pathStr = JSON.stringify(path);
  requestAnimationFrame(function() {
    var sections = document.querySelectorAll('.cs[data-cfgpath]');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getAttribute('data-cfgpath') === pathStr) {
        sections[i].classList.add('open');
        sections[i].scrollIntoView({ behavior: 'instant', block: 'nearest' });
        break;
      }
    }
  });
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
function renderFlatArray(key, arr, path) {
  var wrap = document.createElement('div');
  wrap.className = 'cf cf-d';
  var lbl = document.createElement('label');
  lbl.textContent = key;
  wrap.appendChild(lbl);
  var tags = document.createElement('div');
  tags.className = 'cfg-tags';
  function refresh() {
    tags.innerHTML = '';
    var cur = getAtPath(DATA, path);
    if (!Array.isArray(cur)) cur = [];
    cur.forEach(function(item, i) {
      var tag = document.createElement('span');
      tag.className = 'cfg-tag';
      tag.innerHTML = esc(String(item == null ? 'null' : item)) + '<button class="cfg-tag-del" title="Remove">&#215;</button>';
      (function(idx) {
        tag.querySelector('button').onclick = function() {
          cur.splice(idx, 1);
          setDirty(true);
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
          setDirty(true);
          refresh();
        }
      } else if (e.key === 'Backspace' && !inp.value && cur.length) {
        cur.pop();
        setDirty(true);
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
    removeAtPath(path);
  };
  wrap.appendChild(del);
  return wrap;
}
function renderField(key, value, path) {
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
    ctrl.oninput = function() {
      setAtPath(DATA, path, ctrl.value === 'null' ? null : ctrl.value);
      setDirty(true);
    };
  } else if (typeof value === 'boolean') {
    ctrl = document.createElement('input');
    ctrl.type = 'checkbox';
    ctrl.checked = value;
    ctrl.onchange = function() {
      setAtPath(DATA, path, ctrl.checked);
      setDirty(true);
    };
  } else if (typeof value === 'number') {
    ctrl = document.createElement('input');
    ctrl.type = 'number';
    ctrl.value = String(value);
    ctrl.step = Number.isInteger(value) ? '1' : 'any';
    ctrl.onchange = function() {
      setAtPath(DATA, path, Number(ctrl.value));
      setDirty(true);
    };
  } else {
    var s = String(value == null ? '' : value);
    if (isPassword(key)) {
      ctrl = document.createElement('div');
      ctrl.className = 'cfg-pw-row';
      var inp = document.createElement('input');
      inp.type = 'password';
      inp.value = s;
      inp.oninput = function() {
        setAtPath(DATA, path, inp.value);
        setDirty(true);
      };
      var eye = document.createElement('button');
      eye.className = 'cfg-eye';
      eye.type = 'button';
      eye.innerHTML = '&#128065;';
      eye.title = 'Show / hide';
      eye.onclick = function() { inp.type = inp.type === 'password' ? 'text' : 'password'; };
      ctrl.appendChild(inp);
      ctrl.appendChild(eye);
    } else if (needsTextarea(s)) {
      ctrl = document.createElement('textarea');
      ctrl.value = s;
      ctrl.rows = Math.min(Math.max((s.match(/\\n/g) || []).length + 2, 3), 14);
      ctrl.oninput = function() {
        setAtPath(DATA, path, ctrl.value);
        setDirty(true);
      };
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'text';
      ctrl.value = s;
      ctrl.oninput = function() {
        setAtPath(DATA, path, ctrl.value);
        setDirty(true);
      };
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
    removeAtPath(path);
  };
  wrap.appendChild(del);
  return wrap;
}
function renderObject(key, obj, path, depth) {
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
      var cur = String(getAtPath(DATA, path.concat(['_title'])) != null ? getAtPath(DATA, path.concat(['_title'])) : '');
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
        setAtPath(DATA, path.concat(['_title']), inp.value);
        setDirty(true);
        var span = document.createElement('span');
        span.className = 'cs-title';
        span.textContent = getTitle(key, obj);
        inp.replaceWith(span);
        titleSpan = span;
        pencil.style.display = '';
      }
      inp.onblur = commit;
      inp.onkeydown = function(ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        }
        if (ev.key === 'Escape') {
          inp.value = cur;
          commit();
        }
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
      removeAtPath(path);
    };
    s.hdr.appendChild(del);
  }
  Object.keys(obj).forEach(function(k) {
    if (k === '__description' || k === '_title') return;
    s.body.appendChild(renderValue(k, obj[k], path.concat([k]), depth + 1));
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
    addToObject(path, name.trim(), val);
  };
  var btnBlock = document.createElement('button');
  btnBlock.type = 'button';
  btnBlock.textContent = '+ Block';
  btnBlock.onclick = function() {
    var name = prompt('Block name:');
    if (!name || !name.trim()) return;
    addToObject(path, name.trim(), {});
  };
  addBar.appendChild(btnAttr);
  addBar.appendChild(btnBlock);
  s.body.appendChild(addBar);
  return s.section;
}
function renderObjectArray(key, arr, path, depth) {
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
      removeAtPath(path);
    };
    s.hdr.appendChild(del);
  }
  arr.forEach(function(item, i) {
    var childPath = path.concat([i]);
    if (item && typeof item === 'object' && !Array.isArray(item)) s.body.appendChild(renderObject(null, item, childPath, depth + 1));
    else s.body.appendChild(renderField('[' + i + ']', item, childPath));
  });
  var addBar = document.createElement('div');
  addBar.className = 'cs-add-bar';
  var btnItem = document.createElement('button');
  btnItem.type = 'button';
  btnItem.textContent = '+ Add item';
  btnItem.onclick = function() { addItemToArray(path); };
  addBar.appendChild(btnItem);
  s.body.appendChild(addBar);
  return s.section;
}
function renderValue(key, value, path, depth) {
  if (Array.isArray(value)) return isFlat(value) ? renderFlatArray(key, value, path) : renderObjectArray(key, value, path, depth);
  if (value && typeof value === 'object') return renderObject(key, value, path, depth);
  return renderField(key, value, path);
}
function render(cfg) {
  var tree = document.getElementById('cfg-tree');
  tree.innerHTML = '';
  if (!cfg || typeof cfg !== 'object') {
    tree.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Select a manifest to begin.</div>';
    return;
  }
  Object.keys(cfg).forEach(function(k) {
    if (k === '__description') return;
    tree.appendChild(renderValue(k, cfg[k], [k], 0));
  });
}
function expandAll() { document.querySelectorAll('.cs').forEach(function(s){ s.classList.add('open'); }); }
function collapseAll() { document.querySelectorAll('.cs').forEach(function(s){ s.classList.remove('open'); }); }
function setManifestOptions(names) {
  var select = document.getElementById('manifest-select');
  select.innerHTML = '<option value="">Select a manifest</option>' + names.map(function(name) {
    return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
  }).join('');
  if (currentManifest) select.value = currentManifest;
}
function loadManifestList() {
  return fetch(BASE + '/api/list')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var names = Array.isArray(data.names) ? data.names : [];
      setManifestOptions(names);
      if (!currentManifest && names.length) {
        currentManifest = names[0];
        document.getElementById('manifest-select').value = currentManifest;
      }
      if (currentManifest && names.indexOf(currentManifest) >= 0) return loadSelectedManifest();
      DATA = null;
      render(DATA);
      setDirty(false);
    })
    .catch(function(err) {
      document.getElementById('cfg-tree').innerHTML = '<div style="padding:16px;color:#c00;font-size:13px">List error: ' + esc(err.message) + '</div>';
    });
}
function onManifestChange() {
  var nextName = document.getElementById('manifest-select').value;
  if (nextName === currentManifest) return;
  if (dirty && !confirm('Discard unsaved changes in ' + currentManifest + '?')) {
    document.getElementById('manifest-select').value = currentManifest;
    return;
  }
  currentManifest = nextName;
  loadSelectedManifest();
}
function loadSelectedManifest() {
  if (!currentManifest) {
    DATA = null;
    render(DATA);
    setDirty(false);
    return Promise.resolve();
  }
  document.getElementById('cfg-tree').innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div>';
  return fetch(BASE + '/api/get?name=' + encodeURIComponent(currentManifest))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Failed to load manifest');
      DATA = data.data;
      render(DATA);
      setDirty(false);
      toast('Loaded ' + currentManifest);
    })
    .catch(function(err) {
      document.getElementById('cfg-tree').innerHTML = '<div style="padding:16px;color:#c00;font-size:13px">Load error: ' + esc(err.message) + '</div>';
    });
}
function saveManifest() {
  if (!currentManifest || !DATA) return;
  var btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  fetch(BASE + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: currentManifest, data: DATA })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Save failed');
      setDirty(false);
      toast('Manifest saved');
    })
    .catch(function(err) {
      toast('Save failed: ' + err.message, 6000);
      btn.textContent = 'Save';
      btn.disabled = false;
      btn.className = 'dirty';
    });
}
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (dirty) saveManifest();
  }
});
loadManifestList();
</script>
</body>
</html>`;
}

export default async function getWebpageManifests(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3126);
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
        body: buildDeniedHtml(menuHtml, basePath, wo.webAuth)
      };
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    try {
      setJsonResp(wo, 200, { ok: true, names: await listManifestNames() });
    } catch (error) {
      log("manifest list failed", String(error?.message || error));
      setJsonResp(wo, 500, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/get") {
    try {
      const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
      const name = getStr(params.get("name")).trim();
      setJsonResp(wo, 200, { ok: true, name, data: await readManifest(name) });
    } catch (error) {
      const notFound = error?.code === "ENOENT";
      setJsonResp(wo, notFound ? 404 : 400, { ok: false, error: String(error?.message || error) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/save") {
    try {
      const body = wo.http?.json || {};
      await writeManifest(body.name, body.data);
      setJsonResp(wo, 200, { ok: true });
    } catch (error) {
      log("manifest save failed", String(error?.message || error));
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
