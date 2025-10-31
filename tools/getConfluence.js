/***************************************************************
/* filename: "getConfluence.js"                                *
/* Version 1.0                                                 *
/* Purpose: Thin Confluence proxy that forwards KI-built JSON  *
/*          as-is; repairs truncated JSON; explicit lengths;   *
/*          logs; embeds a full Usage Guide in description.    *
/***************************************************************/
/***************************************************************
/*                                                            *
/***************************************************************/

const MODULE_NAME = "getConfluence";

/***************************************************************
/*                                                            *
/***************************************************************/

/***************************************************************
/* functionSignature: getStr (v, f)                            *
/* Returns non-empty string or fallback                        *
/***************************************************************/
function getStr(v, f){ return (typeof v==="string" && v.length)? v : f; }

/***************************************************************
/* functionSignature: getNum (v, f)                            *
/* Returns finite number or fallback                           *
/***************************************************************/
function getNum(v, f){ return Number.isFinite(v)? Number(v) : f; }

/***************************************************************
/* functionSignature: getDebug (label, obj)                    *
/* Emits compact debug output                                  *
/***************************************************************/
function getDebug(label, obj){ }

/***************************************************************
/* functionSignature: getAuthHeader (email, token)             *
/* Builds Basic auth header                                    *
/***************************************************************/
function getAuthHeader(email, token){
  const b64 = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

/***************************************************************
/* functionSignature: getIsAbsUrl (u)                          *
/* Checks absolute http(s) URL                                 *
/***************************************************************/
function getIsAbsUrl(u){ return /^https?:\/\//i.test(String(u||"")); }

/***************************************************************
/* functionSignature: getBuildUrl (baseUrl, path, query)       *
/* Builds absolute URL with query                              *
/***************************************************************/
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
  return q? `${root}${rel}?${q}` : `${root}${rel}`;
}

/***************************************************************
/* functionSignature: getPathFromUrl (url, baseUrl)            *
/* Returns path if same origin, else empty                     *
/***************************************************************/
function getPathFromUrl(url, baseUrl){
  try{
    const u = new URL(String(url||""));
    const b = new URL(String(baseUrl||""));
    if (u.origin === b.origin) return u.pathname.replace(/\/+$/,"");
    return "";
  }catch{ return ""; }
}

/***************************************************************
/* functionSignature: getPathnameAny (url)                     *
/* Returns pathname for any absolute URL or empty              *
/***************************************************************/
function getPathnameAny(url){
  try{ return new URL(String(url||"")).pathname.replace(/\/+$/,""); }catch{ return ""; }
}

/***************************************************************
/* functionSignature: getFetchJson (url, opts, timeoutMs)      *
/* Fetch with timeout; returns {ok,status,headers,data}        *
/***************************************************************/
async function getFetchJson(url, opts={}, timeoutMs=60000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), Math.max(1, timeoutMs));
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

/***************************************************************
/* functionSignature: getRepairJsonString (s)                  *
/* Heuristically repairs truncated JSON by closing braces      *
/***************************************************************/
function getRepairJsonString(s){
  const str = String(s||"");
  let inStr=false, esc=false, braces=0, brackets=0;
  for (let i=0;i<str.length;i++){
    const ch = str[i];
    if (inStr){
      if (esc){ esc=false; continue; }
      if (ch==='\\'){ esc=true; continue; }
      if (ch=== '"'){ inStr=false; continue; }
      continue;
    } else {
      if (ch=== '"'){ inStr=true; continue; }
      if (ch==='{') braces++;
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

/***************************************************************
/* functionSignature: getStableJsonBuffer (body)               *
/* Builds Buffer+length; repairs EOF if needed                 *
/***************************************************************/
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
        return { buf: rawBuf, len: rawBuf.byteLength, preview: prevRaw, repaired:false, parsed:false };
      }
    }
  }
  if (typeof body === "object"){
    const s = JSON.stringify(body);
    const buf = Buffer.from(s, "utf8");
    const prev = `${s.slice(0,120)} ... ${s.slice(-80)}`;
    return { buf, len: buf.byteLength, preview: prev, repaired:false, parsed:true };
  }
  const s = String(body);
  const buf = Buffer.from(s, "utf8");
  const prev = `${s.slice(0,120)} ... ${s.slice(-80)}`;
  return { buf, len: buf.byteLength, preview: prev, repaired:false, parsed:false };
}

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Forwards request to Confluence; repairs JSON EOF            *
/***************************************************************/
async function getInvoke(args, coreData){
  const startedAt = Date.now();
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.getConfluence || {};
  const baseUrl = getStr(cfg?.baseUrl,"").replace(/\/+$/,"");
  const email = getStr(cfg?.email,"");
  const token = getStr(cfg?.token,"");

  if (!baseUrl || !email || !token){
    getDebug("Config Error", { hasBaseUrl: !!baseUrl, hasEmail: !!email, hasToken: !!token });
    return { ok:false, error:"CONF_CONFIG — missing wo.toolsconfig.getConfluence { baseUrl, email, token }" };
  }

  const req = args?.json || args || {};
  const method = String(req?.method||"GET").toUpperCase();
  const timeoutMs = getNum(req?.timeoutMs, 60000);
  const responseType = req?.responseType==="arraybuffer" ? "arraybuffer" : "json";

  const pathFrom = getPathFromUrl(req.url, baseUrl);
  const path = (req.path && String(req.path).trim()) ? String(req.path).trim() : pathFrom || getPathnameAny(req.url||"");
  const url = getIsAbsUrl(req?.url) ? String(req.url) : getBuildUrl(baseUrl, getStr(path,"/"), req?.query||{});

  if (method==="GET" && /\/rest\/api\/content\/search$/.test(String(path||"").replace(/\/+$/,""))){
    const cql = (req && req.query && typeof req.query.cql==="string") ? req.query.cql.trim() : "";
    if (!cql){
      const msg = "Preflight: missing required query.cql for /rest/api/content/search";
      getDebug("Client Error", { error: "MISSING_CQL", hint: msg });
      return { ok:false, status:400, error:"MISSING_CQL", hint: msg };
    }
  }

  const headers = { Accept:"application/json", ...(req?.headers||{}), ...getAuthHeader(email, token) };

  let bodyBuf = undefined;
  let contentLength = 0;
  let bodyPreview = "[empty]";
  let repaired = false;
  let parsed = false;

  if (["POST","PUT","PATCH","DELETE"].includes(method)){
    const stable = getStableJsonBuffer(req?.body);
    bodyBuf = stable.buf;
    contentLength = stable.len;
    bodyPreview = stable.preview;
    repaired = !!stable.repaired;
    parsed = !!stable.parsed;
    if (!headers["Content-Type"]) headers["Content-Type"]="application/json; charset=utf-8";
    headers["Content-Length"] = String(contentLength);
  }

  getDebug("HTTP Request", {
    method,
    url,
    headers: Object.keys(headers),
    responseType,
    timeoutMs,
    bodyLen: contentLength,
    bodyPreview,
    repairedEOF: repaired,
    parsedJson: parsed
  });

  const res = await getFetchJson(url, { method, headers, body: bodyBuf }, timeoutMs);

  const hdrSubset = {};
  if (res?.headers && typeof res.headers.get==="function"){
    for (const k of ["x-seraph-loginreason","x-confluence-request-time","content-type","content-length","location"]){
      const v = res.headers.get(k);
      if (v) hdrSubset[k]=v;
    }
  }

  const out = {
    ok: !!res?.ok,
    status: res?.status||0,
    url,
    headers: hdrSubset,
    data: responseType==="json" ? res?.data : (typeof res?.data==="string" ? { text: res.data } : res?.data),
    took_ms: Date.now()-startedAt
  };

  getDebug("HTTP Response", { status: out.status, headers: hdrSubset, ok: out.ok });
  return out;
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description:
        "ALWAYS use this for all requests regarding CONFLUENCE. Thin Confluence proxy that forwards KI-built JSON as-is. "
        + "Repairs truncated JSON, sets explicit Content-Length, and logs request/response. "
        + "Usage Guide — always send valid Confluence payloads; ADF is recommended.\n\n"
        + "1) Create page with ADF (recommended)\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"POST\",\n"
        + "    \"url\": \"https://<site>.atlassian.net/wiki/rest/api/content\",\n"
        + "    \"body\": {\n"
        + "      \"type\": \"page\",\n"
        + "      \"title\": \"Hello ADF\",\n"
        + "      \"space\": { \"key\": \"ST\" },\n"
        + "      \"ancestors\": [{ \"id\": \"<PARENT_PAGE_ID>\" }],\n"
        + "      \"body\": {\n"
        + "        \"atlas_doc_format\": {\n"
        + "          \"value\": \"{\\\"version\\\":1,\\\"type\\\":\\\"doc\\\",\\\"content\\\":[{\\\"type\\\":\\\"heading\\\",\\\"attrs\\\":{\\\"level\\\":2},\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"Hello\\\"}]},{\\\"type\\\":\\\"paragraph\\\",\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"World from ADF.\\\"}]}]}\",\n"
        + "          \"representation\": \"atlas_doc_format\"\n"
        + "        }\n"
        + "      }\n"
        + "    }\n"
        + "  }\n"
        + "}\n\n"
        + "2) Create page with Storage XHTML (pass-through)\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"POST\",\n"
        + "    \"url\": \"https://<site>.atlassian.net/wiki/rest/api/content\",\n"
        + "    \"body\": {\n"
        + "      \"type\": \"page\",\n"
        + "      \"title\": \"Legacy Storage\",\n"
        + "      \"space\": { \"key\": \"ST\" },\n"
        + "      \"ancestors\": [{ \"id\": \"<PARENT_PAGE_ID>\" }],\n"
        + "      \"body\": {\n"
        + "        \"storage\": {\n"
        + "          \"value\": \"<h2>Hello</h2><p>World via storage.</p>\",\n"
        + "          \"representation\": \"storage\"\n"
        + "        }\n"
        + "      }\n"
        + "    }\n"
        + "  }\n"
        + "}\n\n"
        + "3) Update page (PUT) with ADF\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"PUT\",\n"
        + "    \"url\": \"https://<site>.atlassian.net/wiki/rest/api/content/123456\",\n"
        + "    \"body\": {\n"
        + "      \"id\": \"123456\",\n"
        + "      \"type\": \"page\",\n"
        + "      \"title\": \"Hello ADF (Updated)\",\n"
        + "      \"version\": { \"number\": 2 },\n"
        + "      \"body\": {\n"
        + "        \"atlas_doc_format\": {\n"
        + "          \"value\": \"{\\\"version\\\":1,\\\"type\\\":\\\"doc\\\",\\\"content\\\":[{\\\"type\\\":\\\"paragraph\\\",\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"Updated content.\\\"}]}]}\",\n"
        + "          \"representation\": \"atlas_doc_format\"\n"
        + "        }\n"
        + "      }\n"
        + "    }\n"
        + "  }\n"
        + "}\n\n"
        + "4) Get page with expand\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"GET\",\n"
        + "    \"url\": \"https://<site>.atlassian.net/wiki/rest/api/content/123456\",\n"
        + "    \"query\": { \"expand\": \"body.storage,version\" }\n"
        + "  }\n"
        + "}\n\n"
        + "5) Search pages by CQL (cql is REQUIRED)\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"GET\",\n"
        + "    \"path\": \"/rest/api/content/search\",\n"
        + "    \"query\": { \"cql\": \"space = \\\"ST\\\" AND title ~ \\\"Hello\\\"\", \"limit\": 25 }\n"
        + "  }\n"
        + "}\n\n"
        + "6) Delete page\n"
        + "{\n"
        + "  \"json\": {\n"
        + "    \"method\": \"DELETE\",\n"
        + "    \"url\": \"https://<site>.atlassian.net/wiki/rest/api/content/123456\"\n"
        + "  }\n"
        + "}\n",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          json: {
            type: "object",
            additionalProperties: false,
            properties: {
              method: { type: "string", enum: ["GET","POST","PUT","DELETE","PATCH"] },
              path: { type: "string" },
              url: { type: "string" },
              query: { type: "object" },
              headers: { type: "object" },
              body: { oneOf: [ { type: "object" }, { type: "string" } ] },
              timeoutMs: { type: "number" },
              responseType: { type: "string", enum: ["json","arraybuffer"] }
            },
            required: ["method"]
          }
        }
      }
    }
  },
  invoke: getInvoke
};
