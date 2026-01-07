/********************************************************************************
/* filename: "core-ai-responses.js"                                             *
/* Version 1.0                                                                  *
/* Purpose: Responses runner (GPT-5) with context translation, real tool        *
/*          handling, image persistence, and file-based logging (no console).   *
/*          Accumulates reasoning summaries across iterations (incl. tool calls)*
/*          and returns a final combined summary.                               *
/*          Adds parser fallbacks for Responses text extraction.                *
/*          When tool-call budget is exhausted, forces a final synthesis run    *
/*          with tools disabled (tool_choice="none").                           *
/*          Built-in Responses tools are controlled via workingObject.ResponseTools*
/*          (defaults to OFF when missing/empty).                               *
/*                                                                              *
/* Fix: Prevent web_search outputs (and any generic "url" fields) from being    *
/*      misclassified as images by restricting image extraction to explicit     *
/*      image nodes + likely image URLs/mime only.                              *
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
/* functionSignature: getToString (v)                                           *
/* Returns a safe string representation.                                        *
/********************************************************************************/
function getToString(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }

/********************************************************************************
/* functionSignature: getStr (v, d)                                             *
/* Returns v if non-empty string; otherwise default d.                          *
/********************************************************************************/
function getStr(v, d) { return (typeof v === "string" && v.length) ? v : d; }

/********************************************************************************
/* functionSignature: getNum (v, d)                                             *
/* Returns finite numeric v; otherwise default d.                               *
/********************************************************************************/
function getNum(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/********************************************************************************
/* functionSignature: getJSON (t, f)                                            *
/* Parses JSON text t; returns fallback f on failure.                           *
/********************************************************************************/
function getJSON(t, f = null) { try { return JSON.parse(t); } catch { return f; } }

/********************************************************************************
/* functionSignature: getWithTurnId (rec, wo)                                   *
/* Adds turn_id from working object if present.                                 *
/********************************************************************************/
function getWithTurnId(rec, wo) { const t = (typeof wo?.turn_id === "string" && wo.turn_id) ? wo.turn_id : undefined; return t ? { ...rec, turn_id: t } : rec; }

/********************************************************************************
/* functionSignature: getPreview (s, n)                                         *
/* Returns a truncated preview with ellipsis marker.                            *
/********************************************************************************/
function getPreview(s, n = 400) { const t = getToString(s); return t.length > n ? t.slice(0, n) + " …[truncated]" : t; }

/********************************************************************************
/* functionSignature: getLooksBase64 (s)                                        *
/* Heuristically checks if s looks like base64 content.                         *
/********************************************************************************/
function getLooksBase64(s) { return typeof s === "string" && s.length > 32 && /^[A-Za-z0-9+/=\r\n]+$/.test(s); }

/********************************************************************************
/* functionSignature: setEnsureDir (dirPath)                                    *
/* Ensures a directory exists.                                                  *
/********************************************************************************/
function setEnsureDir(dirPath) {
  const p = getToString(dirPath);
  if (!p.length) return;
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/********************************************************************************
/* functionSignature: setEnsureDebugDir ()                                      *
/* Ensures the debug directory exists.                                          *
/********************************************************************************/
function setEnsureDebugDir() { setEnsureDir(DEBUG_DIR); }

/********************************************************************************
/* functionSignature: setEnsureDocDir ()                                        *
/* Ensures the public documents directory exists.                               *
/********************************************************************************/
function setEnsureDocDir() { setEnsureDir(DOC_DIR); }

/********************************************************************************
/* functionSignature: getSafeJSONStringify (obj)                                *
/* Safe JSON stringify with fallback.                                           *
/********************************************************************************/
function getSafeJSONStringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } }

/********************************************************************************
/* functionSignature: setRedactSecrets (s)                                      *
/* Redacts common secret patterns from text.                                    *
/********************************************************************************/
function setRedactSecrets(s) {
  s = (typeof s === "string") ? s : String(s);
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\-\/=]+/gi, "$1***REDACTED***");
  s = s.replace(/("Authorization"\s*:\s*")Bearer\s+[^"]+(")/gi, "$1Bearer ***REDACTED***$2");
  s = s.replace(/(["']?(?:api[-_\s]?key|token|secret)["']?\s*:\s*")([^"]+)(")/gi, "$1***REDACTED***$3");
  return s;
}

/********************************************************************************
/* functionSignature: getApproxBase64Bytes (b64)                                *
/* Approximates decoded byte length of base64 text.                             *
/********************************************************************************/
function getApproxBase64Bytes(b64) {
  const s = (typeof b64 === "string") ? b64 : "";
  const pads = s.endsWith("==") ? 2 : (s.endsWith("=") ? 1 : 0);
  return Math.max(0, Math.floor(s.length * 0.75) - pads);
}

/********************************************************************************
/* functionSignature: getSha256OfBase64 (b64)                                   *
/* Computes SHA-256 of base64-decoded data.                                     *
/********************************************************************************/
function getSha256OfBase64(b64) { try { return createHash("sha256").update(Buffer.from(b64 || "", "base64")).digest("hex"); } catch { return "n/a"; } }

/********************************************************************************
/* functionSignature: getSanitizedForLog (obj)                                  *
/* Produces a log-friendly sanitized clone.                                     *
/********************************************************************************/
function getSanitizedForLog(obj) {
  const seen = new WeakSet();
  const MAX_STRING = 2000;

  /********************************************************************************
  /* functionSignature: walk (x)                                                  *
  /* Sanitizes objects/arrays/strings for safe logging.                            *
  /********************************************************************************/
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
/* Summarizes image artifacts for logs.                                         *
/********************************************************************************/
function getImageSummaryForLog(images) {
  return (images || []).map(im => {
    if (im.kind === "b64") {
      const bytes = getApproxBase64Bytes(im.b64 || "");
      const hash = getSha256OfBase64(im.b64 || "");
      return { kind: "b64", mime: im.mime || "image/png", bytes, sha256: hash };
    }
    if (im.kind === "url") return { kind: "url", mime: im.mime || undefined, url: im.url };
    if (im.kind === "file_id") return { kind: "file_id", mime: im.mime || "image/png", file_id: im.file_id };
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
  if (!toFile) return;
  try {
    setEnsureDebugDir();
    const file = path.join(DEBUG_DIR, `${ts}-${label}.log`);
    fs.writeFileSync(file, red, "utf8");
  } catch {}
}

/********************************************************************************
/* functionSignature: setLogConsole (_label, _data)                             *
/* No-op console logger (no console output).                                    *
/********************************************************************************/
function setLogConsole(_label, _data) {}

/********************************************************************************
/* functionSignature: getIdemp (wo)                                             *
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
      out.push({
        type: "function",
        name: d.function.name,
        description: d.function.description || "",
        parameters: d.function.parameters || { type: "object", properties: {} }
      });
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
/* functionSignature: getReasoningEffort (wo)                                   *
/* Normalizes wo.reasoning into a Responses reasoning.effort value or null.     *
/* Rules: unset/0/"0"/false/"false"/"none"/"" => disabled; true/"true" => medium.*
/********************************************************************************/
function getReasoningEffort(wo) {
  const v = wo?.reasoning;

  if (v == null) return null;
  if (v === false) return null;
  if (v === 0) return null;

  if (typeof v === "number") return (Number.isFinite(v) && v > 0) ? "medium" : null;

  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (!s.length) return null;
    if (s === "0") return null;
    if (s === "false") return null;
    if (s === "none") return null;
    if (s === "off") return null;
    if (s === "disabled") return null;
    if (s === "true") return "medium";
    return s;
  }

  if (v === true) return "medium";

  return null;
}


/********************************************************************************
/* functionSignature: getResponseToolsRaw (wo)                                  *
/* Returns raw response-tools array from working object.                        *
/********************************************************************************/
function getResponseToolsRaw(wo) {
  if (Array.isArray(wo?.ResponseTools)) return wo.ResponseTools;
  if (Array.isArray(wo?.responseTools)) return wo.responseTools;
  return [];
}

/********************************************************************************
/* functionSignature: getNormalizedResponseTools (toolsLike)                    *
/* Normalizes Responses built-in tools (type-based).                             *
/********************************************************************************/
function getNormalizedResponseTools(toolsLike) {
  const out = [];
  const seen = new Set();

  for (const t of (Array.isArray(toolsLike) ? toolsLike : [])) {
    let rec = null;

    if (typeof t === "string" && t.trim().length) {
      rec = { type: t.trim() };
    } else if (t && typeof t === "object" && typeof t.type === "string" && t.type.trim().length) {
      rec = { ...t, type: t.type.trim() };
    }

    if (!rec) continue;
    if (rec.type.toLowerCase() === "function") continue;

    const key = getSafeJSONStringify(rec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }

  return out;
}

/********************************************************************************
/* functionSignature: getToolsForResponses (toolDefs, responseTools, disabled)  *
/* Builds tools list for Responses API: responseTools first, then function tools.*
/********************************************************************************/
function getToolsForResponses(toolDefs, responseTools, toolsDisabled) {
  if (toolsDisabled) return [];
  const out = [];
  for (const d of (responseTools || [])) out.push(d);
  for (const d of (toolDefs || [])) out.push(d);
  return out;
}

/********************************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, snapshot)                  *
/* Builds optional runtime context from last history record.                    *
/********************************************************************************/
function getRuntimeContextFromLast(wo, snapshot) {
  if (wo?.IncludeRuntimeContext !== true) return null;
  const last = Array.isArray(snapshot) && snapshot.length ? { ...snapshot[snapshot.length - 1] } : null;
  if (last && "content" in last) delete last.content;
  const metadata = {
    id: String(wo?.id ?? ""),
    flow: String(wo?.flow ?? ""),
    clientRef: String(wo?.clientRef ?? ""),
    model: String(wo?.Model ?? ""),
    tool_choice: (wo?.ToolChoice ?? "auto"),
    timezone: String(wo?.timezone ?? "Europe/Berlin")
  };
  return { metadata, last };
}

/********************************************************************************
/* functionSignature: getAppendRuntimeContextToUserContent (baseText, ctx)      *
/* Appends runtime context JSON block to user text.                             *
/********************************************************************************/
function getAppendRuntimeContextToUserContent(baseText, ctx) {
  if (!ctx) return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(ctx) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

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
/* functionSignature: getExpandedToolArgs (args, wo)                            *
/* Expands short text fields to full assistant text when applicable.            *
/********************************************************************************/
function getExpandedToolArgs(args, wo) {
  const full = typeof wo?._fullAssistantText === "string" ? wo._fullAssistantText : "";
  if (!full || !args || typeof args !== "object") return args;
  const candidateKeys = ["body", "content", "text", "message"];
  for (const key of candidateKeys) {
    const v = args[key];
    if (typeof v === "string" && v.length && full.length > v.length && full.includes(v)) {
      wo.logging?.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Expanded tool argument "${key}" to full assistant text.`,
        details: { original_length: v.length, full_length: full.length }
      });
      return { ...args, [key]: full };
    }
  }
  return args;
}

/********************************************************************************
/* functionSignature: setExecGenericTool (toolModules, call, coreData)          *
/* Executes a generic tool with idempotence and message mapping.                *
/********************************************************************************/
async function setExecGenericTool(toolModules, call, coreData) {
  const wo = coreData?.workingObject ?? {};
  const idemp = getIdemp(wo);

  const name = call?.function?.name || call?.name;
  const argsRaw = call?.function?.arguments ?? call?.arguments ?? "{}";
  let args = typeof argsRaw === "string" ? getJSON(argsRaw, {}) : (argsRaw || {});
  args = getExpandedToolArgs(args, wo);

  const tool = toolModules.find(t => (t.definition?.function?.name || t.definition?.name || t.name) === name);
  const callId = call?.call_id || call?.id || `${name}:${createHash("sha256").update(JSON.stringify(args)).digest("hex")}`;

  if (idemp.tools.has(callId)) {
    return {
      ok: true,
      name,
      call_id: callId,
      content: JSON.stringify({ type: "tool_result", tool: name, call_id: callId, ok: true, skipped: "idempotent-skip" })
    };
  }

  idemp.tools.add(callId);

  wo.logging?.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Tool call start",
    details: { tool: name, call_id: callId, args_preview: getPreview(args, ARG_PREVIEW_MAX) }
  });

  if (!tool) {
    return {
      ok: false,
      name,
      call_id: callId,
      content: JSON.stringify({ type: "tool_result", tool: name, call_id: callId, ok: false, error: `Tool "${name}" not found` })
    };
  }

  try {
    try { await putItem(name, "status:tool"); } catch {}
    const res = await tool.invoke(args, coreData);
    const mapped = { type: "tool_result", tool: name, call_id: callId, ok: true, data: (typeof res === "string" ? getJSON(res, res) : res) };
    const content = JSON.stringify(mapped);

    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "Tool call success",
      details: { tool: name, call_id: callId, result_preview: getPreview(content, RESULT_PREVIEW_MAX) }
    });

    return { ok: true, name, call_id: callId, content };
  } catch (e) {
    const mappedErr = { type: "tool_result", tool: name, call_id: callId, ok: false, error: e?.message || String(e) };

    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Tool call error",
      details: { tool: name, call_id: callId, error: String(e?.message || e) }
    });

    return { ok: false, name, call_id: callId, content: JSON.stringify(mappedErr) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData.workingObject.StatusToolClearDelayMs) : 800;
    setTimeout(() => { try { putItem("", "status:tool"); } catch {} }, Math.max(0, delayMs));
  }
}

/********************************************************************************
/* functionSignature: getExtFromMime (m)                                        *
/* Returns a file extension based on MIME type.                                 *
/********************************************************************************/
function getExtFromMime(m) {
  const mime = (m || "").toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("bmp")) return ".bmp";
  if (mime.includes("svg")) return ".svg";
  return ".png";
}

/********************************************************************************
/* functionSignature: getBuildUrl (filename, baseUrl)                           *
/* Builds a public URL for a persisted document.                                *
/********************************************************************************/
function getBuildUrl(filename, baseUrl) {
  const clean = (baseUrl || "").replace(/\/+$/, "");
  return clean ? `${clean}/documents/${filename}` : `/documents/${filename}`;
}

/********************************************************************************
/* functionSignature: setSaveB64 (b64, mime, baseUrl, wo)                       *
/* Persists base64 image and returns hosted URL.                                *
/********************************************************************************/
async function setSaveB64(b64, mime, baseUrl, wo) {
  setEnsureDocDir();
  const idemp = getIdemp(wo);
  const hash = getSha256OfBase64(b64 || "");
  if (idemp.images.has(hash)) return getBuildUrl(`DUP-${hash}.png`, baseUrl);
  idemp.images.add(hash);

  const ext = getExtFromMime(mime || "image/png");
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(DOC_DIR, filename), Buffer.from(b64, "base64"));
  return getBuildUrl(filename, baseUrl);
}

/********************************************************************************
/* functionSignature: getFetch ()                                               *
/* Returns a fetch function (global fetch or node-fetch).                       *
/********************************************************************************/
async function getFetch() {
  if (typeof globalThis.fetch === "function") return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

/********************************************************************************
/* functionSignature: setMirrorURL (url, baseUrl, wo)                           *
/* Downloads a remote image and mirrors it locally.                             *
/********************************************************************************/
async function setMirrorURL(url, baseUrl, wo) {
  setEnsureDocDir();
  const idemp = getIdemp(wo);
  const key = `url:${createHash("sha256").update(url || "").digest("hex")}`;
  if (idemp.images.has(key)) return getBuildUrl(`DUP-${createHash("sha256").update(url).digest("hex")}.png`, baseUrl);
  idemp.images.add(key);

  const f = await getFetch();
  const res = await f(url, { headers: { "User-Agent": "core-ai-responses/1.0" } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const mime = res.headers.get("content-type") || "image/png";
  const ext = getExtFromMime(mime);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(DOC_DIR, filename), buf);
  return getBuildUrl(filename, baseUrl);
}

/********************************************************************************
/* functionSignature: setSaveFromFileId (fileId, opts, wo)                      *
/* Downloads an image via provider fileId and persists it.                      *
/********************************************************************************/
async function setSaveFromFileId(fileId, { baseUrl, apiKey, endpointResponses, endpointFilesContentTemplate }, wo) {
  setEnsureDocDir();
  const idemp = getIdemp(wo);
  const key = `file:${fileId}`;
  if (idemp.images.has(key)) return getBuildUrl(`DUP-${createHash("sha256").update(fileId).digest("hex")}.png`, baseUrl);
  idemp.images.add(key);

  let url = "";
  if (endpointFilesContentTemplate && endpointFilesContentTemplate.includes("{id}")) {
    url = endpointFilesContentTemplate.replace("{id}", encodeURIComponent(fileId));
  } else {
    const base = (endpointResponses || "").replace(/\/responses.*/, "").replace(/\/+$/, "");
    url = `${base}/files/${encodeURIComponent(fileId)}/content`;
  }

  const f = await getFetch();
  const res = await f(url, { method: "GET", headers: { "Authorization": `Bearer ${apiKey}`, "User-Agent": "core-ai-responses/1.0" } });
  if (!res.ok) throw new Error(`File download failed: ${res.status} ${res.statusText}`);

  const mime = res.headers.get("content-type") || "image/png";
  const ext = getExtFromMime(mime);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(DOC_DIR, filename), buf);
  return getBuildUrl(filename, baseUrl);
}

/********************************************************************************
/* functionSignature: getParsedTextFromNode (node)                              *
/* Extracts text from a response content node (supports multiple shapes).       *
/********************************************************************************/
function getParsedTextFromNode(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (typeof node.text?.value === "string") return node.text.value;
  if (typeof node.value === "string" && (node.type === "text" || node.type === "output_text")) return node.value;
  if (typeof node.content === "string" && (node.type === "text" || node.type === "output_text")) return node.content;
  if (typeof node.output_text === "string") return node.output_text;
  return "";
}

/********************************************************************************
/* functionSignature: getParsedResponsesOutput (raw)                            *
/* Extracts text, images, and tool calls from Responses JSON.                   *
/********************************************************************************/
function getParsedResponsesOutput(raw) {
  const out = { text: "", toolCalls: [], images: [] };
  const seen = new WeakSet();

  const textParts = [];
  const toolSeen = new Set();
  const imageSeen = new Set();

  /********************************************************************************
  /* functionSignature: isHttpUrl (u)                                             *
  /* Returns true for http(s) URLs.                                               *
  /********************************************************************************/
  function isHttpUrl(u) { return (typeof u === "string" && /^https?:\/\//i.test(u)); }

  /********************************************************************************
  /* functionSignature: isDataUrl (u)                                             *
  /* Returns true for base64 image data URLs.                                     *
  /********************************************************************************/
  function isDataUrl(u) { return (typeof u === "string" && /^data:image\/[a-z0-9+.\-]+;base64,/i.test(u)); }

  /********************************************************************************
  /* functionSignature: b64FromDataUrl (u)                                        *
  /* Extracts base64 payload from a data URL.                                     *
  /********************************************************************************/
  function b64FromDataUrl(u) { return (typeof u === "string" ? (u.split(",")[1] || "") : ""); }

  /********************************************************************************
  /* functionSignature: getIsImageMime (m)                                        *
  /* Returns true if the given MIME looks like an image MIME.                     *
  /********************************************************************************/
  function getIsImageMime(m) {
    return (typeof m === "string" && m.trim().toLowerCase().startsWith("image/"));
  }

  /********************************************************************************
  /* functionSignature: getIsLikelyImageHttpUrl (u)                               *
  /* Heuristic check for image-like HTTP URLs by file extension.                 *
  /********************************************************************************/
  function getIsLikelyImageHttpUrl(u) {
    const s = String(u || "");
    if (!isHttpUrl(s)) return false;
    const noHash = s.split("#")[0];
    const pathPart = noHash.split("?")[0].toLowerCase();
    return (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(pathPart));
  }

  /********************************************************************************
  /* functionSignature: pushImage (rec)                                           *
  /* Adds a normalized image record with dedupe.                                  *
  /********************************************************************************/
  function pushImage(rec) {
    if (!rec) return;

    const key =
      rec.kind === "url" ? `url:${rec.url}` :
      rec.kind === "file_id" ? `file:${rec.file_id}` :
      rec.kind === "b64" ? `b64:${getSha256OfBase64(rec.b64 || "")}` :
      `other:${getSafeJSONStringify(rec)}`;

    if (imageSeen.has(key)) return;
    imageSeen.add(key);
    out.images.push(rec);
  }

  /********************************************************************************
  /* functionSignature: pushImageUrl (u, mime)                                    *
  /* Pushes an image URL if it is a data URL or looks like an image link.        *
  /********************************************************************************/
  function pushImageUrl(u, mime) {
    if (isDataUrl(u)) {
      pushImage({ kind: "b64", b64: b64FromDataUrl(u), mime: mime || "image/png" });
      return;
    }

    if (!isHttpUrl(u)) return;

    if (getIsImageMime(mime) || getIsLikelyImageHttpUrl(u)) {
      pushImage({ kind: "url", url: u, mime: mime || undefined });
    }
  }

  /********************************************************************************
  /* functionSignature: pushImageB64 (b64, mime)                                  *
  /* Pushes a base64 image record when present.                                   *
  /********************************************************************************/
  function pushImageB64(b64, mime) {
    if (typeof b64 === "string" && b64.length) pushImage({ kind: "b64", b64, mime: mime || "image/png" });
  }

  /********************************************************************************
  /* functionSignature: pushFileId (id, mime)                                     *
  /* Pushes a file_id image record when present.                                  *
  /********************************************************************************/
  function pushFileId(id, mime) {
    if (typeof id === "string" && id.length) pushImage({ kind: "file_id", file_id: id, mime: mime || "image/png" });
  }

  /********************************************************************************
  /* functionSignature: pushToolCall (node, typeHint)                             *
  /* Normalizes and dedupes tool/function calls from output nodes.                *
  /********************************************************************************/
  function pushToolCall(node, typeHint) {
    const name = node?.name || node?.function?.name || node?.tool_name;
    if (!name) return;

    const call_id = node?.call_id || node?.id || node?.tool_call_id || node?.function_call_id || "";
    const args = node?.arguments ?? node?.function?.arguments ?? node?.input ?? {};
    const argsStr = (typeof args === "string") ? args : JSON.stringify(args ?? {});
    const key = `${name}:${call_id}:${argsStr}`;
    if (toolSeen.has(key)) return;
    toolSeen.add(key);

    out.toolCalls.push({
      id: node?.id || call_id,
      call_id: call_id || node?.id,
      type: typeHint || node?.type || "function_call",
      name,
      arguments: argsStr
    });
  }

  /********************************************************************************
  /* functionSignature: crawl (node, inReasoning)                                 *
  /* Recursively walks output payload to collect text/toolcalls/images.           *
  /********************************************************************************/
  function crawl(node, inReasoning) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const t = node.type;
    let reasoningMode = Boolean(inReasoning);
    if (t === "reasoning") reasoningMode = true;

    if (!reasoningMode && (t === "output_text" || t === "text")) {
      const txt = getParsedTextFromNode(node);
      if (typeof txt === "string" && txt.length) textParts.push(txt);
    }

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
        else pushImageUrl(node.result, mime);
      }
      if (typeof node?.url === "string") pushImageUrl(node.url, mime);
      if (node?.file_id) pushFileId(node.file_id, mime);
    }

    if (t === "tool_call" || t === "function_call" || t === "tool_use") pushToolCall(node, t);

    if (Array.isArray(node.content)) node.content.forEach(x => crawl(x, reasoningMode));

    if (!reasoningMode) {
      const txt = getParsedTextFromNode(node);
      if (typeof txt === "string" && txt.length && (t === "message" || t === "output" || t === "assistant" || t === "content")) textParts.push(txt);
    }

    if (Array.isArray(node?.images)) {
      for (const im of node.images) {
        const iu = im?.url || im?.image_url?.url || im?.image_url;
        const ib64 = im?.b64_json || im?.base64;
        const ifid = im?.file_id || im?.image_file?.file_id || im?.asset_pointer?.file_id;
        const mm = im?.mime || im?.mime_type || "image/png";
        if (iu) pushImageUrl(iu, mm);
        if (ib64) pushImageB64(ib64, mm);
        if (ifid) pushFileId(ifid, mm);
      }
    }

    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(x => crawl(x, reasoningMode));
      else if (v && typeof v === "object") crawl(v, reasoningMode);
    }
  }

  const arr = Array.isArray(raw?.output) ? raw.output : (raw ? [raw] : []);
  arr.forEach(x => crawl(x, false));

  out.text = textParts.join("").trim();

  if (!out.text && typeof raw?.output_text === "string" && raw.output_text.trim().length) out.text = raw.output_text.trim();
  if (!out.text && typeof raw?.text === "string" && raw.text.trim().length) out.text = raw.text.trim();
  if (!out.text && Array.isArray(raw?.choices) && raw.choices[0]?.message?.content) out.text = getToString(raw.choices[0].message.content).trim();

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
/* functionSignature: getSanitizeReasoningText (s)                              *
/* Removes API meta-lines (rs_ ids / standalone markers) without harming content.*
/********************************************************************************/
function getSanitizeReasoningText(s) {
  const raw = getToString(s);
  if (!raw.trim()) return "";

  const isRsId = (x) => /^rs_[a-z0-9]{10,}$/i.test(String(x || "").trim());
  const isMetaWord = (x, w) => new RegExp(`^${w}$`, "i").test(String(x || "").trim());

  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "");
    const t = line.trim();
    if (!t.length) continue;

    const prev = i > 0 ? lines[i - 1] : "";
    const next = i + 1 < lines.length ? lines[i + 1] : "";

    if (isRsId(t)) continue;

    const looksLikeMetaContext =
      isRsId(prev) || isRsId(next) ||
      isMetaWord(prev, "reasoning") || isMetaWord(next, "reasoning") ||
      isMetaWord(prev, "summary_text") || isMetaWord(next, "summary_text") ||
      isMetaWord(prev, "summary") || isMetaWord(next, "summary");

    if (looksLikeMetaContext && isMetaWord(t, "reasoning")) continue;
    if (looksLikeMetaContext && isMetaWord(t, "summary_text")) continue;
    if (looksLikeMetaContext && isMetaWord(t, "summary")) continue;

    out.push(line);
  }

  const joined = out.join("\n").trim();
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}

/********************************************************************************
/* functionSignature: getReasoningSummaryFromResponse (data)                    *
/* Extracts reasoning summary text from a Responses payload (robust + dedupe).  *
/********************************************************************************/
function getReasoningSummaryFromResponse(data) {
  const BAD = new Set(["auto", "none", "concise", "detailed", "low", "medium", "high"]);
  const seenObj = new WeakSet();
  const seenText = new Set();
  const out = [];

  /********************************************************************************
  /* functionSignature: norm (s)                                                  *
  /* Normalizes whitespace and line breaks.                                       *
  /********************************************************************************/
  function norm(s) {
    return String(s || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /********************************************************************************
  /* functionSignature: add (s)                                                   *
  /* Adds a candidate reasoning summary chunk if it is valid and new.            *
  /********************************************************************************/
  function add(s) {
    if (typeof s !== "string") return;
    let t = norm(s);
    if (!t.length) return;
    if (BAD.has(t.toLowerCase())) return;

    t = getSanitizeReasoningText(t);
    t = norm(t);
    if (!t.length) return;

    if (seenText.has(t)) return;
    seenText.add(t);
    out.push(t);
  }

  /********************************************************************************
  /* functionSignature: isReasonKey (k)                                           *
  /* Returns true if a key name looks reasoning-related.                          *
  /********************************************************************************/
  function isReasonKey(k) {
    const kk = String(k || "").toLowerCase();
    return kk.includes("summary") || kk.includes("reason") || kk.includes("explain") || kk === "text";
  }

  /********************************************************************************
  /* functionSignature: walk (node, keyHint)                                      *
  /* Walks objects to find reasoning/summary fields while avoiding input echoes. *
  /********************************************************************************/
  function walk(node, keyHint) {
    const hint = getToString(keyHint);

    if (node == null) return;

    if (typeof node === "string") {
      if (isReasonKey(hint)) add(node);
      return;
    }

    if (typeof node !== "object") return;
    if (seenObj.has(node)) return;
    seenObj.add(node);

    if (Array.isArray(node)) {
      for (const x of node) walk(x, hint);
      return;
    }

    const t = String(node?.type || "").toLowerCase();
    const isReasonNode = (t === "reasoning");

    if (typeof node.summary_text === "string") add(node.summary_text);
    if (typeof node.summary === "string") add(node.summary);
    if (typeof node.explanation === "string") add(node.explanation);
    if (typeof node.text === "string" && (isReasonNode || isReasonKey(hint))) add(node.text);

    for (const [k, v] of Object.entries(node)) {
      if (k === "input") continue;
      if (k === "instructions") continue;
      if (!isReasonNode && !isReasonKey(k) && !isReasonKey(hint)) continue;
      walk(v, k);
    }
  }

  try {
    if (data?.reasoning) walk(data.reasoning, "reasoning");

    const output = Array.isArray(data?.output) ? data.output : [];
    for (const item of output) {
      if (item && typeof item === "object" && String(item.type || "").toLowerCase() === "reasoning") walk(item, "reasoning");
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const c of content) {
        if (c && typeof c === "object" && String(c.type || "").toLowerCase() === "reasoning") walk(c, "reasoning");
      }
    }

    const joined = out.join("\n\n").trim();
    return joined.length ? joined : null;
  } catch {
    return null;
  }
}

/********************************************************************************
/* functionSignature: getPayload (row)                                          *
/* Extracts the text payload from a history row (prefers parsed message text).  *
/********************************************************************************/
function getPayload(row) {
  const j = (typeof row?.json === "string" && row.json.trim().length) ? row.json.trim() : "";
  if (j) {
    const obj = getJSON(j, null);
    if (obj && typeof obj === "object") {
      if (typeof obj.content === "string" && obj.content.length) return obj.content;
      if (typeof obj.text === "string" && obj.text.length) return obj.text;
      if (obj.object === "response" && Array.isArray(obj.output)) {
        const parsed = getParsedResponsesOutput(obj);
        if (typeof parsed?.text === "string" && parsed.text.length) return parsed.text;
        return "";
      }
    }
    return j;
  }
  if (typeof row?.content === "string" && row.content.length) return row.content;
  if (typeof row?.text === "string" && row.text.length) return row.text;
  return "";
}

/********************************************************************************
/* functionSignature: getSnapshotMappedToChat (rows)                            *
/* Maps stored snapshot rows to chat-style messages.                            *
/********************************************************************************/
function getSnapshotMappedToChat(rows) {
  const out = [];
  for (const r of rows || []) {
    const role = r?.role;
    const payload = getPayload(r);
    if (role === "system") out.push({ role: "system", content: payload });
    else if (role === "user") out.push({ role: "user", content: payload });
    else if (role === "assistant") out.push({ role: "assistant", content: payload });
  }
  return out;
}

/********************************************************************************
/* functionSignature: getResponsesInputFromMessages (messages)                  *
/* Converts chat messages to Responses API input format.                        *
/********************************************************************************/
function getResponsesInputFromMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m && typeof m === "object" && typeof m.type === "string" && !("role" in m)) { out.push(m); continue; }
    const role = m.role;
    const type = (role === "assistant") ? "output_text" : "input_text";
    const text = getToString(m.content ?? "");
    out.push({ role, content: [{ type, text }] });
  }
  return out;
}

/********************************************************************************
/* functionSignature: setAppendReasoningBlock (reasoningParts, iter, rs, tools) *
/* Appends an iteration reasoning block, with tool names if present.            *
/********************************************************************************/
function setAppendReasoningBlock(reasoningParts, iter, rs, toolCalls) {
  const toolNames = Array.isArray(toolCalls) ? toolCalls.map(t => t?.name).filter(Boolean) : [];
  const header = `--- Iteration ${iter + 1}${toolNames.length ? ` (tools: ${toolNames.join(", ")})` : ""} ---`;
  const body = (typeof rs === "string" && rs.trim().length) ? rs.trim() : "";
  reasoningParts.push(`${header}\n${body}`.trimEnd());
  return true;
}

/********************************************************************************
/* functionSignature: getToolsDisabledMode (totalToolCalls, maxToolCalls, wo)   *
/* Returns true when the final synthesis run must be executed without tools.    *
/********************************************************************************/
function getToolsDisabledMode(totalToolCalls, maxToolCalls, wo) {
  if (wo?.__forceNoTools === true) return true;
  if (Number.isFinite(maxToolCalls) && maxToolCalls >= 0 && totalToolCalls >= maxToolCalls) return true;
  return false;
}

/********************************************************************************
/* functionSignature: setEnsureFinalSynthesisPrompt (messages, wo)              *
/* Ensures a single prompt is injected to force synthesis without tools.        *
/********************************************************************************/
function setEnsureFinalSynthesisPrompt(messages, wo) {
  if (wo?.__didToolBudgetNotice === true) return false;
  wo.__didToolBudgetNotice = true;
  messages.push({
    role: "user",
    content: "Tool-call budget exhausted. Provide the best possible final answer using only the existing conversation and prior tool outputs. Do not request or call any tools."
  });
  return true;
}

/********************************************************************************
/* functionSignature: getCoreAi (coreData)                                      *
/* Runs the Responses workflow end-to-end.                                      *
/********************************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData?.workingObject ?? {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const gate = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  if (gate && gate !== "responses") {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "skipped", message: `Skipped: useAIModule="${gate}" != "responses"` });
    return coreData;
  }

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

  const reasoningEffort = getReasoningEffort(wo);
  const reasoningEnabled = (typeof reasoningEffort === "string" && reasoningEffort.length > 0);

  if (!endpoint || !apiKey || !model) {
    wo.Response = "[Empty AI response]";
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Missing required: ${!endpoint ? "EndpointResponses " : ""}${!apiKey ? "APIKey " : ""}${!model ? "Model" : ""}`.trim()
    });
    return coreData;
  }

  const responseToolsNormalized = getNormalizedResponseTools(getResponseToolsRaw(wo));
  const responseToolsInfo = responseToolsNormalized.length ? responseToolsNormalized.map(x => x?.type).filter(Boolean).join(", ") : "(none)";

  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `Using BaseURL="${baseUrl || "(relative /documents)"}"` });
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `Responses built-in tools (workingObject.ResponseTools): ${responseToolsInfo}` });

  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch (e) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` }); }

/********************************************************************************
/* functionSignature: getSystemContent (wo2)                                    *
/* Builds system prompt content with runtime hints and policy lines.            *
/********************************************************************************/
  function getSystemContent(wo2) {
    const nowIso = new Date().toISOString();
    const tz = getStr(wo2?.timezone, "Europe/Berlin");
    const base = [typeof wo2.SystemPrompt === "string" ? wo2.SystemPrompt.trim() : "", typeof wo2.Instructions === "string" ? wo2.Instructions.trim() : ""].filter(Boolean).join("\n\n");

    const runtimeInfo = [
      "Runtime info:",
      `- current_time_iso: ${nowIso}`,
      `- timezone_hint: ${tz}`,
      "- When the user uses relative time terms (e.g., today, tomorrow), interpret them relative to current_time_iso unless another explicit reference time is provided.",
      "- If you generate calendar-like text, prefer explicit dates (YYYY-MM-DD) when helpful."
    ].join("\n");

    const policy = [
      "Policy:",
      "- NEVER ANSWER TO OLDER USER REQUESTS",
      "- Use tools only when necessary.",
      "- When you emit a tool call, do not include extra prose in the same turn.",
      "- ALWAYS answer in human readable plain text, unless explicitly told to use a different format.",
      "- NEVER answer with JSON unless explicitly asked. Do not imitate JSON-like formats from context."
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

  const toolChoiceInitial = getNormalizedToolChoice(wo?.ToolChoice) || "auto";
  const persistQueue = [];

  let finalText = "";
  let accumulatedText = "";
  let allHostedLinks = [];

  const reasoningParts = [];

  let totalToolCalls = 0;
  let attempts = 0;
  const maxAttempts = Math.max(1, getNum(wo?.MaxAttempts, Math.min(3, maxLoops)));

  for (let iter = 0; iter < maxLoops; iter++) {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      setLogConsole(`iteration-${iter + 1}-messages-before-request`, { count: messages.length, messages });

      const toolsDisabled = getToolsDisabledMode(totalToolCalls, maxToolCalls, wo);
      const toolsForResponses = getToolsForResponses(toolDefs, responseToolsNormalized, toolsDisabled);

      const body = {
        model,
        input: getResponsesInputFromMessages(messages),
        instructions: sys,
        tools: toolsForResponses,
        tool_choice: toolsDisabled ? "none" : toolChoiceInitial,
        ...(reasoningEnabled ? { reasoning: { effort: reasoningEffort, summary: "auto" } } : {}),
        ...(maxTokens ? { max_output_tokens: maxTokens } : {})
      };

      setLogBig("responses-request-body", { endpoint, model, tool_choice: body.tool_choice, tools: body.tools, input: body.input, instructions: body.instructions, reasoning: body.reasoning }, { toFile: debugOn });

      const f = await getFetch();
      const res = await f(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
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

      if (reasoningEnabled) {
        const iterReasoningSummary = getReasoningSummaryFromResponse(data);
        setAppendReasoningBlock(reasoningParts, iter, iterReasoningSummary, parsed?.toolCalls);
        if (!iterReasoningSummary) wo.logging?.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `Reasoning summary requested but none found in iteration ${iter + 1}.` });
      }

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
        wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "No images parsed from response." });
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

      if (!toolsDisabled) {
        let ranAnyTool = false;

        if (hasToolCalls && genericTools.length && totalToolCalls < maxToolCalls) {
          wo._fullAssistantText = accumulatedText || assistantText || "";

          for (const tc of toolCalls) {
            const isGeneric = toolDefs.some(d => d?.name === tc?.name);
            if (!isGeneric) continue;
            if (totalToolCalls >= maxToolCalls) break;

            const call_id = tc?.call_id || tc?.id || `${tc?.name || "tool"}:${createHash("sha256").update(getToString(tc?.arguments ?? "")).digest("hex")}`;
            const callArgsStr = (typeof tc?.arguments === "string") ? tc.arguments : JSON.stringify(tc?.arguments ?? {});
            messages.push({ type: "function_call", call_id, name: tc?.name, arguments: callArgsStr });

            const result = await setExecGenericTool(genericTools, { ...tc, call_id, arguments: callArgsStr }, coreData);
            totalToolCalls++;
            ranAnyTool = true;

            const outputStr = getToString(result?.content ?? "");
            messages.push({ type: "function_call_output", call_id, output: outputStr });
          }

          wo._fullAssistantText = undefined;
          if (ranAnyTool) continue;
        }

        if (hasToolCalls && totalToolCalls >= maxToolCalls) {
          wo.__forceNoTools = true;
          setEnsureFinalSynthesisPrompt(messages, wo);
          continue;
        }
      }

      if (toolsDisabled && hasToolCalls) {
        wo.logging?.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "Tools disabled mode active; ignoring any tool-call requests in output." });
      }

      const truncated = getWasTruncatedOutput(data);
      if (truncated) {
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue;
      }

      const primaryText = [(accumulatedText || assistantText || "")].filter(Boolean).join("\n\n");
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

  if (reasoningEnabled) {
    const joined = getSanitizeReasoningText(reasoningParts.join("\n\n")).trim();
    wo.ReasoningSummary = joined.length ? joined : null;
  } else {
    wo.ReasoningSummary = undefined;
  }

  if (!skipContextWrites) {
    for (const turn of persistQueue) {
      try { await setContext(wo, turn); }
      catch (e) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `Persist failed (role=${turn.role}): ${e?.message || String(e)}` }); }
    }
  } else {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: `doNotWriteToContext=true → skipped persistence of ${persistQueue.length} turn(s)` });
  }

  setLogBig("responses-final", { finalTextPreview: getPreview(finalText, 400), queuedTurns: persistQueue.length, reasoningSummaryPreview: getPreview(getToString(wo?.ReasoningSummary ?? ""), 400) }, { toFile: debugOn });

  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });

  return coreData;
}
