/**************************************************************/
/* filename: "01001-core-ai-responses.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/












import { getContext } from "../core/context.js";
import { putItem, getItem, deleteItem } from "../core/registry.js";
import { saveFile } from "../core/file.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const _manifestDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../manifests");

const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;
const MODULE_NAME = "core-ai-responses";
const DEBUG_DIR = path.resolve("./pub/debug");


function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


function getToString(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }


function getStr(v, d) { return (typeof v === "string" && v.length) ? v : d; }


function getNum(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }


function getJSON(t, f = null) { try { return JSON.parse(t); } catch { return f; } }


function getWithTurnId(rec, wo) { const t = (typeof wo?.turnId === "string" && wo.turnId) ? wo.turnId : undefined; const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined; return { ...(t ? { ...rec, turnId: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() }; }


function getPreview(s, n = 400) { const t = getToString(s); return t.length > n ? t.slice(0, n) + " …[truncated]" : t; }


function getToolStatusScope(wo) {
  const explicit =
    String(wo?.toolcallScope ?? wo?.toolStatusScope ?? wo?.statusScope ?? "").trim();
  if (explicit) return explicit;
  const callerFlow = String(wo?.callerFlow || "").trim();
  if (callerFlow) return callerFlow;
  return String(wo?.flow || "").trim();
}


function getParseArtifactsBlock(text) {
  const s = String(text || "");
  const marker = "\nARTIFACTS:\n";
  const idx = s.indexOf(marker);
  if (idx === -1) return { primaryImageUrl: null };

  const lines = s.slice(idx + marker.length).split("\n");
  for (const line of lines) {
    if (!line.trim()) break;
    const m = /^[a-z_]+:\s*(https?:\/\/\S+)/i.exec(line.trim());
    if (m) return { primaryImageUrl: m[1] };
  }

  return { primaryImageUrl: null };
}


function getLooksBase64(s) { return typeof s === "string" && s.length > 32 && /^[A-Za-z0-9+/=\r\n]+$/.test(s); }


function setEnsureDir(dirPath) {
  const p = getToString(dirPath);
  if (!p.length) return;
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}


function setEnsureDebugDir() { setEnsureDir(DEBUG_DIR); }



function getSafeJSONStringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return String(obj); } }


function setRedactSecrets(s) {
  s = (typeof s === "string") ? s : String(s);
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\-\/=]+/gi, "$1***REDACTED***");
  s = s.replace(/("Authorization"\s*:\s*")Bearer\s+[^"]+(")/gi, "$1Bearer ***REDACTED***$2");
  s = s.replace(/(["']?(?:api[-_\s]?key|token|secret)["']?\s*:\s*")([^"]+)(")/gi, "$1***REDACTED***$3");
  return s;
}


function getApproxBase64Bytes(b64) {
  const s = (typeof b64 === "string") ? b64 : "";
  const pads = s.endsWith("==") ? 2 : (s.endsWith("=") ? 1 : 0);
  return Math.max(0, Math.floor(s.length * 0.75) - pads);
}


function getSha256OfBase64(b64) { try { return createHash("sha256").update(Buffer.from(b64 || "", "base64")).digest("hex"); } catch { return "n/a"; } }


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


function setLogConsole(_label, _data) {}


function getIdemp(wo) { if (!wo.__idemp) wo.__idemp = { tools: new Set(), images: new Set() }; return wo.__idemp; }


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


function getNormalizedToolChoice(tc) {
  if (!tc || tc === "auto" || tc === "none") return tc || "auto";
  if (tc?.type === "function" && tc?.name) return tc;
  if (tc?.type === "function" && tc?.function?.name) return { type: "function", name: tc.function.name };
  return "auto";
}


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


function getResponseToolsRaw(wo) {
  if (Array.isArray(wo?.responseTools)) return wo.responseTools;
  return [];
}


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


function getToolsForResponses(toolDefs, responseTools, toolsDisabled) {
  if (toolsDisabled) return [];
  const out = [];
  for (const d of (responseTools || [])) out.push(d);
  for (const d of (toolDefs || [])) out.push(d);
  return out;
}


function getRuntimeContextFromLast(wo, snapshot) {
  if (wo?.includeRuntimeContext !== true) return null;
  const last = Array.isArray(snapshot) && snapshot.length ? { ...snapshot[snapshot.length - 1] } : null;
  if (last && "content" in last) delete last.content;
  const metadata = {
    id: String(wo?.channelID ?? ""),
    flow: String(wo?.flow ?? ""),
    clientRef: String(wo?.clientRef ?? ""),
    model: String(wo?.model ?? ""),
    tool_choice: (wo?.toolChoice ?? "auto"),
    timezone: String(wo?.timezone ?? "Europe/Berlin")
  };
  return { metadata, last };
}


function getAppendRuntimeContextToUserContent(baseText, ctx) {
  if (!ctx) return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(ctx) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}


function getManifestDef(name, logFn) {
  try {
    const raw = fs.readFileSync(path.join(_manifestDir, `${name}.json`), "utf8");
    const fn = JSON.parse(raw);
    if (fn && typeof fn === "object" && fn.name && fn.description && fn.parameters) {
      return { type: "function", function: fn };
    }
  } catch {}
  if (logFn) logFn(`Tool "${name}" has no manifest in manifests/ — it will not be advertised to the AI.`, "warn");
  return null;
}


async function getToolsByName(names, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      if (tool && typeof tool.invoke === "function") {
        const manifestDef = getManifestDef(name, log);
        loaded.push({ ...tool, definition: manifestDef || undefined });
      } else {
        log(`Tool "${name}" invalid (missing invoke); skipped.`, "warn");
      }
    } catch (e) {
      log(`Tool "${name}" load failed: ${e?.message || String(e)}`, "warn");
    }
  }
  return loaded;
}


function getExpandedToolArgs(args, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  const full = typeof wo?._fullAssistantText === "string" ? wo._fullAssistantText : "";
  if (!full || !args || typeof args !== "object") return args;
  const candidateKeys = ["body", "content", "text", "message"];
  for (const key of candidateKeys) {
    const v = args[key];
    if (typeof v === "string" && v.length && full.length > v.length && full.includes(v)) {
      log(`Expanded tool argument "${key}" to full assistant text.`, "info", { original_length: v.length, full_length: full.length });
      return { ...args, [key]: full };
    }
  }
  return args;
}


async function setExecGenericTool(toolModules, call, coreData) {
  const wo = coreData?.workingObject ?? {};
  const log = getPrefixedLogger(wo, import.meta.url);
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

  log("Tool call start", "info", { tool: name, call_id: callId, args_preview: getPreview(args, ARG_PREVIEW_MAX) });

  if (!tool) {
    return {
      ok: false,
      name,
      call_id: callId,
      content: JSON.stringify({ type: "tool_result", tool: name, call_id: callId, ok: false, error: `Tool "${name}" not found` })
    };
  }

  const _tcCh = String(coreData?.workingObject?.channelID ?? "").trim();
  const _callerCh = String(coreData?.workingObject?.callerChannelId ?? "").trim();
  const _statusScope = getToolStatusScope(coreData?.workingObject || {});
  if (!Number.isFinite(wo._statusToolGen)) wo._statusToolGen = 0;
  const _myGen = ++wo._statusToolGen;
  const _statusToken = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const _statusChannelId = String(
    coreData?.workingObject?.callerChannelId ||
    coreData?.workingObject?.channelID ||
    ""
  ).trim();
  const _statusPayload = {
    name,
    flow: String(coreData?.workingObject?.flow || ""),
    scope: _statusScope,
    token: _statusToken,
    channelId: _statusChannelId
  };
  try {
    try { await putItem(_statusPayload, "status:tool"); } catch {}
    if (_tcCh) try { await putItem({ name, token: _statusToken }, "status:tool:" + _tcCh); } catch {}
    if (_callerCh && _callerCh !== _tcCh) try { await putItem({ name, token: _statusToken }, "status:tool:" + _callerCh); } catch {}
    const res = await tool.invoke(args, coreData);
    const mapped = { type: "tool_result", tool: name, call_id: callId, ok: true, data: (typeof res === "string" ? getJSON(res, res) : res) };
    const content = JSON.stringify(mapped);

    log("Tool call success", "info", { tool: name, call_id: callId, result_preview: getPreview(content, RESULT_PREVIEW_MAX) });

    return { ok: true, name, call_id: callId, content };
  } catch (e) {
    const mappedErr = { type: "tool_result", tool: name, call_id: callId, ok: false, error: e?.message || String(e) };

    log("Tool call error", "error", { tool: name, call_id: callId, error: String(e?.message || e) });

    return { ok: false, name, call_id: callId, content: JSON.stringify(mappedErr) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData.workingObject.StatusToolClearDelayMs) : 800;
    setTimeout(() => {
      if (wo._statusToolGen !== _myGen) return;
      try {
        const current = getItem("status:tool");
        if (current?.token === _statusToken) deleteItem("status:tool");
      } catch {}
      if (_tcCh) {
        try {
          const current = getItem("status:tool:" + _tcCh);
          if (current?.token === _statusToken) deleteItem("status:tool:" + _tcCh);
        } catch {}
      }
      if (_callerCh && _callerCh !== _tcCh) {
        try {
          const current = getItem("status:tool:" + _callerCh);
          if (current?.token === _statusToken) deleteItem("status:tool:" + _callerCh);
        } catch {}
      }
    }, Math.max(0, delayMs));
  }
}


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


function getBuildUrl(filename, baseUrl) {
  const clean = (baseUrl || "").replace(/\/+$/, "");
  return clean ? `${clean}/documents/${filename}` : `/documents/${filename}`;
}


async function setSaveB64(b64, mime, baseUrl, wo) {
  const idemp = getIdemp(wo);
  const hash = getSha256OfBase64(b64 || "");
  if (idemp.images.has(hash)) return getBuildUrl(`DUP-${hash}.png`, baseUrl);
  idemp.images.add(hash);

  const ext = getExtFromMime(mime || "image/png");
  const saved = await saveFile(wo, Buffer.from(b64, "base64"), { prefix: "img", ext, publicBaseUrl: baseUrl });
  return saved.url;
}


async function getFetch() {
  if (typeof globalThis.fetch === "function") return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}


async function setMirrorURL(url, baseUrl, wo) {
  const idemp = getIdemp(wo);
  const key = `url:${createHash("sha256").update(url || "").digest("hex")}`;
  if (idemp.images.has(key)) return getBuildUrl(`DUP-${createHash("sha256").update(url).digest("hex")}.png`, baseUrl);
  idemp.images.add(key);

  const f = await getFetch();
  const res = await f(url, { headers: { "User-Agent": "core-ai-responses/1.0" } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const mime = res.headers.get("content-type") || "image/png";
  const ext = getExtFromMime(mime);
  const buf = Buffer.from(await res.arrayBuffer());
  const saved = await saveFile(wo, buf, { prefix: "img", ext, publicBaseUrl: baseUrl });
  return saved.url;
}


async function setSaveFromFileId(fileId, { baseUrl, apiKey, endpointResponses, endpointFilesContentTemplate }, wo) {
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
  const buf = Buffer.from(await res.arrayBuffer());
  const saved = await saveFile(wo, buf, { prefix: "img", ext, publicBaseUrl: baseUrl });
  return saved.url;
}


function getParsedTextFromNode(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (typeof node.text?.value === "string") return node.text.value;
  if (typeof node.value === "string" && (node.type === "text" || node.type === "output_text")) return node.value;
  if (typeof node.content === "string" && (node.type === "text" || node.type === "output_text")) return node.content;
  if (typeof node.output_text === "string") return node.output_text;
  return "";
}


function getParsedResponsesOutput(raw) {
  const out = { text: "", toolCalls: [], images: [] };
  const seen = new WeakSet();

  const textParts = [];
  const toolSeen = new Set();
  const imageSeen = new Set();


  function isHttpUrl(u) { return (typeof u === "string" && /^https?:\/\//i.test(u)); }


  function isDataUrl(u) { return (typeof u === "string" && /^data:image\/[a-z0-9+.\-]+;base64,/i.test(u)); }


  function b64FromDataUrl(u) { return (typeof u === "string" ? (u.split(",")[1] || "") : ""); }


  function getIsImageMime(m) {
    return (typeof m === "string" && m.trim().toLowerCase().startsWith("image/"));
  }


  function getIsLikelyImageHttpUrl(u) {
    const s = String(u || "");
    if (!isHttpUrl(s)) return false;
    const noHash = s.split("#")[0];
    const pathPart = noHash.split("?")[0].toLowerCase();
    return (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(pathPart));
  }


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


  function pushImageB64(b64, mime) {
    if (typeof b64 === "string" && b64.length) pushImage({ kind: "b64", b64, mime: mime || "image/png" });
  }


  function pushFileId(id, mime) {
    if (typeof id === "string" && id.length) pushImage({ kind: "file_id", file_id: id, mime: mime || "image/png" });
  }


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


function getLooksCutOff(text) {
  const s = String(text ?? "").trimEnd();
  if (!s) return false;
  const last = s[s.length - 1];
  return !/[.!?:;*"»)\]}>~`]/.test(last);
}


function getFinishReasonFromData(data) {
  try {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    for (const m of outputs) {
      const content = Array.isArray(m?.content) ? m.content : [];
      for (const c of content) { if (c?.finish_reason) return c.finish_reason; }
    }
  } catch {}
  return null;
}


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


function getReasoningSummaryFromResponse(data) {
  const BAD = new Set(["auto", "none", "concise", "detailed", "low", "medium", "high"]);
  const seenObj = new WeakSet();
  const seenText = new Set();
  const out = [];


  function norm(s) {
    return String(s || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }


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


  function isReasonKey(k) {
    const kk = String(k || "").toLowerCase();
    return kk.includes("summary") || kk.includes("reason") || kk.includes("explain") || kk === "text";
  }


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


function getSnapshotMappedToChat(rows, options = {}) {
  const out = [];
  const includeSystem = getBool(options?.includeHistorySystemMessages, false);
  let lastAssistantCallIds = new Set();
  for (const r of rows || []) {
    const role = r?.role;
    const payload = getPayload(r);
    if (role === "system") {
      if (includeSystem) out.push({ role: "system", content: payload });
    }
    else if (role === "user") {
      out.push({ role: "user", content: payload });
      lastAssistantCallIds = new Set();
    } else if (role === "assistant") {
      const msg = { role: "assistant", content: payload };
      if (Array.isArray(r?.tool_calls) && r.tool_calls.length) {
        msg.tool_calls = r.tool_calls
          .map((tc) => ({
            id: tc?.id,
            type: "function",
            function: {
              name: tc?.function?.name,
              arguments: typeof tc?.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc?.function?.arguments ?? {})
            }
          }))
          .filter((tc) => tc.id && tc?.function?.name);
        lastAssistantCallIds = new Set(msg.tool_calls.map((tc) => tc.id));
      } else {
        lastAssistantCallIds = new Set();
      }
      out.push(msg);
    } else if (role === "tool") {
      const tcid = String(r?.tool_call_id || "").trim();
      if (!tcid || !lastAssistantCallIds.has(tcid)) continue;
      out.push({
        role: "tool",
        tool_call_id: tcid,
        name: String(r?.name || ""),
        content: typeof r?.content === "string" ? r.content : JSON.stringify(r?.content ?? "")
      });
    }
  }
  return out;
}


function getResponsesInputFromMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m && typeof m === "object" && typeof m.type === "string" && !("role" in m)) { out.push(m); continue; }
    const role = m.role;
    if (role === "assistant" && Array.isArray(m?.tool_calls) && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        const callId = String(tc?.id || "").trim();
        const name = String(tc?.function?.name || tc?.name || "").trim();
        if (!callId || !name) continue;
        const args = typeof tc?.function?.arguments === "string"
          ? tc.function.arguments
          : JSON.stringify(tc?.function?.arguments ?? {});
        out.push({ type: "function_call", call_id: callId, name, arguments: args });
      }
      const assistantText = getToString(m?.content ?? "").trim();
      if (assistantText.length) {
        out.push({ role: "assistant", content: [{ type: "output_text", text: assistantText }] });
      }
      continue;
    }
    if (role === "tool") {
      const callId = String(m?.tool_call_id || m?.id || "").trim();
      if (!callId) continue;
      out.push({
        type: "function_call_output",
        call_id: callId,
        output: getToString(m?.content ?? "")
      });
      continue;
    }
    const type = (role === "assistant") ? "output_text" : "input_text";
    const text = getToString(m.content ?? "");
    out.push({ role, content: [{ type, text }] });
  }
  return out;
}


function setAppendReasoningBlock(reasoningParts, iter, rs, toolCalls) {
  const toolNames = Array.isArray(toolCalls) ? toolCalls.map(t => t?.name).filter(Boolean) : [];
  const header = `--- Iteration ${iter + 1}${toolNames.length ? ` (tools: ${toolNames.join(", ")})` : ""} ---`;
  const body = (typeof rs === "string" && rs.trim().length) ? rs.trim() : "";
  reasoningParts.push(`${header}\n${body}`.trimEnd());
  return true;
}


function getToolsDisabledMode(totalToolCalls, maxToolCalls, wo) {
  if (wo?.__forceNoTools === true) return true;
  if (Number.isFinite(maxToolCalls) && maxToolCalls >= 0 && totalToolCalls >= maxToolCalls) return true;
  return false;
}

function getLimitNotice(kind) {
  if (kind === "tool") {
    return "Tool budget reached. This is the partial result so far. Start a new AI run if you want me to continue the deep dive.";
  }
  if (kind === "loop") {
    return "Loop limit reached. This is the partial result so far. Start a new AI run if you want me to continue from here.";
  }
  return "";
}


function setEnsureFinalSynthesisPrompt(messages, wo) {
  if (wo?.__didToolBudgetNotice === true) return false;
  wo.__didToolBudgetNotice = true;
  messages.push({
    role: "user",
    content: "Tool-call budget exhausted. Provide the best possible final answer using only the existing conversation and prior tool outputs. Do not request or call any tools."
  });
  return true;
}


export default async function getCoreAi(coreData) {
  const wo = coreData?.workingObject ?? {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const gate = String(wo?.useAiModule ?? wo?.useAiModule ?? "").trim().toLowerCase();
  if (gate && gate !== "responses") {
    log(`Skipped: useAiModule="${gate}" != "responses"`, "info");
    return coreData;
  }

  if (wo.skipAiCompletions === true) {
    log("Skipped: skipAiCompletions flag set", "info");
    return coreData;
  }

  const endpoint = getStr(wo?.endpointResponses, "");
  const apiKey = await getSecret(wo, getStr(wo?.apiKey, ""));
  const model = getStr(wo?.model, "");
  const baseUrl = getStr(wo?.baseUrl, "");
  const endpointFilesContentTemplate = getStr(wo?.EndpointFilesContent, "");
  const maxTokens = getNum(wo?.maxTokens, 2000);
  const maxLoops = getNum(wo?.maxLoops, 16);
  const maxToolCalls = getNum(wo?.maxToolCalls, 8);
  const timeoutMs = getNum(wo?.requestTimeoutMs, 120000);
  const debugOn = Boolean(wo?.DebugPayload ?? process.env.AI_DEBUG);

  const reasoningEffort = getReasoningEffort(wo);
  const reasoningEnabled = (typeof reasoningEffort === "string" && reasoningEffort.length > 0);

  if (!endpoint || !apiKey || !model) {
    wo.response = "[Empty AI response]";
    log(`Missing required: ${!endpoint ? "endpointResponses " : ""}${!apiKey ? "apiKey " : ""}${!model ? "model" : ""}`.trim(), "error");
    return coreData;
  }

  const responseToolsNormalized = getNormalizedResponseTools(getResponseToolsRaw(wo));
  const includeHistorySystemMessages = getBool(wo?.includeHistorySystemMessages, false);
  const responseToolsInfo = responseToolsNormalized.length ? responseToolsNormalized.map(x => x?.type).filter(Boolean).join(", ") : "(none)";

  log(`Using baseUrl="${baseUrl || "(relative /documents)"}"`, "info");
  log(`Responses built-in tools (workingObject.responseTools): ${responseToolsInfo}`, "info");

  let snapshot = [];
  if (Array.isArray(wo._contextSnapshot)) {
    snapshot = wo._contextSnapshot;
  } else {
    try { snapshot = await getContext(wo); }
    catch (e) { log(`getContext failed; continuing: ${e?.message || String(e)}`, "warn"); }
  }


  function getSystemContent(wo2) {
    const nowIso = new Date().toISOString();
    const tz = getStr(wo2?.timezone, "Europe/Berlin");
    const base = [
      typeof wo2.systemPrompt === "string" ? wo2.systemPrompt.trim() : "",
      typeof wo2.persona === "string" ? wo2.persona.trim() : "",
      typeof wo2.instructions === "string" ? wo2.instructions.trim() : ""
    ].filter(Boolean).join("\n\n");

    const runtimeInfo = [
      "Runtime info:",
      `- current_time_iso: ${nowIso}`,
      `- timezone_hint: ${tz}`,
      "- When the user uses relative time terms (e.g., today, tomorrow), interpret them relative to current_time_iso unless another explicit reference time is provided.",
      "- If you generate calendar-like text, prefer explicit dates (YYYY-MM-DD) when helpful."
    ].join("\n");

    const moduleCfg = coreData.config?.[MODULE_NAME] || {};
    const policy = getStr(wo2?.policyPrompt, "") || getStr(moduleCfg?.policyPrompt, "");

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
  const fromDb = getSnapshotMappedToChat(Array.isArray(snapshot) ? snapshot : [], { includeHistorySystemMessages });
  const userPayloadRaw = getToString(wo?.payload ?? "");
  if (!userPayloadRaw.trim()) {
    log("Skipped: empty payload", "info");
    return coreData;
  }
  const runtimeCtx = getRuntimeContextFromLast(wo, snapshot);
  const userContent = getAppendRuntimeContextToUserContent(userPayloadRaw, runtimeCtx);

  let messages = [{ role: "system", content: sys }, ...fromDb, ...(userPayloadRaw ? [{ role: "user", content: userContent }] : [])];

  setLogConsole("request-messages-initial", { count: messages.length, messages });
  if (runtimeCtx) setLogConsole("runtime-context", runtimeCtx);

  const toolNames = Array.isArray(wo?.tools) ? wo.tools : [];
  const genericTools = await getToolsByName(toolNames, wo);
  const toolDefs = getNormalizedToolDefs(genericTools.map(t => t.definition).filter(Boolean));

  const toolChoiceInitial = getNormalizedToolChoice(wo?.toolChoice) || "auto";
  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];

  let finalText = "";
  let accumulatedText = "";
  let allHostedLinks = [];

  const reasoningParts = [];
  const subagentLog = [];
  const toolCallLog = [];

  let totalToolCalls = 0;
  let attempts = 0;
  const maxAttempts = Math.max(1, getNum(wo?.MaxAttempts, Math.min(3, maxLoops)));
  let hitMaxLoops = false;
  let hitMaxToolCalls = false;
  



  let emptyOutputConsec = 0;

  for (let iter = 0; iter < maxLoops; iter++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }
    attempts++;

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

      const res = await fetchWithTimeout(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body) }, timeoutMs);

      const rawText = await res.text();
      const hdr = {}; try { res.headers?.forEach?.((v, k) => { hdr[k] = v; }); } catch {}
      const RAW_MAX = 8000;

      setLogBig("responses-status", { status: res.status, statusText: res.statusText }, { toFile: debugOn });
      setLogBig("responses-headers", hdr, { toFile: debugOn });
      setLogBig("responses-payload-raw", rawText.length > RAW_MAX ? rawText.slice(0, RAW_MAX) + ` …[+${rawText.length - RAW_MAX} chars truncated]` : rawText, { toFile: debugOn });

      if (!res.ok) {
        const retryable = (res.status >= 500 && res.status <= 599) || res.status === 429;
        if (retryable && attempts < maxAttempts) { log(`Retrying due to HTTP ${res.status}`, "warn"); continue; }
        wo.response = "[Empty AI response]";
        log(`HTTP ${res.status} ${res.statusText}`, "warn");
        return coreData;
      }

      const data = getJSON(rawText, {});
      setLogBig("responses-payload-json", data, { toFile: debugOn });

      const parsed = getParsedResponsesOutput(data);

      if (reasoningEnabled) {
        const iterReasoningSummary = getReasoningSummaryFromResponse(data);
        setAppendReasoningBlock(reasoningParts, iter, iterReasoningSummary, parsed?.toolCalls);
        if (!iterReasoningSummary) log(`Reasoning summary requested but none found in iteration ${iter + 1}.`, "info");
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
            log(`Image persist failed: ${e?.message || String(e)}`, "warn");
          }
        }
      } else {
        log("No images parsed from response.", "info");
      }

      if (hostedLinks.length) allHostedLinks.push(...hostedLinks);

      setLogBig("responses-parsed-summary", { textPreview: getPreview(parsed.text, 300), images: getImageSummaryForLog(parsed.images), toolCalls: parsed.toolCalls }, { toFile: debugOn });
      setLogBig("responses-hosted-links", hostedLinks, { toFile: debugOn });

      const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
      const hasToolCalls = toolCalls.length > 0;
      const assistantText = (parsed.text || "").trim();
      const finish = getFinishReasonFromData(data);
      log(`AI turn ${iter + 1}: finish_reason="${finish ?? "null"}" content_length=${assistantText.length} tool_calls=${toolCalls.length}`, "info");

      const linkBlockThisIter = hostedLinks.length ? hostedLinks.map(u => `- ${u}`).join("\n") : "";
      const persistAssistantContent = [assistantText, linkBlockThisIter].filter(Boolean).join("\n\n").trim();

      if (persistAssistantContent.length) {
        const msg = { role: "assistant", authorName: getAssistantAuthorName(wo), content: persistAssistantContent };
        if (msg.authorName == null) delete msg.authorName;
        messages.push(msg);
        wo._contextPersistQueue.push(getWithTurnId(msg, wo));
        if (assistantText) accumulatedText += (accumulatedText ? "\n" : "") + assistantText;
      }

      let persistedToolCallRequest = false;
      if (!toolsDisabled) {
        let ranAnyTool = false;

        if (hasToolCalls && genericTools.length && totalToolCalls < maxToolCalls) {
          const assistantToolMsg = {
            role: "assistant",
            authorName: getAssistantAuthorName(wo),
            content: "",
            tool_calls: toolCalls.map((tc) => ({
              id: tc?.call_id || tc?.id || `${tc?.name || "tool"}:${createHash("sha256").update(getToString(tc?.arguments ?? "")).digest("hex")}`,
              type: "function",
              function: {
                name: tc?.name || "",
                arguments: (typeof tc?.arguments === "string") ? tc.arguments : JSON.stringify(tc?.arguments ?? {})
              }
            })).filter((tc) => tc.id && tc?.function?.name)
          };
          if (assistantToolMsg.authorName == null) delete assistantToolMsg.authorName;
          if (assistantToolMsg.tool_calls.length) {
            wo._contextPersistQueue.push(getWithTurnId(assistantToolMsg, wo));
            persistedToolCallRequest = true;
          }

          wo._fullAssistantText = accumulatedText || assistantText || "";

          for (const tc of toolCalls) {
            const isGeneric = toolDefs.some(d => d?.name === tc?.name);
            if (!isGeneric) continue;
            if (totalToolCalls >= maxToolCalls) { hitMaxToolCalls = true; break; }

            const call_id = tc?.call_id || tc?.id || `${tc?.name || "tool"}:${createHash("sha256").update(getToString(tc?.arguments ?? "")).digest("hex")}`;
            const callArgsStr = (typeof tc?.arguments === "string") ? tc.arguments : JSON.stringify(tc?.arguments ?? {});
            messages.push({ type: "function_call", call_id, name: tc?.name, arguments: callArgsStr });

            const _tcStartMs = Date.now();
            const result = await setExecGenericTool(genericTools, { ...tc, call_id, arguments: callArgsStr }, coreData);
            const _tcDurationMs = Date.now() - _tcStartMs;
            totalToolCalls++;
            ranAnyTool = true;
            let _tcStatus = "success";
            try { const _tcR = JSON.parse(getToString(result?.content || "{}")); if (_tcR?.ok === false) _tcStatus = "failed"; } catch {}
            toolCallLog.push({ tool: tc?.name || "?", status: _tcStatus, durationMs: _tcDurationMs, task: "" });
            if (tc?.name === "getSubAgent") {
              try {
                const r = JSON.parse(getToString(result?.content || "{}"));
                const inner = r?.data ?? r;
                subagentLog.push({ type: inner.type || "generic", channelId: inner.channelId || "?", ok: !!inner.ok, error: inner.error || null });
              } catch (e) {
                log(`getSubAgent result parse error: ${e?.message || String(e)}`, "warn");
              }
            }

            const outputStr = getToString(result?.content ?? "");
            messages.push({ type: "function_call_output", call_id, output: outputStr });
            wo._contextPersistQueue.push(getWithTurnId({
              role: "tool",
              tool_call_id: call_id,
              name: String(tc?.name || ""),
              content: outputStr
            }, wo));
          }

          wo._fullAssistantText = undefined;
          if (ranAnyTool) continue;
        }

      if (hasToolCalls && totalToolCalls >= maxToolCalls) {
        hitMaxToolCalls = true;
        wo.__forceNoTools = true;
        setEnsureFinalSynthesisPrompt(messages, wo);
        continue;
      }
      }

      if (hasToolCalls && !persistAssistantContent.length && persistedToolCallRequest) {
        log("Persisted assistant tool_call request + tool output pair for context continuity.", "info");
      }

      if (toolsDisabled && hasToolCalls) {
        log("tools disabled mode active; ignoring any tool-call requests in output.", "info");
      }

      const truncated = getWasTruncatedOutput(data);
      const looksCutOff = getLooksCutOff(assistantText);
      const cutOff = !wo.__noContinuation && (truncated || looksCutOff);
      if (cutOff) {
        


        if (truncated && !assistantText.trim()) {
          emptyOutputConsec++;
          if (emptyOutputConsec >= 2) {
            log(`Empty-output loop guard: ${emptyOutputConsec} consecutive truncated iterations with no visible text — stopping loop. Increase maxTokens for reasoning models.`, "warn");
            break;
          }
        } else {
          emptyOutputConsec = 0;
        }
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        wo._contextPersistQueue.push(getWithTurnId(cont, wo));
        log(`Continue triggered: finish_reason="${finish ?? "null"}" truncated=${truncated} looks_cut_off=${looksCutOff}`, "info");
        wo.__forceNoTools = true;
        continue;
      }
      emptyOutputConsec = 0;

      const primaryText = [(accumulatedText || assistantText || "")].filter(Boolean).join("\n\n");
      const linkText = allHostedLinks.length ? allHostedLinks.map(u => `- ${u}`).join("\n") : "";
      finalText = [primaryText, linkText].filter(Boolean).join("\n\n");
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      if (isAbort && attempts < maxAttempts) { log(`Retrying due to timeout after ${timeoutMs}ms`, "warn"); continue; }
      wo.response = "[Empty AI response]";
      log(isAbort ? `AI request timed out after ${timeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}`, isAbort ? "warn" : "error");
      setLogBig("responses-error", { message: err?.message || String(err), stack: err?.stack }, { toFile: debugOn });
      return coreData;
    }
  }

  if (!finalText && !subagentLog.length && !hitMaxToolCalls && messages.length && messages[messages.length - 1]?.role !== "assistant") {
    hitMaxLoops = true;
  }

  if (reasoningEnabled) {
    const reasoningJoined = getSanitizeReasoningText(reasoningParts.join("\n\n")).trim();
    const subagentBlock = subagentLog.length
      ? "=== Subagents ===\n" + subagentLog.map((s, i) =>
          `--- Subagent ${i + 1} (${s.type} → ${s.channelId}) ---\n` +
          (s.ok ? "✓ Completed successfully" : `✗ Error: ${s.error}`)
        ).join("\n\n")
      : "";
    const directTools = toolCallLog.filter(e => (typeof e === "object" ? e.tool : e) !== "getSubAgent");
    const toolsBlock = directTools.length ? "Tools called:\n" + directTools.map(e => {
      if (typeof e === "object") {
        const icon = e.status === "success" ? "✅" : (e.status === "failed" ? "❌" : "⚠️");
        const ms = e.durationMs >= 1000 ? `${(e.durationMs / 1000).toFixed(1)}s` : `${e.durationMs}ms`;
        const task = e.task ? ` — ${e.task}` : "";
        return `${icon} **${e.tool}** (${ms})${task}`;
      }
      return `- ${e}`;
    }).join("\n") : "";
    const noActivity = !reasoningJoined && !subagentBlock && !toolsBlock;
    const fallback = noActivity ? "Answered from context — no tool calls." : "";
    const combined = [reasoningJoined, subagentBlock, toolsBlock, fallback].filter(Boolean).join("\n\n");
    wo.reasoningSummary = combined.length ? combined : "Answered from context — no tool calls.";
  } else {
    wo.reasoningSummary = undefined;
  }

  if (Array.isArray(wo._pendingSubtaskLogs) && wo._pendingSubtaskLogs.length) {
    const _logBlock = wo._pendingSubtaskLogs.join("\n\n");
    wo.reasoningSummary = wo.reasoningSummary ? wo.reasoningSummary + "\n\n" + _logBlock : _logBlock;
    wo._pendingSubtaskLogs = [];
  }

  setLogBig("responses-final", { finalTextPreview: getPreview(finalText, 400), queuedTurns: wo._contextPersistQueue.length, reasoningSummaryPreview: getPreview(getToString(wo?.reasoningSummary ?? ""), 400) }, { toFile: debugOn });

  if (finalText) {
    if (hitMaxToolCalls) {
      wo.response = finalText + "\n\n" + getLimitNotice("tool");
    } else if (hitMaxLoops) {
      wo.response = finalText + "\n\n" + getLimitNotice("loop");
    } else {
      wo.response = finalText;
    }
  } else if (subagentLog.length) {
    wo.response = "The sub-agent has been started and is working. I will share the result as soon as it arrives.";
  } else if (hitMaxToolCalls) {
    const partial = (accumulatedText || "").trim();
    wo.response = partial ? (partial + "\n\n" + getLimitNotice("tool")) : ("[Max Tool Calls Hit]\n\n" + getLimitNotice("tool"));
  } else if (hitMaxLoops) {
    const partial = (accumulatedText || "").trim();
    wo.response = partial ? (partial + "\n\n" + getLimitNotice("loop")) : ("[Max Loops Hit]\n\n" + getLimitNotice("loop"));
  } else {
    wo.response = "[Empty AI response]";
  }
  const { primaryImageUrl: _primaryImg } = getParseArtifactsBlock(wo.response);
  if (_primaryImg) wo.primaryImageUrl = _primaryImg;
  log("AI response received.", "info");

  return coreData;
}
