/**************************************************************/
/* filename: "00071-webpage-bearer-exposure.js"              */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/
"use strict";

import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { getIsAllowedRoles, setJsonResp, setSendNow } from "../shared/webpage/utils.js";
import { getEnsureOAuthPool }               from "../shared/oauth/oauth-manager.js";
import {
  ensureExposureTable,
  listExposed,
  addExposed,
  removeExposed
} from "../shared/tools/tool-exposure.js";
import { listSecrets } from "../core/secrets.js";

const MODULE_NAME = "webpage-bearer-exposure";
const BASE_PATH   = "/bearer-exposure";
const TOOL_NAME   = "getApiBearers";


function getPageHtml(opts) {
  const menuHtml = getMenuHtml(opts?.menu || [], BASE_PATH, opts?.role || "", null, null, opts?.webAuth);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>API Key Exposure</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="/voice/style.css">
<style>
  .card{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:18px 20px;margin-bottom:18px}
  .card-header{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--bdr);color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:8px 10px;border-bottom:1px solid var(--bdr);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .btn{background:var(--acc,#5b5bd6);border:none;border-radius:6px;cursor:pointer;padding:.4rem 1.1rem;font-size:.85rem;font-weight:600;color:#fff}
  .btn:hover{opacity:.85}
  .btn-danger{background:var(--dan,#ef4444)}
  .btn-sm{padding:.25rem .7rem;font-size:.78rem}
  .badge-exposed{display:inline-block;background:#1e3d2a;color:#6ee7b7;font-size:.72rem;padding:2px 7px;border-radius:4px;font-weight:600}
  .badge-hidden{display:inline-block;background:var(--bg3,#2d2d40);color:var(--muted);font-size:.72rem;padding:2px 7px;border-radius:4px;font-weight:600}
</style>
</head>
<body>
<header><h1>&#128273; API Key Exposure</h1>${menuHtml}</header>
<div style="margin-top:var(--hh);padding:16px 20px;max-width:960px">

  <p style="font-size:.85rem;color:var(--muted);margin:0 0 18px">
    Toggle which API key <em>names</em> the AI can discover via the <code>getApiBearers</code> tool.
    Only <strong style="color:var(--ok,#22c55e)">Exposed</strong> key names will be returned.
    Actual key values are <strong>never</strong> revealed to the AI.
  </p>

  <div class="card">
    <div class="card-header">Stored API Keys &amp; Credentials</div>
    <table>
      <thead><tr><th>Key Name</th><th>Description</th><th>Status</th><th>Action</th></tr></thead>
      <tbody id="tbody"><tr><td colspan="4" style="color:var(--muted)">Loading&#8230;</td></tr></tbody>
    </table>
  </div>

</div>
<script>
function escH(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function load() {
  var tbody = document.getElementById('tbody');
  try {
    var r = await fetch('/bearer-exposure/api/keys');
    var d = await r.json();
    var keys    = d.keys || [];
    var exposed = new Set(d.exposed || []);
    if (!keys.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">No API keys stored yet. Add some at <a href="/key-manager">/key-manager</a>.</td></tr>';
      return;
    }
    tbody.innerHTML = keys.map(function(k) {
      var isExp = exposed.has(k.name);
      return '<tr>' +
        '<td><code>' + escH(k.name) + '</code></td>' +
        '<td style="font-size:.78rem;color:var(--muted)">' + escH(k.description || '\u2014') + '</td>' +
        '<td>' + (isExp ? '<span class="badge-exposed">Exposed</span>' : '<span class="badge-hidden">Hidden</span>') + '</td>' +
        '<td>' + (isExp
          ? '<button class="btn btn-sm btn-danger" onclick="toggle(' + escH(JSON.stringify(k.name)) + ',false)">\u{1F6AB} Hide</button>'
          : '<button class="btn btn-sm" onclick="toggle(' + escH(JSON.stringify(k.name)) + ',true)">\u2714\uFE0F Expose</button>'
        ) + '</td>' +
        '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--dan)">Load error: ' + escH(String(e)) + '</td></tr>';
  }
}

async function toggle(name, expose) {
  try {
    var r = await fetch('/bearer-exposure/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, expose: expose })
    });
    if (!r.ok) { var d = await r.json(); alert('Error: ' + (d.error || r.status)); return; }
    load();
  } catch(e) { alert('Error: ' + e.message); }
}

load();
</script>
</body>
</html>`;
}


export default async function webpageBearerExposure(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const urlRaw  = String(wo?.http?.url ?? "");
  const urlPath = urlRaw.split("?")[0];
  const method  = String(wo?.http?.method ?? "GET").toUpperCase();

  if (!urlPath.startsWith(BASE_PATH)) return coreData;

  const allowedRoles = Array.isArray(cfg.roles) ? cfg.roles : ["admin"];
  if (!getIsAllowedRoles(wo, allowedRoles)) {
    setJsonResp(wo, 403, { error: "forbidden" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureExposureTable(pool);
  } catch (e) {
    setJsonResp(wo, 500, { error: String(e?.message || e) });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  // GET /bearer-exposure/api/keys
  if (method === "GET" && urlPath === BASE_PATH + "/api/keys") {
    let allSecrets;
    try {
      allSecrets = await listSecrets(wo);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const keys    = allSecrets.map((s) => ({ name: s.name, description: s.description || null }));
    const exposed = await listExposed(pool, TOOL_NAME);
    setJsonResp(wo, 200, { keys, exposed });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  // POST /bearer-exposure/api/keys
  if (method === "POST" && urlPath === BASE_PATH + "/api/keys") {
    const data   = wo?.http?.json || {};
    const name   = String(data.name || "").trim();
    const expose = Boolean(data.expose);
    if (!name) { setJsonResp(wo, 400, { error: "name is required" }); wo.jump = true; await setSendNow(wo); return coreData; }
    if (expose) {
      await addExposed(pool, TOOL_NAME, name);
    } else {
      await removeExposed(pool, TOOL_NAME, name);
    }
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  // GET /bearer-exposure or /bearer-exposure/
  if (method === "GET" && (urlPath === BASE_PATH || urlPath === BASE_PATH + "/")) {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", webAuth: wo.webAuth })
    };
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath.startsWith(BASE_PATH + "/api/")) {
    setJsonResp(wo, 404, { error: "not_found" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}
