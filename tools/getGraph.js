/**********************************************************************************/
/* filename: getGraph_v2.js                                                       */
/* Version 2.0                                                                    */
/* Purpose: Microsoft Graph API tool with fixed high-level operations for         */
/* search, files, mail and users, plus a generic JSON request mode for Jenny.    */
/**********************************************************************************/

import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "getGraph";
const GRAPH_BASE = "https://graph.microsoft.com";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_TIMEOUT_MS = 30000;
const SMALL_UPLOAD_LIMIT = 4 * 1024 * 1024;

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
/* getAuthConfig                                                                  */
/**********************************************************************************/
function getAuthConfig(toolCfg) {
  const auth = getObj(toolCfg.auth, {});
  return {
    tenantId: getStr(auth.tenantId, getStr(toolCfg.tenantId, "")),
    clientId: getStr(auth.clientId, getStr(toolCfg.clientId, "")),
    clientSecret: getStr(auth.clientSecret, getStr(toolCfg.clientSecret, "")),
    scope: getStr(auth.scope, getStr(toolCfg.scope, GRAPH_SCOPE)),
    tokenUrl: getStr(auth.tokenUrl, "")
  };
}

/**********************************************************************************/
/* getResolveUserId                                                               */
/**********************************************************************************/
function getResolveUserId(args, toolCfg) {
  return getStr(args?.userId, getStr(toolCfg.defaultUserId, "me"));
}

/**********************************************************************************/
/* getResolveApiVersion                                                           */
/**********************************************************************************/
function getResolveApiVersion(args, toolCfg) {
  return getStr(args?.version, getStr(toolCfg.version, "v1.0"));
}

/**********************************************************************************/
/* getResolveBaseUrl                                                              */
/**********************************************************************************/
function getResolveBaseUrl(toolCfg, version) {
  const baseRoot = getStr(toolCfg.baseUrl, GRAPH_BASE).replace(/\/+$/, "");
  const v = String(version || "v1.0").replace(/^\/+/, "");
  return `${baseRoot}/${v}`;
}

/**********************************************************************************/
/* getSearchEntityTypes                                                           */
/**********************************************************************************/
function getSearchEntityTypes(args, toolCfg) {
  const fallback = getArr(toolCfg.defaultEntityTypes, ["driveItem", "message"]);
  const raw = getArr(args?.entityTypes, fallback)
    .map(v => getStr(v, "").trim())
    .filter(Boolean);
  return raw.length ? raw : fallback;
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
  const normalized = String(input || "").replace(/\s+/g, "");
  return Buffer.from(normalized, "base64");
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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      data
    };
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
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      bytes
    };
  } finally {
    clearTimeout(timer);
  }
}

/**********************************************************************************/
/* getAccessToken                                                                 */
/**********************************************************************************/
async function getAccessToken(wo, toolCfg) {
  const auth = getAuthConfig(toolCfg);
  const tenantId = getStr(await getSecret(wo, auth.tenantId), auth.tenantId);
  const clientId = getStr(await getSecret(wo, auth.clientId), auth.clientId);
  const clientSecret = getStr(await getSecret(wo, auth.clientSecret), auth.clientSecret);
  const scope = getStr(auth.scope, GRAPH_SCOPE);
  const tokenUrl = getStr(auth.tokenUrl, tenantId ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token` : "");

  if (!tenantId) throw new Error("Missing toolsconfig.getGraph.auth.tenantId");
  if (!clientId) throw new Error("Missing toolsconfig.getGraph.auth.clientId");
  if (!clientSecret) throw new Error("Missing toolsconfig.getGraph.auth.clientSecret");
  if (!tokenUrl) throw new Error("Missing Graph token URL");

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("scope", scope);

  const timeoutMs = getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS);
  const tokenRes = await getFetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  }, timeoutMs);

  if (!tokenRes.ok) {
    const detail = typeof tokenRes.data === "string" ? tokenRes.data : JSON.stringify(tokenRes.data || null);
    throw new Error(`Token request failed: HTTP ${tokenRes.status} ${tokenRes.statusText} ${detail}`);
  }

  const token = getStr(tokenRes?.data?.access_token, "");
  if (!token) throw new Error("Graph token response did not include access_token");
  return token;
}

/**********************************************************************************/
/* getGraphRequest                                                                */
/**********************************************************************************/
async function getGraphRequest(wo, toolCfg, req = {}) {
  const timeoutMs = getNum(req.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));
  const token = getStr(req.accessToken, "") || await getAccessToken(wo, toolCfg);
  const method = getStr(req.method, "GET").toUpperCase();
  const headers = getHeaders({
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  }, req.headers);

  const body = req.body;
  const url = getBuildUrl(req.baseUrl || toolCfg.baseUrl || GRAPH_BASE, req.path, req.query);

  let finalBody = body;
  if (body !== undefined && body !== null && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  const res = await getFetch(url, {
    method,
    headers,
    body: finalBody
  }, timeoutMs);

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    data: res.data
  };
}

/**********************************************************************************/
/* getGraphBinaryRequest                                                          */
/**********************************************************************************/
async function getGraphBinaryRequest(wo, toolCfg, req = {}) {
  const timeoutMs = getNum(req.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));
  const token = getStr(req.accessToken, "") || await getAccessToken(wo, toolCfg);
  const method = getStr(req.method, "GET").toUpperCase();
  const headers = getHeaders({
    Authorization: `Bearer ${token}`,
    Accept: "*/*"
  }, req.headers);

  const url = getBuildUrl(req.baseUrl || toolCfg.baseUrl || GRAPH_BASE, req.path, req.query);

  const res = await getFetchBinary(url, {
    method,
    headers,
    body: req.body
  }, timeoutMs);

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    bytes: res.bytes
  };
}

/**********************************************************************************/
/* getResolveDriveItemPath                                                        */
/**********************************************************************************/
function getResolveDriveItemPath(args, toolCfg) {
  const userId = getResolveUserId(args, toolCfg);
  const driveId = getStr(args.driveId, "");
  const itemId = getStr(args.itemId, "");
  const siteId = getStr(args.siteId, "");
  const filePath = getStr(args.path, "");

  if (driveId && itemId) return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  if (driveId && filePath) return `/drives/${encodeURIComponent(driveId)}/root:/${filePath.replace(/^\/+/, "")}`;
  if (siteId && itemId) return `/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}`;
  if (siteId && filePath) return `/sites/${encodeURIComponent(siteId)}/drive/root:/${filePath.replace(/^\/+/, "")}`;
  if (userId && itemId) return `/users/${encodeURIComponent(userId)}/drive/items/${encodeURIComponent(itemId)}`;
  if (userId && filePath) return `/users/${encodeURIComponent(userId)}/drive/root:/${filePath.replace(/^\/+/, "")}`;
  if (itemId) return `/me/drive/items/${encodeURIComponent(itemId)}`;
  if (filePath) return `/me/drive/root:/${filePath.replace(/^\/+/, "")}`;
  throw new Error("You must provide driveId+itemId, driveId+path, siteId+itemId, siteId+path, userId+itemId, userId+path, itemId or path");
}

/**********************************************************************************/
/* getResolveFolderPath                                                           */
/**********************************************************************************/
function getResolveFolderPath(args, toolCfg) {
  const base = getResolveDriveItemPath(args, toolCfg);
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
  if (!queryText) throw new Error("Missing search query");

  const size = getClamp(getNum(args.size, getNum(toolCfg.defaultPageSize, 10)), 1, 100);
  const from = getClamp(getNum(args.from, 0), 0, 10000);
  const entityTypes = getSearchEntityTypes(args, toolCfg);

  return {
    requests: [{
      entityTypes,
      query: {
        queryString: queryText
      },
      from,
      size
    }]
  };
}

/**********************************************************************************/
/* getNormalizeMessageBodyPreference                                              */
/**********************************************************************************/
function getNormalizeMessageBodyPreference(args) {
  const mode = getStr(args.bodyType, "text").toLowerCase();
  return mode === "html" ? "html" : "text";
}

/**********************************************************************************/
/* getChunkArray                                                                  */
/**********************************************************************************/
function getChunkArray(input, size) {
  const arr = getArr(input, []);
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**********************************************************************************/
/* getExtractBatchResponses                                                       */
/**********************************************************************************/
function getExtractBatchResponses(batchRes) {
  const responses = getArr(batchRes?.data?.responses, []);
  return responses.map(item => ({
    id: item.id,
    status: item.status,
    headers: item.headers || {},
    body: item.body ?? null
  }));
}

/**********************************************************************************/
/* getRunBatch                                                                    */
/**********************************************************************************/
async function getRunBatch(wo, toolCfg, version, requests) {
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const token = await getAccessToken(wo, toolCfg);
  const res = await getGraphRequest(wo, toolCfg, {
    accessToken: token,
    baseUrl,
    path: "/$batch",
    method: "POST",
    body: { requests }
  });

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    data: res.data,
    responses: getExtractBatchResponses(res)
  };
}

/**********************************************************************************/
/* getOperationFulltextSearch                                                     */
/**********************************************************************************/
async function getOperationFulltextSearch(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const body = getBuildSearchRequest(args, toolCfg);

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: "/search/query",
    method: "POST",
    body
  });

  return {
    operation: "fulltextSearch",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    query: args.query,
    entityTypes: getSearchEntityTypes(args, toolCfg),
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationShowFile                                                           */
/**********************************************************************************/
async function getOperationShowFile(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const path = getResolveDriveItemPath(args, toolCfg);

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path,
    method: "GET",
    query: {
      $select: getStr(args.select, "id,name,size,file,folder,webUrl,lastModifiedDateTime,createdDateTime,parentReference,@microsoft.graph.downloadUrl")
    }
  });

  return {
    operation: "showFile",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    item: res.data
  };
}

/**********************************************************************************/
/* getOperationListFiles                                                          */
/**********************************************************************************/
async function getOperationListFiles(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const folder = getResolveFolderPath(args, toolCfg);

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: folder.path,
    method: "GET",
    query: folder.query
  });

  return {
    operation: "listFiles",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    folder: {
      path: getStr(args.path, ""),
      itemId: getStr(args.itemId, "")
    },
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationDownloadFile                                                       */
/**********************************************************************************/
async function getOperationDownloadFile(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const path = `${getResolveDriveItemPath(args, toolCfg)}/content`;
  const mode = getStr(args.downloadMode, "base64").toLowerCase();
  const timeoutMs = getNum(args.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS));

  const res = await getGraphBinaryRequest(wo, toolCfg, {
    baseUrl,
    path,
    method: "GET",
    timeoutMs
  });

  const contentType = getStr(res.headers["content-type"], "");
  const fileName = getStr(res.headers["content-disposition"], "");

  let content = null;
  let contentEncoding = null;

  if (mode === "text" || (mode === "auto" && getIsProbablyTextContentType(contentType))) {
    content = res.bytes.toString("utf8");
    contentEncoding = "utf8";
  } else {
    content = res.bytes.toString("base64");
    contentEncoding = "base64";
  }

  return {
    operation: "downloadFile",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    contentType,
    contentDisposition: fileName,
    contentEncoding,
    contentLength: res.bytes.length,
    content
  };
}

/**********************************************************************************/
/* getOperationUploadFile                                                         */
/**********************************************************************************/
async function getOperationUploadFile(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const contentBase64 = getStr(args.contentBase64, "");
  if (!contentBase64) throw new Error("Missing contentBase64");
  const bytes = getDecodeBase64ToBytes(contentBase64);
  if (bytes.length > SMALL_UPLOAD_LIMIT) throw new Error(`uploadFile only supports files up to ${SMALL_UPLOAD_LIMIT} bytes. Use createUploadSession for larger files.`);

  const parentPath = getStr(args.parentPath, "");
  const fileName = getStr(args.fileName, "");
  const conflictBehavior = getStr(args.conflictBehavior, "replace");
  if (!fileName) throw new Error("Missing fileName");

  let pathRoot = "";
  if (getStr(args.driveId, "")) {
    pathRoot = `/drives/${encodeURIComponent(args.driveId)}`;
  } else if (getStr(args.siteId, "")) {
    pathRoot = `/sites/${encodeURIComponent(args.siteId)}/drive`;
  } else if (getStr(args.userId, "")) {
    pathRoot = `/users/${encodeURIComponent(args.userId)}/drive`;
  } else {
    pathRoot = `/me/drive`;
  }

  const uploadPath = `${pathRoot}/root:/${[parentPath.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/") }:/content`;

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: uploadPath,
    method: "PUT",
    headers: {
      "Content-Type": getStr(args.contentType, "application/octet-stream")
    },
    body: bytes
  });

  return {
    operation: "uploadFile",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    conflictBehavior,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationCreateUploadSession                                                */
/**********************************************************************************/
async function getOperationCreateUploadSession(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const parentPath = getStr(args.parentPath, "");
  const fileName = getStr(args.fileName, "");
  const conflictBehavior = getStr(args.conflictBehavior, "replace");
  if (!fileName) throw new Error("Missing fileName");

  let pathRoot = "";
  if (getStr(args.driveId, "")) {
    pathRoot = `/drives/${encodeURIComponent(args.driveId)}`;
  } else if (getStr(args.siteId, "")) {
    pathRoot = `/sites/${encodeURIComponent(args.siteId)}/drive`;
  } else if (getStr(args.userId, "")) {
    pathRoot = `/users/${encodeURIComponent(args.userId)}/drive`;
  } else {
    pathRoot = `/me/drive`;
  }

  const path = `${pathRoot}/root:/${[parentPath.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/") }:/createUploadSession`;

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path,
    method: "POST",
    body: {
      item: {
        "@microsoft.graph.conflictBehavior": conflictBehavior,
        name: fileName
      }
    }
  });

  return {
    operation: "createUploadSession",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationSearchEmails                                                       */
/**********************************************************************************/
async function getOperationSearchEmails(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getResolveUserId(args, toolCfg);
  const query = getStr(args.query, "").trim();
  if (!query) throw new Error("Missing email search query");

  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 10)), 1, 999);

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}/messages`,
    method: "GET",
    headers: {
      ConsistencyLevel: "eventual"
    },
    query: {
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $top: top,
      $select: getStr(args.select, "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,parentFolderId")
    }
  });

  return {
    operation: "searchEmails",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    userId,
    query,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationShowEmails                                                         */
/**********************************************************************************/
async function getOperationShowEmails(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getResolveUserId(args, toolCfg);
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  const bodyType = getNormalizeMessageBodyPreference(args);

  if (!messageIds.length) throw new Error("Missing messageIds");

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1),
    method: "GET",
    url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`, {
      $select: getStr(args.select, "id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,conversationId,parentFolderId,hasAttachments,internetMessageId")
    }),
    headers: {
      Prefer: `outlook.body-content-type="${bodyType}"`
    }
  }));

  const batchRes = await getRunBatch(wo, toolCfg, version, requests);

  return {
    operation: "showEmails",
    ok: batchRes.ok,
    status: batchRes.status,
    statusText: batchRes.statusText,
    userId,
    messages: batchRes.responses
  };
}

/**********************************************************************************/
/* getOperationListMailFolders                                                    */
/**********************************************************************************/
async function getOperationListMailFolders(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getResolveUserId(args, toolCfg);
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 50)), 1, 999);

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}/mailFolders`,
    method: "GET",
    query: {
      $top: top,
      $select: getStr(args.select, "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount")
    }
  });

  return {
    operation: "listMailFolders",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    userId,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationSearchMailFolders                                                  */
/**********************************************************************************/
async function getOperationSearchMailFolders(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getResolveUserId(args, toolCfg);
  const query = getStr(args.query, "").trim().toLowerCase();
  if (!query) throw new Error("Missing mail folder search query");

  const list = await getOperationListMailFolders(wo, toolCfg, {
    ...args,
    version,
    userId,
    top: getClamp(getNum(args.top, 200), 1, 999)
  });

  const folders = getArr(list?.result?.value, []).filter(item => getStr(item.displayName, "").toLowerCase().includes(query));

  return {
    operation: "searchMailFolders",
    ok: true,
    status: 200,
    statusText: "OK",
    userId,
    query,
    result: folders
  };
}

/**********************************************************************************/
/* getOperationDeleteFiles                                                        */
/**********************************************************************************/
async function getOperationDeleteFiles(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const items = getArr(args.items, []);
  if (!items.length) throw new Error("Missing items");

  const useBatch = getBool(args.batch, true);
  if (!useBatch) {
    const results = [];
    for (const item of items) {
      const path = getResolveDriveItemPath(item, toolCfg);
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(wo, toolCfg, {
        baseUrl,
        path,
        method: "DELETE"
      });
      results.push({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        item
      });
    }

    return {
      operation: "deleteFiles",
      ok: results.every(v => v.ok),
      status: results.every(v => v.ok) ? 200 : 207,
      statusText: results.every(v => v.ok) ? "OK" : "MULTI_STATUS",
      results
    };
  }

  const requests = items.map((item, idx) => ({
    id: String(idx + 1),
    method: "DELETE",
    url: getGraphRelativeUrl(getResolveDriveItemPath(item, toolCfg))
  }));

  const batchRes = await getRunBatch(wo, toolCfg, version, requests);

  return {
    operation: "deleteFiles",
    ok: batchRes.ok,
    status: batchRes.status,
    statusText: batchRes.statusText,
    results: batchRes.responses.map((r, idx) => ({
      ...r,
      item: items[idx]
    }))
  };
}

/**********************************************************************************/
/* getOperationDeleteMails                                                        */
/**********************************************************************************/
async function getOperationDeleteMails(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const userId = getResolveUserId(args, toolCfg);
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  if (!messageIds.length) throw new Error("Missing messageIds");

  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(wo, toolCfg, {
        baseUrl,
        path: `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`,
        method: "DELETE"
      });
      results.push({
        id,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText
      });
    }

    return {
      operation: "deleteMails",
      ok: results.every(v => v.ok),
      status: results.every(v => v.ok) ? 200 : 207,
      statusText: results.every(v => v.ok) ? "OK" : "MULTI_STATUS",
      userId,
      results
    };
  }

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1),
    method: "DELETE",
    url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}`)
  }));

  const batchRes = await getRunBatch(wo, toolCfg, version, requests);

  return {
    operation: "deleteMails",
    ok: batchRes.ok,
    status: batchRes.status,
    statusText: batchRes.statusText,
    userId,
    results: batchRes.responses.map((r, idx) => ({
      ...r,
      messageId: messageIds[idx]
    }))
  };
}

/**********************************************************************************/
/* getOperationRenameFiles                                                        */
/**********************************************************************************/
async function getOperationRenameFiles(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const items = getArr(args.items, []);
  if (!items.length) throw new Error("Missing items");

  const results = [];
  for (const item of items) {
    const newName = getStr(item.newName, "");
    if (!newName) throw new Error("Missing newName in renameFiles item");
    const path = getResolveDriveItemPath(item, toolCfg);
    const baseUrl = getResolveBaseUrl(toolCfg, version);
    const res = await getGraphRequest(wo, toolCfg, {
      baseUrl,
      path,
      method: "PATCH",
      body: { name: newName }
    });
    results.push({
      item,
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      result: res.data
    });
  }

  return {
    operation: "renameFiles",
    ok: results.every(v => v.ok),
    status: results.every(v => v.ok) ? 200 : 207,
    statusText: results.every(v => v.ok) ? "OK" : "MULTI_STATUS",
    results
  };
}

/**********************************************************************************/
/* getOperationMoveEmails                                                         */
/**********************************************************************************/
async function getOperationMoveEmails(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const userId = getResolveUserId(args, toolCfg);
  const messageIds = getArr(args.messageIds, []).map(v => getStr(v, "")).filter(Boolean);
  const destinationFolderId = getStr(args.destinationFolderId, "");
  if (!messageIds.length) throw new Error("Missing messageIds");
  if (!destinationFolderId) throw new Error("Missing destinationFolderId");

  const useBatch = getBool(args.batch, true);

  if (!useBatch) {
    const results = [];
    for (const id of messageIds) {
      const baseUrl = getResolveBaseUrl(toolCfg, version);
      const res = await getGraphRequest(wo, toolCfg, {
        baseUrl,
        path: `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/move`,
        method: "POST",
        body: { destinationId: destinationFolderId }
      });
      results.push({
        messageId: id,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        result: res.data
      });
    }

    return {
      operation: "moveEmails",
      ok: results.every(v => v.ok),
      status: results.every(v => v.ok) ? 200 : 207,
      statusText: results.every(v => v.ok) ? "OK" : "MULTI_STATUS",
      userId,
      destinationFolderId,
      results
    };
  }

  const requests = messageIds.map((id, idx) => ({
    id: String(idx + 1),
    method: "POST",
    url: getGraphRelativeUrl(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(id)}/move`),
    headers: {
      "Content-Type": "application/json"
    },
    body: {
      destinationId: destinationFolderId
    }
  }));

  const batchRes = await getRunBatch(wo, toolCfg, version, requests);

  return {
    operation: "moveEmails",
    ok: batchRes.ok,
    status: batchRes.status,
    statusText: batchRes.statusText,
    userId,
    destinationFolderId,
    results: batchRes.responses.map((r, idx) => ({
      ...r,
      messageId: messageIds[idx]
    }))
  };
}

/**********************************************************************************/
/* getOperationSearchUsers                                                        */
/**********************************************************************************/
async function getOperationSearchUsers(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const query = getStr(args.query, "").trim();
  const top = getClamp(getNum(args.top, getNum(toolCfg.defaultPageSize, 25)), 1, 999);

  if (!query) throw new Error("Missing user search query");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: "/users",
    method: "GET",
    headers: {
      ConsistencyLevel: "eventual"
    },
    query: {
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $top: top,
      $select: getStr(args.select, "id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle,department,officeLocation,mobilePhone,businessPhones")
    }
  });

  return {
    operation: "searchUsers",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    query,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationShowUser                                                           */
/**********************************************************************************/
async function getOperationShowUser(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getStr(args.userId, "");
  if (!userId) throw new Error("Missing userId");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}`,
    method: "GET",
    query: {
      $select: getStr(args.select, "id,displayName,givenName,surname,mail,userPrincipalName,accountEnabled,jobTitle,department,officeLocation,mobilePhone,businessPhones,usageLocation,createdDateTime")
    }
  });

  return {
    operation: "showUser",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    user: res.data
  };
}

/**********************************************************************************/
/* getOperationCreateUser                                                         */
/**********************************************************************************/
async function getOperationCreateUser(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const user = getObj(args.user, {});
  if (!Object.keys(user).length) throw new Error("Missing user payload");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: "/users",
    method: "POST",
    body: user
  });

  return {
    operation: "createUser",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationUpdateUser                                                         */
/**********************************************************************************/
async function getOperationUpdateUser(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getStr(args.userId, "");
  const user = getObj(args.user, {});
  if (!userId) throw new Error("Missing userId");
  if (!Object.keys(user).length) throw new Error("Missing user payload");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: user
  });

  return {
    operation: "updateUser",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    result: res.data
  };
}

/**********************************************************************************/
/* getOperationDeleteUser                                                         */
/**********************************************************************************/
async function getOperationDeleteUser(wo, toolCfg, args) {
  const version = getResolveApiVersion(args, toolCfg);
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const userId = getStr(args.userId, "");
  if (!userId) throw new Error("Missing userId");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path: `/users/${encodeURIComponent(userId)}`,
    method: "DELETE"
  });

  return {
    operation: "deleteUser",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText
  };
}

/**********************************************************************************/
/* getOperationGraphRequest                                                       */
/**********************************************************************************/
async function getOperationGraphRequest(wo, toolCfg, args) {
  const request = getObj(args.request, {});
  if (!Object.keys(request).length) throw new Error("Missing request");

  const version = getStr(request.version, getResolveApiVersion(args, toolCfg));
  const baseUrl = getResolveBaseUrl(toolCfg, version);
  const path = getStr(request.path, "");
  if (!path) throw new Error("Missing request.path");

  const res = await getGraphRequest(wo, toolCfg, {
    baseUrl,
    path,
    method: getStr(request.method, "GET"),
    headers: getObj(request.headers, {}),
    query: getObj(request.query, {}),
    body: request.body,
    timeoutMs: getNum(request.timeoutMs, getNum(toolCfg.timeoutMs, DEFAULT_TIMEOUT_MS))
  });

  return {
    operation: "graphRequest",
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    result: res.data
  };
}

/**********************************************************************************/
/* getInvoke                                                                      */
/**********************************************************************************/
async function getInvoke(args, coreData) {
  const wo = getObj(coreData?.workingObject, {});
  const allToolsCfg = getObj(wo.toolsconfig, {});
  const toolCfg = getObj(allToolsCfg[MODULE_NAME], {});
  const operation = getStr(args?.operation, "").trim();

  if (!operation) throw new Error("Missing operation");

  switch (operation) {
    case "fulltextSearch":
      return await getOperationFulltextSearch(wo, toolCfg, args);

    case "showFile":
      return await getOperationShowFile(wo, toolCfg, args);

    case "listFiles":
      return await getOperationListFiles(wo, toolCfg, args);

    case "downloadFile":
      return await getOperationDownloadFile(wo, toolCfg, args);

    case "uploadFile":
      return await getOperationUploadFile(wo, toolCfg, args);

    case "createUploadSession":
      return await getOperationCreateUploadSession(wo, toolCfg, args);

    case "searchEmails":
      return await getOperationSearchEmails(wo, toolCfg, args);

    case "showEmails":
      return await getOperationShowEmails(wo, toolCfg, args);

    case "listMailFolders":
      return await getOperationListMailFolders(wo, toolCfg, args);

    case "searchMailFolders":
      return await getOperationSearchMailFolders(wo, toolCfg, args);

    case "deleteFiles":
      return await getOperationDeleteFiles(wo, toolCfg, args);

    case "deleteMails":
      return await getOperationDeleteMails(wo, toolCfg, args);

    case "renameFiles":
      return await getOperationRenameFiles(wo, toolCfg, args);

    case "moveEmails":
      return await getOperationMoveEmails(wo, toolCfg, args);

    case "searchUsers":
      return await getOperationSearchUsers(wo, toolCfg, args);

    case "showUser":
      return await getOperationShowUser(wo, toolCfg, args);

    case "createUser":
      return await getOperationCreateUser(wo, toolCfg, args);

    case "updateUser":
      return await getOperationUpdateUser(wo, toolCfg, args);

    case "deleteUser":
      return await getOperationDeleteUser(wo, toolCfg, args);

    case "graphRequest":
      return await getOperationGraphRequest(wo, toolCfg, args);

    default:
      throw new Error(`Unsupported getGraph operation: ${operation}`);
  }
}

/**********************************************************************************/
/* definition                                                                     */
/**********************************************************************************/
const definition = {
  type: "function",
  function: {
    name: MODULE_NAME,
    description: "Access Microsoft Graph with fixed operations for search, files, mail and users, plus a generic JSON request mode.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "The operation to perform.",
          enum: [
            "fulltextSearch",
            "showFile",
            "listFiles",
            "downloadFile",
            "uploadFile",
            "createUploadSession",
            "searchEmails",
            "showEmails",
            "listMailFolders",
            "searchMailFolders",
            "deleteFiles",
            "deleteMails",
            "renameFiles",
            "moveEmails",
            "searchUsers",
            "showUser",
            "createUser",
            "updateUser",
            "deleteUser",
            "graphRequest"
          ]
        },
        version: {
          type: "string",
          description: "Graph API version to use, usually v1.0 or beta."
        },
        userId: {
          type: "string",
          description: "User id or userPrincipalName for user, mail or drive operations."
        },
        query: {
          type: "string",
          description: "Search query for fulltext, mail folder, email or user search."
        },
        entityTypes: {
          type: "array",
          description: "Entity types for Graph search/query, for example driveItem or message.",
          items: { type: "string" }
        },
        size: {
          type: "number",
          description: "Number of results for fulltext search."
        },
        from: {
          type: "number",
          description: "Offset for fulltext search."
        },
        top: {
          type: "number",
          description: "Top result count for list operations."
        },
        select: {
          type: "string",
          description: "Optional Graph $select projection."
        },
        bodyType: {
          type: "string",
          description: "Body type for mail reads: text or html."
        },
        driveId: {
          type: "string",
          description: "Drive id for file operations."
        },
        siteId: {
          type: "string",
          description: "Site id for SharePoint file operations."
        },
        itemId: {
          type: "string",
          description: "Drive item id."
        },
        path: {
          type: "string",
          description: "Drive-relative path for file operations."
        },
        parentPath: {
          type: "string",
          description: "Parent folder path for upload operations."
        },
        fileName: {
          type: "string",
          description: "Filename for upload or upload session creation."
        },
        contentBase64: {
          type: "string",
          description: "Base64 encoded file content for small uploads."
        },
        contentType: {
          type: "string",
          description: "Content type for file upload."
        },
        conflictBehavior: {
          type: "string",
          description: "Conflict behavior for upload session or upload file."
        },
        downloadMode: {
          type: "string",
          description: "Download mode: base64, text or auto."
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds."
        },
        messageIds: {
          type: "array",
          description: "List of message ids for mail operations.",
          items: { type: "string" }
        },
        destinationFolderId: {
          type: "string",
          description: "Destination folder id for moveEmails."
        },
        batch: {
          type: "boolean",
          description: "Use Graph $batch where supported."
        },
        items: {
          type: "array",
          description: "File item definitions for deleteFiles or renameFiles.",
          items: {
            type: "object",
            properties: {
              driveId: { type: "string" },
              siteId: { type: "string" },
              userId: { type: "string" },
              itemId: { type: "string" },
              path: { type: "string" },
              newName: { type: "string" }
            }
          }
        },
        user: {
          type: "object",
          description: "Payload for createUser or updateUser."
        },
        request: {
          type: "object",
          description: "Generic JSON Graph request.",
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