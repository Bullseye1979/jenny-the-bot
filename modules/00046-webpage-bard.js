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

async function setSendAudioStream(wo, filePath, rangeHeader) {
  const key = wo?.http?.requestKey;
  if (!key) return false;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return false;
  const { res } = entry;
  let stat;
  try { stat = fs.statSync(filePath); } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "File not found" }));
    return true;
  }
  const total = stat.size;
  const range = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;
  if (range) {
    const start = range[1] !== "" ? parseInt(range[1], 10) : 0;
    const end   = range[2] !== "" ? parseInt(range[2], 10) : total - 1;
    const safeEnd = Math.min(end, total - 1);
    if (start >= total || start > safeEnd) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      res.end();
      return true;
    }
    res.writeHead(206, { "Content-Range": `bytes ${start}-${safeEnd}/${total}`, "Accept-Ranges": "bytes", "Content-Length": safeEnd - start + 1, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    const stream = fs.createReadStream(filePath, { start, end: safeEnd });
    res.on("close", () => { if (!stream.destroyed) stream.destroy(); });
    stream.pipe(res);
  } else {
    res.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": total, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    const stream = fs.createReadStream(filePath);
    res.on("close", () => { if (!stream.destroyed) stream.destroy(); });
    stream.pipe(res);
  }
  return true;
}

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
      body: getBardHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, base: basePath, isAdmin: isAllowed })
    };
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "GET" && urlPath === basePath + "/api/nowplaying") {
    let reg = null;
    try { reg = await getItem("bard:registry"); } catch {}
    const sessionKeys = Array.isArray(reg?.list) ? reg.list : [];
    let streamEntry = null;
    for (const sk of sessionKeys) {
      try {
        const s = await getItem(sk);
        if (!s) continue;
        const gId = getStr(s.guildId);
        if (gId) { streamEntry = await getItem(`bard:stream:${gId}`) || null; }
        if (streamEntry) break;
      } catch {}
    }
    setJsonResp(wo, 200, streamEntry || null);
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  /**********************************************************************************/
  if (method === "GET" && urlPath === basePath + "/api/audio") {
    const query    = wo.http?.query || {};
    const filename = path.basename(getStr(query.file || ""));
    if (!filename || !/\.mp3$/i.test(filename)) {
      setJsonResp(wo, 400, { ok: false, error: "file param required (must be .mp3)" });
      wo.jump = true; await setSendNow(wo); return coreData;
    }
    const filePath    = path.join(musicDir, filename);
    const rangeHeader = getStr(wo.http?.headers?.range || "");
    const sent = await setSendAudioStream(wo, filePath, rangeHeader);
    if (sent) { wo.web.useLayout = false; wo.jump = true; }
    return coreData;
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

function getBardHtml({ menu, role, activePath, base, isAdmin }) {
  const menuHtml = getMenuHtml(menu || [], activePath || base, role || "");
  const adminHtml =
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
'<div class="card">\n' +
'<h2>Library</h2>\n' +
'<div id="lib-list"><div id="lib-empty">Loading…</div></div>\n' +
'</div>\n';

  return (
'<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
'<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>🎵 Bard</title>\n' +
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
'.now-playing-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:28px}\n' +
'.now-playing-title{font-weight:600;font-size:14px;flex:1}\n' +
'.now-playing-labels{display:flex;gap:4px;flex-wrap:wrap}\n' +
'.now-playing-label{background:var(--acc,#3b82f6);color:#fff;border-radius:999px;padding:.1rem .6rem;font-size:.75rem}\n' +
'#live-player{display:flex;flex-direction:column;gap:8px}\n' +
'#player-track{height:6px;background:var(--bdr);border-radius:3px;overflow:hidden;cursor:default;user-select:none}\n' +
'#player-bar{height:100%;background:var(--acc);border-radius:3px;transition:width .8s linear;width:0%}\n' +
'.player-controls{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted)}\n' +
'#player-time{font-variant-numeric:tabular-nums;min-width:90px}\n' +
'.player-vol{display:flex;align-items:center;gap:6px}\n' +
'#player-vol{width:72px;accent-color:var(--acc);cursor:pointer}\n' +
'#nowplaying-idle{color:var(--muted);font-size:13px;padding:4px 0}\n' +
'#np-file{font-size:11px;color:var(--muted);margin-bottom:8px;word-break:break-all}\n' +
'</style>\n' +
'</head>\n<body>\n' +
'<header><h1>🎵 Bard</h1>' + (menuHtml ? menuHtml : "") + '</header>\n' +
'<div id="bard-wrap">\n' +

'<div class="card" id="nowplaying-card">\n' +
'<h2>Now Playing</h2>\n' +
'<div id="nowplaying-idle">Nothing playing right now.</div>\n' +
'<div id="nowplaying-active" style="display:none">\n' +
'  <div class="now-playing-row"><span class="now-playing-title" id="np-title">—</span><span class="now-playing-labels" id="np-labels"></span></div>\n' +
'  <div id="np-file"></div>\n' +
'  <div id="live-player">\n' +
'    <div id="player-start"><button class="btn btn-p" onclick="unlockPlayer()" style="width:100%;margin-bottom:6px">▶ Zum Anhören klicken</button></div>\n' +
'    <div id="player-track"><div id="player-bar"></div></div>\n' +
'    <div class="player-controls">\n' +
'      <span id="player-time">0:00 / 0:00</span>\n' +
'      <div class="player-vol"><span>🔊</span><input type="range" id="player-vol" min="0" max="1" step="0.02" value="0.8"></div>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'<audio id="bard-live-audio" preload="auto" style="display:none"></audio>\n' +
'</div>\n' +

(isAdmin ? adminHtml : '') +

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
'if(dz){\n' +
'  dz.addEventListener("dragover",function(e){e.preventDefault();dz.classList.add("over");});\n' +
'  dz.addEventListener("dragleave",function(){dz.classList.remove("over");});\n' +
'  dz.addEventListener("drop",function(e){\n' +
'    e.preventDefault(); dz.classList.remove("over");\n' +
'    var f=e.dataTransfer.files[0]; if(f) setFile(f);\n' +
'  });\n' +
'  var fi=document.getElementById("file-input");\n' +
'  if(fi) fi.addEventListener("change",function(){if(this.files[0]) setFile(this.files[0]);});\n' +
'}\n' +
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
'      \'<button class="btn btn-s" onclick="previewTrack(this)" data-file="\'+esc(t.file)+\'" title="Preview">▶</button>\'+\n' +
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

'var previewAudio=null;\n' +
'function previewTrack(btn){\n' +
'  var file=btn.getAttribute("data-file");\n' +
'  if(!previewAudio){previewAudio=document.createElement("audio");previewAudio.controls=false;}\n' +
'  if(previewAudio.src.endsWith(encodeURIComponent(file))&&!previewAudio.paused){previewAudio.pause();btn.textContent="▶";return;}\n' +
'  document.querySelectorAll(".track-actions .btn-s").forEach(function(b){b.textContent="▶";});\n' +
'  previewAudio.src=BASE+"/api/audio?file="+encodeURIComponent(file);\n' +
'  previewAudio.play().catch(function(){});\n' +
'  btn.textContent="■";\n' +
'  previewAudio.onended=function(){btn.textContent="▶";};\n' +
'}\n' +
'\n' +
'/* Now Playing — live player (no pause, no seek, volume only) */\n' +
'var npFile=null;\n' +
'var liveAudio=document.getElementById("bard-live-audio");\n' +
'var npIdle=document.getElementById("nowplaying-idle");\n' +
'var npActive=document.getElementById("nowplaying-active");\n' +
'var npTitle=document.getElementById("np-title");\n' +
'var npLabels=document.getElementById("np-labels");\n' +
'var playerBar=document.getElementById("player-bar");\n' +
'var playerTime=document.getElementById("player-time");\n' +
'var playerVol=document.getElementById("player-vol");\n' +
'var npFileEl=document.getElementById("np-file");\n' +
'var playerUnlocked=false;\n' +
'var loadingNewTrack=false;\n' +
'var _pollTimer=null;\n' +
'var _expectingNewTrack=false;\n' +
'var _expectRetries=0;\n' +
'var _trackStartedAt=0;\n' +
'\n' +
'if(playerVol){\n' +
'  liveAudio.volume=parseFloat(playerVol.value)||0.8;\n' +
'  playerVol.addEventListener("input",function(){liveAudio.volume=parseFloat(playerVol.value)||0.8;});\n' +
'}\n' +
'\n' +
'function unlockPlayer(){\n' +
'  playerUnlocked=true;\n' +
'  var ps=document.getElementById("player-start");\n' +
'  if(ps)ps.style.display="none";\n' +
'  if(liveAudio.src){\n' +
'    /* Recalculate seek position at the moment the user presses play so the stream\n' +
'       is in sync even if the user waited a while before clicking. */\n' +
'    if(_trackStartedAt>0&&liveAudio.duration>0){\n' +
'      var elapsed=(Date.now()-_trackStartedAt)/1000;\n' +
'      if(elapsed>0&&elapsed<liveAudio.duration-1)liveAudio.currentTime=elapsed;\n' +
'    }\n' +
'    liveAudio.play().catch(function(){});\n' +
'  }\n' +
'}\n' +
'\n' +
'/* Prevent pause — keep live stream running.\n' +
'   Guard: pause fires BEFORE ended when a track finishes naturally, so !liveAudio.ended\n' +
'   is true at that moment. Extra check: skip auto-resume if within 1 s of the end. */\n' +
'liveAudio.addEventListener("pause",function(){\n' +
'  var nearEnd=liveAudio.duration>0&&liveAudio.currentTime>=liveAudio.duration-1;\n' +
'  if(playerUnlocked&&npFile&&!loadingNewTrack&&!liveAudio.ended&&!nearEnd)\n' +
'    liveAudio.play().catch(function(){});\n' +
'});\n' +
'\n' +
'/* Song ended naturally — poll immediately so the next track loads without waiting\n' +
'   for the regular 2-second interval. Retries every 500 ms (up to 10x) if the server\n' +
'   has not yet selected the next song when the first immediate poll fires. */\n' +
'liveAudio.addEventListener("ended",function(){\n' +
'  _expectingNewTrack=true;_expectRetries=0;\n' +
'  schedulePoll(300);\n' +
'});\n' +
'\n' +
'function fmtTime(s){\n' +
'  if(!isFinite(s)||s<0)return"0:00";\n' +
'  var m=Math.floor(s/60),sec=Math.floor(s%60);\n' +
'  return m+":"+(sec<10?"0":"")+sec;\n' +
'}\n' +
'\n' +
'function updatePlayerUI(){\n' +
'  if(!liveAudio||!npFile)return;\n' +
'  var cur=liveAudio.currentTime||0, dur=liveAudio.duration||0;\n' +
'  if(playerBar)playerBar.style.width=(dur>0?Math.min(100,(cur/dur)*100):0)+"%";\n' +
'  if(playerTime)playerTime.textContent=fmtTime(cur)+" / "+fmtTime(dur);\n' +
'}\n' +
'setInterval(updatePlayerUI,1000);\n' +
'\n' +
'function schedulePoll(delay){\n' +
'  if(_pollTimer)clearTimeout(_pollTimer);\n' +
'  _pollTimer=setTimeout(pollNowPlaying,delay);\n' +
'}\n' +
'\n' +
'function pollNowPlaying(){\n' +
'  _pollTimer=null;\n' +
'  fetch(BASE+"/api/nowplaying").then(function(r){return r.json();})\n' +
'  .then(function(d){\n' +
'    if(!d||!d.file){\n' +
'      npIdle.style.display="";npActive.style.display="none";\n' +
'      npFile=null;liveAudio.pause();liveAudio.src="";\n' +
'      _expectingNewTrack=false;_expectRetries=0;\n' +
'      schedulePoll(2000);return;\n' +
'    }\n' +
'    npIdle.style.display="none";npActive.style.display="";\n' +
'    npTitle.textContent=d.title||d.file.replace(/\\.mp3$/i,"");\n' +
'    if(npFileEl)npFileEl.textContent=d.file.toLowerCase();\n' +
'    var lbs=Array.isArray(d.labels)?d.labels:[];\n' +
'    npLabels.innerHTML=lbs.map(function(l){return\'<span class="now-playing-label">\'+esc(l)+\'</span>\';}).join("");\n' +
'    var gotNewTrack=d.file!==npFile;\n' +
'    if(gotNewTrack){\n' +
'      npFile=d.file;\n' +
'      /* Store startedAt as a module-level timestamp so unlockPlayer() can also\n' +
'         recalculate elapsed at button-press time for an accurate catch-up seek. */\n' +
'      _trackStartedAt=new Date(d.startedAt).getTime();\n' +
'      loadingNewTrack=true;\n' +
'      liveAudio.src=BASE+"/api/audio?file="+encodeURIComponent(d.file);\n' +
'      liveAudio.onloadedmetadata=function(){\n' +
'        loadingNewTrack=false;\n' +
'        var elapsed=(Date.now()-_trackStartedAt)/1000;\n' +
'        if(elapsed>0&&elapsed<liveAudio.duration-1)liveAudio.currentTime=elapsed;\n' +
'        if(playerUnlocked)liveAudio.play().catch(function(){});\n' +
'        else{var ps=document.getElementById("player-start");if(ps)ps.style.display="";}\n' +
'      };\n' +
'      liveAudio.load();\n' +
'    }\n' +
'    if(_expectingNewTrack&&!gotNewTrack&&_expectRetries<10){\n' +
'      /* Server has not yet started the next track — retry quickly. */\n' +
'      _expectRetries++;schedulePoll(500);\n' +
'    }else{\n' +
'      _expectingNewTrack=false;_expectRetries=0;schedulePoll(2000);\n' +
'    }\n' +
'  }).catch(function(){_expectingNewTrack=false;_expectRetries=0;schedulePoll(2000);});\n' +
'}\n' +
'pollNowPlaying();\n' +
'\n' +
(isAdmin ? 'loadLibrary();\n' : '') +
'</script>\n' +
'</body>\n</html>'
  );
}

export const fn = getWebpageBard;
