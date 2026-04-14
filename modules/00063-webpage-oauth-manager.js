/**************************************************************/
/* filename: "00063-webpage-oauth-manager.js"                */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/
"use strict";

import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import {
  getEnsureOAuthPool,
  ensureOAuthTables,
  listOAuthRegistrations,
  getOAuthRegistration,
  upsertOAuthRegistration,
  deleteOAuthRegistration,
  listOAuthTokens
} from "../shared/oauth/oauth-manager.js";

const MODULE_NAME = "webpage-oauth-manager";


function getBasePath(cfg) {
  const v = String(cfg?.basePath ?? "/oauth").trim();
  return v.startsWith("/") ? v.replace(/\/+$/, "") || "/oauth" : "/oauth";
}


function escJ(v) {
  return JSON.stringify(v == null ? "" : String(v));
}


function getPageHtml(opts) {
  const basePath = String(opts?.basePath || "/oauth").replace(/\/+$/, "") || "/oauth";
  const menuHtml = getMenuHtml(opts?.menu || [], basePath, opts?.role || "", null, null, opts?.webAuth);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>OAuth Manager</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="/voice/style.css">
<style>
  .card{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:18px 20px;margin-bottom:18px}
  .card-header{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--bdr);color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:8px 10px;border-bottom:1px solid var(--bdr);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .ok{color:var(--ok,#22c55e)}
  .warn{color:#f59e0b}
  .expired{color:var(--dan,#ef4444)}
  .field{margin-bottom:12px}
  .field label{display:block;font-size:.78rem;color:var(--muted);margin-bottom:4px;font-weight:600}
  .field input,.field select{width:100%;background:var(--card);border:1px solid var(--bdr);border-radius:6px;padding:8px 10px;color:var(--txt);font-size:.87rem;outline:none}
  .field input:focus,.field select:focus{border-color:var(--acc)}
  .btn-row{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
  .btn{background:var(--acc,#5b5bd6);border:none;border-radius:6px;cursor:pointer;padding:.4rem 1.1rem;font-size:.85rem;font-weight:600;color:#fff}
  .btn:hover{opacity:.85}
  .btn-danger{background:var(--dan,#ef4444)}
  .btn-sm{padding:.25rem .7rem;font-size:.78rem}
  #status-msg,#ac-status-msg{font-size:.83rem;min-height:1.2em;margin-top:8px}
  .token-ok{color:var(--ok,#22c55e)}
  .token-exp{color:var(--dan,#ef4444)}
  #edit-panel,#ac-edit-panel{display:none}
</style>
</head>
<body>
<header><h1>&#128273; OAuth Manager</h1>${menuHtml}</header>
<div style="margin-top:var(--hh);padding:16px 20px;max-width:960px">

  <!-- ── Client Credentials Providers ─────────────────────── -->
  <div class="card">
    <div class="card-header">Server&#8209;to&#8209;Server Providers (client_credentials)</div>
    <p style="font-size:.82rem;color:var(--muted);margin:0 0 12px">These providers use the OAuth2 client credentials flow &mdash; a single service token shared for all bot operations. Used by <code>getApi</code> with <code>authType: "oauth_cc"</code>.</p>
    <table id="reg-table">
      <thead><tr>
        <th>Name</th><th>Token URL</th><th>Scope</th><th>Description</th><th>Actions</th>
      </tr></thead>
      <tbody id="reg-tbody"><tr><td colspan="5" style="color:var(--muted)">Loading&#8230;</td></tr></tbody>
    </table>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-sm" onclick="openAdd()">&#43; Add Provider</button>
    </div>
  </div>

  <div class="card" id="edit-panel">
    <div class="card-header" id="edit-title">Add Provider</div>
    <div class="field"><label>Name (unique identifier, e.g. "github")</label><input id="f-name" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>Token URL</label><input id="f-token-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://provider.example.com/oauth/token"></div>
    <div class="field"><label>Client ID</label><input id="f-client-id" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>Client Secret</label><input id="f-client-secret" type="password" autocomplete="off"></div>
    <div class="field"><label>Scope (space-separated, optional)</label><input id="f-scope" autocomplete="off" spellcheck="false" placeholder="read:org repo"></div>
    <div class="field"><label>Description (optional)</label><input id="f-description" autocomplete="off" spellcheck="false"></div>
    <div id="status-msg"></div>
    <div class="btn-row">
      <button class="btn" onclick="saveProvider()">&#128190; Save</button>
      <button class="btn" style="background:var(--bg3,#2d2d40);color:var(--muted)" onclick="closeEdit()">Cancel</button>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Cached Service Tokens</div>
    <p style="font-size:.82rem;color:var(--muted);margin:0 0 12px">Active client_credentials tokens cached in the database. Refreshed automatically by the cron job.</p>
    <table>
      <thead><tr><th>Provider</th><th>Expires</th><th>Scope</th></tr></thead>
      <tbody id="token-tbody"><tr><td colspan="3" style="color:var(--muted)">Loading&#8230;</td></tr></tbody>
    </table>
  </div>

  <!-- ── Auth Code Providers ────────────────────────────────── -->
  <div class="card" style="margin-top:28px">
    <div class="card-header">User Connection Providers (auth_code)</div>
    <p style="font-size:.82rem;color:var(--muted);margin:0 0 12px">These providers use the OAuth2 authorization code flow &mdash; each user connects their own account individually at <a href="/connections">/connections</a>. Used by <code>getApi</code> with <code>authType: "oauth_user"</code>.</p>
    <table>
      <thead><tr>
        <th>Name</th><th>Auth URL</th><th>Scope</th><th>Description</th><th>Actions</th>
      </tr></thead>
      <tbody id="ac-reg-tbody"><tr><td colspan="5" style="color:var(--muted)">Loading&#8230;</td></tr></tbody>
    </table>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-sm" onclick="openAcAdd()">&#43; Add Provider</button>
    </div>
  </div>

  <div class="card" id="ac-edit-panel">
    <div class="card-header" id="ac-edit-title">Add User Connection Provider</div>
    <div class="field"><label>Name (unique identifier, e.g. "discord")</label><input id="ac-f-name" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>Authorization URL</label><input id="ac-f-auth-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://provider.example.com/oauth/authorize"></div>
    <div class="field"><label>Token URL</label><input id="ac-f-token-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://provider.example.com/oauth/token"></div>
    <div class="field"><label>Client ID</label><input id="ac-f-client-id" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>Client Secret</label><input id="ac-f-client-secret" type="password" autocomplete="off"></div>
    <div class="field"><label>Scope (space-separated, optional)</label><input id="ac-f-scope" autocomplete="off" spellcheck="false" placeholder="identify email"></div>
    <div class="field"><label>Description (optional)</label><input id="ac-f-description" autocomplete="off" spellcheck="false"></div>
    <div id="ac-status-msg"></div>
    <div class="btn-row">
      <button class="btn" onclick="saveAcProvider()">&#128190; Save</button>
      <button class="btn" style="background:var(--bg3,#2d2d40);color:var(--muted)" onclick="closeAcEdit()">Cancel</button>
    </div>
  </div>

</div>
<script>
var BASE = ${escJ(basePath)};
var editingName   = null;
var acEditingName = null;

function fmtExpiry(ms) {
  if (!ms) return '<span class="token-exp">unknown</span>';
  var diff = Number(ms) - Date.now();
  if (diff < 0) return '<span class="token-exp">expired</span>';
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return '<span class="token-ok">' + mins + ' min</span>';
  var hrs = Math.floor(mins / 60);
  if (hrs < 48) return '<span class="token-ok">' + hrs + ' h</span>';
  return '<span class="token-ok">' + Math.floor(hrs / 24) + ' d</span>';
}

function escH(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Client Credentials ─────────────────────────────────── */

async function loadRegistrations() {
  var tbody = document.getElementById('reg-tbody');
  try {
    var r = await fetch(BASE + '/api/registrations');
    var d = await r.json();
    var rows = d.registrations || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No providers registered yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(reg) {
      return '<tr>' +
        '<td><strong>' + escH(reg.name) + '</strong></td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH((reg.token_url || '').slice(0, 50)) + (reg.token_url && reg.token_url.length > 50 ? '\u2026' : '') + '</td>' +
        '<td style="font-size:.78rem">' + escH(reg.scope || '\u2014') + '</td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH(reg.description || '\u2014') + '</td>' +
        '<td><button class="btn btn-sm" onclick="openEdit(' + escH(JSON.stringify(reg)) + ')">\u270F\uFE0F Edit</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteProvider(' + escH(JSON.stringify(reg.name)) + ')">\uD83D\uDDD1\uFE0F</button></td>' +
        '</tr>';
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--dan)">Load error: ' + escH(String(e)) + '</td></tr>'; }
}

async function loadTokens() {
  var tbody = document.getElementById('token-tbody');
  try {
    var r = await fetch(BASE + '/api/token-status');
    var d = await r.json();
    var rows = (d.tokens || []).filter(function(t) { return t.user_id === '__service__'; });
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted)">No cached service tokens.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(t) {
      return '<tr>' +
        '<td>' + escH(t.provider) + '</td>' +
        '<td>' + fmtExpiry(t.expires_at) + '</td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH(t.scope || '\u2014') + '</td>' +
        '</tr>';
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="3" style="color:var(--dan)">Load error: ' + escH(String(e)) + '</td></tr>'; }
}

function openAdd() {
  editingName = null;
  document.getElementById('edit-title').textContent = 'Add Provider';
  ['f-name','f-token-url','f-client-id','f-client-secret','f-scope','f-description'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-name').readOnly = false;
  document.getElementById('status-msg').textContent = '';
  document.getElementById('edit-panel').style.display = 'block';
  document.getElementById('edit-panel').scrollIntoView({ behavior: 'smooth' });
}

function openEdit(reg) {
  editingName = reg.name;
  document.getElementById('edit-title').textContent = 'Edit Provider: ' + reg.name;
  document.getElementById('f-name').value = reg.name || '';
  document.getElementById('f-name').readOnly = true;
  document.getElementById('f-token-url').value = reg.token_url || '';
  document.getElementById('f-client-id').value = reg.client_id || '';
  document.getElementById('f-client-secret').value = '';
  document.getElementById('f-scope').value = reg.scope || '';
  document.getElementById('f-description').value = reg.description || '';
  document.getElementById('status-msg').textContent = '';
  document.getElementById('edit-panel').style.display = 'block';
  document.getElementById('edit-panel').scrollIntoView({ behavior: 'smooth' });
}

function closeEdit() {
  document.getElementById('edit-panel').style.display = 'none';
  editingName = null;
}

async function saveProvider() {
  var msg = document.getElementById('status-msg');
  var name = document.getElementById('f-name').value.trim();
  if (!name) { msg.textContent = 'Name is required.'; return; }
  var payload = {
    name:        name,
    flow:        'client_credentials',
    tokenUrl:    document.getElementById('f-token-url').value.trim(),
    clientId:    document.getElementById('f-client-id').value.trim(),
    scope:       document.getElementById('f-scope').value.trim() || null,
    description: document.getElementById('f-description').value.trim() || null
  };
  var secret = document.getElementById('f-client-secret').value;
  if (secret) payload.clientSecret = secret;

  msg.textContent = 'Saving\u2026';
  try {
    var r = await fetch(BASE + '/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var d = await r.json();
    if (!r.ok) { msg.textContent = 'Error: ' + (d.error || r.status); return; }
    msg.textContent = 'Saved.';
    setTimeout(closeEdit, 800);
    loadRegistrations();
  } catch(e) { msg.textContent = 'Error: ' + e.message; }
}

async function deleteProvider(name) {
  if (!confirm('Delete provider "' + name + '" and all its tokens?')) return;
  try {
    var r = await fetch(BASE + '/api/registrations/' + encodeURIComponent(name), { method: 'DELETE' });
    var d = await r.json();
    if (!r.ok) { alert('Error: ' + (d.error || r.status)); return; }
    loadRegistrations();
    loadTokens();
  } catch(e) { alert('Error: ' + e.message); }
}

/* ── Auth Code Providers ────────────────────────────────── */

async function loadAcRegistrations() {
  var tbody = document.getElementById('ac-reg-tbody');
  try {
    var r = await fetch(BASE + '/api/user-providers');
    var d = await r.json();
    var rows = d.registrations || [];
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No user connection providers registered yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(reg) {
      return '<tr>' +
        '<td><strong>' + escH(reg.name) + '</strong></td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH((reg.auth_url || '').slice(0, 50)) + (reg.auth_url && reg.auth_url.length > 50 ? '\u2026' : '') + '</td>' +
        '<td style="font-size:.78rem">' + escH(reg.scope || '\u2014') + '</td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH(reg.description || '\u2014') + '</td>' +
        '<td><button class="btn btn-sm" onclick="openAcEdit(' + escH(JSON.stringify(reg)) + ')">\u270F\uFE0F Edit</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteAcProvider(' + escH(JSON.stringify(reg.name)) + ')">\uD83D\uDDD1\uFE0F</button></td>' +
        '</tr>';
    }).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--dan)">Load error: ' + escH(String(e)) + '</td></tr>'; }
}

function openAcAdd() {
  acEditingName = null;
  document.getElementById('ac-edit-title').textContent = 'Add User Connection Provider';
  ['ac-f-name','ac-f-auth-url','ac-f-token-url','ac-f-client-id','ac-f-client-secret','ac-f-scope','ac-f-description'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('ac-f-name').readOnly = false;
  document.getElementById('ac-status-msg').textContent = '';
  document.getElementById('ac-edit-panel').style.display = 'block';
  document.getElementById('ac-edit-panel').scrollIntoView({ behavior: 'smooth' });
}

function openAcEdit(reg) {
  acEditingName = reg.name;
  document.getElementById('ac-edit-title').textContent = 'Edit User Connection Provider: ' + reg.name;
  document.getElementById('ac-f-name').value = reg.name || '';
  document.getElementById('ac-f-name').readOnly = true;
  document.getElementById('ac-f-auth-url').value = reg.auth_url || '';
  document.getElementById('ac-f-token-url').value = reg.token_url || '';
  document.getElementById('ac-f-client-id').value = reg.client_id || '';
  document.getElementById('ac-f-client-secret').value = '';
  document.getElementById('ac-f-scope').value = reg.scope || '';
  document.getElementById('ac-f-description').value = reg.description || '';
  document.getElementById('ac-status-msg').textContent = '';
  document.getElementById('ac-edit-panel').style.display = 'block';
  document.getElementById('ac-edit-panel').scrollIntoView({ behavior: 'smooth' });
}

function closeAcEdit() {
  document.getElementById('ac-edit-panel').style.display = 'none';
  acEditingName = null;
}

async function saveAcProvider() {
  var msg = document.getElementById('ac-status-msg');
  var name = document.getElementById('ac-f-name').value.trim();
  if (!name) { msg.textContent = 'Name is required.'; return; }
  var payload = {
    name:        name,
    flow:        'auth_code',
    authUrl:     document.getElementById('ac-f-auth-url').value.trim(),
    tokenUrl:    document.getElementById('ac-f-token-url').value.trim(),
    clientId:    document.getElementById('ac-f-client-id').value.trim(),
    scope:       document.getElementById('ac-f-scope').value.trim() || null,
    description: document.getElementById('ac-f-description').value.trim() || null
  };
  var secret = document.getElementById('ac-f-client-secret').value;
  if (secret) payload.clientSecret = secret;

  msg.textContent = 'Saving\u2026';
  try {
    var r = await fetch(BASE + '/api/user-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var d = await r.json();
    if (!r.ok) { msg.textContent = 'Error: ' + (d.error || r.status); return; }
    msg.textContent = 'Saved.';
    setTimeout(closeAcEdit, 800);
    loadAcRegistrations();
  } catch(e) { msg.textContent = 'Error: ' + e.message; }
}

async function deleteAcProvider(name) {
  if (!confirm('Delete provider "' + name + '" and all user tokens for it?')) return;
  try {
    var r = await fetch(BASE + '/api/user-providers/' + encodeURIComponent(name), { method: 'DELETE' });
    var d = await r.json();
    if (!r.ok) { alert('Error: ' + (d.error || r.status)); return; }
    loadAcRegistrations();
  } catch(e) { alert('Error: ' + e.message); }
}

loadRegistrations();
loadTokens();
loadAcRegistrations();
setInterval(loadTokens, 30000);
</script>
</body>
</html>`;
}


export default async function webpageOauthManager(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const urlRaw  = String(wo?.http?.url ?? "");
  const urlPath = urlRaw.split("?")[0];
  const method  = String(wo?.http?.method ?? "GET").toUpperCase();
  const base    = getBasePath(cfg);

  if (!urlPath.startsWith(base)) return coreData;

  const allowedRoles = Array.isArray(cfg.roles) ? cfg.roles : [];
  if (!getIsAllowedRoles(wo, allowedRoles)) {
    setJsonResp(wo, 403, { error: "forbidden" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureOAuthTables(pool);
  } catch (e) {
    setJsonResp(wo, 500, { error: String(e?.message || e) });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }


  if (method === "GET" && urlPath === base + "/api/registrations") {
    const rows = await listOAuthRegistrations(pool);
    const safe = rows
      .filter((r) => r.flow === "client_credentials")
      .map((r) => ({ ...r, client_secret: undefined }));
    setJsonResp(wo, 200, { registrations: safe });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === base + "/api/registrations") {
    const data = wo?.http?.json || {};
    const name = String(data.name || "").trim();
    if (!name) { setJsonResp(wo, 400, { error: "name is required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const existing = await getOAuthRegistration(pool, name);
    const payload  = {
      name,
      flow:         "client_credentials",
      tokenUrl:     String(data.tokenUrl    || ""),
      authUrl:      null,
      clientId:     String(data.clientId    || existing?.client_id    || ""),
      clientSecret: data.clientSecret ? String(data.clientSecret) : (existing?.client_secret || ""),
      scope:        data.scope       ? String(data.scope)       : null,
      description:  data.description ? String(data.description) : null
    };

    if (!payload.tokenUrl) { setJsonResp(wo, 400, { error: "tokenUrl is required" }); wo.jump = true; await setSendNow(wo); return coreData; }
    if (!payload.clientId) { setJsonResp(wo, 400, { error: "clientId is required" });  wo.jump = true; await setSendNow(wo); return coreData; }

    await upsertOAuthRegistration(pool, payload);
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  const deleteMatch = urlPath.match(new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/api/registrations/([^/]+)$"));
  if (method === "DELETE" && deleteMatch) {
    const name = decodeURIComponent(deleteMatch[1]);
    await deleteOAuthRegistration(pool, name);
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === base + "/api/token-status") {
    const tokens = await listOAuthTokens(pool);
    setJsonResp(wo, 200, { tokens });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }


  if (method === "GET" && urlPath === base + "/api/user-providers") {
    const rows = await listOAuthRegistrations(pool);
    const safe = rows
      .filter((r) => r.flow === "auth_code")
      .map((r) => ({ ...r, client_secret: undefined }));
    setJsonResp(wo, 200, { registrations: safe });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "POST" && urlPath === base + "/api/user-providers") {
    const data = wo?.http?.json || {};
    const name = String(data.name || "").trim();
    if (!name) { setJsonResp(wo, 400, { error: "name is required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const existing = await getOAuthRegistration(pool, name);
    const payload  = {
      name,
      flow:         "auth_code",
      tokenUrl:     String(data.tokenUrl    || ""),
      authUrl:      data.authUrl ? String(data.authUrl) : null,
      clientId:     String(data.clientId    || existing?.client_id    || ""),
      clientSecret: data.clientSecret ? String(data.clientSecret) : (existing?.client_secret || ""),
      scope:        data.scope       ? String(data.scope)       : null,
      description:  data.description ? String(data.description) : null
    };

    if (!payload.tokenUrl) { setJsonResp(wo, 400, { error: "tokenUrl is required" }); wo.jump = true; await setSendNow(wo); return coreData; }
    if (!payload.authUrl)  { setJsonResp(wo, 400, { error: "authUrl is required" });  wo.jump = true; await setSendNow(wo); return coreData; }
    if (!payload.clientId) { setJsonResp(wo, 400, { error: "clientId is required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    await upsertOAuthRegistration(pool, payload);
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  const acDeleteMatch = urlPath.match(new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/api/user-providers/([^/]+)$"));
  if (method === "DELETE" && acDeleteMatch) {
    const name = decodeURIComponent(acDeleteMatch[1]);
    await deleteOAuthRegistration(pool, name);
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }


  if (method === "GET" && (urlPath === base || urlPath === base + "/")) {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml({ basePath: base, menu: wo.web?.menu || [], role: wo.webAuth?.role || "", webAuth: wo.webAuth })
    };
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath.startsWith(base + "/api/")) {
    setJsonResp(wo, 404, { error: "not_found" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}
