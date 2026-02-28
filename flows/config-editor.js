/********************************************************************************************************************
* filename: "config-editor.js"                                                                                     *
* Version 2.0                                                                                                      *
* Purpose: Web-based JSON configuration editor + AI chat interface.                                                *
*          Starts an HTTP server serving a single-page app with two tabs:                                          *
*            Chat tab   — interactive AI chat via the bot's API flow, with per-channel context history.            *
*            Config tab — browse and edit core.json (or any JSON file) through a tree UI.                          *
*          Required config: port (default 3111).                                                                   *
*          Optional: host, token, configPath, apiUrl, chats[].                                                     *
********************************************************************************************************************/
/********************************************************************************************************************
*                                                                                                                  *
********************************************************************************************************************/

import http from "node:http";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MODULE_NAME = "config-editor";

/** Lazily-created mysql2 connection pool — shared across all context requests. */
let dbPool = null;

/********************************************************************************************************************
* functionSignature: getBody (req)
* Purpose: Reads request body into a string.
********************************************************************************************************************/
function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/********************************************************************************************************************
* functionSignature: readJsonFile (filePath)
* Purpose: Reads and parses a JSON file.
********************************************************************************************************************/
function readJsonFile(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/********************************************************************************************************************
* functionSignature: writeJsonFile (filePath, data)
* Purpose: Writes data as pretty-printed JSON.
********************************************************************************************************************/
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/********************************************************************************************************************
* functionSignature: isAuthorized (req, token)
* Purpose: Returns true if no token is required or the request carries the correct Bearer/Basic token.
********************************************************************************************************************/
function isAuthorized(req, token) {
  if (!token) return true;
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ") && auth.slice(7).trim() === token) return true;
  if (auth.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    if (decoded === "admin:" + token || decoded.split(":")[1] === token) return true;
  }
  return false;
}

/********************************************************************************************************************
* functionSignature: getDb (coreData)
* Purpose: Returns (creating if needed) a mysql2 connection pool using DB config from workingObject.
********************************************************************************************************************/
async function getDb(coreData) {
  if (dbPool) return dbPool;
  let mysql2;
  try { mysql2 = await import("mysql2/promise"); }
  catch (e) { throw new Error("mysql2 module not available: " + String(e?.message || e)); }
  const db = coreData?.workingObject?.db || {};
  dbPool = mysql2.createPool({
    host:            String(db.host     || "localhost"),
    port:            Number(db.port     || 3306),
    user:            String(db.user     || ""),
    password:        String(db.password || ""),
    database:        String(db.database || ""),
    charset:         String(db.charset  || "utf8mb4"),
    connectionLimit: 3,
    waitForConnections: true,
  });
  return dbPool;
}

/********************************************************************************************************************
* functionSignature: getHtml ()
* Purpose: Returns the full SPA HTML as a string (no external dependencies).
*          Contains two tabs: Chat (default) and Config editor.
*          IMPORTANT: No template-literal ${} or backticks inside this returned string.
********************************************************************************************************************/
function getHtml() {
  return (
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>Jenny \u2014 Admin</title>\n' +
'<style>\n' +
'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n' +
':root{\n' +
'  --sb:#1e293b;--sb-text:#cbd5e1;--sb-hover:#334155;--sb-sel:#3b82f6;--sb-sel-txt:#fff;\n' +
'  --hdr:#1e293b;--hdr-txt:#f1f5f9;\n' +
'  --bg:#f0f2f5;--card:#fff;--bdr:#e2e8f0;\n' +
'  --txt:#1e293b;--muted:#64748b;\n' +
'  --acc:#3b82f6;--acc2:#2563eb;\n' +
'  --dan:#ef4444;--dan2:#dc2626;\n' +
'  --ok:#10b981;\n' +
'  --tag-bg:#dbeafe;--tag-txt:#1d4ed8;--tag-bdr:#bfdbfe;\n' +
'  --r:6px;--hh:52px;--sw:272px;\n' +
'  --sh:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.07);\n' +
'}\n' +
'html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:14px}\n' +
'body{background:var(--bg);color:var(--txt);overflow:hidden}\n' +
'/* ---- Header ---- */\n' +
'header{position:fixed;top:0;left:0;right:0;height:var(--hh);background:var(--hdr);color:var(--hdr-txt);display:flex;align-items:center;padding:0 12px;gap:10px;z-index:100;box-shadow:0 2px 6px rgba(0,0,0,.25)}\n' +
'#menu-btn{width:36px;height:36px;border:none;background:rgba(255,255,255,.1);color:#fff;border-radius:5px;font-size:18px;cursor:pointer;display:none;align-items:center;justify-content:center;flex-shrink:0}\n' +
'header h1{font-size:15px;font-weight:700;white-space:nowrap;letter-spacing:-.2px}\n' +
'/* ---- Nav tabs ---- */\n' +
'#nav-tabs{display:flex;gap:3px;margin-left:6px;flex:1}\n' +
'.nav-tab{padding:5px 14px;border:none;border-radius:5px;font-size:13px;font-weight:500;cursor:pointer;background:rgba(255,255,255,.08);color:rgba(255,255,255,.55);transition:all .15s;white-space:nowrap}\n' +
'.nav-tab:hover{background:rgba(255,255,255,.15);color:#fff}\n' +
'.nav-tab.active{background:var(--acc);color:#fff}\n' +
'#status-lbl{font-size:12px;opacity:.55;white-space:nowrap}\n' +
'#save-btn{padding:6px 16px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;background:rgba(255,255,255,.15);color:#fff;white-space:nowrap}\n' +
'#save-btn.dirty{background:var(--ok)}\n' +
'#save-btn:disabled{opacity:.45;cursor:default}\n' +
'/* ---- Chat view ---- */\n' +
'#chat-view{display:flex;flex-direction:column;height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));margin-top:var(--hh);overflow:hidden;background:var(--bg)}\n' +
'#chat-channel-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--card);border-bottom:1px solid var(--bdr);flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.06)}\n' +
'#chat-channel-bar label{font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap}\n' +
'#chat-sel{flex:1;max-width:340px;padding:6px 10px;border:1px solid var(--bdr);border-radius:5px;font-size:13px;background:#fff;color:var(--txt);cursor:pointer}\n' +
'#chat-sel:focus{outline:none;border-color:var(--acc)}\n' +
'#chat-reload-btn{width:32px;height:32px;border:1px solid var(--bdr);border-radius:5px;background:#fff;color:var(--muted);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}\n' +
'#chat-reload-btn:hover{border-color:var(--acc);color:var(--acc)}\n' +
'#chat-msgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px}\n' +
'#chat-msgs::-webkit-scrollbar{width:5px}\n' +
'#chat-msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}\n' +
'.chat-msg{display:flex;max-width:76%}\n' +
'.chat-msg.user{align-self:flex-end}\n' +
'.chat-msg.assistant{align-self:flex-start}\n' +
'.chat-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.6;word-break:break-word;white-space:pre-wrap;box-shadow:0 1px 2px rgba(0,0,0,.07)}\n' +
'.chat-msg.user .chat-bubble{background:var(--acc);color:#fff;border-bottom-right-radius:3px}\n' +
'.chat-msg.assistant .chat-bubble{background:var(--card);color:var(--txt);border:1px solid var(--bdr);border-bottom-left-radius:3px}\n' +
'.chat-thinking{display:flex;align-items:center;gap:5px;padding:12px 14px}\n' +
'.chat-thinking span:not(.label){width:7px;height:7px;background:#94a3b8;border-radius:50%;display:inline-block;animation:chtk .9s ease-in-out infinite}\n' +
'.chat-thinking span.label{font-size:11px;color:var(--muted);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;line-height:1}\n' +
'.chat-thinking span:nth-child(2){animation-delay:.18s}\n' +
'.chat-thinking span:nth-child(3){animation-delay:.36s}\n' +
'@keyframes chtk{0%,80%,100%{transform:scale(.65);opacity:.35}40%{transform:scale(1.05);opacity:1}}\n' +
'.chat-empty,.chat-loading{align-self:center;text-align:center;padding:48px 24px;color:var(--muted);font-size:13px;margin:auto}\n' +
'#chat-footer{display:flex;align-items:flex-end;gap:10px;padding:10px 14px;background:var(--card);border-top:1px solid var(--bdr);flex-shrink:0}\n' +
'#chat-input{flex:1;padding:9px 12px;border:1px solid var(--bdr);border-radius:8px;font-size:13px;font-family:inherit;resize:none;background:#fff;color:var(--txt);line-height:1.5;max-height:120px;overflow-y:auto;transition:border-color .15s}\n' +
'#chat-input:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(59,130,246,.1)}\n' +
'#chat-send-btn{width:40px;height:40px;border:none;border-radius:8px;background:var(--acc);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}\n' +
'#chat-send-btn:hover{background:var(--acc2)}\n' +
'#chat-send-btn:disabled{opacity:.4;cursor:default}\n' +
'.chat-bubble a{color:inherit;text-decoration:underline;word-break:break-all}\n' +
'.chat-msg.user .chat-bubble a{color:#bfdbfe}\n' +
'.chat-embed{margin-top:8px;border-radius:8px;overflow:hidden;width:100%;max-width:480px}\n' +
'.chat-embed iframe{display:block;width:100%;aspect-ratio:16/9;border:none;background:#000}\n' +
'.chat-embed video{display:block;width:100%;max-height:300px;background:#000}\n' +
'.chat-img{display:block;max-width:100%;max-height:300px;border-radius:8px;margin-top:6px;cursor:pointer}\n' +
'/* Markdown in chat bubbles */\n' +
'.chat-bubble h1,.chat-bubble h2,.chat-bubble h3{margin:.35em 0 .15em;font-weight:700;line-height:1.3}\n' +
'.chat-bubble h1{font-size:1.15em}.chat-bubble h2{font-size:1.05em}.chat-bubble h3{font-size:1em}\n' +
'.chat-bubble ul,.chat-bubble ol{padding-left:1.4em;margin:.25em 0}.chat-bubble li{margin:.1em 0}\n' +
'.chat-bubble blockquote{border-left:3px solid var(--acc);padding:.2em .7em;margin:.3em 0;opacity:.75}\n' +
'.chat-msg.user .chat-bubble blockquote{border-left-color:rgba(255,255,255,.5)}\n' +
'.chat-bubble code{background:rgba(0,0,0,.07);border-radius:3px;padding:1px 5px;font-family:monospace;font-size:.88em}\n' +
'.chat-bubble pre{background:rgba(0,0,0,.06);border-radius:6px;padding:.5em .8em;overflow-x:auto;margin:.3em 0}\n' +
'.chat-bubble pre code{background:none;padding:0;font-size:.87em}\n' +
'.chat-msg.user .chat-bubble code,.chat-msg.user .chat-bubble pre{background:rgba(255,255,255,.18);color:#fff}\n' +
'.chat-bubble hr{border:none;border-top:1px solid var(--bdr);margin:.4em 0}\n' +
'@media(max-width:640px){.chat-msg{max-width:92%}#chat-channel-bar label{display:none}}\n' +
'/* ---- Config view ---- */\n' +
'#config-view{display:none;margin-top:var(--hh);height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));overflow:hidden}\n' +
'#app{display:flex;height:100%;overflow:hidden}\n' +
'#sidebar{width:var(--sw);min-width:var(--sw);background:var(--sb);color:var(--sb-text);overflow-y:auto;overflow-x:hidden;flex-shrink:0;border-right:1px solid rgba(255,255,255,.05);transition:transform .22s ease}\n' +
'#sidebar::-webkit-scrollbar{width:4px}\n' +
'#sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:2px}\n' +
'.tree-root{padding:8px 0}\n' +
'.ti{position:relative}\n' +
'.tl{display:flex;align-items:center;gap:5px;padding:6px 8px 6px 0;cursor:pointer;user-select:none;transition:background .1s;white-space:nowrap;overflow:hidden}\n' +
'.tl:hover{background:var(--sb-hover)}\n' +
'.tl.sel{background:var(--sb-sel);color:var(--sb-sel-txt)}\n' +
'.tl.sel .ti-icon{opacity:1}\n' +
'.tv{width:18px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;opacity:.4;transition:transform .14s;flex-shrink:0}\n' +
'.tv.open{transform:rotate(90deg)}\n' +
'.tv.leaf{opacity:0;pointer-events:none}\n' +
'.ti-icon{font-size:13px;min-width:16px;text-align:center;opacity:.65;flex-shrink:0}\n' +
'.ti-name{flex:1;overflow:hidden;text-overflow:ellipsis;font-size:13px}\n' +
'.ti-badge{font-size:10px;padding:1px 5px;border-radius:9px;background:rgba(255,255,255,.1);opacity:.7;flex-shrink:0}\n' +
'.ta{display:none;gap:2px;margin-right:6px;flex-shrink:0}\n' +
'.tl:hover .ta,.tl.sel .ta{display:flex}\n' +
'.tb{width:22px;height:22px;border:none;cursor:pointer;background:rgba(255,255,255,.1);color:inherit;border-radius:3px;font-size:13px;display:flex;align-items:center;justify-content:center;transition:background .1s}\n' +
'.tb:hover{background:rgba(255,255,255,.22)}\n' +
'.tb.del:hover{background:var(--dan)}\n' +
'.tc{}\n' +
'#main{flex:1;overflow-y:auto;padding:16px}\n' +
'#main::-webkit-scrollbar{width:6px}\n' +
'#main::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}\n' +
'#bc{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:14px;font-size:13px;color:var(--muted)}\n' +
'.bc-sep{opacity:.35}\n' +
'.bc-i{cursor:pointer;padding:2px 5px;border-radius:3px;transition:background .1s}\n' +
'.bc-i:hover{background:var(--bdr);color:var(--txt)}\n' +
'.bc-i.cur{color:var(--txt);font-weight:500;cursor:default}\n' +
'.bc-i.cur:hover{background:none}\n' +
'.card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);box-shadow:var(--sh);margin-bottom:16px;overflow:hidden}\n' +
'.ch{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bdr);background:#f8fafc}\n' +
'.ch-title{font-weight:600;font-size:14px;flex:1}\n' +
'.cb{padding:2px 0}\n' +
'.pr{display:grid;grid-template-columns:minmax(110px,34%) 1fr auto;align-items:center;padding:5px 14px;gap:10px;border-bottom:1px solid #f1f5f9;min-height:42px}\n' +
'.pr:last-child{border-bottom:none}\n' +
'.pr:hover{background:#f8fafc}\n' +
'.pk{border:1px solid transparent;background:transparent;padding:2px 4px;border-radius:3px;font-size:12px;font-family:monospace;color:var(--muted);width:100%;transition:border-color .1s}\n' +
'.pk:hover,.pk:focus{border-color:var(--bdr);background:#fff;outline:none}\n' +
'.pv{width:100%;padding:5px 8px;border:1px solid var(--bdr);border-radius:4px;font-size:13px;background:#fff;color:var(--txt);transition:border-color .15s}\n' +
'.pv:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(59,130,246,.1)}\n' +
'.pv.num{font-family:monospace}\n' +
'.ptyp{padding:4px 5px;border:1px solid var(--bdr);border-radius:4px;font-size:11px;background:#fff;color:var(--muted);cursor:pointer}\n' +
'.pa{display:flex;gap:4px}\n' +
'.ib{width:28px;height:28px;border:none;cursor:pointer;background:transparent;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--muted);transition:background .1s,color .1s}\n' +
'.ib:hover{background:#f1f5f9;color:var(--txt)}\n' +
'.ib.del:hover{background:#fee2e2;color:var(--dan)}\n' +
'.tagrow{padding:8px 14px;border-bottom:1px solid #f1f5f9}\n' +
'.tagrow:last-child{border-bottom:none}\n' +
'.taglbl{font-size:12px;font-family:monospace;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between}\n' +
'.taged{display:flex;flex-wrap:wrap;gap:5px;align-items:center;min-height:34px;border:1px solid var(--bdr);border-radius:4px;padding:4px 6px;background:#fff;cursor:text;transition:border-color .15s}\n' +
'.taged:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(59,130,246,.1)}\n' +
'.chip{display:inline-flex;align-items:center;gap:3px;background:var(--tag-bg);color:var(--tag-txt);border:1px solid var(--tag-bdr);padding:2px 8px;border-radius:10px;font-size:12px;font-family:monospace;max-width:220px}\n' +
'.chip-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n' +
'.chip-rm{border:none;background:none;color:inherit;cursor:pointer;opacity:.5;font-size:14px;padding:0;line-height:1;transition:opacity .1s}\n' +
'.chip-rm:hover{opacity:1}\n' +
'.taginp{border:none;outline:none;font-size:13px;font-family:monospace;min-width:90px;flex:1;background:transparent;color:var(--txt);padding:2px 4px}\n' +
'.navrow{display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .1s}\n' +
'.navrow:last-child{border-bottom:none}\n' +
'.navrow:hover{background:#f8fafc}\n' +
'.navrow-icon{font-size:14px;opacity:.6}\n' +
'.navrow-name{flex:1;font-size:13px;font-family:monospace;color:var(--txt)}\n' +
'.navrow-preview{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}\n' +
'.navrow-arr{font-size:14px;color:var(--muted)}\n' +
'.navrow-acts{display:flex;gap:4px}\n' +
'.addbar{display:flex;flex-wrap:wrap;gap:8px;padding:11px 14px;border-top:1px solid var(--bdr);background:#f8fafc}\n' +
'.addbtn{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px dashed var(--bdr);border-radius:5px;background:transparent;color:var(--muted);font-size:12px;cursor:pointer;transition:all .14s}\n' +
'.addbtn:hover{border-color:var(--acc);color:var(--acc);background:rgba(59,130,246,.05)}\n' +
'.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:5px;font-size:13px;border:none;cursor:pointer;font-weight:500;transition:all .14s}\n' +
'.btn-s{background:#f1f5f9;color:var(--txt)}.btn-s:hover{background:#e2e8f0}\n' +
'.btn-d{background:#fee2e2;color:var(--dan)}.btn-d:hover{background:var(--dan);color:#fff}\n' +
'.btn-p{background:var(--acc);color:#fff}.btn-p:hover{background:var(--acc2)}\n' +
'.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:52px;color:var(--muted);gap:8px;text-align:center}\n' +
'.empty-ico{font-size:36px;opacity:.22}\n' +
'.mo{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:200;opacity:0;pointer-events:none;transition:opacity .15s}\n' +
'.mo.open{opacity:1;pointer-events:all}\n' +
'.mb{background:var(--card);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:22px;min-width:300px;max-width:480px;width:90%;transform:translateY(-8px);transition:transform .15s}\n' +
'.mo.open .mb{transform:translateY(0)}\n' +
'.mb h2{font-size:15px;margin-bottom:14px}\n' +
'.mi{width:100%;padding:8px 10px;border:1px solid var(--bdr);border-radius:5px;font-size:14px;margin-bottom:10px;font-family:monospace}\n' +
'.mi:focus{outline:none;border-color:var(--acc)}\n' +
'.msel{display:block;width:100%;padding:7px 10px;border:1px solid var(--bdr);border-radius:5px;font-size:13px;background:#fff;margin-bottom:12px}\n' +
'.ma{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}\n' +
'.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(8px);background:#1e293b;color:#f1f5f9;padding:9px 18px;border-radius:6px;font-size:13px;pointer-events:none;opacity:0;transition:opacity .2s,transform .2s;z-index:300;box-shadow:0 4px 12px rgba(0,0,0,.2)}\n' +
'.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}\n' +
'#sovl{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50}\n' +
'@media(max-width:640px){\n' +
'  #menu-btn{display:flex}\n' +
'  #sidebar{position:fixed;left:0;top:var(--hh);height:calc(100vh - var(--hh));height:calc(100dvh - var(--hh));z-index:60;transform:translateX(-100%)}\n' +
'  #sidebar.open{transform:translateX(0)}\n' +
'  #sovl{display:block;opacity:0;pointer-events:none;transition:opacity .2s}\n' +
'  #sovl.open{opacity:1;pointer-events:all}\n' +
'  #main{padding:12px}\n' +
'  .pr{grid-template-columns:1fr;gap:4px}\n' +
'  .pr .pa{justify-content:flex-end}\n' +
'}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <button id="menu-btn" onclick="toggleSb()">&#9776;</button>\n' +
'  <h1>&#9881;&#65039; Jenny</h1>\n' +
'  <div id="nav-tabs">\n' +
'    <button id="tab-chat"   class="nav-tab active" onclick="switchTab(\'chat\')">&#128172; Chat</button>\n' +
'    <button id="tab-config" class="nav-tab"        onclick="switchTab(\'config\')">&#9881; Config</button>\n' +
'  </div>\n' +
'  <span id="status-lbl"></span>\n' +
'  <button id="save-btn" style="display:none" disabled onclick="saveConfig()">Saved</button>\n' +
'</header>\n' +
'<div id="sovl" onclick="toggleSb()"></div>\n' +
'\n' +
'<!-- ===== CHAT VIEW (default) ===== -->\n' +
'<div id="chat-view">\n' +
'  <div id="chat-channel-bar">\n' +
'    <label>Channel:</label>\n' +
'    <select id="chat-sel" onchange="onChatSel(this.value)"><option value="">Loading\u2026</option></select>\n' +
'    <button id="chat-reload-btn" onclick="reloadContext()" title="Reload context">&#8635;</button>\n' +
'  </div>\n' +
'  <div id="chat-msgs"><div class="chat-loading">Select a channel to start chatting.</div></div>\n' +
'  <div id="chat-footer">\n' +
'    <textarea id="chat-input" placeholder="Type a message\u2026  (Enter = send \u2022 Shift+Enter = newline)" rows="1"></textarea>\n' +
'    <button id="chat-send-btn" onclick="sendMessage()" title="Send">&#10148;</button>\n' +
'  </div>\n' +
'</div>\n' +
'\n' +
'<!-- ===== CONFIG VIEW ===== -->\n' +
'<div id="config-view">\n' +
'  <div id="app">\n' +
'    <aside id="sidebar"><div id="tree" class="tree-root"></div></aside>\n' +
'    <main id="main"><div id="ea"><div class="empty"><div class="empty-ico">&#127795;</div><div>Select a section from the tree</div></div></div></main>\n' +
'  </div>\n' +
'</div>\n' +
'\n' +
'<!-- Modal -->\n' +
'<div id="mo" class="mo"><div class="mb"><h2 id="mttl">Add</h2><div id="mc"></div><div class="ma"><button class="btn btn-s" onclick="closeMo()">Cancel</button><button class="btn btn-p" id="mok" onclick="confirmMo()">Add</button></div></div></div>\n' +
'<div id="toast" class="toast"></div>\n' +
'\n' +
'<script>\n' +
'/* ====================================================\n' +
'   State\n' +
'   ==================================================== */\n' +
'var cfg = {};\n' +
'var sel = [];\n' +
'var dirty = false;\n' +
'var exp = {};\n' +
'var moCb = null;\n' +
'var chatChannelID = "";\n' +
'var chatMessages  = [];\n' +
'var chatSending   = false;\n' +
'var currentTab    = "chat";\n' +
'\n' +
'/* ====================================================\n' +
'   Tab switching\n' +
'   ==================================================== */\n' +
'function switchTab(name) {\n' +
'  currentTab = name;\n' +
'  var isChat = (name === "chat");\n' +
'  document.getElementById("chat-view").style.display   = isChat ? "flex" : "none";\n' +
'  document.getElementById("config-view").style.display = isChat ? "none" : "block";\n' +
'  document.getElementById("tab-chat").className   = "nav-tab" + (isChat  ? " active" : "");\n' +
'  document.getElementById("tab-config").className = "nav-tab" + (!isChat ? " active" : "");\n' +
'  document.getElementById("menu-btn").style.display  = isChat ? "none" : "";\n' +
'  document.getElementById("save-btn").style.display  = isChat ? "none" : "";\n' +
'  document.getElementById("status-lbl").style.display = isChat ? "none" : "";\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Utilities\n' +
'   ==================================================== */\n' +
'function byPath(o, p) {\n' +
'  var c = o;\n' +
'  for (var i = 0; i < p.length; i++) { if (c == null) return undefined; c = c[p[i]]; }\n' +
'  return c;\n' +
'}\n' +
'function setPath(o, p, v) {\n' +
'  if (!p.length) return;\n' +
'  var c = o;\n' +
'  for (var i = 0; i < p.length - 1; i++) c = c[p[i]];\n' +
'  c[p[p.length-1]] = v;\n' +
'  markDirty();\n' +
'}\n' +
'function delPath(o, p) {\n' +
'  if (!p.length) return;\n' +
'  var c = o;\n' +
'  for (var i = 0; i < p.length - 1; i++) c = c[p[i]];\n' +
'  var k = p[p.length-1];\n' +
'  if (Array.isArray(c)) c.splice(Number(k), 1); else delete c[k];\n' +
'  markDirty();\n' +
'}\n' +
'function clone(v) { return JSON.parse(JSON.stringify(v)); }\n' +
'function pk(p) { return JSON.stringify(p); }\n' +
'function getType(v) {\n' +
'  if (v === null) return "null";\n' +
'  if (typeof v === "boolean") return "boolean";\n' +
'  if (typeof v === "number") return "number";\n' +
'  if (typeof v === "string") return "string";\n' +
'  if (Array.isArray(v)) {\n' +
'    if (!v.length) return "empty-arr";\n' +
'    if (v[0] !== null && typeof v[0] === "object" && !Array.isArray(v[0])) return "obj-arr";\n' +
'    return "prim-arr";\n' +
'  }\n' +
'  if (typeof v === "object") return "obj";\n' +
'  return "unk";\n' +
'}\n' +
'function isTreeNode(t) { return t === "obj" || t === "obj-arr" || t === "empty-arr"; }\n' +
'function markDirty() {\n' +
'  dirty = true;\n' +
'  var b = document.getElementById("save-btn");\n' +
'  b.disabled = false; b.textContent = "Save"; b.className = "dirty";\n' +
'  document.getElementById("status-lbl").textContent = "Unsaved changes";\n' +
'}\n' +
'function toast(msg, ms) {\n' +
'  var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on");\n' +
'  setTimeout(function(){ t.classList.remove("on"); }, ms || 2400);\n' +
'}\n' +
'function esc(s) {\n' +
'  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");\n' +
'}\n' +
'function previewObj(o) {\n' +
'  if (typeof o !== "object" || o === null) return String(o);\n' +
'  var ents = Object.entries(o).slice(0,3);\n' +
'  return ents.map(function(e){ return e[0]+": "+(typeof e[1]==="object"?"{...}":String(e[1])); }).join(", ") || "{}";\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Chat — channel list\n' +
'   ==================================================== */\n' +
'function loadChats() {\n' +
'  fetch("/api/chats").then(function(r){ return r.json(); }).then(function(list){\n' +
'    var selEl = document.getElementById("chat-sel");\n' +
'    selEl.innerHTML = "";\n' +
'    if (!list || !list.length) {\n' +
'      var opt = document.createElement("option");\n' +
'      opt.value = ""; opt.textContent = "No chats configured \u2014 add config-editor.chats[]";\n' +
'      selEl.appendChild(opt); return;\n' +
'    }\n' +
'    list.forEach(function(c) {\n' +
'      var opt = document.createElement("option");\n' +
'      opt.value = c.channelID; opt.textContent = c.label || c.channelID;\n' +
'      selEl.appendChild(opt);\n' +
'    });\n' +
'    if (list[0] && list[0].channelID) { selEl.value = list[0].channelID; onChatSel(list[0].channelID); }\n' +
'  }).catch(function(e){ toast("Failed to load chats: "+e.message, 4000); });\n' +
'}\n' +
'\n' +
'function onChatSel(channelID) {\n' +
'  chatChannelID = channelID;\n' +
'  if (channelID) loadContext(channelID);\n' +
'  else document.getElementById("chat-msgs").innerHTML = \'<div class="chat-loading">Select a channel to start chatting.</div>\';\n' +
'}\n' +
'\n' +
'function reloadContext() { if (chatChannelID) loadContext(chatChannelID); }\n' +
'\n' +
'/* ====================================================\n' +
'   Chat — context (history)\n' +
'   ==================================================== */\n' +
'function loadContext(channelID) {\n' +
'  document.getElementById("chat-msgs").innerHTML = \'<div class="chat-loading">Loading context\u2026</div>\';\n' +
'  fetch("/api/context?channelID="+encodeURIComponent(channelID))\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(data){\n' +
'      if (data && data.error) { toast("Context error: "+data.error, 5000); chatMessages = []; renderMessages(); return; }\n' +
'      chatMessages = Array.isArray(data) ? data : [];\n' +
'      renderMessages();\n' +
'    })\n' +
'    .catch(function(e){ toast("Context load error: "+e.message, 4000); });\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Chat — render\n' +
'   ==================================================== */\n' +
'function renderMessages() {\n' +
'  var el = document.getElementById("chat-msgs");\n' +
'  el.innerHTML = "";\n' +
'  if (!chatMessages.length) {\n' +
'    el.innerHTML = \'<div class="chat-empty">No messages in history yet.<br>Send the first message!</div>\';\n' +
'    return;\n' +
'  }\n' +
'  chatMessages.forEach(function(msg) { el.appendChild(buildMsgEl(msg.role || "assistant", msg.text || "")); });\n' +
'  el.scrollTop = el.scrollHeight;\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Chat \u2014 markdown renderer + embed injector\n' +
'   ==================================================== */\n' +
'function escHtml(s) {\n' +
'  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");\n' +
'}\n' +
'function safeUrl(u) { return /^https?:/i.test(u) ? u : ""; }\n' +
'function mdInline(s) {\n' +
'  /* Extract links into placeholders first to prevent bold/italic patterns\n' +
'     from corrupting HTML attributes (e.g. target="_blank"). */\n' +
'  var ls = [], li = 0;\n' +
'  function lph(h) { var k = "\\x00L"+(li++)+"\\x00"; ls.push({k:k,v:h}); return k; }\n' +
'  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_,t,u) {\n' +
'    u = safeUrl(u.replace(/[.,;!?\\]>]+$/,""));\n' +
'    if (!u) return t;\n' +
'    return lph("<a href=\\""+escHtml(u)+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" data-url=\\""+escHtml(u)+"\\">"+t+"</a>");\n' +
'  });\n' +
'  s = s.replace(/https?:\\/\\/[^\\s<>"&]+/g, function(u) {\n' +
'    u = safeUrl(u.replace(/[.,;!?\\]>]+$/,""));\n' +
'    if (!u) return u;\n' +
'    return lph("<a href=\\""+escHtml(u)+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" data-url=\\""+escHtml(u)+"\\">"+escHtml(u)+"</a>");\n' +
'  });\n' +
'  s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g,"<strong><em>$1</em></strong>");\n' +
'  s = s.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>");\n' +
'  s = s.replace(/__(.+?)__/g,"<strong>$1</strong>");\n' +
'  s = s.replace(/\\*([^*\\n]+)\\*/g,"<em>$1</em>");\n' +
'  s = s.replace(/_([^_\\n]+)_/g,"<em>$1</em>");\n' +
'  for (var i = 0; i < ls.length; i++) s = s.split(ls[i].k).join(ls[i].v);\n' +
'  return s;\n' +
'}\n' +
'function renderMarkdown(raw) {\n' +
'  var snips = [], n = 0;\n' +
'  var t = String(raw || "");\n' +
'  t = t.replace(/```[\\w]*\\n?([\\s\\S]*?)```/g, function(_,c) {\n' +
'    var i = n++; snips[i] = "<pre><code>" + escHtml(c.replace(/\\n$/,"")) + "</code></pre>"; return "\\x00S"+i+"\\x00";\n' +
'  });\n' +
'  t = t.replace(/`([^`\\n]+)`/g, function(_,c) {\n' +
'    var i = n++; snips[i] = "<code>" + escHtml(c) + "</code>"; return "\\x00S"+i+"\\x00";\n' +
'  });\n' +
'  var lines = t.split("\\n"), html = "", inUl = false;\n' +
'  for (var i = 0; i < lines.length; i++) {\n' +
'    var ln = lines[i];\n' +
'    var hm = ln.match(/^(#{1,3})\\s+(.+)$/);\n' +
'    if (hm) { if (inUl){html+="</ul>";inUl=false;} html+="<h"+hm[1].length+">"+mdInline(escHtml(hm[2]))+"</h"+hm[1].length+">"; continue; }\n' +
'    var bm = ln.match(/^>\\s*(.*)/);\n' +
'    if (bm) { if (inUl){html+="</ul>";inUl=false;} html+="<blockquote>"+mdInline(escHtml(bm[1]))+"</blockquote>"; continue; }\n' +
'    if (/^(-{3,}|\\*{3,})$/.test(ln.trim())) { if (inUl){html+="</ul>";inUl=false;} html+="<hr>"; continue; }\n' +
'    var lm = ln.match(/^(?:[*\\-]|\\d+\\.)\\s+(.+)$/);\n' +
'    if (lm) { if (!inUl){html+="<ul>";inUl=true;} html+="<li>"+mdInline(escHtml(lm[1]))+"</li>"; continue; }\n' +
'    if (!ln.trim()) { if (inUl){html+="</ul>";inUl=false;} html+="<br>"; continue; }\n' +
'    if (inUl){html+="</ul>";inUl=false;}\n' +
'    html += mdInline(escHtml(ln)) + "<br>";\n' +
'  }\n' +
'  if (inUl) html += "</ul>";\n' +
'  html = html.replace(/(<br>\\s*)+$/, "");\n' +
'  for (var j = 0; j < snips.length; j++) html = html.split("\\x00S"+j+"\\x00").join(snips[j]);\n' +
'  return html;\n' +
'}\n' +
'function injectEmbeds(el) {\n' +
'  var as = Array.prototype.slice.call(el.querySelectorAll("a[data-url]"));\n' +
'  for (var i = 0; i < as.length; i++) {\n' +
'    var a = as[i], u = a.getAttribute("data-url"), emb = null;\n' +
'    var ytM = u.match(/(?:youtube\\.com\\/watch\\?(?:[^&]*&)*v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);\n' +
'    if (ytM) {\n' +
'      emb = document.createElement("div"); emb.className = "chat-embed";\n' +
'      var yi = document.createElement("iframe");\n' +
'      yi.src = "https://www.youtube.com/embed/" + ytM[1];\n' +
'      yi.setAttribute("frameborder","0"); yi.setAttribute("allowfullscreen","");\n' +
'      yi.setAttribute("allow","accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");\n' +
'      emb.appendChild(yi);\n' +
'    } else {\n' +
'      var vmM = u.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/);\n' +
'      if (vmM) {\n' +
'        emb = document.createElement("div"); emb.className = "chat-embed";\n' +
'        var vi = document.createElement("iframe");\n' +
'        vi.src = "https://player.vimeo.com/video/" + vmM[1];\n' +
'        vi.setAttribute("frameborder","0"); vi.setAttribute("allowfullscreen","");\n' +
'        emb.appendChild(vi);\n' +
'      } else if (/\\.(mp4|webm|ogg|mov|m4v)(\\?.*)?$/i.test(u)) {\n' +
'        emb = document.createElement("div"); emb.className = "chat-embed";\n' +
'        var dv = document.createElement("video"); dv.src = u; dv.controls = true;\n' +
'        emb.appendChild(dv);\n' +
'      } else if (/\\.(jpg|jpeg|png|gif|webp|svg)(\\?.*)?$/i.test(u)) {\n' +
'        emb = document.createElement("img");\n' +
'        emb.src = u; emb.className = "chat-img"; emb.alt = ""; emb.loading = "lazy";\n' +
'        emb.onerror = function() { if (this.parentNode) this.parentNode.removeChild(this); };\n' +
'      }\n' +
'    }\n' +
'    if (emb) a.parentNode.insertBefore(emb, a.nextSibling);\n' +
'  }\n' +
'}\n' +
'function buildMsgEl(role, text) {\n' +
'  var wrap = document.createElement("div");\n' +
'  wrap.className = "chat-msg " + (role === "user" ? "user" : "assistant");\n' +
'  var bubble = document.createElement("div"); bubble.className = "chat-bubble";\n' +
'  bubble.innerHTML = renderMarkdown(text);\n' +
'  injectEmbeds(bubble);\n' +
'  wrap.appendChild(bubble);\n' +
'  return wrap;\n' +
'}\n' +
'\n' +
'function appendMessage(role, text) {\n' +
'  chatMessages.push({ role: role, text: text });\n' +
'  var el = document.getElementById("chat-msgs");\n' +
'  var emptyEl = el.querySelector(".chat-empty");\n' +
'  if (emptyEl) emptyEl.remove();\n' +
'  el.appendChild(buildMsgEl(role, text));\n' +
'  el.scrollTop = el.scrollHeight;\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Chat — toolcall polling\n' +
'   ==================================================== */\n' +
'var chatPollTimer = null;\n' +
'function startToolPoll(channelID) {\n' +
'  stopToolPoll();\n' +
'  chatPollTimer = setInterval(function() {\n' +
'    fetch("/api/toolcall?channelID=" + encodeURIComponent(channelID))\n' +
'      .then(function(r){ return r.json(); })\n' +
'      .then(function(d){\n' +
'        var lb = document.querySelector(".chat-thinking .label");\n' +
'        if (!lb) { stopToolPoll(); return; }\n' +
'        lb.textContent = (d.hasTool && d.identity) ? d.identity + "\u2009" : "";\n' +
'      }).catch(function(){});\n' +
'  }, 800);\n' +
'}\n' +
'function stopToolPoll() {\n' +
'  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Chat — send\n' +
'   ==================================================== */\n' +
'function sendMessage() {\n' +
'  if (chatSending) return;\n' +
'  if (!chatChannelID) { toast("Please select a channel first"); return; }\n' +
'  var inp = document.getElementById("chat-input");\n' +
'  var text = inp.value.trim();\n' +
'  if (!text) return;\n' +
'  inp.value = ""; inp.style.height = "auto";\n' +
'  appendMessage("user", text);\n' +
'  chatSending = true;\n' +
'  var btn = document.getElementById("chat-send-btn");\n' +
'  btn.disabled = true; btn.textContent = "";\n' +
'  /* thinking indicator */\n' +
'  var thinkWrap = document.createElement("div"); thinkWrap.className = "chat-msg assistant";\n' +
'  var thinkBub  = document.createElement("div"); thinkBub.className  = "chat-bubble chat-thinking";\n' +
'  var thinkLbl  = document.createElement("span"); thinkLbl.className = "label";\n' +
'  thinkBub.appendChild(thinkLbl);\n' +
'  thinkBub.appendChild(document.createElement("span"));\n' +
'  thinkBub.appendChild(document.createElement("span"));\n' +
'  thinkBub.appendChild(document.createElement("span"));\n' +
'  thinkWrap.appendChild(thinkBub);\n' +
'  var msgsEl = document.getElementById("chat-msgs");\n' +
'  msgsEl.appendChild(thinkWrap); msgsEl.scrollTop = msgsEl.scrollHeight;\n' +
'  startToolPoll(chatChannelID);\n' +
'  fetch("/api/chat", {\n' +
'    method: "POST",\n' +
'    headers: { "Content-Type": "application/json" },\n' +
'    body: JSON.stringify({ channelID: chatChannelID, payload: text })\n' +
'  })\n' +
'  .then(function(r){ return r.json(); })\n' +
'  .then(function(d){\n' +
'    stopToolPoll();\n' +
'    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);\n' +
'    chatSending = false; btn.disabled = false; btn.innerHTML = "&#10148;";\n' +
'    if (d && d.response !== undefined) appendMessage("assistant", String(d.response || ""));\n' +
'    else if (d && d.error) toast("API error: " + d.error, 6000);\n' +
'  })\n' +
'  .catch(function(e){\n' +
'    stopToolPoll();\n' +
'    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);\n' +
'    chatSending = false; btn.disabled = false; btn.innerHTML = "&#10148;";\n' +
'    toast("Send failed: " + e.message, 5000);\n' +
'  });\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Config — API\n' +
'   ==================================================== */\n' +
'function loadConfig() {\n' +
'  fetch("/api/config").then(function(r){ return r.json(); }).then(function(d){\n' +
'    cfg = d; dirty = false;\n' +
'    exp[pk([])] = true;\n' +
'    renderAll();\n' +
'  }).catch(function(e){ toast("Load error: "+e.message, 4000); });\n' +
'}\n' +
'function saveConfig() {\n' +
'  var b = document.getElementById("save-btn");\n' +
'  b.disabled = true; b.textContent = "Saving...";\n' +
'  fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(cfg)})\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(d){\n' +
'      if (d.ok) {\n' +
'        dirty = false; b.textContent = "Saved"; b.className = "";\n' +
'        document.getElementById("status-lbl").textContent = "";\n' +
'        toast("Config saved");\n' +
'      } else { b.textContent = "Save"; b.disabled = false; b.className = "dirty"; toast("Error: "+(d.error||"?"), 4000); }\n' +
'    })\n' +
'    .catch(function(e){ b.textContent = "Save"; b.disabled = false; b.className = "dirty"; toast("Save failed: "+e.message, 4000); });\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Config — Tree\n' +
'   ==================================================== */\n' +
'function renderAll() { renderTree(); renderEditor(); }\n' +
'\n' +
'function renderTree() {\n' +
'  var c = document.getElementById("tree"); c.innerHTML = "";\n' +
'  var rootNode = buildTN("(root)", cfg, [], 0);\n' +
'  if (rootNode) c.appendChild(rootNode);\n' +
'}\n' +
'\n' +
'function buildTN(label, val, path, depth) {\n' +
'  var t = getType(val);\n' +
'  if (!isTreeNode(t)) return null;\n' +
'  var isArr = (t === "obj-arr" || t === "empty-arr");\n' +
'\n' +
'  var item = document.createElement("div"); item.className = "ti";\n' +
'  var lbl = document.createElement("div");\n' +
'  lbl.className = "tl" + (pk(path) === pk(sel) ? " sel" : "");\n' +
'  lbl.style.paddingLeft = (depth * 14 + 8) + "px";\n' +
'\n' +
'  var isExp = !!exp[pk(path)];\n' +
'\n' +
'  var tog = document.createElement("span"); tog.className = "tv" + (isExp ? " open" : "");\n' +
'  tog.innerHTML = "&#9658;";\n' +
'\n' +
'  var ico = document.createElement("span"); ico.className = "ti-icon";\n' +
'  ico.textContent = isArr ? "\\uD83D\\uDCCB" : (depth === 0 ? "\\uD83C\\uDF10" : "\\uD83D\\uDCC1");\n' +
'\n' +
'  var nm = document.createElement("span"); nm.className = "ti-name";\n' +
'  nm.textContent = label; nm.title = label;\n' +
'\n' +
'  var badge = null;\n' +
'  if (isArr) {\n' +
'    badge = document.createElement("span"); badge.className = "ti-badge";\n' +
'    badge.textContent = String(val.length);\n' +
'  }\n' +
'\n' +
'  var acts = document.createElement("div"); acts.className = "ta";\n' +
'\n' +
'  if (!isArr) {\n' +
'    var ab = document.createElement("button"); ab.className = "tb"; ab.textContent = "+";\n' +
'    ab.title = "Add child";\n' +
'    ab.onclick = (function(p){ return function(e){ e.stopPropagation(); showAddMo(p); }; })(path);\n' +
'    acts.appendChild(ab);\n' +
'  } else {\n' +
'    var aib = document.createElement("button"); aib.className = "tb"; aib.textContent = "+";\n' +
'    aib.title = "Add item";\n' +
'    aib.onclick = (function(p){ return function(e){ e.stopPropagation(); addArrItem(p); }; })(path);\n' +
'    acts.appendChild(aib);\n' +
'  }\n' +
'\n' +
'  if (path.length > 0) {\n' +
'    var db = document.createElement("button"); db.className = "tb"; db.textContent = "\\u29c9";\n' +
'    db.title = "Duplicate";\n' +
'    db.onclick = (function(p){ return function(e){ e.stopPropagation(); dupNode(p); }; })(path);\n' +
'    acts.appendChild(db);\n' +
'\n' +
'    var xb = document.createElement("button"); xb.className = "tb del"; xb.textContent = "\\xd7";\n' +
'    xb.title = "Delete";\n' +
'    xb.onclick = (function(p){ return function(e){ e.stopPropagation(); delNode(p); }; })(path);\n' +
'    acts.appendChild(xb);\n' +
'  }\n' +
'\n' +
'  lbl.appendChild(tog); lbl.appendChild(ico); lbl.appendChild(nm);\n' +
'  if (badge) lbl.appendChild(badge);\n' +
'  lbl.appendChild(acts);\n' +
'\n' +
'  lbl.addEventListener("click", (function(p){ return function(){\n' +
'    if (exp[pk(p)]) delete exp[pk(p)]; else exp[pk(p)] = true;\n' +
'    sel = p; renderAll();\n' +
'  }; })(path));\n' +
'\n' +
'  item.appendChild(lbl);\n' +
'\n' +
'  var ch = document.createElement("div"); ch.className = "tc";\n' +
'  ch.style.display = isExp ? "" : "none";\n' +
'\n' +
'  if (!isArr) {\n' +
'    var ents = Object.entries(val);\n' +
'    for (var i = 0; i < ents.length; i++) {\n' +
'      var k = ents[i][0], v = ents[i][1];\n' +
'      var tt = getType(v);\n' +
'      if (!isTreeNode(tt)) continue;\n' +
'      var cpath = path.concat([k]);\n' +
'      var cn = buildTN(k, v, cpath, depth + 1);\n' +
'      if (cn) ch.appendChild(cn);\n' +
'    }\n' +
'  } else {\n' +
'    for (var j = 0; j < val.length; j++) {\n' +
'      var itemPath = path.concat([j]);\n' +
'      var itemNode = buildTN("["+j+"]", val[j], itemPath, depth + 1);\n' +
'      if (itemNode) ch.appendChild(itemNode);\n' +
'    }\n' +
'  }\n' +
'\n' +
'  item.appendChild(ch);\n' +
'  return item;\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Config — Editor\n' +
'   ==================================================== */\n' +
'function renderEditor() {\n' +
'  var ea = document.getElementById("ea"); ea.innerHTML = "";\n' +
'  var val = byPath(cfg, sel);\n' +
'  if (val === undefined) {\n' +
'    ea.innerHTML = \'<div class="empty"><div class="empty-ico">&#127795;</div><div>Select a section from the tree</div></div>\';\n' +
'    return;\n' +
'  }\n' +
'  var t = getType(val);\n' +
'  ea.appendChild(buildBC(sel));\n' +
'  if (t === "obj") ea.appendChild(buildSecEd(sel, val));\n' +
'  else if (t === "obj-arr" || t === "empty-arr") ea.appendChild(buildArrEd(sel, val));\n' +
'}\n' +
'\n' +
'function buildBC(path) {\n' +
'  var bc = document.createElement("div"); bc.id = "bc";\n' +
'  function mkItem(label, p, isCur) {\n' +
'    var s = document.createElement("span");\n' +
'    s.className = "bc-i" + (isCur ? " cur" : "");\n' +
'    s.textContent = label;\n' +
'    if (!isCur) s.onclick = (function(pp){ return function(){ sel = pp; renderAll(); }; })(p);\n' +
'    return s;\n' +
'  }\n' +
'  bc.appendChild(mkItem("root", [], path.length === 0));\n' +
'  for (var i = 0; i < path.length; i++) {\n' +
'    var sep = document.createElement("span"); sep.className = "bc-sep"; sep.textContent = " \u203a ";\n' +
'    bc.appendChild(sep);\n' +
'    bc.appendChild(mkItem(String(path[i]), path.slice(0, i+1), i === path.length-1));\n' +
'  }\n' +
'  return bc;\n' +
'}\n' +
'\n' +
'function buildSecEd(path, obj) {\n' +
'  var wrap = document.createElement("div");\n' +
'\n' +
'  var card = document.createElement("div"); card.className = "card";\n' +
'  var hdr = document.createElement("div"); hdr.className = "ch";\n' +
'  var ico = document.createElement("span"); ico.textContent = path.length === 0 ? "\\uD83C\\uDF10" : "\\uD83D\\uDCC1";\n' +
'  var ttl = document.createElement("span"); ttl.className = "ch-title";\n' +
'  ttl.textContent = path.length ? String(path[path.length-1]) : "root";\n' +
'  hdr.appendChild(ico); hdr.appendChild(ttl);\n' +
'\n' +
'  if (path.length > 0) {\n' +
'    var actWrap = document.createElement("div"); actWrap.style.cssText = "display:flex;gap:6px";\n' +
'    var dupB = document.createElement("button"); dupB.className = "btn btn-s";\n' +
'    dupB.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'    dupB.textContent = "\\u29c9 Duplicate";\n' +
'    dupB.onclick = function(){ dupNode(path); };\n' +
'    var delB = document.createElement("button"); delB.className = "btn btn-d";\n' +
'    delB.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'    delB.textContent = "\\xd7 Delete";\n' +
'    delB.onclick = function(){ delNode(path); };\n' +
'    actWrap.appendChild(dupB); actWrap.appendChild(delB);\n' +
'    hdr.appendChild(actWrap);\n' +
'  }\n' +
'  card.appendChild(hdr);\n' +
'\n' +
'  var body = document.createElement("div"); body.className = "cb";\n' +
'  var hasPrims = false, hasTagArrs = false, hasNavs = false;\n' +
'\n' +
'  var ents = Object.entries(obj);\n' +
'  for (var i = 0; i < ents.length; i++) {\n' +
'    var k = ents[i][0], v = ents[i][1], t = getType(v);\n' +
'    if (isTreeNode(t)) continue;\n' +
'    if (t === "prim-arr") { hasTagArrs = true; continue; }\n' +
'    hasPrims = true;\n' +
'    body.appendChild(buildPropRow(path, k, v, t));\n' +
'  }\n' +
'\n' +
'  for (var j = 0; j < ents.length; j++) {\n' +
'    if (getType(ents[j][1]) !== "prim-arr") continue;\n' +
'    body.appendChild(buildTagRow(path, ents[j][0], ents[j][1]));\n' +
'  }\n' +
'\n' +
'  for (var m = 0; m < ents.length; m++) {\n' +
'    var ek = ents[m][0], ev = ents[m][1], et = getType(ev);\n' +
'    if (!isTreeNode(et)) continue;\n' +
'    hasNavs = true;\n' +
'    body.appendChild(buildNavRow(path, ek, ev, et));\n' +
'  }\n' +
'\n' +
'  if (!hasPrims && !hasTagArrs && !hasNavs) {\n' +
'    var empDiv = document.createElement("div");\n' +
'    empDiv.style.cssText = "padding:16px 14px;color:#94a3b8;font-size:13px";\n' +
'    empDiv.textContent = "No properties yet. Use \\u201cAdd\\u201d below.";\n' +
'    body.appendChild(empDiv);\n' +
'  }\n' +
'\n' +
'  card.appendChild(body);\n' +
'\n' +
'  var ab = document.createElement("div"); ab.className = "addbar";\n' +
'  var addDefs = [\n' +
'    ["+ Attribute", "string"],\n' +
'    ["+ Section {}", "object"],\n' +
'    ["+ Object Array [{}]", "object-array"],\n' +
'    ["+ Tag Array [\\"\\"]", "prim-arr"]\n' +
'  ];\n' +
'  for (var ai = 0; ai < addDefs.length; ai++) {\n' +
'    var aBtn = document.createElement("button"); aBtn.className = "addbtn";\n' +
'    aBtn.textContent = addDefs[ai][0];\n' +
'    aBtn.onclick = (function(tp){ return function(){ showAddPropMo(path, tp); }; })(addDefs[ai][1]);\n' +
'    ab.appendChild(aBtn);\n' +
'  }\n' +
'  card.appendChild(ab);\n' +
'  wrap.appendChild(card);\n' +
'  return wrap;\n' +
'}\n' +
'\n' +
'function buildNavRow(path, key, val, type) {\n' +
'  var row = document.createElement("div"); row.className = "navrow";\n' +
'  var targetPath = path.concat([key]);\n' +
'  var ico = document.createElement("span"); ico.className = "navrow-icon";\n' +
'  ico.textContent = type === "obj" ? "\\uD83D\\uDCC1" : "\\uD83D\\uDCCB";\n' +
'  var nm = document.createElement("span"); nm.className = "navrow-name"; nm.textContent = key;\n' +
'  var prev = document.createElement("span"); prev.className = "navrow-preview";\n' +
'  if (type === "obj") prev.textContent = Object.keys(val).length + " properties";\n' +
'  else prev.textContent = val.length + " items";\n' +
'  var arr = document.createElement("span"); arr.className = "navrow-arr"; arr.textContent = "\\u203a";\n' +
'\n' +
'  var acts = document.createElement("div"); acts.className = "navrow-acts";\n' +
'  var db = document.createElement("button"); db.className = "ib"; db.title = "Duplicate"; db.textContent = "\\u29c9";\n' +
'  db.onclick = function(e){ e.stopPropagation(); dupNode(targetPath); };\n' +
'  var xb = document.createElement("button"); xb.className = "ib del"; xb.title = "Delete"; xb.textContent = "\\xd7";\n' +
'  xb.onclick = function(e){ e.stopPropagation(); delNode(targetPath); };\n' +
'  acts.appendChild(db); acts.appendChild(xb);\n' +
'\n' +
'  row.appendChild(ico); row.appendChild(nm); row.appendChild(prev); row.appendChild(arr); row.appendChild(acts);\n' +
'  row.onclick = function(){ sel = targetPath; exp[pk(targetPath)] = true; renderAll(); };\n' +
'  return row;\n' +
'}\n' +
'\n' +
'function buildArrEd(path, arr) {\n' +
'  var wrap = document.createElement("div");\n' +
'  var card = document.createElement("div"); card.className = "card";\n' +
'  var hdr = document.createElement("div"); hdr.className = "ch";\n' +
'  var ico = document.createElement("span"); ico.textContent = "\\uD83D\\uDCCB";\n' +
'  var ttl = document.createElement("span"); ttl.className = "ch-title";\n' +
'  var key = path.length ? String(path[path.length-1]) : "root";\n' +
'  ttl.textContent = key;\n' +
'  var badge = document.createElement("span");\n' +
'  badge.style.cssText = "font-size:12px;color:var(--muted);font-weight:400;margin-left:4px";\n' +
'  badge.textContent = "["+arr.length+" items]";\n' +
'  ttl.appendChild(badge);\n' +
'\n' +
'  var addItemBtn = document.createElement("button"); addItemBtn.className = "btn btn-s";\n' +
'  addItemBtn.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'  addItemBtn.textContent = "+ Add Item";\n' +
'  addItemBtn.onclick = function(){ addArrItem(path); };\n' +
'\n' +
'  hdr.appendChild(ico); hdr.appendChild(ttl); hdr.appendChild(addItemBtn);\n' +
'  if (path.length > 0) {\n' +
'    var db2 = document.createElement("button"); db2.className = "btn btn-s";\n' +
'    db2.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'    db2.textContent = "\\u29c9 Dup Array";\n' +
'    db2.onclick = function(){ dupNode(path); };\n' +
'    var xb2 = document.createElement("button"); xb2.className = "btn btn-d";\n' +
'    xb2.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'    xb2.textContent = "\\xd7 Delete";\n' +
'    xb2.onclick = function(){ delNode(path); };\n' +
'    hdr.appendChild(db2); hdr.appendChild(xb2);\n' +
'  }\n' +
'  card.appendChild(hdr);\n' +
'\n' +
'  if (!arr.length) {\n' +
'    var em = document.createElement("div");\n' +
'    em.style.cssText = "padding:16px 14px;color:#94a3b8;font-size:13px";\n' +
'    em.textContent = "Empty array. Click \\u201c+ Add Item\\u201d to add entries.";\n' +
'    card.appendChild(em);\n' +
'  } else {\n' +
'    var cb = document.createElement("div"); cb.className = "cb";\n' +
'    for (var i = 0; i < arr.length; i++) {\n' +
'      cb.appendChild(buildArrItemRow(path, i, arr[i]));\n' +
'    }\n' +
'    card.appendChild(cb);\n' +
'  }\n' +
'\n' +
'  wrap.appendChild(card);\n' +
'  return wrap;\n' +
'}\n' +
'\n' +
'function buildArrItemRow(path, idx, item) {\n' +
'  var row = document.createElement("div");\n' +
'  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #f1f5f9";\n' +
'  var idxLbl = document.createElement("span");\n' +
'  idxLbl.style.cssText = "font-size:12px;font-family:monospace;color:#94a3b8;min-width:28px";\n' +
'  idxLbl.textContent = "["+idx+"]";\n' +
'  var prev = document.createElement("span");\n' +
'  prev.style.cssText = "flex:1;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";\n' +
'  prev.textContent = previewObj(item);\n' +
'  var openBtn = document.createElement("button"); openBtn.className = "btn btn-s";\n' +
'  openBtn.style.cssText = "padding:3px 9px;font-size:12px";\n' +
'  openBtn.textContent = "\\u2192 Open";\n' +
'  var ip = path.concat([idx]);\n' +
'  openBtn.onclick = function(){ sel = ip; exp[pk(ip)] = true; renderAll(); };\n' +
'  var db = document.createElement("button"); db.className = "ib"; db.title = "Duplicate"; db.textContent = "\\u29c9";\n' +
'  db.onclick = (function(p){ return function(){ dupNode(p); }; })(ip);\n' +
'  var xb = document.createElement("button"); xb.className = "ib del"; xb.title = "Delete"; xb.textContent = "\\xd7";\n' +
'  xb.onclick = (function(p){ return function(){ delNode(p); }; })(ip);\n' +
'  row.appendChild(idxLbl); row.appendChild(prev); row.appendChild(openBtn); row.appendChild(db); row.appendChild(xb);\n' +
'  return row;\n' +
'}\n' +
'\n' +
'function buildPropRow(path, key, val, type) {\n' +
'  var row = document.createElement("div"); row.className = "pr";\n' +
'\n' +
'  var ke = document.createElement("input"); ke.className = "pk"; ke.value = key;\n' +
'  ke.spellcheck = false; ke.title = "Rename key";\n' +
'  ke.addEventListener("change", (function(k){ return function(e){\n' +
'    var nk = e.target.value.trim();\n' +
'    if (!nk || nk === k) { e.target.value = k; return; }\n' +
'    renameKey(path, k, nk);\n' +
'  }; })(key));\n' +
'\n' +
'  var ve;\n' +
'  if (type === "boolean") {\n' +
'    ve = document.createElement("select"); ve.className = "pv";\n' +
'    ["true","false"].forEach(function(o){\n' +
'      var op = document.createElement("option"); op.value = o; op.textContent = o;\n' +
'      if (String(val) === o) op.selected = true;\n' +
'      ve.appendChild(op);\n' +
'    });\n' +
'    ve.addEventListener("change", (function(p,k){ return function(e){ setPath(cfg, p.concat([k]), e.target.value === "true"); }; })(path, key));\n' +
'  } else if (type === "null") {\n' +
'    ve = document.createElement("span"); ve.style.cssText = "color:#94a3b8;font-family:monospace;font-size:12px"; ve.textContent = "null";\n' +
'  } else {\n' +
'    ve = document.createElement("input"); ve.className = "pv" + (type === "number" ? " num" : "");\n' +
'    ve.value = String(val); ve.spellcheck = false;\n' +
'    ve.addEventListener("input", (function(p,k,tp){ return function(e){\n' +
'      if (tp === "number") { var n = Number(e.target.value); if (!isNaN(n)) setPath(cfg, p.concat([k]), n); }\n' +
'      else setPath(cfg, p.concat([k]), e.target.value);\n' +
'    }; })(path, key, type));\n' +
'  }\n' +
'\n' +
'  var typs = document.createElement("select"); typs.className = "ptyp"; typs.title = "Value type";\n' +
'  ["string","number","boolean","null"].forEach(function(tt){\n' +
'    var op = document.createElement("option"); op.value = tt; op.textContent = tt;\n' +
'    if (tt === type) op.selected = true;\n' +
'    typs.appendChild(op);\n' +
'  });\n' +
'  typs.addEventListener("change", (function(p,k,v){ return function(e){ chgType(p,k,v,e.target.value); }; })(path, key, val));\n' +
'\n' +
'  var xb = document.createElement("button"); xb.className = "ib del"; xb.title = "Delete"; xb.textContent = "\\xd7";\n' +
'  xb.onclick = (function(p,k){ return function(){ delPath(cfg, p.concat([k])); renderAll(); }; })(path, key);\n' +
'\n' +
'  var pa = document.createElement("div"); pa.className = "pa"; pa.appendChild(typs); pa.appendChild(xb);\n' +
'  row.appendChild(ke); row.appendChild(ve); row.appendChild(pa);\n' +
'  return row;\n' +
'}\n' +
'\n' +
'function buildTagRow(path, key, arr) {\n' +
'  var row = document.createElement("div"); row.className = "tagrow";\n' +
'  var lbl = document.createElement("div"); lbl.className = "taglbl";\n' +
'  var lspan = document.createElement("span"); lspan.style.fontFamily = "monospace"; lspan.textContent = key;\n' +
'  var xb = document.createElement("button"); xb.className = "ib del"; xb.title = "Delete array";\n' +
'  xb.style.cssText = "width:22px;height:22px;font-size:13px";\n' +
'  xb.textContent = "\\xd7";\n' +
'  xb.onclick = (function(p,k){ return function(){ delPath(cfg, p.concat([k])); renderAll(); }; })(path, key);\n' +
'  lbl.appendChild(lspan); lbl.appendChild(xb); row.appendChild(lbl);\n' +
'\n' +
'  var ed = document.createElement("div"); ed.className = "taged";\n' +
'  var fullPath = path.concat([key]);\n' +
'\n' +
'  function reChips() {\n' +
'    ed.innerHTML = "";\n' +
'    var cur = byPath(cfg, fullPath) || [];\n' +
'    for (var ci = 0; ci < cur.length; ci++) {\n' +
'      var chip = document.createElement("span"); chip.className = "chip";\n' +
'      var ct = document.createElement("span"); ct.className = "chip-txt"; ct.textContent = String(cur[ci]); ct.title = String(cur[ci]);\n' +
'      var rm = document.createElement("button"); rm.className = "chip-rm"; rm.textContent = "\\xd7";\n' +
'      rm.onclick = (function(ii){ return function(){\n' +
'        byPath(cfg, fullPath).splice(ii, 1); markDirty(); reChips();\n' +
'      }; })(ci);\n' +
'      chip.appendChild(ct); chip.appendChild(rm); ed.appendChild(chip);\n' +
'    }\n' +
'    var inp = document.createElement("input"); inp.className = "taginp"; inp.placeholder = "Add tag\\u2026";\n' +
'    inp.addEventListener("keydown", function(e){\n' +
'      if (e.key === "Enter" || e.key === ",") {\n' +
'        e.preventDefault();\n' +
'        var v = inp.value.trim().replace(/,$/, "");\n' +
'        if (v) { byPath(cfg, fullPath).push(v); markDirty(); reChips(); setTimeout(function(){ ed.querySelector(".taginp") && ed.querySelector(".taginp").focus(); },0); }\n' +
'      } else if (e.key === "Backspace" && !inp.value) {\n' +
'        var a = byPath(cfg, fullPath);\n' +
'        if (a.length) { a.pop(); markDirty(); reChips(); }\n' +
'      }\n' +
'    });\n' +
'    ed.appendChild(inp);\n' +
'    ed.onclick = function(){ inp.focus(); };\n' +
'  }\n' +
'  reChips();\n' +
'  row.appendChild(ed);\n' +
'  return row;\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Config — Operations\n' +
'   ==================================================== */\n' +
'function chgType(path, key, oldVal, newType) {\n' +
'  var nv;\n' +
'  if (newType === "string") nv = String(oldVal != null ? oldVal : "");\n' +
'  else if (newType === "number") { var n = Number(oldVal); nv = isNaN(n) ? 0 : n; }\n' +
'  else if (newType === "boolean") nv = !!oldVal;\n' +
'  else nv = null;\n' +
'  setPath(cfg, path.concat([key]), nv); renderAll();\n' +
'}\n' +
'\n' +
'function renameKey(path, oldKey, newKey) {\n' +
'  var parent = byPath(cfg, path);\n' +
'  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return;\n' +
'  if (newKey in parent) { toast("Key already exists"); return; }\n' +
'  var newObj = {};\n' +
'  Object.keys(parent).forEach(function(k){ newObj[k === oldKey ? newKey : k] = parent[k]; });\n' +
'  if (!path.length) { Object.keys(cfg).forEach(function(k){ delete cfg[k]; }); Object.assign(cfg, newObj); }\n' +
'  else setPath(cfg, path, newObj);\n' +
'  markDirty(); renderAll();\n' +
'}\n' +
'\n' +
'function delNode(path) {\n' +
'  if (!path.length) return;\n' +
'  if (!confirm("Delete this item and all its contents?")) return;\n' +
'  var sp = JSON.stringify(sel), dp = JSON.stringify(path);\n' +
'  if (sp === dp || sp.startsWith(dp.slice(0,-1))) sel = path.slice(0,-1);\n' +
'  delPath(cfg, path); renderAll(); toast("Deleted");\n' +
'}\n' +
'\n' +
'function dupNode(path) {\n' +
'  if (!path.length) return;\n' +
'  var val = byPath(cfg, path); if (val === undefined) return;\n' +
'  var parent = byPath(cfg, path.slice(0,-1));\n' +
'  var key = path[path.length-1];\n' +
'  if (Array.isArray(parent)) {\n' +
'    parent.splice(Number(key)+1, 0, clone(val)); markDirty(); renderAll(); toast("Duplicated");\n' +
'  } else if (parent && typeof parent === "object") {\n' +
'    var nk = String(key)+"_copy", i = 2;\n' +
'    while (nk in parent) nk = String(key)+"_copy"+i++;\n' +
'    parent[nk] = clone(val); markDirty(); renderAll(); toast("Duplicated as \\""+nk+"\\"");\n' +
'  }\n' +
'}\n' +
'\n' +
'function addArrItem(path) {\n' +
'  var arr = byPath(cfg, path); if (!Array.isArray(arr)) return;\n' +
'  var newItem = arr.length ? clone(clearVals(arr[0])) : {};\n' +
'  arr.push(newItem); markDirty(); renderAll(); toast("Item added");\n' +
'}\n' +
'\n' +
'function clearVals(o) {\n' +
'  if (typeof o !== "object" || o === null) return "";\n' +
'  if (Array.isArray(o)) return [];\n' +
'  var r = {};\n' +
'  Object.keys(o).forEach(function(k){\n' +
'    var v = o[k];\n' +
'    if (typeof v === "string") r[k] = "";\n' +
'    else if (typeof v === "number") r[k] = 0;\n' +
'    else if (typeof v === "boolean") r[k] = false;\n' +
'    else if (v === null) r[k] = null;\n' +
'    else if (Array.isArray(v)) r[k] = [];\n' +
'    else r[k] = clearVals(v);\n' +
'  });\n' +
'  return r;\n' +
'}\n' +
'\n' +
'function addProp(path, key, type) {\n' +
'  var parent = byPath(cfg, path);\n' +
'  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) return;\n' +
'  if (key in parent) { toast("Key \\""+key+"\\" already exists"); return; }\n' +
'  var v;\n' +
'  if (type === "string") v = "";\n' +
'  else if (type === "number") v = 0;\n' +
'  else if (type === "object") v = {};\n' +
'  else if (type === "object-array") v = [{}];\n' +
'  else if (type === "prim-arr") v = [];\n' +
'  else v = "";\n' +
'  parent[key] = v; markDirty();\n' +
'  if (type === "object" || type === "object-array") {\n' +
'    sel = path.concat([key]); exp[pk(path.concat([key]))] = true;\n' +
'  }\n' +
'  renderAll(); toast("Added \\""+key+"\\"");\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Modal\n' +
'   ==================================================== */\n' +
'function showMo(title, html, cb, okLabel) {\n' +
'  document.getElementById("mttl").textContent = title;\n' +
'  document.getElementById("mc").innerHTML = html;\n' +
'  document.getElementById("mok").textContent = okLabel || "Add";\n' +
'  moCb = cb;\n' +
'  document.getElementById("mo").classList.add("open");\n' +
'  setTimeout(function(){ var f = document.querySelector("#mc input"); if(f) f.focus(); }, 80);\n' +
'  document.querySelectorAll("#mc input").forEach(function(i){\n' +
'    i.addEventListener("keydown", function(e){ if(e.key==="Enter") confirmMo(); });\n' +
'  });\n' +
'}\n' +
'function closeMo() { document.getElementById("mo").classList.remove("open"); moCb = null; }\n' +
'function confirmMo() { if (moCb && moCb() !== false) closeMo(); }\n' +
'\n' +
'function showAddMo(path) { showAddPropMo(path, "string"); }\n' +
'\n' +
'function showAddPropMo(path, pre) {\n' +
'  var sel_s  = pre === "string"       ? "selected" : "";\n' +
'  var sel_n  = pre === "number"       ? "selected" : "";\n' +
'  var sel_o  = pre === "object"       ? "selected" : "";\n' +
'  var sel_oa = pre === "object-array" ? "selected" : "";\n' +
'  var sel_pa = pre === "prim-arr"     ? "selected" : "";\n' +
'  showMo("Add Property",\n' +
'    \'<label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">Type</label>\' +\n' +
'    \'<select id="mo-type" class="msel">\' +\n' +
'    \'<option value="string" \'+sel_s+\'>Attribute (string)</option>\' +\n' +
'    \'<option value="number" \'+sel_n+\'>Attribute (number)</option>\' +\n' +
'    \'<option value="object" \'+sel_o+\'>Section {}</option>\' +\n' +
'    \'<option value="object-array" \'+sel_oa+\'>Object Array [{}]</option>\' +\n' +
'    \'<option value="prim-arr" \'+sel_pa+\'>Tag Array [""]</option></select>\' +\n' +
'    \'<label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px">Key name</label>\' +\n' +
'    \'<input class="mi" id="mo-key" placeholder="e.g. myKey" autofocus>\',\n' +
'    function() {\n' +
'      var k = document.getElementById("mo-key").value.trim();\n' +
'      var tp = document.getElementById("mo-type").value;\n' +
'      if (!k) { toast("Please enter a key name"); return false; }\n' +
'      addProp(path, k, tp);\n' +
'    }\n' +
'  );\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Sidebar toggle (mobile, config tab only)\n' +
'   ==================================================== */\n' +
'function toggleSb() {\n' +
'  document.getElementById("sidebar").classList.toggle("open");\n' +
'  document.getElementById("sovl").classList.toggle("open");\n' +
'}\n' +
'\n' +
'/* ====================================================\n' +
'   Keyboard shortcuts\n' +
'   ==================================================== */\n' +
'document.addEventListener("keydown", function(e) {\n' +
'  if (e.key === "Escape") closeMo();\n' +
'  if ((e.ctrlKey || e.metaKey) && e.key === "s") {\n' +
'    e.preventDefault();\n' +
'    if (currentTab === "config" && dirty) saveConfig();\n' +
'  }\n' +
'});\n' +
'\n' +
'/* ====================================================\n' +
'   Chat input: auto-resize + Enter-to-send\n' +
'   ==================================================== */\n' +
'var chatInpEl = document.getElementById("chat-input");\n' +
'chatInpEl.addEventListener("input", function() {\n' +
'  this.style.height = "auto";\n' +
'  this.style.height = Math.min(this.scrollHeight, 120) + "px";\n' +
'});\n' +
'chatInpEl.addEventListener("keydown", function(e) {\n' +
'  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }\n' +
'});\n' +
'\n' +
'/* ====================================================\n' +
'   Init\n' +
'   ==================================================== */\n' +
'loadChats();\n' +
'loadConfig();\n' +
'</script>\n' +
'</body>\n' +
'</html>'
  );
}

/********************************************************************************************************************
* functionSignature: startConfigEditor (coreData)
* Purpose: Starts the config-editor HTTP server.
*          Serves the SPA and exposes endpoints for config editing and AI chat.
********************************************************************************************************************/
export default async function startConfigEditor(coreData) {
  const cfg      = coreData?.config?.[MODULE_NAME] || {};
  const port     = Number(cfg.port    ?? 3111);
  const host     = String(cfg.host    ?? "0.0.0.0");
  const token    = String(cfg.token   ?? "").trim();
  const cfgFile  = cfg.configPath
    ? String(cfg.configPath)
    : path.resolve(__dirname, "..", "core.json");

  /* Chat configuration */
  const chats    = Array.isArray(cfg.chats) ? cfg.chats : [];
  const globalApiUrl = String(cfg.apiUrl ?? "http://localhost:3400/api").trim();

  const html = getHtml();

  const server = http.createServer(async (req, res) => {
    try {
      const url      = new URL(req.url, "http://localhost");
      const method   = (req.method || "GET").toUpperCase();
      const pathname = url.pathname;

      /* Auth guard */
      if (!isAuthorized(req, token)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Basic realm=\"Jenny Admin\""
        });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }

      /* ---- Serve SPA ---- */
      if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      /* ---- GET /api/config ---- */
      if (method === "GET" && pathname === "/api/config") {
        const result = readJsonFile(cfgFile);
        if (!result.ok) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: result.error }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result.data));
      }

      /* ---- POST /api/config ---- */
      if (method === "POST" && pathname === "/api/config") {
        const body = await getBody(req);
        let data;
        try { data = JSON.parse(body); }
        catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid JSON: " + String(e?.message || e) }));
        }
        const result = writeJsonFile(cfgFile, data);
        if (!result.ok) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: result.error }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }

      /* ---- GET /api/chats — public chat list (no apiSecret exposed) ---- */
      if (method === "GET" && pathname === "/api/chats") {
        const publicChats = chats.map(c => ({
          label:     String(c.label     || c.channelID || "Chat"),
          channelID: String(c.channelID || ""),
        })).filter(c => c.channelID);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(publicChats));
      }

      /* ---- GET /api/context?channelID=xxx — last 100 context rows from MySQL ---- */
      if (method === "GET" && pathname === "/api/context") {
        const channelID = String(url.searchParams.get("channelID") || "").trim();
        if (!channelID) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "channelID parameter required" }));
        }
        try {
          const pool = await getDb(coreData);
          const [rows] = await pool.query(
            "SELECT role, text, json, ts FROM context WHERE id = ? ORDER BY ctx_id DESC LIMIT 100",
            [channelID]
          );
          /* Reverse so oldest message is first.
             Only user/assistant rows are shown — tool/system rows are internal pipeline details.
             Prefer json.content (full, untruncated) over the text column (capped at 500 chars). */
          const msgs = rows.reverse()
            .filter(r => { const rl = String(r.role || "").toLowerCase(); return rl === "user" || rl === "assistant"; })
            .map(r => {
              let text = String(r.text || "");
              try {
                const obj = JSON.parse(r.json);
                if (typeof obj?.content === "string" && obj.content) text = obj.content;
              } catch (_) {}
              return { role: String(r.role || "assistant"), text, ts: r.ts };
            });
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(msgs));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      }

      /* ---- POST /api/chat — proxy message to the bot API ---- */
      if (method === "POST" && pathname === "/api/chat") {
        const body = await getBody(req);
        let data;
        try { data = JSON.parse(body); }
        catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid JSON" }));
        }

        const channelID = String(data.channelID || "").trim();
        const payload   = String(data.payload   || "").trim();
        if (!payload) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "payload required" }));
        }

        /* Find the matching chat config entry to get its apiSecret / apiUrl */
        const chatCfg    = chats.find(c => String(c.channelID || "") === channelID) || {};
        const chatApiUrl = String(chatCfg.apiUrl || globalApiUrl);
        const chatSecret = String(chatCfg.apiSecret || "").trim();

        try {
          const reqHeaders = { "Content-Type": "application/json" };
          if (chatSecret) reqHeaders["Authorization"] = "Bearer " + chatSecret;

          const apiRes = await fetch(chatApiUrl, {
            method:  "POST",
            headers: reqHeaders,
            body:    JSON.stringify({ channelID, payload }),
          });

          const result = await apiRes.json();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "API call failed: " + String(e?.message || e) }));
        }
      }

      /* ---- GET /api/toolcall?channelID=xxx — proxy to bot's /toolcall endpoint ---- */
      if (method === "GET" && pathname === "/api/toolcall") {
        const channelID  = String(url.searchParams.get("channelID") || "").trim();
        const chatCfg    = chats.find(c => String(c.channelID || "") === channelID) || {};
        const chatApiUrl = String(chatCfg.apiUrl || globalApiUrl);
        const chatSecret = String(chatCfg.apiSecret || "").trim();

        /* Derive toolcall URL: replace trailing /api (or /api/) with /toolcall */
        const toolcallUrl = chatApiUrl.replace(/\/api\/?$/, "/toolcall");

        try {
          const reqHeaders = {};
          if (chatSecret) reqHeaders["Authorization"] = "Bearer " + chatSecret;
          const tcRes  = await fetch(toolcallUrl, { headers: reqHeaders });
          const result = await tcRes.json();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, hasTool: false, identity: "", error: String(e?.message || e) }));
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  });

  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log("[" + MODULE_NAME + "] Running at http://" + displayHost + ":" + port);
    if (token) console.log("[" + MODULE_NAME + "] Auth token set (use as Bearer or Basic password)");
    else       console.log("[" + MODULE_NAME + "] Warning: no auth token configured (config.config-editor.token)");
    if (chats.length) console.log("[" + MODULE_NAME + "] " + chats.length + " chat(s) configured");
    else              console.log("[" + MODULE_NAME + "] No chats configured (add config-editor.chats[])");
  });

  server.on("error", (e) => {
    console.error("[" + MODULE_NAME + "] Server error:", e.message);
  });

  return coreData;
}
