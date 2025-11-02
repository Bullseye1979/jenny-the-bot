/***************************************************************
/* filename: "getConfluence.js"                                *
/* Version 1.0                                                 *
/* Purpose: Confluence v2-only proxy with ops (create, append, *
/* delete, list, api, attach, move), config-enforced space and *
/* parent, and markdown→storage-HTML conversion.               *
/***************************************************************/
/***************************************************************/
const MODULE_NAME = "getConfluence";
const SPACE_ID_CACHE = new Map();

/***************************************************************
/* functionSignature: getStr (v, f)                            *
/* Return string v if non-empty, otherwise fallback f.         *
/***************************************************************/
function getStr(v, f){ return (typeof v === "string" && v.length) ? v : f; }

/***************************************************************
/* functionSignature: getNum (v, f)                            *
/* Return finite numeric value or fallback.                    *
/***************************************************************/
function getNum(v, f){ return Number.isFinite(v) ? Number(v) : f; }

/***************************************************************
/* functionSignature: getDebug (label, obj)                    *
/* Optional debug hook; disabled output.                       *
/***************************************************************/
function getDebug(label, obj){}

/***************************************************************
/* functionSignature: getAuthHeader (email, token)             *
/* Build Basic auth header from email and token.               *
/***************************************************************/
function getAuthHeader(email, token){
  const b64 = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

/***************************************************************
/* functionSignature: getFetchJson (url, opts, timeoutMs)      *
/* Fetch JSON or text with timeout; return structured result.  *
/***************************************************************/
async function getFetchJson(url, opts = {}, timeoutMs = 60000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    const ct = String(res.headers.get("content-type") || "");
    const isJson = ct.includes("application/json");
    const data = isJson ? (text ? JSON.parse(text) : null) : text;
    if (!res.ok) {
      const preview = typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data || null).slice(0, 800);
      getDebug("HTTP error", { status: res.status, preview });
    }
    return { ok: res.ok, status: res.status, headers: res.headers, data, raw: text };
  } finally {
    clearTimeout(t);
  }
}

/***************************************************************
/* functionSignature: getStorageHtmlFromMarkdown (md)          *
/* Convert minimal markdown to Confluence storage HTML.        *
/***************************************************************/
function getStorageHtmlFromMarkdown(md){
  const s = String(md || "").replace(/\r\n/g, "\n");
  const lines = s.split("\n");
  const blocks = [];
  let paraBuf = [];
  let listBuf = null;
  function flushPara(){
    if (paraBuf.length){
      blocks.push(`<p>${paraBuf.join("<br/>")}</p>`);
      paraBuf = [];
    }
  }
  function flushList(){
    if (listBuf && listBuf.items.length){
      const lis = listBuf.items.map(it => `<li>${it}</li>`).join("");
      blocks.push(`<ul>${lis}</ul>`);
    }
    listBuf = null;
  }
  for (const rawLine of lines){
    const line = rawLine.trimRight();
    if (!line.trim()){
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("### ")){
      flushPara(); flushList();
      blocks.push(`<h3>${getEscapedHtml(line.slice(4).trim())}</h3>`);
      continue;
    }
    if (line.startsWith("## ")){
      flushPara(); flushList();
      blocks.push(`<h2>${getEscapedHtml(line.slice(3).trim())}</h2>`);
      continue;
    }
    if (line.startsWith("# ")){
      flushPara(); flushList();
      blocks.push(`<h1>${getEscapedHtml(line.slice(2).trim())}</h1>`);
      continue;
    }
    if (line.startsWith("> ")){
      flushPara(); flushList();
      const inner = line.slice(2).trim();
      blocks.push(`<blockquote><p>${getEscapedHtml(inner)}</p></blockquote>`);
      continue;
    }
    if (line.startsWith("- ")){
      const itemText = getEscapedHtml(line.slice(2).trim());
      if (!listBuf){
        flushPara();
        listBuf = { type: "ul", items: [] };
      }
      listBuf.items.push(itemText);
      continue;
    }
    if (listBuf){
      flushList();
    }
    paraBuf.push(getEscapedHtml(line));
  }
  flushPara();
  flushList();
  return blocks.join("\n");
}

/***************************************************************
/* functionSignature: getEscapedHtml (str)                     *
/* Escape &, <, > for HTML safety.                             *
/***************************************************************/
function getEscapedHtml(str){
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/***************************************************************
/* functionSignature: getResolvedSpaceId (baseUrl, spaceKey,   *
/* headers) Resolve spaceId via v2 spaces endpoint with cache. *
/***************************************************************/
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

/***************************************************************
/* functionSignature: getPageV2Storage (baseUrl, pageId,       *
/* headers) Fetch a page with storage body via v2 API.         *
/***************************************************************/
async function getPageV2Storage(baseUrl, pageId, headers){
  const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;
  const res = await getFetchJson(url, { method: "GET", headers }, 20000);
  if (!res.ok) return null;
  return res.data;
}

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Main entry: perform op with v2-only semantics and config.   *
/***************************************************************/
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
  let spaceId = null;
  if (op !== "api") {
    spaceId = await getResolvedSpaceId(baseUrl, spaceKey, headers);
    if (!spaceId) {
      return {
        ok: false,
        error: "SPACE_NOT_FOUND",
        hint: `Could not resolve spaceId for spaceKey=${spaceKey} via /api/v2/spaces`,
        enforced: { spaceKey, parentId },
        took_ms: Date.now() - startedAt
      };
    }
  }
  if (op === "create") {
    const title = getStr(args.title, `AI Import ${new Date().toISOString()}`);
    const md = getStr(args.markdown, "# (empty)\n");
    const storageHtml = getStorageHtmlFromMarkdown(md);
    const body = {
      spaceId: spaceId,
      status: "current",
      title: title,
      body: { representation: "storage", value: storageHtml }
    };
    if (parentId) body.parentId = String(parentId);
    const url = `${baseUrl}/api/v2/pages`;
    const res = await getFetchJson(url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, sent: body, enforced: { spaceKey, spaceId, parentId }, took_ms: Date.now() - startedAt, editor: "v2/storage" };
  }
  if (op === "append") {
    const pageId = getStr(args.pageId, "");
    if (!pageId) return { ok:false, error:"APPEND_NEEDS_PAGE_ID" };
    const page = await getPageV2Storage(baseUrl, pageId, headers);
    if (!page) return { ok:false, error:"PAGE_NOT_FOUND", pageId };
    const md = getStr(args.markdown, "");
    const newHtml = md ? getStorageHtmlFromMarkdown(md) : "";
    if (!newHtml) return { ok:false, error:"APPEND_EMPTY" };
    const oldHtml = String(page?.body?.storage?.value || "");
    const mergedHtml = oldHtml + "\n" + newHtml;
    const putBody = {
      id: pageId,
      status: "current",
      title: page.title,
      spaceId: page.spaceId || spaceId,
      parentId: page.parentId || (parentId ? String(parentId) : undefined),
      body: { representation: "storage", value: mergedHtml },
      version: { number: (page.version && page.version.number ? Number(page.version.number) + 1 : 2) }
    };
    const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const res = await getFetchJson(url, { method: "PUT", headers, body: JSON.stringify(putBody) }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, sent: putBody, took_ms: Date.now() - startedAt, editor: "v2/storage" };
  }
  if (op === "delete") {
    const pageId = getStr(args.pageId, "");
    if (!pageId) return { ok:false, error:"DELETE_NEEDS_PAGE_ID" };
    const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const res = await getFetchJson(url, { method: "DELETE", headers }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, took_ms: Date.now() - startedAt };
  }
  if (op === "list") {
    const limit = getNum(args.limit, 50);
    const url = `${baseUrl}/api/v2/pages?spaceId=${encodeURIComponent(spaceId)}&limit=${limit}`;
    const res = await getFetchJson(url, { method: "GET", headers }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, enforced: { spaceKey, spaceId }, took_ms: Date.now() - startedAt };
  }
  if (op === "attach") {
    const pageId = getStr(args.pageId, "");
    if (!pageId) return { ok:false, error:"ATTACH_NEEDS_PAGE_ID" };
    return { ok:false, error:"ATTACH_BINARY_NOT_IMPLEMENTED", hint:"This proxy is v2-only and text-only right now.", took_ms: Date.now() - startedAt };
  }
  if (op === "move") {
    const pageId = getStr(args.pageId, "");
    if (!pageId) return { ok:false, error:"MOVE_NEEDS_PAGE_ID" };
    const newParentId = getStr(args.newParentId, parentId);
    const page = await getPageV2Storage(baseUrl, pageId, headers);
    if (!page) return { ok:false, error:"PAGE_NOT_FOUND", pageId };
    const putBody = {
      id: pageId,
      status: "current",
      title: page.title,
      spaceId: page.spaceId || spaceId,
      parentId: newParentId,
      body: { representation: "storage", value: String(page?.body?.storage?.value || "<p></p>") },
      version: { number: (page.version && page.version.number ? Number(page.version.number) + 1 : 2) }
    };
    const url = `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}`;
    const res = await getFetchJson(url, { method: "PUT", headers, body: JSON.stringify(putBody) }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, sent: putBody, took_ms: Date.now() - startedAt };
  }
  if (op === "api") {
    const method = getStr(args.method, "GET").toUpperCase();
    const path   = getStr(args.path, "/api/v2/pages");
    const url    = path.startsWith("http") ? path : (baseUrl + (path.startsWith("/") ? path : `/${path}`));
    const body   = (typeof args.body === "string") ? args.body : (args.body ? JSON.stringify(args.body) : undefined);
    const res = await getFetchJson(url, { method, headers, body }, timeoutMs);
    return { ok: !!res.ok, status: res.status, url, data: res.data, took_ms: Date.now() - startedAt, rawSent: body ? body : null };
  }
  return { ok:false, error:"UNKNOWN_OP", op };
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Build the tool definition and bind the invoke function.     *
/***************************************************************/
function getDefaultExport(){
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description: "Confluence v2 proxy (pages only). Ops: create, append, delete, list, api, attach, move. Space and parent are enforced from toolsconfig.getConfluence for all ops except 'api'. Content is expected as Markdown and is converted to storage HTML and sent to /api/v2/pages.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: { type: "string", enum: ["create","append","delete","list","api","attach","move"] },
            title: { type: "string" },
            pageId: { type: "string" },
            markdown: { type: "string" },
            limit: { type: "number" },
            method: { type: "string" },
            path: { type: "string" },
            body: { oneOf: [ { type: "object" }, { type: "string" } ] },
            newParentId: { type: "string" }
          },
          required: ["op"]
        }
      }
    },
    invoke: getInvoke
  };
}

export default getDefaultExport();
