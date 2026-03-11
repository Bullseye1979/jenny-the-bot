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
* functionSignature: getIsAllowedRoles (wo, allowedRoles)
********************************************************************************************************************/
function getIsAllowedRoles(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;

  const have = new Set();
  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary) have.add(primary);

  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (v) have.add(v);
    }
  }

  for (const r of req) {
    const need = String(r || "").trim().toLowerCase();
    if (!need) continue;
    if (have.has(need)) return true;
  }
  return false;
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

  const method  = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  /* Never intercept auth paths on loginPort */
  if (urlPath === "/auth" || urlPath.startsWith("/auth/")) return coreData;

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

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
    if (!isAllowed) {
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: getAccessDeniedHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, base: basePath, title: "Config", message: "Access denied." })
      };
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

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
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const result = readJsonFile(cfgFile);
    if (!result.ok) setJsonResp(wo, 500, { error: result.error });
    else setJsonResp(wo, 200, result.data);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /config/api/config ---- */
  if (method === "POST" && urlPath === basePath + "/api/config") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

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
* functionSignature: getAccessDeniedHtml (opts)
* Purpose: Shows menu + access denied message, leaves rest of page empty.
********************************************************************************************************************/
function getAccessDeniedHtml(opts) {
  const base       = String(opts?.base || "/").replace(/\/+$|\/+$/g,"") || "/";
  const activePath = String(opts?.activePath || base) || base;
  const role       = String(opts?.role || "").trim();
  const menuHtml   = getMenuHtml(opts?.menu || [], activePath, role);

  const title = String(opts?.title || "Page");
  const msg   = String(opts?.message || "Access denied.");

  return (
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>⚙️ Config</title>\n' +
'<link rel="stylesheet" href="' + base + '/style.css">\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <h1>⚙️ Config</h1>\n' +
(menuHtml ? ('  ' + menuHtml + '\n') : '') +
'</header>\n' +
'<div style="margin-top:var(--hh);padding:12px">\n' +
'  <div style="padding:12px;border:1px solid var(--bdr);border-radius:10px;background:#fff">\n' +
'    <strong>Access denied</strong><br>\n' +
'    <span style="color:var(--muted)">' + msg.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</span>\n' +
'  </div>\n' +
'</div>\n' +
'</body>\n' +
'</html>'
  );
}

/********************************************************************************************************************
* functionSignature: getConfigHtml (opts)
* Purpose: Visual JSON config editor. Objects render as collapsible sections, flat arrays as
*          tag chips, secrets as password fields, long strings as textareas.
********************************************************************************************************************/
function getConfigHtml(opts) {
  const configBase = String(opts?.configBase || "/config").replace(/\/+$/,"") || "/config";
  const activePath = String(opts?.activePath || configBase) || configBase;
  const role       = String(opts?.role || "").trim();
  const rightHtml  =
    '<span id="status-lbl" style="font-size:12px;color:var(--muted)"></span>' +
    '<button id="save-btn" disabled onclick="saveConfig()">Saved</button>';
  const menuHtml   = getMenuHtml(opts?.menu || [], activePath, role, rightHtml);

  /* The embedded <script> closing tag must be split so the browser parser doesn't
     terminate the script block early when this string is part of a larger file. */
  const SCRIPT_CLOSE = "<" + "/script>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>⚙️ Config</title>
<link rel="stylesheet" href="${configBase}/style.css">
<style>
.cfg-wrap{margin-top:var(--hh);height:calc(100dvh - var(--hh));overflow-y:auto;padding:12px 14px 40px}
.cfg-toolbar{display:flex;gap:8px;margin-bottom:10px}
/* sections */
.cs{border:1px solid var(--bdr);border-radius:8px;margin-bottom:8px;background:#fff;overflow:hidden}
.cs-hdr{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;user-select:none;background:var(--bg2,#f5f5f5)}
.cs.open>.cs-hdr{border-radius:8px 8px 0 0}
.cs-hdr:hover{background:var(--bg3,#e8e8e8)}
.cs-arrow{font-size:10px;transition:transform .15s;display:inline-block;color:var(--muted)}
.cs.open>.cs-hdr>.cs-arrow{transform:rotate(90deg)}
.cs-title{font-weight:600;font-size:13px;flex:1;color:var(--txt)}
.cs-badge{font-size:11px;color:var(--muted);background:rgba(0,0,0,.08);border-radius:10px;padding:1px 7px}
.cs-body{display:none;padding:10px 14px 12px;grid-gap:7px}
.cs.open>.cs-body{display:grid}
/* nested sections */
.cs .cs{margin-bottom:4px}
.cs .cs .cs-hdr{background:var(--bg,#fafafa)}
.cs .cs .cs .cs-hdr{background:#fff}
/* fields */
.cf{display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:start}
.cf label{font-size:12px;color:var(--muted);padding-top:5px;word-break:break-word;overflow-wrap:anywhere}
.cf input[type=text],.cf input[type=number],.cf input[type=password]{width:100%;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:13px;background:var(--bg,#fafafa);color:var(--txt);box-sizing:border-box}
.cf textarea{width:100%;border:1px solid var(--bdr);border-radius:6px;padding:4px 8px;font-size:12px;font-family:monospace;line-height:1.4;background:var(--bg,#fafafa);color:var(--txt);resize:vertical;min-height:54px;box-sizing:border-box}
.cf input[type=checkbox]{margin-top:6px;width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#5865f2)}
/* password row */
.cfg-pw-row{display:flex;gap:4px;width:100%}
.cfg-pw-row input{flex:1;min-width:0}
.cfg-eye{padding:3px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg,#fafafa);cursor:pointer;font-size:13px;line-height:1.4}
/* tag chips */
.cfg-tags{display:flex;flex-wrap:wrap;gap:4px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg,#fafafa);min-height:32px;align-items:center}
.cfg-tag{display:inline-flex;align-items:center;gap:2px;background:var(--accent,#5865f2);color:#fff;border-radius:12px;padding:2px 4px 2px 9px;font-size:12px;line-height:1.4}
.cfg-tag-del{background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;padding:0 5px;font-size:15px;line-height:1}
.cfg-tag-del:hover{color:#fff}
.cfg-tag-inp{border:none;background:none;outline:none;font-size:12px;min-width:60px;color:var(--txt);padding:0 2px}
</style>
</head>
<body>
<header>
  <h1>⚙️ Config</h1>
${menuHtml ? "  " + menuHtml : ""}
</header>
<div class="cfg-wrap">
  <div class="cfg-toolbar">
    <button class="btn btn-s" onclick="loadConfig()">&#8635; Reload</button>
    <button class="btn btn-s" onclick="expandAll()">Expand all</button>
    <button class="btn btn-s" onclick="collapseAll()">Collapse all</button>
  </div>
  <div id="cfg-tree"></div>
</div>
<div id="toast" class="toast"></div>
<script>
var BASE = '${configBase}';
var DATA = null;
var dirty = false;
var SECRET_RE = /key|secret|token|password|bearer/i;
var TITLE_FIELDS = ['_title','name','label','id','channelId','channelMatch','text','cron','path'];
var TEXTAREA_LEN = 120;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, ms) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(function(){ t.classList.remove('on'); }, ms || 2400);
}
function setDirty(v) {
  dirty = !!v;
  var btn = document.getElementById('save-btn');
  var lbl = document.getElementById('status-lbl');
  if (dirty) {
    btn.disabled = false; btn.textContent = 'Save'; btn.className = 'dirty';
    lbl.textContent = 'Unsaved changes';
  } else {
    btn.disabled = true; btn.textContent = 'Saved'; btn.className = '';
    lbl.textContent = '';
  }
}
function getAtPath(obj, path) {
  var cur = obj;
  for (var i = 0; i < path.length; i++) { if (cur == null) return undefined; cur = cur[path[i]]; }
  return cur;
}
function setAtPath(obj, path, val) {
  var cur = obj;
  for (var i = 0; i < path.length - 1; i++) { cur = cur[path[i]]; }
  cur[path[path.length - 1]] = val;
}
/* Derive a readable title for an object block */
function getTitle(key, obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (var i = 0; i < TITLE_FIELDS.length; i++) {
      var f = TITLE_FIELDS[i];
      if (typeof obj[f] === 'string' && obj[f]) return obj[f];
    }
  }
  return key != null ? String(key) : 'Item';
}
/* True when every element of an array is a primitive */
function isFlat(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== null && typeof arr[i] === 'object') return false;
  }
  return true;
}
function isPassword(key) { return SECRET_RE.test(String(key)); }
function needsTextarea(val) {
  var s = String(val == null ? '' : val);
  return s.indexOf('\\n') >= 0 || s.length > TEXTAREA_LEN;
}

/* Build a collapsible section element; returns {section, hdr, body} */
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

/* Render a flat array (all primitives) as tag chips */
function renderFlatArray(key, arr, path) {
  var wrap = document.createElement('div');
  wrap.className = 'cf';
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
      tag.innerHTML = esc(String(item == null ? 'null' : item)) +
        '<button class="cfg-tag-del" title="Remove">&#215;</button>';
      (function(idx) {
        tag.querySelector('button').onclick = function() {
          cur.splice(idx, 1); setDirty(true); refresh();
        };
      })(i);
      tags.appendChild(tag);
    });
    var inp = document.createElement('input');
    inp.className = 'cfg-tag-inp'; inp.type = 'text'; inp.placeholder = '+ add';
    inp.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var v = inp.value.trim().replace(/,$/, '');
        if (v) { cur.push(v); setDirty(true); refresh(); }
      } else if (e.key === 'Backspace' && !inp.value && cur.length) {
        cur.pop(); setDirty(true); refresh();
      }
    };
    tags.appendChild(inp);
  }
  refresh();
  wrap.appendChild(tags);
  return wrap;
}

/* Render a single scalar field (string / number / boolean / null) */
function renderField(key, value, path) {
  var wrap = document.createElement('div');
  wrap.className = 'cf';
  var lbl = document.createElement('label');
  lbl.textContent = key;
  wrap.appendChild(lbl);

  if (value === null || value === undefined) {
    var inp = document.createElement('input');
    inp.type = 'text'; inp.value = 'null';
    inp.oninput = function() { setAtPath(DATA, path, inp.value === 'null' ? null : inp.value); setDirty(true); };
    wrap.appendChild(inp); return wrap;
  }
  if (typeof value === 'boolean') {
    var inp = document.createElement('input');
    inp.type = 'checkbox'; inp.checked = value;
    inp.onchange = function() { setAtPath(DATA, path, inp.checked); setDirty(true); };
    wrap.appendChild(inp); return wrap;
  }
  if (typeof value === 'number') {
    var inp = document.createElement('input');
    inp.type = 'number'; inp.value = String(value);
    inp.step = Number.isInteger(value) ? '1' : 'any';
    inp.onchange = function() { setAtPath(DATA, path, Number(inp.value)); setDirty(true); };
    wrap.appendChild(inp); return wrap;
  }
  /* String */
  var s = String(value == null ? '' : value);
  if (isPassword(key)) {
    var row = document.createElement('div'); row.className = 'cfg-pw-row';
    var inp = document.createElement('input'); inp.type = 'password'; inp.value = s;
    inp.oninput = function() { setAtPath(DATA, path, inp.value); setDirty(true); };
    var eye = document.createElement('button'); eye.className = 'cfg-eye'; eye.type = 'button';
    eye.innerHTML = '&#128065;'; eye.title = 'Show / hide';
    eye.onclick = function() { inp.type = inp.type === 'password' ? 'text' : 'password'; };
    row.appendChild(inp); row.appendChild(eye);
    wrap.appendChild(row); return wrap;
  }
  if (needsTextarea(s)) {
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.rows = Math.min(Math.max((s.match(/\\n/g) || []).length + 2, 3), 14);
    ta.oninput = function() { setAtPath(DATA, path, ta.value); setDirty(true); };
    wrap.appendChild(ta); return wrap;
  }
  var inp = document.createElement('input');
  inp.type = 'text'; inp.value = s;
  inp.oninput = function() { setAtPath(DATA, path, inp.value); setDirty(true); };
  wrap.appendChild(inp); return wrap;
}

/* Render an object as a collapsible section */
function renderObject(key, obj, path, depth) {
  var s = mkSection(getTitle(key, obj), depth, depth < 1);
  Object.keys(obj).forEach(function(k) {
    if (k === '__description' || k === '_title') return;
    s.body.appendChild(renderValue(k, obj[k], path.concat([k]), depth + 1));
  });
  return s.section;
}

/* Render an array whose items are objects */
function renderObjectArray(key, arr, path, depth) {
  var s = mkSection(key, depth, false);
  var badge = document.createElement('span');
  badge.className = 'cs-badge'; badge.textContent = arr.length;
  s.hdr.appendChild(badge);
  arr.forEach(function(item, i) {
    var childPath = path.concat([i]);
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      s.body.appendChild(renderObject(null, item, childPath, depth + 1));
    } else {
      s.body.appendChild(renderField('[' + i + ']', item, childPath));
    }
  });
  return s.section;
}

/* Dispatch: decide how to render based on value type */
function renderValue(key, value, path, depth) {
  if (Array.isArray(value)) {
    return isFlat(value)
      ? renderFlatArray(key, value, path)
      : renderObjectArray(key, value, path, depth);
  }
  if (value && typeof value === 'object') return renderObject(key, value, path, depth);
  return renderField(key, value, path);
}

/* Render full config into #cfg-tree */
function render(cfg) {
  var tree = document.getElementById('cfg-tree');
  tree.innerHTML = '';
  Object.keys(cfg).forEach(function(k) {
    if (k === '__description') return;
    tree.appendChild(renderValue(k, cfg[k], [k], 0));
  });
}

function expandAll()  { document.querySelectorAll('.cs').forEach(function(s){ s.classList.add('open'); }); }
function collapseAll(){ document.querySelectorAll('.cs').forEach(function(s){ s.classList.remove('open'); }); }

function loadConfig() {
  var tree = document.getElementById('cfg-tree');
  tree.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div>';
  fetch(BASE + '/api/config')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(d) {
      DATA = d;
      try {
        render(DATA);
        setDirty(false);
        toast('Loaded');
      } catch(e) {
        tree.innerHTML = '<div style="padding:16px;color:#c00;font-size:13px;font-family:monospace">'
          + 'Render error: ' + esc(e.message) + '<br><pre style="white-space:pre-wrap;font-size:11px">'
          + esc(e.stack || '') + '</pre></div>';
      }
    })
    .catch(function(e) {
      tree.innerHTML = '<div style="padding:16px;color:#c00;font-size:13px">Load error: ' + esc(e.message) + '</div>';
    });
}
function saveConfig() {
  var btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  fetch(BASE + '/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(DATA)
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok) { setDirty(false); toast('Config saved'); }
      else { toast('Error: ' + ((d && d.error) || '?'), 6000); btn.textContent = 'Save'; btn.disabled = false; btn.className = 'dirty'; }
    })
    .catch(function(e){ toast('Save failed: ' + e.message, 6000); btn.textContent = 'Save'; btn.disabled = false; btn.className = 'dirty'; });
}
document.addEventListener('keydown', function(e){
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty) saveConfig(); }
});
loadConfig();
${SCRIPT_CLOSE}
</body>
</html>`;
}
