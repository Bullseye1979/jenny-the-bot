/**************************************************************/
/* filename: "oauth-manager.js"                              */
/* Version 1.0                                               */
/* Purpose: Shared helpers for generic OAuth2 token and      */
/*          registration persistence.                        */
/**************************************************************/

import mysql from "mysql2/promise";

let _pool    = null;
let _poolDsn = "";


function getDsnKey(db) {
  return `${db.host}|${db.port ?? 3306}|${db.user}|${db.database}`;
}


export async function getEnsureOAuthPool(wo) {
  const db = wo?.db;
  if (!db) throw new Error("[oauth-manager] missing db config");
  const key = getDsnKey(db);
  if (_pool && _poolDsn === key) return _pool;
  _pool = mysql.createPool({
    host:               db.host,
    port:               db.port ?? 3306,
    user:               db.user,
    password:           db.password,
    database:           db.database,
    charset:            db.charset || "utf8mb4",
    waitForConnections: true,
    connectionLimit:    5
  });
  _poolDsn = key;
  return _pool;
}


export async function ensureOAuthTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS oauth_registrations (
    name          VARCHAR(64)  NOT NULL,
    flow          VARCHAR(32)  NOT NULL,
    token_url     TEXT         NOT NULL,
    auth_url      TEXT         NULL,
    client_id     TEXT         NOT NULL,
    client_secret TEXT         NOT NULL,
    scope         TEXT         NULL,
    description   VARCHAR(255) NULL,
    created_at    BIGINT       NOT NULL,
    updated_at    BIGINT       NOT NULL,
    PRIMARY KEY (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider          VARCHAR(64)  NOT NULL,
    user_id           VARCHAR(64)  NOT NULL,
    access_token      MEDIUMTEXT   NOT NULL,
    refresh_token     MEDIUMTEXT   NULL,
    expires_at        BIGINT       NOT NULL,
    scope             TEXT         NULL,
    updated_at        BIGINT       NOT NULL,
    delegate_channels TEXT         NULL,
    PRIMARY KEY (provider, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS delegate_channels TEXT DEFAULT NULL`);

  await pool.query(`CREATE TABLE IF NOT EXISTS oauth_auth_states (
    state_token   VARCHAR(64)  NOT NULL,
    provider      VARCHAR(64)  NOT NULL,
    user_id       VARCHAR(64)  NOT NULL,
    created_at    BIGINT       NOT NULL,
    expires_at    BIGINT       NOT NULL,
    PRIMARY KEY (state_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}


export async function getOAuthRegistration(pool, name) {
  const [rows] = await pool.query(
    "SELECT * FROM oauth_registrations WHERE name = ?",
    [name]
  );
  return rows?.[0] || null;
}


export async function listOAuthRegistrations(pool) {
  const [rows] = await pool.query(
    "SELECT * FROM oauth_registrations ORDER BY name"
  );
  return rows || [];
}


export async function upsertOAuthRegistration(pool, reg) {
  const now = Date.now();
  await pool.query(
    `INSERT INTO oauth_registrations
       (name, flow, token_url, auth_url, client_id, client_secret, scope, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       flow          = VALUES(flow),
       token_url     = VALUES(token_url),
       auth_url      = VALUES(auth_url),
       client_id     = VALUES(client_id),
       client_secret = VALUES(client_secret),
       scope         = VALUES(scope),
       description   = VALUES(description),
       updated_at    = VALUES(updated_at)`,
    [
      String(reg.name          || ""),
      String(reg.flow          || "client_credentials"),
      String(reg.tokenUrl      || ""),
      reg.authUrl      ? String(reg.authUrl)      : null,
      String(reg.clientId      || ""),
      String(reg.clientSecret  || ""),
      reg.scope        ? String(reg.scope)        : null,
      reg.description  ? String(reg.description)  : null,
      now,
      now
    ]
  );
}


export async function deleteOAuthRegistration(pool, name) {
  await pool.query("DELETE FROM oauth_registrations WHERE name = ?", [name]);
  await deleteOAuthTokens(pool, name);
}


export async function getOAuthToken(pool, provider, userId) {
  const [rows] = await pool.query(
    "SELECT * FROM oauth_tokens WHERE provider = ? AND user_id = ?",
    [provider, userId]
  );
  return rows?.[0] || null;
}


export async function upsertOAuthToken(pool, provider, userId, tokenData) {
  await pool.query(
    `INSERT INTO oauth_tokens
       (provider, user_id, access_token, refresh_token, expires_at, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token  = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       expires_at    = VALUES(expires_at),
       scope         = VALUES(scope),
       updated_at    = VALUES(updated_at)`,
    [
      String(provider),
      String(userId),
      String(tokenData.accessToken   || ""),
      tokenData.refreshToken ? String(tokenData.refreshToken) : null,
      Number(tokenData.expiresAt     || 0),
      tokenData.scope ? String(tokenData.scope) : null,
      Date.now()
    ]
  );
}


export async function updateOAuthTokenDelegation(pool, provider, userId, channels) {
  await pool.query(
    "UPDATE oauth_tokens SET delegate_channels = ? WHERE provider = ? AND user_id = ?",
    [channels?.length ? JSON.stringify(channels) : null, String(provider), String(userId)]
  );
}


export async function deleteOAuthTokens(pool, provider) {
  await pool.query("DELETE FROM oauth_tokens WHERE provider = ?", [provider]);
}


export async function deleteOAuthToken(pool, provider, userId) {
  await pool.query(
    "DELETE FROM oauth_tokens WHERE provider = ? AND user_id = ?",
    [provider, userId]
  );
}


export async function listOAuthTokens(pool) {
  const [rows] = await pool.query(
    "SELECT provider, user_id, expires_at, scope, updated_at FROM oauth_tokens ORDER BY provider, user_id"
  );
  return rows || [];
}


export async function listOAuthTokensExpiringSoon(pool, cutoffMs) {
  const [rows] = await pool.query(
    "SELECT * FROM oauth_tokens WHERE expires_at < ? AND refresh_token IS NOT NULL",
    [cutoffMs]
  );
  return rows || [];
}


export async function getOAuthAuthState(pool, stateToken) {
  const [rows] = await pool.query(
    "SELECT * FROM oauth_auth_states WHERE state_token = ?",
    [stateToken]
  );
  return rows?.[0] || null;
}


export async function createOAuthAuthState(pool, stateToken, provider, userId, expiresAt) {
  await pool.query(
    "INSERT INTO oauth_auth_states (state_token, provider, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [stateToken, provider, userId, Date.now(), expiresAt]
  );
}


export async function deleteOAuthAuthState(pool, stateToken) {
  await pool.query(
    "DELETE FROM oauth_auth_states WHERE state_token = ?",
    [stateToken]
  );
}


export async function refreshClientCredentialsToken(pool, reg) {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (reg.scope) body.set("scope", String(reg.scope));

  const auth = Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString("base64");

  const resp = await fetch(String(reg.token_url), {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token endpoint returned ${resp.status}: ${text}`);
  }

  const tok = await resp.json();
  if (!tok?.access_token) {
    throw new Error(`No access_token in response: ${JSON.stringify(tok)}`);
  }

  const expiresAt = Date.now() + (Number(tok.expires_in || 3600) * 1000);

  await upsertOAuthToken(pool, String(reg.name), "__service__", {
    accessToken:  tok.access_token,
    refreshToken: tok.refresh_token || null,
    expiresAt,
    scope:        tok.scope || reg.scope || null
  });

  return { accessToken: tok.access_token, expiresAt };
}


export async function refreshUserToken(pool, reg, row) {
  if (!row.refresh_token) throw new Error("No refresh_token available");

  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: String(row.refresh_token)
  });

  const auth = Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString("base64");

  const resp = await fetch(String(reg.token_url), {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token endpoint returned ${resp.status}: ${text}`);
  }

  const tok = await resp.json();
  if (!tok?.access_token) {
    throw new Error(`No access_token in response: ${JSON.stringify(tok)}`);
  }

  const expiresAt = Date.now() + (Number(tok.expires_in || 3600) * 1000);

  await upsertOAuthToken(pool, String(reg.name), String(row.user_id), {
    accessToken:  tok.access_token,
    refreshToken: tok.refresh_token || null,
    expiresAt,
    scope:        tok.scope || null
  });

  return { accessToken: tok.access_token, expiresAt };
}
