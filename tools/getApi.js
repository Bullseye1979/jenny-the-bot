/**************************************************************/
/* filename: "getApi.js"                                     */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { fetchWithTimeout }                              from "../core/fetch.js";
import { getSecret }                                     from "../core/secrets.js";
import { getPrefixedLogger }                             from "../core/logging.js";
import {
  getEnsureOAuthPool,
  ensureOAuthTables,
  getOAuthRegistration,
  getOAuthToken,
  refreshClientCredentialsToken,
  refreshUserToken
} from "../shared/oauth/oauth-manager.js";

const MODULE_NAME        = "getApi";
const DEFAULT_TIMEOUT_MS = 30000;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);


async function resolveAuthHeader(authType, authName, wo, pool) {
  const type = String(authType || "none").toLowerCase();

  if (type === "none" || !authName) return {};

  if (type === "apikey") {
    const key = await getSecret(wo, String(authName));
    if (!key) throw new Error(`No secret found for authName "${authName}"`);
    return { Authorization: `Bearer ${key}` };
  }

  if (type === "basic") {
    const creds = await getSecret(wo, String(authName));
    if (!creds) throw new Error(`No credentials found for authName "${authName}"`);
    const b64 = Buffer.from(String(creds)).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }

  if (type === "oauth_cc") {
    await ensureOAuthTables(pool);
    const reg = await getOAuthRegistration(pool, String(authName));
    if (!reg) throw new Error(`No OAuth registration found for "${authName}"`);

    let tokenRow = await getOAuthToken(pool, String(authName), "__service__");
    const needsRefresh = !tokenRow || Number(tokenRow.expires_at || 0) < Date.now() + 60000;

    if (needsRefresh) {
      const result = await refreshClientCredentialsToken(pool, reg);
      return { Authorization: `Bearer ${result.accessToken}` };
    }

    return { Authorization: `Bearer ${tokenRow.access_token}` };
  }

  if (type === "oauth_user") {
    const userId    = String(wo?.userId    || "");
    const channelId = String(wo?.channelId || "");

    await ensureOAuthTables(pool);
    const reg = await getOAuthRegistration(pool, String(authName));
    if (!reg) throw new Error(`No OAuth registration found for "${authName}"`);

    let tokenRow = userId ? await getOAuthToken(pool, String(authName), userId) : null;
    if (!tokenRow && channelId) {
      const [rows] = await pool.query(
        "SELECT * FROM oauth_tokens WHERE provider = ? AND delegate_channels IS NOT NULL AND JSON_CONTAINS(delegate_channels, JSON_QUOTE(?)) LIMIT 1",
        [String(authName), channelId]
      );
      tokenRow = rows?.[0] || null;
    }
    if (!tokenRow) throw new Error(`No token for provider "${authName}" and current user. User must connect via /connections.`);

    const needsRefresh = Number(tokenRow.expires_at || 0) < Date.now() + 60000;
    if (needsRefresh && tokenRow.refresh_token) {
      const result = await refreshUserToken(pool, reg, tokenRow);
      return { Authorization: `Bearer ${result.accessToken}` };
    }
    if (needsRefresh) throw new Error(`Token for provider "${authName}" has expired. User must reconnect via /connections.`);

    return { Authorization: `Bearer ${tokenRow.access_token}` };
  }

  throw new Error(`Unknown authType "${authType}". Supported: none, apiKey, basic, oauth_cc, oauth_user`);
}


function parseBody(body) {
  if (body == null || body === "") return undefined;
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
}


function parseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers === "object") return headers;
  try { return JSON.parse(String(headers)); } catch { return {}; }
}


async function parseResponse(resp, responseType) {
  const type = String(responseType || "auto").toLowerCase();
  if (type === "text") return { body: await resp.text() };
  if (type === "json") {
    const text = await resp.text();
    try { return { body: JSON.parse(text) }; } catch { return { body: text }; }
  }
  const contentType = String(resp.headers.get("content-type") || "");
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    const text = await resp.text();
    try { return { body: JSON.parse(text) }; } catch { return { body: text }; }
  }
  return { body: await resp.text() };
}


async function getInvoke(args, coreData) {
  const { url, method, authType, authName, body, headers, responseType } = args || {};
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const urlStr    = String(url    || "").trim();
  const methodStr = String(method || "GET").toUpperCase();
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  if (!urlStr)                         return { ok: false, error: "url is required" };
  if (!ALLOWED_METHODS.has(methodStr)) return { ok: false, error: `method must be one of: ${[...ALLOWED_METHODS].join(", ")}` };

  let pool;
  try {
    pool = await getEnsureOAuthPool(wo);
  } catch (e) {
    if (["oauth_cc", "oauth_user"].includes(String(authType || "").toLowerCase())) {
      return { ok: false, error: `DB connection failed: ${e?.message || e}` };
    }
  }

  let authHeader;
  try {
    authHeader = await resolveAuthHeader(authType, authName, wo, pool);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  const extraHeaders = parseHeaders(headers);
  const bodyStr      = parseBody(body);
  const reqHeaders   = { ...extraHeaders, ...authHeader };

  if (bodyStr !== undefined && !reqHeaders["Content-Type"] && !reqHeaders["content-type"]) {
    reqHeaders["Content-Type"] = "application/json";
  }

  log(`[${MODULE_NAME}] ${methodStr} ${urlStr}`, "info");

  let resp;
  try {
    const fetchOpts = { method: methodStr, headers: reqHeaders };
    if (bodyStr !== undefined) fetchOpts.body = bodyStr;
    resp = await fetchWithTimeout(urlStr, fetchOpts, timeoutMs);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  const { body: parsedBody } = await parseResponse(resp, responseType);

  if (!resp.ok) {
    return { ok: false, status: resp.status, error: `HTTP ${resp.status}`, body: parsedBody };
  }

  return { ok: true, status: resp.status, body: parsedBody };
}


export default { name: MODULE_NAME, invoke: getInvoke };
