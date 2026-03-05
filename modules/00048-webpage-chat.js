"use strict";

import fs from "node:fs";
import { getDb, getMenuHtml } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "webpage-chat";

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
* functionSignature: getBody (wo)
********************************************************************************************************************/
function getBody(wo) {
  return String(wo.http?.rawBody ?? wo.http?.body ?? "");
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
* functionSignature: getUserRoleLabels (wo)
* Purpose: Returns all role labels (lowercased) the current user has.
* Notes: webpage-auth is responsible for mapping Discord role IDs -> labels.
*        Therefore wo.webAuth.roles must contain labels already.
********************************************************************************************************************/
function getUserRoleLabels(wo) {
  const out = [];
  const seen = new Set();

  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }

  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }

  return out;
}

/********************************************************************************************************************
* functionSignature: getIsChatVisibleForUser (wo, chatEntry)
* Purpose: If chatEntry.roles[] is set, only show the chat when user has at least one of those roles (OR).
********************************************************************************************************************/
function getIsChatVisibleForUser(wo, chatEntry) {
  const required = Array.isArray(chatEntry?.roles) ? chatEntry.roles : [];
  if (!required.length) return true;

  const userRoles = getUserRoleLabels(wo);
  if (!userRoles.length) return false;

  for (const rr of required) {
    const need = String(rr || "").trim().toLowerCase();
    if (!need) continue;
    if (userRoles.includes(need)) return true;
  }
  return false;
}

/********************************************************************************************************************
* functionSignature: getChatEntryByChannelID (chats, channelID)
********************************************************************************************************************/
function getChatEntryByChannelID(chats, channelID) {
  const id = String(channelID || "").trim();
  if (!id) return null;
  for (const c of chats) {
    if (String(c?.channelID || "").trim() === id) return c;
  }
  return null;
}


/********************************************************************************************************************
* functionSignature: getBasePath (cfg)
********************************************************************************************************************/
function getBasePath(cfg) {
  const bp = String(cfg.basePath ?? "/chat").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/,"") : "/chat";
}

/********************************************************************************************************************
* functionSignature: getWebpageChat (coreData)
********************************************************************************************************************/
export default async function getWebpageChat(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg   = coreData?.config?.[MODULE_NAME] || {};
  const port  = Number(cfg.port ?? 3112);
  const chats = Array.isArray(cfg.chats) ? cfg.chats : [];
  const globalApiUrl = String(cfg.apiUrl ?? "http://localhost:3400/api").trim();
  const basePath = getBasePath(cfg);

  if (Number(wo.http?.port) !== port) return coreData;
  if (wo.jump) return coreData;

  const method  = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

/* ---- GET /chat/style.css ---- */
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

/* ---- GET /chat ---- */
  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!isAllowed) {
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: getAccessDeniedHtml({
          menu: wo.web?.menu || [],
          role: wo.webAuth?.role || "",
          activePath: urlPath,
          base: basePath,
          title: "Chat",
          message: "Access denied."
        })
      };
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: getChatHtml({
        menu: wo.web?.menu || [],
        role: wo.webAuth?.role || "",
        activePath: urlPath,
        chatBase: basePath
      })
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat/api/chats ---- */
  if (method === "GET" && urlPath === basePath + "/api/chats") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

const publicChats = chats
  .filter(c => getIsChatVisibleForUser(wo, c))
  .map(c => ({ label: String(c.label || c.channelID || "Chat"), channelID: String(c.channelID || "") }))
  .filter(c => c.channelID);
setJsonResp(wo, 200, publicChats);
wo.jump = true;
await setSendNow(wo);
return coreData;
  }

  /* ---- GET /chat/api/context?channelID=xxx ---- */
  if (method === "GET" && urlPath === basePath + "/api/context") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const rawUrl    = String(wo.http?.url ?? (basePath + "/api/context"));
    const urlObj    = new URL(rawUrl, "http://localhost");
    const channelID = String(urlObj.searchParams.get("channelID") || "").trim();
    if (!channelID) {
      setJsonResp(wo, 400, { error: "channelID parameter required" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) {
      setNotFound(wo);
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    if (!getIsChatVisibleForUser(wo, chatEntry)) {
      setNotFound(wo);
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    try {
      const pool = await getDb(coreData);
      const [rows] = await pool.query(
        "SELECT role, text, json, ts FROM context WHERE id = ? ORDER BY ctx_id DESC LIMIT 100",
        [channelID]
      );
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
      setJsonResp(wo, 200, msgs);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /chat/api/chat ---- */
  if (method === "POST" && urlPath === basePath + "/api/chat") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    let reqData = wo.http?.json ?? null;
    if (reqData === null) {
      try { reqData = JSON.parse(getBody(wo)); }
      catch (_) {
        setJsonResp(wo, 400, { error: "Invalid JSON" });
        wo.jump = true;
        await setSendNow(wo);
        return coreData;
      }
    }

    const channelID = String(reqData?.channelID || "").trim();
    const payload   = String(reqData?.payload   || "").trim();
    if (!channelID || !payload) {
      setJsonResp(wo, 400, { error: "channelID and payload required" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) {
      setNotFound(wo);
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    /* chatEntry already resolved above */
    if (!getIsChatVisibleForUser(wo, chatEntry)) {
      setNotFound(wo);
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const apiSecret  = String(chatEntry.apiSecret || "").trim();
    const chatApiUrl = String(chatEntry.apiUrl || globalApiUrl).trim();

    const reqHeaders = { "Content-Type": "application/json" };
    if (apiSecret) reqHeaders["Authorization"] = "Bearer " + apiSecret;

    try {
      const { default: https } = await import("https");
      const { default: http  } = await import("http");
      const apiUrlObj = new URL(chatApiUrl);
      const postBody  = JSON.stringify({ channelID, payload });

      const result = await new Promise((resolve, reject) => {
        const mod = apiUrlObj.protocol === "https:" ? https : http;
        const reqOpts = {
          hostname: apiUrlObj.hostname,
          port: apiUrlObj.port || (apiUrlObj.protocol === "https:" ? 443 : 80),
          path: apiUrlObj.pathname + apiUrlObj.search,
          method: "POST",
          headers: { ...reqHeaders, "Content-Length": Buffer.byteLength(postBody) }
        };
        const r = mod.request(reqOpts, (res) => {
          let buf = "";
          res.on("data", d => { buf += d; });
          res.on("end",  () => {
            try { resolve(JSON.parse(buf)); }
            catch (_) { resolve({ response: buf }); }
          });
        });
        r.on("error", reject);
        r.write(postBody);
        r.end();
      });

      setJsonResp(wo, 200, result);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat/api/toolcall?channelID=xxx ---- */
  if (method === "GET" && urlPath === basePath + "/api/toolcall") {
    if (!isAllowed) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const rawUrl    = String(wo.http?.url ?? (basePath + "/api/toolcall"));
    const urlObj    = new URL(rawUrl, "http://localhost");
    const channelID = String(urlObj.searchParams.get("channelID") || "").trim();

    const chatEntry  = chats.find(c => String(c.channelID || "") === channelID) || {};
    const apiSecret  = String(chatEntry.apiSecret || "").trim();
    const chatApiUrl = String(chatEntry.apiUrl || globalApiUrl).trim();

    const toolcallUrl = chatApiUrl.replace(/\/api\/?$/i, "/toolcall");
    const finalUrl = channelID ? (toolcallUrl + "?channelID=" + encodeURIComponent(channelID)) : toolcallUrl;

    const reqHeaders = {};
    if (apiSecret) reqHeaders["Authorization"] = "Bearer " + apiSecret;

    try {
      const { default: https } = await import("https");
      const { default: http  } = await import("http");
      const u = new URL(finalUrl);
      const mod = u.protocol === "https:" ? https : http;

      const data = await new Promise((resolve, reject) => {
        const r = mod.get(
          { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers: reqHeaders },
          (res) => {
            let buf = "";
            res.on("data", d => { buf += d; });
            res.on("end", () => {
              try { resolve(JSON.parse(buf)); } catch (_) { resolve({}); }
            });
          }
        );
        r.on("error", reject);
      });

      setJsonResp(wo, 200, data);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

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
'<title>Jenny — ' + title + '</title>\n' +
'<link rel="stylesheet" href="' + base + '/style.css">\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <h1>Jenny</h1>\n' +
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
* functionSignature: getChatHtml (opts)
* Purpose: Chat single page app (HTML+JS). Uses shared stylesheet at {chatBase}/style.css.
********************************************************************************************************************/
function getChatHtml(opts) {
  const chatBase   = String(opts?.chatBase || "/chat").replace(/\/+$/,"") || "/chat";
  const activePath = String(opts?.activePath || chatBase) || chatBase;
  const role       = String(opts?.role || "").trim();
  const menuHtml   = getMenuHtml(opts?.menu || [], activePath, role);

  return (
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">\n' +
'<title>Jenny — Chat</title>\n' +
'<link rel="stylesheet" href="' + chatBase + '/style.css">\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <h1>Jenny</h1>\n' +
(menuHtml ? ('  ' + menuHtml + '\n') : '') +
'</header>\n' +
'\n' +
'<div id="chat-view">\n' +
'  <div id="chat-channel-bar">\n' +
'    <label>Channel:</label>\n' +
'    <select id="chat-sel" onchange="onChatSel(this.value)"><option value="">Loading…</option></select>\n' +
'    <button id="chat-reload-btn" onclick="reloadContext()" title="Reload context">↻</button>\n' +
'  </div>\n' +
'  <div id="chat-msgs"><div class="chat-loading">Select a channel to start chatting.</div></div>\n' +
'  <div id="chat-footer">\n' +
'    <textarea id="chat-input" placeholder="Type a message…  (Enter = send • Shift+Enter = newline)" rows="1"></textarea>\n' +
'    <button id="chat-send-btn" onclick="sendMessage()" title="Send">➤</button>\n' +
'  </div>\n' +
'</div>\n' +
'<div id="toast" class="toast"></div>\n' +
'\n' +
'<script>\n' +
'var CHAT_BASE="' + chatBase + '";\n' +
'var chatChannelID = "";\n' +
'var chatMessages  = [];\n' +
'var chatSending   = false;\n' +
'var chatPollTimer = null;\n' +
'function toast(msg, ms) {\n' +
'  var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on");\n' +
'  setTimeout(function(){ t.classList.remove("on"); }, ms || 2400);\n' +
'}\n' +
'function loadChats() {\n' +
'  fetch(CHAT_BASE + "/api/chats")\n' +
'    .then(function(r){\n' +
'      if (!r.ok) return r.text().then(function(t){ throw new Error((t || r.statusText || ("HTTP " + r.status))); });\n' +
'      return r.json();\n' +
'    })\n' +
'    .then(function(list){\n' +
'      var selEl = document.getElementById("chat-sel");\n' +
'      selEl.innerHTML = "";\n' +
'      if (!list || !list.length) {\n' +
'        var opt = document.createElement("option");\n' +
'        opt.value = ""; opt.textContent = "No chats configured — add webpage-chat.chats[]";\n' +
'        selEl.appendChild(opt); return;\n' +
'      }\n' +
'      list.forEach(function(c) {\n' +
'        var opt = document.createElement("option");\n' +
'        opt.value = c.channelID; opt.textContent = c.label || c.channelID;\n' +
'        selEl.appendChild(opt);\n' +
'      });\n' +
'      if (list[0] && list[0].channelID) { selEl.value = list[0].channelID; onChatSel(list[0].channelID); }\n' +
'    })\n' +
'    .catch(function(e){ toast("Failed to load chats: " + e.message, 6000); });\n' +
'}\n' +
'function onChatSel(channelID) {\n' +
'  chatChannelID = channelID;\n' +
'  if (channelID) loadContext(channelID);\n' +
'  else document.getElementById("chat-msgs").innerHTML = \'<div class="chat-loading">Select a channel to start chatting.</div>\';\n' +
'}\n' +
'function reloadContext() { if (chatChannelID) loadContext(chatChannelID); }\n' +
'function loadContext(channelID) {\n' +
'  document.getElementById("chat-msgs").innerHTML = \'<div class="chat-loading">Loading context…</div>\';\n' +
'  fetch(CHAT_BASE + "/api/context?channelID=" + encodeURIComponent(channelID))\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(data){\n' +
'      if (data && data.error) { toast("Context error: " + data.error, 5000); chatMessages = []; renderMessages(); return; }\n' +
'      chatMessages = Array.isArray(data) ? data : (data && Array.isArray(data.messages) ? data.messages : []);\n' +
'      renderMessages();\n' +
'    })\n' +
'    .catch(function(e){ toast("Context load error: " + e.message, 4000); });\n' +
'}\n' +
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
'function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }\n' +
'function safeUrl(u) { return /^https?:/i.test(u) ? u : ""; }\n' +
'function mdInline(s) {\n' +
'  var ls = [], li = 0;\n' +
'  function lph(h) { var k="\\x00L"+(li++)+"\\x00"; ls.push({k:k,v:h}); return k; }\n' +
'  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_,t,u){\n' +
'    u = safeUrl(u.replace(/[.,;!?\\]>]+$/,""));\n' +
'    if (!u) return t;\n' +
'    return lph("<a href=\\""+escHtml(u)+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" data-url=\\""+escHtml(u)+"\\">"+t+"</a>");\n' +
'  });\n' +
'  s = s.replace(/https?:\\/\\/[^\\s<>\\"&]+/g, function(u){\n' +
'    u = safeUrl(u.replace(/[.,;!?\\]>]+$/,""));\n' +
'    if (!u) return u;\n' +
'    return lph("<a href=\\""+escHtml(u)+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" data-url=\\""+escHtml(u)+"\\">"+escHtml(u)+"</a>");\n' +
'  });\n' +
'  s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g,"<strong><em>$1</em></strong>");\n' +
'  s = s.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>");\n' +
'  s = s.replace(/__(.+?)__/g,"<strong>$1</strong>");\n' +
'  s = s.replace(/\\*([^*\\n]+)\\*/g,"<em>$1</em>");\n' +
'  s = s.replace(/_([^_\\n]+)_/g,"<em>$1</em>");\n' +
'  for (var i=0;i<ls.length;i++) s = s.split(ls[i].k).join(ls[i].v);\n' +
'  return s;\n' +
'}\n' +
'function renderMarkdown(raw) {\n' +
'  var snips=[], n=0, t=String(raw||"");\n' +
'  t = t.replace(/```[\\w]*\\n?([\\s\\S]*?)```/g,function(_,c){ var i=n++; snips[i]="<pre><code>"+escHtml(c.replace(/\\n$/,""))+"</code></pre>"; return "\\x00S"+i+"\\x00"; });\n' +
'  t = t.replace(/`([^`\\n]+)`/g,function(_,c){ var i=n++; snips[i]="<code>"+escHtml(c)+"</code>"; return "\\x00S"+i+"\\x00"; });\n' +
'  var lines=t.split("\\n"), html="", inUl=false;\n' +
'  for (var i=0;i<lines.length;i++){\n' +
'    var ln=lines[i];\n' +
'    var hm=ln.match(/^(#{1,3})\\s+(.+)$/);\n' +
'    if (hm){ if(inUl){html+="</ul>";inUl=false;} html+="<h"+hm[1].length+">"+mdInline(escHtml(hm[2]))+"</h"+hm[1].length+">"; continue; }\n' +
'    var bm=ln.match(/^>\\s*(.*)/);\n' +
'    if (bm){ if(inUl){html+="</ul>";inUl=false;} html+="<blockquote>"+mdInline(escHtml(bm[1]))+"</blockquote>"; continue; }\n' +
'    if (/^(-{3,}|\\*{3,})$/.test(ln.trim())){ if(inUl){html+="</ul>";inUl=false;} html+="<hr>"; continue; }\n' +
'    var lm=ln.match(/^(?:[*\\-]|\\d+\\.)\\s+(.+)$/);\n' +
'    if (lm){ if(!inUl){html+="<ul>";inUl=true;} html+="<li>"+mdInline(escHtml(lm[1]))+"</li>"; continue; }\n' +
'    if (!ln.trim()){ if(inUl){html+="</ul>";inUl=false;} html+="<br>"; continue; }\n' +
'    if (inUl){html+="</ul>";inUl=false;}\n' +
'    html += mdInline(escHtml(ln)) + "<br>";\n' +
'  }\n' +
'  if (inUl) html += "</ul>";\n' +
'  html = html.replace(/(<br>\\s*)+$/,"");\n' +
'  for (var j=0;j<snips.length;j++) html = html.split("\\x00S"+j+"\\x00").join(snips[j]);\n' +
'  return html;\n' +
'}\n' +
'function injectEmbeds(el){\n' +
'  var as=[].slice.call(el.querySelectorAll("a[data-url]"));\n' +
'  for (var i=0;i<as.length;i++){\n' +
'    var a=as[i], u=a.getAttribute("data-url"), emb=null;\n' +
'    var ytM=u.match(/(?:youtube\\.com\\/watch\\?(?:[^&]*&)*v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);\n' +
'    if (ytM){\n' +
'      emb=document.createElement("div"); emb.className="chat-embed";\n' +
'      var yi=document.createElement("iframe"); yi.src="https://www.youtube.com/embed/"+ytM[1];\n' +
'      yi.setAttribute("frameborder","0"); yi.setAttribute("allowfullscreen","");\n' +
'      yi.setAttribute("allow","accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");\n' +
'      emb.appendChild(yi);\n' +
'    } else {\n' +
'      var vmM=u.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/);\n' +
'      if (vmM){\n' +
'        emb=document.createElement("div"); emb.className="chat-embed";\n' +
'        var vi=document.createElement("iframe"); vi.src="https://player.vimeo.com/video/"+vmM[1];\n' +
'        vi.setAttribute("frameborder","0"); vi.setAttribute("allowfullscreen","");\n' +
'        emb.appendChild(vi);\n' +
'      } else if (/\\.(mp4|webm|ogg|mov|m4v)(\\?.*)?$/i.test(u)){\n' +
'        emb=document.createElement("div"); emb.className="chat-embed";\n' +
'        var dv=document.createElement("video"); dv.src=u; dv.controls=true; emb.appendChild(dv);\n' +
'      } else if (/\\.(jpg|jpeg|png|gif|webp|svg)(\\?.*)?$/i.test(u)){\n' +
'        emb=document.createElement("div");\n' +
'        emb.className="chat-embed";\n' +
'        var im=document.createElement("img");\n' +
'        im.src=u; im.className="chat-img"; im.alt=""; im.loading="lazy";\n' +
'        im.onerror=function(){ if(this.parentNode) this.parentNode.removeChild(this); };\n' +
'        emb.appendChild(im);\n' +
'      }\n' +
'    }\n' +
'    if (emb) a.parentNode.insertBefore(emb, a.nextSibling);\n' +
'  }\n' +
'}\n' +
'function buildMsgEl(role,text){\n' +
'  var wrap=document.createElement("div"); wrap.className="chat-msg "+(role==="user"?"user":"assistant");\n' +
'  var bubble=document.createElement("div"); bubble.className="chat-bubble"; bubble.innerHTML=renderMarkdown(text);\n' +
'  injectEmbeds(bubble); wrap.appendChild(bubble); return wrap;\n' +
'}\n' +
'function appendMessage(role,text){\n' +
'  chatMessages.push({role:role,text:text});\n' +
'  var el=document.getElementById("chat-msgs");\n' +
'  var emptyEl=el.querySelector(".chat-empty"); if(emptyEl) emptyEl.remove();\n' +
'  el.appendChild(buildMsgEl(role,text)); el.scrollTop=el.scrollHeight;\n' +
'}\n' +
'function startToolPoll(channelID){\n' +
'  stopToolPoll();\n' +
'  chatPollTimer=setInterval(function(){\n' +
'    fetch(CHAT_BASE + "/api/toolcall?channelID=" + encodeURIComponent(channelID))\n' +
'      .then(function(r){ return r.json(); })\n' +
'      .then(function(d){\n' +
'        var lb=document.querySelector(".chat-thinking .label");\n' +
'        if(!lb){ stopToolPoll(); return; }\n' +
'        lb.textContent=(d && d.hasTool && d.identity) ? (d.identity + " ") : "";\n' +
'      }).catch(function(){});\n' +
'  },800);\n' +
'}\n' +
'function stopToolPoll(){ if(chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer=null; } }\n' +
'function sendMessage(){\n' +
'  if(chatSending) return;\n' +
'  if(!chatChannelID){ toast("Please select a channel first"); return; }\n' +
'  var inp=document.getElementById("chat-input");\n' +
'  var text=inp.value.trim(); if(!text) return;\n' +
'  inp.value=""; inp.style.height="auto";\n' +
'  appendMessage("user",text);\n' +
'  chatSending=true;\n' +
'  var btn=document.getElementById("chat-send-btn"); btn.disabled=true; btn.textContent="";\n' +
'  var thinkWrap=document.createElement("div"); thinkWrap.className="chat-msg assistant";\n' +
'  var thinkBub=document.createElement("div"); thinkBub.className="chat-bubble chat-thinking";\n' +
'  var thinkLbl=document.createElement("span"); thinkLbl.className="label";\n' +
'  thinkBub.appendChild(thinkLbl);\n' +
'  var d1 = document.createElement("span"); d1.className = "dot"; thinkBub.appendChild(d1);\n' +
'  var d2 = document.createElement("span"); d2.className = "dot"; thinkBub.appendChild(d2);\n' +
'  var d3 = document.createElement("span"); d3.className = "dot"; thinkBub.appendChild(d3);\n' +
'  thinkWrap.appendChild(thinkBub);\n' +
'  var msgsEl=document.getElementById("chat-msgs"); msgsEl.appendChild(thinkWrap); msgsEl.scrollTop=msgsEl.scrollHeight;\n' +
'  startToolPoll(chatChannelID);\n' +
'  fetch(CHAT_BASE + "/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelID:chatChannelID,payload:text})})\n' +
'    .then(function(r){ return r.json(); })\n' +
'    .then(function(d){\n' +
'      stopToolPoll(); if(thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);\n' +
'      chatSending=false; btn.disabled=false; btn.textContent="➤";\n' +
'      if(d && d.response !== undefined) appendMessage("assistant", String(d.response || ""));\n' +
'      else if(d && d.error) toast("API error: " + d.error, 6000);\n' +
'    })\n' +
'    .catch(function(e){\n' +
'      stopToolPoll(); if(thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);\n' +
'      chatSending=false; btn.disabled=false; btn.textContent="➤";\n' +
'      toast("Send failed: " + e.message, 5000);\n' +
'    });\n' +
'}\n' +
'var chatInpEl=document.getElementById("chat-input");\n' +
'chatInpEl.addEventListener("input",function(){ this.style.height="auto"; this.style.height=Math.min(this.scrollHeight,120)+"px"; });\n' +
'chatInpEl.addEventListener("keydown",function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendMessage(); } });\n' +
'loadChats();\n' +
'</script>\n' +
'</body>\n' +
'</html>'
  );
}


export const fn = getWebpageChat;
