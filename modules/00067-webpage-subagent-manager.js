/**************************************************************/
/* filename: "00067-webpage-subagent-manager.js"             */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript, readJsonFile, writeJsonFile } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import { getStr } from "../core/utils.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-subagent-manager";
const CHANNEL_CONFIG_KEY = "core-channel-config";

const AVAILABLE_TOOLS = [
  "getTavily", "getWebpage", "getYoutube", "getGoogle", "getImage", "getImageSD",
  "getAnimatedPicture", "getVideoFromText", "getImageDescription",
  "getHistory", "getTime", "getLocation",
  "getFile", "getFileContent", "getText", "getZIP", "getPDF", "getShell",
  "getApi", "getApiBearers", "getConfluence", "getJira", "getGraph", "getSpotify",
  "getOrchestrator", "getSpecialists", "getToken", "getBan", "getMyConnections"
];

function getBasePath(cfg) {
  const v = getStr(cfg.basePath ?? "/subagents").trim();
  return v && v.startsWith("/") ? v.replace(/\/+$/, "") : "/subagents";
}

function getCorePath() {
  return fileURLToPath(new URL("../core.json", import.meta.url));
}

function getSlugFromMatch(role, match) {
  const prefix = "subagent-" + role + "-";
  const suffix = "-*";
  let s = String(match || "");
  if (s.startsWith(prefix)) s = s.slice(prefix.length);
  if (s.endsWith(suffix)) s = s.slice(0, -suffix.length);
  return s;
}

function getToolsconfigKey(role) {
  return role === "orchestrator" ? "getOrchestrator" : "getSpecialists";
}

function getSubagentChannels(configJson, role) {
  const prefix = "subagent-" + role + "-";
  const channels = configJson?.config?.[CHANNEL_CONFIG_KEY]?.channels || [];
  return channels
    .map((ch, i) => ({ ch, i }))
    .filter(({ ch }) => {
      const match = Array.isArray(ch.channelMatch) ? ch.channelMatch[0] : String(ch.channelMatch || "");
      return match.startsWith(prefix);
    });
}

function apiList(configJson) {
  const map = (role) =>
    getSubagentChannels(configJson, role).map(({ ch }) => {
      const match = Array.isArray(ch.channelMatch) ? ch.channelMatch[0] : "";
      const slug = getSlugFromMatch(role, match);
      return {
        slug,
        title: getStr(ch._title) || slug,
        tools: Array.isArray(ch.overrides?.tools) ? ch.overrides.tools : []
      };
    });
  return { ok: true, orchestrators: map("orchestrator"), specialists: map("specialist") };
}

function apiGet(configJson, role, slug) {
  const prefix = "subagent-" + role + "-" + slug + "-*";
  const channels = configJson?.config?.[CHANNEL_CONFIG_KEY]?.channels || [];
  const ch = channels.find((c) => {
    const m = Array.isArray(c.channelMatch) ? c.channelMatch[0] : String(c.channelMatch || "");
    return m === prefix;
  });
  if (!ch) return { ok: false, error: "Not found" };
  const tc = configJson?.workingObject?.toolsconfig?.[getToolsconfigKey(role)] || {};
  return {
    ok: true,
    role,
    slug,
    title: getStr(ch._title),
    tools: Array.isArray(ch.overrides?.tools) ? ch.overrides.tools : [],
    systemPrompt: getStr(ch.overrides?.systemPrompt),
    instructions: getStr(ch.overrides?.instructions),
    model: getStr(ch.overrides?.model),
    channelBaseId: tc.types?.[slug] || ("subagent-" + role + "-" + slug)
  };
}

function apiSave(configJson, { role, slug, title, tools, systemPrompt, instructions, model }) {
  if (!role || !slug || !/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: "Invalid role or slug" };
  const channels = configJson.config[CHANNEL_CONFIG_KEY].channels;
  const matchStr = "subagent-" + role + "-" + slug + "-*";
  const overrides = { tools: Array.isArray(tools) ? tools : [] };
  if (systemPrompt) overrides.systemPrompt = systemPrompt;
  if (instructions) overrides.instructions = instructions;
  if (model) overrides.model = model;
  const entry = {
    channelMatch: [matchStr],
    overrides,
    _title: title || (role === "orchestrator" ? "Orchestrator: " : "Specialist: ") + slug
  };
  const idx = channels.findIndex((c) => {
    const m = Array.isArray(c.channelMatch) ? c.channelMatch[0] : String(c.channelMatch || "");
    return m === matchStr;
  });
  if (idx >= 0) channels[idx] = entry;
  else channels.push(entry);

  const tcKey = getToolsconfigKey(role);
  if (!configJson.workingObject.toolsconfig) configJson.workingObject.toolsconfig = {};
  if (!configJson.workingObject.toolsconfig[tcKey]) configJson.workingObject.toolsconfig[tcKey] = {};
  if (!configJson.workingObject.toolsconfig[tcKey].types) configJson.workingObject.toolsconfig[tcKey].types = {};
  configJson.workingObject.toolsconfig[tcKey].types[slug] = "subagent-" + role + "-" + slug;
  return { ok: true };
}

function apiDelete(configJson, { role, slug }) {
  if (!role || !slug) return { ok: false, error: "role and slug required" };
  const matchStr = "subagent-" + role + "-" + slug + "-*";
  const channels = configJson.config[CHANNEL_CONFIG_KEY].channels;
  const before = channels.length;
  configJson.config[CHANNEL_CONFIG_KEY].channels = channels.filter((c) => {
    const m = Array.isArray(c.channelMatch) ? c.channelMatch[0] : String(c.channelMatch || "");
    return m !== matchStr;
  });
  const tcKey = getToolsconfigKey(role);
  if (configJson.workingObject.toolsconfig?.[tcKey]?.types) {
    delete configJson.workingObject.toolsconfig[tcKey].types[slug];
  }
  return { ok: true, removed: before - configJson.config[CHANNEL_CONFIG_KEY].channels.length };
}

function buildPageHtml(opts) {
  const basePath = String(opts.basePath || "/subagents").replace(/\/+$/, "");
  const menuHtml = opts.menuHtml || "";
  const toolsJson = JSON.stringify(AVAILABLE_TOOLS);
  const baseJson  = JSON.stringify(basePath);

  return "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">\n" +
    "<title>Subagent Manager</title>\n" +
    getThemeHeadScript() + "\n" +
    "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\">\n" +
    "<style>\n" +
    ".sam-wrap{margin-top:var(--hh);height:calc(100dvh - var(--hh));display:grid;grid-template-columns:280px 1fr;overflow:hidden;position:relative}\n" +
    ".sam-sidebar{border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden;transition:opacity .15s}\n" +
    ".sam-wrap.collapsed{grid-template-columns:0 1fr}\n" +
    ".sam-wrap.collapsed .sam-sidebar{pointer-events:none;opacity:0}\n" +
    ".sam-sb-toggle{position:fixed;top:calc(var(--hh) + 10px);left:280px;z-index:20;background:var(--bg2);border:1px solid var(--bdr);border-left:none;border-radius:0 6px 6px 0;padding:7px 5px;cursor:pointer;font-size:14px;color:var(--muted);transition:left .15s;line-height:1}\n" +
    ".sam-wrap.collapsed~.sam-sb-toggle{left:0;border-left:1px solid var(--bdr);border-radius:6px}\n" +
    ".sam-tabs{display:flex;border-bottom:1px solid var(--bdr)}\n" +
    ".sam-tab{flex:1;padding:10px 0;font-size:13px;font-weight:600;cursor:pointer;text-align:center;border:none;background:none;color:var(--muted)}\n" +
    ".sam-tab.active{color:var(--accent);border-bottom:2px solid var(--accent)}\n" +
    ".sam-list-head{padding:8px 10px;display:flex;gap:6px;border-bottom:1px solid var(--bdr)}\n" +
    ".sam-list-head input{flex:1;border:1px solid var(--bdr);border-radius:6px;padding:5px 8px;font-size:12px;background:var(--bg);color:var(--txt)}\n" +
    ".sam-list{overflow-y:auto;flex:1}\n" +
    ".sam-item{padding:10px 12px;border-bottom:1px solid var(--bdr);cursor:pointer;display:block;width:100%;box-sizing:border-box;text-align:left;background:none;border-left:none}\n" +
    ".sam-item:hover{background:var(--bg2)}\n" +
    ".sam-item.active{background:rgba(59,130,246,.1);border-left:3px solid var(--accent);padding-left:9px}\n" +
    ".sam-item-title{font-weight:600;font-size:13px;color:var(--txt)}\n" +
    ".sam-item-meta{font-size:11px;color:var(--muted);margin-top:3px;font-family:monospace}\n" +
    ".sam-main{overflow-y:auto;padding:16px 20px 40px}\n" +
    ".sam-form{display:grid;gap:14px;max-width:760px}\n" +
    ".sam-row{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start}\n" +
    ".sam-row label{font-size:12px;color:var(--muted);padding-top:9px}\n" +
    ".sam-row input,.sam-row textarea{width:100%;border:1px solid var(--bdr);border-radius:8px;padding:8px 10px;background:var(--bg);color:var(--txt);box-sizing:border-box;font-size:13px}\n" +
    ".sam-row textarea{min-height:140px;resize:vertical;font-family:monospace;font-size:12px;line-height:1.5}\n" +
    ".sam-tools{display:flex;flex-wrap:wrap;gap:5px;padding:6px 8px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);min-height:38px;align-items:flex-start}\n" +
    ".sam-tool-tag{display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;border-radius:10px;padding:2px 4px 2px 9px;font-size:11px}\n" +
    ".sam-tool-tag button{background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;padding:0 4px;font-size:13px;line-height:1}\n" +
    ".sam-tool-tag button:hover{color:#fff}\n" +
    ".sam-tool-add{display:flex;gap:6px;margin-top:4px}\n" +
    ".sam-tool-add select{border:1px solid var(--bdr);border-radius:6px;padding:5px 8px;font-size:12px;background:var(--bg);color:var(--txt)}\n" +
    ".sam-actions{display:flex;gap:8px;padding-top:4px}\n" +
    ".sam-badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}\n" +
    ".sam-badge.orch{background:rgba(139,92,246,.15);color:#7c3aed}\n" +
    ".sam-badge.spec{background:rgba(16,185,129,.15);color:#059669}\n" +
    ".sam-empty{padding:24px 16px;color:var(--muted);font-size:13px;text-align:center}\n" +
    ".sam-title-row{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}\n" +
    ".sam-title-row h2{margin:0;font-size:16px}\n" +
    ".sam-sb-backdrop{display:none}\n" +
    "@media(max-width:680px){\n" +
    ".sam-wrap{grid-template-columns:1fr}\n" +
    ".sam-sidebar{position:fixed;top:var(--hh);left:0;bottom:0;width:280px;z-index:50;background:var(--bg2);transform:translateX(-100%);transition:transform .2s;opacity:1!important;pointer-events:auto!important}\n" +
    ".sam-wrap.sidebar-open .sam-sidebar{transform:translateX(0)}\n" +
    ".sam-sb-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:49}\n" +
    ".sam-wrap.sidebar-open .sam-sb-backdrop{display:block}\n" +
    ".sam-sb-toggle{left:8px!important;border:1px solid var(--bdr)!important;border-radius:6px!important}\n" +
    ".sam-wrap.collapsed~.sam-sb-toggle{left:8px!important}\n" +
    ".sam-row{grid-template-columns:1fr}\n" +
    ".sam-row label{padding-top:0}\n" +
    ".sam-main{padding:12px 12px 40px}\n" +
    "}\n" +
    "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    "<header>\n" +
    "  <h1>Subagent Manager</h1>\n" +
    (menuHtml ? "  " + menuHtml + "\n" : "") +
    "</header>\n" +
    "<div class=\"sam-wrap\" id=\"sam-wrap\">\n" +
    "  <div class=\"sam-sb-backdrop\" onclick=\"toggleSidebar()\"></div>\n" +
    "  <div class=\"sam-sidebar\">\n" +
    "    <div class=\"sam-tabs\">\n" +
    "      <button class=\"sam-tab active\" onclick=\"switchTab('orchestrator')\">Orchestrators</button>\n" +
    "      <button class=\"sam-tab\" onclick=\"switchTab('specialist')\">Specialists</button>\n" +
    "    </div>\n" +
    "    <div class=\"sam-list-head\">\n" +
    "      <input type=\"text\" placeholder=\"Filter...\" oninput=\"filterList(this.value)\" id=\"filter-inp\">\n" +
    "      <button class=\"btn btn-s\" onclick=\"newItem()\">+ New</button>\n" +
    "    </div>\n" +
    "    <div class=\"sam-list\" id=\"sam-list\"></div>\n" +
    "  </div>\n" +
    "  <div class=\"sam-main\" id=\"sam-main\">\n" +
    "    <div class=\"sam-empty\">Select an item or create a new one.</div>\n" +
    "  </div>\n" +
    "</div>\n" +
    "<button class=\"sam-sb-toggle\" id=\"sam-sb-toggle\" onclick=\"toggleSidebar()\" title=\"Toggle sidebar\">&#8249;</button>\n" +
    "<div id=\"toast\" class=\"toast\"></div>\n" +
    "<script>\n" +
    "var BASE = " + baseJson + ";\n" +
    "var TOOLS = " + toolsJson + ";\n" +
    "var currentTab = 'orchestrator';\n" +
    "var currentSlug = null;\n" +
    "var allData = { orchestrators: [], specialists: [] };\n" +
    "var formTools = [];\n" +
    "\n" +
    "function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }\n" +
    "function toast(msg,ms){ var t=document.getElementById('toast'); t.textContent=msg; t.classList.add('on'); setTimeout(function(){ t.classList.remove('on'); },ms||2400); }\n" +
    "\n" +
    "function switchTab(role) {\n" +
    "  currentTab = role; currentSlug = null;\n" +
    "  document.querySelectorAll('.sam-tab').forEach(function(b,i){ b.classList.toggle('active',(i===0&&role==='orchestrator')||(i===1&&role==='specialist')); });\n" +
    "  document.getElementById('filter-inp').value = '';\n" +
    "  renderList('');\n" +
    "  document.getElementById('sam-main').innerHTML = '<div class=\"sam-empty\">Select an item or create a new one.</div>';\n" +
    "}\n" +
    "\n" +
    "function getListItems() { return currentTab === 'orchestrator' ? allData.orchestrators : allData.specialists; }\n" +
    "\n" +
    "function renderList(filter) {\n" +
    "  var items = getListItems();\n" +
    "  var f = filter.toLowerCase();\n" +
    "  var list = document.getElementById('sam-list');\n" +
    "  list.innerHTML = '';\n" +
    "  var filtered = items.filter(function(it){ return !f || it.slug.includes(f) || it.title.toLowerCase().includes(f); });\n" +
    "  if (!filtered.length) { list.innerHTML = '<div class=\"sam-empty\">No items.</div>'; return; }\n" +
    "  filtered.forEach(function(it) {\n" +
    "    var btn = document.createElement('button');\n" +
    "    btn.className = 'sam-item' + (it.slug === currentSlug ? ' active' : '');\n" +
    "    btn.innerHTML = '<div class=\"sam-item-title\">'+esc(it.title||it.slug)+'</div><div class=\"sam-item-meta\">'+esc(it.slug)+' &middot; '+it.tools.length+' tools</div>';\n" +
    "    btn.onclick = function(){ selectItem(it.slug); };\n" +
    "    list.appendChild(btn);\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function filterList(v) { renderList(v); }\n" +
    "\n" +
    "function selectItem(slug) {\n" +
    "  currentSlug = slug;\n" +
    "  renderList(document.getElementById('filter-inp').value);\n" +
    "  fetch(BASE+'/api/get?role='+currentTab+'&slug='+encodeURIComponent(slug))\n" +
    "    .then(function(r){ return r.json(); })\n" +
    "    .then(function(data){\n" +
    "      if (!data.ok) { toast('Load error: '+(data.error||'?'),5000); return; }\n" +
    "      renderForm(data);\n" +
    "      if (window.innerWidth <= 680) {\n" +
    "        document.getElementById('sam-wrap').classList.remove('sidebar-open');\n" +
    "        document.getElementById('sam-sb-toggle').innerHTML = '&#8249;';\n" +
    "      }\n" +
    "    })\n" +
    "    .catch(function(e){ toast('Error: '+e.message,5000); });\n" +
    "}\n" +
    "\n" +
    "function newItem() {\n" +
    "  currentSlug = null;\n" +
    "  renderList(document.getElementById('filter-inp').value);\n" +
    "  renderForm({ role: currentTab, slug: '', title: '', tools: [], systemPrompt: '', instructions: '', model: '', isNew: true });\n" +
    "}\n" +
    "\n" +
    "function renderToolTags() {\n" +
    "  var c = document.getElementById('tools-tags');\n" +
    "  if (!c) return;\n" +
    "  c.innerHTML = '';\n" +
    "  if (!formTools.length) { c.innerHTML = '<span style=\"font-size:12px;color:var(--muted)\">No tools selected</span>'; return; }\n" +
    "  formTools.forEach(function(t,i) {\n" +
    "    var sp = document.createElement('span');\n" +
    "    sp.className = 'sam-tool-tag';\n" +
    "    sp.innerHTML = esc(t)+'<button title=\"Remove\" onclick=\"removeTool('+i+')\">&#215;</button>';\n" +
    "    c.appendChild(sp);\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function removeTool(i) { formTools.splice(i,1); renderToolTags(); }\n" +
    "\n" +
    "function renderForm(data) {\n" +
    "  formTools = Array.isArray(data.tools) ? data.tools.slice() : [];\n" +
    "  var isNew = !!data.isNew;\n" +
    "  var role = data.role || currentTab;\n" +
    "  var badgeCls = role === 'orchestrator' ? 'orch' : 'spec';\n" +
    "  var badgeLabel = role === 'orchestrator' ? 'Orchestrator' : 'Specialist';\n" +
    "  var h = '<div class=\"sam-title-row\"><h2>'+(isNew?'New '+badgeLabel:esc(data.title||data.slug))+'</h2>';\n" +
    "  h += '<span class=\"sam-badge '+badgeCls+'\">'+badgeLabel+'</span></div>';\n" +
    "  h += '<div class=\"sam-form\">';\n" +
    "  h += '<div class=\"sam-row\"><label>Slug</label>';\n" +
    "  h += isNew ? '<input type=\"text\" id=\"f-slug\" placeholder=\"e.g. development\" value=\"'+esc(data.slug)+'\">' : '<input type=\"text\" id=\"f-slug\" value=\"'+esc(data.slug)+'\" readonly style=\"opacity:.6\">';\n" +
    "  h += '</div>';\n" +
    "  h += '<div class=\"sam-row\"><label>Title</label><input type=\"text\" id=\"f-title\" value=\"'+esc(data.title)+'\"></div>';\n" +
    "  h += '<div class=\"sam-row\"><label>Model</label><input type=\"text\" id=\"f-model\" placeholder=\"(inherits default)\" value=\"'+esc(data.model)+'\"></div>';\n" +
    "  h += '<div class=\"sam-row\"><label>Tools</label><div>';\n" +
    "  h += '<div class=\"sam-tools\" id=\"tools-tags\"></div>';\n" +
    "  h += '<div class=\"sam-tool-add\"><select id=\"tool-picker\"><option value=\"\">+ Add tool</option>';\n" +
    "  TOOLS.forEach(function(t){ h += '<option value=\"'+esc(t)+'\">'+esc(t)+'</option>'; });\n" +
    "  h += '</select></div></div></div>';\n" +
    "  h += '<div class=\"sam-row\"><label>System Prompt</label><textarea id=\"f-sysprompt\" rows=\"8\">'+esc(data.systemPrompt)+'</textarea></div>';\n" +
    "  h += '<div class=\"sam-row\"><label>Instructions</label><textarea id=\"f-instr\" rows=\"5\">'+esc(data.instructions)+'</textarea></div>';\n" +
    "  h += '<div class=\"sam-actions\">';\n" +
    "  h += '<button class=\"btn\" onclick=\"saveForm('+JSON.stringify(role)+','+isNew+')\">Save</button>';\n" +
    "  if (!isNew) h += '<button class=\"btn\" style=\"background:rgba(200,0,0,.12);color:#c00\" onclick=\"deleteItem('+JSON.stringify(role)+','+JSON.stringify(data.slug)+')\">Delete</button>';\n" +
    "  h += '</div></div>';\n" +
    "  document.getElementById('sam-main').innerHTML = h;\n" +
    "  renderToolTags();\n" +
    "  document.getElementById('tool-picker').onchange = function() {\n" +
    "    var v = this.value; if (!v) return;\n" +
    "    if (!formTools.includes(v)) { formTools.push(v); renderToolTags(); }\n" +
    "    this.value = '';\n" +
    "  };\n" +
    "}\n" +
    "\n" +
    "function saveForm(role, isNew) {\n" +
    "  var slug = (document.getElementById('f-slug').value||'').trim();\n" +
    "  if (!slug || !/^[a-z0-9-]+$/.test(slug)) { toast('Slug: lowercase letters, digits and hyphens only',5000); return; }\n" +
    "  var body = { role:role, slug:slug,\n" +
    "    title:(document.getElementById('f-title').value||'').trim(),\n" +
    "    model:(document.getElementById('f-model').value||'').trim(),\n" +
    "    tools:formTools.slice(),\n" +
    "    systemPrompt:(document.getElementById('f-sysprompt').value||'').trim(),\n" +
    "    instructions:(document.getElementById('f-instr').value||'').trim()\n" +
    "  };\n" +
    "  fetch(BASE+'/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})\n" +
    "    .then(function(r){ return r.json(); })\n" +
    "    .then(function(data){\n" +
    "      if (!data.ok) { toast('Save failed: '+(data.error||'?'),5000); return; }\n" +
    "      toast('Saved'); currentSlug=slug; return loadAll();\n" +
    "    }).catch(function(e){ toast('Error: '+e.message,5000); });\n" +
    "}\n" +
    "\n" +
    "function deleteItem(role,slug) {\n" +
    "  if (!confirm('Delete '+role+' \"'+slug+'\"?')) return;\n" +
    "  fetch(BASE+'/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:role,slug:slug})})\n" +
    "    .then(function(r){ return r.json(); })\n" +
    "    .then(function(data){\n" +
    "      if (!data.ok) { toast('Delete failed: '+(data.error||'?'),5000); return; }\n" +
    "      toast('Deleted'); currentSlug=null;\n" +
    "      document.getElementById('sam-main').innerHTML='<div class=\"sam-empty\">Select an item or create a new one.</div>';\n" +
    "      return loadAll();\n" +
    "    }).catch(function(e){ toast('Error: '+e.message,5000); });\n" +
    "}\n" +
    "\n" +
    "function loadAll() {\n" +
    "  return fetch(BASE+'/api/list')\n" +
    "    .then(function(r){ return r.json(); })\n" +
    "    .then(function(data){\n" +
    "      if (!data.ok) { toast('List error: '+(data.error||'?'),5000); return; }\n" +
    "      allData=data; renderList(document.getElementById('filter-inp').value);\n" +
    "    }).catch(function(e){ toast('Error: '+e.message,5000); });\n" +
    "}\n" +
    "\n" +
    "loadAll();\n" +
    "\n" +
    "function toggleSidebar() {\n" +
    "  var wrap = document.getElementById('sam-wrap');\n" +
    "  var btn = document.getElementById('sam-sb-toggle');\n" +
    "  if (window.innerWidth <= 680) {\n" +
    "    var open = wrap.classList.toggle('sidebar-open');\n" +
    "    btn.innerHTML = open ? '&#8250;' : '&#8249;';\n" +
    "  } else {\n" +
    "    var collapsed = wrap.classList.toggle('collapsed');\n" +
    "    btn.innerHTML = collapsed ? '&#8250;' : '&#8249;';\n" +
    "  }\n" +
    "}\n" +
    "<\/script>\n" +
    "</body>\n" +
    "</html>\n";
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
        body: "<!DOCTYPE html><html><head><meta charset=UTF-8><title>Subagent Manager</title>" +
          getThemeHeadScript() + "</head><body><header><h1>Subagent Manager</h1>" + menuHtml +
          "</header><div style='margin-top:var(--hh);padding:16px'><strong>Access denied</strong></div></body></html>"
      };
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    try {
      const r = readJsonFile(getCorePath());
      if (!r.ok) throw new Error(r.error);
      setJsonResp(wo, 200, apiList(r.data));
    } catch (e) {
      setJsonResp(wo, 500, { ok: false, error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/get") {
    try {
      const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
      const role = getStr(params.get("role")).trim();
      const slug = getStr(params.get("slug")).trim();
      if (!role || !slug) {
        setJsonResp(wo, 400, { ok: false, error: "role and slug required" });
      } else {
        const r = readJsonFile(getCorePath());
        if (!r.ok) throw new Error(r.error);
        setJsonResp(wo, 200, apiGet(r.data, role, slug));
      }
    } catch (e) {
      setJsonResp(wo, 500, { ok: false, error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/save") {
    try {
      const body = wo.http?.json || {};
      const r = readJsonFile(getCorePath());
      if (!r.ok) throw new Error(r.error);
      const result = apiSave(r.data, body);
      if (!result.ok) {
        setJsonResp(wo, 400, result);
      } else {
        writeJsonFile(getCorePath(), r.data);
        log("Saved " + body.role + " \"" + body.slug + "\"");
        setJsonResp(wo, 200, { ok: true });
      }
    } catch (e) {
      log("save failed: " + String(e?.message || e), "error");
      setJsonResp(wo, 500, { ok: false, error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/delete") {
    try {
      const body = wo.http?.json || {};
      const r = readJsonFile(getCorePath());
      if (!r.ok) throw new Error(r.error);
      const result = apiDelete(r.data, body);
      if (!result.ok) {
        setJsonResp(wo, 400, result);
      } else {
        writeJsonFile(getCorePath(), r.data);
        log("Deleted " + body.role + " \"" + body.slug + "\"");
        setJsonResp(wo, 200, result);
      }
    } catch (e) {
      log("delete failed: " + String(e?.message || e), "error");
      setJsonResp(wo, 500, { ok: false, error: String(e?.message || e) });
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
