/************************************************************************************/
/* filename: 00058-webpage-keymanager.js                                            *
/* Version 1.0                                                                      *
/* Purpose: Admin CRUD web UI for the bot_secrets table.                            *
/*          Allows viewing, adding, editing, and deleting secret mappings           *
/*          (placeholder name → real value) used by core/secrets.js.               *
/*                                                                                  *
/* Port: 3122 (cfg.port)                                                            *
/* Base path: /key-manager (cfg.basePath)                                           *
/* Roles: cfg.allowedRoles (default: ["admin"])                                     *
/*                                                                                  *
/* Routes:                                                                          *
/*   GET  /key-manager           — main UI page                                     *
/*   GET  /key-manager/api/list  — JSON list of secrets                             *
/*   POST /key-manager/api/set   — create or update {name, value, description}      *
/*   POST /key-manager/api/delete — delete {name}                                   *
/************************************************************************************/

import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getIsAllowedRoles } from "../shared/webpage/utils.js";
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
  .km-table { width:100%; border-collapse:collapse; margin-top:1rem; }
  .km-table th, .km-table td { padding:.5rem .75rem; border:1px solid var(--bdr); text-align:left; }
  .km-table th { background:var(--bg3); font-weight:600; }
  .km-table tr:nth-child(even) td { background:var(--bg3); }
  .km-val { font-family:monospace; color:var(--muted); }
  .km-val.revealed { color:var(--txt); }
  .km-actions { white-space:nowrap; }
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
  .km-edit-row input { width:100%; font-family:monospace; font-size:.85rem; padding:.3rem .5rem;
    background:var(--bg2); color:var(--txt);
    border:1px solid var(--acc); border-radius:3px; }
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
      <th>Name (placeholder)</th>
      <th>Value</th>
      <th>Description</th>
      <th>Actions</th>
    </tr></thead>
    <tbody id="secrets-body"><tr><td colspan="4" style="color:var(--color-muted)">Loading…</td></tr></tbody>
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
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--color-muted)">No secrets configured yet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.secrets.map(s => {
    const name = escHtml(s.name);
    const desc = escHtml(s.description || '');
    return \`<tr id="row-\${name}">
      <td><code>\${name}</code></td>
      <td class="km-val" id="val-\${name}" title="Click to reveal">
        <span class="masked">••••••••</span>
        <span class="plain" style="display:none">\${escHtml(s.value)}</span>
        <button class="km-btn km-btn-muted" style="margin-left:.4rem;padding:.15rem .5rem;font-size:.75rem"
          onclick="toggleReveal('\${name}')">show</button>
      </td>
      <td>\${desc}</td>
      <td class="km-actions">
        <button class="km-btn km-btn-muted" onclick="startEdit('\${name}', \${JSON.stringify(s.value)}, \${JSON.stringify(s.description || '')})"
          style="margin-right:.3rem">Edit</button>
        <button class="km-btn km-btn-danger" onclick="handleDelete('\${name}')">Delete</button>
      </td>
    </tr>\`;
  }).join('');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleReveal(name) {
  const cell = document.getElementById('val-' + name);
  const masked = cell.querySelector('.masked');
  const plain = cell.querySelector('.plain');
  const btn = cell.querySelector('button');
  if (masked.style.display === 'none') {
    masked.style.display = ''; plain.style.display = 'none'; btn.textContent = 'show';
  } else {
    masked.style.display = 'none'; plain.style.display = ''; btn.textContent = 'hide';
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
    wo.http.response = { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "403 Forbidden" };
    wo.jump = true;
    return coreData;
  }

  // Ensure table exists (lazy init)
  try {
    await setEnsureSecretsTable(wo);
  } catch (err) {
    wo.http.response = { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "DB error: " + String(err?.message || err) };
    wo.jump = true;
    return coreData;
  }

  // --- API: list ---
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

  // --- API: set (create/update) ---
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

  // --- API: delete ---
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

  // --- Main UI ---
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
