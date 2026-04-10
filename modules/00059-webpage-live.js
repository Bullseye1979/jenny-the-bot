/**************************************************************/
/* filename: "00059-webpage-live.js"                                */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/





















import fs   from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getMenuHtml, getDb, getThemeHeadScript } from "../shared/webpage/interface.js";
import { setSendNow, setJsonResp, getIsAllowedRoles } from "../shared/webpage/utils.js";

const MODULE_NAME = "webpage-live";
const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const SHARED_CSS   = path.join(__dirname, "..", "shared", "webpage", "style.css");
const CTX_TABLE    = "context";


function getStr(v)          { return typeof v === "string" ? v : v == null ? "" : String(v); }
function getInt(v, def = 0) { const n = parseInt(v, 10); return isNaN(n) ? def : n; }


function getBasePath(cfg) {
  const bp = getStr(cfg?.basePath ?? "/live").trim();
  return bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/live";
}


function setHtmlResp(wo, html) {
  wo.http.response = {
    status:  200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body:    html
  };
}


function setCssResp(wo, css) {
  wo.http.response = {
    status:  200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
    body:    css
  };
}


function parseContextRow(row) {
  let text   = "";
  let author = "";
  const role = getStr(row.role);
  try {
    const obj = JSON.parse(getStr(row.json) || "{}");
    if (obj?.internal_meta === true) return null;
    if (typeof obj.content === "string" && obj.content) text = obj.content;
    if (typeof obj.authorName === "string" && obj.authorName) author = obj.authorName;
  } catch {}
  if (!text || /^META\|/.test(text)) return null;
  if (!author) author = role === "user" ? "User" : "Bot";
  return {
    ctx_id:  Number(row.ctx_id),
    ts:      getStr(row.ts),
    channel: getStr(row.id),
    role,
    author,
    text
  };
}


function getLiveCss() {
  return `
body{font-size:13px}
.page-wrap{display:flex;flex-direction:column;height:calc(100vh - var(--hh));margin-top:var(--hh)}
.live-layout{display:flex;flex:1;overflow:hidden}
.live-sidebar{width:210px;min-width:160px;background:var(--card);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;padding:10px 12px;gap:14px;overflow-y:auto;transition:width .2s}
.live-sidebar.collapsed{width:32px;min-width:32px;padding:10px 6px}
.live-sidebar.collapsed .live-sidebar-content{display:none}
.live-sidebar.collapsed .live-sidebar-title-text{display:none}
.live-sidebar-header{display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.live-sidebar-title-text{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
#live-sidebar-toggle{background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;padding:0 2px;line-height:1;flex-shrink:0}
#live-sidebar-toggle:hover{color:var(--txt)}
.live-sidebar h3{margin:0 0 5px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
.live-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.live-toolbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--card);border-bottom:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap}
.live-stream{flex:1;overflow-y:auto;padding:6px 12px;display:flex;flex-direction:column;gap:1px}
.live-status{padding:3px 10px;font-size:11px;color:var(--muted);background:var(--bg);border-top:1px solid var(--bdr);flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.live-status.err{color:#f87171}
.msg-row{display:flex;gap:8px;padding:2px 4px;align-items:baseline;border-radius:3px}
.msg-row:hover{background:var(--bg3)}
.msg-ts{font-size:10px;color:var(--muted);flex-shrink:0;white-space:nowrap;font-family:monospace}
.msg-channel{font-size:10px;color:var(--acc);flex-shrink:0;white-space:nowrap;font-family:monospace;opacity:.8}
.msg-author{font-weight:600;flex-shrink:0;white-space:nowrap}
.msg-author.role-user{color:#3b82f6}
.msg-author.role-assistant{color:#10b981}
.msg-text{flex:1;word-break:break-word;white-space:pre-wrap;line-height:1.4;font-size:12px}
.ch-check{display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;cursor:pointer;user-select:none}
.ch-check input{cursor:pointer;flex-shrink:0;accent-color:var(--acc)}
.ch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-family:monospace;font-size:11px}
.ch-cnt{font-size:10px;color:var(--muted);flex-shrink:0}
.field-check{display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;cursor:pointer;user-select:none}
.field-check input{cursor:pointer;accent-color:var(--acc)}
.live-btn{padding:4px 10px;border:1px solid var(--bdr);border-radius:4px;cursor:pointer;font-size:12px;background:var(--bg2);color:var(--txt)}
.live-btn:hover{background:var(--bg3)}
.live-btn.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.live-btn:disabled{opacity:.4;cursor:not-allowed}
.live-select{padding:3px 6px;border:1px solid var(--bdr);border-radius:4px;background:var(--bg2);color:var(--txt);font-size:12px;width:100%}
.ch-all-row{display:flex;gap:5px;margin-bottom:4px}
.ch-all-btn{flex:1;padding:2px 6px;border:1px solid var(--bdr);border-radius:3px;cursor:pointer;font-size:11px;background:var(--bg2);color:var(--muted)}
.ch-all-btn:hover{background:var(--bg3);color:var(--txt)}
`.trim();
}


function getLiveHtml({ menu, role, activePath, base, webAuth, pollIntervalMs, messageLimit }) {
  const menuHtml = getMenuHtml(menu, activePath, role, null, null, webAuth);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>📡 Live Monitor</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${base}/style.css">
</head>
<body>
<header><h1>📡 Live</h1>${menuHtml}</header>
<div class="page-wrap">
  <div class="live-layout">
    <div class="live-sidebar" id="live-sidebar">
      <div class="live-sidebar-header">
        <span class="live-sidebar-title-text">Settings</span>
        <button id="live-sidebar-toggle" onclick="toggleSidebar()">&#9664;</button>
      </div>
      <div class="live-sidebar-content">
        <div>
          <h3>Channels</h3>
          <div class="ch-all-row">
            <button class="ch-all-btn" onclick="selAll(true)">All</button>
            <button class="ch-all-btn" onclick="selAll(false)">None</button>
          </div>
          <div id="channel-list"><span style="color:var(--muted);font-size:11px">Loading…</span></div>
        </div>
        <div>
          <h3>Fields</h3>
          <label class="field-check"><input type="checkbox" id="fld-ts" checked> Timestamp</label>
          <label class="field-check"><input type="checkbox" id="fld-channel"> Channel</label>
          <label class="field-check"><input type="checkbox" id="fld-role"> Role</label>
        </div>
        <div>
          <h3>Poll interval</h3>
          <select id="poll-interval" class="live-select">
            <option value="1000">1 s</option>
            <option value="2000"${pollIntervalMs <= 2000 ? ' selected' : ''}>2 s</option>
            <option value="5000"${pollIntervalMs > 2000 ? ' selected' : ''}>5 s</option>
            <option value="10000">10 s</option>
          </select>
        </div>
        <div>
          <h3>Initial load</h3>
          <select id="init-limit" class="live-select">
            <option value="50">50 messages</option>
            <option value="100" selected>100 messages</option>
            <option value="200">200 messages</option>
            <option value="500">500 messages</option>
          </select>
        </div>
      </div>
    </div>
    <div class="live-main">
      <div class="live-toolbar">
        <button class="live-btn on" id="btn-poll" onclick="togglePoll()">⏸ Pause</button>
        <button class="live-btn on" id="btn-scroll" onclick="toggleScroll()">↓ Autoscroll</button>
        <button class="live-btn" onclick="reloadStream()">↺ Reload</button>
        <button class="live-btn" onclick="clearStream()">🗑 Clear</button>
      </div>
      <div class="live-stream" id="live-stream">
        <div data-empty style="color:var(--muted);padding:8px;font-size:12px">Select channels to start monitoring.</div>
      </div>
      <div class="live-status" id="live-status">Idle</div>
    </div>
  </div>
</div>
<script>
(function() {
'use strict';
var BASE            = ${JSON.stringify(base)};
var DEF_POLL_MS     = ${pollIntervalMs};
var DEF_MSG_LIMIT   = ${messageLimit};
var polling         = true;
var autoScroll      = true;
var pollTimer       = null;
var maxId           = 0;
var totalShown      = 0;
var lastPollAt      = null;

function getSelectedChannels() {
  return Array.from(document.querySelectorAll('#channel-list input[type=checkbox]:checked'))
    .map(function(cb) { return cb.value; });
}
function getShowTs()      { return document.getElementById('fld-ts').checked; }
function getShowChannel() { return document.getElementById('fld-channel').checked; }
function getShowRole()    { return document.getElementById('fld-role').checked; }
function getPollMs()      { return parseInt(document.getElementById('poll-interval').value, 10) || DEF_POLL_MS; }
function getInitLimit()   { return parseInt(document.getElementById('init-limit').value, 10) || 100; }

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTs(ts) {
  if (!ts) return '';
  var s = String(ts);
  var m = s.match(/(\\d{2}:\\d{2}:\\d{2})/);
  return m ? m[1] : s.slice(0, 19).replace('T',' ');
}

function buildMsgEl(msg) {
  var row = document.createElement('div');
  row.className = 'msg-row';
  row.dataset.ts    = msg.ts    || '';
  row.dataset.ctxId = msg.ctx_id || 0;
  if (getShowTs()) {
    var ts = document.createElement('span');
    ts.className = 'msg-ts';
    ts.textContent = formatTs(msg.ts);
    row.appendChild(ts);
  }
  if (getShowChannel()) {
    var ch = document.createElement('span');
    ch.className = 'msg-channel';
    ch.textContent = '#' + msg.channel;
    row.appendChild(ch);
  }
  var author = document.createElement('span');
  author.className = 'msg-author role-' + msg.role;
  var label = msg.author;
  if (getShowRole() && msg.role) label += ' (' + msg.role + ')';
  author.textContent = label + ':';
  row.appendChild(author);
  var text = document.createElement('span');
  text.className = 'msg-text';
  text.textContent = msg.text;
  row.appendChild(text);
  return row;
}

function appendMessages(msgs) {
  var stream = document.getElementById('live-stream');
  var empty = stream.querySelector('[data-empty]');
  if (empty) empty.remove();
  var sorted = msgs.slice().sort(function(a, b) {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    return (a.ctx_id || 0) - (b.ctx_id || 0);
  });
  for (var i = 0; i < sorted.length; i++) {
    var msg = sorted[i];
    var el  = buildMsgEl(msg);
    var children = stream.children;
    var inserted = false;
    for (var j = children.length - 1; j >= 0; j--) {
      var c = children[j];
      if (!c.dataset.ts) continue;
      if (c.dataset.ts < msg.ts || (c.dataset.ts === msg.ts && (parseInt(c.dataset.ctxId, 10) || 0) <= (msg.ctx_id || 0))) {
        c.after(el);
        inserted = true;
        break;
      }
    }
    if (!inserted) stream.insertBefore(el, stream.firstChild);
    totalShown++;
  }
  if (autoScroll && msgs.length) {
    stream.scrollTop = stream.scrollHeight;
  }
}

function setStatus(msg, isErr) {
  var el = document.getElementById('live-status');
  el.textContent = msg;
  el.className = 'live-status' + (isErr ? ' err' : '');
}

async function poll() {
  var sel = getSelectedChannels();
  if (!sel.length) { setStatus('No channels selected.'); return; }
  try {
    var limit = (maxId === 0) ? getInitLimit() : 100;
    var url = BASE + '/api/messages?channels=' + sel.map(encodeURIComponent).join(',')
            + '&afterId=' + maxId + '&limit=' + limit;
    var r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var data = await r.json();
    if (data.error) throw new Error(data.error);
    if (data.messages && data.messages.length) {
      appendMessages(data.messages);
      if (data.maxId > maxId) maxId = data.maxId;
    }
    lastPollAt = new Date();
    setStatus('Live \u00b7 ' + totalShown + ' shown \u00b7 ' + lastPollAt.toTimeString().slice(0,8));
  } catch(e) {
    setStatus('Error: ' + e.message, true);
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!polling) return;
  poll().finally(function() {
    if (polling) pollTimer = setTimeout(schedulePoll, getPollMs());
  });
}

function togglePoll() {
  polling = !polling;
  var btn = document.getElementById('btn-poll');
  if (polling) {
    btn.textContent = '\u23f8 Pause';
    btn.classList.add('on');
    schedulePoll();
  } else {
    clearTimeout(pollTimer);
    btn.textContent = '\u25b6 Resume';
    btn.classList.remove('on');
    setStatus('Paused');
  }
  try { localStorage.setItem('live_polling', polling ? '1' : '0'); } catch {}
}

function toggleScroll() {
  autoScroll = !autoScroll;
  var btn = document.getElementById('btn-scroll');
  if (autoScroll) {
    btn.textContent = '\u2193 Autoscroll';
    btn.classList.add('on');
    var stream = document.getElementById('live-stream');
    stream.scrollTop = stream.scrollHeight;
  } else {
    btn.textContent = '\u2191 Manual';
    btn.classList.remove('on');
  }
  try { localStorage.setItem('live_autoscroll', autoScroll ? '1' : '0'); } catch {}
}

function clearStream() {
  var stream = document.getElementById('live-stream');
  stream.innerHTML = '<div data-empty style="color:var(--muted);padding:8px;font-size:12px">Cleared \u2014 waiting for new messages\u2026</div>';
  totalShown = 0;
  setStatus('Cleared');
}

function reloadStream() {
  maxId = 0; totalShown = 0;
  var stream = document.getElementById('live-stream');
  stream.innerHTML = '';
  if (polling) { clearTimeout(pollTimer); schedulePoll(); }
  else { poll(); }
}

function selAll(checked) {
  document.querySelectorAll('#channel-list input[type=checkbox]').forEach(function(cb) {
    cb.checked = checked;
  });
  reloadStream();
}

function toggleSidebar() {
  var sb  = document.getElementById('live-sidebar');
  var btn = document.getElementById('live-sidebar-toggle');
  var collapsed = sb.classList.toggle('collapsed');
  btn.textContent = collapsed ? '\u25b6' : '\u25c0';
  try { localStorage.setItem('live_sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
}

async function loadChannels() {
  var list = document.getElementById('channel-list');
  try {
    var r = await fetch(BASE + '/api/channels');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var data = await r.json();
    var channels = data.channels || [];
    list.innerHTML = '';
    if (!channels.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:11px">No data in DB.</div>';
      return;
    }
    channels.forEach(function(ch) {
      var label = document.createElement('label');
      label.className = 'ch-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = ch.id;
      cb.addEventListener('change', reloadStream);
      var name = document.createElement('span');
      name.className = 'ch-name'; name.textContent = ch.id; name.title = ch.id;
      var cnt = document.createElement('span');
      cnt.className = 'ch-cnt'; cnt.textContent = ch.cnt;
      label.appendChild(cb); label.appendChild(name); label.appendChild(cnt);
      list.appendChild(label);
    });
  } catch(e) {
    list.innerHTML = '<div style="color:#f87171;font-size:11px">Error: ' + escHtml(e.message) + '</div>';
  }
}

document.getElementById('poll-interval').addEventListener('change', function() {
  if (polling) { clearTimeout(pollTimer); schedulePoll(); }
});

try {
  if (localStorage.getItem('live_polling') === '0') {
    polling = false;
    document.getElementById('btn-poll').textContent = '\u25b6 Resume';
    document.getElementById('btn-poll').classList.remove('on');
  }
  if (localStorage.getItem('live_autoscroll') === '0') {
    autoScroll = false;
    document.getElementById('btn-scroll').textContent = '\u2191 Manual';
    document.getElementById('btn-scroll').classList.remove('on');
  }
  if (localStorage.getItem('live_sidebar_collapsed') === '1') {
    var sbInit = document.getElementById('live-sidebar');
    if (sbInit) {
      sbInit.classList.add('collapsed');
      document.getElementById('live-sidebar-toggle').textContent = '\u25b6';
    }
  }
} catch {}

loadChannels().then(function() {
  if (polling) schedulePoll();
});

window.togglePoll     = togglePoll;
window.toggleScroll   = toggleScroll;
window.clearStream    = clearStream;
window.reloadStream   = reloadStream;
window.selAll         = selAll;
window.toggleSidebar  = toggleSidebar;
})();
</script>
</body></html>`;
}


export default async function getWebpageLive(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3123);
  const basePath     = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : ["admin"];
  const pollMs       = Math.max(500, Number(cfg.pollIntervalMs ?? 2000));
  const msgLimit     = Math.max(10,  Number(cfg.messageLimit   ?? 300));

  if (Number(wo.http?.port) !== port) return coreData;

  const method  = getStr(wo.http?.method).toUpperCase();
  const urlPath = getStr(wo.http?.path);

  if (method === "GET" && urlPath === basePath + "/style.css") {
    let sharedCss = "";
    try { sharedCss = fs.readFileSync(SHARED_CSS, "utf-8"); } catch {}
    setCssResp(wo, sharedCss + "\n" + getLiveCss());
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!isAllowed) {
      if (!wo.webAuth?.userId) {
        wo.http.response = { status: 302, headers: { "Location": "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
      } else {
        const menuHtml403 = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
        wo.http.response = {
          status:  403,
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body:    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
                   "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                   "<title>Live</title>" + getThemeHeadScript() +
                   "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
                   "<header><h1>\uD83D\uDCE1 Live</h1>" + menuHtml403 + "</header>" +
                   "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
                   "<div style=\"text-align:center;color:var(--txt)\">" +
                   "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
                   "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
                   "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">Go to home</a>" +
                   "</div></div></body></html>"
        };
      }
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    setHtmlResp(wo, getLiveHtml({
      menu:           wo.web?.menu || [],
      role:           wo.webAuth?.role || "",
      activePath:     urlPath,
      base:           basePath,
      webAuth:        wo.webAuth,
      pollIntervalMs: pollMs,
      messageLimit:   msgLimit
    }));
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/channels") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }
    try {
      const pool = await getDb(coreData);
      const [rows] = await pool.execute(
        `SELECT id, COUNT(*) AS cnt FROM ${CTX_TABLE} GROUP BY id ORDER BY id ASC`
      );
      setJsonResp(wo, 200, { channels: rows.map(r => ({ id: getStr(r.id), cnt: Number(r.cnt) })) });
    } catch (e) {
      setJsonResp(wo, 500, { error: getStr(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/messages") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }
    try {
      const rawUrl   = getStr(wo.http?.url ?? "");
      const urlObj   = new URL(rawUrl, "http://localhost");
      const chanRaw  = getStr(urlObj.searchParams.get("channels") || "").trim();
      const afterId  = Math.max(0, getInt(urlObj.searchParams.get("afterId"), 0));
      const limit    = Math.min(msgLimit, Math.max(1, getInt(urlObj.searchParams.get("limit"), 100)));

      const channels = chanRaw.split(",").map(s => s.trim()).filter(Boolean);
      if (!channels.length) { setJsonResp(wo, 400, { error: "channels required" }); wo.jump = true; await setSendNow(wo); return coreData; }

      const pool = await getDb(coreData);
      const ph   = channels.map(() => "?").join(",");

      let rows;
      if (afterId === 0) {
        const [r] = await pool.execute(
          `SELECT * FROM (
             SELECT ctx_id, ts, id, role, text, \`json\`
               FROM ${CTX_TABLE}
              WHERE id IN (${ph})
                AND role IN ('user','assistant')
              ORDER BY ctx_id DESC
              LIMIT ?
           ) sub ORDER BY ctx_id ASC`,
          [...channels, limit]
        );
        rows = r;
      } else {
        const [r] = await pool.execute(
          `SELECT ctx_id, ts, id, role, text, \`json\`
             FROM ${CTX_TABLE}
            WHERE ctx_id > ?
              AND id IN (${ph})
              AND role IN ('user','assistant')
            ORDER BY ctx_id ASC
            LIMIT ?`,
          [afterId, ...channels, limit]
        );
        rows = r;
      }

      const messages = rows.map(parseContextRow).filter(Boolean);
      const maxIdOut = messages.length ? messages[messages.length - 1].ctx_id : afterId;
      setJsonResp(wo, 200, { messages, maxId: maxIdOut });
    } catch (e) {
      setJsonResp(wo, 500, { error: getStr(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}

export const fn = getWebpageLive;
