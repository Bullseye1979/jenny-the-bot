/**********************************************************************************/
/* filename: getGraph.js                                                          */
/* Version 1.0                                                                    */
/* Purpose: Microsoft Graph API tool — SharePoint files, OneDrive, Exchange mail, */
/*          Azure AD users and generic Graph API access.                          */
/*          Auto-discovers siteId (from configured hostname) and driveId (from    */
/*          site or user) so only auth credentials plus an optional defaultUserId */
/*          or defaultSharePointHostname need to be configured.                   */
/*          All operations return { ok, error } instead of throwing so the AI    */
/*          always receives a structured response even when IDs are missing.      */
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "getGraph";
const GRAPH_BASE = "https://graph.microsoft.com";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_TIMEOUT_MS = 30000;
const SMALL_UPLOAD_LIMIT = 4 * 1024 * 1024;
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

const discoveryCache = new Map();


/**********************************************************************************/
/* getStr                                                                         */
/**********************************************************************************/
function getStr(v, f = "") {
  return typeof v === "string" && v.length ? v : f;
}


/**********************************************************************************/
/* getNum                                                                         */
/**********************************************************************************/
function getNum(v, f = 0) {
  return Number.isFinite(v) ? Number(v) : f;
}


/**********************************************************************************/
/* getBool                                                                        */
/**********************************************************************************/
function getBool(v, f = false) {
  return typeof v === "boolean" ? v : f;
}


/**********************************************************************************/
/* getArr                                                                         */
/**********************************************************************************/
function getArr(v, f = []) {
  return Array.isArray(v) ? v : f;
}


/**********************************************************************************/
/* getObj                                                                         */
/**********************************************************************************/
function getObj(v, f = {}) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : f;
}


/**********************************************************************************/
/* getClamp                                                                       */
/**********************************************************************************/
function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? Number(n) : min;
  return Math.max(min, Math.min(max, x));
}


/**********************************************************************************/
/* getJoinUrl                                                                     */
/**********************************************************************************/
function getJoinUrl(baseUrl, path) {
  const root = String(baseUrl || GRAPH_BASE).replace(/\/+$/, "");
  const p = String(path || "").trim();
  if (!p) return root;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return `${root}/${p.replace(/^\/+/, "")}`;
}


/**********************************************************************************/
/* getBuildUrl                                                                    */
/**********************************************************************************/
function getBuildUrl(baseUrl, path, query) {
  const url = new URL(getJoinUrl(baseUrl, path));
  const q = getObj(query, {});
  for (const [key, value] of Object.entries(q)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}


/**********************************************************************************/
/* getHeaders                                                                     */
/**********************************************************************************/
function getHeaders(baseHeaders, extraHeaders) {
  return { ...getObj(baseHeaders, {}), ...getObj(extraHeaders, {}) };
}


/**********************************************************************************/
/* getGraphRelativeUrl                                                            */
/**********************************************************************************/
function getGraphRelativeUrl(path, query = {}) {
  const url = new URL(getBuildUrl("https://graph.local", path, query));
  return `${url.pathname}${url.search}`;
}


/**********************************************************************************/
/* getDecodeBase64ToBytes                                                         */
/**********************************************************************************/
function getDecodeBase64ToBytes(input) {
  return Buffer.from(String(input || "").replace(/\s+/g, ""), "base64");
}


/**********************************************************************************/
/* getIsProbablyTextContentType                                                   */
/**********************************************************************************/
function getIsProbablyTextContentType(contentType) {
  const v = getStr(contentType, "").toLowerCase();
  return v.startsWith("text/") || v.includes("json") || v.includes("xml") || v.includes("javascript") || v.includes("csv");
}


/**********************************************************************************/
/* getFetch                                                                       */
/**********************************************************************************/
async function getFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), data };
  } finally {
    clearTimeout(timer);
  }
}


/**********************************************************************************/
/* getFetchBinary                                                                 */
/**********************************************************************************/
async function getFetchBinary(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), bytes };
  } finally {
    clearTimeout(timer);
  }
}


/**********************************************************************************/
/* getMaybeSecretValue                                                            */
/**********************************************************************************/
async function getMaybeSecretValue(wo, value) {
  const raw = getStr(value, "");
  if (!raw) return "";
  return getStr(await getSecret(wo, raw), raw);
}


/**********************************************************************************/
/* getNormalizeToolConfig                                                         */
/**********************************************************************************/
async function getNormalizeToolConfig(wo, rawToolCfg) {
  const toolCfg = getObj(rawToolCfg, {});
  const auth = getObj(toolCfg.auth, {});

  return {
    ...toolCfg,
    baseUrl: getStr(toolCfg.baseUrl, GRAPH_BASE),
    version: getStr(toolCfg.version, "v1.0"),
    timeoutMs: getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS),
    defaultPageSize: getNum(toolCfg.defaultPageSize, 25),
    defaultEntityTypes: getArr(toolCfg.defaultEntityTypes, ["driveItem", "message"]),

    defaultUserId: await getMaybeSecretValue(wo, getStr(toolCfg.defaultUserId, "")),
    defaultSiteId: await getMaybeSecretValue(wo, getStr(toolCfg.defaultSiteId, getStr(toolCfg.siteId, ""))),
    defaultDriveId: await getMaybeSecretValue(wo, getStr(toolCfg.defaultDriveId, getStr(toolCfg.driveId, ""))),
    defaultMailFolderId: await getMaybeSecretValue(wo, getStr(toolCfg.defaultMailFolderId, getStr(toolCfg.mailFolderId, ""))),
    defaultDestinationFolderId: await getMaybeSecretValue(wo, getStr(toolCfg.defaultDestinationFolderId, getStr(toolCfg.destinationFolderId, ""))),
    defaultSharePointHostname: await getMaybeSecretValue(wo, getStr(toolCfg.defaultSharePointHostname, "")),

    forcedUserId: await getMaybeSecretValue(wo, getStr(toolCfg.forcedUserId, "")),
    forcedSiteId: await getMaybeSecretValue(wo, getStr(toolCfg.forcedSiteId, "")),
    forcedDriveId: await getMaybeSecretValue(wo, getStr(toolCfg.forcedDriveId, "")),
    forcedMailFolderId: await getMaybeSecretValue(wo, getStr(toolCfg.forcedMailFolderId, "")),
    forcedDestinationFolderId: await getMaybeSecretValue(wo, getStr(toolCfg.forcedDestinationFolderId, "")),

    auth: {
      tenantId: await getMaybeSecretValue(wo, getStr(auth.tenantId, getStr(toolCfg.tenantId, ""))),
      clientId: await getMaybeSecretValue(wo, getStr(auth.clientId, getStr(toolCfg.clientId, ""))),
      clientSecret: await getMaybeSecretValue(wo, getStr(auth.clientSecret, getStr(toolCfg.clientSecret, ""))),
      scope: getStr(auth.scope, getStr(toolCfg.scope, GRAPH_SCOPE)),
      tokenUrl: getStr(auth.tokenUrl, "")
    }
  };
}


/**********************************************************************************/
/* getApplyConfiguredIds                                                          */
/**********************************************************************************/
function getApplyConfiguredIds(args, toolCfg) {
  const nextArgs = JSON.parse(JSON.stringify(getObj(args, {})));

  if (!getStr(nextArgs.userId, "") && getStr(toolCfg.defaultUserId, "")) nextArgs.userId = toolCfg.defaultUserId;
  if (!getStr(nextArgs.driveId, "") && getStr(toolCfg.defaultDriveId, "")) nextArgs.driveId = toolCfg.defaultDriveId;
  if (!getStr(nextArgs.siteId, "") && getStr(toolCfg.defaultSiteId, "")) nextArgs.siteId = toolCfg.defaultSiteId;
  if (!getStr(nextArgs.mailFolderId, "") && getStr(toolCfg.defaultMailFolderId, "")) nextArgs.mailFolderId = toolCfg.defaultMailFolderId;
  if (!getStr(nextArgs.destinationFolderId, "") && getStr(toolCfg.defaultDestinationFolderId, "")) nextArgs.destinationFolderId = toolCfg.defaultDestinationFolderId;

  if (getStr(toolCfg.forcedUserId, "")) nextArgs.userId = toolCfg.forcedUserId;
  if (getStr(toolCfg.forcedDriveId, "")) nextArgs.driveId = toolCfg.forcedDriveId;
  if (getStr(toolCfg.forcedSiteId, "")) nextArgs.siteId = toolCfg.forcedSiteId;
  if (getStr(toolCfg.forcedMailFolderId, "")) nextArgs.mailFolderId = toolCfg.forcedMailFolderId;
  if (getStr(toolCfg.forcedDestinationFolderId, "")) nextArgs.destinationFolderId = toolCfg.forcedDestinationFolderId;

  if (Array.isArray(nextArgs.items)) {
    nextArgs.items = nextArgs.items.map(item => {
      const nextItem = { ...getObj(item, {}) };
      if (!getStr(nextItem.userId, "") && getStr(toolCfg.defaultUserId, "")) nextItem.userId = toolCfg.defaultUserId;
      if (!getStr(nextItem.driveId, "") && getStr(toolCfg.defaultDriveId, "")) nextItem.driveId = toolCfg.defaultDriveId;
      if (!getStr(nextItem.siteId, "") && getStr(toolCfg.defaultSiteId, "")) nextItem.siteId = toolCfg.defaultSiteId;
      if (getStr(toolCfg.forcedUserId, "")) nextItem.userId = toolCfg.forcedUserId;
      if (getStr(toolCfg.forcedDriveId, "")) nextItem.driveId = toolCfg.forcedDriveId;
      if (getStr(toolCfg.forcedSiteId, "")) nextItem.siteId = toolCfg.forcedSiteId;
      return nextItem;
    });
  }

  return nextArgs;
}


/**********************************************************************************/
/* Resolve helpers                                                                */
/**********************************************************************************/
function getResolveUserId(args, toolCfg) {
  return getStr(args?.userId, getStr(toolCfg.defaultUserId, ""));
}

function getResolveDriveId(args, toolCfg) {
  return getStr(args?.driveId, getStr(toolCfg.defaultDriveId, ""));
}

function getResolveSiteId(args, toolCfg) {
  return getStr(args?.siteId, getStr(toolCfg.defaultSiteId, ""));
}

function getResolveMailFolderId(args, toolCfg) {
  return getStr(args?.mailFolderId, getStr(toolCfg.defaultMailFolderId, ""));
}

function getResolveDestinationFolderId(args, toolCfg) {
  return getStr(args?.destinationFolderId, getStr(toolCfg.defaultDestinationFolderId, ""));
}

function getResolveApiVersion(args, toolCfg) {
  return getStr(args?.version, getStr(toolCfg.version, "v1.0"));
}

function getResolveBaseUrl(toolCfg, version) {
  const baseRoot = getStr(toolCfg.baseUrl, GRAPH_BASE).replace(/\/+$/, "");
  const v = String(version || "v1.0").replace(/^\/+/, "");
  return `${baseRoot}/${v}`;
}

function getSearchEntityTypes(args, toolCfg) {
  const fallback = getArr(toolCfg.defaultEntityTypes, ["driveItem", "message"]);
  const raw = getArr(args?.entityTypes, fallback).map(v => getStr(v, "").trim()).filter(Boolean);
  return raw.length ? raw : fallback;
}

function getResolveStorageScope(args, toolCfg) {
  const raw = getStr(args?.storageScope, "").toLowerCase();
  if (raw === "sharepoint") return "sharepoint";
  if (raw === "onedrive") return "onedrive";
  if (raw === "drive") return "drive";
  if (getStr(args?.driveId, "") || getStr(toolCfg.forcedDriveId, "") || getStr(toolCfg.defaultDriveId, "")) return "drive";
  if (getStr(args?.siteId, "") || getStr(toolCfg.forcedSiteId, "")) return "sharepoint";
  if (getStr(args?.userId, "") || getStr(toolCfg.forcedUserId, "") || getStr(toolCfg.defaultUserId, "")) return "onedrive";
  if (getStr(toolCfg.defaultSiteId, "") || getStr(toolCfg.defaultSharePointHostname, "")) return "sharepoint";
  return "onedrive";
}

function getResolveSharePointSiteBase(args, toolCfg) {
  const siteId = getResolveSiteId(args, toolCfg);
  if (siteId) return `/sites/${encodeURIComponent(siteId)}`;
  const hostname = getStr(toolCfg.defaultSharePointHostname, "");
  if (hostname) return `/sites/${encodeURIComponent(hostname)}`;
  return "/sites/root";
}


/**********************************************************************************/
/* getResolveDriveItemPath                                                        */
/* Returns null when no stable target can be resolved (never throws).            */
/**********************************************************************************/
function getResolveDriveItemPath(args, toolCfg) {
  const userId = getResolveUserId(args, toolCfg);
  const driveId = getResolveDriveId(args, toolCfg);
  const itemId = getStr(args.itemId, "");
  const filePath = getStr(args.path, "");
  const scope = getResolveStorageScope(args, toolCfg);

  if (driveId && itemId) return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  if (driveId && filePath) return `/drives/${encodeURIComponent(driveId)}/root:/${filePath.replace(/^\/+/, "")}`;
  if (driveId) return `/drives/${encodeURIComponent(driveId)}/root`;

  if (scope === "sharepoint") {
    const siteBase = getResolveSharePointSiteBase(args, toolCfg);
    if (itemId) return `${siteBase}/drive/items/${encodeURIComponent(itemId)}`;
    if (filePath) return `${siteBase}/drive/root:/${filePath.replace(/^\/+/, "")}`;
    return `${siteBase}/drive/root`;
  }

  if (userId && itemId) return `/users/${encodeURIComponent(userId)}/drive/items/${encodeURIComponent(itemId)}`;
  if (userId && filePath) return `/users/${encodeURIComponent(userId)}/drive/root:/${filePath.replace(/^\/+/, "")}`;
  if (userId) return `/users/${encodeURIComponent(userId)}/drive/root`;

  return null;
}


/**********************************************************************************/
/* getResolveUploadRootPath                                                       */
/* Returns null when no stable target can be resolved (never throws).            */
/**********************************************************************************/
function getResolveUploadRootPath(args, toolCfg) {
  const userId = getResolveUserId(args, toolCfg);
  const driveId = getResolveDriveId(args, toolCfg);
  const scope = getResolveStorageScope(args, toolCfg);

  if (driveId) return `/drives/${encodeURIComponent(driveId)}`;
  if (scope === "sharepoint") return `${getResolveSharePointSiteBase(args, toolCfg)}/drive`;
  if (userId) return `/users/${encodeURIComponent(userId)}/drive`;

  return null;
}


/**********************************************************************************/
/* getResolveFolderPath                                                           */
/**********************************************************************************/
function getResolveFolderPath(args, toolCfg) {
  const base = getResolveDriveItemPath(args, toolCfg);
  if (!base) return null;
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 25)), 1, 999);
  return {
    path: `${base}/children`,
    query: {
      $top: top,
      $select: getStr(args.select, "id,name,size,file,folder,webUrl,lastModifiedDateTime,parentReference")
    }
  };
}


/**********************************************************************************/
/* getBuildSearchRequest                                                          */
/**********************************************************************************/
function getBuildSearchRequest(args, toolCfg) {
  const queryText = getStr(args.query, "").trim();
  if (!queryText) return null;
  const size = getClamp(getNum(args.size, getNum(toolCfg.defaultPageSize, 10)), 1, 100);
  const from = getClamp(getNum(args.from, 0), 0, 10000);
  const entityTypes = getSearchEntityTypes(args, toolCfg);
  return { requests: [{ entityTypes, query: { queryString: queryText }, from, size }] };
}


/**********************************************************************************/
/* getNormalizeMessageBodyPreference                                              */
/**********************************************************************************/
function getNormalizeMessageBodyPreference(args) {
  return getStr(args.bodyType, "text").toLowerCase() === "html" ? "html" : "text";
}


/**********************************************************************************/
/* getExtractBatchResponses                                                       */
/**********************************************************************************/
function getExtractBatchResponses(batchRes) {
  return getArr(batchRes?.data?.responses, []).map(item => ({
    id: item.id,
    status: item.status,
    headers: item.headers || {},
    body: item.body ?? null
  }));
}


/**********************************************************************************/
/* getAccessToken                                                                 */
/**********************************************************************************/
async function getAccessToken(toolCfg) {
  const auth = getObj(toolCfg.auth, {});
  const tenantId = getStr(auth.tenantId, "");
  const clientId = getStr(auth.clientId, "");
  const clientSecret = getStr(auth.clientSecret, "");
  const scope = getStr(auth.scope, GRAPH_SCOPE);
  const tokenUrl = getStr(auth.tokenUrl, tenantId ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token` : "");

  if (!tenantId) throw new Error("Missing toolsconfig.getGraph.auth.tenantId");
  if (!clientId) throw new Error("Missing toolsconfig.getGraph.auth.clientId");
  if (!clientSecret) throw new Error("Missing toolsconfig.getGraph.auth.clientSecret");
  if (!tokenUrl) throw new Error("Cannot derive Graph token URL — tenantId missing");

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("scope", scope);

  const tokenRes = await getFetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  }, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));

  if (!tokenRes.ok) {
    const detail = typeof tokenRes.data === "string" ? tokenRes.data : JSON.stringify(tokenRes.data || null);
    throw new Error(`Graph token request failed: HTTP ${tokenRes.status} ${tokenRes.statusText} — ${detail}`);
  }

  const token = getStr(tokenRes?.data?.access_token, "");
  if (!token) throw new Error("Graph token response did not include access_token");
  return token;
}


/**********************************************************************************/
/* getGraphRequest                                                                */
/**********************************************************************************/
async function getGraphRequest(toolCfg, req = {}) {
  const timeoutMs = getNum(req.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));
  const token = getStr(req.accessToken, "") || await getAccessToken(toolCfg);
  const method = getStr(req.method, "GET").toUpperCase();
  const headers = getHeaders({ Authorization: `Bearer ${token}`, Accept: "application/json" }, req.headers);
  const body = req.body;
  const url = getBuildUrl(req.baseUrl || toolCfg.baseUrl || GRAPH_BASE, req.path, req.query);

  let finalBody = body;
  if (body !== undefined && body !== null && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  const res = await getFetch(url, { method, headers, body: finalBody }, timeoutMs);
  return { ok: res.ok, status: res.status, statusText: res.statusText, headers: res.headers, data: res.data };
}


/**********************************************************************************/
/* getGraphBinaryRequest                                                          */
/**********************************************************************************/
async function getGraphBinaryRequest(toolCfg, req = {}) {
  const timeoutMs = getNum(req.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));
  const token = getStr(req.accessToken, "") || await getAccessToken(toolCfg);
  const method = getStr(req.method, "GET").toUpperCase();
  const headers = getHeaders({ Authorization: `Bearer ${token}`, Accept: "*/*" }, req.headers);
  const url = getBuildUrl(req.baseUrl || toolCfg.baseUrl || GRAPH_BASE, req.path, req.query);

  const res = await getFetchBinary(url, { method, headers, body: req.body }, timeoutMs);
  return { ok: res.ok, status: res.status, statusText: res.statusText, headers: res.headers, bytes: res.bytes };
}


/**********************************************************************************/
/* getRunBatch                                                                    */
/**********************************************************************************/
async function getRunBatch(toolCfg, version, requests) {
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const token = await getAccessToken(toolCfg);
  const res = await getGraphRequest(toolCfg, { accessToken: token, baseUrl, path: "/$batch", method: "POST", body: { requests } });
  return { ok: res.ok, status: res.status, statusText: res.statusText, data: res.data, responses: getExtractBatchResponses(res) };
}


/**********************************************************************************/
/* getCachedDiscovery / setCachedDiscovery                                        */
/**********************************************************************************/
function getCachedDiscovery(key) {
  const entry = discoveryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DISCOVERY_CACHE_TTL_MS) { discoveryCache.delete(key); return null; }
  return entry.value;
}

function setCachedDiscovery(key, value) {
  discoveryCache.set(key, { value, ts: Date.now() });
}


/**********************************************************************************/
/* getAutoDiscoverIds                                                             */
/* Auto-discovers siteId from the configured SharePoint hostname and driveId     */
/* from the resolved site or default user. Results are cached for 5 minutes.     */
/* Returns an enriched copy of toolCfg; never throws.                            */
/**********************************************************************************/
async function getAutoDiscoverIds(toolCfg) {
  const hostname = getStr(toolCfg.defaultSharePointHostname, "");
  const tenantId = getStr(toolCfg.auth?.tenantId, "");
  const hasSiteId = !!getStr(toolCfg.defaultSiteId, "") || !!getStr(toolCfg.forcedSiteId, "");
  const hasDriveId = !!getStr(toolCfg.defaultDriveId, "") || !!getStr(toolCfg.forcedDriveId, "");
  const userId = getStr(toolCfg.forcedUserId, "") || getStr(toolCfg.defaultUserId, "");

  const needsSite = !hasSiteId && !!hostname && !!tenantId;
  const needsDrive = !hasDriveId && (!!hostname || !!userId) && !!tenantId;

  if (!needsSite && !needsDrive) return toolCfg;

  let token = null;
  try { token = await getAccessToken(toolCfg); } catch { return toolCfg; }

  const result = { ...toolCfg };
  const baseUrl = getResolveBaseUrl(toolCfg, "v1.0");

  if (needsSite) {
    const cacheKey = `site:${tenantId}:${hostname}`;
    let siteId = getCachedDiscovery(cacheKey);
    if (!siteId) {
      try {
        const res = await getGraphRequest(result, { accessToken: token, baseUrl, path: `/sites/${encodeURIComponent(hostname)}:/`, method: "GET", query: { $select: "id" } });
        siteId = getStr(res.data?.id, "");
        if (siteId) setCachedDiscovery(cacheKey, siteId);
      } catch {}
    }
    if (siteId) result.defaultSiteId = siteId;
  }

  if (needsDrive) {
    const resolvedSiteId = getStr(result.defaultSiteId, "");
    let driveId = null;

    if (resolvedSiteId) {
      const cacheKey = `driveId:site:${tenantId}:${resolvedSiteId}`;
      driveId = getCachedDiscovery(cacheKey);
      if (!driveId) {
        try {
          const res = await getGraphRequest(result, { accessToken: token, baseUrl, path: `/sites/${encodeURIComponent(resolvedSiteId)}/drive`, method: "GET", query: { $select: "id" } });
          driveId = getStr(res.data?.id, "");
          if (driveId) setCachedDiscovery(cacheKey, driveId);
        } catch {}
      }
    } else if (userId) {
      const cacheKey = `driveId:user:${tenantId}:${userId}`;
      driveId = getCachedDiscovery(cacheKey);
      if (!driveId) {
        try {
          const res = await getGraphRequest(result, { accessToken: token, baseUrl, path: `/users/${encodeURIComponent(userId)}/drive`, method: "GET", query: { $select: "id" } });
          driveId = getStr(res.data?.id, "");
          if (driveId) setCachedDiscovery(cacheKey, driveId);
        } catch {}
      }
    }

    if (driveId) result.defaultDriveId = driveId;
  }

  return result;
}


/**********************************************************************************/
/* getOperationResolveDefaultTargets                                              */
/**********************************************************************************/
async function getOperationResolveDefaultTargets(toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);

  const result = {
    operation: "resolveDefaultTargets",
    ok: true,
    status: 200,
    statusText: "OK",
    defaults: {
      userId: getResolveUserId(args, toolCfg),
      driveId: getResolveDriveId(args, toolCfg),
      siteId: getResolveSiteId(args, toolCfg),
      mailFolderId: getResolveMailFolderId(args, toolCfg),
      destinationFolderId: getResolveDestinationFolderId(args, toolCfg),
      sharePointHostname: getStr(toolCfg.defaultSharePointHostname, "")
    },
    inferred: {
      storageScope: getResolveStorageScope(args, toolCfg),
      oneDriveBase: "",
      sharePointSiteBase: ""
    }
  };

  const uid = result.defaults.userId;
  if (uid) result.inferred.oneDriveBase = `/users/${encodeURIComponent(uid)}/drive`;
  result.inferred.sharePointSiteBase = getResolveSharePointSiteBase(args, toolCfg);

  if (getBool(args.includeSharePointLookup, false)) {
    const siteRes = await getGraphRequest(toolCfg, { baseUrl, path: result.inferred.sharePointSiteBase, method: "GET" });
    result.sharePointLookup = { ok: siteRes.ok, status: siteRes.status, statusText: siteRes.statusText, site: siteRes.data };
  }

  return result;
}


/**********************************************************************************/
/* getOperationFulltextSearch                                                     */
/**********************************************************************************/
async function getOperationFulltextSearch(toolCfg, args) {
  const body = getBuildSearchRequest(args, toolCfg);
  if (!body) return { operation: "fulltextSearch", ok: false, error: "Missing search query" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, { baseUrl, path: "/search/query", method: "POST", body });

  return { operation: "fulltextSearch", ok: res.ok, status: res.status, statusText: res.statusText, query: args.query, entityTypes: getSearchEntityTypes(args, toolCfg), result: res.data };
}


/**********************************************************************************/
/* getOperationShowFile                                                           */
/**********************************************************************************/
async function getOperationShowFile(toolCfg, args) {
  const path = getResolveDriveItemPath(args, toolCfg);
  if (!path) return { operation: "showFile", ok: false, error: "Could not resolve file target. Configure defaultUserId, defaultDriveId, defaultSiteId, or defaultSharePointHostname." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, {
    baseUrl, path, method: "GET",
    query: { $select: getStr(args.select, "id,name,size,file,folder,webUrl,lastModifiedDateTime,createdDateTime,parentReference,@microsoft.graph.downloadUrl") }
  });

  return { operation: "showFile", ok: res.ok, status: res.status, statusText: res.statusText, item: res.data };
}


/**********************************************************************************/
/* getOperationListFiles                                                          */
/**********************************************************************************/
async function getOperationListFiles(toolCfg, args) {
  const folder = getResolveFolderPath(args, toolCfg);
  if (!folder) return { operation: "listFiles", ok: false, error: "Could not resolve folder target. Configure defaultUserId, defaultDriveId, defaultSiteId, or defaultSharePointHostname." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, { baseUrl, path: folder.path, method: "GET", query: folder.query });

  return {
    operation: "listFiles", ok: res.ok, status: res.status, statusText: res.statusText,
    folder: { path: getStr(args.path, ""), itemId: getStr(args.itemId, ""), storageScope: getResolveStorageScope(args, toolCfg) },
    result: res.data
  };
}


/**********************************************************************************/
/* getOperationDownloadFile                                                       */
/**********************************************************************************/
async function getOperationDownloadFile(toolCfg, args) {
  const itemPath = getResolveDriveItemPath(args, toolCfg);
  if (!itemPath) return { operation: "downloadFile", ok: false, error: "Could not resolve file target. Configure defaultUserId, defaultDriveId, defaultSiteId, or defaultSharePointHostname." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const path = `${itemPath}/content`;
  const mode = getStr(args.downloadMode, "base64").toLowerCase();
  const timeoutMs = getNum(args.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));

  const res = await getGraphBinaryRequest(toolCfg, { baseUrl, path, method: "GET", timeoutMs });

  const contentType = getStr(res.headers["content-type"], "");
  const contentDisposition = getStr(res.headers["content-disposition"], "");
  let content, contentEncoding;

  if (mode === "text" || (mode === "auto" && getIsProbablyTextContentType(contentType))) {
    content = res.bytes.toString("utf8");
    contentEncoding = "utf8";
  } else {
    content = res.bytes.toString("base64");
    contentEncoding = "base64";
  }

  return { operation: "downloadFile", ok: res.ok, status: res.status, statusText: res.statusText, contentType, contentDisposition, contentEncoding, contentLength: res.bytes.length, content };
}


/**********************************************************************************/
/* getOperationUploadFile                                                         */
/**********************************************************************************/
async function getOperationUploadFile(toolCfg, args) {
  const contentBase64 = getStr(args.contentBase64, "");
  if (!contentBase64) return { operation: "uploadFile", ok: false, error: "Missing contentBase64" };

  const fileName = getStr(args.fileName, "");
  if (!fileName) return { operation: "uploadFile", ok: false, error: "Missing fileName" };

  const bytes = getDecodeBase64ToBytes(contentBase64);
  if (bytes.length > SMALL_UPLOAD_LIMIT) return { operation: "uploadFile", ok: false, error: `File too large (${bytes.length} bytes). Maximum for uploadFile is ${SMALL_UPLOAD_LIMIT} bytes. Use createUploadSession for larger files.` };

  const pathRoot = getResolveUploadRootPath(args, toolCfg);
  if (!pathRoot) return { operation: "uploadFile", ok: false, error: "Could not resolve upload target. Configure defaultUserId, defaultDriveId, defaultSiteId, or defaultSharePointHostname." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const parentPath = getStr(args.parentPath, "");
  const conflictBehavior = getStr(args.conflictBehavior, "replace");
  const uploadPath = `${pathRoot}/root:/${[parentPath.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/")}:/content`;

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: uploadPath, method: "PUT",
    headers: { "Content-Type": getStr(args.contentType, "application/octet-stream") },
    body: bytes
  });

  return { operation: "uploadFile", ok: res.ok, status: res.status, statusText: res.statusText, conflictBehavior, result: res.data };
}


/**********************************************************************************/
/* getOperationCreateUploadSession                                                */
/**********************************************************************************/
async function getOperationCreateUploadSession(toolCfg, args) {
  const fileName = getStr(args.fileName, "");
  if (!fileName) return { operation: "createUploadSession", ok: false, error: "Missing fileName" };

  const pathRoot = getResolveUploadRootPath(args, toolCfg);
  if (!pathRoot) return { operation: "createUploadSession", ok: false, error: "Could not resolve upload target. Configure defaultUserId, defaultDriveId, defaultSiteId, or defaultSharePointHostname." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const parentPath = getStr(args.parentPath, "");
  const conflictBehavior = getStr(args.conflictBehavior, "replace");
  const path = `${pathRoot}/root:/${[parentPath.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/")}:/createUploadSession`;

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path, method: "POST",
    body: { item: { "@microsoft.graph.conflictBehavior": conflictBehavior, name: fileName } }
  });

  return { operation: "createUploadSession", ok: res.ok, status: res.status, statusText: res.statusText, result: res.data };
}


/**********************************************************************************/
/* getOperationSearchEmails                                                       */
/**********************************************************************************/
async function getOperationSearchEmails(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "searchEmails", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const query = getStr(args.query, "").trim();
  if (!query) return { operation: "searchEmails", ok: false, error: "Missing email search query" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const mailFolderId = getResolveMailFolderId(args, toolCfg);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 10)), 1, 999);
  const path = mailFolderId
    ? `/users/${encodeURIComponent(userId)}/mailFolders/${encodeURIComponent(mailFolderId)}/messages`
    : `/users/${encodeURIComponent(userId)}/messages`;

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path, method: "GET",
    headers: { ConsistencyLevel: "eventual" },
    query: {
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $top: top,
      $select: getStr(args.select, "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,parentFolderId")
    }
  });

  return { operation: "searchEmails", ok: res.ok, status: res.status, statusText: res.statusText, userId, mailFolderId, query, result: res.data };
}


/**********************************************************************************/
/* getOperationShowEmails                                                         */
/**********************************************************************************/
async function getOperationShowEmails(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "showEmails", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "showEmails", ok: false, error: "Missing messageIds" };

  const version = getResolveApiVersion(args, toolCfg);
  const bodyType = getNormalizeMessageBodyPreference(args);

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1),
    method: "GET",
    url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`, {
      $select: getStr(args.select, "id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,conversationId,parentFolderId,hasAttachments,internetMessageId")
    }),
    headers: { Prefer: `outlook.body-content-type="${bodyType}"` }
  }));

  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "showEmails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, userId, messages: batchRes.responses };
}


/**********************************************************************************/
/* getOperationListMailFolders                                                    */
/**********************************************************************************/
async function getOperationListMailFolders(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "listMailFolders", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 50)), 1, 999);

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: `/users/${encodeURIComponent(userId)}/mailFolders`, method: "GET",
    query: { $top: top, $select: getStr(args.select, "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount") }
  });

  return { operation: "listMailFolders", ok: res.ok, status: res.status, statusText: res.statusText, userId, result: res.data };
}


/**********************************************************************************/
/* getOperationSearchMailFolders                                                  */
/**********************************************************************************/
async function getOperationSearchMailFolders(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  const query = getStr(args.query, "").trim().toLowerCase();
  if (!query) return { operation: "searchMailFolders", ok: false, error: "Missing mail folder search query" };

  const list = await getOperationListMailFolders(toolCfg, { ...args, userId, top: getClamp(getNum(args.top, 200), 1, 999) });
  if (!list.ok) return { ...list, operation: "searchMailFolders" };

  const folders = getArr(list?.result?.value, []).filter(item => getStr(item.displayName, "").toLowerCase().includes(query));
  return { operation: "searchMailFolders", ok: true, status: 200, statusText: "OK", userId, query, result: folders };
}


/**********************************************************************************/
/* getOperationDeleteFiles                                                        */
/**********************************************************************************/
async function getOperationDeleteFiles(toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const items = getArr(args.items, []);
  if (!items.length) return { operation: "deleteFiles", ok: false, error: "Missing items" };

  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const item of items) {
      const path = getResolveDriveItemPath(item, toolCfg);
      if (!path) { results.push({ ok: false, error: "Could not resolve item path", item }); continue; }
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(toolCfg, { baseUrl, path, method: "DELETE" });
      results.push({ ok: res.ok, status: res.status, statusText: res.statusText, item });
    }
    const allOk = results.every(v => v.ok);
    return { operation: "deleteFiles", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", results };
  }

  const requests = [];
  for (let idx = 0; idx < items.length; idx++) {
    const path = getResolveDriveItemPath(items[idx], toolCfg);
    if (!path) return { operation: "deleteFiles", ok: false, error: `Could not resolve path for item ${idx}` };
    requests.push({ id: String(idx + 1), method: "DELETE", url: getGraphRelativeUrl(path) });
  }

  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "deleteFiles", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, results: batchRes.responses.map((r, idx) => ({ ...r, item: items[idx] })) };
}


/**********************************************************************************/
/* getOperationDeleteMails                                                        */
/**********************************************************************************/
async function getOperationDeleteMails(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "deleteMails", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "deleteMails", ok: false, error: "Missing messageIds" };

  const version = getResolveApiVersion(args, toolCfg);
  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(toolCfg, { baseUrl, path: `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`, method: "DELETE" });
      results.push({ id, ok: res.ok, status: res.status, statusText: res.statusText });
    }
    const allOk = results.every(v => v.ok);
    return { operation: "deleteMails", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", userId, results };
  }

  const requests = messageIds.map((id, idx) => ({ id: String(idx + 1), method: "DELETE", url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`) }));
  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "deleteMails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, userId, results: batchRes.responses.map((r, idx) => ({ ...r, messageId: messageIds[idx] })) };
}


/**********************************************************************************/
/* getOperationRenameFiles                                                        */
/**********************************************************************************/
async function getOperationRenameFiles(toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const items = getArr(args.items, []);
  if (!items.length) return { operation: "renameFiles", ok: false, error: "Missing items" };

  const results = [];
  for (const item of items) {
    const newName = getStr(item.newName, "");
    if (!newName) return { operation: "renameFiles", ok: false, error: "Missing newName in one of the items" };
    const path = getResolveDriveItemPath(item, toolCfg);
    if (!path) { results.push({ item, ok: false, error: "Could not resolve item path" }); continue; }
    const baseUrl = getResolveBaseUrl(toolCfg, version);
    const res = await getGraphRequest(toolCfg, { baseUrl, path, method: "PATCH", body: { name: newName } });
    results.push({ item, ok: res.ok, status: res.status, statusText: res.statusText, result: res.data });
  }

  const allOk = results.every(v => v.ok);
  return { operation: "renameFiles", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", results };
}


/**********************************************************************************/
/* getOperationMoveEmails                                                         */
/**********************************************************************************/
async function getOperationMoveEmails(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "moveEmails", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "moveEmails", ok: false, error: "Missing messageIds" };

  const destinationFolderId = getResolveDestinationFolderId(args, toolCfg);
  if (!destinationFolderId) return { operation: "moveEmails", ok: false, error: "Missing destinationFolderId. Provide it in args or configure defaultDestinationFolderId." };

  const version = getResolveApiVersion(args, toolCfg);
  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(toolCfg, { baseUrl, path: `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/move`, method: "POST", body: { destinationId: destinationFolderId } });
      results.push({ messageId: id, ok: res.ok, status: res.status, statusText: res.statusText, result: res.data });
    }
    const allOk = results.every(v => v.ok);
    return { operation: "moveEmails", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", userId, destinationFolderId, results };
  }

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1), method: "POST",
    url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/move`),
    headers: { "Content-Type": "application/json" },
    body: { destinationId: destinationFolderId }
  }));

  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "moveEmails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, userId, destinationFolderId, results: batchRes.responses.map((r, idx) => ({ ...r, messageId: messageIds[idx] })) };
}


/**********************************************************************************/
/* getOperationSearchUsers                                                        */
/**********************************************************************************/
async function getOperationSearchUsers(toolCfg, args) {
  const query = getStr(args.query, "").trim();
  if (!query) return { operation: "searchUsers", ok: false, error: "Missing user search query" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 25)), 1, 999);

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: "/users", method: "GET",
    headers: { ConsistencyLevel: "eventual" },
    query: {
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $top: top,
      $select: getStr(args.select, "id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle,department,officeLocation,mobilePhone,businessPhones")
    }
  });

  return { operation: "searchUsers", ok: res.ok, status: res.status, statusText: res.statusText, query, result: res.data };
}


/**********************************************************************************/
/* getOperationShowUser                                                           */
/**********************************************************************************/
async function getOperationShowUser(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "showUser", ok: false, error: "Missing userId" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: `/users/${encodeURIComponent(userId)}`, method: "GET",
    query: { $select: getStr(args.select, "id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle,department,officeLocation,mobilePhone,businessPhones,usageLocation,createdDateTime") }
  });

  return { operation: "showUser", ok: res.ok, status: res.status, statusText: res.statusText, user: res.data };
}


/**********************************************************************************/
/* getOperationCreateUser                                                         */
/**********************************************************************************/
async function getOperationCreateUser(toolCfg, args) {
  const user = getObj(args.user, {});
  if (!Object.keys(user).length) return { operation: "createUser", ok: false, error: "Missing user payload" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, { baseUrl, path: "/users", method: "POST", body: user });

  return { operation: "createUser", ok: res.ok, status: res.status, statusText: res.statusText, result: res.data };
}


/**********************************************************************************/
/* getOperationUpdateUser                                                         */
/**********************************************************************************/
async function getOperationUpdateUser(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "updateUser", ok: false, error: "Missing userId" };

  const user = getObj(args.user, {});
  if (!Object.keys(user).length) return { operation: "updateUser", ok: false, error: "Missing user payload" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, { baseUrl, path: `/users/${encodeURIComponent(userId)}`, method: "PATCH", body: user });

  return { operation: "updateUser", ok: res.ok, status: res.status, statusText: res.statusText, result: res.data };
}


/**********************************************************************************/
/* getOperationDeleteUser                                                         */
/**********************************************************************************/
async function getOperationDeleteUser(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "deleteUser", ok: false, error: "Missing userId" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, { baseUrl, path: `/users/${encodeURIComponent(userId)}`, method: "DELETE" });

  return { operation: "deleteUser", ok: res.ok, status: res.status, statusText: res.statusText };
}


/**********************************************************************************/
/* getOperationSendMail                                                           */
/**********************************************************************************/
async function getOperationSendMail(toolCfg, args) {
  const userId = getResolveUserId(args, toolCfg);
  if (!userId) return { operation: "sendMail", ok: false, error: "No userId resolved. Configure defaultUserId or forcedUserId." };

  const subject = getStr(args.subject, "").trim();
  if (!subject) return { operation: "sendMail", ok: false, error: "Missing subject" };

  const toRaw = getArr(args.to, []);
  if (!toRaw.length) return { operation: "sendMail", ok: false, error: "Missing to (recipients)" };

  const body = getStr(args.body, "").trim();
  if (!body) return { operation: "sendMail", ok: false, error: "Missing body" };

  const bodyType = getStr(args.bodyType, "text").toLowerCase() === "html" ? "HTML" : "Text";

  const toRecipients = toRaw.map(addr => ({ emailAddress: { address: getStr(addr, "") } })).filter(r => r.emailAddress.address);
  if (!toRecipients.length) return { operation: "sendMail", ok: false, error: "No valid recipient addresses in to" };

  const ccRaw = getArr(args.cc, []);
  const bccRaw = getArr(args.bcc, []);
  const ccRecipients = ccRaw.map(addr => ({ emailAddress: { address: getStr(addr, "") } })).filter(r => r.emailAddress.address);
  const bccRecipients = bccRaw.map(addr => ({ emailAddress: { address: getStr(addr, "") } })).filter(r => r.emailAddress.address);

  const message = {
    subject,
    body: { contentType: bodyType, content: body },
    toRecipients
  };

  if (ccRecipients.length) message.ccRecipients = ccRecipients;
  if (bccRecipients.length) message.bccRecipients = bccRecipients;

  const replyTo = getStr(args.replyTo, "").trim();
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];

  const saveToSentItems = typeof args.saveToSentItems === "boolean" ? args.saveToSentItems : true;

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);

  const res = await getGraphRequest(toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}/sendMail`,
    method: "POST",
    body: { message, saveToSentItems }
  });

  return { operation: "sendMail", ok: res.ok, status: res.status, statusText: res.statusText, userId, subject, to: toRecipients.map(r => r.emailAddress.address) };
}


/**********************************************************************************/
/* getOperationGraphRequest                                                       */
/**********************************************************************************/
async function getOperationGraphRequest(toolCfg, args) {
  const request = getObj(args.request, {});
  const path = getStr(request.path, "");
  if (!path) return { operation: "graphRequest", ok: false, error: "Missing request.path" };

  const version = getStr(request.version, getResolveApiVersion(args, toolCfg));
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const res = await getGraphRequest(toolCfg, {
    baseUrl, path,
    method: getStr(request.method, "GET"),
    headers: getObj(request.headers, {}),
    query: getObj(request.query, {}),
    body: request.body,
    timeoutMs: getNum(request.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS))
  });

  return { operation: "graphRequest", ok: res.ok, status: res.status, statusText: res.statusText, result: res.data };
}


/**********************************************************************************/
/* getInvoke                                                                      */
/**********************************************************************************/
async function getInvoke(args, coreData) {
  try {
    const wo = getObj(coreData?.workingObject, {});
    const rawToolCfg = getObj(getObj(wo.toolsconfig, {})[MODULE_NAME], {});
    const toolCfg = await getNormalizeToolConfig(wo, rawToolCfg);
    const enrichedToolCfg = await getAutoDiscoverIds(toolCfg);
    const safeArgs = getApplyConfiguredIds(args, enrichedToolCfg);
    const operation = getStr(safeArgs?.operation, "").trim();

    if (!operation) return { ok: false, error: "Missing operation" };

    switch (operation) {
      case "resolveDefaultTargets":   return await getOperationResolveDefaultTargets(enrichedToolCfg, safeArgs);
      case "fulltextSearch":          return await getOperationFulltextSearch(enrichedToolCfg, safeArgs);
      case "showFile":                return await getOperationShowFile(enrichedToolCfg, safeArgs);
      case "listFiles":               return await getOperationListFiles(enrichedToolCfg, safeArgs);
      case "downloadFile":            return await getOperationDownloadFile(enrichedToolCfg, safeArgs);
      case "uploadFile":              return await getOperationUploadFile(enrichedToolCfg, safeArgs);
      case "createUploadSession":     return await getOperationCreateUploadSession(enrichedToolCfg, safeArgs);
      case "searchEmails":            return await getOperationSearchEmails(enrichedToolCfg, safeArgs);
      case "showEmails":              return await getOperationShowEmails(enrichedToolCfg, safeArgs);
      case "listMailFolders":         return await getOperationListMailFolders(enrichedToolCfg, safeArgs);
      case "searchMailFolders":       return await getOperationSearchMailFolders(enrichedToolCfg, safeArgs);
      case "deleteFiles":             return await getOperationDeleteFiles(enrichedToolCfg, safeArgs);
      case "deleteMails":             return await getOperationDeleteMails(enrichedToolCfg, safeArgs);
      case "renameFiles":             return await getOperationRenameFiles(enrichedToolCfg, safeArgs);
      case "moveEmails":              return await getOperationMoveEmails(enrichedToolCfg, safeArgs);
      case "sendMail":                return await getOperationSendMail(enrichedToolCfg, safeArgs);
      case "searchUsers":             return await getOperationSearchUsers(enrichedToolCfg, safeArgs);
      case "showUser":                return await getOperationShowUser(enrichedToolCfg, safeArgs);
      case "createUser":              return await getOperationCreateUser(enrichedToolCfg, safeArgs);
      case "updateUser":              return await getOperationUpdateUser(enrichedToolCfg, safeArgs);
      case "deleteUser":              return await getOperationDeleteUser(enrichedToolCfg, safeArgs);
      case "graphRequest":            return await getOperationGraphRequest(enrichedToolCfg, safeArgs);
      default:                        return { ok: false, error: `Unknown operation: ${operation}` };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}


/**********************************************************************************/
/* definition                                                                     */
/**********************************************************************************/
const definition = {
  type: "function",
  function: {
    name: MODULE_NAME,
    description: [
      "Access Microsoft 365 services via the Microsoft Graph API. Use this tool for:",
      "  • SharePoint / OneDrive — list, show, download, upload, rename or delete files and folders in document libraries or personal drives",
      "  • Exchange / Outlook mail — search emails, read full message bodies, list or search mail folders, move or delete messages",
      "  • Azure Active Directory / Entra users — search the directory, show user profiles, create, update or delete accounts",
      "  • Full-text search — search across files, messages and other entities in one call",
      "  • Generic Graph API — any endpoint not covered above via the graphRequest operation",
      "",
      "Operation groups:",
      "  File/Drive : showFile · listFiles · downloadFile · uploadFile · createUploadSession · deleteFiles · renameFiles",
      "  Mail       : searchEmails · showEmails · listMailFolders · searchMailFolders · deleteMails · moveEmails · sendMail",
      "  Users/AAD  : searchUsers · showUser · createUser · updateUser · deleteUser",
      "  Utility    : fulltextSearch · resolveDefaultTargets · graphRequest",
      "",
      "When no driveId or siteId is provided they are auto-discovered from the configured hostname or defaultUserId.",
      "Mail folder names can be well-known strings such as inbox, sentitems, deleteditems, drafts, or junkemail."
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform. Choose from the file, mail, user or utility groups described above.",
          enum: [
            "resolveDefaultTargets", "fulltextSearch",
            "showFile", "listFiles", "downloadFile", "uploadFile", "createUploadSession", "deleteFiles", "renameFiles",
            "searchEmails", "showEmails", "listMailFolders", "searchMailFolders", "deleteMails", "moveEmails", "sendMail",
            "searchUsers", "showUser", "createUser", "updateUser", "deleteUser",
            "graphRequest"
          ]
        },
        version: { type: "string", description: "Graph API version. Defaults to v1.0. Use beta for preview features." },
        storageScope: { type: "string", description: "Storage target hint: onedrive (user's personal drive), sharepoint (document library), or drive (explicit driveId). Auto-inferred when not provided." },
        userId: { type: "string", description: "User ID or userPrincipalName (e.g. user@company.com) for user, mail or OneDrive operations. Falls back to defaultUserId from config." },
        driveId: { type: "string", description: "Explicit drive ID for file operations. Auto-discovered when omitted and a siteId or userId is available." },
        siteId: { type: "string", description: "SharePoint site ID. Auto-discovered from the configured hostname when omitted." },
        mailFolderId: { type: "string", description: "Mail folder ID or well-known name (inbox, sentitems, deleteditems, drafts, junkemail) for mailbox-scoped operations." },
        destinationFolderId: { type: "string", description: "Destination folder ID or well-known name for moveEmails." },
        query: { type: "string", description: "Search query string for fulltextSearch, searchEmails, searchMailFolders, or searchUsers." },
        entityTypes: { type: "array", description: "Entity types for fulltextSearch, e.g. driveItem, message, site, listItem.", items: { type: "string" } },
        size: { type: "number", description: "Result count for fulltextSearch (1–100)." },
        from: { type: "number", description: "Result offset for fulltextSearch pagination." },
        top: { type: "number", description: "Maximum results for list and search operations." },
        select: { type: "string", description: "OData $select projection to limit returned fields." },
        bodyType: { type: "string", description: "Email body format for showEmails: text (default) or html." },
        itemId: { type: "string", description: "Drive item ID for file operations." },
        path: { type: "string", description: "Drive-relative file path, e.g. Documents/Report.xlsx." },
        parentPath: { type: "string", description: "Parent folder path within the drive for upload operations." },
        fileName: { type: "string", description: "File name for upload or upload session creation." },
        contentBase64: { type: "string", description: "Base64-encoded file content for uploadFile (max 4 MB). Use createUploadSession for larger files." },
        contentType: { type: "string", description: "MIME content type for uploadFile, e.g. application/vnd.openxmlformats-officedocument.spreadsheetml.sheet." },
        conflictBehavior: { type: "string", description: "Conflict behavior for upload operations: replace (default), rename, or fail." },
        downloadMode: { type: "string", description: "How to encode the downloaded content: base64 (default), text, or auto (detects from content-type)." },
        timeoutMs: { type: "number", description: "Request timeout in milliseconds. Overrides the configured default." },
        messageIds: { type: "array", description: "List of message IDs for showEmails, deleteMails, or moveEmails.", items: { type: "string" } },
        to: { type: "array", description: "Recipient email addresses for sendMail.", items: { type: "string" } },
        cc: { type: "array", description: "CC recipient email addresses for sendMail.", items: { type: "string" } },
        bcc: { type: "array", description: "BCC recipient email addresses for sendMail.", items: { type: "string" } },
        subject: { type: "string", description: "Email subject line for sendMail." },
        body: { type: "string", description: "Email body content for sendMail. Plain text by default; set bodyType to html for HTML content." },
        replyTo: { type: "string", description: "Reply-To email address for sendMail." },
        saveToSentItems: { type: "boolean", description: "Whether to save the sent message in Sent Items (default: true)." },
        batch: { type: "boolean", description: "Use Graph $batch API for multi-item operations (default: true)." },
        includeSharePointLookup: { type: "boolean", description: "For resolveDefaultTargets: also fetch and return the resolved SharePoint site object." },
        items: {
          type: "array",
          description: "File item definitions for deleteFiles or renameFiles. Each item can specify driveId, siteId, userId, itemId, path, and (for renameFiles) newName.",
          items: {
            type: "object",
            properties: {
              driveId: { type: "string" },
              siteId: { type: "string" },
              userId: { type: "string" },
              itemId: { type: "string" },
              path: { type: "string" },
              newName: { type: "string" },
              storageScope: { type: "string" }
            }
          }
        },
        user: { type: "object", description: "User object payload for createUser or updateUser. Must follow the Graph API user resource schema." },
        request: {
          type: "object",
          description: "For graphRequest: custom Graph API call definition.",
          properties: {
            version: { type: "string" },
            method: { type: "string" },
            path: { type: "string" },
            headers: { type: "object" },
            query: { type: "object" },
            body: {}
          },
          required: ["path"]
        }
      },
      required: ["operation"]
    }
  }
};


/**********************************************************************************/
/* module export                                                                  */
/**********************************************************************************/
export default {
  name: MODULE_NAME,
  definition,
  invoke: getInvoke
};
