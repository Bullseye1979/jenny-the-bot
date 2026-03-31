/**********************************************************************************/
/* filename: getGraph.js                                                          */
/* Version 1.0                                                                    */
/* Purpose: Microsoft Graph API tool — SharePoint files, OneDrive, Exchange mail, */
/*          Azure AD users and generic Graph API access.                          */
/*          Uses delegated OAuth2 tokens stored per Discord user in graph_tokens. */
/*          Token is resolved via wo.userId + wo.db at runtime.                  */
/*          Auto-discovers siteId and driveId; uses /me paths when no userId set. */
/*          All operations return { ok, error } instead of throwing.             */
/**********************************************************************************/

const MODULE_NAME = "getGraph";
const GRAPH_BASE = "https://graph.microsoft.com";
const DEFAULT_TIMEOUT_MS = 30000;
const SMALL_UPLOAD_LIMIT = 4 * 1024 * 1024;
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

const discoveryCache = new Map();
let   _dbPool        = null;


/**********************************************************************************/
/* getDbPool                                                                      */
/**********************************************************************************/
async function getDbPool(coreData) {
  if (_dbPool) return _dbPool;
  const mysql2 = await import("mysql2/promise");
  const db = coreData?.workingObject?.db || {};
  _dbPool = mysql2.default.createPool({
    host:             String(db.host     || "localhost"),
    port:             Number(db.port     || 3306),
    user:             String(db.user     || ""),
    password:         String(db.password || ""),
    database:         String(db.database || ""),
    charset:          String(db.charset  || "utf8mb4"),
    connectionLimit:  3,
    waitForConnections: true,
  });
  return _dbPool;
}


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
/* getNormalizeToolConfig                                                         */
/**********************************************************************************/
function getNormalizeToolConfig(rawToolCfg) {
  const toolCfg = getObj(rawToolCfg, {});
  return {
    ...toolCfg,
    baseUrl: getStr(toolCfg.baseUrl, GRAPH_BASE),
    version: getStr(toolCfg.version, "v1.0"),
    timeoutMs: getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS),
    defaultPageSize: getNum(toolCfg.defaultPageSize, 25),
    defaultEntityTypes: getArr(toolCfg.defaultEntityTypes, ["driveItem", "message"]),
    defaultUserId: getStr(toolCfg.defaultUserId, ""),
    defaultSiteId: getStr(toolCfg.defaultSiteId, getStr(toolCfg.siteId, "")),
    defaultDriveId: getStr(toolCfg.defaultDriveId, getStr(toolCfg.driveId, "")),
    defaultMailFolderId: getStr(toolCfg.defaultMailFolderId, getStr(toolCfg.mailFolderId, "")),
    defaultDestinationFolderId: getStr(toolCfg.defaultDestinationFolderId, getStr(toolCfg.destinationFolderId, "")),
    defaultSharePointHostname: getStr(toolCfg.defaultSharePointHostname, ""),
    forcedUserId: getStr(toolCfg.forcedUserId, ""),
    forcedSiteId: getStr(toolCfg.forcedSiteId, ""),
    forcedDriveId: getStr(toolCfg.forcedDriveId, ""),
    forcedMailFolderId: getStr(toolCfg.forcedMailFolderId, ""),
    forcedDestinationFolderId: getStr(toolCfg.forcedDestinationFolderId, "")
  };
}


/**********************************************************************************/
/* getDelegatedToken                                                              */
/**********************************************************************************/
async function getDelegatedToken(coreData) {
  const wo     = getObj(coreData?.workingObject, {});
  const userId = String(wo?.userId || "").trim();
  if (!userId) throw new Error("No userId in working object — cannot resolve Graph token");
  const db = await getDbPool(coreData);
  const [rows] = await db.query(
    "SELECT access_token, expires_at FROM graph_tokens WHERE user_id = ?",
    [userId]
  );
  const row = rows?.[0];
  if (!row) throw new Error(`No Microsoft account connected for this user. Please authenticate at /graph-auth`);
  if (Date.now() > Number(row.expires_at)) throw new Error(`Microsoft token expired. Please re-authenticate at /graph-auth`);
  return String(row.access_token);
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

function getResolveUserBase(args, toolCfg) {
  const userId = getResolveUserId(args, toolCfg);
  return userId ? `/users/${encodeURIComponent(userId)}` : "/me";
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
    const siteDriveId = getStr(toolCfg._siteDriveId, "");
    if (siteDriveId && itemId)   return `/drives/${encodeURIComponent(siteDriveId)}/items/${encodeURIComponent(itemId)}`;
    if (siteDriveId && filePath) return `/drives/${encodeURIComponent(siteDriveId)}/root:/${filePath.replace(/^\/+/, "")}`;
    if (siteDriveId)             return `/drives/${encodeURIComponent(siteDriveId)}/root`;
    const siteBase = getResolveSharePointSiteBase(args, toolCfg);
    if (itemId)   return `${siteBase}/drive/items/${encodeURIComponent(itemId)}`;
    if (filePath) return `${siteBase}/drive/root:/${filePath.replace(/^\/+/, "")}`;
    return `${siteBase}/drive/root`;
  }

  const userBase = getResolveUserBase(args, toolCfg);
  if (itemId)   return `${userBase}/drive/items/${encodeURIComponent(itemId)}`;
  if (filePath) return `${userBase}/drive/root:/${filePath.replace(/^\/+/, "")}`;
  return `${userBase}/drive/root`;
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
  if (scope === "sharepoint") {
    const siteDriveId = getStr(toolCfg._siteDriveId, "");
    if (siteDriveId) return `/drives/${encodeURIComponent(siteDriveId)}`;
    return `${getResolveSharePointSiteBase(args, toolCfg)}/drive`;
  }
  return `${getResolveUserBase(args, toolCfg)}/drive`;
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
/* getGraphRequest                                                                */
/**********************************************************************************/
async function getGraphRequest(toolCfg, req = {}) {
  const timeoutMs = getNum(req.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));
  const token = getStr(req.accessToken, "") || getStr(toolCfg._token, "");
  if (!token) throw new Error("No access token — user must authenticate at /graph-auth");
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
  const token = getStr(req.accessToken, "") || getStr(toolCfg._token, "");
  if (!token) throw new Error("No access token — user must authenticate at /graph-auth");
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
  const res = await getGraphRequest(toolCfg, { baseUrl, path: "/$batch", method: "POST", body: { requests } });
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
  const token = getStr(toolCfg._token, "");
  const hasSiteId = !!getStr(toolCfg.defaultSiteId, "") || !!getStr(toolCfg.forcedSiteId, "");
  const hasDriveId = !!getStr(toolCfg.defaultDriveId, "") || !!getStr(toolCfg.forcedDriveId, "");

  const needsSite = !hasSiteId && !!hostname && !!token;
  const needsDrive = !hasDriveId && !!token;

  if (!needsSite && !needsDrive) return toolCfg;

  const result = { ...toolCfg };
  const baseUrl = getResolveBaseUrl(toolCfg, "v1.0");

  if (needsSite) {
    const cacheKey = `site:${hostname}`;
    let siteId = getCachedDiscovery(cacheKey);
    if (!siteId) {
      try {
        const res = await getGraphRequest(result, { baseUrl, path: `/sites/${encodeURIComponent(hostname)}:/`, method: "GET", query: { $select: "id" } });
        siteId = getStr(res.data?.id, "");
        if (siteId) setCachedDiscovery(cacheKey, siteId);
      } catch {}
    }
    if (siteId) result.defaultSiteId = siteId;
  }

  if (needsDrive && !hasDriveId) {
    const resolvedSiteId = getStr(result.defaultSiteId, "");
    const userId = getStr(toolCfg.forcedUserId, "") || getStr(toolCfg.defaultUserId, "");
    let driveId = null;

    if (resolvedSiteId) {
      const cacheKey = `driveId:site:${resolvedSiteId}`;
      driveId = getCachedDiscovery(cacheKey);
      if (!driveId) {
        try {
          const res = await getGraphRequest(result, { baseUrl, path: `/sites/${encodeURIComponent(resolvedSiteId)}/drive`, method: "GET", query: { $select: "id" } });
          driveId = getStr(res.data?.id, "");
          if (driveId) setCachedDiscovery(cacheKey, driveId);
        } catch {}
      }
      // Store SharePoint site drive separately — must NOT overwrite defaultDriveId
      // which would cause OneDrive operations to land on SharePoint.
      if (driveId) result._siteDriveId = driveId;
    } else {
      const cacheKey = userId ? `driveId:user:${userId}` : `driveId:me`;
      driveId = getCachedDiscovery(cacheKey);
      if (!driveId) {
        try {
          const drivePath = userId ? `/users/${encodeURIComponent(userId)}/drive` : `/me/drive`;
          const res = await getGraphRequest(result, { baseUrl, path: drivePath, method: "GET", query: { $select: "id" } });
          driveId = getStr(res.data?.id, "");
          if (driveId) setCachedDiscovery(cacheKey, driveId);
        } catch {}
      }
      if (driveId) result.defaultDriveId = driveId;
    }
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
/* getOperationSearchFiles                                                        */
/**********************************************************************************/
async function getOperationSearchFiles(toolCfg, args) {
  const query = getStr(args.query, "").trim();
  if (!query) return { operation: "searchFiles", ok: false, error: "Missing search query" };

  const driveId = getResolveDriveId(args, toolCfg);
  const userId = getResolveUserId(args, toolCfg);
  const scope = getResolveStorageScope(args, toolCfg);

  let searchBasePath;
  if (driveId) {
    searchBasePath = `/drives/${encodeURIComponent(driveId)}`;
  } else if (scope === "sharepoint") {
    searchBasePath = `${getResolveSharePointSiteBase(args, toolCfg)}/drive`;
  } else {
    searchBasePath = `${getResolveUserBase(args, toolCfg)}/drive`;
  }

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 25)), 1, 999);
  const oDataQuery = query.replace(/'/g, "''");
  const searchPath = `${searchBasePath}/search(q='${oDataQuery}')`;

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: searchPath, method: "GET",
    query: { $top: top, $select: getStr(args.select, "id,name,size,file,folder,webUrl,lastModifiedDateTime,parentReference") }
  });

  if (!res.ok) {
    const errMsg = getStr(res.data?.error?.message, getStr(res.data?.error?.code, res.statusText));
    return { operation: "searchFiles", ok: false, status: res.status, statusText: res.statusText, error: errMsg, detail: res.data };
  }

  return { operation: "searchFiles", ok: true, status: res.status, statusText: res.statusText, query, result: res.data };
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
  const query = getStr(args.query, "").trim();
  if (!query) return { operation: "searchEmails", ok: false, error: "Missing email search query" };

  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userBase = getResolveUserBase(args, toolCfg);
  const mailFolderId = getResolveMailFolderId(args, toolCfg);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 10)), 1, 999);
  const path = mailFolderId
    ? `${userBase}/mailFolders/${encodeURIComponent(mailFolderId)}/messages`
    : `${userBase}/messages`;

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path, method: "GET",
    headers: { ConsistencyLevel: "eventual" },
    query: {
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $top: top,
      $select: getStr(args.select, "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,parentFolderId")
    }
  });

  return { operation: "searchEmails", ok: res.ok, status: res.status, statusText: res.statusText, userBase, mailFolderId, query, result: res.data };
}


/**********************************************************************************/
/* getOperationShowEmails                                                         */
/**********************************************************************************/
async function getOperationShowEmails(toolCfg, args) {
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "showEmails", ok: false, error: "Missing messageIds" };

  const version = getResolveApiVersion(args, toolCfg);
  const userBase = getResolveUserBase(args, toolCfg);
  const bodyType = getNormalizeMessageBodyPreference(args);

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1),
    method: "GET",
    url: getGraphRelativeUrl(`${userBase}/messages/${encodeURIComponent(id)}`, {
      $select: getStr(args.select, "id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,conversationId,parentFolderId,hasAttachments,internetMessageId")
    }),
    headers: { Prefer: `outlook.body-content-type="${bodyType}"` }
  }));

  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "showEmails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, messages: batchRes.responses };
}


/**********************************************************************************/
/* getOperationListMailFolders                                                    */
/**********************************************************************************/
async function getOperationListMailFolders(toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userBase = getResolveUserBase(args, toolCfg);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 50)), 1, 999);

  const res = await getGraphRequest(toolCfg, {
    baseUrl, path: `${userBase}/mailFolders`, method: "GET",
    query: { $top: top, $select: getStr(args.select, "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount") }
  });

  return { operation: "listMailFolders", ok: res.ok, status: res.status, statusText: res.statusText, result: res.data };
}


/**********************************************************************************/
/* getOperationSearchMailFolders                                                  */
/**********************************************************************************/
async function getOperationSearchMailFolders(toolCfg, args) {
  const query = getStr(args.query, "").trim().toLowerCase();
  if (!query) return { operation: "searchMailFolders", ok: false, error: "Missing mail folder search query" };

  const list = await getOperationListMailFolders(toolCfg, { ...args, top: getClamp(getNum(args.top, 200), 1, 999) });
  if (!list.ok) return { ...list, operation: "searchMailFolders" };

  const folders = getArr(list?.result?.value, []).filter(item => getStr(item.displayName, "").toLowerCase().includes(query));
  return { operation: "searchMailFolders", ok: true, status: 200, statusText: "OK", query, result: folders };
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
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "deleteMails", ok: false, error: "Missing messageIds" };

  const version = getResolveApiVersion(args, toolCfg);
  const userBase = getResolveUserBase(args, toolCfg);
  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(toolCfg, { baseUrl, path: `${userBase}/messages/${encodeURIComponent(id)}`, method: "DELETE" });
      results.push({ id, ok: res.ok, status: res.status, statusText: res.statusText });
    }
    const allOk = results.every(v => v.ok);
    return { operation: "deleteMails", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", results };
  }

  const requests = messageIds.map((id, idx) => ({ id: String(idx + 1), method: "DELETE", url: getGraphRelativeUrl(`${userBase}/messages/${encodeURIComponent(id)}`) }));
  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "deleteMails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, results: batchRes.responses.map((r, idx) => ({ ...r, messageId: messageIds[idx] })) };
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
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) return { operation: "moveEmails", ok: false, error: "Missing messageIds" };

  const destinationFolderId = getResolveDestinationFolderId(args, toolCfg);
  if (!destinationFolderId) return { operation: "moveEmails", ok: false, error: "Missing destinationFolderId. Provide it in args or configure defaultDestinationFolderId." };

  const version = getResolveApiVersion(args, toolCfg);
  const userBase = getResolveUserBase(args, toolCfg);
  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(toolCfg, { baseUrl, path: `${userBase}/messages/${encodeURIComponent(id)}/move`, method: "POST", body: { destinationId: destinationFolderId } });
      results.push({ messageId: id, ok: res.ok, status: res.status, statusText: res.statusText, result: res.data });
    }
    const allOk = results.every(v => v.ok);
    return { operation: "moveEmails", ok: allOk, status: allOk ? 200 : 207, statusText: allOk ? "OK" : "MULTI_STATUS", destinationFolderId, results };
  }

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1), method: "POST",
    url: getGraphRelativeUrl(`${userBase}/messages/${encodeURIComponent(id)}/move`),
    headers: { "Content-Type": "application/json" },
    body: { destinationId: destinationFolderId }
  }));

  const batchRes = await getRunBatch(toolCfg, version, requests);
  return { operation: "moveEmails", ok: batchRes.ok, status: batchRes.status, statusText: batchRes.statusText, destinationFolderId, results: batchRes.responses.map((r, idx) => ({ ...r, messageId: messageIds[idx] })) };
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
  const userBase = getResolveUserBase(args, toolCfg);

  const res = await getGraphRequest(toolCfg, {
    baseUrl,
    path: `${userBase}/sendMail`,
    method: "POST",
    body: { message, saveToSentItems }
  });

  return { operation: "sendMail", ok: res.ok, status: res.status, statusText: res.statusText, subject, to: toRecipients.map(r => r.emailAddress.address) };
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
    const toolCfg = getNormalizeToolConfig(rawToolCfg);
    const delegatedToken = await getDelegatedToken(coreData);
    const toolCfgWithToken = { ...toolCfg, _token: delegatedToken };
    const enrichedToolCfg = await getAutoDiscoverIds(toolCfgWithToken);
    const safeArgs = getApplyConfiguredIds(args, enrichedToolCfg);
    const operation = getStr(safeArgs?.operation, "").trim();

    if (!operation) return { ok: false, error: "Missing operation" };

    switch (operation) {
      case "resolveDefaultTargets":   return await getOperationResolveDefaultTargets(enrichedToolCfg, safeArgs);
      case "fulltextSearch":          return await getOperationFulltextSearch(enrichedToolCfg, safeArgs);
      case "searchFiles":             return await getOperationSearchFiles(enrichedToolCfg, safeArgs);
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
/* module export                                                                  */
/**********************************************************************************/
export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
