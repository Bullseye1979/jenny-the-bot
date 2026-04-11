/**************************************************************/
/* filename: "00069-webpage-oauth-connections.js"            */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                  */
/**************************************************************/
"use strict";

import crypto                                      from "node:crypto";
import { getPrefixedLogger }                       from "../core/logging.js";
import { getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import {
  getEnsureOAuthPool,
  ensureOAuthTables,
  listOAuthRegistrations,
  getOAuthRegistration,
  getOAuthToken,
  upsertOAuthToken,
  deleteOAuthToken,
  createOAuthAuthState,
  deleteOAuthAuthState,
  getOAuthAuthState,
  refreshUserToken
} from "../shared/oauth/oauth-manager.js";

const MODULE_NAME  = "webpage-oauth-connections";
const STATE_TTL_MS = 10 * 60 * 1000;


function setRedirect(wo, url) {
  wo.http.response = { status: 302, headers: { Location: url, "Cache-Control": "no-store" }, body: "" };
}


function getCleanPath(wo) {
  const raw = String(wo?.http?.path || "");
  const q   = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}


function getPageHtml(title, bodyHtml, menuHtml = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="/voice/style.css">
<style>
  .provider-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
  .provider-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;padding:18px 20px}
  .provider-name{font-size:1rem;font-weight:700;margin:0 0 4px}
  .provider-desc{font-size:.82rem;color:var(--muted);margin:0 0 14px;min-height:1.2em}
  .provider-scope{font-size:.77rem;color:var(--muted);margin-bottom:14px;font-family:monospace}
  .status-badge{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;font-weight:600;padding:4px 10px;border-radius:20px;margin-bottom:14px}
  .status-connected{background:#1e3d2a;color:#6ee7b7}
  .status-disconnected{background:var(--bg3,#2d2d40);color:var(--muted)}
  .expiry{font-size:.77rem;color:var(--muted);margin-bottom:14px}
  .btn{display:inline-block;padding:.38rem 1rem;border-radius:6px;font-size:.85rem;font-weight:600;cursor:pointer;border:none;text-decoration:none}
  .btn-primary{background:var(--acc,#5b5bd6);color:#fff}
  .btn-primary:hover{opacity:.85}
  .btn-danger{background:var(--dan,#ef4444);color:#fff}
  .btn-danger:hover{opacity:.85}
  .btn-secondary{background:var(--bg3,#3a3a50);color:var(--fg,#e2e2f0);border:1px solid var(--bdr)}
  .btn-secondary:hover{opacity:.85}
  .empty{color:var(--muted);font-size:.9rem;padding:32px 0}
</style>
</head>
<body>
<header><h1>&#128279; Connections</h1>${menuHtml}</header>
<div style="margin-top:var(--hh);padding:16px 20px;max-width:960px">
${bodyHtml}
</div>
</body>
</html>`;
}


function fmtExpiry(ms) {
  if (!ms) return "";
  const diff = Number(ms) - Date.now();
  if (diff < 0) return "Token expired";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Expires in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `Expires in ${hrs} h`;
  return `Expires in ${Math.floor(hrs / 24)} d`;
}


async function handleIndex(wo, pool, userId, menuHtml) {
  const allRegs = await listOAuthRegistrations(pool);
  const authCodeRegs = allRegs.filter((r) => r.flow === "auth_code");

  if (!authCodeRegs.length) {
    const body = `<p class="empty">No OAuth providers configured for user connections yet. Ask your administrator to add <code>auth_code</code> providers via the OAuth Manager.</p>`;
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Connections", body, menuHtml)
    };
    return;
  }

  const tokenChecks = await Promise.all(
    authCodeRegs.map((reg) => getOAuthToken(pool, reg.name, userId))
  );

  const cards = authCodeRegs.map((reg, i) => {
    const tok = tokenChecks[i];
    const isConnected = !!tok?.access_token;
    const expiryText  = isConnected ? fmtExpiry(tok.expires_at) : "";

    const statusBadge = isConnected
      ? `<span class="status-badge status-connected">&#10003; Connected</span>`
      : `<span class="status-badge status-disconnected">&#8226; Not connected</span>`;

    const canRenew  = isConnected && !!tok?.refresh_token;
    const renewBtn  = canRenew
      ? ` <a class="btn btn-secondary" href="/connections/${encodeURIComponent(reg.name)}/renew">Renew</a>`
      : "";
    const actionBtn = isConnected
      ? `<a class="btn btn-danger" href="/connections/${encodeURIComponent(reg.name)}/disconnect">Disconnect</a>${renewBtn}`
      : `<a class="btn btn-primary" href="/connections/${encodeURIComponent(reg.name)}/login">Connect</a>`;

    return `<div class="provider-card">
  <p class="provider-name">${escHtml(reg.name)}</p>
  <p class="provider-desc">${escHtml(reg.description || "")}</p>
  ${reg.scope ? `<p class="provider-scope">${escHtml(reg.scope)}</p>` : ""}
  ${statusBadge}
  ${expiryText ? `<p class="expiry">${escHtml(expiryText)}</p>` : ""}
  ${actionBtn}
</div>`;
  }).join("\n");

  const body = `<div class="provider-grid">${cards}</div>`;
  wo.http.response = {
    status:  200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body:    getPageHtml("Connections", body, menuHtml)
  };
}


async function handleLogin(wo, cfg, pool, userId, provider) {
  const reg = await getOAuthRegistration(pool, provider);
  if (!reg || reg.flow !== "auth_code") {
    wo.http.response = { status: 404, headers: { "Content-Type": "text/plain" }, body: "Provider not found" };
    return;
  }
  if (!reg.auth_url) {
    wo.http.response = { status: 400, headers: { "Content-Type": "text/plain" }, body: "Provider has no auth_url configured" };
    return;
  }

  const state     = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + STATE_TTL_MS;

  await createOAuthAuthState(pool, state, provider, userId, expiresAt);
  await pool.query("DELETE FROM oauth_auth_states WHERE expires_at < ?", [Date.now()]);

  const host        = String(wo.http?.headers?.host || wo.http?.headers?.Host || "");
  const redirectUri = cfg.redirectUriBase
    ? `${String(cfg.redirectUriBase).replace(/\/$/, "")}/${encodeURIComponent(provider)}/callback`
    : `https://${host}/connections/${encodeURIComponent(provider)}/callback`;

  const authUrl = new URL(String(reg.auth_url));
  authUrl.searchParams.set("client_id",     String(reg.client_id));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri",  redirectUri);
  authUrl.searchParams.set("state",         state);
  if (reg.scope) authUrl.searchParams.set("scope", String(reg.scope));

  setRedirect(wo, authUrl.toString());
}


async function handleCallback(wo, cfg, pool, userId, provider, query, menuHtml) {
  const log   = getPrefixedLogger(wo, import.meta.url);
  const code  = String(query.code  || "").trim();
  const state = String(query.state || "").trim();
  const error = String(query.error || "").trim();

  const errPage = (msg) => {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Auth Error", `<h2 style="margin-bottom:12px">Authentication Error</h2><p>${escHtml(msg)}</p><a class="btn btn-primary" href="/connections">Back to Connections</a>`, menuHtml)
    };
  };

  if (error) { errPage(String(query.error_description || error)); return; }
  if (!state) { errPage("Missing state parameter."); return; }

  const stateRow = await getOAuthAuthState(pool, state);
  if (!stateRow || Number(stateRow.expires_at) < Date.now()) {
    await deleteOAuthAuthState(pool, state).catch(() => {});
    errPage("Invalid or expired state. Please try again."); return;
  }
  if (String(stateRow.provider) !== provider) {
    errPage("State/provider mismatch. Please try again."); return;
  }

  await deleteOAuthAuthState(pool, state);
  await pool.query("DELETE FROM oauth_auth_states WHERE expires_at < ?", [Date.now()]);

  const reg = await getOAuthRegistration(pool, provider);
  if (!reg) { errPage("Provider not found."); return; }

  const host        = String(wo.http?.headers?.host || wo.http?.headers?.Host || "");
  const redirectUri = cfg.redirectUriBase
    ? `${String(cfg.redirectUriBase).replace(/\/$/, "")}/${encodeURIComponent(provider)}/callback`
    : `https://${host}/connections/${encodeURIComponent(provider)}/callback`;

  const body = new URLSearchParams({
    grant_type:   "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const auth = Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString("base64");

  let tokenResp;
  try {
    const resp = await fetch(String(reg.token_url), {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${auth}`
      },
      body: body.toString()
    });
    tokenResp = await resp.json().catch(() => null);
    if (!resp.ok || !tokenResp?.access_token) {
      log(`[${MODULE_NAME}] Token exchange failed (${resp.status}): ${JSON.stringify(tokenResp)}`, "error");
      errPage(`Token exchange failed: ${tokenResp?.error_description || tokenResp?.error || resp.status}`);
      return;
    }
  } catch (e) {
    log(`[${MODULE_NAME}] Token exchange error: ${e?.message || e}`, "error");
    errPage("Server error during token exchange. Please try again.");
    return;
  }

  const expiresAt = Date.now() + (Number(tokenResp.expires_in || 3600) * 1000);
  await upsertOAuthToken(pool, provider, userId, {
    accessToken:  tokenResp.access_token,
    refreshToken: tokenResp.refresh_token || null,
    expiresAt,
    scope:        tokenResp.scope || reg.scope || null
  });

  log(`[${MODULE_NAME}] Connected provider="${provider}" user="${userId}"`, "info");
  setRedirect(wo, "/connections");
}


async function handleDisconnect(wo, pool, userId, provider) {
  await deleteOAuthToken(pool, provider, userId);
  setRedirect(wo, "/connections");
}


async function handleRenew(wo, pool, userId, provider, menuHtml) {
  const log = getPrefixedLogger(wo, import.meta.url);

  const errPage = (msg) => {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Renew Error", `<h2 style="margin-bottom:12px">Renew Failed</h2><p>${escHtml(msg)}</p><a class="btn btn-primary" href="/connections">Back to Connections</a>`, menuHtml)
    };
  };

  const reg = await getOAuthRegistration(pool, provider);
  if (!reg || reg.flow !== "auth_code") { errPage("Provider not found."); return; }

  const tokenRow = await getOAuthToken(pool, provider, userId);
  if (!tokenRow) { errPage("No token found. Please connect first."); return; }
  if (!tokenRow.refresh_token) { errPage("No refresh token available. Please disconnect and reconnect."); return; }

  try {
    await refreshUserToken(pool, reg, tokenRow);
    log(`[${MODULE_NAME}] Renewed token for provider="${provider}" user="${userId}"`, "info");
  } catch (e) {
    log(`[${MODULE_NAME}] Renew failed for provider="${provider}" user="${userId}": ${e?.message || e}`, "error");
    errPage(`Token renewal failed: ${e?.message || e}`);
    return;
  }

  setRedirect(wo, "/connections");
}


export default async function webpageOauthConnections(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const port      = Number(cfg.port || 3131);
  const woPort    = Number(wo?.http?.port);
  const cleanPath = getCleanPath(wo);
  const base      = "/connections";

  if (woPort !== port)                 return coreData;
  if (!cleanPath.startsWith(base))     return coreData;

  const log    = getPrefixedLogger(wo, import.meta.url);
  const method = String(wo?.http?.method || "GET").toUpperCase();
  const userId = wo.webAuth?.userId || null;

  const menuHtml = getMenuHtml(wo.web?.menu || [], cleanPath, wo.webAuth?.role || "", null, null, wo.webAuth);

  if (!userId) {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Login Required", `<h2 style="margin-bottom:12px">Login Required</h2><p>You must be logged in to manage your connections.</p>`, menuHtml)
    };
    return coreData;
  }

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
    await ensureOAuthTables(pool);
  } catch (e) {
    log(`[${MODULE_NAME}] DB error: ${e?.message || e}`, "error");
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Error", `<h2>Database error</h2><p>Could not connect to database.</p>`, menuHtml)
    };
    return coreData;
  }

  const providerMatch = cleanPath.match(/^\/connections\/([^/]+)\/(login|callback|disconnect|renew)$/);

  try {
    if (cleanPath === base || cleanPath === base + "/") {
      await handleIndex(wo, pool, userId, menuHtml);

    } else if (providerMatch) {
      const provider = decodeURIComponent(providerMatch[1]);
      const action   = providerMatch[2];

      if (action === "login") {
        await handleLogin(wo, cfg, pool, userId, provider);
      } else if (action === "callback") {
        const query = wo.http.query || {};
        await handleCallback(wo, cfg, pool, userId, provider, query, menuHtml);
      } else if (action === "disconnect") {
        await handleDisconnect(wo, pool, userId, provider);
      } else if (action === "renew") {
        await handleRenew(wo, pool, userId, provider, menuHtml);
      }
    }
  } catch (e) {
    log(`[${MODULE_NAME}] Handler error on ${cleanPath}: ${e?.message || e}`, "error");
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getPageHtml("Error", `<h2>Unexpected error</h2><p>${escHtml(String(e?.message || e))}</p>`, menuHtml)
    };
  }

  return coreData;
}
