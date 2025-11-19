/**************************************************************
/* filename: "getConfluence.js"                               *
/* Version 1.0                                                *
/* Purpose: Confluence v2-only proxy with enforced space,     *
/*          Markdown→storage, safe external image embedding,  *
/*          page read/update/delete/list, attachment          *
/*          upload+embed, constrained generic API access.     *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

const MODULE_NAME = "getConfluence";
const SPACE_ID_CACHE = new Map();

/**************************************************************
/* functionSignature: getStr (v, f)                          *
/* Returns v if it is a non-empty string, otherwise f.       *
/**************************************************************/
function getStr(v, f){ return (typeof v === "string" && v.length) ? v : f; }

/**************************************************************
/* functionSignature: getNum (v, f)                          *
/* Returns a finite number or the fallback value f.          *
/**************************************************************/
function getNum(v, f){ return Number.isFinite(v) ? Number(v) : f; }

/**************************************************************
/* functionSignature: getBool (v, f)                         *
/* Returns v if it is boolean, otherwise f.                  *
/**************************************************************/
function getBool(v, f){ return typeof v === "boolean" ? v : f; }

/**************************************************************
/* functionSignature: getDebug (label, obj)                  *
/* No-op debug hook.                                         *
/**************************************************************/
function getDebug(label, obj){}

/**************************************************************
/* functionSignature: getAuthHeader (email, token)           *
/* Builds Basic auth header for Confluence.                  *
/**************************************************************/
function getAuthHeader(email, token){
  const b64 = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

/**************************************************************
/* functionSignature: getEscapeText (str)                    *
/* Escapes text for XML contexts.                            *
/**************************************************************/
function getEscapeText(str){
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**************************************************************
/* functionSignature: getEscapeAttr (str)                    *
/* Escapes attribute values for XML contexts.                *
/**************************************************************/
function getEscapeAttr(str){
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**************************************************************
/* functionSignature: setDefaultDownloadHeaders ()           *
/* Returns default headers for binary downloads.             *
/**************************************************************/
function setDefaultDownloadHeaders(){
  return {
    "User-Agent":"Mozilla/5.0",
    "Accept":"*/*"
  };
}

/**************************************************************
/* functionSignature: getMergeOk (baseOk, attachment,        *
/* hadFile)                                                  *
/* Merges ok with attachment state if a file was processed.  *
/**************************************************************/
function getMergeOk(baseOk, attachment, hadFile){
  if (!hadFile) return !!baseOk;
  if (!attachment) return false;
  return !!attachment.ok;
}

/**************************************************************
/* functionSignature: getFetchJson (url, opts, timeoutMs)    *
/* Fetches URL with timeout and returns parsed JSON or text. *
/**************************************************************/
async function getFetchJson(url, opts = {}, timeoutMs = 60000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    const ct = String(res.headers.get("content-type") || "");
    const isJson = ct.includes("application/json");
    const data = isJson ? (text ? JSON.parse(text) : null) : text;
    return { ok: res.ok, status: res.status, headers: res.headers, data, raw: text };
  } finally {
    clearTimeout(t);
  }
}

/**************************************************************
/* functionSignature: getFetchBinary (url, opts, timeoutMs)  *
/* Fetches URL with timeout and returns ArrayBuffer.         *
/**************************************************************/
async function getFetchBinary(url, opts = {}, timeoutMs = 60000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const merged = { ...opts };
    merged.headers = { ...(setDefaultDownloadHeaders()), ...(opts.headers||{}) };
    const res = await fetch(url, { ...merged, signal: ctrl.signal });
    const ab = await res.arrayBuffer();
    return { ok: res.ok, status: res.status, headers: res.headers, data: ab };
  } finally {
    clearTimeout(t);
  }
}

/**************************************************************
/* functionSignature: getExtractPageIdFromUrl (u)            *
/* Extracts pageId from a Confluence page URL.               *
/**************************************************************/
function getExtractPageIdFromUrl(u){
  try {
    if (!u) return null;
    const m = String(u).match(/\/pages\/(\d+)\b/);
    return m ? m[1] : null;
  } catch { return null; }
}

/**************************************************************
/* functionSignature: getRenderInline (md)                   *
/* Converts inline markdown to Confluence storage HTML.      *
/**************************************************************/
function getRenderInline(md){
  let s = String(md ?? "");
  s = s.replace(/`([^`]+)`/g, (_, g1) => `<code>${getEscapeText(g1)}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
    `<ac:image><ri:url ri:value="${getEscapeAttr(url.trim())}"/></ac:image>`
  );
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) =>
    `<a href="${getEscapeAttr(url.trim())}">${getEscapeText(txt.trim())}</a>`
  );
  s = s.replace(/(\*\*|__)(.+?)\1/g, (_, _m, inner) => `<strong>${getEscapeText(inner)}</strong>`);
  s = s.replace(/(^|[^\*])\*(?!\s)(.+?)(?!\s)\*(?!\*)/g, (m, pre, inner) => `${pre}<em>${getEscapeText(inner)}</em>`);
  s = s.replace(/(^|[^_])_(?!\s)(.+?)(?!\s)_(?!_)/g, (m, pre, inner) => `${pre}<em>${getEscapeText(inner)}</em>`);
  const parts = s.split(/(<[^>]+>)/g).map((chunk, i) => (i % 2 === 1 ? chunk : getEscapeText(chunk)));
  return parts.join("");
}

/**************************************************************
/* functionSignature: getStorageHtmlFromMarkdown (md)        *
/* Converts markdown blocks to Confluence storage HTML.      *
/**************************************************************/
function getStorageHtmlFromMarkdown(md){
  const s = String(md || "").replace(/\r\n/g, "\n");
  const lines = s.split("\n");
  const blocks = [];
  let paraBuf = [];
  let listBuf = null;
  let inCode = false;
  let codeBuf = [];

  function flushPara(){
    if (paraBuf.length){ blocks.push(`<p>${paraBuf.join("<br/>")}</p>`); paraBuf = []; }
  }
  function flushList(){
    if (listBuf && listBuf.items.length){
      const lis = listBuf.items.map(it => `<li>${it}</li>`).join("");
      blocks.push(`<ul>${lis}</ul>`);
    }
    listBuf = null;
  }
  function flushCode(){
    if (inCode){
      const escaped = getEscapeText(codeBuf.join("\n"));
      blocks.push(`<pre><code>${escaped}</code></pre>`);
      inCode = false; codeBuf = [];
    }
  }

  for (const rawLine of lines){
    const line = rawLine.replace(/\s+$/,"");

    if (line.trim().startsWith("```")){
      if (!inCode){ flushPara(); flushList(); inCode = true; codeBuf = []; }
      else { flushCode(); }
      continue;
    }
    if (inCode){ codeBuf.push(line); continue; }

    if (!line.trim()){ flushPara(); flushList(); continue; }

    if (/^---\s*$/.test(line.trim())){ flushPara(); flushList(); blocks.push(`<hr/>`); continue; }

    if (line.startsWith("### ")){ flushPara(); flushList(); blocks.push(`<h3>${getRenderInline(line.slice(4).trim())}</h3>`); continue; }
    if (line.startsWith("## ")){  flushPara(); flushList(); blocks.push(`<h2>${getRenderInline(line.slice(3).trim())}</h2>`); continue; }
    if (line.startsWith("# ")){   flushPara(); flushList(); blocks.push(`<h1>${getRenderInline(line.slice(2).trim())}</h1>`); continue; }

    if (line.startsWith("> ")){ flushPara(); flushList(); blocks.push(`<blockquote><p>${getRenderInline(line.slice(2).trim())}</p></blockquote>`); continue; }

    if (line.startsWith("- ")){
      const itemText = getRenderInline(line.slice(2).trim());
      if (!listBuf){ flushPara(); listBuf = { type: "ul", items: [] }; }
      listBuf.items.push(itemText);
      continue;
    }

    if (listBuf){ flushList(); }

    const inline = getRenderInline(line);
    const onlyImage = /^<ac:image[\s\S]*<\/ac:image>\s*$/.test(inline);
    if (onlyImage){
      blocks.push(`<p>${inline}</p>`);
      continue;
    }

    paraBuf.push(inline);
  }

  flushCode(); flushPara(); flushList();
  return blocks.join("\n");
}

/**************************************************************
/* functionSignature: getAbsolutizeUrlMaybe (u, baseUrl)     *
/* Absolutizes relative URLs against the Confluence base.    *
/**************************************************************/
function getAbsolutizeUrlMaybe(u, baseUrl){
  if (!u) return u;
  try {
    if (/^https?:\/\//i.test(u)) return u;
    const b = new URL(baseUrl);
    const hasWiki = b.pathname.replace(/\/+$/,'').endsWith('/wiki');
    let path = u;
    if (hasWiki && path.startsWith('/') && !path.startsWith('/wiki/')) {
      path = '/wiki' + path;
    }
    return new URL(path, b.origin).toString();
  } catch { return u; }
}

/**************************************************************
/* functionSignature: getAbsolutizeLinks (obj, baseUrl)      *
/* Normalizes _links fields to absolute URLs.                *
/**************************************************************/
function getAbsolutizeLinks(obj, baseUrl){
  if (!obj || typeof obj !== "object") return obj;
  const links = obj._links || {};
  const normalized = { ...links };
  normalized.base = baseUrl;
  const keys = ["webui","self","tinyui","download","edit","children","restrictions","space","ancestors","descendants","version","history"];
  for (const k of keys){
    if (normalized[k]) normalized[k] = getAbsolutizeUrlMaybe(normalized[k], baseUrl);
  }
  return { ...obj, _links: normalized };
}

/**************************************************************
/* functionSignature: getAttachAbsoluteLinksToResult (r,     *
/* baseUrl)                                                  *
/* Adds absolute URLs and convenience fields to payload.     *
/**************************************************************/
function getAttachAbsoluteLinksToResult(r, baseUrl){
  const withLinks = getAbsolutizeLinks(r, baseUrl);
  const webui = withLinks?._links?.webui || "";
  const self  = withLinks?._links?.self  || "";
  const tiny  = withLinks?._links?.tinyui || "";
  const dl    = withLinks?._links?.download || "";
  return {
    ...withLinks,
    abs: { webui, self, tinyui: tiny, download: dl },
    viewUrl: webui || self || null
  };
}

/**************************************************************
/* functionSignature: getResolvedSpaceId (baseUrl, spaceKey, *
/* headers)                                                  *
/* Resolves a v2 spaceId by space key with caching.          *
/**************************************************************/
async function getResolvedSpaceId(baseUrl, spaceKey, headers){
  const cached = SPACE_ID_CACHE.get(spaceKey);
  if (cached && (Date.now() - cached.ts) < 600000) return cached.id;
  const url = `${baseUrl}/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok || !res.data || !Array.isArray(res.data.results) || !res.data.results.length) return null;
  const id = String(res.data.results[0].id);
  SPACE_ID_CACHE.set(spaceKey, { id, ts: Date.now() });
  return id;
}

/**************************************************************
/* functionSignature: getSpaceIdFromParent (baseUrl,         *
/* parentId, headers)                                        *
/* Reads parent page to derive its spaceId.                  *
/**************************************************************/
async function getSpaceIdFromParent(baseUrl, parentId, headers){
  if (!parentId) return null;
  const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(String(parentId))}?body-format=storage`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok || !res.data) return null;
  return res.data.spaceId != null ? String(res.data.spaceId) : null;
}

/**************************************************************
/* functionSignature: getPageV2Storage (baseUrl, pageId,     *
/* headers)                                                  *
/* Retrieves a v2 page including storage body.               *
/**************************************************************/
async function getPageV2Storage(baseUrl, pageId, headers){
  const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok) return null;
  return res.data;
}

/**************************************************************
/* functionSignature: getMakeAbsNextUrl (baseUrl, nextPath)  *
/* Converts a relative 'next' link to absolute URL.          *
/**************************************************************/
function getMakeAbsNextUrl(baseUrl, nextPath){
  try {
    const base = new URL(baseUrl);
    if (!nextPath) return null;
    if (/^https?:\/\//i.test(nextPath)) return nextPath;
    return new URL(nextPath, `${base.origin}`).toString();
  } catch { return null; }
}

/**************************************************************
/* functionSignature: getPageAnyStatusV1 (baseUrl, pageId,   *
/* headers)                                                  *
/* Fetches v1 content with status any for recovery checks.   *
/**************************************************************/
async function getPageAnyStatusV1(baseUrl, pageId, headers){
  const url = `${new URL(baseUrl).origin}/wiki/rest/api/content/${encodeURIComponent(pageId)}?status=any`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  return res.ok ? res.data : null;
}

/**************************************************************
/* functionSignature: getFindCurrentPageIdByTitleV2 (        *
/* baseUrl, spaceId, title, headers)                         *
/* Finds current page id by title via v2 pages endpoint.     *
/**************************************************************/
async function getFindCurrentPageIdByTitleV2(baseUrl, spaceId, title, headers){
  if (!title) return null;
  const normalizedTitle = String(title).trim();
  if (!normalizedTitle) return null;
  if (!spaceId) return null;

  const root = baseUrl.replace(/\/+$/, "");
  let url;
  try {
    const u = new URL(root + "/api/v2/pages");
    u.searchParams.set("spaceId", String(spaceId));
    u.searchParams.set("title", normalizedTitle);
    u.searchParams.set("status", "current");
    u.searchParams.set("limit", "25");
    url = u.toString();
  } catch {
    url = root + "/api/v2/pages";
  }

  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok || !res.data || !Array.isArray(res.data.results) || !res.data.results.length) return null;
  const results = res.data.results;

  const hit = results.find(r => String(r.title || "").trim() === normalizedTitle) || results[0];
  const id = hit && (hit.id != null ? String(hit.id) : null);
  return id || null;
}

/**************************************************************
/* functionSignature: getFindCurrentPageIdByTitleV1 (        *
/* baseUrl, spaceKey, title, headers)                        *
/* Finds current page id by title via CQL in v1.             *
/**************************************************************/
async function getFindCurrentPageIdByTitleV1(baseUrl, spaceKey, title, headers){
  if (!title) return null;
  const cql = `title="${String(title).replace(/"/g,'\\"')}" AND space="${spaceKey}" AND type=page AND status=current`;
  const url = `${new URL(baseUrl).origin}/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=1`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok || !res.data || !Array.isArray(res.data.results) || !res.data.results.length) return null;
  const r = res.data.results[0];
  const id = r?.content?.id || r?.id;
  return id ? String(id) : null;
}

/**************************************************************
/* functionSignature: getResolveUsablePageId (baseUrl,       *
/* headers, spaceKey, rawPageId, pageUrl, titleFromArgs)     *
/* Resolves a usable current page id, handling trashed refs. *
/**************************************************************/
async function getResolveUsablePageId(baseUrl, headers, spaceKey, rawPageId, pageUrl, titleFromArgs){
  let pageId = rawPageId || getExtractPageIdFromUrl(pageUrl) || "";
  const spaceIdFromKey = await getResolvedSpaceId(baseUrl, spaceKey, headers);

  if (!pageId && titleFromArgs && spaceIdFromKey){
    const byTitleV2 = await getFindCurrentPageIdByTitleV2(baseUrl, spaceIdFromKey, titleFromArgs, headers);
    if (byTitleV2) pageId = byTitleV2;
  }

  if (!pageId && titleFromArgs){
    const byTitle = await getFindCurrentPageIdByTitleV1(baseUrl, spaceKey, titleFromArgs, headers);
    if (byTitle) pageId = byTitle;
  }

  if (!pageId) return { ok:false, error:"PAGE_ID_MISSING" };

  const v2 = await getPageV2Storage(baseUrl, pageId, headers);
  if (v2 && v2.status === "current") return { ok:true, pageId, page:v2 };

  const v1any = await getPageAnyStatusV1(baseUrl, pageId, headers);
  const isTrashed = !!v1any && (v1any.status === "trashed" || v1any.status === "deleted");
  const lookupTitle = getStr(titleFromArgs, getStr(v1any?.title, ""));

  if (!isTrashed) return { ok:false, error:"PAGE_NOT_FOUND_OR_INACCESSIBLE", pageId };

  const resolvedId = await getFindCurrentPageIdByTitleV1(baseUrl, spaceKey, lookupTitle, headers);
  if (!resolvedId) return { ok:false, error:"PAGE_TRASHED_AND_NO_CURRENT_FOUND", old_pageId: pageId, tried_title: lookupTitle };

  const v2resolved = await getPageV2Storage(baseUrl, resolvedId, headers);
  if (!v2resolved || v2resolved.status !== "current") {
    return { ok:false, error:"RESOLVED_PAGE_NOT_CURRENT", pageId: resolvedId };
  }
  return { ok:true, pageId: resolvedId, page: v2resolved, note:"resolved_from_trashed" };
}

/**************************************************************
/* functionSignature: getPostAttachmentV2 (baseUrl, pageId,  *
/* headers, filename, arrayBuffer, contentType)              *
/* Uploads an attachment using v2 API.                       *
/**************************************************************/
async function getPostAttachmentV2(baseUrl, pageId, headers, filename, arrayBuffer, contentType){
  const base = new URL(baseUrl);
  const url = `${base.origin}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments`;
  const form = new FormData();
  const blob = new Blob([arrayBuffer], { type: contentType || "application/octet-stream" });
  form.append("file", blob, filename);
  const safeHeaders = { ...headers };
  delete safeHeaders["Content-Type"];
  const res = await fetch(url, { method: "POST", headers: safeHeaders, body: form });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data, raw: text };
}

/**************************************************************
/* functionSignature: getPostAttachmentV1 (baseUrl, pageId,  *
/* headers, filename, arrayBuffer, contentType)              *
/* Uploads an attachment using v1 API as fallback.           *
/**************************************************************/
async function getPostAttachmentV1(baseUrl, pageId, headers, filename, arrayBuffer, contentType){
  const base = new URL(baseUrl);
  const url = `${base.origin}/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`;
  const form = new FormData();
  const blob = new Blob([arrayBuffer], { type: contentType || "application/octet-stream" });
  form.append("file", blob, filename);
  const safeHeaders = { ...headers, "X-Atlassian-Token": "no-check" };
  delete safeHeaders["Content-Type"];
  const res = await fetch(url, { method: "POST", headers: safeHeaders, body: form });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data, raw: text };
}

/**************************************************************
/* functionSignature: getPickAttachmentFilename (uploadData, *
/* fallbackName)                                             *
/* Picks a stored attachment filename from response.         *
/**************************************************************/
function getPickAttachmentFilename(uploadData, fallbackName){
  if (!uploadData) return fallbackName;
  if (uploadData.title) return String(uploadData.title);
  if (Array.isArray(uploadData.results) && uploadData.results[0]?.title) {
    return String(uploadData.results[0].title);
  }
  if (uploadData?.data?.results?.[0]?.title) {
    return String(uploadData.data.results[0].title);
  }
  return fallbackName;
}

/**************************************************************
/* functionSignature: getBuildImageHtmlFromArgs (args)       *
/* Builds safe image HTML for external URLs only.            *
/**************************************************************/
function getBuildImageHtmlFromArgs(args) {
  const single = typeof args?.imageUrl === "string" && args.imageUrl.trim()
    ? [args.imageUrl.trim()]
    : [];
  const many = Array.isArray(args?.imageUrls)
    ? args.imageUrls.map(x => String(x || "").trim()).filter(Boolean)
    : [];
  const allRaw = [...single, ...many];

  const all = allRaw.filter(u => {
    const s = String(u || "");
    if (!/^https?:\/\//i.test(s)) return false;
    if (s.includes("{{") || s.includes("}}")) return false;
    return true;
  });

  if (!all.length) return "";

  const alt = typeof args?.imageAlt === "string" ? args.imageAlt.trim() : "";
  const caption = typeof args?.imageCaption === "string" ? args.imageCaption.trim() : "";

  const parts = [];
  for (const url of all) {
    const altAttr = alt ? ` ac:alt="${getEscapeAttr(alt)}"` : "";
    const capHtml = caption ? `\n<p>${getEscapeText(caption)}</p>` : "";
    parts.push(
      `<p><ac:image${altAttr}><ri:url ri:value="${getEscapeAttr(url)}"/></ac:image></p>${capHtml}`
    );
  }
  return parts.join("\n");
}

/**************************************************************
/* functionSignature: getAttachFileToPageAndEmbed (opts)     *
/* Downloads, uploads to page, and optionally embeds image.  *
/**************************************************************/
async function getAttachFileToPageAndEmbed({
  baseUrl,
  headers,
  page,
  fileUrl,
  filename = "attachment",
  contentType = "",
  caption = "",
  embed = true,
  downloadHeaders = null
}){
  const dlHeaders = downloadHeaders && typeof downloadHeaders === "object" ? downloadHeaders : {};
  const bin = await getFetchBinary(fileUrl, { headers: dlHeaders }, 120000);
  if (!bin.ok) {
    return { ok:false, error:"ATTACH_DOWNLOAD_FAILED", status: bin.status };
  }

  let upload = await getPostAttachmentV2(baseUrl, page.id, headers, filename, bin.data, contentType);
  if (!upload.ok && [400,404,405,409,415,500,501].includes(upload.status)) {
    upload = await getPostAttachmentV1(baseUrl, page.id, headers, filename, bin.data, contentType);
  }
  if (!upload.ok) {
    return { ok:false, error:"ATTACH_UPLOAD_FAILED", status: upload.status, data: upload.data };
  }

  const storedName = getPickAttachmentFilename(upload.data, filename);
  if (!embed) {
    return { ok:true, mode:"uploaded", filename: storedName, upload };
  }

  const latest = await getPageV2Storage(baseUrl, page.id, headers);
  if (!latest) {
    return { ok:false, error:"ATTACH_EMBED_RELOAD_FAILED" };
  }

  const imgHtml = `<p><ac:image><ri:attachment ri:filename="${getEscapeAttr(storedName)}"/></ac:image></p>${caption ? `\n<p>${getEscapeText(caption)}</p>` : ""}`;
  const merged = String(latest?.body?.storage?.value || "") + "\n" + imgHtml;

  const putBody = {
    id: page.id,
    status: "current",
    title: latest.title,
    spaceId: latest.spaceId,
    body: { representation: "storage", value: merged },
    version: { number: (latest.version && latest.version.number ? Number(latest.version.number) + 1 : 2) }
  };
  const urlPut = `${baseUrl}/api/v2/pages/${encodeURIComponent(page.id)}`;
  const resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody) }, 60000);

  return {
    ok: !!resPut.ok,
    mode: "uploaded+embedded",
    filename: storedName,
    upload,
    page: resPut.data ? getAttachAbsoluteLinksToResult(resPut.data, baseUrl) : resPut.data
  };
}

/**************************************************************
/* functionSignature: getEnsureApiScope (method, baseUrl,    *
/* path, spaceId, headers)                                   *
/* Enforces GET scope to /api/v2/pages within the space.     *
/**************************************************************/
async function getEnsureApiScope(method, baseUrl, path, spaceId, headers){
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET") return { ok:false, error:"API_METHOD_NOT_ALLOWED", hint:"Only GET is allowed in 'api' op." };

  const abs = path.startsWith("http") ? path : (baseUrl + (path.startsWith("/") ? path : `/${path}`));
  let urlObj;
  try { urlObj = new URL(abs); } catch { return { ok:false, error:"API_PATH_INVALID", hint:"Malformed URL" }; }

  if (!/\/api\/v2\/pages(\/|$)/.test(urlObj.pathname)) {
    return { ok:false, error:"API_SCOPE_FORBIDDEN", hint:"Only /api/v2/pages endpoints are allowed." };
  }

  const pageIdMatch = urlObj.pathname.match(/\/api\/v2\/pages\/([^/]+)$/);
  if (pageIdMatch) {
    const pageId = pageIdMatch[1];
    const base = new URL(baseUrl);
    const pageUrl = `${base.origin}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;
    const res = await getFetchJson(pageUrl, { method: "GET", headers }, 20000);
    if (!res.ok || !res.data) return { ok:false, error:"PAGE_NOT_FOUND", pageId };
    const pSpaceId = String(res.data.spaceId || "");
    if (pSpaceId !== String(spaceId)) {
      return { ok:false, error:"API_PAGE_OUT_OF_SPACE", pageId, expected_spaceId: String(spaceId), got_spaceId: pSpaceId };
    }
    return { ok:true, url: urlObj.toString() };
  }

  const hasSpace = urlObj.searchParams.has("spaceId");
  if (!hasSpace) urlObj.searchParams.set("spaceId", String(spaceId));
  if (hasSpace && urlObj.searchParams.get("spaceId") !== String(spaceId)) {
    return { ok:false, error:"API_LIST_OUT_OF_SPACE", expected_spaceId: String(spaceId), got_spaceId: urlObj.searchParams.get("spaceId") };
  }
  return { ok:true, url: urlObj.toString() };
}

/**************************************************************
/* functionSignature: getEffectiveSpaceId (baseUrl, headers, *
/* spaceKey, parentId)                                       *
/* Resolves spaceId via parent page or space key.            *
/**************************************************************/
async function getEffectiveSpaceId(baseUrl, headers, spaceKey, parentId){
  const byParent = await getSpaceIdFromParent(baseUrl, parentId, headers);
  if (byParent) return { ok:true, spaceId: byParent, source: "parent" };
  const byKey = await getResolvedSpaceId(baseUrl, spaceKey, headers);
  if (byKey) return { ok:true, spaceId: byKey, source: "spaceKey" };
  return { ok:false };
}

/**************************************************************
/* functionSignature: getNormalizeStatus (statusStr)         *
/* Normalizes status filter for list operation.              *
/**************************************************************/
function getNormalizeStatus(statusStr){
  const allowed = new Set(["CURRENT","ARCHIVED","TRASHED","DELETED"]);
  if (!statusStr) return "CURRENT,ARCHIVED";
  const mapped = statusStr.split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase())
    .map(s => (s === "DRAFT" ? "CURRENT" : s))
    .filter(s => allowed.has(s));
  return mapped.length ? mapped.join(",") : "CURRENT,ARCHIVED";
}

/**************************************************************
/* functionSignature: getInvoke (args, coreData)             *
/* Main entry for all operations against Confluence.         *
/**************************************************************/
async function getInvoke(args, coreData){
  const startedAt = Date.now();
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.getConfluence || {};
  const baseUrl = getStr(cfg?.baseUrl,"").replace(/\/+$/,"");
  const email   = getStr(cfg?.email,"");
  const token   = getStr(cfg?.token,"");
  const spaceKey = getStr(cfg?.project, "ST");
  const parentId = getStr(cfg?.mainPageId, "");
  const timeoutMs = 60000;

  if (!baseUrl || !email || !token){
    return { ok:false, error:"CONF_CONFIG_MISSING", hint:"toolsconfig.getConfluence needs { baseUrl, email, token, project, mainPageId }" };
  }

  const op = getStr(args?.op, "api");
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    ...getAuthHeader(email, token)
  };

  let enforced = null;
  if (op !== "api") {
    const eff = await getEffectiveSpaceId(baseUrl, headers, spaceKey, parentId);
    if (!eff.ok) {
      return {
        ok:false,
        error:"SPACE_NOT_FOUND",
        hint:`Could not resolve spaceId via mainPageId='${parentId}' or project='${spaceKey}'`,
        enforced:{ spaceKey, parentId },
        took_ms: Date.now() - startedAt
      };
    }
    enforced = eff.spaceId;
  }

  if (op === "create") {
    const title = getStr(args.title, `AI Import ${new Date().toISOString()}`);
    const md = getStr(args.markdown, "# (empty)\n");
    const storageHtml = getStorageHtmlFromMarkdown(md);
    const extraImagesHtml = getBuildImageHtmlFromArgs(args);
    const finalHtml = extraImagesHtml ? storageHtml + "\n" + extraImagesHtml : storageHtml;

    const body = {
      spaceId: enforced,
      status: "current",
      title,
      body: { representation: "storage", value: finalHtml }
    };
    if (parentId) body.parentId = String(parentId);

    const url = `${baseUrl}/api/v2/pages`;
    const res = await getFetchJson(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
    const createdPage = (res.data && res.data.id) ? getAttachAbsoluteLinksToResult(res.data, baseUrl) : res.data;

    const baseReturn = {
      ok: !!res.ok,
      status: res.status,
      url,
      data: createdPage,
      sent: body,
      enforced: { spaceKey, spaceId: enforced, parentId },
      took_ms: Date.now() - startedAt,
      editor: "v2/storage"
    };

    const fileUrl = getStr(args.fileUrl, "");
    const downloadHeaders = args && typeof args.downloadHeaders === "object" ? args.downloadHeaders : null;
    if (!res.ok || !createdPage?.id || !fileUrl) {
      return baseReturn;
    }
    const attachRes = await getAttachFileToPageAndEmbed({
      baseUrl,
      headers,
      page: createdPage,
      fileUrl,
      filename: getStr(args.filename, "attachment"),
      contentType: getStr(args.contentType, ""),
      caption: getStr(args.caption, ""),
      embed: args.embed !== false,
      downloadHeaders
    });

    const mergedOk = getMergeOk(baseReturn.ok, attachRes, !!fileUrl);
    return {
      ...baseReturn,
      ok: mergedOk,
      attachment: attachRes
    };
  }

  if (op === "append") {
    const pageUrl = getStr(args.pageUrl, "");
    let pageIdArg = getStr(args.pageId, "");
    const titleArg = getStr(args.title, "");
    const prependNote = getStr(args.prependNote, "");

    const resolved = await getResolveUsablePageId(baseUrl, headers, spaceKey, pageIdArg, pageUrl, titleArg);
    if (!resolved.ok) return { ok:false, ...resolved, took_ms: Date.now() - startedAt };
    let pageId = resolved.pageId;
    let page = resolved.page;

    if (String(page.spaceId || "") !== String(enforced)) {
      return { ok:false, error:"PAGE_OUT_OF_SPACE", pageId, expected_spaceId:String(enforced), got_spaceId:String(page.spaceId||"") };
    }

    const md = getStr(args.markdown, "");
    const noteHtml = prependNote ? `<p>${getEscapeText(prependNote)}</p>` : "";
    const newHtmlPart = md ? getStorageHtmlFromMarkdown(md) : "";
    const extraImagesHtml = getBuildImageHtmlFromArgs(args);
    const baseNewHtml = (noteHtml + (noteHtml && newHtmlPart ? "\n" : "") + newHtmlPart).trim();
    const newHtml = extraImagesHtml
      ? (baseNewHtml ? baseNewHtml + "\n" + extraImagesHtml : extraImagesHtml)
      : baseNewHtml;

    if (!newHtml && !getStr(args.fileUrl, "")) return { ok:false, error:"APPEND_EMPTY" };

    const oldHtml = String(page?.body?.storage?.value || "");
    const mergedHtml = newHtml ? (oldHtml + "\n" + newHtml) : oldHtml;

    async function putOnce(p, html){
      const putBody = {
        id: pageId,
        status: "current",
        title: p.title,
        spaceId: p.spaceId || enforced,
        body: { representation: "storage", value: html },
        version: { number: (p.version && p.version.number ? Number(p.version.number) + 1 : 2) }
      };
      const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
      return await getFetchJson(url, { method: "PUT", headers, body: JSON.stringify(putBody) }, timeoutMs);
    }

    let res = await putOnce(page, mergedHtml);
    if (res.status === 409) {
      const latest = await getPageV2Storage(baseUrl, pageId, headers);
      if (!latest) return { ok:false, status:409, error:"CONFLICT_RELOAD_FAILED", pageId, took_ms: Date.now() - startedAt };
      const latestOldHtml = String(latest?.body?.storage?.value || "");
      const latestMerged = latestOldHtml + "\n" + newHtml;
      res = await putOnce(latest, latestMerged);
    }

    const payloadData = (res.data && res.data.id) ? getAttachAbsoluteLinksToResult(res.data, baseUrl) : res.data;
    const baseReturn = {
      ok: !!res.ok,
      status: res.status,
      url: `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`,
      data: payloadData,
      took_ms: Date.now() - startedAt,
      editor: "v2/storage"
    };

    const fileUrl = getStr(args.fileUrl, "");
    const downloadHeaders = args && typeof args.downloadHeaders === "object" ? args.downloadHeaders : null;
    if (!fileUrl || !payloadData?.id) return baseReturn;

    const attachRes = await getAttachFileToPageAndEmbed({
      baseUrl,
      headers,
      page: payloadData,
      fileUrl,
      filename: getStr(args.filename, "attachment"),
      contentType: getStr(args.contentType, ""),
      caption: getStr(args.caption, ""),
      embed: args.embed !== false,
      downloadHeaders
    });

    const mergedOk = getMergeOk(baseReturn.ok, attachRes, !!fileUrl);
    return {
      ...baseReturn,
      ok: mergedOk,
      attachment: attachRes
    };
  }

  if (op === "delete") {
    const pageUrl = getStr(args.pageUrl, "");
    let pageIdArg = getStr(args.pageId, "");
    const titleArg = getStr(args.title, "");

    const resolved = await getResolveUsablePageId(baseUrl, headers, spaceKey, pageIdArg, pageUrl, titleArg);
    if (!resolved.ok) return { ok:false, ...resolved, took_ms: Date.now() - startedAt };
    const pageId = resolved.pageId;
    const page = resolved.page;

    if (String(page.spaceId || "") !== String(enforced))
      return { ok:false, error:"PAGE_OUT_OF_SPACE", pageId, expected_spaceId:String(enforced), got_spaceId:String(page.spaceId||"") };

    const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const res = await getFetchJson(url, { method: "DELETE", headers }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, took_ms: Date.now() - startedAt };
  }

  if (op === "read") {
    const pageUrl = getStr(args.pageUrl, "");
    const pageIdArg = getStr(args.pageId, "");
    const titleArg = getStr(args.title, "");

    const resolved = await getResolveUsablePageId(baseUrl, headers, spaceKey, pageIdArg, pageUrl, titleArg);
    if (!resolved.ok) return { ok:false, ...resolved, took_ms: Date.now() - startedAt };
    const pageId = resolved.pageId;
    const page = resolved.page;

    if (String(page.spaceId || "") !== String(enforced))
      return { ok:false, error:"PAGE_OUT_OF_SPACE", pageId, expected_spaceId:String(enforced), got_spaceId:String(page.spaceId||"") };

    const payloadData = getAttachAbsoluteLinksToResult(page, baseUrl);
    const storageHtml = String(page?.body?.storage?.value || "");
    return {
      ok: true,
      status: 200,
      url: payloadData.viewUrl || `${baseUrl}/pages/${encodeURIComponent(pageId)}`,
      data: {
        ...payloadData,
        body: {
          ...(payloadData.body || {}),
          storage: {
            value: storageHtml,
            representation: "storage"
          }
        },
        text: storageHtml.replace(/<[^>]+>/g, " ")
      },
      took_ms: Date.now() - startedAt,
      editor: "v2/storage"
    };
  }

  if (op === "list") {
    const limit = getNum(args.limit, 50);
    const status = getNormalizeStatus(getStr(args.status, ""));

    const root = baseUrl.replace(/\/+$/, "");
    const u = new URL(root + "/api/v2/pages");
    u.searchParams.set("spaceId", String(enforced));
    u.searchParams.set("limit", String(Math.max(1, limit)));
    u.searchParams.set("status", status);
    let url = u.toString();
    const collected = [];
    while (collected.length < limit && url) {
      const res = await getFetchJson(url, { method: "GET", headers }, timeoutMs);
      if (!res.ok) {
        return { ok: false, status: res.status, url, data: res.data, enforced: { spaceKey, spaceId: enforced }, took_ms: Date.now() - startedAt };
      }
      const data = res.data || {};
      const batch = Array.isArray(data.results) ? data.results : [];
      for (const r of batch) {
        if (String(r.spaceId || "") === String(enforced)) {
          collected.push(r);
          if (collected.length >= limit) break;
        }
      }
      const nextLink = data?._links?.next;
      url = (collected.length < limit && nextLink) ? getMakeAbsNextUrl(baseUrl, nextLink) : null;
    }

    return {
      ok: true,
      status: 200,
      url: null,
      data: { results: collected.map(r => getAttachAbsoluteLinksToResult(r, baseUrl)), count: collected.length },
      enforced: { spaceKey, spaceId: enforced },
      took_ms: Date.now() - startedAt
    };
  }

  if (op === "attach") {
    const pageUrl = getStr(args.pageUrl, "");
    let pageIdArg = getStr(args.pageId, "");
    const titleArg = getStr(args.title, "");

    const fileUrl = getStr(args.fileUrl, "");
    const filenameReq = getStr(args.filename, "attachment");
    const contentType = getStr(args.contentType, "");
    const alt = getStr(args.alt, "");
    const caption = getStr(args.caption, "");
    const embed = getBool(args.embed, true);
    const attachOrLink = getBool(args.attachOrLink, false);
    const downloadHeaders = args && typeof args.downloadHeaders === "object" ? args.downloadHeaders : null;

    const resolved = await getResolveUsablePageId(baseUrl, headers, spaceKey, pageIdArg, pageUrl, titleArg);
    if (!resolved.ok) return { ok:false, ...resolved, took_ms: Date.now() - startedAt };
    let pageId = resolved.pageId;
    let page = resolved.page;

    if (String(page.spaceId || "") !== String(enforced))
      return { ok:false, error:"PAGE_OUT_OF_SPACE", pageId, expected_spaceId:String(enforced), got_spaceId:String(page.spaceId||"") };
    if (!fileUrl) return { ok:false, error:"ATTACH_NEEDS_fileUrl" };

    const bin = await getFetchBinary(fileUrl, { headers: downloadHeaders || {} }, 120000);
    if (!bin.ok) {
      if (attachOrLink) {
        if (!embed) return { ok:false, error:"ATTACH_DOWNLOAD_FAILED", status: bin.status };
        const captionHtml = caption ? `<p>${getEscapeText(caption)}</p>` : "";
        const newHtml = `<p><ac:image${alt ? ` ac:alt="${getEscapeAttr(alt)}"`:""}><ri:url ri:value="${getEscapeAttr(fileUrl)}"/></ac:image></p>${captionHtml}`;
        const oldHtml = String(page?.body?.storage?.value || "");
        const merged = oldHtml + "\n" + newHtml;
        const urlPut = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
        const putBody = {
          id: pageId,
          status: "current",
          title: page.title,
          spaceId: page.spaceId || enforced,
          body: { representation: "storage", value: merged },
          version: { number: (page.version && page.version.number ? Number(page.version.number) + 1 : 2) }
        };
        let resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody) }, 60000);
        if (resPut.status === 409) {
          const latest = await getPageV2Storage(baseUrl, pageId, headers);
          if (!latest) return { ok:false, status:409, error:"CONFLICT_RELOAD_FAILED", pageId };
          const merged2 = String(latest?.body?.storage?.value || "") + "\n" + newHtml;
          const putBody2 = {
            id: pageId, status: "current", title: latest.title, spaceId: latest.spaceId,
            body: { representation: "storage", value: merged2 },
            version: { number: (latest.version?.number ? Number(latest.version.number)+1 : 2) }
          };
          resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody2) }, 60000);
        }
        const payload = (resPut.data && resPut.data.id) ? getAttachAbsoluteLinksToResult(resPut.data, baseUrl) : resPut.data;
        return { ok: !!resPut.ok, status: resPut.status, mode:"linked", url: urlPut, data: payload };
      }
      return { ok:false, error:"ATTACH_DOWNLOAD_FAILED", status: bin.status };
    }

    let upload = await getPostAttachmentV2(baseUrl, pageId, headers, filenameReq, bin.data, contentType);
    if (!upload.ok && [400,404,405,409,415,500,501].includes(upload.status)) {
      upload = await getPostAttachmentV1(baseUrl, pageId, headers, filenameReq, bin.data, contentType);
    }
    if (!upload.ok) {
      if (attachOrLink) {
        const captionHtml = caption ? `<p>${getEscapeText(caption)}</p>` : "";
        const newHtml = `<p><ac:image${alt ? ` ac:alt="${getEscapeAttr(alt)}"`:""}><ri:url ri:value="${getEscapeAttr(fileUrl)}"/></ac:image></p>${captionHtml}`;
        const latest = await getPageV2Storage(baseUrl, pageId, headers);
        if (!latest) return { ok:false, error:"ATTACH_UPLOAD_FAILED_AND_NO_FALLBACK" };
        const merged = String(latest?.body?.storage?.value || "") + "\n" + newHtml;
        const urlPut = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
        const putBody = {
          id: pageId, status: "current", title: latest.title, spaceId: latest.spaceId,
          body: { representation: "storage", value: merged },
          version: { number: (latest.version?.number ? Number(latest.version.number)+1 : 2) }
        };
        const resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody) }, 60000);
        const payload = (resPut.data && resPut.data.id) ? getAttachAbsoluteLinksToResult(resPut.data, baseUrl) : resPut.data;
        return { ok: !!resPut.ok, status: resPut.status, mode:"linked", url: urlPut, data: payload };
      }
      return { ok:false, error:"ATTACH_UPLOAD_FAILED", status: upload.status, data: upload.data };
    }

    const storedName = getPickAttachmentFilename(upload.data, filenameReq);

    if (!embed) {
      const payload = upload.data && upload.data.id ? getAttachAbsoluteLinksToResult(upload.data, baseUrl) : upload.data;
      return { ok:true, status: upload.status, mode:"uploaded", filename: storedName, data: payload };
    }

    const altAttr = alt ? ` ac:alt="${getEscapeAttr(alt)}"` : "";
    const safeName = getEscapeAttr(storedName);
    const imageHtml = `<p><ac:image${altAttr}><ri:attachment ri:filename="${safeName}"/></ac:image></p>${caption ? `\n<p>${getEscapeText(caption)}</p>` : ""}`;

    const latest = await getPageV2Storage(baseUrl, pageId, headers);
    if (!latest) return { ok:false, error:"ATTACH_EMBED_RELOAD_FAILED" };

    const merged = String(latest?.body?.storage?.value || "") + "\n" + imageHtml;
    const urlPut = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const putBody = {
      id: pageId,
      status: "current",
      title: latest.title,
      spaceId: latest.spaceId || enforced,
      body: { representation: "storage", value: merged },
      version: { number: (latest.version?.number ? Number(latest.version.number) + 1 : 2) }
    };
    let resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody) }, 60000);
    if (resPut.status === 409) {
      const again = await getPageV2Storage(baseUrl, pageId, headers);
      if (!again) return { ok:false, status:409, error:"CONFLICT_RELOAD_FAILED", pageId };
      const merged2 = String(again?.body?.storage?.value || "") + "\n" + imageHtml;
      const putBody2 = {
        id: pageId, status: "current", title: again.title, spaceId: again.spaceId,
        body: { representation: "storage", value: merged2 },
        version: { number: (again.version?.number ? Number(again.version.number)+1 : 2) }
      };
      resPut = await getFetchJson(urlPut, { method: "PUT", headers, body: JSON.stringify(putBody2) }, 60000);
    }

    const payloadPage = (resPut.data && resPut.data.id) ? getAttachAbsoluteLinksToResult(resPut.data, baseUrl) : resPut.data;
    return {
      ok: !!resPut.ok,
      status: resPut.status,
      mode:"uploaded+embedded",
      filename: storedName,
      data: { upload, page: payloadPage }
    };
  }

  if (op === "move") {
    const pageUrl = getStr(args.pageUrl, "");
    let pageIdArg = getStr(args.pageId, "");
    const titleArg = getStr(args.title, "");

    const resolved = await getResolveUsablePageId(baseUrl, headers, spaceKey, pageIdArg, pageUrl, titleArg);
    if (!resolved.ok) return { ok:false, ...resolved, took_ms: Date.now() - startedAt };
    const pageId = resolved.pageId;
    const page = resolved.page;

    if (String(page.spaceId || "") !== String(enforced))
      return { ok:false, error:"PAGE_OUT_OF_SPACE", pageId, expected_spaceId:String(enforced), got_spaceId:String(page.spaceId||"") };

    const newParentId = getStr(args.newParentId, parentId);
    const putBody = {
      id: pageId,
      status: "current",
      title: page.title,
      spaceId: page.spaceId || enforced,
      parentId: newParentId,
      body: { representation: "storage", value: String(page?.body?.storage?.value || "<p></p>") },
      version: { number: (page.version && page.version.number ? Number(page.version.number) + 1 : 2) }
    };
    const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const res = await getFetchJson(url, { method: "PUT", headers, body: JSON.stringify(putBody) }, timeoutMs);
    const payloadData = (res.data && res.data.id) ? getAttachAbsoluteLinksToResult(res.data, baseUrl) : res.data;
    return {
      ok: !!res.ok,
      status: res.status,
      url,
      data: payloadData,
      sent: putBody,
      took_ms: Date.now() - startedAt
    };
  }

  if (op === "api") {
    const eff = await getEffectiveSpaceId(baseUrl, headers, spaceKey, parentId);
    if (!eff.ok) {
      return {
        ok:false,
        error:"SPACE_NOT_FOUND",
        hint:`Could not resolve spaceId via mainPageId='${parentId}' or project='${spaceKey}'`,
        took_ms: Date.now() - startedAt
      };
    }
    const method = getStr(args.method, "GET").toUpperCase();
    const path   = getStr(args.path, "/api/v2/pages");
    const scope  = await getEnsureApiScope(method, baseUrl, path, eff.spaceId, headers);
    if (!scope.ok) return { ok:false, ...scope, took_ms: Date.now() - startedAt };
    const url    = scope.url;
    const body   = (typeof args.body === "string") ? args.body : (args.body ? JSON.stringify(args.body) : undefined);
    const res = await getFetchJson(url, { method, headers, body }, timeoutMs);
    if (!res.ok) {
      return {
        ok:false,
        status: res.status,
        url,
        data: res.data,
        took_ms: Date.now() - startedAt,
        enforced: { spaceKey, spaceId: eff.spaceId, parentId }
      };
    }

    let data = res.data;
    if (data && Array.isArray(data.results)) {
      data = {
        ...data,
        results: data.results
          .filter(r => String(r.spaceId || "") === String(eff.spaceId))
          .map(r => getAttachAbsoluteLinksToResult(r, baseUrl))
      };
    } else if (data && data.id) {
      data = getAttachAbsoluteLinksToResult(data, baseUrl);
    }

    return {
      ok: true,
      status: res.status,
      url,
      data,
      took_ms: Date.now() - startedAt,
      rawSent: body ? body : null,
      enforced: { spaceKey, spaceId: eff.spaceId, parentId }
    };
  }

  return { ok:false, error:"UNKNOWN_OP", op };
}

/**************************************************************
/* functionSignature: getDefaultExport ()                    *
/* Builds the default export object for the tool.            *
/**************************************************************/
function getDefaultExport(){
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "ALWAYS USE THIS FOR REQUESTS TO CONFLUENCE. Confluence v2-only proxy with enforced space + Markdown→storage + safe image embedding (no {{placeholders}}). Supports create/read/update/append/delete/list/attach/move/api in a single op.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: { type: "string", enum: ["create","append","delete","read","list","attach","move","api"] },
            title: { type: "string" },
            pageId: { type: "string" },
            pageUrl: { type: "string" },
            markdown: { type: "string" },
            prependNote: { type: "string" },
            imageUrl: { type: "string", description: "Must start with http/https; {{...}} is ignored." },
            imageUrls: { type: "array", items: { type: "string" }, description: "All must start with http/https; {{...}} is ignored." },
            imageAlt: { type: "string" },
            imageCaption: { type: "string" },
            fileUrl: { type: "string" },
            filename: { type: "string" },
            contentType: { type: "string" },
            caption: { type: "string" },
            alt: { type: "string" },
            embed: { type: "boolean" },
            attachOrLink: { type: "boolean" },
            limit: { type: "number" },
            status: { type: "string" },
            method: { type: "string" },
            path: { type: "string" },
            body: { oneOf: [ { type: "object" }, { type: "string" } ] },
            newParentId: { type: "string" },
            downloadHeaders: { type: "object" }
          },
          required: ["op"]
        }
      }
    },
    invoke: getInvoke
  };
}

export default getDefaultExport();
