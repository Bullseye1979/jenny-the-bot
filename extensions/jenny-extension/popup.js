/* popup.js — Jenny Bot browser extension */
"use strict";

var cfg = { apiUrl: "", channelId: "", apiSecret: "", webBaseUrl: "" };
var webSession = null;
var messages = [];
var sending   = false;
var pollTimer = null;
var pendingFile = null;
var lastAssistantTimer = null;
var lastAssistantTs = null;
var LAST_ASSISTANT_INTERVAL_MS = 2000;

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function safeUrl(u) {
  try { var p = new URL(u); return (p.protocol==="https:"||p.protocol==="http:") ? u : ""; }
  catch(e) { return ""; }
}

function mdInline(s) {
  var ls = [], li = 0;
  function lph(h) { var k = "\x00L" + (li++) + "\x00"; ls.push({ k: k, v: h }); return k; }
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, t, u) {
    var su = safeUrl(u);
    if (!su) return escHtml(t);
    return lph("<a href=\"" + escHtml(su) + "\" data-url=\"" + escHtml(su) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + t + "</a>");
  });
  s = s.replace(/(https?:\/\/[^\s<>"']+)/g, function(_, u) {
    var su = safeUrl(u);
    if (!su) return _;
    return lph("<a href=\"" + escHtml(su) + "\" data-url=\"" + escHtml(su) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + escHtml(u) + "</a>");
  });
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g,   "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g,       "<em>$1</em>");
  s = s.replace(/__([^_]+)__/g,       "<strong>$1</strong>");
  s = s.replace(/_([^_]+)_/g,         "<em>$1</em>");
  for (var i = 0; i < ls.length; i++) s = s.split(ls[i].k).join(ls[i].v);
  return s;
}

function renderMarkdown(raw) {
  var blocks = [];
  var text = raw.replace(/```([^\n]*)\n([\s\S]*?)```/g, function(_, lang, code) {
    var idx = blocks.length;
    blocks.push("<pre><code>" + escHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return "\x00B" + idx + "\x00";
  });
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
    var hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) { flushList(); var hl = hm[1].length; out.push("<h" + hl + ">" + mdInline(escHtml(hm[2])) + "</h" + hl + ">"); return; }

    if (/^>\s?/.test(line)) { flushList(); out.push("<blockquote>" + mdInline(escHtml(line.replace(/^>\s?/,""))) + "</blockquote>"); return; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushList(); out.push("<hr>"); return; }

    var ulm = line.match(/^[\*\-]\s+(.*)/);
    if (ulm) { if (listTag !== "ul") { flushList(); listTag = "ul"; } listBuf.push(ulm[1]); return; }

    var olm = line.match(/^\d+\.\s+(.*)/);
    if (olm) { if (listTag !== "ol") { flushList(); listTag = "ol"; } listBuf.push(olm[1]); return; }

    flushList();
    if (line.trim() === "") { out.push(""); return; }
    out.push("<p>" + mdInline(escHtml(line)) + "</p>");
  });
  flushList();

  var html = out.join("\n");
  html = html.replace(/\x00B(\d+)\x00/g, function(_, i) { return blocks[parseInt(i, 10)]; });
  return html;
}

function injectEmbeds(el) {
  var links = el.querySelectorAll("a[data-url]");
  links.forEach(function(a) {
    var u = a.getAttribute("data-url") || "";
    var wrap = document.createElement("div");
    wrap.className = "embed";

    var ytm = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytm) {
      var ifr = document.createElement("iframe");
      ifr.src = "https://www.youtube.com/embed/" + ytm[1];
      ifr.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      ifr.allowFullscreen = true;
      wrap.appendChild(ifr); a.insertAdjacentElement("afterend", wrap); return;
    }

    var vim = u.match(/vimeo\.com\/(\d+)/);
    if (vim) {
      var ifr2 = document.createElement("iframe");
      ifr2.src = "https://player.vimeo.com/video/" + vim[1];
      ifr2.allow = "autoplay; fullscreen; picture-in-picture";
      wrap.appendChild(ifr2); a.insertAdjacentElement("afterend", wrap); return;
    }

    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) {
      var vid = document.createElement("video");
      vid.src = u; vid.controls = true;
      wrap.appendChild(vid); a.insertAdjacentElement("afterend", wrap); return;
    }

    if (/\.(jpe?g|png|gif|webp|svg|avif)(\?|$)/i.test(u)) {
      var img = document.createElement("img");
      img.src = u; img.className = "chat-img"; img.alt = "";
      img.onclick = function() { window.open(u, "_blank"); };
      img.onerror = function() { if (this.parentNode) this.parentNode.removeChild(this); };
      a.insertAdjacentElement("afterend", img); return;
    }
  });
}

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

function startPoll() {
  stopPoll();
  if (!cfg.apiUrl) return;
  var toolcallUrl = cfg.apiUrl.replace(/\/api\/?$/, "/toolcall");
  if (cfg.channelId) toolcallUrl += "?channelId=" + encodeURIComponent(cfg.channelId);
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

function startLastAssistantPoll() {
  stopLastAssistantPoll();
  if (!cfg.apiUrl || !cfg.channelId) return;
  var baseUrl = cfg.apiUrl.replace(/\/api\/?$/, "");
  var url = baseUrl + "/context/last-assistant?channelId=" + encodeURIComponent(cfg.channelId);
  lastAssistantTimer = setInterval(function() {
    var headers = {};
    if (cfg.apiSecret) headers["Authorization"] = "Bearer " + cfg.apiSecret;
    fetch(url, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var msg = d && d.ok && d.message ? d.message : null;
        if (!msg || msg.role !== "assistant") return;
        var ts = msg.ts || null;
        if (!ts || ts === lastAssistantTs) return;
        lastAssistantTs = ts;
        var raw = String(msg.text || "").split("\n").filter(function(l) { return !/^META\|/.test(l.trim()); }).join("\n").trim();
        if (!raw) return;
        appendMsg("assistant", raw);
        var msgsEl = document.getElementById("msgs");
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      }).catch(function() {});
  }, LAST_ASSISTANT_INTERVAL_MS);
}

function stopLastAssistantPoll() {
  if (lastAssistantTimer) { clearInterval(lastAssistantTimer); lastAssistantTimer = null; }
}

function getUploadUrl() {
  return cfg.apiUrl.replace(/\/api\/?$/, "/upload");
}

function doRegularUpload(file) {
  var url = getUploadUrl();
  var headers = { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name };
  if (cfg.apiSecret) headers["Authorization"] = "Bearer " + cfg.apiSecret;
  return fetch(url, { method: "POST", headers: headers, body: file })
    .then(function(r) { return r.json(); });
}

function uploadFile(file) {
  var ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  var isImage = /\.(png|jpe?g|gif|webp|avif)$/.test(ext);
  if (cfg.webBaseUrl && isImage) {
    return fetch(cfg.webBaseUrl + "/gallery/api/files", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name },
      body: file
    })
    .then(function(r) {
      var ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) throw new Error("gallery_unavailable");
      return r.json();
    })
    .then(function(d) {
      if (d && d.ok && d.url) return d;
      throw new Error("gallery_unavailable");
    })
    .catch(function() { return doRegularUpload(file); });
  }
  return doRegularUpload(file);
}

function clearFilePreview() {
  pendingFile = null;
  var fp = document.getElementById("file-preview");
  if (fp) fp.classList.add("hidden");
  var fi = document.getElementById("file-input");
  if (fi) fi.value = "";
}

function sendMessage(payload) {
  if (sending || (!payload.trim() && !pendingFile)) return;
  if (!cfg.apiUrl || !cfg.channelId) {
    alert("Please configure the API URL and Channel ID in the extension settings.");
    return;
  }

  var fileToUpload = pendingFile;
  pendingFile = null;
  clearFilePreview();

  sending = true;
  var sendBtn = document.getElementById("send-btn");
  sendBtn.disabled = true;

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
  var emptyEl = msgsEl.querySelector(".empty");
  if (emptyEl) emptyEl.remove();
  msgsEl.appendChild(thinkWrap);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  startPoll();

  var uploadPromise = fileToUpload
    ? uploadFile(fileToUpload).then(function(d) {
        if (!d || !d.ok || !d.url) throw new Error(d && d.error ? d.error : "upload_failed");
        return d.url;
      })
    : Promise.resolve(null);

  uploadPromise.then(function(uploadedUrl) {
    var finalPayload = uploadedUrl ? uploadedUrl + "\n" + payload : payload;

    var reqHeaders = { "Content-Type": "application/json" };
    if (cfg.apiSecret) reqHeaders["Authorization"] = "Bearer " + cfg.apiSecret;

    var apiBody = { channelId: cfg.channelId, payload: finalPayload };
    var uid = webSession && webSession.userId ? webSession.userId : "";
    if (uid) apiBody.userId = uid;
    return fetch(cfg.apiUrl, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(apiBody)
    }).then(function(r) { return r.json(); });
  })
  .then(function(d) {
    stopPoll();
    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);
    sending = false;
    sendBtn.disabled = false;
    if (d && d.response !== undefined) {
      var raw = String(d.response || "").split("\n").filter(function(l) { return !/^META\|/.test(l.trim()); }).join("\n").trim();
      appendMsg("assistant", raw);
    } else if (d && d.error) appendMsg("assistant", "\u26a0\ufe0f Error: " + d.error);
    else appendMsg("assistant", "\u26a0\ufe0f Unexpected response");
    startJobPoll();
  })
  .catch(function(e) {
    stopPoll();
    if (thinkWrap.parentNode) thinkWrap.parentNode.removeChild(thinkWrap);
    sending = false;
    sendBtn.disabled = false;
    appendMsg("assistant", "\u26a0\ufe0f " + (e.message || "Send failed"));
  });
}

function summarizePage() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (chrome.runtime.lastError || !tabs || !tabs.length || !tabs[0].url) {
      appendMsg("assistant", "\u26a0\ufe0f Could not get current tab URL.");
      return;
    }
    var url = tabs[0].url;
    var isYT = /youtube\.com\/watch|youtu\.be\//.test(url);
    var task = isYT
      ? "Please summarize this YouTube video: " + url
      : "Please summarize the content of this web page: " + url;
    appendMsg("user", task);
    sendMessage(task);
  });
}

function migrateStorage(callback) {
  chrome.storage.sync.get(["channelID", "channelId"], function(stored) {
    var oldVal = stored["channelID"];
    var newVal = stored["channelId"];
    if (oldVal && !newVal) {
      chrome.storage.sync.set({ channelId: oldVal }, function() {
        chrome.storage.sync.remove("channelID", callback);
      });
    } else {
      callback();
    }
  });
}

function init() {
  migrateStorage(function() {
    chrome.storage.sync.get(["apiUrl", "channelId", "apiSecret", "webBaseUrl"], function(stored) {
      cfg.apiUrl     = stored.apiUrl     || "";
      cfg.channelId  = stored.channelId  || "";
      cfg.apiSecret  = stored.apiSecret  || "";
      cfg.webBaseUrl = (stored.webBaseUrl || "").trim().replace(/\/$/, "");

      if (!cfg.apiUrl || !cfg.channelId) {
        document.getElementById("config-warn").classList.remove("hidden");
      }

      renderEmpty();
      startLastAssistantPoll();

      function setAuthBar(sess) {
        webSession = sess;
        var bar     = document.getElementById("auth-bar");
        var userEl  = document.getElementById("auth-user");
        var loginEl = document.getElementById("auth-login");
        var logoutEl= document.getElementById("auth-logout");
        bar.classList.remove("hidden");
        if (sess) {
          userEl.textContent  = "\uD83D\uDC64 " + (sess.username || sess.userId);
          loginEl.classList.add("hidden");
          logoutEl.classList.remove("hidden");
        } else {
          userEl.textContent  = "Not logged in";
          loginEl.classList.remove("hidden");
          logoutEl.classList.add("hidden");
        }
      }

      if (cfg.webBaseUrl) {
        fetch(cfg.webBaseUrl + "/auth/me", { credentials: "include" })
          .then(function(r) { return r.json(); })
          .then(function(d) { setAuthBar(d && d.ok ? { userId: d.userId, username: d.username, role: d.role } : null); })
          .catch(function()  { setAuthBar(null); });
      }

      document.getElementById("auth-login").addEventListener("click", function(e) {
        e.preventDefault();
        if (cfg.webBaseUrl) chrome.tabs.create({ url: cfg.webBaseUrl + "/auth/login?next=%2F" });
      });
      document.getElementById("auth-logout").addEventListener("click", function(e) {
        e.preventDefault();
        if (cfg.webBaseUrl) {
          fetch(cfg.webBaseUrl + "/auth/logout", { credentials: "include" })
            .then(function() { setAuthBar(null); })
            .catch(function() { setAuthBar(null); });
        }
      });

      document.getElementById("open-options").addEventListener("click", function() {
        chrome.runtime.openOptionsPage();
      });

      document.getElementById("options-btn").addEventListener("click", function() {
        chrome.runtime.openOptionsPage();
      });

      document.getElementById("summarize-btn").addEventListener("click", function() {
        if (sending) return;
        summarizePage();
      });

      document.getElementById("send-btn").addEventListener("click", function() {
        var inp = document.getElementById("input");
        var text = inp.value.trim();
        if (!text && !pendingFile) return;
        var displayText = text;
        if (pendingFile) displayText = (text ? text + "\n" : "") + "[\uD83D\uDCCE " + pendingFile.name + "]";
        appendMsg("user", displayText || "[\uD83D\uDCCE " + pendingFile.name + "]");
        inp.value = "";
        inp.style.height = "";
        sendMessage(text || "");
      });

      document.getElementById("attach-btn").addEventListener("click", function() {
        document.getElementById("file-input").click();
      });

      document.getElementById("file-input").addEventListener("change", function() {
        var f = this.files && this.files[0];
        if (!f) return;
        pendingFile = f;
        document.getElementById("file-name").textContent = f.name;
        document.getElementById("file-preview").classList.remove("hidden");
      });

      document.getElementById("file-clear").addEventListener("click", function() {
        clearFilePreview();
      });

      var galleryOpen = false;

      function setGalleryStatus(msg, type) {
        var el = document.getElementById("gallery-status");
        el.textContent = msg;
        el.className   = type || "";
        el.classList.remove("hidden");
      }

      function uploadToGallery(file) {
        if (!cfg.webBaseUrl) {
          setGalleryStatus("No Web Base URL configured — open Settings.", "err");
          return;
        }
        var ext = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
        if (!/\.(png|jpe?g|gif|webp|avif)$/.test(ext)) {
          setGalleryStatus("Only image files are supported.", "err");
          return;
        }
        setGalleryStatus("Uploading\u2026");
        fetch(cfg.webBaseUrl + "/gallery/api/files", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": file.name },
          body: file
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.ok) setGalleryStatus("Uploaded: " + d.filename, "ok");
          else           setGalleryStatus("Upload failed: " + (d && d.error || "unknown"), "err");
        })
        .catch(function(e) { setGalleryStatus("Upload failed: " + e.message, "err"); });
      }

      document.getElementById("gallery-btn").addEventListener("click", function() {
        galleryOpen = !galleryOpen;
        var panel = document.getElementById("gallery-panel");
        panel.classList.toggle("hidden", !galleryOpen);
        this.classList.toggle("active", galleryOpen);
        if (galleryOpen) {
          document.getElementById("gallery-status").classList.add("hidden");
        }
      });

      var dropEl = document.getElementById("gallery-drop");
      dropEl.addEventListener("click", function() {
        document.getElementById("gallery-file-input").click();
      });
      document.getElementById("gallery-file-input").addEventListener("change", function() {
        var f = this.files && this.files[0];
        if (f) { uploadToGallery(f); this.value = ""; }
      });
      dropEl.addEventListener("dragover", function(e) {
        e.preventDefault();
        this.classList.add("dragover");
      });
      dropEl.addEventListener("dragleave", function() { this.classList.remove("dragover"); });
      dropEl.addEventListener("drop", function(e) {
        e.preventDefault();
        this.classList.remove("dragover");
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadToGallery(f);
      });

      document.getElementById("input").addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          document.getElementById("send-btn").click();
        }
      });

      document.getElementById("input").addEventListener("input", function() {
        this.style.height = "";
        this.style.height = Math.min(this.scrollHeight, 100) + "px";
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
