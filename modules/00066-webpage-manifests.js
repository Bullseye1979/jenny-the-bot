
















import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setSendNow, setJsonResp } from "../shared/webpage/utils.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-manifests";

const MANIFESTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../manifests");


function getStr(v, fb = "") {
  return (v != null && typeof v === "string") ? v : fb;
}


function getBasePath(cfg) {
  const bp = getStr(cfg.basePath ?? "/manifests").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/manifests";
}


function buildPageHtml(menu, basePath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manifest Editor</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="/dashboard/style.css">
<style>
  .me-layout {
    display: flex;
    gap: 0;
    height: calc(100vh - var(--hh, 52px));
    overflow: hidden;
  }
  .me-sidebar {
    width: 240px;
    min-width: 180px;
    max-width: 320px;
    flex-shrink: 0;
    background: var(--bg2);
    border-right: 1px solid var(--bdr);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .me-sidebar-header {
    padding: .6rem .85rem;
    font-size: .75rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
    border-bottom: 1px solid var(--bdr);
    flex-shrink: 0;
  }
  .me-list {
    list-style: none;
    margin: 0;
    padding: .3rem 0;
    overflow-y: auto;
    flex: 1;
  }
  .me-list li {
    padding: .38rem .85rem;
    cursor: pointer;
    font-family: monospace;
    font-size: .82rem;
    color: var(--txt);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 3px solid transparent;
    transition: background .12s, border-color .12s;
  }
  .me-list li:hover { background: var(--bg3); }
  .me-list li.active {
    background: var(--bg3);
    border-left-color: var(--acc);
    color: var(--acc);
    font-weight: 600;
  }
  .me-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }
  .me-toolbar {
    display: flex;
    align-items: center;
    gap: .5rem;
    padding: .55rem .9rem;
    border-bottom: 1px solid var(--bdr);
    background: var(--bg2);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .me-toolbar-name {
    font-family: monospace;
    font-size: .9rem;
    font-weight: 600;
    color: var(--txt);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .me-btn {
    padding: .35rem .85rem;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: .82rem;
    white-space: nowrap;
  }
  .me-btn:disabled { opacity: .45; cursor: default; }
  .me-btn-primary { background: var(--acc); color: #fff; }
  .me-btn-secondary { background: var(--bg3); color: var(--txt); border: 1px solid var(--bdr); }
  .me-btn-ok { background: rgba(16,185,129,.15); color: var(--ok, #10b981); border: 1px solid var(--ok, #10b981); }
  .me-editor-wrap {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  .me-editor {
    width: 100%;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    padding: 1rem;
    font-family: "Cascadia Code", "Fira Code", "Consolas", monospace;
    font-size: .83rem;
    line-height: 1.55;
    background: var(--bg);
    color: var(--txt);
    box-sizing: border-box;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
  .me-editor:focus { outline: none; }
  .me-msg {
    padding: .38rem .85rem;
    font-size: .82rem;
    border-top: 1px solid var(--bdr);
    flex-shrink: 0;
    min-height: 2rem;
    display: flex;
    align-items: center;
    gap: .4rem;
  }
  .me-msg.ok  { color: var(--ok, #10b981); background: rgba(16,185,129,.08); }
  .me-msg.err { color: var(--dan); background: rgba(239,68,68,.08); }
  .me-msg.idle { color: var(--muted); }
  .me-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: .9rem;
  }
  .me-validate-badge {
    font-size: .75rem;
    padding: .15rem .45rem;
    border-radius: 3px;
    font-family: monospace;
  }
  .me-validate-ok  { background: rgba(16,185,129,.15); color: var(--ok, #10b981); }
  .me-validate-err { background: rgba(239,68,68,.12); color: var(--dan); }
  @media (max-width: 600px) {
    .me-sidebar { width: 160px; }
    .me-editor { font-size: .78rem; }
  }
  body { overflow: hidden; }
</style>
</head>
<body>
<header>
  <h1>&#128196; Manifest Editor</h1>
  ${menu}
</header>
<div class="me-layout">
  <aside class="me-sidebar">
    <div class="me-sidebar-header">Manifests</div>
    <ul class="me-list" id="manifest-list">
      <li style="color:var(--muted);font-family:sans-serif;font-size:.8rem;padding:.6rem .85rem">Loading…</li>
    </ul>
  </aside>
  <div class="me-main" id="me-main">
    <div class="me-placeholder" id="me-placeholder">
      <span>&#8592; Select a manifest to edit</span>
    </div>
    <div id="me-editor-panel" style="display:none;flex:1;flex-direction:column;overflow:hidden;display:none">
      <div class="me-toolbar">
        <span class="me-toolbar-name" id="me-current-name"></span>
        <span class="me-validate-badge" id="me-validate-badge" style="display:none"></span>
        <button class="me-btn me-btn-secondary" id="me-format-btn" onclick="formatJson()" disabled>Pretty-print</button>
        <button class="me-btn me-btn-primary" id="me-save-btn" onclick="saveManifest()" disabled>Save</button>
      </div>
      <div class="me-editor-wrap">
        <textarea class="me-editor" id="me-editor" spellcheck="false" oninput="onEditorInput()"></textarea>
      </div>
      <div class="me-msg idle" id="me-msg">Ready</div>
    </div>
  </div>
</div>

<script>
const BASE = ${JSON.stringify(basePath)};
let currentName = null;
let savedContent = null;

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadList() {
  const res = await fetch(BASE + "/api/list");
  const data = await res.json();
  const ul = document.getElementById("manifest-list");
  if (!data.ok || !Array.isArray(data.names) || !data.names.length) {
    ul.innerHTML = '<li style="color:var(--muted);font-family:sans-serif;font-size:.8rem;padding:.6rem .85rem">No manifests found.</li>';
    return;
  }
  ul.innerHTML = data.names.map(n =>
    \`<li onclick="selectManifest(\${escHtml(JSON.stringify(n))})" id="item-\${escHtml(n)}">\${escHtml(n)}</li>\`
  ).join("");
}

async function selectManifest(name) {
  if (currentName === name) return;
  if (currentName !== null && isDirty()) {
    if (!confirm("You have unsaved changes in '" + currentName + "'. Discard them?")) return;
  }
  setActiveItem(name);
  currentName = name;
  document.getElementById("me-placeholder").style.display = "none";
  const panel = document.getElementById("me-editor-panel");
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.overflow = "hidden";
  panel.style.flex = "1";
  document.getElementById("me-current-name").textContent = name + ".json";
  document.getElementById("me-save-btn").disabled = true;
  document.getElementById("me-format-btn").disabled = true;
  setMsg("Loading…", "idle");

  try {
    const res = await fetch(BASE + "/api/get?name=" + encodeURIComponent(name));
    const data = await res.json();
    if (!data.ok) { setMsg("Error: " + (data.error || "failed to load"), "err"); return; }
    const pretty = tryPretty(data.content);
    document.getElementById("me-editor").value = pretty;
    savedContent = pretty;
    updateValidateBadge(pretty);
    document.getElementById("me-save-btn").disabled = false;
    document.getElementById("me-format-btn").disabled = false;
    setMsg("Loaded " + name + ".json", "ok");
  } catch (e) {
    setMsg("Network error: " + e.message, "err");
  }
}

function setActiveItem(name) {
  document.querySelectorAll(".me-list li").forEach(li => li.classList.remove("active"));
  const el = document.getElementById("item-" + name);
  if (el) el.classList.add("active");
}

function isDirty() {
  return document.getElementById("me-editor").value !== savedContent;
}

function tryPretty(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

function onEditorInput() {
  updateValidateBadge(document.getElementById("me-editor").value);
}

function updateValidateBadge(text) {
  const badge = document.getElementById("me-validate-badge");
  badge.style.display = "";
  try {
    JSON.parse(text);
    badge.className = "me-validate-badge me-validate-ok";
    badge.textContent = "✓ valid JSON";
  } catch (e) {
    badge.className = "me-validate-badge me-validate-err";
    badge.textContent = "✗ " + e.message.split("\\n")[0].slice(0, 60);
  }
}

function formatJson() {
  const ta = document.getElementById("me-editor");
  const pretty = tryPretty(ta.value);
  if (pretty === ta.value) return;
  ta.value = pretty;
  updateValidateBadge(pretty);
}

async function saveManifest() {
  if (!currentName) return;
  const content = document.getElementById("me-editor").value;
  try {
    JSON.parse(content);
  } catch (e) {
    setMsg("Cannot save — invalid JSON: " + e.message.split("\\n")[0].slice(0, 80), "err");
    return;
  }
  const btn = document.getElementById("me-save-btn");
  btn.disabled = true;
  setMsg("Saving…", "idle");
  try {
    const res = await fetch(BASE + "/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentName, content })
    });
    const data = await res.json();
    if (data.ok) {
      savedContent = content;
      setMsg("Saved " + currentName + ".json", "ok");
    } else {
      setMsg("Error: " + (data.error || "unknown"), "err");
    }
  } catch (e) {
    setMsg("Network error: " + e.message, "err");
  }
  btn.disabled = false;
}

function setMsg(text, type) {
  const el = document.getElementById("me-msg");
  el.className = "me-msg " + (type || "idle");
  el.textContent = text;
}

window.addEventListener("beforeunload", e => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

loadList();
</script>
</body>
</html>`;
}


export default async function getWebpageManifests(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3126);
  const basePath     = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : ["admin"];

  if (Number(wo.http?.port) !== port) return coreData;

  const url     = getStr(wo.http?.url || "/");
  const method  = getStr(wo.http?.method || "GET").toUpperCase();
  const urlPath = url.split("?")[0];

  if (!urlPath.startsWith(basePath)) return coreData;

  if (!getIsAllowedRoles(wo, allowedRoles)) {
    if (!wo.webAuth?.userId) {
      wo.http.response = { status: 302, headers: { "Location": "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
    } else if (urlPath.startsWith(basePath + "/api/")) {
      setJsonResp(wo, 403, { error: "forbidden" });
    } else {
      const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
      wo.http.response = {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
              "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
              "<title>Manifest Editor</title>" + getThemeHeadScript() +
              "<link rel=\"stylesheet\" href=\"/dashboard/style.css\"></head><body>" +
              "<header><h1>\uD83D\uDCC4 Manifest Editor</h1>" + menuHtml + "</header>" +
              "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
              "<div style=\"text-align:center;color:var(--txt)\">" +
              "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
              "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
              "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">&#8592; Back to home</a>" +
              "</div></div></body></html>"
      };
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    try {
      const files = await readdir(MANIFESTS_DIR);
      const names = files
        .filter(f => f.endsWith(".json"))
        .map(f => f.slice(0, -5))
        .sort((a, b) => a.localeCompare(b));
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true, names })
      };
    } catch (err) {
      log("list error", err?.message);
      wo.http.response = {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, error: String(err?.message || err) })
      };
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/get") {
    try {
      const params   = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
      const name     = getStr(params.get("name")).trim();
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        wo.http.response = {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ok: false, error: "Invalid manifest name" })
        };
        wo.jump = true;
        return coreData;
      }
      const filePath = join(MANIFESTS_DIR, name + ".json");
      const raw      = await readFile(filePath, "utf-8");
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true, name, content: raw })
      };
    } catch (err) {
      log("get error", err?.message);
      const notFound = err?.code === "ENOENT";
      wo.http.response = {
        status: notFound ? 404 : 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, error: notFound ? "Manifest not found" : String(err?.message || err) })
      };
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/save") {
    try {
      const body    = wo.http?.json || {};
      const name    = getStr(body.name).trim();
      const content = getStr(body.content);
      if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        wo.http.response = {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ok: false, error: "Invalid manifest name" })
        };
        wo.jump = true;
        return coreData;
      }
      try {
        JSON.parse(content);
      } catch (parseErr) {
        wo.http.response = {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ok: false, error: "Invalid JSON: " + String(parseErr?.message || parseErr) })
        };
        wo.jump = true;
        return coreData;
      }
      const filePath = join(MANIFESTS_DIR, name + ".json");
      await writeFile(filePath, content, "utf-8");
      log("saved manifest", name);
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true })
      };
    } catch (err) {
      log("save error", err?.message);
      wo.http.response = {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, error: String(err?.message || err) })
      };
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "GET" && urlPath === basePath) {
    try {
      const menuItems = Array.isArray(wo.web?.menu) ? wo.web.menu : [];
      const role      = String(wo.webAuth?.role || "").toLowerCase();
      const menu      = getMenuHtml(menuItems, basePath, role, null, null, wo.webAuth);
      const html      = buildPageHtml(menu, basePath);
      wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html };
    } catch (err) {
      log("page build error", err?.message);
      wo.http.response = { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Error: " + String(err?.message || err) };
    }
    wo.jump = true;
    return coreData;
  }

  return coreData;
}
