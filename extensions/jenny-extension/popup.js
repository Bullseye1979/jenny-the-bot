/* popup.js — Jenny Bot browser extension */
"use strict";

/* ============================================================
   Settings (loaded from chrome.storage)
   ============================================================ */
var cfg = { apiUrl: "", channelID: "", apiSecret: "" };
var messages = [];
var sending   = false;
var pollTimer = null;

/* ============================================================
   Markdown renderer  (no external dependencies, XSS-safe)
   ============================================================ */
function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function safeUrl(u) {
  try { var p = new URL(u); return (p.protocol==="https:"||p.protocol==="http:") ? u : ""; }
  catch(e) { return ""; }
}

function mdInline(s) {
  /* s is already HTML-escaped — apply markdown on top */
  /* Extract links into placeholders first to prevent bold/italic patterns
     from corrupting HTML attributes (e.g. target="_blank"). */
  var ls = [], li = 0;
  function lph(h) { var k = "\x00L" + (li++) + "\x00"; ls.push({ k: k, v: h }); return k; }
  /* markdown links [text](url) */
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, t, u) {
    var su = safeUrl(u);
    if (!su) return escHtml(t);
    return lph("<a href=\"" + escHtml(su) + "\" data-url=\"" + escHtml(su) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + t + "</a>");
  });
  /* auto-link bare URLs */
  s = s.replace(/(https?:\/\/[^\s<>"']+)/g, function(_, u) {
    var su = safeUrl(u);
    if (!su) return _;
    return lph("<a href=\"" + escHtml(su) + "\" data-url=\"" + escHtml(su) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + escHtml(u) + "</a>");
  });
  /* bold, italic */
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g,   "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g,       "<em>$1</em>");
  s = s.replace(/__([^_]+)__/g,       "<strong>$1</strong>");
  s = s.replace(/_([^_]+)_/g,         "<em>$1</em>");
  /* restore link placeholders */
  for (var i = 0; i < ls.length; i++) s = s.split(ls[i].k).join(ls[i].v);
  return s;
}

function renderMarkdown(raw) {
  var blocks = [];
  /* extract fenced code blocks */
  var text = raw.replace(/```([^\n]*)\n([\s\S]*?)```/g, function(_, lang, code) {
    var idx = blocks.length;
    blocks.push("<pre><code>" + escHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return "\x00B" + idx + "\x00";
  });
  /* extract inline code */
  text = text.replace(/`([^`]+)`/g, function(_, code) {
    var idx = blocks.length;
    blocks.push("<code>" + escHtml(code) + "</code>");
    return "\x00B" + idx + "\x00";
  });

  var lines   = text.split("\n");
  var out     = [];
  var listBuf = [];
  var listTag = "";

  function flushList() {
    if (!listBuf.length) return;
    out.push("<" + listTag + ">");
    listBuf.forEach(function(li) { out.push("<li>" + mdInline(escHtml(li)) + "</li>"); });
    out.push("</" + listTag + ">");
    listBuf = []; listTag = "";
  }

  lines.forEach(function(line) {
    /* headers */
    var hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) { flushList(); var hl = hm[1].length; out.push("<h" + hl + ">" + mdInline(escHtml(hm[2])) + "</h" + hl + ">"); return; }

    /* blockquote */
    if (/^>\s?/.test(line)) { flushList(); out.push("<blockquote>" + mdInline(escHtml(line.replace(/^>\s?/,""))) + "</blockquote>"); return; }

    /* hr */
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushList(); out.push("<hr>"); return; }

    /* unordered list */
    var ulm = line.match(/^[\*\-]\s+(.*)/);
    if (ulm) { if (listTag !== "ul") { flushList(); listTag = "ul"; } listBuf.push(ulm[1]); return; }

    /* ordered list */
    var olm = line.match(/^\d+\.\s+(.*)/);
    if (olm) { if (listTag !== "ol") { flushList(); listTag = "ol"; } listBuf.push(olm[1]); return; }

    flushList();
    if (line.trim() === "") { out.push(""); return; }
    out.push("<p>" + mdInline(escHtml(line)) + "</p>");
  });
  flushList();

  var html = out.join("\n");

  /* restore code blocks */
  html = html.replace(/\x00B(\d+)\x00/g, function(_, i) { return blocks[parseInt(i, 10)]; });

  return html;
}

function injectEmbeds(el) {
  var links = el.querySelectorAll("a[data-url]");
  links.forEach(function(a) {
    var u = a.getAttribute("data-url") || "";
    var wrap = document.createElement("div");
    wrap.className = "embed";

    /* YouTube */
    var ytm = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytm) {
      var ifr = document.createElement("iframe");
      ifr.src = "https://www.youtube.com/embed/" + ytm[1];
      ifr.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      ifr.allowFullscreen = true;
      wrap.appendChild(ifr); a.insertAdjacentElement("afterend", wrap); return;
    }

    /* Vimeo */
    var vim = u.match(/vimeo\.com\/(\d+)/);
    if (vim) {
      var ifr2 = document.createElement("iframe");
      ifr2.src = "https://player.vimeo.com/video/" + vim[1];
      ifr2.allow = "autoplay; fullscreen; picture-in-picture";
      wrap.appendChild(ifr2); a.insertAdjacentElement("afterend", wrap); return;
    }

    /* Video file */
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) {
      var vid = document.createElement("video");
      vid.src = u; vid.controls = true;
      wrap.appendChild(vid); a.insertAdjacentElement("afterend", wrap); return;
    }

    /* Image */
    if (/\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(u)) {
      var img = document.createElement("img");
      img.src = u; img.className = "chat-img"; img.alt = "";
      img.onclick = function() { window.open(u, "_blank"); };
      img.onerror = function() { if (this.parentNode) this.parentNode.removeChild(this); };
      a.insertAdjacentElement("afterend", img); return;
    }
  });
}

/* ============================================================
   DOM helpers
   ============================================================ */
function buildBubble(role, text) {
  var wrap = document.createElement("div");
  wrap.className = "msg " + role;
  var bub = document.createElement("div");
  bub.className = "bubble";
  bub.innerHTML = renderMarkdown(text);
  injectEmbeds(bub);
  wrap.appendChild(bub);
  return wrap;
}

function appendMsg(role, text) {
  messages.push({ role: role, text: text });
  var el = buildBubble(role, text);
  var msgsEl = document.getElementById("msgs");
  msgsEl.appendChild(el);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function renderEmpty() {
  var msgsEl = document.getElementById("msgs");
  if (!messages.length) {
    msgsEl.innerHTML = "<div class=\"empty\">Start a conversation or click <strong>Summarize</strong> to summarize this page.</div>";
  }
}

/* ============================================================
   Toolcall polling
   ============================================================ */
function startPoll() {
  stopPoll();
  if (!cfg.apiUrl) return;
  var toolcallUrl = cfg.apiUrl.replace(/\/api\/?$/, "/toolcall");
  pollTimer = setInterval(function() {
    var headers = {};
    if (cfg.apiSecret) headers["Authorization"] = "Bearer " + cfg.apiSecret;
    fetch(toolcallUrl, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var lb = document.querySelector(".thinking .label");
        if (!lb) { stopPoll(); return; }
        lb.textContent = (d.hasTool && d.identity) ? d.identity + "\u2009" : "";
      }).catch(function() {});
  }, 800);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ============================================================
   Send message
   ============================================================ */
function sendMessage(payload) {
  if (sending || !payload.trim()) return;
  if (!cfg.apiUrl || !cfg.channelID) {
    alert("Please configure the API URL and Channel ID in the extension settings.");
    return;
  }

  sending = true;
  var sendBtn = document.getElementById("send-btn");
  sendBtn.disabled = true;

  /* Build thinking indicator */
  var thinkWrap = document.createElement("div");
  thinkWrap.className = "msg assistant";
  var thinkBub = document.createElement("div");
  thinkBub.className = "bubble thinking";
  var lbSpan = document.createElement("span");
  lbSpan.className = "label";
  thinkBub.appendChild(lbSpan);
  for (var i = 0; i < 3; i++) thinkBub.appendChild(document.createElement("span"));
  thinkWrap.appendChild(thinkBub);
  var msgsEl = document.getElementById("msgs");
  /* Remove empty placeholder if present */
  var emptyEl = msgsEl.querySelector(".empty");
  if (emptyEl) emptyEl.remove();
  msgsEl.appendChild(thinkWrap);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  startPoll();

  var reqHeaders = { "Content-Type": "application/json" };
  if (cfg.apiSecret) reqHeaders["Authorization"] = "Bearer " + cfg.apiSecret;

  fetch(cfg.apiUrl, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify({ channelID: cfg.channelID, payload: payload })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    stopPoll();
    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);
    sending = false;
    sendBtn.disabled = false;
    if (d && d.response !== undefined) appendMsg("assistant", String(d.response || ""));
    else if (d && d.error) appendMsg("assistant", "\u26a0\ufe0f Error: " + d.error);
    else appendMsg("assistant", "\u26a0\ufe0f Unexpected response");
  })
  .catch(function(e) {
    stopPoll();
    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);
    sending = false;
    sendBtn.disabled = false;
    appendMsg("assistant", "\u26a0\ufe0f Send failed: " + e.message);
  });
}

/* ============================================================
   Summarize current tab
   ============================================================ */
function summarizePage() {
  /* chrome.tabs.query({ active, currentWindow/lastFocusedWindow }) is unreliable in side panels:
     from Chrome 117 the side panel runs in its own window, so both currentWindow and
     lastFocusedWindow may resolve to the panel window (which has no tabs).
     chrome.windows.getLastFocused with windowTypes:["normal"] explicitly targets the
     last focused normal browser window, reliably returning the active page tab. */
  chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] }, function(win) {
    var tab = win && Array.isArray(win.tabs) && win.tabs.find(function(t) { return t.active; });
    if (!tab || !tab.url) { appendMsg("assistant", "\u26a0\ufe0f Could not get current tab URL."); return; }
    var url = tab.url;
    var isYT = /youtube\.com\/watch|youtu\.be\//.test(url);
    var task = isYT
      ? "Please summarize this YouTube video: " + url
      : "Please summarize the content of this web page: " + url;
    appendMsg("user", task);
    sendMessage(task);
  });
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  chrome.storage.sync.get(["apiUrl", "channelID", "apiSecret"], function(stored) {
    cfg.apiUrl    = stored.apiUrl    || "";
    cfg.channelID = stored.channelID || "";
    cfg.apiSecret = stored.apiSecret || "";

    if (!cfg.apiUrl || !cfg.channelID) {
      document.getElementById("config-warn").classList.remove("hidden");
    }

    renderEmpty();

    /* Wire up settings link in warning */
    document.getElementById("open-options").addEventListener("click", function() {
      chrome.runtime.openOptionsPage();
    });

    /* Options button */
    document.getElementById("options-btn").addEventListener("click", function() {
      chrome.runtime.openOptionsPage();
    });

    /* Summarize button */
    document.getElementById("summarize-btn").addEventListener("click", function() {
      if (sending) return;
      summarizePage();
    });

    /* Send on button click */
    document.getElementById("send-btn").addEventListener("click", function() {
      var inp = document.getElementById("input");
      var text = inp.value.trim();
      if (!text) return;
      appendMsg("user", text);
      inp.value = "";
      inp.style.height = "";
      sendMessage(text);
    });

    /* Send on Enter (Shift+Enter = newline) */
    document.getElementById("input").addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("send-btn").click();
      }
    });

    /* Auto-grow textarea */
    document.getElementById("input").addEventListener("input", function() {
      this.style.height = "";
      this.style.height = Math.min(this.scrollHeight, 100) + "px";
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
