/********************************************************************************
/* filename: "core-ai-responses.js"                                            *
/* Version 1.0                                                                 *
/* Purpose: Responses runner (GPT-5) with context translation, real tool       *
/*          handling, image persistence, and file-based logging (no console).  *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;
const MODULE_NAME = "core-ai-responses";
const DEBUG_DIR = path.resolve("./pub/debug");
const DOC_DIR = path.resolve("./pub/documents");

/********************************************************************************
/* functionSignature: getToString (v)                                          *
/* Returns a safe string representation.                                       *
/********************************************************************************/
function getToString(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }

/********************************************************************************
/* functionSignature: getStr (v, d)                                            *
/* Returns v if non-empty string; otherwise default d.                         *
/********************************************************************************/
function getStr(v, d) { return (typeof v === "string" && v.length) ? v : d; }

/********************************************************************************
/* functionSignature: getNum (v, d)                                            *
/* Returns finite numeric v; otherwise default d.                              *
/********************************************************************************/
function getNum(v, d) { return Number.isFinite(v) ? Number(v) : d; }

/********************************************************************************
/* functionSignature: getJSON (t, f)                                           *
/* Parses JSON text t; returns fallback f on failure.                          *
/********************************************************************************/
function getJSON(t, f = null) { try { return JSON.parse(t); } catch { return f; } }

/********************************************************************************
/* functionSignature: getWithTurnId (rec, wo)                                  *
/* Adds turn_id from working object if present.                                *
/********************************************************************************/
function getWithTurnId(rec, wo) { const t = (typeof wo?.turn_id === "string" && wo.turn_id) ? wo.turn_id : undefined; return t ? { ...rec, turn_id: t } : rec; }

/********************************************************************************
/* functionSignature: getPreview (s, n)                                        *
/* Returns a truncated preview with ellipsis marker.                           *
/********************************************************************************/
function getPreview(s, n = 400) { const t = getToString(s); return t.length > n ? t.slice(0, n) + " …[truncated]" : t; }

/********************************************************************************
/* functionSignature: getLooksBase64 (s)                                       *
/* Heuristically checks if s looks like base64 content.                        *
/********************************************************************************/
function getLooksBase64(s) { return typeof s === "string" && s.length > 32 && /^[A-Za-z0-9+/=\r\n]+$/.test(s); }

/********************************************************************************
/* functionSignature: setEnsureDebugDir ()                                     *
/* Ensures the debug directory exists.                                         *
/********************************************************************************/
function setEnsureDebugDir() { if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true }); }

/********************************************************************************
/* functionSignature: getSafeJSONStringify (obj)                               *
/* Safe JSON stringify with fallback.                                          *
/********************************************************************************/
function getSafeJSONStringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } }

/********************************************************************************
/* functionSignature: setRedactSecrets (s)                                     *
/* Redacts common secret patterns from text.                                   *
/********************************************************************************/
function setRedactSecrets(s) {
  s = (typeof s === "string") ? s : String(s);
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\-\/=]+/gi, "$1***REDACTED***");
  s = s.replace(/("Authorization"\s*:\s*")Bearer\s+[^"]+(")/gi, "$1Bearer ***REDACTED***$2");
  s = s.replace(/(["']?(?:api[-_\s]?key|token|secret)["']?\s*:\s*")([^"]+)(")/gi, "$1***REDACTED***$3");
  return s;
}

/********************************************************************************
/* functionSignature: getApproxBase64Bytes (b64)                               *
/* Approximates decoded byte length of base64 text.                            *
/********************************************************************************/
function getApproxBase64Bytes(b64) { const len = (b64 || "").length; const pads = (b64?.endsWith("==") ? 2 : (b64?.endsWith("=") ? 1 : 0)); return Math.max(0, Math.floor(len * 0.75) - pads); }

/********************************************************************************
/* functionSignature: getSha256OfBase64 (b64)                                  *
/* Computes SHA-256 of base64-decoded data.                                    *
/********************************************************************************/
function getSha256OfBase64(b64) { try { return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex"); } catch { return "n/a"; } }

/********************************************************************************
/* functionSignature: getSanitizedForLog (obj)                                 *
/* Produces log-friendly sanitized clone.                                      *
/********************************************************************************/
function getSanitizedForLog(obj) {
  const seen = new WeakSet();
  const MAX_STRING = 2000;
  function walk(x) {
    if (x && typeof x === "object") {
      if (seen.has(x)) return "[[circular]]";
      seen.add(x);
      if (Array.isArray(x)) return x.map(walk);
      const o = {};
      for (const [k, v] of Object.entries(x)) {
        if (typeof v === "string") {
          if (k === "b64_json" || k === "base64" || k === "b64" || (k === "result" && getLooksBase64(v))) {
            const bytes = getApproxBase64Bytes(v);
            const hash = getSha256OfBase64(v);
            o[k] = `[[base64 ${bytes} bytes sha256=${hash}]]`;
            continue;
          }
          if (/^data:image\//i.test(v)) {
            const b64 = v.split(",")[1] || "";
            const bytes = getApproxBase64Bytes(b64);
            const hash = getSha256OfBase64(b64);
            o[k] = `[[data-url image base64 ${bytes} bytes sha256=${hash}]]`;
            continue;
          }
          if (v.length > MAX_STRING) {
            o[k] = v.slice(0, MAX_STRING) + ` …[+${v.length - MAX_STRING} chars truncated]`;
            continue;
          }
        }
        o[k] = walk(v);
      }
      return o;
    }
    return x;
  }
  return walk(obj);
}

/********************************************************************************
/* functionSignature: getImageSummaryForLog (images)                            *
/* Summarizes image artifacts for logs.                                        *
/********************************************************************************/
function getImageSummaryForLog(images) {
  return (images || []).map(im => {
    if (im.kind === "b64") { const bytes = getApproxBase64Bytes(im.b64 || ""); const hash = getSha256OfBase64(im.b64 || ""); return { kind: "b64", mime: im.mime || "image/png", bytes, sha256: hash }; }
    if (im.kind === "url") { return { kind: "url", mime: im.mime || undefined, url: im.url }; }
    if (im.kind === "file_id") { return { kind: "file_id", mime: im.mime || "image/png", file_id: im.file_id }; }
    return im;
  });
}

/********************************************************************************
/* functionSignature: setLogBig (label, data, options)                          *
/* Writes large sanitized debug logs (optional to file).                        *
/********************************************************************************/
function setLogBig(label, data, { toFile = false } = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const sanitized = getSanitizedForLog(data);
  const asText = typeof sanitized === "string" ? sanitized : getSafeJSONStringify(sanitized);
  const red = setRedactSecrets(asText);
  if (toFile) {
    try {
      setEnsureDebugDir();
      const file = path.join(DEBUG_DIR, `${ts}-${label}.log`);
      fs.writeFileSync(file, red, "utf8");
    } catch {}
  }
}

/********************************************************************************
/* functionSignature: setLogConsole (label, data)                               *
/* No-op console logger (no console output).                                   *
/********************************************************************************/
function setLogConsole(_label, _data) {}

/********************************************************************************
/* functionSignature: getIdemp (wo)                                            *
/* Returns idempotence-tracking store on working object.                        *
/********************************************************************************/
function getIdemp(wo) { if (!wo.__idemp) wo.__idemp = { tools: new Set(), images: new Set() }; return wo.__idemp; }

/********************************************************************************
/* functionSignature: getNormalizedToolDefs (toolsLike)                         *
/* Normalizes tool definitions to Responses format.                             *
/********************************************************************************/
function getNormalizedToolDefs(toolsLike) {
  if (!Array.isArray(toolsLike)) return [];
  const out = [];
  for (const d of toolsLike) {
    if (!d) continue;
    if (d.type === "function" && d.name) { out.push(d); continue; }
    if (d.type === "function" && d.function?.name) {
      out.push({ type: "function", name: d.function.name, description: d.function.description || "", parameters: d.function.parameters || { type: "object", properties: {} } });
    }
  }
  return out;
}

/********************************************************************************
/* functionSignature: getNormalizedToolChoice (tc)                              *
/* Normalizes tool_choice to accepted structures.                               *
/********************************************************************************/
function getNormalizedToolChoice(tc) {
  if (!tc || tc === "auto" || tc === "none") return tc || "auto";
  if (tc?.type === "function" && tc?.name) return tc;
  if (tc?.type === "function" && tc?.function?.name) return { type: "function", name: tc.function.name };
  return "auto";
}

/********************************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, snapshot)                  *
/* Builds optional runtime context from last history record.                    *
/********************************************************************************/
function getRuntimeContextFromLast(wo, snapshot) {
  if (wo?.IncludeRuntimeContext !== true) return null;
  const last = Array.isArray(snapshot) && snapshot.length ? { ...snapshot[snapshot.length - 1] } : null;
  if (last && "content" in last) delete last.content;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? ""), model: String(wo?.Model ?? ""), tool_choice: (wo?.ToolChoice ?? "auto"), timezone: String(wo?.timezone ?? "Europe/Berlin") };
  return { metadata, last };
}

/********************************************************************************
/* functionSignature: getAppendRuntimeContextToUserContent (baseText, ctx)      *
/* Appends runtime context JSON block to user text.                             *
/********************************************************************************/
function getAppendRuntimeContextToUserContent(baseText, ctx) { if (!ctx) return baseText ?? ""; const jsonBlock = "```json\n" + JSON.stringify(ctx) + "\n```"; return (baseText ?? "") + "\n\n[context]\n" + jsonBlock; }

/********************************************************************************
/* functionSignature: getToolsByName (names, wo)                                *
/* Dynamically imports tools and validates invoke function.                     *
/********************************************************************************/
async function getToolsByName(names, wo) {
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      if (tool && typeof tool.invoke === "function") loaded.push(tool);
      else wo.logging?.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `Tool "${name}" invalid (missing invoke); skipped.` });
    } catch (e) {
      wo.logging?.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `Tool "${name}" load failed: ${e?.message || String(e)}` });
    }
  }
  return loaded;
}

/********************************************************************************
/* functionSignature: setExecGenericTool (toolModules, call, coreData)          *
/* Executes a generic tool with idempotence and message mapping.               *
/********************************************************************************/
async function setExecGenericTool(toolModules, call, coreData) {
  const wo = coreData?.workingObject ?? {};
  const idemp = getIdemp(wo);
  const name = call?.function?.name || call?.name;
  const argsRaw = call?.function?.arguments ?? call?.arguments ?? "{}";
  const args = typeof argsRaw === "string" ? getJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.definition?.name || t.name) === name);
  const callId = call?.id || call?.call_id || `${name}:${createHash("sha256").update(JSON.stringify(args)).digest("hex")}`;
  if (idemp.tools.has(callId)) return { ok: true, name, content: JSON.stringify({ type: "tool_result", tool: name, call_id: callId, ok: true, skipped: "idempotent-skip" }) };
  idemp.tools.add(callId);
  wo.logging?.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "started", message: "Tool call start", details: { tool: name, call_id: callId, args_preview: getPreview(args, ARG_PREVIEW_MAX) } });
  if (!tool) return { ok: false, name, content: JSON.stringify({ type: "tool_result", tool: name, call_id: callId, ok: false, error: `Tool "${name}" not found` }) };
  try {
    try { await putItem(name, "status:tool"); } catch {}
    const res = await tool.invoke(args, coreData);
    const mapped = { type: "tool_result", tool: name, call_id: callId, ok: true, data: (typeof res === "string" ? getJSON(res, res) : res) };
    const content = JSON.stringify(mapped);
    wo.logging?.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "Tool call success", details: { tool: name, call_id: callId, result_preview: getPreview(content, RESULT_PREVIEW_MAX) } });
    return { ok: true, name, content };
  } catch (e) {
    const mappedErr = { type: "tool_result", tool: name, call_id: callId, ok: false, error: e?.message || String(e) };
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "error", module: MODULE_NAME, exitStatus: "failed", message: "Tool call error", details: { tool: name, call_id: callId, error: String(e?.message || e) } });
    return { ok: false, name, content: JSON.stringify(mappedErr) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData.workingObject.StatusToolClearDelayMs) : 800;
    setTimeout(() => { try { putItem("", "status:tool"); } catch {} }, Math.max(0, delayMs));
  }
}

/********************************************************************************
/* functionSignature: setEnsureDocDir ()                                        *
/* Ensures the public documents directory exists.                               *
/********************************************************************************/
function setEnsureDocDir() { if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true }); }

/********************************************************************************
/* functionSignature: getExtFromMime (m)                                        *
/* Returns a file extension based on MIME type.                                 *
/********************************************************************************/
function getExtFromMime(m) { const mime = (m || "").toLowerCase(); if (mime.includes("png")) return ".png"; if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg"; if (mime.includes("webp")) return ".webp"; if (mime.includes("gif")) return ".gif"; if (mime.includes("bmp")) return ".bmp"; if (mime.includes("svg")) return ".svg"; return ".png"; }

/********************************************************************************
/* functionSignature: getBuildUrl (filename, baseUrl)                           *
/* Builds a public URL for a persisted document.                                *
/********************************************************************************/
function getBuildUrl(filename, baseUrl) { const clean = (baseUrl || "").replace(/\/+$/, ""); return clean ? `${clean}/documents/${filename}` : `/documents/${filename}`; }

/********************************************************************************
/* functionSignature: setSaveB64 (b64, mime, baseUrl, wo)                       *
/* Persists base64 image and returns hosted URL.                                *
/********************************************************************************/
async function setSaveB64(b64, mime, baseUrl, wo) { setEnsureDocDir(); const idemp = getIdemp(wo); const hash = getSha256OfBase64(b64 || ""); if (idemp.images.has(hash)) return getBuildUrl(`DUP-${hash}.png`, baseUrl); idemp.images.add(hash); const ext = getExtFromMime(mime || "image/png"); const filename = `${Date.now()}-${randomUUID()}${ext}`; const filePath = path.join(DOC_DIR, filename); fs.writeFileSync(filePath, Buffer.from(b64, "base64")); return getBuildUrl(filename, baseUrl); }

/********************************************************************************
/* functionSignature: setMirrorURL (url, baseUrl, wo)                           *
/* Downloads a remote image and mirrors it locally.                             *
/********************************************************************************/
async function setMirrorURL(url, baseUrl, wo) { setEnsureDocDir(); const idemp = getIdemp(wo); const key = `url:${createHash("sha256").update(url || "").digest("hex")}`; if (idemp.images.has(key)) return getBuildUrl(`DUP-${createHash("sha256").update(url).digest("hex")}.png`, baseUrl); idemp.images.add(key); const f = globalThis.fetch ?? (await import("node-fetch")).default; const res = await f(url, { headers: { "User-Agent": "core-ai-responses/1.0" } }); if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`); const mime = res.headers.get("content-type") || "image/png"; const ext = getExtFromMime(mime); const filename = `${Date.now()}-${randomUUID()}${ext}`; const filePath = path.join(DOC_DIR, filename); const buf = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(filePath, buf); return getBuildUrl(filename, baseUrl); }

/********************************************************************************
/* functionSignature: setSaveFromFileId (fileId, opts, wo)                      *
/* Downloads an image via provider fileId and persists it.                      *
/********************************************************************************/
async function setSaveFromFileId(fileId, { baseUrl, apiKey, endpointResponses, endpointFilesContentTemplate }, wo) { setEnsureDocDir(); const idemp = getIdemp(wo); const key = `file:${fileId}`; if (idemp.images.has(key)) return getBuildUrl(`DUP-${createHash("sha256").update(fileId).digest("hex")}.png`, baseUrl); idemp.images.add(key); let url = ""; if (endpointFilesContentTemplate && endpointFilesContentTemplate.includes("{id}")) { url = endpointFilesContentTemplate.replace("{id}", encodeURIComponent(fileId)); } else { const base = (endpointResponses || "").replace(/\/responses.*/, "").replace(/\/+$/, ""); url = `${base}/files/${encodeURIComponent(fileId)}/content`; } const f = globalThis.fetch ?? (await import("node-fetch")).default; const res = await f(url, { method: "GET", headers: { "Authorization": `Bearer ${apiKey}`, "User-Agent": "core-ai-responses/1.0" } }); if (!res.ok) throw new Error(`File download failed: ${res.status} ${res.statusText}`); const mime = res.headers.get("content-type") || "image/png"; const ext = getExtFromMime(mime); const filename = `${Date.now()}-${randomUUID()}${ext}`; const filePath = path.join(DOC_DIR, filename); const buf = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(filePath, buf); return getBuildUrl(filename, baseUrl); }

/********************************************************************************
/* functionSignature: getParsedResponsesOutput (raw)                            *
/* Extracts text, images, and tool calls from Responses JSON.                   *
/********************************************************************************/
function getParsedResponsesOutput(raw) {
  const out = { text: "", toolCalls: [], images: [] };
  const isHttpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u));
  const isDataUrl = (u) => (typeof u === "string" && /^data:image\/[a-z0-9+.\-]+;base64,/i.test(u));
  const b64FromDataUrl = (u) => (typeof u === "string" ? (u.split(",")[1] || "") : "");
  function pushImageUrl(u, mime) { if (isHttpUrl(u)) out.images.push({ kind: "url", url: u, mime: mime || undefined }); else if (isDataUrl(u)) out.images.push({ kind: "b64", b64: b64FromDataUrl(u), mime: mime || "image/png" }); }
  function pushImageB64(b64, mime) { if (typeof b64 === "string" && b64.length) out.images.push({ kind: "b64", b64, mime: mime || "image/png" }); }
  function pushFileId(id, mime) { if (typeof id === "string" && id.length) out.images.push({ kind: "file_id", file_id: id, mime: mime || "image/png" }); }
  function crawl(node) {
    if (!node || typeof node !== "object") return;
    const t = node.type;
    if (t === "output_text" && typeof node.text === "string") out.text += node.text;
    if (t === "image" || t === "image_url" || t === "output_image") {
      const u = node?.image_url?.url || node?.image_url || node?.url;
      const b = node?.b64_json || node?.data?.b64_json || node?.base64;
      const fid = node?.file_id || node?.image_file?.file_id || node?.data?.file_id || node?.asset_pointer?.file_id || node?.image?.file_id;
      const mime = node?.mime || node?.mime_type || node?.data?.mime || "image/png";
      if (u) pushImageUrl(u, mime);
      if (b) pushImageB64(b, mime);
      if (fid) pushFileId(fid, mime);
    }
    if (t === "image_generation_call") {
      const mime = (node?.output_format && typeof node.output_format === "string") ? `image/${node.output_format.toLowerCase()}` : "image/png";
      if (typeof node?.result === "string") {
        if (isDataUrl(node.result)) pushImageB64(b64FromDataUrl(node.result), mime);
        else if (getLooksBase64(node.result)) pushImageB64(node.result, mime);
        else if (isHttpUrl(node.result)) pushImageUrl(node.result, mime);
      }
      if (typeof node?.url === "string") pushImageUrl(node.url, mime);
      if (node?.file_id) pushFileId(node.file_id, mime);
    }
    if (t === "tool_call" || t === "function_call") {
      out.toolCalls.push({ id: node?.id || node?.call_id, type: t, name: node?.name || node?.function?.name, arguments: typeof node?.arguments === "string" ? node.arguments : (node?.function?.arguments ?? JSON.stringify(node?.function?.arguments ?? {})) });
    }
    if (t === "tool_use" || t === "tool_result") {
      const name = node?.name || node?.tool_name;
      const args = node?.input ?? node?.arguments ?? {};
      out.toolCalls.push({ id: node?.id || node?.call_id, type: t, name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
      if (Array.isArray(node?.output)) node.output.forEach(crawl);
    }
    if (Array.isArray(node.content)) node.content.forEach(crawl);
    if (node.image_url) pushImageUrl(node?.image_url?.url || node?.image_url, node?.mime);
    if (node.url) pushImageUrl(node.url, node?.mime);
    if (node.b64_json || node.base64) pushImageB64(node.b64_json || node.base64, node?.mime || "image/png");
    if (typeof node?.result === "string" && !t) {
      if (isDataUrl(node.result)) pushImageB64(b64FromDataUrl(node.result), node?.mime || "image/png");
      else if (getLooksBase64(node.result)) pushImageB64(node.result, node?.mime || "image/png");
      else if (isHttpUrl(node.result)) pushImageUrl(node.result, node?.mime);
    }
    const possibleFileIds = [node?.file_id, node?.image_file?.file_id, node?.data?.file_id, node?.asset_pointer?.file_id, node?.image?.file_id, Array.isArray(node?.images) && node.images[0]?.file_id].filter(Boolean);
    for (const fid of possibleFileIds) pushFileId(fid, node?.mime || node?.mime_type);
    if (Array.isArray(node?.images)) {
      for (const im of node.images) {
        const iu = im?.url || im?.image_url; const ib64 = im?.b64_json || im?.base64; const ifid = im?.file_id || im?.image_file?.file_id || im?.asset_pointer?.file_id; const mime = im?.mime || im?.mime_type || "image/png";
        if (iu) pushImageUrl(iu, mime); if (ib64) pushImageB64(ib64, mime); if (ifid) pushFileId(ifid, mime);
      }
    }
    Object.values(node).forEach(v => { if (Array.isArray(v)) v.forEach(crawl); else if (v && typeof v === "object") crawl(v); });
  }
  const arr = Array.isArray(raw?.output) ? raw.output : (raw ? [raw] : []);
  arr.forEach(crawl);
  out.text = out.text.trim();
  return out;
}

/********************************************************************************
/* functionSignature: getWasTruncatedOutput (data)                              *
/* Detects whether model output was truncated.                                  *
/********************************************************************************/
function getWasTruncatedOutput(data) {
  if (data?.incomplete_details) return true;
  if (data?.status && String(data.status).toLowerCase() === "incomplete") return true;
  try {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    for (const m of outputs) {
      const content = Array.isArray(m?.content) ? m.content : [];
      for (const c of content) { if (c?.finish_reason && String(c.finish_reason).toLowerCase() === "length") return true; }
    }
  } catch {}
  return false;
}

/********************************************************************************
/* functionSignature: getPayload (row)                                          *
/* Extracts the text payload from a history row.                                *
/********************************************************************************/
function getPayload(row) { if (typeof row?.json === "string" && row.json.length) return row.json; if (typeof row?.content === "string" && row.content.length) return row.content; if (typeof row?.text === "string" && row.text.length) return row.text; return ""; }

/********************************************************************************
/* functionSignature: getSnapshotMappedToChat (rows)                            *
/* Maps stored snapshot rows to chat-style messages.                            *
/********************************************************************************/
function getSnapshotMappedToChat(rows) { const out = []; for (const r of rows || []) { const role = r?.role; const payload = getPayload(r); if (role === "system") out.push({ role: "system", content: payload }); else if (role === "user") out.push({ role: "user", content: payload }); else if (role === "assistant") out.push({ role: "assistant", content: payload }); else if (role === "tool") out.push({ role: "assistant", content: payload }); } return out; }

/********************************************************************************
/* functionSignature: getResponsesInputFromMessages (messages)                  *
/* Converts chat messages to Responses API input format.                        *
/********************************************************************************/
function getResponsesInputFromMessages(messages) { return messages.map(m => { const role = (m.role === "tool") ? "assistant" : m.role; const type = (role === "assistant") ? "output_text" : "input_text"; const text = getToString(m.content ?? ""); return { role, content: [{ type, text }] }; }); }

/********************************************************************************
/* functionSignature: getCoreAi (coreData)                                      *
/* Runs the Responses workflow end-to-end.                                      *
/********************************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData?.workingObject ?? {};
  if (!Array.isArray(wo.logging)) wo.logging = [];
  const gate = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  if (gate && gate !== "responses") { wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "skipped", message: `Skipped: useAIModule="${gate}" != "responses"` }); return coreData; }
  const skipContextWrites = wo?.doNotWriteToContext === true;

  const endpoint = getStr(wo?.EndpointResponses, "");
  const apiKey = getStr(wo?.APIKey, "");
  const model = getStr(wo?.Model, "");
  const baseUrl = getStr(wo?.BaseURL ?? wo?.baseUrl ?? wo?.base_url, "");
  const endpointFilesContentTemplate = getStr(wo?.EndpointFilesContent, "");
  const maxTokens = getNum(wo?.MaxTokens, 2000);
  const maxLoops = getNum(wo?.MaxLoops, 16);
  const maxToolCalls = getNum(wo?.MaxToolCalls, 8);
  const timeoutMs = getNum(wo?.RequestTimeoutMs, 120000);
  const debugOn = Boolean(wo?.DebugPayload ?? process.env.AI_DEBUG);
  if (!endpoint || !apiKey || !model) { wo.Response = "[Empty AI response]"; wo.logging.push({ timestamp: new Date().toISOString(), severity: "error", module: MODULE_NAME, exitStatus: "failed", message: `Missing required: ${!endpoint ? "EndpointResponses " : ""}${!apiKey ? "APIKey " : ""}${!model ? "Model" : ""}`.trim() }); return coreData; }
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `Using BaseURL="${baseUrl || "(relative /documents)"}"` });

  let snapshot = [];
  try { snapshot = await getContext(wo); } catch (e) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` }); }

  function getSystemContent(wo2) {
    const now = new Date();
    const tz = getStr(wo2?.timezone, "Europe/Berlin");
    const nowIso = now.toISOString();
    const base = [typeof wo2.SystemPrompt === "string" ? wo2.SystemPrompt.trim() : "", typeof wo2.Instructions === "string" ? wo2.Instructions.trim() : ""].filter(Boolean).join("\n\n");
    const runtimeInfo = [
      "Runtime info:",
      `- current_time_iso: ${nowIso}`,
      `- timezone_hint: ${tz}`,
      "- When the user says “today”, “tomorrow”, or uses relative terms, interpret them relative to current_time_iso unless the user gives another explicit reference time.",
      "- If you generate calendar-ish text, prefer explicit dates (YYYY-MM-DD) when it helps the user."
    ].join("\n");
    const policy = [
      "Policy:",
      "- NEVER ANSWER TO OLDER USER REQUESTS",
      "- Use tools only when necessary.",
      "- When you emit a tool call, do not include extra prose in the same turn.",
      "- ALWAYS answer in human readable plain text, unless you are explicitly told to answer in a different format",
      "- NEVER ANSWER with JSON unless you are explicitly asked. DO NOT imitate the format from the context"
    ].join("\n");
    const multiChannelNote = (() => {
      const raw = Array.isArray(wo2?.contextIDs) ? wo2.contextIDs : [];
      const extraIds = raw.map(v => String(v || "").trim()).filter(v => v.length > 0);
      if (!extraIds.length) return "";
      const currentId = String(wo2?.id ?? "").trim();
      const lines = [
        "Multi-channel context:",
        "- The context includes messages from multiple channels. Each message may carry a `channelId` field that identifies its source channel."
      ];
      if (currentId) lines.push(`- Treat "${currentId}" as your primary (effective) channelId for this conversation.`);
      return lines.join("\n");
    })();
    const parts = [];
    if (base) parts.push(base);
    parts.push(runtimeInfo);
    parts.push(policy);
    if (multiChannelNote) parts.push(multiChannelNote);
    return parts.filter(Boolean).join("\n\n");
  }

  const sys = getSystemContent(wo);
  const fromDb = getSnapshotMappedToChat(Array.isArray(snapshot) ? snapshot : []);
  const userPayloadRaw = getToString(wo?.payload ?? "");
  const runtimeCtx = getRuntimeContextFromLast(wo, snapshot);
  const userContent = getAppendRuntimeContextToUserContent(userPayloadRaw, runtimeCtx);

  let messages = [{ role: "system", content: sys }, ...fromDb, ...(userPayloadRaw ? [{ role: "user", content: userContent }] : [])];

  setLogConsole("request-messages-initial", { count: messages.length, messages });
  if (runtimeCtx) setLogConsole("runtime-context", runtimeCtx);

  const toolNames = Array.isArray(wo?.Tools) ? wo.Tools : [];
  const genericTools = await getToolsByName(toolNames, wo);
  const toolDefs = getNormalizedToolDefs(genericTools.map(t => t.definition).filter(Boolean));
  const toolsForResponses = [{ type: "image_generation" }, ...toolDefs];
  const toolChoiceInitial = getNormalizedToolChoice(wo?.ToolChoice) || "auto";
  const persistQueue = [];

  let finalText = "";
  let accumulatedText = "";
  let allHostedLinks = [];

  let totalToolCalls = 0;
  let attempts = 0;
  const maxAttempts = Math.max(1, getNum(wo?.MaxAttempts, Math.min(3, maxLoops)));

  for (let iter = 0; iter < maxLoops; iter++) {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      setLogConsole(`iteration-${iter + 1}-messages-before-request`, { count: messages.length, messages });
      const body = { model, input: getResponsesInputFromMessages(messages), instructions: sys, tools: toolsForResponses, tool_choice: toolChoiceInitial, ...(maxTokens ? { max_output_tokens: maxTokens } : {}) };
      setLogBig("responses-request-body", { endpoint, model, tool_choice: body.tool_choice, tools: body.tools, input: body.input, instructions: body.instructions }, { toFile: debugOn });
      const res = await (globalThis.fetch ?? (await import("node-fetch")).default)(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timer);
      const rawText = await res.text();
      const hdr = {}; try { res.headers?.forEach?.((v, k) => { hdr[k] = v; }); } catch {}
      const RAW_MAX = 8000;
      setLogBig("responses-status", { status: res.status, statusText: res.statusText }, { toFile: debugOn });
      setLogBig("responses-headers", hdr, { toFile: debugOn });
      setLogBig("responses-payload-raw", rawText.length > RAW_MAX ? rawText.slice(0, RAW_MAX) + ` …[+${rawText.length - RAW_MAX} chars truncated]` : rawText, { toFile: debugOn });

      if (!res.ok) {
        const retryable = (res.status >= 500 && res.status <= 599) || res.status === 429;
        if (retryable && attempts < maxAttempts) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "retry", message: `Retrying due to HTTP ${res.status}` }); continue; }
        wo.Response = "[Empty AI response]";
        wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "failed", message: `HTTP ${res.status} ${res.statusText} ${rawText.slice(0, 300)}` });
        return coreData;
      }

      const data = getJSON(rawText, {});
      setLogBig("responses-payload-json", data, { toFile: debugOn });
      const parsed = getParsedResponsesOutput(data);
      const hostedLinks = [];

      if (parsed.images.length) {
        for (const it of parsed.images) {
          try {
            if (it.kind === "b64") hostedLinks.push(await setSaveB64(it.b64, it.mime || "image/png", baseUrl, wo));
            else if (it.kind === "url") hostedLinks.push(await setMirrorURL(it.url, baseUrl, wo));
            else if (it.kind === "file_id") hostedLinks.push(await setSaveFromFileId(it.file_id, { baseUrl, apiKey, endpointResponses: endpoint, endpointFilesContentTemplate }, wo));
          } catch (e) {
            const placeholder = getBuildUrl(`FAILED-${Date.now()}-${randomUUID()}.txt`, baseUrl);
            hostedLinks.push(`${placeholder}?error=${encodeURIComponent(e?.message || "persist failed")}`);
            wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `Image persist failed: ${e?.message || String(e)}` });
          }
        }
      } else {
        wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `No images parsed from response.` });
      }

      if (hostedLinks.length) allHostedLinks.push(...hostedLinks);

      setLogBig("responses-parsed-summary", { textPreview: getPreview(parsed.text, 300), images: getImageSummaryForLog(parsed.images), toolCalls: parsed.toolCalls }, { toFile: debugOn });
      setLogBig("responses-hosted-links", hostedLinks, { toFile: debugOn });

      const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
      const hasToolCalls = toolCalls.length > 0;
      const assistantText = (parsed.text || "").trim();

      if (assistantText) {
        const msg = { role: "assistant", content: assistantText };
        messages.push(msg);
        persistQueue.push(getWithTurnId(msg, wo));
        accumulatedText += (accumulatedText ? "\n" : "") + assistantText;
      }

      if (hostedLinks.length) {
        const linkBlock = `${hostedLinks.map(u => `- ${u}`).join("\n")}`;
        const m1 = { role: "assistant", content: linkBlock };
        messages.push(m1);
        persistQueue.push(getWithTurnId(m1, wo));
        const m2 = { role: "assistant", content: `Image assets available: ${hostedLinks.join(" ")}` };
        messages.push(m2);
        persistQueue.push(getWithTurnId(m2, wo));
      } else if (parsed.images.length && !hostedLinks.length) {
        const m3 = { role: "assistant", content: `(no links generated – check write permissions for ./pub/documents and fetch availability)` };
        messages.push(m3);
        persistQueue.push(getWithTurnId(m3, wo));
      }

      let ranAnyTool = false;
      if (hasToolCalls && genericTools.length && totalToolCalls < maxToolCalls) {
        for (const tc of toolCalls) {
          const isGeneric = toolDefs.some(d => d?.name === tc?.name);
          const isModelTool = (tc?.name === "image_generation");
          if (isModelTool) continue;
          if (!isGeneric) continue;
          if (totalToolCalls >= maxToolCalls) break;
          const result = await setExecGenericTool(genericTools, tc, coreData);
          totalToolCalls++;
          ranAnyTool = true;
          const contentStr = getToString(result?.content ?? "");
          const tm = { role: "assistant", content: contentStr };
          messages.push(tm);
          persistQueue.push(getWithTurnId(tm, wo));
        }
        if (ranAnyTool) continue;
      }

      const truncated = getWasTruncatedOutput(data);
      if (truncated) {
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue;
      }

      const primaryText = accumulatedText || assistantText || "";
      const linkText = allHostedLinks.length ? allHostedLinks.map(u => `- ${u}`).join("\n") : "";
      finalText = [primaryText, linkText].filter(Boolean).join("\n\n");
      break;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      if (isAbort && attempts < maxAttempts) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "retry", message: `Retrying due to timeout after ${timeoutMs}ms` }); continue; }
      wo.Response = "[Empty AI response]";
      wo.logging.push({ timestamp: new Date().toISOString(), severity: isAbort ? "warn" : "error", module: MODULE_NAME, exitStatus: "failed", message: isAbort ? `AI request timed out after ${timeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}` });
      setLogBig("responses-error", { message: err?.message || String(err), stack: err?.stack }, { toFile: debugOn });
      return coreData;
    }
  }

  if (!skipContextWrites) {
    for (const turn of persistQueue) {
      try { await setContext(wo, turn); }
      catch (e) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `Persist failed (role=${turn.role}): ${e?.message || String(e)}` }); }
    }
  } else {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `doNotWriteToContext=true → skipped persistence of ${persistQueue.length} turn(s)` });
  }

  setLogBig("responses-final", { finalTextPreview: getPreview(finalText, 400), queuedTurns: persistQueue.length }, { toFile: debugOn });
  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });
  return coreData;
}
