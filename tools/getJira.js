/**************************************************************
/* filename: "getJira.js"                                    *
/* Version 1.0                                               *
/* Purpose: Jira Cloud proxy with high-level ops and         *
/*          normalization/repair for requests and payloads.  *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

const MODULE_NAME = "getJira";

/**************************************************************
/* functionSignature: getStr (v, f)                          *
/* Brief: Returns v if it is a non-empty string, otherwise f. *
/**************************************************************/
function getStr(v, f){ return (typeof v==="string" && v.length)? v : f; }

/**************************************************************
/* functionSignature: getNum (v, f)                          *
/* Brief: Returns a finite number from v, otherwise f.        *
/**************************************************************/
function getNum(v, f){ return Number.isFinite(v)? Number(v) : f; }

/**************************************************************
/* functionSignature: getDebug (label, obj)                  *
/* Brief: No-op debug hook placeholder.                       *
/**************************************************************/
function getDebug(label, obj){}

/**************************************************************
/* functionSignature: getAuthHeader (email, token)           *
/* Brief: Builds Basic auth header for Jira.                  *
/**************************************************************/
function getAuthHeader(email, token){
  const b64 = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

/**************************************************************
/* functionSignature: getBuildUrl (baseUrl, path, query)     *
/* Brief: Builds absolute URL with optional query params.     *
/**************************************************************/
function getBuildUrl(baseUrl, path, query){
  const root = String(baseUrl||"").replace(/\/+$/,"");
  const p0 = String(path||"").trim().replace(/\/+$/,"");
  const rel = p0.startsWith("/")? p0 : `/${p0}`;
  const qs = new URLSearchParams();
  if (query && typeof query==="object"){
    for (const [k,v] of Object.entries(query)){
      if (v===undefined || v===null) continue;
      if (Array.isArray(v)) v.forEach(val => qs.append(k,String(val)));
      else qs.append(k,String(v));
    }
  }
  const q = qs.toString();
  return q ? `${root}${rel}?${q}` : `${root}${rel}`;
}

/**************************************************************
/* functionSignature: getPathFromUrl (url, baseUrl)          *
/* Brief: Returns pathname if url shares origin with baseUrl. *
/**************************************************************/
function getPathFromUrl(url, baseUrl){
  try{
    const u = new URL(String(url||""));
    const b = new URL(String(baseUrl||""));
    if (u.origin === b.origin) return u.pathname.replace(/\/+$/,"");
    return "";
  }catch{ return ""; }
}

/**************************************************************
/* functionSignature: getPathnameAny (url)                   *
/* Brief: Safely extracts pathname from any absolute URL.     *
/**************************************************************/
function getPathnameAny(url){
  try{ return new URL(String(url||"")).pathname.replace(/\/+$/,""); }catch{ return ""; }
}

/**************************************************************
/* functionSignature: getEnforcedBaseUrl (req, baseUrl)      *
/* Brief: Ensures all requests target configured baseUrl.     *
/**************************************************************/
function getEnforcedBaseUrl(req, baseUrl){
  if (req.path && String(req.path).trim()){
    return getBuildUrl(baseUrl, String(req.path).trim(), req.query || {});
  }
  if (req.url){
    const samePath = getPathFromUrl(req.url, baseUrl);
    if (samePath){
      const kiUrl = new URL(req.url);
      const mergedQuery = { ...(req.query || {}) };
      for (const [k,v] of kiUrl.searchParams.entries()){
        if (mergedQuery[k] === undefined) mergedQuery[k] = v;
      }
      return getBuildUrl(baseUrl, samePath, mergedQuery);
    }
    const foreignPath = getPathnameAny(req.url);
    return getBuildUrl(baseUrl, foreignPath || "/", req.query || {});
  }
  return getBuildUrl(baseUrl, "/", req.query || {});
}

/**************************************************************
/* functionSignature: getFetchJson (url, opts, timeoutMs)    *
/* Brief: Fetches URL and returns JSON or text payload.       *
/**************************************************************/
async function getFetchJson(url, opts={}, timeoutMs=60000){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), Math.max(1, timeoutMs));
  try{
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    const ct = String(res.headers.get("content-type")||"");
    const isJson = ct.includes("application/json");
    const data = isJson ? (text? JSON.parse(text) : null) : text;
    if (!res.ok){
      const preview = typeof data==="string" ? data.slice(0,800) : JSON.stringify(data||null).slice(0,800);
      getDebug("HTTP Error Body", { status: res.status, preview });
    }
    return { ok: res.ok, status: res.status, headers: res.headers, data };
  }finally{ clearTimeout(t); }
}

/**************************************************************
/* functionSignature: getFetchBuffer (url, timeoutMs)        *
/* Brief: Fetches URL and returns Buffer plus content type.   *
/**************************************************************/
async function getFetchBuffer(url, timeoutMs=60000){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), Math.max(1, timeoutMs));
  try{
    const res = await fetch(String(url||""), { redirect:"follow", signal: ctrl.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = String(res.headers.get("content-type")||"application/octet-stream");
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return { buffer: buf, contentType: ct };
  }finally{ clearTimeout(t); }
}

/**************************************************************
/* functionSignature: getStatusArgFromReq (req)              *
/* Brief: Extracts target status from request forms.          *
/**************************************************************/
function getStatusArgFromReq(req){
  const fromMeta = getStr(req?.meta?.status, "");
  if (fromMeta) return fromMeta;
  const fromTop = getStr(req?.status, "");
  if (fromTop) return fromTop;
  const fromBody = getStr(req?.body?.transition?.status, "");
  if (fromBody) return fromBody;
  return "";
}

/**************************************************************
/* functionSignature: getRepairJsonString (s)                *
/* Brief: Attempts to repair truncated JSON strings.          *
/**************************************************************/
function getRepairJsonString(s){
  const str = String(s||"");
  let inStr=false, esc=false, braces=0, brackets=0;
  for (let i=0;i<str.length;i++){
    const ch = str[i];
    if (inStr){
      if (esc){ esc=false; continue; }
      if (ch==='\\'){ esc=true; continue; }
      if (ch=== '"'){ inStr=false; continue; }
    } else {
      if (ch=== '"'){ inStr=true; continue; }
      else if (ch==='{') braces++;
      else if (ch==='}') braces = Math.max(0, braces-1);
      else if (ch==='[') brackets++;
      else if (ch===']') brackets = Math.max(0, brackets-1);
    }
  }
  let repaired = str;
  if (inStr) repaired += '"';
  while (brackets>0){ repaired += ']'; brackets--; }
  while (braces>0){ repaired += '}'; braces--; }
  return repaired;
}

/**************************************************************
/* functionSignature: getStableJsonBuffer (body)             *
/* Brief: Stabilizes body to Buffer with preview metadata.    *
/**************************************************************/
function getStableJsonBuffer(body){
  if (body === undefined || body === null) return { buf: undefined, len: 0, preview: "[empty]", repaired:false, parsed:false };
  if (typeof body === "string"){
    try{
      const parsed = JSON.parse(body);
      const s = JSON.stringify(parsed);
      const buf = Buffer.from(s, "utf8");
      const prev = `${s.slice(0,120)} ... ${s.slice(-80)}`;
      return { buf, len: buf.byteLength, preview: prev, repaired:false, parsed:true };
    }catch{
      const repairedStr = getRepairJsonString(body);
      try{
        const parsed2 = JSON.parse(repairedStr);
        const s2 = JSON.stringify(parsed2);
        const buf2 = Buffer.from(s2, "utf8");
        const prev2 = `${s2.slice(0,120)} ... ${s2.slice(-80)}`;
        return { buf: buf2, len: buf2.byteLength, preview: prev2, repaired:true, parsed:true };
      }catch{
        const rawBuf = Buffer.from(body, "utf8");
        const prevRaw = `${body.slice(0,120)} ... ${body.slice(-80)}`;
        return { buf: rawBuf, len: buf.byteLength, preview: prevRaw, repaired:false, parsed:false };
      }
    }
  }
  if (typeof body === "object"){
    const s = JSON.stringify(body);
    const buf = Buffer.from(s, "utf8");
    const prev = `${s.slice(0,120)} ... ${s.slice(-80)}`;
    return { buf: buf, len: buf.byteLength, preview: prev, repaired:false, parsed:true };
  }
  const s = String(body);
  const buf = Buffer.from(s, "utf8");
  const prev = `${s.slice(0,120)} ... ${s.slice(-80)}`;
  return { buf, len: buf.byteLength, preview: prev, repaired:false, parsed:false };
}

/**************************************************************
/* functionSignature: getSplitJqlOrderBy (jql)               *
/* Brief: Splits JQL into core and ORDER BY tail.             *
/**************************************************************/
function getSplitJqlOrderBy(jql){
  const src = String(jql||"");
  const m = src.match(/\border\s+by\b/i);
  if (!m) return { core: src.trim(), orderBy: "" };
  const idx = m.index;
  const core = src.slice(0, idx).trim();
  const orderBy = src.slice( idx ).trim();
  return { core, orderBy };
}

/**************************************************************
/* functionSignature: getSanitizedJqlPlaceholders (jql, k)   *
/* Brief: Replaces project key placeholders in JQL.           *
/**************************************************************/
function getSanitizedJqlPlaceholders(jql, projectKey){
  let s = String(jql||"").trim();
  if (!s) return s;
  const variants = [
    /project\s*=\s*("?|')?KEY\1/gi,
    /project\s*=\s*("?|')?YOUR_PROJECT_KEY\1/gi,
    /project\s*=\s*("?|')?PROJ\1/gi
  ];
  for (const re of variants){ if (projectKey) s = s.replace(re, `project = "${projectKey}"`); }
  s = s.replace(/\(\s*\)/g, "").replace(/\s{2,}/g," ").replace(/^\s*(AND|OR)\s+/i,"").replace(/\s+(AND|OR)\s*$/i,"").replace(/\s+(AND|OR)\s+(AND|OR)\s+/gi," $2 ").trim();
  return s;
}

/**************************************************************
/* functionSignature: getEnsuredProjectRestriction (jql,k,a) *
/* Brief: Ensures JQL is scoped to project unless allowed.    *
/**************************************************************/
function getEnsuredProjectRestriction(jql, projectKey, allowCross){
  if (!projectKey || allowCross) return String(jql||"").trim();
  const { core, orderBy } = getSplitJqlOrderBy(jql);
  const base = String(core||"").trim();
  if (!base) return [`project = "${projectKey}"`, orderBy].filter(Boolean).join(" ").trim();
  const re = new RegExp(`project\\s*=\\s*"?${projectKey.replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&")}"?`, "i");
  if (re.test(base)) return [base, orderBy].filter(Boolean).join(" ").trim();
  if (/project\s*=\s*"?[A-Z0-9_-\s]+"?/i.test(base)) return [base, orderBy].filter(Boolean).join(" ").trim();
  const withProj = `project = "${projectKey}" AND (${base})`;
  return [withProj, orderBy].filter(Boolean).join(" ").trim();
}

/**************************************************************
/* functionSignature: getEnsuredSearchFields (fields, mode,  *
/* opts)                                                     *
/* Brief: Ensures core search fields unless noEnrich is set.  *
/**************************************************************/
function getEnsuredSearchFields(fields, mode, opts){
  const disableEnrich = !!(opts && opts.noEnrich === true);
  if (fields === undefined || fields === null){
    return undefined;
  }
  const ensureCore = (arr)=>{
    if (disableEnrich) return arr;
    const core = ["key","summary","status","assignee","issuetype","priority"];
    const set = new Set(arr.map(f=>String(f).trim()).filter(Boolean));
    core.forEach(f=>set.add(f));
    return Array.from(set);
  };
  if (Array.isArray(fields)){
    const arr = ensureCore(fields);
    return mode === "array" ? arr : arr.join(",");
  }
  const s = String(fields).trim();
  if (!s) return undefined;
  const parts = s.split(",").map(f=>f.trim()).filter(Boolean);
  const arr = ensureCore(parts);
  return mode === "array" ? arr : arr.join(",");
}

/**************************************************************
/* functionSignature: getNormalizedSearchShape (reqIn, k)    *
/* Brief: Normalizes /search calls, JQL, and fields.          *
/* NOTE: 'onlyKeySummary' setzt nur Felder, wenn KEINE        *
/*       Felder explizit angegeben wurden.                    *
/**************************************************************/
function getNormalizedSearchShape(reqIn, defaultProjectKey){
  const isSearch = (p)=> /^https?:\/\/[^/]+\/rest\/api\/3\/search(?:\/jql)?\/?$|^\/rest\/api\/3\/search(?:\/jql)?\/?$/i.test(String(p||""));
  const p = reqIn.path || reqIn.url || "";
  if (!isSearch(p)) return reqIn;
  const method = String(reqIn.method||"GET").toUpperCase();
  const q = reqIn.query || {};
  const bodyIn = (reqIn.body && typeof reqIn.body === "object") ? { ...reqIn.body } : {};
  const meta = (reqIn.meta && typeof reqIn.meta === "object") ? reqIn.meta : {};
  const allowCross = meta.allowCrossProject === true;
  const onlyKeySummary = meta.onlyKeySummary === true;

  // WICHTIG: nur setzen, wenn keine Felder vorhanden sind
  if (onlyKeySummary){
    const hasFields =
      (method === "GET"  && Object.prototype.hasOwnProperty.call(q, "fields")) ||
      (method !== "GET"  && Object.prototype.hasOwnProperty.call(bodyIn, "fields"));
    if (!hasFields){
      if (method === "GET"){
        reqIn.query = { ...(reqIn.query||{}), fields: "key,summary" };
      } else {
        reqIn.body = { ...(reqIn.body||{}), fields: ["key","summary"] };
      }
    }
    reqIn.meta = { ...(reqIn.meta||{}), noEnrichFields: true };
  }

  let jql = (bodyIn.jql ?? q.jql ?? "").toString();
  jql = getSanitizedJqlPlaceholders(jql, defaultProjectKey);
  if (!jql) jql = "ORDER BY created DESC";
  jql = getEnsuredProjectRestriction(jql, defaultProjectKey, allowCross);
  getDebug("Effective JQL", { jql });

  if (method === "GET"){
    const query = { ...q, jql };
    if (Object.prototype.hasOwnProperty.call(query, "fields")){
      const ensured = getEnsuredSearchFields(query.fields, "string", { noEnrich: !!meta.noEnrichFields });
      if (ensured === undefined) delete query.fields;
      else query.fields = ensured;
    }
    return { ...reqIn, method:"GET", path:"/rest/api/3/search/jql", url: undefined, query };
  }
  const body = { ...bodyIn, jql };
  if (Object.prototype.hasOwnProperty.call(body, "fields")){
    const ensured = getEnsuredSearchFields(body.fields, "array", { noEnrich: !!meta.noEnrichFields });
    if (ensured === undefined) delete body.fields;
    else body.fields = ensured;
  }
  return { ...reqIn, method:"POST", path:"/rest/api/3/search/jql", url: undefined, query:{}, body };
}

/**************************************************************
/* functionSignature: getADFParagraphDoc (text)              *
/* Brief: Wraps plain text into minimal ADF paragraph doc.    *
/**************************************************************/
function getADFParagraphDoc(text){
  const s = String(text||"");
  return { type: "doc", version: 1, content: [{ type:"paragraph", content: s ? [{ type:"text", text:s }] : [] }] };
}

/**************************************************************
/* functionSignature: getIsProjectPlaceholderKey (k)         *
/* Brief: Detects common placeholder project keys.            *
/**************************************************************/
function getIsProjectPlaceholderKey(k){
  const up = String(k||"").trim().toUpperCase();
  if (!up) return true;
  const bad = ["KEY","YOUR_PROJECT_KEY","PROJECT_KEY","<PROJECT_KEY>","PROJ","PROJECT","ABC","XXXX"];
  return bad.includes(up);
}

/**************************************************************
/* functionSignature: setEarlyParseBody (req)                *
/* Brief: Parses stringified JSON body early if possible.     *
/**************************************************************/
function setEarlyParseBody(req){
  if (!req || typeof req!=="object") return { req, parsed:false };
  if (typeof req.body === "string"){
    try{
      const repaired = getRepairJsonString(req.body);
      const parsed = JSON.parse(repaired);
      req.body = parsed;
      return { req, parsed:true };
    }catch{ return { req, parsed:false }; }
  }
  return { req, parsed:false };
}

/**************************************************************
/* functionSignature: getNormalizedIssueBodyADFAndProject    *
/* (req, defaultProjectKey)                                  *
/* Brief: Coerces string fields to ADF and ensures project.   *
/**************************************************************/
function getNormalizedIssueBodyADFAndProject(req, defaultProjectKey){
  const path = String(req.path || req.url || "");
  const m = String(req.method||"GET").toUpperCase();
  const isCreate = /\/rest\/api\/3\/issue\/?$/i.test(path) && m==="POST";
  const isUpdate = /\/rest\/api\/3\/issue\/[^/]+\/?$/i.test(path) && (m==="PUT" || m==="PATCH");
  if (!(isCreate || isUpdate)) return req;
  const body = (req.body && typeof req.body === "object") ? { ...req.body } : {};
  const fields = (body.fields && typeof body.fields === "object") ? { ...body.fields } : {};
  let changed = false;
  if (typeof fields.description === "string"){ fields.description = getADFParagraphDoc(fields.description); changed = true; }
  if (typeof fields.environment === "string"){ fields.environment = getADFParagraphDoc(fields.environment); changed = true; }
  if (isCreate){
    const hasProjectObj = !!(fields.project && typeof fields.project === "object");
    const projectKeyInBody = hasProjectObj ? getStr(fields.project.key, "") : "";
    if (!hasProjectObj && defaultProjectKey){
      fields.project = { key: String(defaultProjectKey) };
      changed = true;
    } else if (hasProjectObj && getIsProjectPlaceholderKey(projectKeyInBody) && defaultProjectKey){
      fields.project = { key: String(defaultProjectKey) };
      changed = true;
    }
  } else if (isUpdate) {
    if (fields.project && typeof fields.project === "object"){
      const pk = getStr(fields.project.key, "");
      if (getIsProjectPlaceholderKey(pk) && defaultProjectKey){
        fields.project = { key: String(defaultProjectKey) };
        changed = true;
      }
    }
  }
  if (changed){
    req.body = { ...body, fields };
  }
  return req;
}

/**************************************************************
/* functionSignature: getNormalizedCommentADF (req)          *
/* Brief: Coerces comment body strings to ADF.                *
/**************************************************************/
function getNormalizedCommentADF(req){
  const path = String(req.path || req.url || "");
  const m = String(req.method||"GET").toUpperCase();
  const isCommentPost = /\/rest\/api\/3\/issue\/[^/]+\/comment\/?$/i.test(path) && m==="POST";
  if (!isCommentPost) return req;
  const body = (req.body && typeof req.body === "object") ? { ...req.body } : {};
  if (typeof body.body === "string"){
    body.body = getADFParagraphDoc(body.body);
    req.body = body;
  }
  return req;
}

/**************************************************************
/* functionSignature: getFetchTransitions (baseUrl, idOrKey, *
/* headers)                                                  *
/* Brief: Retrieves available transitions for an issue.       *
/**************************************************************/
async function getFetchTransitions(baseUrl, issueIdOrKey, headers){
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions?expand=transitions.fields`;
  return await getFetchJson(url, { method:"GET", headers }, 30000);
}

/**************************************************************
/* functionSignature: getPickTransitionId (transitions, des) *
/* Brief: Chooses a transition id based on desired target.    *
/**************************************************************/
function getPickTransitionId(transitions, desired){
  if (!Array.isArray(transitions)) return null;
  const norm = (s)=> String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const want = {
    id: getStr(desired?.id, ""),
    name: getStr(desired?.name, ""),
    toStatus: getStr(desired?.toStatus, ""),
    toStatusId: getStr(desired?.toStatusId, ""),
    toStatusCategory: getStr(desired?.toStatusCategory, "")
  };
  if (want.id){
    const hit = transitions.find(tr => String(tr.id) === String(want.id));
    if (hit) return String(hit.id);
  }
  if (want.name){
    const hit = transitions.find(tr => norm(tr.name) === norm(want.name));
    if (hit) return String(hit.id);
  }
  if (want.toStatusId){
    const hit = transitions.find(tr => String(tr?.to?.id||"") === String(want.toStatusId));
    if (hit) return String(hit.id);
  }
  if (want.toStatus){
    const hit = transitions.find(tr => norm(tr?.to?.name||"") === norm(want.toStatus));
    if (hit) return String(hit.id);
  }
  if (want.toStatusCategory){
    const hit = transitions.find(tr => norm(tr?.to?.statusCategory?.name||"") === norm(want.toStatusCategory));
    if (hit) return String(hit.id);
  }
  return null;
}

/**************************************************************
/* functionSignature: getPickByStatusString (transitions, s) *
/* Brief: Maps a status-like string to a transition id.       *
/**************************************************************/
function getPickByStatusString(transitions, statusStr){
  if (!Array.isArray(transitions) || !statusStr) return null;
  const norm = (x)=> String(x||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const s = norm(statusStr);
  let hit = transitions.find(tr => norm(tr.name) === s);
  if (hit) return String(hit.id);
  hit = transitions.find(tr => norm(tr?.to?.name||"") === s);
  if (hit) return String(hit.id);
  hit = transitions.find(tr => norm(tr?.to?.statusCategory?.name||"") === s);
  if (hit) return String(hit.id);
  return null;
}

/**************************************************************
/* functionSignature: getFindTransitionId (baseUrl, key,     *
/* headers, target, statusStr)                               *
/* Brief: Fetches transitions and resolves desired id.        *
/**************************************************************/
async function getFindTransitionId(baseUrl, issueIdOrKey, headers, target, statusStr){
  const r = await getFetchTransitions(baseUrl, issueIdOrKey, headers);
  const list = r.data;
  const transitions = Array.isArray(list?.transitions) ? list.transitions : null;
  if (!r.ok || !transitions) return { id:null, list };
  if (statusStr){
    const byStatus = getPickByStatusString(transitions, statusStr);
    if (byStatus) return { id: byStatus, list };
  }
  const id = getPickTransitionId(transitions, target);
  return { id, list };
}

/**************************************************************
/* functionSignature: getPerformTransition (baseUrl, key,    *
/* headers, body)                                            *
/* Brief: Posts a transition payload to Jira.                 *
/**************************************************************/
async function getPerformTransition(baseUrl, issueIdOrKey, headers, body){
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`;
  const payload = JSON.stringify(body||{});
  const h = { ...headers, "Content-Type":"application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(payload)) };
  return await getFetchJson(url, { method:"POST", headers: h, body: Buffer.from(payload,"utf8") }, 30000);
}

/**************************************************************
/* functionSignature: getBuildTransitionPayload (id, meta)   *
/* Brief: Builds a Jira transition request payload.           *
/**************************************************************/
function getBuildTransitionPayload(transitionId, meta){
  const fields = (meta && typeof meta === "object" && meta.transitionFields && typeof meta.transitionFields === "object")
    ? { ...meta.transitionFields } : {};
  if (meta && typeof meta === "object" && getStr(meta.resolutionName, "")){
    fields.resolution = { name: String(meta.resolutionName) };
  }
  const payload = { transition: { id: String(transitionId) } };
  if (Object.keys(fields).length) payload.fields = fields;
  return payload;
}

/**************************************************************
/* functionSignature: getFetchIssueStatus (baseUrl, key,     *
/* headers)                                                  *
/* Brief: Retrieves status and resolution for an issue.       *
/**************************************************************/
async function getFetchIssueStatus(baseUrl, issueIdOrKey, headers){
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}?fields=status,resolution`;
  const r = await getFetchJson(url, { method:"GET", headers }, 30000);
  const status = r?.data?.fields?.status || null;
  const resolution = r?.data?.fields?.resolution || null;
  return { ok: r.ok, statusObj: status, resolutionObj: resolution, raw: r.data };
}

/**************************************************************
/* functionSignature: getMaybeAutoTransition (req, cfg,      *
/* headers)                                                  *
/* Brief: Applies auto-transition on issue update if needed.  *
/**************************************************************/
async function getMaybeAutoTransition(req, cfg, headers){
  const path = String(req.path || req.url || "");
  const m = String(req.method||"GET").toUpperCase();
  const isUpdate = /\/rest\/api\/3\/issue\/([^/]+)\/?$/i.test(path) && (m==="PUT" || m==="PATCH");
  if (!isUpdate) return { req, transitionResult:null, verify:null };
  const idMatch = path.match(/\/rest\/api\/3\/issue\/([^/]+)\/?$/i);
  const issueKey = idMatch ? idMatch[1] : "";
  const body = (req.body && typeof req.body === "object") ? { ...req.body } : {};
  const fields = (body.fields && typeof body.fields === "object") ? { ...body.fields } : {};
  const statusField = fields.status || null;
  const metaTrans = req.meta && typeof req.meta === "object" ? req.meta.transition : null;
  const statusArg = getStatusArgFromReq(req);
  const wantsTransition = !!(statusField || metaTrans || statusArg);
  if (!wantsTransition) return { req, transitionResult:null, verify:null };
  let desired = null;
  if (statusField && typeof statusField === "object"){
    const nm = getStr(statusField.name,"");
    const id = getStr(statusField.id,"");
    desired = id ? { id } : (nm ? { name: nm } : null);
    delete fields.status;
  }
  if (!desired && metaTrans && typeof metaTrans === "object"){
    desired = {
      id: getStr(metaTrans.id,"") || undefined,
      name: getStr(metaTrans.name,"") || undefined,
      toStatus: getStr(metaTrans.toStatus,"") || undefined,
      toStatusId: getStr(metaTrans.toStatusId,"") || undefined,
      toStatusCategory: getStr(metaTrans.toStatusCategory,"") || undefined
    };
  }
  const found = await getFindTransitionId(cfg.baseUrl, issueKey, headers, desired, statusArg);
  if (!found.id){
    return { req, transitionResult:{ ok:false, status:400, data:{ errorMessages:["Transition not found for requested status"], requested: desired || { statusArg }, available: found.list } }, verify:null };
  }
  const meta = req.meta || {};
  const trxBody = getBuildTransitionPayload(found.id, meta);
  const trxRes = await getPerformTransition(cfg.baseUrl, issueKey, headers, trxBody);
  const remainingFields = Object.keys(fields).length ? fields : null;
  if (remainingFields){
    const nextBody = { ...body, fields: remainingFields };
    return { req: { ...req, body: nextBody }, transitionResult: trxRes, verify: { issueKey } };
  }
  return { req: null, transitionResult: trxRes, verify: { issueKey } };
}

/**************************************************************
/* functionSignature: setFixDirectTransition (req, cfg,      *
/* headers)                                                  *
/* Brief: Normalizes direct POST /transitions requests.       *
/**************************************************************/
async function setFixDirectTransition(req, cfg, headers){
  const path = String(req.path || req.url || "");
  const m = String(req.method||"GET").toUpperCase();
  const isDirect = m==="POST" && /\/rest\/api\/3\/issue\/([^/]+)\/transitions\/?$/i.test(path);
  if (!isDirect) return { req, fixed:false };
  const issueKey = (path.match(/\/rest\/api\/3\/issue\/([^/]+)\/transitions\/?$/i)||[])[1] || "";
  const body = (req.body && typeof req.body === "object") ? { ...req.body } : {};
  const transition = (body.transition && typeof body.transition === "object") ? { ...body.transition } : {};
  const idRaw = getStr(transition.id,"");
  const nameRaw = getStr(transition.name,"");
  const toStatus = getStr(transition.toStatus,"");
  const toStatusCategory = getStr(transition.toStatusCategory,"");
  const statusArg = getStatusArgFromReq(req);
  const listRes = await getFetchTransitions(cfg.baseUrl, issueKey, headers);
  const transitions = Array.isArray(listRes?.data?.transitions) ? listRes.data.transitions : [];
  if (/^\d+$/.test(idRaw)) {
    const valid = transitions.find(tr => String(tr.id) === idRaw);
    if (valid) return { req, fixed:false };
    const haveHint = !!(statusArg || nameRaw || toStatus || toStatusCategory);
    if (!haveHint){
      const availableShort = transitions.map(tr=>({ id:String(tr.id), name:tr.name, to:{ name: tr?.to?.name }}));
      const expected = [
        "Set a status (top-level, meta.status, or body.transition.status), e.g., 'Done'",
        "OR use transition.name / transition.toStatus / transition.toStatusCategory"
      ];
      const hintSet = new Set();
      for (const tr of transitions){
        if (tr?.name) hintSet.add(tr.name);
        if (tr?.to?.name) hintSet.add(tr.to.name);
        if (tr?.to?.statusCategory?.name) hintSet.add(tr.to.statusCategory.name);
      }
      const hints = Array.from(hintSet).slice(0,5);
      return {
        req: {
          ...req,
          __abort: true,
          __error: {
            status: 400,
            message: "Invalid transition id without status/name hint",
            available: availableShort,
            expected,
            hints
          }
        },
        fixed:false
      };
    }
  }
  if (statusArg){
    const resolvedByStatus = getPickByStatusString(transitions, statusArg);
    if (resolvedByStatus){
      const patched = getBuildTransitionPayload(resolvedByStatus, req.meta || {});
      const next = { ...req, body: patched };
      return { req: next, fixed:true };
    }
  }
  const desired = (nameRaw || toStatus || toStatusCategory) ? {
    id: undefined, name: nameRaw || undefined, toStatus: toStatus || undefined, toStatusCategory: toStatusCategory || undefined
  } : { id: idRaw || undefined };
  const resolved = getPickTransitionId(transitions, desired);
  if (!resolved){
    return { req, fixed:false };
  }
  const meta = req.meta || {};
  const patched = getBuildTransitionPayload(resolved, meta);
  const next = { ...req, body: patched };
  return { req: next, fixed:true };
}

/**************************************************************
/* functionSignature: getBuildOpRequest (op, args)           *
/* Brief: Builds high-level operation requests.               *
/**************************************************************/
function getBuildOpRequest(op, args){
  const OP = String(op||"").toUpperCase();
  switch (OP){
    case "LIST": {
      return {
        method: "POST",
        path: "/rest/api/3/search",
        // onlyKeySummary bleibt an, überschreibt aber nicht mehr explizite Felder
        meta: { onlyKeySummary: true, noEnrichFields: true },
        body: {
          jql: getStr(args?.jql, ""),
          fields: ["key","summary","status"],
          maxResults: getNum(args?.maxResults, 50)
        }
      };
    }
    case "TASK": {
      const key = String(args?.key||"").trim();
      return {
        method: "GET",
        path: `/rest/api/3/issue/${encodeURIComponent(key)}`
      };
    }
    case "STATUS": {
      const key = String(args?.key||"").trim();
      const status = getStr(args?.status,"");
      const meta = { ...(args?.meta||{}) };
      if (status) meta.status = status;
      if (args?.resolutionName) meta.resolutionName = args.resolutionName;
      return {
        method: "POST",
        path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
        meta
      };
    }
    case "CREATE": {
      const fields = (args?.fields && typeof args.fields==="object") ? args.fields : {};
      return {
        method: "POST",
        path: "/rest/api/3/issue",
        body: { fields }
      };
    }
    case "UPDATE": {
      const key = String(args?.key||"").trim();
      const fields = (args?.fields && typeof args.fields==="object") ? args.fields : {};
      const req = {
        method: "PUT",
        path: `/rest/api/3/issue/${encodeURIComponent(key)}`,
        body: { fields }
      };
      if (args?.status) req.status = String(args.status);
      if (args?.meta) req.meta = { ...(args.meta) };
      return req;
    }
    case "DELETE": {
      const key = String(args?.key||"").trim();
      const force = !!args?.forceDelete;
      if (force){
        return { method: "DELETE", path: `/rest/api/3/issue/${encodeURIComponent(key)}` };
      }
      return {
        method: "POST",
        path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
        meta: { status: getStr(args?.status, "Done"), resolutionName: getStr(args?.resolutionName,"") || undefined }
      };
    }
    default:
      return null;
  }
}

/**************************************************************
/* functionSignature: getInvoke (args, coreData)             *
/* Brief: Main tool entry: shapes, enforces, fetches, maps.   *
/**************************************************************/
async function getInvoke(args, coreData){
  const startedAt = Date.now();
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.getJira || {};
  const baseUrl = getStr(cfg?.baseUrl,"").replace(/\/+$/,"");
  const email = getStr(cfg?.email,"");
  const token = getStr(cfg?.token,"");
  const defaultProjectKey = getStr(cfg?.projectKey, "");
  if (!baseUrl || !email || !token){
    getDebug("Config Error", { hasBaseUrl: !!baseUrl, hasEmail: !!email, hasToken: !!token });
    return { ok:false, error:"JIRA_CONFIG — missing Jira baseUrl/email/token in server configuration" };
  }
  const op = String(args?.op || (args?.json?.op)||"").toUpperCase();
  let reqIn = args?.json || args || {};
  if (op){
    const built = getBuildOpRequest(op, reqIn);
    if (!built){
      return { ok:false, error:`BAD_OP — unsupported op "${op}"` };
    }
    reqIn = built;
    reqIn.__op = op;
  }
  if (!reqIn || typeof reqIn!=="object" || !reqIn.method){
    getDebug("Bad Tool Args", reqIn);
    return { ok:false, error:"BAD_TOOL_ARGS", hint:"requires {json:{method:'GET|POST|PUT|DELETE|PATCH', path:'/rest/api/...'}}" };
  }
  let req = { ...reqIn };
  const early = setEarlyParseBody(req);
  req = getNormalizedSearchShape(req, defaultProjectKey);
  req = getNormalizedIssueBodyADFAndProject(req, defaultProjectKey);
  req = getNormalizedCommentADF(req);
  const method = String(req.method||"GET").toUpperCase();
  const timeoutMs = getNum(req.timeoutMs, getNum(cfg.timeoutMs, 60000));
  const responseType = req.responseType==="arraybuffer" ? "arraybuffer" : "json";
  const url = getEnforcedBaseUrl(req, baseUrl);
  const headers = { Accept:"application/json", ...(req.headers||{}), ...getAuthHeader(email, token) };
  const maybeTrx = await getMaybeAutoTransition(req, { baseUrl }, headers);
  const postTransitionOnly = maybeTrx.req === null && maybeTrx.transitionResult !== null;
  let afterTrxReq = maybeTrx.req || req;
  const transitionInfo = maybeTrx.transitionResult;
  let verifyIssueKey = maybeTrx.verify?.issueKey || null;
  const fixDirect = await setFixDirectTransition(afterTrxReq, { baseUrl }, headers);
  afterTrxReq = fixDirect.req;
  let bodyBuf = undefined;
  let bodyForm = undefined;
  let contentLength = 0;
  let bodyPreview = "[empty]";
  let repaired = false;
  let parsed = false;
  if (afterTrxReq?.__abort){
  } else if (afterTrxReq.multipart === true){
    const form = new FormData();
    if (afterTrxReq.form && typeof afterTrxReq.form==="object"){
      for (const [k,v] of Object.entries(afterTrxReq.form)){
        if (v===undefined || v===null) continue;
        form.append(k, typeof v==="string" ? v : JSON.stringify(v));
      }
    }
    if (Array.isArray(afterTrxReq.files)){
      for (const f of afterTrxReq.files){
        const name = f?.name || "file";
        const filename = f?.filename || (String(f?.url||"").split("/").pop()?.split("?")[0]) || "upload.bin";
        const { buffer, contentType } = await getFetchBuffer(String(f?.url||""), timeoutMs);
        form.append(name, new Blob([buffer], { type: contentType }), filename);
      }
    }
    bodyForm = form;
    headers["X-Atlassian-Token"] = "no-check";
    bodyPreview = "[multipart]";
  } else if (["POST","PUT","PATCH","DELETE"].includes(method) && !postTransitionOnly){
    const stable = getStableJsonBuffer(afterTrxReq.body);
    bodyBuf = stable.buf;
    contentLength = stable.len;
    bodyPreview = stable.preview;
    repaired = !!stable.repaired;
    parsed = !!stable.parsed;
    if (!headers["Content-Type"]) headers["Content-Type"]="application/json; charset=utf-8";
    if (bodyBuf) headers["Content-Length"] = String(contentLength);
  }
  let res = null;
  if (postTransitionOnly){
    res = transitionInfo;
  } else {
    if (afterTrxReq?.__abort){
      res = {
        ok: false,
        status: afterTrxReq.__error?.status || 400,
        headers: { },
        data: {
          errorMessages: [afterTrxReq.__error?.message || "Aborted request"],
          available: afterTrxReq.__error?.available || [],
          expected: afterTrxReq.__error?.expected || [],
          hints: afterTrxReq.__error?.hints || []
        }
      };
    } else {
      const fetchOpts = bodyForm ? { method, headers, body: bodyForm } : { method, headers, body: bodyBuf };
      res = await getFetchJson(url, fetchOpts, timeoutMs);
      if (!verifyIssueKey && /\/rest\/api\/3\/issue\/([^/]+)\/transitions\/?$/i.test(getPathnameAny(url))){
        verifyIssueKey = (getPathnameAny(url).match(/\/rest\/api\/3\/issue\/([^/]+)\/transitions\/?$/i)||[])[1] || null;
      }
    }
  }
  let verify = null;
  if ((transitionInfo && transitionInfo.ok) || (fixDirect.fixed && res && res.ok)){
    if (verifyIssueKey){
      const v = await getFetchIssueStatus(baseUrl, verifyIssueKey, headers);
      verify = {
        ok: v.ok,
        newStatus: v.statusObj ? { id: v.statusObj.id, name: v.statusObj.name, statusCategory: v.statusObj?.statusCategory?.name || null } : null,
        resolution: v.resolutionObj ? { id: v.resolutionObj.id, name: v.resolutionObj.name } : null
      };
    }
  }
  const hdrSubset = {};
  if (res?.headers && typeof res.headers.get==="function"){
    for (const k of ["x-arequestid","content-type","content-length","location","x-ratelimit-remaining","retry-after"]){
      const v = res.headers.get(k);
      if (v) hdrSubset[k]=v;
    }
  }
  let dataOut = responseType==="json" ? res?.data : (typeof res?.data==="string" ? { text: res.data } : res?.data);
  const opUsed = afterTrxReq?.__op || null;
  if (opUsed === "LIST"){
    const issues = Array.isArray(dataOut?.issues) ? dataOut.issues : [];
    dataOut = issues.map(it => {
      const st = it?.fields?.status;
      return {
        key: it?.key,
        summary: it?.fields?.summary,
        status: st ? { id: st.id, name: st.name, statusCategory: st?.statusCategory?.name || null } : null
      };
    }).filter(x => x.key && typeof x.summary === "string");
  } else if (opUsed === "CREATE"){
    dataOut = { key: dataOut?.key, id: dataOut?.id, self: dataOut?.self };
  } else if (opUsed === "STATUS"){
    dataOut = {
      ok: !!res?.ok,
      status: res?.status||0,
      verify
    };
  } else if (opUsed === "DELETE"){
    dataOut = {
      ok: !!res?.ok,
      status: res?.status||0
    };
  }
  const out = {
    ok: !!res?.ok,
    status: res?.status||0,
    url: afterTrxReq?.__abort ? null : url,
    headers: hdrSubset,
    data: dataOut,
    transition: afterTrxReq?.__abort
      ? false
      : (transitionInfo ? { status: transitionInfo.status, ok: transitionInfo.ok }
         : (fixDirect.fixed ? { ok: res?.ok, status: res?.status } : null)),
    verify,
    took_ms: Date.now()-startedAt,
    _debug: { bodyPreview, repaired, parsed }
  };
  return out;
}

/**************************************************************
/* functionSignature: getDefaultExport ()                    *
/* Brief: Exposes the tool definition and invoke entry.       *
/**************************************************************/
function getDefaultExport(){
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Always use this to access Jira. Jira Cloud proxy + high-level ops (LIST/TASK/STATUS/CREATE/DELETE/UPDATE). Enforces configured base URL, project key and credentials; normalizes JQL; repairs/normalizes JSON; supports multipart uploads; coerces string fields to ADF; auto-transitions on update; can directly perform transitions. LIST returns {key,summary,status}.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: {
              type: "string",
              enum: ["LIST","TASK","STATUS","CREATE","DELETE","UPDATE"],
              description: "Optional high-level operation. If omitted, raw request-mode is used."
            },
            jql: {
              type: "string",
              description: "For LIST: optional JQL filter. Project scoping is auto-enforced unless meta.allowCrossProject=true."
            },
            key: {
              type: "string",
              description: "Issue key for TASK/STATUS/UPDATE/DELETE."
            },
            status: {
              type: "string",
              description: "Target status for STATUS/UPDATE (auto transition)."
            },
            resolutionName: {
              type: "string",
              description: "Optional resolution to set during STATUS (e.g. 'Done', 'Won't Fix')."
            },
            forceDelete: {
              type: "boolean",
              description: "For DELETE: true to perform hard delete; otherwise a transition to 'Done' is attempted."
            },
            maxResults: {
              type: "number",
              description: "For LIST: max results (default 50)."
            },
            fields: {
              type: "object",
              description: "For CREATE/UPDATE: fields payload as in Jira REST (summary, issuetype, etc.)."
            },
            json: {
              type: "object",
              description:
                "Raw low-level Jira request (alternative to op-mode). The proxy enforces base URL & project key, normalizes JQL, etc.",
              additionalProperties: false,
              properties: {
                method: { type: "string", enum: ["GET","POST","PUT","DELETE","PATCH"] },
                path:   { type: "string" },
                url:    { type: "string" },
                query:  { type: "object" },
                headers:{ type: "object" },
                body:   { oneOf: [ { type: "object" }, { type: "string" } ] },
                multipart: { type: "boolean" },
                form:     { type: "object" },
                files:    { type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      url: { type: "string" },
                      name: { type: "string" },
                      filename: { type: "string" }
                    },
                    required: ["url"]
                  }
                },
                timeoutMs: { type: "number" },
                responseType: { type: "string", enum: ["json","arraybuffer"] },
                status: { type: "string" },
                meta: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    allowCrossProject: { type: "boolean" },
                    status: { type: "string" },
                    transition: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        toStatus: { type: "string" },
                        toStatusId: { type: "string" },
                        toStatusCategory: { type: "string" }
                      }
                    },
                    transitionFields: { type: "object" },
                    resolutionName: { type: "string" },
                    onlyKeySummary: { type: "boolean" },
                    noEnrichFields: { type: "boolean" }
                  }
                }
              },
              required: ["method"]
            }
          }
        }
      }
    },
    invoke: getInvoke
  };
}

export default getDefaultExport();
