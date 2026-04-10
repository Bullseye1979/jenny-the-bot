/**************************************************************/
/* filename: "00058-webpage-keymanager.js"                          */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


















import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setSendNow } from "../shared/webpage/utils.js";
import { getSecret, listSecrets, setSecret, deleteSecret, setEnsureSecretsTable } from "../core/secrets.js";

const MODULE_NAME = "webpage-keymanager";


function getStr(v, fb = "") {
  return (v != null && typeof v === "string") ? v : fb;
}


function getBasePath(cfg) {
  const bp = getStr(cfg.basePath ?? "/key-manager").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/key-manager";
}


function buildPageHtml(menu, basePath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Key Manager</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="/dashboard/style.css">
<style>
  .km-table { width:100%; border-collapse:collapse; margin-top:1rem; table-layout:fixed; }
  .km-table th, .km-table td { padding:.5rem .75rem; border:1px solid var(--bdr); text-align:left; vertical-align:top; overflow:hidden; }
  .km-table th { background:var(--bg3); font-weight:600; white-space:nowrap; }
  .km-table th:first-child { width:60%; }
  .km-table th:last-child  { width:60px; }
  .km-table tr:nth-child(even) td { background:var(--bg3); }
  .km-name { font-family:monospace; font-weight:600; }
  .km-val-row { display:flex; align-items:center; gap:.25rem; margin-top:.3rem; flex-wrap:nowrap; width:100%; }
  .km-val-box { flex:1; overflow:hidden; min-width:0; }
  .km-val-text {
    display:block; font-family:monospace; font-size:.8rem; color:var(--muted);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;
  }
  .km-val-text.revealed { color:var(--txt); }
  .km-icon-btn {
    background:none; border:1px solid var(--bdr); border-radius:4px;
    cursor:pointer; padding:.15rem .3rem; font-size:.95rem; line-height:1.2;
    color:var(--txt); flex-shrink:0;
  }
  .km-icon-btn:hover { background:var(--bg3); }
  .km-icon-danger { color:var(--dan); border-color:var(--dan); }
  .km-icon-danger:hover { background:rgba(239,68,68,.1); }
  .km-actions { white-space:nowrap; vertical-align:middle; text-align:center; width:1%; }
  .km-form { display:grid; gap:.6rem; max-width:560px; margin-top:1.5rem; }
  .km-form label { font-size:.8rem; color:var(--muted); margin-bottom:.1rem; display:block; }
  .km-form input, .km-form textarea {
    width:100%; padding:.5rem .7rem; border-radius:4px;
    border:1px solid var(--bdr);
    background:var(--bg2); color:var(--txt);
    font-family:monospace; font-size:.85rem; box-sizing:border-box;
  }
  .km-form textarea { resize:vertical; min-height:60px; }
  .km-btn { padding:.4rem .9rem; border-radius:4px; border:none; cursor:pointer; font-size:.85rem; }
  .km-btn-primary { background:var(--acc); color:#fff; }
  .km-btn-danger  { background:var(--dan); color:#fff; }
  .km-btn-muted   { background:var(--bg3); color:var(--txt); border:1px solid var(--bdr); }
  .km-msg { padding:.5rem .75rem; border-radius:4px; margin-top:.5rem; }
  .km-msg.ok  { background:rgba(16,185,129,.15); color:var(--ok); border:1px solid var(--ok); }
  .km-msg.err { background:rgba(239,68,68,.12); color:var(--dan); border:1px solid var(--dan); }
  .km-section-title { font-size:1.1rem; font-weight:600; margin:1.5rem 0 .5rem; }
  @media (max-width:600px) {
    .km-col-desc { display:none; }
  }
  body { overflow-y: auto; }
</style>
</head>
<body>
<header>
  <h1>&#128273; Key Manager</h1>
  ${menu}
</header>
<div class="dashboard-wrapper" style="padding:1.5rem 2rem">
  <p style="color:var(--color-muted,#888);font-size:.85rem;margin:0 0 1rem">
    Manage placeholder → secret mappings stored in the <code>bot_secrets</code> database table.
    Values are never shown in logs.
  </p>
  <div id="msg" style="display:none"></div>

  <div class="km-section-title">Secrets</div>
  <table class="km-table" id="secrets-table">
    <thead><tr>
      <th>Name &amp; Value</th>
      <th class="km-col-desc">Description</th>
      <th></th>
    </tr></thead>
    <tbody id="secrets-body"><tr><td colspan="3" style="color:var(--color-muted)">Loading…</td></tr></tbody>
  </table>

  <div class="km-section-title" id="form-title">Add Secret</div>
  <form class="km-form" id="secret-form" onsubmit="return handleSubmit(event)">
    <div>
      <label for="f-name">Placeholder name (uppercase, e.g. OPENAI)</label>
      <input id="f-name" name="name" placeholder="OPENAI" required autocomplete="off">
    </div>
    <div>
      <label for="f-value">Real secret value</label>
      <input id="f-value" name="value" type="password" placeholder="sk-…" required autocomplete="new-password">
    </div>
    <div>
      <label for="f-desc">Description (optional)</label>
      <textarea id="f-desc" name="description" placeholder="OpenAI API key for all AI features"></textarea>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center">
      <button type="submit" class="km-btn km-btn-primary" id="submit-btn">Add</button>
      <button type="button" class="km-btn km-btn-muted" id="cancel-btn" onclick="resetForm()" style="display:none">Cancel</button>
    </div>
  </form>
</div>

<script>
const BASE = ${JSON.stringify(basePath)};
let editingName = null;

async function load() {
  const res = await fetch(BASE + '/api/list');
  const data = await res.json();
  const tbody = document.getElementById('secrets-body');
  if (!data.ok || !data.secrets.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--color-muted)">No secrets configured yet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.secrets.map(s => {
    const name = escHtml(s.name);
    const desc = escHtml(s.description || '');
    return \`<tr id="row-\${name}">
      <td>
        <div class="km-name">\${name}</div>
        <div class="km-val-row" id="val-\${name}">
          <div class="km-val-box">
            <span class="km-val-text masked">••••••••••••••••••••</span>
            <span class="km-val-text revealed" style="display:none">\${escHtml(s.value)}</span>
          </div>
          <button class="km-icon-btn" id="show-btn-\${name}" onclick="toggleReveal('\${name}')" title="Show / Hide">👁</button>
          <button class="km-icon-btn" id="copy-btn-\${name}" onclick="copyVal('\${name}', \${escHtml(JSON.stringify(s.value))})" title="Copy to clipboard">📋</button>
        </div>
      </td>
      <td class="km-col-desc">\${desc}</td>
      <td class="km-actions">
        <button class="km-icon-btn" onclick="startEdit('\${name}', \${escHtml(JSON.stringify(s.value))}, \${escHtml(JSON.stringify(s.description || ''))})" title="Edit">✏️</button>
        <button class="km-icon-btn km-icon-danger" onclick="handleDelete('\${name}')" title="Delete">🗑️</button>
      </td>
    </tr>\`;
  }).join('');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleReveal(name) {
  const row = document.getElementById('val-' + name);
  const masked   = row.querySelector('.masked');
  const revealed = row.querySelector('.revealed');
  const btn      = document.getElementById('show-btn-' + name);
  if (masked.style.display === 'none') {
    masked.style.display = ''; revealed.style.display = 'none'; btn.title = 'Show / Hide';
  } else {
    masked.style.display = 'none'; revealed.style.display = ''; btn.title = 'Hide';
  }
}

async function copyVal(name, value) {
  try {
    await navigator.clipboard.writeText(value);
    const btn = document.getElementById('copy-btn-' + name);
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    showMsg('Copy failed — check browser permissions.', false);
  }
}

function startEdit(name, value, desc) {
  editingName = name;
  document.getElementById('f-name').value = name;
  document.getElementById('f-name').readOnly = true;
  document.getElementById('f-name').style.opacity = '.6';
  document.getElementById('f-value').value = value;
  document.getElementById('f-value').type = 'text';
  document.getElementById('f-desc').value = desc;
  document.getElementById('form-title').textContent = 'Edit Secret: ' + name;
  document.getElementById('submit-btn').textContent = 'Save';
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('f-value').focus();
  document.getElementById('f-value').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  editingName = null;
  document.getElementById('secret-form').reset();
  document.getElementById('f-name').readOnly = false;
  document.getElementById('f-name').style.opacity = '';
  document.getElementById('f-value').type = 'password';
  document.getElementById('form-title').textContent = 'Add Secret';
  document.getElementById('submit-btn').textContent = 'Add';
  document.getElementById('cancel-btn').style.display = 'none';
  hideMsg();
}

function showMsg(text, ok) {
  const el = document.getElementById('msg');
  el.className = 'km-msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
  el.style.display = '';
  setTimeout(hideMsg, 4000);
}
function hideMsg() { document.getElementById('msg').style.display = 'none'; }

async function handleSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('f-name').value.trim();
  const value = document.getElementById('f-value').value;
  const description = document.getElementById('f-desc').value.trim();
  if (!name || !value) { showMsg('Name and value are required.', false); return false; }
  const res = await fetch(BASE + '/api/set', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value, description })
  });
  const data = await res.json();
  if (data.ok) {
    showMsg((editingName ? 'Updated' : 'Added') + ': ' + name, true);
    resetForm(); load();
  } else {
    showMsg('Error: ' + (data.error || 'unknown'), false);
  }
  return false;
}

async function handleDelete(name) {
  if (!confirm('Delete secret "' + name + '"? This cannot be undone.')) return;
  const res = await fetch(BASE + '/api/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (data.ok) { showMsg('Deleted: ' + name, true); load(); }
  else showMsg('Error: ' + (data.error || 'unknown'), false);
}

load();
</script>
</body>
</html>`;
}


export default async function getWebpageKeymanager(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3122);
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
      wo.http.response = { status: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "forbidden" }) };
    } else {
      const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
      wo.http.response = {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
              "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
              "<title>Key Manager</title>" + getThemeHeadScript() +
              "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
              "<header><h1>\uD83D\uDD11 Key Manager</h1>" + menuHtml + "</header>" +
              "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
              "<div style=\"text-align:center;color:var(--txt)\">" +
              "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
              "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
              "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">← Back to home</a>" +
              "</div></div></body></html>"
      };
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  try {
    await setEnsureSecretsTable(wo);
  } catch (err) {
    wo.http.response = { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "DB error: " + String(err?.message || err) };
    wo.jump = true;
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/list") {
    try {
      const secrets = await listSecrets(wo);
      wo.http.response = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: true, secrets }) };
    } catch (err) {
      wo.http.response = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: String(err?.message || err) }) };
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/set") {
    try {
      const body = wo.http?.json || {};
      const name = getStr(body.name).trim();
      const value = getStr(body.value);
      const description = body.description != null ? getStr(body.description).trim() : null;
      if (!name) {
        wo.http.response = { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: "Missing name" }) };
        wo.jump = true;
        return coreData;
      }
      if (!value) {
        wo.http.response = { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: "Missing value" }) };
        wo.jump = true;
        return coreData;
      }
      await setSecret(wo, name, value, description || null);
      wo.http.response = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      wo.http.response = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: String(err?.message || err) }) };
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/delete") {
    try {
      const body = wo.http?.json || {};
      const name = getStr(body.name).trim();
      if (!name) {
        wo.http.response = { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: "Missing name" }) };
        wo.jump = true;
        return coreData;
      }
      const deleted = await deleteSecret(wo, name);
      wo.http.response = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: true, deleted }) };
    } catch (err) {
      wo.http.response = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ ok: false, error: String(err?.message || err) }) };
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
      wo.http.response = { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Error: " + String(err?.message || err) };
    }
    wo.jump = true;
    return coreData;
  }

  return coreData;
}
