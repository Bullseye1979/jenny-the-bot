/**************************************************************/
/* filename: "00068-webpage-channel-config-manager.js"        */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/
"use strict";

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getMenuHtml,
  getThemeHeadScript,
  readJsonFile,
  writeJsonFile
} from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import { getStr } from "../core/utils.js";

const MODULE_NAME = "webpage-channel-config-manager";

function getBasePath(cfg) {
  const value = getStr(cfg.basePath ?? "/channels").trim();
  return value && value.startsWith("/") ? value.replace(/\/+$/, "") : "/channels";
}

function getConfigFile(cfg) {
  if (cfg.file) return String(cfg.file);
  return fileURLToPath(new URL("../core.json", import.meta.url));
}

function setNotFound(wo) {
  wo.http.response = {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: "Not Found"
  };
}

function getQueryValue(wo, key) {
  const direct = wo?.http?.query?.[key];
  if (direct != null) return direct;
  const url = String(wo?.http?.url ?? "");
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return undefined;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  return params.get(key) ?? undefined;
}

function escHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getChannelsRoot(configJson) {
  if (!configJson || typeof configJson !== "object") return null;
  if (!configJson.config || typeof configJson.config !== "object") {
    configJson.config = {};
  }
  if (!configJson.config["core-channel-config"] || typeof configJson.config["core-channel-config"] !== "object") {
    configJson.config["core-channel-config"] = {};
  }
  if (!Array.isArray(configJson.config["core-channel-config"].channels)) {
    configJson.config["core-channel-config"].channels = [];
  }
  return configJson.config["core-channel-config"].channels;
}

function getChannelTitle(entry, index) {
  const title = getStr(entry?._title).trim();
  if (title) return title;
  const match = Array.isArray(entry?.channelMatch) ? entry.channelMatch : [];
  if (match.length) return String(match[0]);
  return "Channel " + String(index + 1);
}

function getChannelMeta(entry) {
  const match = Array.isArray(entry?.channelMatch) ? entry.channelMatch.map(v => String(v)) : [];
  if (!match.length) return "No channel match configured";
  if (match.length === 1) return "Match: " + match[0];
  return "Primary: " + match[0] + " | Additional: " + match.slice(1).join(", ");
}

function getToolCount(entry) {
  const tools = entry?.overrides?.tools;
  return Array.isArray(tools) ? tools.length : 0;
}

function getListPayload(configJson) {
  const channels = getChannelsRoot(configJson) || [];
  return channels.map((entry, index) => ({
    index,
    title: getChannelTitle(entry, index),
    meta: getChannelMeta(entry),
    toolCount: getToolCount(entry)
  }));
}

function getEntryPayload(configJson, index) {
  const channels = getChannelsRoot(configJson) || [];
  const entry = channels[index];
  if (!entry || typeof entry !== "object") return null;
  const item = cloneJson(entry);
  const extra = {};
  for (const key of Object.keys(item)) {
    if (key === "_title" || key === "channelMatch" || key === "overrides" || key === "flows") continue;
    extra[key] = item[key];
  }
  return {
    index,
    title: getStr(item?._title),
    channelMatch: Array.isArray(item?.channelMatch) ? item.channelMatch : [],
    overrides: item?.overrides && typeof item.overrides === "object" ? item.overrides : {},
    flows: Array.isArray(item?.flows) ? item.flows : [],
    extra
  };
}

function getAccessDeniedHtml(opts) {
  const basePath = String(opts?.basePath || "/channels").replace(/\/+$/, "") || "/channels";
  const activePath = String(opts?.activePath || basePath) || basePath;
  const role = String(opts?.role || "").trim();
  const menuHtml = getMenuHtml(opts?.menu || [], activePath, role, null, null, opts?.webAuth);

  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">" +
    "<title>Channel Config Manager</title>" +
    getThemeHeadScript() +
    "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
    "<header><h1>Channel Config Manager</h1>" + menuHtml + "</header>" +
    "<div style=\"margin-top:var(--hh);padding:16px\">" +
    "<div style=\"padding:16px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg2)\">" +
    "<strong>Access denied</strong><br><span style=\"color:var(--muted)\">Your Discord role does not have access to this page.</span>" +
    "</div></div></body></html>";
}

function getPageHtml(opts) {
  const basePath = String(opts?.basePath || "/channels").replace(/\/+$/, "") || "/channels";
  const activePath = String(opts?.activePath || basePath) || basePath;
  const role = String(opts?.role || "").trim();
  const menuHtml = getMenuHtml(opts?.menu || [], activePath, role, null, null, opts?.webAuth);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Channel Config Manager</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
.ccm-wrap{margin-top:var(--hh);padding:12px 14px 40px;overflow-x:hidden}
.ccm-grid{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:12px;align-items:start;width:100%;min-width:0}
.ccm-panel{border:1px solid var(--bdr);border-radius:12px;background:var(--bg2);overflow:hidden;min-width:0}
.ccm-head{padding:12px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:8px}
.ccm-head strong{font-size:14px}
.ccm-body{padding:14px}
.ccm-editor-panel .ccm-body{max-height:calc(100dvh - var(--hh) - 110px);overflow:auto}
.ccm-toolbar{display:flex;gap:8px;flex-wrap:wrap}
.ccm-search{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.ccm-list{list-style:none;margin:12px 0 0;padding:0;max-height:calc(100dvh - var(--hh) - 180px);overflow:auto}
.ccm-item{padding:10px 14px;border-bottom:1px solid var(--bdr);cursor:pointer;width:100%;display:block;box-sizing:border-box}
.ccm-item:last-child{border-bottom:none}
.ccm-item:hover{background:var(--bg3)}
.ccm-item.active{background:rgba(59,130,246,.12);border-left:3px solid var(--accent);padding-left:11px}
.ccm-item-title{font-weight:600;font-size:13px;color:var(--txt)}
.ccm-item-meta{font-size:11px;color:var(--muted);margin-top:4px;font-family:monospace;word-break:break-word}
.ccm-item-stats{font-size:11px;color:var(--muted);margin-top:5px}
.ccm-form{display:grid;gap:12px}
.ccm-row{display:grid;grid-template-columns:160px minmax(0,1fr);gap:10px;align-items:start}
.ccm-row label{font-size:12px;color:var(--muted);padding-top:8px}
.ccm-row input,.ccm-row textarea{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.ccm-row textarea{min-height:160px;resize:vertical;font-family:monospace;line-height:1.45}
.ccm-note{font-size:12px;color:var(--muted)}
.ccm-status{font-size:12px;color:var(--muted)}
.ccm-actions{display:flex;gap:8px;flex-wrap:wrap}
.ccm-actions button{padding:7px 12px}
.ccm-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.ccm-card{padding:10px 12px;border:1px solid var(--bdr);border-radius:10px;background:var(--bg)}
.ccm-card strong{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.ccm-card span{font-size:14px;color:var(--txt);word-break:break-word}
.ccm-object{display:grid;gap:8px}
.ccm-object-toolbar,.ccm-flow-toolbar{display:flex;gap:8px;flex-wrap:wrap}
.ccm-object-list,.ccm-flow-list{display:grid;gap:10px}
.ccm-object-row{display:grid;grid-template-columns:minmax(160px,.9fr) 120px minmax(0,1.4fr) auto;gap:8px;align-items:start}
.ccm-object-row input,.ccm-object-row select,.ccm-object-row textarea{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box}
.ccm-object-row textarea{min-height:74px;resize:vertical;font-family:monospace;line-height:1.45}
.ccm-flow-card{border:1px solid var(--bdr);border-radius:10px;background:var(--bg);padding:12px;display:grid;gap:10px}
.ccm-flow-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ccm-flow-head strong{font-size:13px}
.ccm-flow-body{display:grid;gap:10px}
.ccm-help{font-size:11px;color:var(--muted)}
.ccm-editor-host{display:grid;gap:8px;min-width:0}
.ccm-editor-toolbar{display:flex;gap:8px;flex-wrap:wrap}
.ccm-editor-tree{min-width:0}
.cs{border:1px solid var(--bdr);border-radius:8px;margin-bottom:8px;background:var(--bg2);overflow:hidden}
.cs-hdr{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;user-select:none;background:var(--bg2)}
.cs.open>.cs-hdr{border-radius:8px 8px 0 0}
.cs-hdr:hover{background:var(--bg3)}
.cs-arrow{font-size:10px;transition:transform .15s;display:inline-block;color:var(--muted)}
.cs.open>.cs-hdr>.cs-arrow{transform:rotate(90deg)}
.cs-title{font-weight:600;font-size:13px;flex:1;color:var(--txt);word-break:break-word}
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
.cfg-tags{display:flex;flex-wrap:wrap;gap:4px;padding:4px 6px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);min-height:32px;align-items:center}
.cfg-tag{display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;border-radius:12px;padding:2px 4px 2px 9px;font-size:12px;line-height:1.4}
.cfg-tag-del{background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;padding:0 5px;font-size:15px;line-height:1}
.cfg-tag-del:hover{color:#fff}
.cfg-tag-inp{border:none;background:none;outline:none;font-size:12px;min-width:60px;color:var(--txt);padding:0 2px}
.cfg-pw-row{display:flex;gap:4px;width:100%}
.cfg-pw-row input{flex:1;min-width:0}
.cfg-eye{padding:3px 8px;border:1px solid var(--bdr);border-radius:6px;background:var(--bg);color:var(--txt);cursor:pointer;font-size:13px;line-height:1.4}
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
  .ccm-wrap{padding:12px 0 40px}
  .ccm-grid{display:flex;flex-direction:column;gap:12px;width:100%}
  .ccm-panel{width:100%;max-width:100%;border-left:none;border-right:none;border-radius:0}
  .ccm-editor-panel .ccm-body{max-height:none;overflow:visible}
  .ccm-row{grid-template-columns:1fr}
  .ccm-object-row{grid-template-columns:1fr}
  .cf,.cf.cf-d{grid-template-columns:1fr}
  .ccm-row label{padding-top:0}
  .ccm-summary{grid-template-columns:1fr}
}
</style>
</head>
<body>
<header>
  <h1>Channel Config Manager</h1>
${menuHtml ? "  " + menuHtml : ""}
</header>
<div class="ccm-wrap">
  <div class="ccm-grid">
    <aside class="ccm-panel">
      <div class="ccm-head">
        <strong>Channels</strong>
        <div class="ccm-toolbar">
          <button class="btn btn-s" type="button" onclick="createNew()">New</button>
          <button class="btn btn-s" type="button" onclick="duplicateCurrent()">Duplicate</button>
          <button class="btn btn-s" type="button" onclick="reloadList()">Reload</button>
        </div>
      </div>
      <div class="ccm-body">
        <input id="list-search" class="ccm-search" type="text" placeholder="Search title, channel id, tool count" oninput="renderList()">
        <ul id="channel-list" class="ccm-list">
          <li class="ccm-item"><div class="ccm-item-title">Loading...</div></li>
        </ul>
      </div>
    </aside>
    <section class="ccm-panel ccm-editor-panel">
      <div class="ccm-head">
        <strong id="editor-title">Editor</strong>
        <div class="ccm-actions">
          <span id="save-status" class="ccm-status"></span>
          <button class="btn btn-s" type="button" onclick="reloadCurrent()">Reload</button>
          <button class="btn btn-s" type="button" onclick="deleteCurrent()">Delete</button>
          <button class="btn btn-s" type="button" onclick="saveCurrent()">Save</button>
        </div>
      </div>
      <div class="ccm-body">
        <div class="ccm-note">Edit one entry from <code>core-channel-config.channels</code>. The editor shows primary channel matching, structured override fields, and dedicated flow override cards so you do not have to work with large raw JSON blocks.</div>
        <div class="ccm-summary" style="margin-top:12px">
          <div class="ccm-card"><strong>Index</strong><span id="summary-index">New entry</span></div>
          <div class="ccm-card"><strong>Matched channels</strong><span id="summary-match-count">0</span></div>
          <div class="ccm-card"><strong>Flow overrides</strong><span id="summary-tool-count">0</span></div>
        </div>
        <div class="ccm-form" style="margin-top:14px">
          <div class="ccm-row">
            <label for="field-title">Display title</label>
            <input id="field-title" type="text" placeholder="D&D Main Channel">
          </div>
          <div class="ccm-row">
            <label for="field-primary-match">Primary channel match</label>
            <input id="field-primary-match" type="text" placeholder="1229507613788475462">
          </div>
          <div class="ccm-row">
            <label for="field-channel-match">Additional channel matches</label>
            <textarea id="field-channel-match" spellcheck="false" placeholder="One channel match per line"></textarea>
          </div>
          <div class="ccm-row">
            <label>Main overrides</label>
            <div class="ccm-editor-host">
              <div class="ccm-editor-toolbar">
                <button class="btn btn-s" type="button" onclick="expandEditor('overrides')">Expand all</button>
                <button class="btn btn-s" type="button" onclick="collapseEditor('overrides')">Collapse all</button>
              </div>
              <div class="ccm-help">Use the collapsible override tree to edit arrays like tools, nested tool configs, and deeper structures without raw JSON.</div>
              <div id="overrides-list" class="ccm-editor-tree"></div>
            </div>
          </div>
          <div class="ccm-row">
            <label>Flow overrides</label>
            <div class="ccm-editor-host">
              <div class="ccm-editor-toolbar">
                <button class="btn btn-s" type="button" onclick="expandEditor('flows')">Expand all</button>
                <button class="btn btn-s" type="button" onclick="collapseEditor('flows')">Collapse all</button>
              </div>
              <div class="ccm-help">Flow overrides use the same tree editor. Arrays, booleans, nested objects, and titles can all be edited directly.</div>
              <div id="flows-list" class="ccm-editor-tree"></div>
            </div>
          </div>
          <div class="ccm-row">
            <label for="field-extra">Miscellaneous top-level fields</label>
            <textarea id="field-extra" spellcheck="false" placeholder='{}'></textarea>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>
var BASE = ${JSON.stringify(basePath)};
var LIST = [];
var CURRENT_INDEX = null;
var LOADED_INDEX = null;
var DIRTY = false;
var OVERRIDES_DATA = {};
var FLOWS_DATA = [];

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function toast(message, ms) {
  var node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("on");
  setTimeout(function(){ node.classList.remove("on"); }, ms || 2400);
}

function setStatus(text) {
  document.getElementById("save-status").textContent = text || "";
}

function setDirty(nextDirty) {
  DIRTY = !!nextDirty;
  setStatus(DIRTY ? "Unsaved changes" : "");
}

function getJsonPretty(value) {
  return JSON.stringify(value, null, 2);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function getSafeJson(text, fallback, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(label + " is not valid JSON: " + String(err && err.message ? err.message : err));
  }
}

function getRowType(value) {
  if (value === null) return "null";
  if (Array.isArray(value) || (value && typeof value === "object")) return "json";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

function getRowValueText(value) {
  if (value === null) return "";
  if (Array.isArray(value) || (value && typeof value === "object")) return getJsonPretty(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value == null ? "" : value);
}

function getNormalizeRowsFromObject(value) {
  var out = [];
  var source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  Object.keys(source).forEach(function(key) {
    if (key === "_title") return;
    out.push({
      key: key,
      type: getRowType(source[key]),
      value: getRowValueText(source[key])
    });
  });
  return out;
}

function getEditorState(kind) {
  return kind === "flows" ? FLOWS_DATA : OVERRIDES_DATA;
}

function setEditorState(kind, value) {
  if (kind === "flows") FLOWS_DATA = value || [];
  else OVERRIDES_DATA = value || {};
}

function getEditorHost(kind) {
  return document.getElementById(kind === "flows" ? "flows-list" : "overrides-list");
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

function removeAtEditorPath(kind, path) {
  var data = getEditorState(kind);
  if (!path || !path.length) return;
  var parent = path.length > 1 ? getAtPath(data, path.slice(0, -1)) : data;
  var key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(key, 1);
  else if (parent && typeof parent === "object") delete parent[key];
  renderEditor(kind);
  refreshSummary();
}

function addToEditorObject(kind, path, name, value) {
  var data = getEditorState(kind);
  var obj = path.length ? getAtPath(data, path) : data;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  obj[name] = value;
  renderAndFocus(kind, path);
  setDirty(true);
}

function addItemToEditorArray(kind, path) {
  var data = getEditorState(kind);
  var arr = path.length ? getAtPath(data, path) : data;
  if (!Array.isArray(arr)) return;
  arr.push({});
  renderAndFocus(kind, path);
  setDirty(true);
}

function renderAndFocus(kind, path) {
  renderEditor(kind);
  if (!path || !path.length) return;
  var pathStr = JSON.stringify(path);
  requestAnimationFrame(function() {
    var sections = getEditorHost(kind).querySelectorAll(".cs[data-cfgpath]");
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getAttribute("data-cfgpath") === pathStr) {
        sections[i].classList.add("open");
        sections[i].scrollIntoView({ behavior: "instant", block: "nearest" });
        break;
      }
    }
  });
}

function getTitle(key, obj) {
  var titleFields = ["_title","name","label","id","channelId","channelMatch","text","cron","path","title","type","flowMatch"];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (var i = 0; i < titleFields.length; i++) {
      var f = titleFields[i];
      if (typeof obj[f] === "string" && obj[f]) return obj[f];
      if (Array.isArray(obj[f]) && obj[f].length) return String(obj[f][0]);
    }
  }
  return key != null ? String(key) : "Item";
}

function isFlat(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== null && typeof arr[i] === "object") return false;
  }
  return true;
}

function isPassword(key) {
  return /key|secret|token|password|bearer/i.test(String(key));
}

function needsTextarea(val) {
  var s = String(val == null ? "" : val);
  return s.indexOf("\\n") >= 0 || s.length > 120;
}

function mkSection(titleText, depth, defaultOpen) {
  var section = document.createElement("div");
  section.className = "cs";
  if (defaultOpen) section.classList.add("open");
  var hdr = document.createElement("div");
  hdr.className = "cs-hdr";
  hdr.innerHTML = '<span class="cs-arrow">&#9658;</span><span class="cs-title">' + esc(titleText) + "</span>";
  hdr.onclick = function() { section.classList.toggle("open"); };
  var body = document.createElement("div");
  body.className = "cs-body";
  section.appendChild(hdr);
  section.appendChild(body);
  return { section: section, hdr: hdr, body: body };
}

function renderFlatArray(kind, key, arr, path) {
  var wrap = document.createElement("div");
  wrap.className = "cf cf-d";
  var lbl = document.createElement("label");
  lbl.textContent = key;
  wrap.appendChild(lbl);
  var tags = document.createElement("div");
  tags.className = "cfg-tags";
  function refresh() {
    tags.innerHTML = "";
    var cur = getAtPath(getEditorState(kind), path);
    if (!Array.isArray(cur)) cur = [];
    cur.forEach(function(item, i) {
      var tag = document.createElement("span");
      tag.className = "cfg-tag";
      tag.innerHTML = esc(String(item == null ? "null" : item)) + '<button class="cfg-tag-del" title="Remove">&#215;</button>';
      (function(idx) {
        tag.querySelector("button").onclick = function() {
          cur.splice(idx, 1);
          setDirty(true);
          refresh();
          refreshSummary();
        };
      })(i);
      tags.appendChild(tag);
    });
    var inp = document.createElement("input");
    inp.className = "cfg-tag-inp";
    inp.type = "text";
    inp.placeholder = "+ add";
    inp.onkeydown = function(e) {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        var v = inp.value.trim().replace(/,$/, "");
        if (v) {
          cur.push(v);
          setDirty(true);
          refresh();
          refreshSummary();
        }
      } else if (e.key === "Backspace" && !inp.value && cur.length) {
        cur.pop();
        setDirty(true);
        refresh();
        refreshSummary();
      }
    };
    tags.appendChild(inp);
  }
  refresh();
  wrap.appendChild(tags);
  var del = document.createElement("button");
  del.className = "cf-del";
  del.type = "button";
  del.title = "Remove";
  del.innerHTML = "&#215;";
  del.onclick = function() {
    if (!window.confirm('Remove "' + key + '"?')) return;
    removeAtEditorPath(kind, path);
    setDirty(true);
  };
  wrap.appendChild(del);
  return wrap;
}

function renderField(kind, key, value, path) {
  var wrap = document.createElement("div");
  wrap.className = "cf cf-d";
  var lbl = document.createElement("label");
  lbl.textContent = key;
  wrap.appendChild(lbl);
  var ctrl;
  if (value === null || value === undefined) {
    ctrl = document.createElement("input");
    ctrl.type = "text";
    ctrl.value = "null";
    ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value === "null" ? null : ctrl.value); setDirty(true); refreshSummary(); };
  } else if (typeof value === "boolean") {
    ctrl = document.createElement("input");
    ctrl.type = "checkbox";
    ctrl.checked = value;
    ctrl.onchange = function() { setAtPath(getEditorState(kind), path, ctrl.checked); setDirty(true); refreshSummary(); };
  } else if (typeof value === "number") {
    ctrl = document.createElement("input");
    ctrl.type = "number";
    ctrl.value = String(value);
    ctrl.step = Number.isInteger(value) ? "1" : "any";
    ctrl.onchange = function() { setAtPath(getEditorState(kind), path, Number(ctrl.value)); setDirty(true); refreshSummary(); };
  } else {
    var s = String(value == null ? "" : value);
    if (isPassword(key)) {
      ctrl = document.createElement("div");
      ctrl.className = "cfg-pw-row";
      var inp = document.createElement("input");
      inp.type = "password";
      inp.value = s;
      inp.oninput = function() { setAtPath(getEditorState(kind), path, inp.value); setDirty(true); refreshSummary(); };
      var eye = document.createElement("button");
      eye.className = "cfg-eye";
      eye.type = "button";
      eye.innerHTML = "&#128065;";
      eye.onclick = function() { inp.type = inp.type === "password" ? "text" : "password"; };
      ctrl.appendChild(inp);
      ctrl.appendChild(eye);
    } else if (needsTextarea(s)) {
      ctrl = document.createElement("textarea");
      ctrl.value = s;
      ctrl.rows = Math.min(Math.max((s.match(/\\n/g) || []).length + 2, 3), 14);
      ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value); setDirty(true); refreshSummary(); };
    } else {
      ctrl = document.createElement("input");
      ctrl.type = "text";
      ctrl.value = s;
      ctrl.oninput = function() { setAtPath(getEditorState(kind), path, ctrl.value); setDirty(true); refreshSummary(); };
    }
  }
  wrap.appendChild(ctrl);
  var del = document.createElement("button");
  del.className = "cf-del";
  del.type = "button";
  del.title = "Remove";
  del.innerHTML = "&#215;";
  del.onclick = function() {
    if (!window.confirm('Remove "' + key + '"?')) return;
    removeAtEditorPath(kind, path);
    setDirty(true);
  };
  wrap.appendChild(del);
  return wrap;
}

function renderObject(kind, key, obj, path, depth) {
  var s = mkSection(getTitle(key, obj), depth, depth < 1);
  s.section.setAttribute("data-cfgpath", JSON.stringify(path));
  if ("_title" in obj) {
    var titleSpan = s.hdr.querySelector(".cs-title");
    var pencil = document.createElement("button");
    pencil.className = "cs-edit";
    pencil.type = "button";
    pencil.title = "Edit title";
    pencil.innerHTML = "&#9998;";
    pencil.onclick = function(e) {
      e.stopPropagation();
      var cur = String(getAtPath(getEditorState(kind), path.concat(["_title"])) != null ? getAtPath(getEditorState(kind), path.concat(["_title"])) : "");
      var inp = document.createElement("input");
      inp.type = "text";
      inp.value = cur;
      inp.className = "cs-title-inp";
      titleSpan.replaceWith(inp);
      pencil.style.display = "none";
      inp.focus();
      inp.select();
      var committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        setAtPath(getEditorState(kind), path.concat(["_title"]), inp.value);
        var span = document.createElement("span");
        span.className = "cs-title";
        span.textContent = getTitle(key, obj);
        inp.replaceWith(span);
        titleSpan = span;
        pencil.style.display = "";
        setDirty(true);
        refreshSummary();
      }
      inp.onblur = commit;
      inp.onkeydown = function(ev) {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { inp.value = cur; commit(); }
      };
    };
    s.hdr.appendChild(pencil);
  }
  if (path.length > 0) {
    var del = document.createElement("button");
    del.className = "cs-del";
    del.type = "button";
    del.title = "Remove block";
    del.innerHTML = "&#215;";
    del.onclick = function(e) {
      e.stopPropagation();
      var label = key != null ? String(key) : getTitle(null, obj);
      if (!window.confirm('Remove "' + label + '"?')) return;
      removeAtEditorPath(kind, path);
      setDirty(true);
    };
    s.hdr.appendChild(del);
  }
  Object.keys(obj).forEach(function(k) {
    if (k === "__description" || k === "_title") return;
    s.body.appendChild(renderEditorValue(kind, k, obj[k], path.concat([k]), depth + 1));
  });
  var addBar = document.createElement("div");
  addBar.className = "cs-add-bar";
  var btnAttr = document.createElement("button");
  btnAttr.type = "button";
  btnAttr.textContent = "+ Attribute";
  btnAttr.onclick = function() {
    var name = window.prompt("Attribute name:");
    if (!name || !name.trim()) return;
    var val = window.prompt("Value:", "");
    if (val === null) return;
    addToEditorObject(kind, path, name.trim(), val);
  };
  var btnBlock = document.createElement("button");
  btnBlock.type = "button";
  btnBlock.textContent = "+ Block";
  btnBlock.onclick = function() {
    var name = window.prompt("Block name:");
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
  s.section.setAttribute("data-cfgpath", JSON.stringify(path));
  var badge = document.createElement("span");
  badge.className = "cs-badge";
  badge.textContent = arr.length;
  s.hdr.appendChild(badge);
  if (path.length > 0) {
    var del = document.createElement("button");
    del.className = "cs-del";
    del.type = "button";
    del.title = "Remove array";
    del.innerHTML = "&#215;";
    del.onclick = function(e) {
      e.stopPropagation();
      if (!window.confirm('Remove "' + key + '"?')) return;
      removeAtEditorPath(kind, path);
      setDirty(true);
    };
    s.hdr.appendChild(del);
  }
  arr.forEach(function(item, i) {
    var childPath = path.concat([i]);
    if (item && typeof item === "object" && !Array.isArray(item)) s.body.appendChild(renderObject(kind, null, item, childPath, depth + 1));
    else s.body.appendChild(renderField(kind, "[" + i + "]", item, childPath));
  });
  var addBar = document.createElement("div");
  addBar.className = "cs-add-bar";
  var btnItem = document.createElement("button");
  btnItem.type = "button";
  btnItem.textContent = "+ Add item";
  btnItem.onclick = function() { addItemToEditorArray(kind, path); };
  addBar.appendChild(btnItem);
  s.body.appendChild(addBar);
  return s.section;
}

function renderEditorValue(kind, key, value, path, depth) {
  if (Array.isArray(value)) return isFlat(value) ? renderFlatArray(kind, key, value, path) : renderObjectArray(kind, key, value, path, depth);
  if (value && typeof value === "object") return renderObject(kind, key, value, path, depth);
  return renderField(kind, key, value, path);
}

function renderEditor(kind) {
  var data = getEditorState(kind);
  var host = getEditorHost(kind);
  host.innerHTML = "";
  if (Array.isArray(data)) {
    host.appendChild(renderEditorValue(kind, kind, data, [], 0));
    return;
  }
  Object.keys(data || {}).forEach(function(k) {
    if (k === "__description") return;
    host.appendChild(renderEditorValue(kind, k, data[k], [k], 0));
  });
  if (!host.innerHTML) {
    host.innerHTML = '<div class="ccm-note">No values configured.</div>';
  }
}

function expandEditor(kind) {
  getEditorHost(kind).querySelectorAll(".cs").forEach(function(node){ node.classList.add("open"); });
}

function collapseEditor(kind) {
  getEditorHost(kind).querySelectorAll(".cs").forEach(function(node){ node.classList.remove("open"); });
}

function getParseRowValue(type, rawValue, keyLabel) {
  if (!keyLabel) throw new Error("Every row needs a field name.");
  if (type === "string") return String(rawValue || "");
  if (type === "number") {
    if (String(rawValue).trim() === "") throw new Error(keyLabel + " requires a number.");
    var n = Number(rawValue);
    if (!Number.isFinite(n)) throw new Error(keyLabel + " requires a valid number.");
    return n;
  }
  if (type === "boolean") {
    var normalized = String(rawValue || "").trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    throw new Error(keyLabel + " requires true or false.");
  }
  if (type === "null") return null;
  return getSafeJson(String(rawValue || "").trim() || "{}", {}, keyLabel);
}

function getCreateObjectRowHtml(row, buttonLabel) {
  var key = esc(row && row.key ? row.key : "");
  var type = esc(row && row.type ? row.type : "string");
  var value = esc(row && row.value ? row.value : "");
  return '<div class="ccm-object-row">' +
    '<input type="text" data-role="key" placeholder="toolsconfig" value="' + key + '">' +
    '<select data-role="type">' +
      '<option value="string"' + (type === "string" ? " selected" : "") + '>string</option>' +
      '<option value="number"' + (type === "number" ? " selected" : "") + '>number</option>' +
      '<option value="boolean"' + (type === "boolean" ? " selected" : "") + '>boolean</option>' +
      '<option value="null"' + (type === "null" ? " selected" : "") + '>null</option>' +
      '<option value="json"' + (type === "json" ? " selected" : "") + '>json</option>' +
    '</select>' +
    '<textarea data-role="value" spellcheck="false" placeholder="value">' + value + '</textarea>' +
    '<button class="btn btn-s" type="button" onclick="' + buttonLabel + '(this)">Remove</button>' +
  '</div>';
}

function renderOverrideRows(value) {
  setEditorState("overrides", cloneJson(value || {}));
  renderEditor("overrides");
}

function addOverrideRow() {
  var host = document.getElementById("overrides-list");
  if (host.querySelector(".ccm-note")) host.innerHTML = "";
  host.insertAdjacentHTML("beforeend", getCreateObjectRowHtml({ key: "", type: "string", value: "" }, "removeOverrideRow"));
  bindDynamicInputs(host);
  setDirty(true);
}

function removeOverrideRow(button) {
  var row = button && button.parentNode;
  if (row) row.remove();
  if (!document.querySelector("#overrides-list .ccm-object-row")) {
    document.getElementById("overrides-list").innerHTML = '<div class="ccm-note">No override fields yet.</div>';
  }
  setDirty(true);
  refreshSummary();
}

function getCollectRows() {
  return cloneJson(getEditorState("overrides") || {});
}

function getFlowCardHtml(flow, index) {
  var item = flow && typeof flow === "object" ? flow : {};
  var title = esc(String(item._title || ""));
  var flowMatch = esc((Array.isArray(item.flowMatch) ? item.flowMatch : []).map(function(v){ return String(v); }).join("\\n"));
  var users = esc(getJsonPretty(item.users == null ? [] : item.users));
  var overrides = getNormalizeRowsFromObject(item.overrides || {});
  return '<div class="ccm-flow-card" data-index="' + String(index) + '">' +
    '<div class="ccm-flow-head"><strong>Flow override #' + String(index + 1) + '</strong><button class="btn btn-s" type="button" onclick="removeFlowCard(this)">Remove</button></div>' +
    '<div class="ccm-flow-body">' +
      '<div class="ccm-row"><label>Title</label><input type="text" data-role="flow-title" placeholder="Voice Override" value="' + title + '"></div>' +
      '<div class="ccm-row"><label>Flow match</label><textarea data-role="flow-match" spellcheck="false" placeholder="One flow per line">' + flowMatch + '</textarea></div>' +
      '<div class="ccm-row"><label>Users</label><textarea data-role="flow-users" spellcheck="false" placeholder="[]">' + users + '</textarea></div>' +
      '<div class="ccm-row"><label>Overrides</label><div class="ccm-object"><div class="ccm-object-toolbar"><button class="btn btn-s" type="button" onclick="addFlowOverrideRow(this)">Add override field</button></div><div class="ccm-object-list" data-role="flow-overrides">' +
        (overrides.length ? overrides.map(function(row) { return getCreateObjectRowHtml(row, "removeFlowOverrideRow"); }).join("") : '<div class="ccm-note">No flow override fields yet.</div>') +
      '</div></div></div>' +
    '</div>' +
  '</div>';
}

function renderFlowCards(flows) {
  setEditorState("flows", cloneJson(Array.isArray(flows) ? flows : []));
  renderEditor("flows");
}

function addFlowCard() {
  var host = document.getElementById("flows-list");
  var note = host.querySelector(".ccm-note");
  if (note) host.innerHTML = "";
  var index = host.querySelectorAll(".ccm-flow-card").length;
  host.insertAdjacentHTML("beforeend", getFlowCardHtml({ _title: "", flowMatch: [], users: [], overrides: {} }, index));
  bindDynamicInputs(host);
  setDirty(true);
  refreshSummary();
}

function removeFlowCard(button) {
  var card = button && button.closest(".ccm-flow-card");
  if (card) card.remove();
  var host = document.getElementById("flows-list");
  if (!host.querySelector(".ccm-flow-card")) host.innerHTML = '<div class="ccm-note">No flow overrides yet.</div>';
  resetFlowIndices();
  setDirty(true);
  refreshSummary();
}

function addFlowOverrideRow(button) {
  var card = button.closest(".ccm-flow-card");
  var host = card.querySelector('[data-role="flow-overrides"]');
  if (host.querySelector(".ccm-note")) host.innerHTML = "";
  host.insertAdjacentHTML("beforeend", getCreateObjectRowHtml({ key: "", type: "string", value: "" }, "removeFlowOverrideRow"));
  bindDynamicInputs(host);
  setDirty(true);
}

function removeFlowOverrideRow(button) {
  var row = button && button.parentNode;
  var host = row ? row.parentNode : null;
  if (row) row.remove();
  if (host && !host.querySelector(".ccm-object-row")) host.innerHTML = '<div class="ccm-note">No flow override fields yet.</div>';
  setDirty(true);
  refreshSummary();
}

function resetFlowIndices() {
  Array.prototype.slice.call(document.querySelectorAll("#flows-list .ccm-flow-card")).forEach(function(card, index) {
    card.setAttribute("data-index", String(index));
    var titleNode = card.querySelector(".ccm-flow-head strong");
    if (titleNode) titleNode.textContent = "Flow override #" + String(index + 1);
  });
}

function getCollectFlows() {
  return cloneJson(getEditorState("flows") || []);
}

function bindDynamicInputs(root) {
  Array.prototype.slice.call((root || document).querySelectorAll("input, textarea, select")).forEach(function(node) {
    if (node.dataset.boundInput === "1") return;
    node.dataset.boundInput = "1";
    node.addEventListener("input", function() {
      setDirty(true);
      refreshSummary();
    });
    node.addEventListener("change", function() {
      setDirty(true);
      refreshSummary();
    });
  });
}

function bindDirtyTracking() {
  ["field-title","field-primary-match","field-channel-match","field-extra"].forEach(function(id) {
    var node = document.getElementById(id);
    node.addEventListener("input", function() {
      setDirty(true);
      refreshSummary();
    });
  });
  bindDynamicInputs(document);
}

function getCurrentDraft() {
  var title = document.getElementById("field-title").value.trim();
  var primaryMatch = document.getElementById("field-primary-match").value.trim();
  var additionalMatches = document.getElementById("field-channel-match").value
    .split(/\\r?\\n/)
    .map(function(v) { return v.trim(); })
    .filter(Boolean);
  var channelMatch = [];
  if (primaryMatch) channelMatch.push(primaryMatch);
  additionalMatches.forEach(function(v) {
    if (!channelMatch.includes(v)) channelMatch.push(v);
  });
  var overrides = getCollectRows();
  var flows = getCollectFlows();
  var extra = getSafeJson(document.getElementById("field-extra").value.trim() || "{}", {}, "Extra entry fields");
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("Extra entry fields must be a JSON object.");
  var item = {};
  Object.keys(extra).forEach(function(key){ item[key] = extra[key]; });
  if (title) item._title = title;
  if (Object.keys(overrides).length) overrides._title = "Overrides";
  item.channelMatch = channelMatch;
  item.overrides = overrides;
  item.flows = flows;
  return item;
}

function refreshSummary() {
  var indexText = CURRENT_INDEX == null ? "New entry" : String(CURRENT_INDEX);
  document.getElementById("summary-index").textContent = indexText;
  try {
    var draft = getCurrentDraft();
    var matchCount = Array.isArray(draft.channelMatch) ? draft.channelMatch.length : 0;
    var flowCount = Array.isArray(draft.flows) ? draft.flows.length : 0;
    document.getElementById("summary-match-count").textContent = String(matchCount);
    document.getElementById("summary-tool-count").textContent = String(flowCount);
  } catch (err) {
    document.getElementById("summary-match-count").textContent = "Invalid";
    document.getElementById("summary-tool-count").textContent = "Invalid";
  }
}

function setEditorTitle(text) {
  document.getElementById("editor-title").textContent = text || "Editor";
}

function focusEditorOnMobile() {
  if (window.innerWidth > 900) return;
  var panel = document.getElementById("editor-title");
  if (!panel) return;
  requestAnimationFrame(function() {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function api(path, options) {
  var resp = await fetch(BASE + path, options || {});
  var data = await resp.json().catch(function(){ return {}; });
  if (!resp.ok) {
    throw new Error(String(data && (data.error || data.detail) ? (data.error || data.detail) : ("HTTP " + resp.status)));
  }
  return data;
}

function renderList() {
  var search = document.getElementById("list-search").value.trim().toLowerCase();
  var listNode = document.getElementById("channel-list");
  var rows = LIST.filter(function(item) {
    if (!search) return true;
    return String(item.title || "").toLowerCase().includes(search) ||
      String(item.meta || "").toLowerCase().includes(search) ||
      String(item.toolCount || "").toLowerCase().includes(search);
  });
  if (!rows.length) {
    listNode.innerHTML = '<li class="ccm-item"><div class="ccm-item-title">No matching channels</div><div class="ccm-item-meta">Try a different search or create a new entry.</div></li>';
    return;
  }
  listNode.innerHTML = rows.map(function(item) {
    var active = item.index === CURRENT_INDEX ? " active" : "";
    return '<li class="ccm-item' + active + '" onclick="loadItem(' + String(item.index) + ')">' +
      '<div class="ccm-item-title">' + esc(item.title) + '</div>' +
      '<div class="ccm-item-meta">' + esc(item.meta) + '</div>' +
      '<div class="ccm-item-stats">' + String(item.toolCount) + ' configured tool(s)</div>' +
      '</li>';
  }).join("");
}

function fillEditor(payload) {
  CURRENT_INDEX = typeof payload.index === "number" ? payload.index : null;
  LOADED_INDEX = CURRENT_INDEX;
  document.getElementById("field-title").value = String(payload.title || "");
  var matches = Array.isArray(payload.channelMatch) ? payload.channelMatch.map(function(v) { return String(v); }) : [];
  document.getElementById("field-primary-match").value = matches[0] || "";
  document.getElementById("field-channel-match").value = matches.slice(1).join("\\n");
  renderOverrideRows(payload.overrides || {});
  renderFlowCards(Array.isArray(payload.flows) ? payload.flows : []);
  document.getElementById("field-extra").value = getJsonPretty(payload.extra || {});
  setEditorTitle(CURRENT_INDEX == null ? "New Channel Config" : ("Channel Config #" + String(CURRENT_INDEX)));
  setDirty(false);
  refreshSummary();
  renderList();
}

function createNew() {
  fillEditor({
    index: null,
    title: "",
    channelMatch: [],
    overrides: {},
    flows: [],
    extra: {}
  });
  focusEditorOnMobile();
}

async function loadItem(index) {
  if (DIRTY && !window.confirm("Discard unsaved changes?")) return;
  try {
    var payload = await api("/api/item?index=" + encodeURIComponent(String(index)));
    fillEditor(payload);
    focusEditorOnMobile();
  } catch (err) {
    toast(String(err.message || err), 3000);
  }
}

async function reloadList() {
  try {
    var payload = await api("/api/list");
    LIST = Array.isArray(payload.items) ? payload.items : [];
    renderList();
  } catch (err) {
    toast(String(err.message || err), 3000);
  }
}

async function reloadCurrent() {
  if (CURRENT_INDEX == null) {
    createNew();
    return;
  }
  await loadItem(CURRENT_INDEX);
}

function duplicateCurrent() {
  try {
    var draft = getCurrentDraft();
    fillEditor({
      index: null,
      title: String(draft._title || draft.title || "").trim() ? String(draft._title || draft.title || "") + " Copy" : "",
      channelMatch: draft.channelMatch || [],
      overrides: draft.overrides || {},
      flows: draft.flows || [],
      extra: Object.keys(draft).reduce(function(acc, key) {
        if (key !== "_title" && key !== "channelMatch" && key !== "overrides" && key !== "flows") acc[key] = draft[key];
        return acc;
      }, {})
    });
    setDirty(true);
    focusEditorOnMobile();
  } catch (err) {
    toast(String(err.message || err), 3000);
  }
}

async function saveCurrent() {
  try {
    var item = getCurrentDraft();
    var payload = await api("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        index: CURRENT_INDEX,
        item: item
      })
    });
    CURRENT_INDEX = typeof payload.index === "number" ? payload.index : CURRENT_INDEX;
    LOADED_INDEX = CURRENT_INDEX;
    setDirty(false);
    setEditorTitle(CURRENT_INDEX == null ? "New Channel Config" : ("Channel Config #" + String(CURRENT_INDEX)));
    await reloadList();
    if (CURRENT_INDEX != null) await loadItem(CURRENT_INDEX);
    toast("Channel config saved.");
  } catch (err) {
    toast(String(err.message || err), 3500);
  }
}

async function deleteCurrent() {
  if (CURRENT_INDEX == null) {
    createNew();
    return;
  }
  if (!window.confirm("Delete this channel config entry?")) return;
  try {
    await api("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: CURRENT_INDEX })
    });
    toast("Channel config deleted.");
    createNew();
    await reloadList();
  } catch (err) {
    toast(String(err.message || err), 3500);
  }
}

window.createNew = createNew;
window.reloadList = reloadList;
window.reloadCurrent = reloadCurrent;
window.loadItem = loadItem;
window.saveCurrent = saveCurrent;
window.deleteCurrent = deleteCurrent;
window.duplicateCurrent = duplicateCurrent;

bindDirtyTracking();
reloadList().then(function() {
  if (LIST.length) return loadItem(LIST[0].index);
  createNew();
});
</script>
</body>
</html>`;
}

export default async function getWebpageChannelConfigManager(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3129);
  const basePath = getBasePath(cfg);
  const cfgFile = getConfigFile(cfg);

  if (Number(wo.http?.port) !== port) return coreData;

  const method = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  if (urlPath === "/auth" || urlPath.startsWith("/auth/")) return coreData;

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

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

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: isAllowed
        ? getPageHtml({
            menu: wo.web?.menu || [],
            role: wo.webAuth?.role || "",
            activePath: urlPath,
            basePath,
            webAuth: wo.webAuth
          })
        : getAccessDeniedHtml({
            menu: wo.web?.menu || [],
            role: wo.webAuth?.role || "",
            activePath: urlPath,
            basePath,
            webAuth: wo.webAuth
          })
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const result = readJsonFile(cfgFile);
    if (!result.ok) setJsonResp(wo, 500, { error: result.error });
    else setJsonResp(wo, 200, { items: getListPayload(result.data) });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/item") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const index = Number(getQueryValue(wo, "index") ?? "");
    if (!Number.isInteger(index) || index < 0) {
      setJsonResp(wo, 400, { error: "invalid_index" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const result = readJsonFile(cfgFile);
    if (!result.ok) setJsonResp(wo, 500, { error: result.error });
    else {
      const item = getEntryPayload(result.data, index);
      if (!item) setJsonResp(wo, 404, { error: "not_found" });
      else setJsonResp(wo, 200, item);
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/save") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const body = wo.http?.json || {};
    const inputItem = body?.item;
    const index = body?.index == null ? null : Number(body.index);
    if (!inputItem || typeof inputItem !== "object" || Array.isArray(inputItem)) {
      setJsonResp(wo, 400, { error: "invalid_item" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const channelMatch = Array.isArray(inputItem.channelMatch) ? inputItem.channelMatch : null;
    const overrides = inputItem.overrides;
    const flows = inputItem.flows == null ? [] : inputItem.flows;
    if (!channelMatch) {
      setJsonResp(wo, 400, { error: "channelMatch must be an array" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      setJsonResp(wo, 400, { error: "overrides must be an object" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    if (!Array.isArray(flows)) {
      setJsonResp(wo, 400, { error: "flows must be an array" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const result = readJsonFile(cfgFile);
    if (!result.ok) {
      setJsonResp(wo, 500, { error: result.error });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const configJson = result.data;
    const channels = getChannelsRoot(configJson);
    const nextItem = {};
    for (const key of Object.keys(inputItem)) {
      if (key === "_title" || key === "channelMatch" || key === "overrides" || key === "flows") continue;
      nextItem[key] = inputItem[key];
    }
    if (typeof inputItem._title === "string" && inputItem._title.trim()) nextItem._title = inputItem._title.trim();
    nextItem.channelMatch = cloneJson(channelMatch);
    nextItem.overrides = cloneJson(overrides);
    nextItem.flows = cloneJson(flows);
    if (index == null) channels.push(nextItem);
    else if (Number.isInteger(index) && index >= 0 && index < channels.length) channels[index] = nextItem;
    else {
      setJsonResp(wo, 400, { error: "invalid_index" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const writeResult = writeJsonFile(cfgFile, configJson);
    if (!writeResult.ok) setJsonResp(wo, 500, { error: writeResult.error });
    else setJsonResp(wo, 200, { ok: true, index: index == null ? channels.length - 1 : index });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/delete") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const index = Number(wo.http?.json?.index ?? "");
    if (!Number.isInteger(index) || index < 0) {
      setJsonResp(wo, 400, { error: "invalid_index" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const result = readJsonFile(cfgFile);
    if (!result.ok) {
      setJsonResp(wo, 500, { error: result.error });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const configJson = result.data;
    const channels = getChannelsRoot(configJson);
    if (index >= channels.length) {
      setJsonResp(wo, 404, { error: "not_found" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    channels.splice(index, 1);
    const writeResult = writeJsonFile(cfgFile, configJson);
    if (!writeResult.ok) setJsonResp(wo, 500, { error: writeResult.error });
    else setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath.startsWith(basePath + "/api/")) {
    setNotFound(wo);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}
