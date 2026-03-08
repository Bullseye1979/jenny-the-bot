/**********************************************************************************/
/* filename: 00046-webpage-bard.js                                                */
/* Version 1.0                                                                    */
/* Purpose: Bard music manager with MP3 upload and tag editor on its own port.    */
/**********************************************************************************/

/**********************************************************************************/
/*                                                                                */
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/

/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml } from "../shared/webpage/interface.js";
import { getItem }     from "../core/registry.js";

const MODULE_NAME = "webpage-bard";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/

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

function setJsonResp(wo, status, data) {
  wo.http.response = { status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

function getStr(v) { return v == null ? "" : String(v); }

function getBody(wo) {
  if (Buffer.isBuffer(wo.http?.rawBodyBytes)) return wo.http.rawBodyBytes.toString("utf8");
  return String(wo.http?.rawBody ?? wo.http?.body ?? "");
}

function getUserRoleLabels(wo) {
  const out = [], seen = new Set();
  const primary = getStr(wo?.webAuth?.role).trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) for (const r of roles) { const v = getStr(r).trim().toLowerCase(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } }
  return out;
}

function getIsAllowed(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set(getUserRoleLabels(wo));
  return req.some(r => have.has(getStr(r).trim().toLowerCase()));
}

function getBasePath(cfg) {
  const bp = getStr(cfg.basePath ?? "/bard-admin").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/bard-admin";
}

/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/
function getMusicDir(cfg, globalConfig) {
  const dir = getStr(cfg.musicDir || globalConfig?.bard?.musicDir || "assets/bard");
  return path.resolve(__dirname, "..", dir);
}

function parseTracks(xmlText) {
  const tracks = [];
  const re = /<track\s+([^>]*)>([\s\S]*?)<\/track>/gi;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const fileM  = /file="([^"]*)"/.exec(attrs);
    const titleM = /title="([^"]*)"/.exec(attrs);
    const tagsM   = /<tags>([^<]*)<\/tags>/i.exec(inner);
    const volumeM = /<volume>([^<]*)<\/volume>/i.exec(inner);
    const file  = fileM  ? fileM[1]  : "";
    const title = titleM ? titleM[1] : "";
    const tags  = tagsM  ? tagsM[1].split(",").map(t => t.trim()).filter(Boolean) : [];
    const rawVol = volumeM ? parseFloat(volumeM[1]) : NaN;
    const volume = Number.isFinite(rawVol) ? Math.max(0.1, Math.min(4.0, rawVol)) : 1.0;
    if (file) tracks.push({ file, title, tags, volume });
  }
  return tracks;
}

function serializeTracks(tracks) {
  const esc = s => getStr(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<library>"];
  for (const t of tracks) {
    const vol = Number.isFinite(t.volume) ? Math.max(0.1, Math.min(4.0, t.volume)) : 1.0;
    lines.push(`  <track file="${esc(t.file)}" title="${esc(t.title || "")}">`);
    lines.push(`    <tags>${(t.tags || []).join(",")}</tags>`);
    lines.push(`    <volume>${vol.toFixed(1)}</volume>`);
    lines.push("  </track>");
  }
  lines.push("</library>");
  return lines.join("\n");
}

function readTracks(musicDir) {
  const xmlPath = path.join(musicDir, "library.xml");
  if (!fs.existsSync(xmlPath)) return [];
  return parseTracks(fs.readFileSync(xmlPath, "utf8"));
}

function writeTracks(musicDir, tracks) {
  const xmlPath = path.join(musicDir, "library.xml");
  fs.writeFileSync(xmlPath, serializeTracks(tracks), "utf8");
}

/**********************************************************************************/

/**********************************************************************************/
/* functionSignature: getWebpageBard(coreData)                                    */
/* Performs the described operation.                                              */
/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/
export default async function getWebpageBard(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3114);
  const basePath     = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const musicDir     = getMusicDir(cfg, coreData?.config);

  if (Number(wo.http?.port) !== port) return coreData;
  if (wo.jump) return coreData;

  const method  = getStr(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = getStr(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];
  const isAllowed = getIsAllowed(wo, allowedRoles);

  /**********************************************************************************/
  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    wo.http.response = { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" }, body: fs.readFileSync(cssFile, "utf-8") };
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: isAllowed
        ? getBardHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, base: basePath })
        : getAccessDeniedHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, base: basePath })
    };
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (!isAllowed) {
    setJsonResp(wo, 403, { error: "forbidden" });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "GET" && urlPath === basePath + "/api/library") {
    const tracks = readTracks(musicDir);
    const files  = fs.existsSync(musicDir) ? fs.readdirSync(musicDir).filter(f => /\.mp3$/i.test(f)) : [];
    setJsonResp(wo, 200, { tracks, files });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "POST" && urlPath === basePath + "/api/upload") {
    let reqData; try { reqData = JSON.parse(getBody(wo)); } catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const filename = path.basename(getStr(reqData?.filename)).replace(/[^a-zA-Z0-9 ._-]/g, "_");
    const title    = getStr(reqData?.title || filename.replace(/\.mp3$/i, ""));
    const tags     = Array.isArray(reqData?.tags) ? reqData.tags.map(t => getStr(t).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean) : [];
    const data     = getStr(reqData?.data);
    const rawVol   = typeof reqData?.volume === "number" ? reqData.volume : parseFloat(reqData?.volume);
    const volume   = Number.isFinite(rawVol) ? Math.max(0.1, Math.min(4.0, rawVol)) : 1.0;

    if (!filename || !/\.mp3$/i.test(filename)) { setJsonResp(wo, 400, { error: "filename must end with .mp3" }); wo.jump = true; await setSendNow(wo); return coreData; }
    if (!data) { setJsonResp(wo, 400, { error: "data (base64) required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
      fs.writeFileSync(path.join(musicDir, filename), Buffer.from(data, "base64"));
      const tracks = readTracks(musicDir);
      const existing = tracks.findIndex(t => t.file === filename);
      if (existing >= 0) tracks[existing] = { file: filename, title, tags, volume };
      else tracks.push({ file: filename, title, tags, volume });
      writeTracks(musicDir, tracks);
      setJsonResp(wo, 200, { ok: true, filename, title, tags, volume });
    } catch (e) {
      setJsonResp(wo, 500, { error: getStr(e?.message) });
    }
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "POST" && urlPath === basePath + "/api/tags") {
    let reqData; try { reqData = JSON.parse(getBody(wo)); } catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const filename = getStr(reqData?.file);
    const title    = getStr(reqData?.title);
    const tags     = Array.isArray(reqData?.tags) ? reqData.tags.map(t => getStr(t).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean) : [];
    const rawVol   = typeof reqData?.volume === "number" ? reqData.volume : parseFloat(reqData?.volume);
    const volume   = Number.isFinite(rawVol) ? Math.max(0.1, Math.min(4.0, rawVol)) : null;

    if (!filename) { setJsonResp(wo, 400, { error: "file required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const tracks = readTracks(musicDir);
      const idx = tracks.findIndex(t => t.file === filename);
      if (idx < 0) { setJsonResp(wo, 404, { error: "track not found in library" }); wo.jump = true; await setSendNow(wo); return coreData; }
      tracks[idx] = { file: filename, title: title || tracks[idx].title, tags, volume: volume !== null ? volume : (tracks[idx].volume ?? 1.0) };
      writeTracks(musicDir, tracks);
      setJsonResp(wo, 200, { ok: true });
    } catch (e) {
      setJsonResp(wo, 500, { error: getStr(e?.message) });
    }
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "DELETE" && urlPath === basePath + "/api/track") {
    let reqData; try { reqData = JSON.parse(getBody(wo)); } catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const filename = getStr(reqData?.file);
    if (!filename) { setJsonResp(wo, 400, { error: "file required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const tracks = readTracks(musicDir);
      const filtered = tracks.filter(t => t.file !== filename);
      writeTracks(musicDir, filtered);
      const mp3Path = path.join(musicDir, path.basename(filename));
      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
      setJsonResp(wo, 200, { ok: true });
    } catch (e) {
      setJsonResp(wo, 500, { error: getStr(e?.message) });
    }
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  return coreData;
}

/**********************************************************************************/

/**********************************************************************************/
/**********************************************************************************/
function getAccessDeniedHtml({ menu, role, activePath, base }) {
  const menuHtml = getMenuHtml(menu || [], activePath || base, role || "");
  return (
'<!DOCTYPE html><html lang="en"><head>' +
'<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Jenny — Bard Admin</title>' +
'<link rel="stylesheet" href="' + base + '/style.css"></head><body>' +
'<header><h1>Jenny</h1>' + (menuHtml ? menuHtml : "") + '</header>' +
'<div style="margin-top:var(--hh);padding:16px">' +
'<div style="padding:12px;border:1px solid var(--bdr);border-radius:8px;background:#fff">' +
'<strong>Access denied</strong><br><span style="color:var(--muted)">You do not have permission to access the Bard Admin.</span>' +
'</div></div></body></html>'
  );
}

function getBardHtml({ menu, role, activePath, base }) {
  const menuHtml = getMenuHtml(menu || [], activePath || base, role || "");

  return (
'<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
'<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>Jenny — Bard Admin</title>\n' +
'<link rel="stylesheet" href="' + base + '/style.css">\n' +
'<style>\n' +
'#bard-wrap{margin-top:var(--hh);height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));overflow-y:auto;padding:16px;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 80px);display:flex;flex-direction:column;gap:16px;max-width:860px;margin-left:auto;margin-right:auto}\n' +
'.card{background:#fff;border:1px solid var(--bdr);border-radius:8px;padding:14px}\n' +
'.card h2{font-size:14px;font-weight:700;margin-bottom:12px;color:var(--txt)}\n' +
'#drop-zone{border:2px dashed var(--bdr);border-radius:8px;padding:28px 16px;text-align:center;color:var(--muted);cursor:pointer;transition:border-color .15s,background .15s;font-size:13px}\n' +
'#drop-zone.over{border-color:var(--acc);background:#eff6ff}\n' +
'#drop-zone input[type=file]{display:none}\n' +
'#upload-form{display:none;margin-top:12px;display:flex;flex-direction:column;gap:8px}\n' +
'#upload-form.hidden{display:none}\n' +
'.inp{width:100%;padding:7px 10px;border:1px solid var(--bdr);border-radius:6px;font-size:13px}\n' +
'.inp:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(59,130,246,.12)}\n' +
'.upload-row{display:flex;gap:8px;align-items:center}\n' +
'#upload-filename{font-size:12px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n' +
'.track-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 0;border-bottom:1px solid var(--bdr)}\n' +
'.track-row:last-child{border-bottom:none}\n' +
'.track-file{font-size:12px;color:var(--muted);flex:0 0 100%;margin-bottom:2px}\n' +
'.track-title{flex:1 1 120px;min-width:0}\n' +
'.track-tags{flex:3 1 160px;min-width:0}\n' +
'.track-vol{flex:0 0 65px;text-align:center}\n' +
'.track-actions{display:flex;gap:6px;flex-shrink:0}\n' +
'#lib-empty{color:var(--muted);font-size:13px;padding:8px 0}\n' +
'#lib-list{}\n' +
'</style>\n' +
'</head>\n<body>\n' +
'<header><h1>Jenny</h1>' + (menuHtml ? menuHtml : "") + '</header>\n' +
'<div id="bard-wrap">\n' +

/**********************************************************************************/
'<div class="card">\n' +
'<h2>Upload MP3</h2>\n' +
'<div id="drop-zone">\n' +
'  <input type="file" id="file-input" accept=".mp3">\n' +
'  <div id="drop-label">Drop MP3 here or <u style="cursor:pointer" onclick="document.getElementById(\'file-input\').click()">browse</u></div>\n' +
'</div>\n' +
'<div id="upload-form" class="hidden">\n' +
'  <div class="upload-row"><span id="upload-filename"></span></div>\n' +
'  <input class="inp" type="text" id="upload-title" placeholder="Title">\n' +
'  <input class="inp" type="text" id="upload-tags" placeholder="Tags (comma-separated, e.g. battle,intense,fight)">\n' +
'  <input class="inp" type="number" id="upload-vol" min="0.1" max="4" step="0.1" value="1.0" placeholder="Volume (1.0 = 100%)">\n' +
'  <div style="display:flex;gap:8px">\n' +
'    <button class="btn btn-p" onclick="doUpload()">Upload</button>\n' +
'    <button class="btn btn-s" onclick="resetUpload()">Cancel</button>\n' +
'  </div>\n' +
'</div>\n' +
'</div>\n' +

/**********************************************************************************/
'<div class="card">\n' +
'<h2>Library</h2>\n' +
'<div id="lib-list"><div id="lib-empty">Loading…</div></div>\n' +
'</div>\n' +
'</div>\n' +

'<div id="toast" class="toast"></div>\n' +

'<script>\n' +
'var BASE="' + base + '";\n' +
'var pendingFile=null;\n' +
'\n' +
'function toast(msg,ms){\n' +
'  var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on");\n' +
'  setTimeout(function(){t.classList.remove("on");},ms||2800);\n' +
'}\n' +
'\n' +
'/**********************************************************************************/\n' +
'var dz=document.getElementById("drop-zone");\n' +
'dz.addEventListener("dragover",function(e){e.preventDefault();dz.classList.add("over");});\n' +
'dz.addEventListener("dragleave",function(){dz.classList.remove("over");});\n' +
'dz.addEventListener("drop",function(e){\n' +
'  e.preventDefault(); dz.classList.remove("over");\n' +
'  var f=e.dataTransfer.files[0]; if(f) setFile(f);\n' +
'});\n' +
'document.getElementById("file-input").addEventListener("change",function(){\n' +
'  if(this.files[0]) setFile(this.files[0]);\n' +
'});\n' +
'\n' +
'function setFile(f){\n' +
'  if(!/\\.mp3$/i.test(f.name)){toast("Only MP3 files allowed",3000);return;}\n' +
'  pendingFile=f;\n' +
'  document.getElementById("upload-filename").textContent=f.name;\n' +
'  document.getElementById("upload-title").value=f.name.replace(/\\.mp3$/i,"");\n' +
'  document.getElementById("upload-tags").value="";\n' +
'  document.getElementById("upload-form").classList.remove("hidden");\n' +
'}\n' +
'\n' +
'function resetUpload(){\n' +
'  pendingFile=null;\n' +
'  document.getElementById("upload-form").classList.add("hidden");\n' +
'  document.getElementById("file-input").value="";\n' +
'}\n' +
'\n' +
'function doUpload(){\n' +
'  if(!pendingFile){toast("No file selected");return;}\n' +
'  var title=document.getElementById("upload-title").value.trim();\n' +
'  var tags=document.getElementById("upload-tags").value.split(",").map(function(t){return t.trim().toLowerCase().replace(/[^a-z0-9_-]/g,"");}).filter(Boolean);\n' +
'  var vol=parseFloat(document.getElementById("upload-vol").value)||1.0;\n' +
'  var btn=document.querySelector("#upload-form .btn-p"); btn.disabled=true; btn.textContent="Uploading…";\n' +
'  var reader=new FileReader();\n' +
'  reader.onload=function(){\n' +
'    var b64=reader.result.split(",")[1];\n' +
'    fetch(BASE+"/api/upload",{method:"POST",headers:{"Content-Type":"application/json"},\n' +
'      body:JSON.stringify({filename:pendingFile.name,title:title,tags:tags,volume:vol,data:b64})})\n' +
'    .then(function(r){return r.json();})\n' +
'    .then(function(d){\n' +
'      btn.disabled=false; btn.textContent="Upload";\n' +
'      if(d.ok){toast("Uploaded: "+d.filename,3000); resetUpload(); loadLibrary();}\n' +
'      else toast("Error: "+(d.error||"?"),5000);\n' +
'    }).catch(function(e){btn.disabled=false;btn.textContent="Upload";toast("Error: "+e.message,5000);});\n' +
'  };\n' +
'  reader.readAsDataURL(pendingFile);\n' +
'}\n' +
'\n' +
'/**********************************************************************************/\n' +
'function loadLibrary(){\n' +
'  fetch(BASE+"/api/library").then(function(r){return r.json();})\n' +
'  .then(function(d){renderLibrary(d.tracks||[]);}).catch(function(e){toast("Load error: "+e.message,5000);});\n' +
'}\n' +
'\n' +
'function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}\n' +
'\n' +
'function renderLibrary(tracks){\n' +
'  var el=document.getElementById("lib-list");\n' +
'  if(!tracks.length){el.innerHTML=\'<div id="lib-empty">No tracks in library.</div>\';return;}\n' +
'  var html="";\n' +
'  tracks.forEach(function(t,i){\n' +
'    html+=\'<div class="track-row" data-i="\'+i+\'">\'+\n' +
'      \'<span class="track-file">\'+esc(t.file)+\'</span>\'+\n' +
'      \'<input class="inp track-title" type="text" value="\'+esc(t.title)+\'" placeholder="Title" data-file="\'+esc(t.file)+\'">\'+\n' +
'      \'<input class="inp track-tags" type="text" value="\'+esc((t.tags||[]).join(","))+\'" placeholder="Tags" data-file="\'+esc(t.file)+\'">\'+\n' +
'      \'<input class="inp track-vol" type="number" min="0.1" max="4" step="0.1" value="\'+parseFloat(t.volume||1).toFixed(1)+\'" title="Volume" data-file="\'+esc(t.file)+\'">\'+\n' +
'      \'<div class="track-actions">\'+\n' +
'      \'<button class="btn btn-p" onclick="saveTrack(this)" data-file="\'+esc(t.file)+\'">Save</button>\'+\n' +
'      \'<button class="btn btn-d" onclick="deleteTrack(this)" data-file="\'+esc(t.file)+\'">✕</button>\'+\n' +
'      \'</div></div>\';\n' +
'  });\n' +
'  el.innerHTML=html;\n' +
'}\n' +
'\n' +
'function saveTrack(btn){\n' +
'  var row=btn.closest(".track-row");\n' +
'  var file=btn.getAttribute("data-file");\n' +
'  var title=row.querySelector(".track-title").value.trim();\n' +
'  var tags=row.querySelector(".track-tags").value.split(",").map(function(t){return t.trim().toLowerCase().replace(/[^a-z0-9_-]/g,"");}).filter(Boolean);\n' +
'  var vol=parseFloat(row.querySelector(".track-vol").value)||1.0;\n' +
'  btn.disabled=true;\n' +
'  fetch(BASE+"/api/tags",{method:"POST",headers:{"Content-Type":"application/json"},\n' +
'    body:JSON.stringify({file:file,title:title,tags:tags,volume:vol})})\n' +
'  .then(function(r){return r.json();})\n' +
'  .then(function(d){\n' +
'    btn.disabled=false;\n' +
'    if(d.ok) toast("Saved",2000); else toast("Error: "+(d.error||"?"),5000);\n' +
'  }).catch(function(e){btn.disabled=false;toast("Error: "+e.message,5000);});\n' +
'}\n' +
'\n' +
'function deleteTrack(btn){\n' +
'  var file=btn.getAttribute("data-file");\n' +
'  if(!confirm("Permanently delete MP3 file?\\n\\n"+file)) return;\n' +
'  btn.disabled=true;\n' +
'  fetch(BASE+"/api/track",{method:"DELETE",headers:{"Content-Type":"application/json"},\n' +
'    body:JSON.stringify({file:file})})\n' +
'  .then(function(r){return r.json();})\n' +
'  .then(function(d){\n' +
'    if(d.ok){toast("Deleted: "+file,2500); loadLibrary();} else {btn.disabled=false; toast("Error: "+(d.error||"?"),5000);}\n' +
'  }).catch(function(e){btn.disabled=false;toast("Error: "+e.message,5000);});\n' +
'}\n' +
'\n' +
'loadLibrary();\n' +
'</script>\n' +
'</body>\n</html>'
  );
}

export const fn = getWebpageBard;
