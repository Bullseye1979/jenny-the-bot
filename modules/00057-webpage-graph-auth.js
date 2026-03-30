/**********************************************************************************/
/* filename: 00057-webpage-graph-auth.js                                          *
/* Version 1.0                                                                    *
/* Purpose: Microsoft Graph OAuth2 delegated auth for webpage users.              *
/*          Stores tokens per Discord user in graph_tokens DB table.              *
/*          Routes: GET /graph-auth, /graph-auth/start,                           *
/*                  /graph-auth/callback, /graph-auth/disconnect                  *
/* Flow: webpage                                                                  *
/* Port: 3118 (cfg.port)                                                          *
/**********************************************************************************/

"use strict";

import crypto from "node:crypto";
import { getSecret }          from "../core/secrets.js";
import { getPrefixedLogger }  from "../core/logging.js";
import { getDb }              from "../shared/webpage/interface.js";

const MODULE_NAME  = "webpage-graph-auth";
const STATE_TTL_MS = 10 * 60 * 1000;

const pendingStates = new Map();

let dbReady = false;


function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function setRedirect(wo, url) {
  wo.http.response = { status: 302, headers: { Location: url, "Cache-Control": "no-store" }, body: "" };
}


async function getHttpPostForm(urlStr, formObj) {
  const { default: https } = await import("node:https");
  const { default: http  } = await import("node:http");
  const u    = new URL(urlStr);
  const body = new URLSearchParams(formObj).toString();
  const mod  = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === "https:" ? 443 : 80),
        path:     u.pathname + u.search,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end",  () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode || 0, body: buf, json });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}


async function getHttpGetJson(urlStr, headers = {}) {
  const { default: https } = await import("node:https");
  const { default: http  } = await import("node:http");
  const u   = new URL(urlStr);
  const mod = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.get(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === "https:" ? 443 : 80),
        path:     u.pathname + u.search,
        headers,
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end",  () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", reject);
  });
}


async function ensureTable(db) {
  if (dbReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_tokens (
      user_id          VARCHAR(64)   NOT NULL,
      ms_user_id       VARCHAR(128),
      ms_email         VARCHAR(256),
      ms_display_name  VARCHAR(256),
      access_token     MEDIUMTEXT    NOT NULL,
      refresh_token    MEDIUMTEXT,
      expires_at       BIGINT        NOT NULL,
      scope            TEXT,
      created_at       BIGINT        NOT NULL,
      updated_at       BIGINT        NOT NULL,
      PRIMARY KEY (user_id)
    ) CHARACTER SET utf8mb4
  `);
  dbReady = true;
}


async function getTokenRow(db, userId) {
  const [rows] = await db.query(
    "SELECT * FROM graph_tokens WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}


async function upsertToken(db, userId, fields) {
  const now = Date.now();
  await db.query(
    `INSERT INTO graph_tokens
       (user_id, ms_user_id, ms_email, ms_display_name, access_token, refresh_token, expires_at, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ms_user_id      = VALUES(ms_user_id),
       ms_email        = VALUES(ms_email),
       ms_display_name = VALUES(ms_display_name),
       access_token    = VALUES(access_token),
       refresh_token   = VALUES(refresh_token),
       expires_at      = VALUES(expires_at),
       scope           = VALUES(scope),
       updated_at      = VALUES(updated_at)`,
    [
      userId,
      fields.ms_user_id      || null,
      fields.ms_email        || null,
      fields.ms_display_name || null,
      fields.access_token,
      fields.refresh_token   || null,
      fields.expires_at,
      fields.scope           || null,
      now,
      now,
    ]
  );
}


function getPageHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f6f9;color:#1a202c;margin:0;padding:0}
  .wrap{max-width:480px;margin:80px auto;padding:24px;background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1)}
  h2{margin:0 0 20px;font-size:1.3rem}
  .info{background:#eef2ff;border-radius:6px;padding:14px;margin-bottom:18px}
  .info p{margin:4px 0;font-size:.92rem}
  .info strong{color:#3730a3}
  a.btn{display:inline-block;padding:9px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:.92rem;margin-top:4px}
  a.btn-primary{background:#5865f2;color:#fff}
  a.btn-primary:hover{background:#4752c4}
  a.btn-danger{background:#ef4444;color:#fff}
  a.btn-danger:hover{background:#dc2626}
  .muted{color:#6b7280;font-size:.88rem}
</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
</body>
</html>`;
}


async function handleStatus(wo, db, userId) {
  const row = await getTokenRow(db, userId);

  let body;
  if (row) {
    const name  = escHtml(row.ms_display_name || "");
    const email = escHtml(row.ms_email        || "");
    body =
      `<h2>Microsoft Account</h2>` +
      `<div class="info">` +
      (name  ? `<p><strong>${name}</strong></p>` : "") +
      (email ? `<p class="muted">${email}</p>`  : "") +
      `<p class="muted">Connected</p>` +
      `</div>` +
      `<a class="btn btn-danger" href="/graph-auth/disconnect">Disconnect</a>`;
  } else {
    body =
      `<h2>Microsoft Account</h2>` +
      `<p class="muted">No Microsoft account connected.</p>` +
      `<a class="btn btn-primary" href="/graph-auth/start">Connect Microsoft Account</a>`;
  }

  wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Microsoft Account", body) };
}


async function handleStart(wo, cfg) {
  const tenantId     = await getSecret(wo, cfg.auth?.tenantId     || "");
  const clientId     = await getSecret(wo, cfg.auth?.clientId     || "");
  const redirectUri  = await getSecret(wo, cfg.auth?.redirectUri  || "");
  const scope        = await getSecret(wo, cfg.auth?.scope        || "offline_access User.Read");

  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now());

  const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set("client_id",     clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri",  redirectUri);
  authUrl.searchParams.set("scope",         scope);
  authUrl.searchParams.set("state",         state);
  authUrl.searchParams.set("response_mode", "query");

  setRedirect(wo, authUrl.toString());
}


async function handleCallback(wo, cfg, db, userId, query) {
  const log   = getPrefixedLogger(wo, import.meta.url);
  const code  = String(query.code  || "").trim();
  const state = String(query.state || "").trim();
  const error = String(query.error || "").trim();

  if (error) {
    const desc = escHtml(String(query.error_description || error));
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Auth Error", `<h2>Authentication Error</h2><p>${desc}</p><a class="btn btn-primary" href="/graph-auth">Back</a>`) };
    return;
  }

  const stateTs = pendingStates.get(state);
  if (!stateTs || Date.now() - stateTs > STATE_TTL_MS) {
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Auth Error", `<h2>Invalid or expired state</h2><p>Please try again.</p><a class="btn btn-primary" href="/graph-auth/start">Retry</a>`) };
    return;
  }
  pendingStates.delete(state);

  for (const [s, ts] of pendingStates) {
    if (Date.now() - ts > STATE_TTL_MS) pendingStates.delete(s);
  }

  const tenantId      = await getSecret(wo, cfg.auth?.tenantId     || "");
  const clientId      = await getSecret(wo, cfg.auth?.clientId     || "");
  const clientSecret  = await getSecret(wo, cfg.auth?.clientSecret || "");
  const redirectUri   = await getSecret(wo, cfg.auth?.redirectUri  || "");
  const scope         = await getSecret(wo, cfg.auth?.scope        || "offline_access User.Read");

  let tokenResp;
  try {
    tokenResp = await getHttpPostForm(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        grant_type:    "authorization_code",
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code,
        scope,
      }
    );
  } catch (e) {
    log(`[${MODULE_NAME}] Token exchange error: ${e?.message || e}`, "error");
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Auth Error", `<h2>Token exchange failed</h2><p>Server error. Please try again.</p><a class="btn btn-primary" href="/graph-auth">Back</a>`) };
    return;
  }

  const tok = tokenResp.json;
  if (!tok?.access_token) {
    const desc = escHtml(String(tok?.error_description || tok?.error || "No access token returned"));
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Auth Error", `<h2>Token error</h2><p>${desc}</p><a class="btn btn-primary" href="/graph-auth">Back</a>`) };
    return;
  }

  let meData = null;
  try {
    meData = await getHttpGetJson(
      "https://graph.microsoft.com/v1.0/me?$select=id,mail,displayName",
      { Authorization: `Bearer ${tok.access_token}` }
    );
  } catch (e) {
    log(`[${MODULE_NAME}] /me error: ${e?.message || e}`, "error");
  }

  const expiresAt = Date.now() + (Number(tok.expires_in || 3600) * 1000);

  await upsertToken(db, userId, {
    ms_user_id:      meData?.id          || null,
    ms_email:        meData?.mail        || null,
    ms_display_name: meData?.displayName || null,
    access_token:    tok.access_token,
    refresh_token:   tok.refresh_token   || null,
    expires_at:      expiresAt,
    scope:           tok.scope           || scope,
  });

  setRedirect(wo, "/graph-auth");
}


async function handleDisconnect(wo, db, userId) {
  await db.query("DELETE FROM graph_tokens WHERE user_id = ?", [userId]);
  setRedirect(wo, "/graph-auth");
}


function getQueryParams(wo) {
  const rawPath = String(wo?.http?.path || "");
  const qIdx    = rawPath.indexOf("?");
  if (qIdx < 0) return {};
  const out = {};
  const qs  = rawPath.slice(qIdx + 1);
  for (const part of qs.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
  }
  return out;
}


function getCleanPath(wo) {
  const raw = String(wo?.http?.path || "");
  const q   = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}


export default async function webpageGraphAuth(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const log      = getPrefixedLogger(wo, import.meta.url);
  const port     = cfg.port || 3124;
  const woPort   = Number(wo?.http?.port);
  const cleanPath = getCleanPath(wo);

  if (woPort !== port) return coreData;
  if (!cleanPath.startsWith("/graph-auth")) return coreData;

  const userId = wo.webAuth?.userId || null;
  if (!userId) {
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Login Required", `<h2>Login Required</h2><p class="muted">You must be logged in to manage your Microsoft account connection.</p>`) };
    return coreData;
  }

  let db;
  try {
    db = await getDb(coreData);
    await ensureTable(db);
  } catch (e) {
    log(`[${MODULE_NAME}] DB error: ${e?.message || e}`, "error");
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Error", `<h2>Database error</h2><p>Could not connect to database.</p>`) };
    return coreData;
  }

  try {
    if (cleanPath === "/graph-auth" || cleanPath === "/graph-auth/") {
      await handleStatus(wo, db, userId);
    } else if (cleanPath === "/graph-auth/start") {
      await handleStart(wo, cfg);
    } else if (cleanPath === "/graph-auth/callback") {
      const query = getQueryParams(wo);
      await handleCallback(wo, cfg, db, userId, query);
    } else if (cleanPath === "/graph-auth/disconnect") {
      await handleDisconnect(wo, db, userId);
    }
  } catch (e) {
    log(`[${MODULE_NAME}] Handler error on ${cleanPath}: ${e?.message || e}`, "error");
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: getPageHtml("Error", `<h2>Unexpected error</h2><p>${escHtml(String(e?.message || e))}</p>`) };
  }

  return coreData;
}
