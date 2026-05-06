/**************************************************************/
/* filename: "getImage.js"                                          */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/







import { saveFile } from "../core/file.js";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";

const MODULE_NAME = "getImage";


function getContentTypeToExt(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("image/jpeg") || c.includes("image/jpg")) return ".jpg";
  if (c.includes("image/webp")) return ".webp";
  if (c.includes("image/gif")) return ".gif";
  if (c.includes("image/png")) return ".png";
  return ".png";
}


async function getHttpGetBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ext: getContentTypeToExt(ct) };
}


async function getPersistImages(apiImages, wo) {
  const out = [];
  for (const img of apiImages) {
    try {
      if (img?.url) {
        const { buf, ext } = await getHttpGetBuffer(img.url);
        const saved = await saveFile(wo, buf, { prefix: "img", ext });
        out.push({ ok: true, filename: saved.filename, path: saved.absPath, url: saved.url, source: "url" });
      } else if (img?.b64_json) {
        const buf = Buffer.from(img.b64_json, "base64");
        const saved = await saveFile(wo, buf, { prefix: "img", ext: ".png" });
        out.push({ ok: true, filename: saved.filename, path: saved.absPath, url: saved.url, source: "b64" });
      } else {
        out.push({ ok: false, error: "Unknown image payload" });
      }
    } catch (e) {
      out.push({ ok: false, error: e?.message || String(e) });
    }
  }
  return out;
}


function getSanitized(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getStringArray(value) {
  return Array.isArray(value)
    ? value.map(item => String(item || "").trim()).filter(Boolean)
    : [];
}


function getApplyTemplate(template, values) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values?.[key] || ""));
}


function getHeuristicEnhancedPrompt(basePrompt, cfg, { extraNegatives = [], extraQuality = [], preferDigitalPainting = true } = {}) {
  const template = String(cfg.enhancerHeuristicTemplate || "").trim();
  if (!template) return getSanitized(basePrompt);

  const qualityHints = [
    ...preferDigitalPainting ? getStringArray(cfg.enhancerDigitalPaintingHints) : [],
    ...getStringArray(cfg.enhancerQualityHints),
    ...extraQuality.map(item => String(item || "").trim()).filter(Boolean)
  ];
  const negativeHints = [
    ...getStringArray(cfg.enhancerNegativeHints),
    ...extraNegatives.map(item => String(item || "").trim()).filter(Boolean)
  ];

  const rendered = getApplyTemplate(template, {
    prompt: getSanitized(basePrompt),
    qualityHints: qualityHints.join(", "),
    negativeHints: negativeHints.join(", "),
    cameraHint: String(cfg.enhancerCameraHint || "").trim(),
    compositionHint: String(cfg.enhancerCompositionHint || "").trim()
  }).replace(/\s+/g, " ").trim();

  return rendered || getSanitized(basePrompt);
}


async function callEnhancerApi(prompt, cfg, wo) {
  const channelId = String(cfg.enhancerChannelId || "").trim();
  if (!channelId) return null;
  const apiUrl = String(cfg.enhancerApiUrl || "http://localhost:3400").replace(/\/+$/, "") + "/api";
  const secretKey = String(cfg.enhancerApiSecret || "").trim();
  const secret = secretKey ? await getSecret(wo, secretKey) : "";
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;
  const timeoutMs = Math.max(5000, Number.isFinite(Number(cfg.enhancerTimeoutMs)) ? Number(cfg.enhancerTimeoutMs) : 30000);
  try {
    const res = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ channelId, payload: prompt, doNotWriteToContext: true })
    }, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const text = String(data?.response || "").trim();
    return text || null;
  } catch {
    return null;
  }
}


function getRoundedToMultiple(x, m = 64) {
  return Math.max(m, Math.round(x / m) * m);
}


function getParsedAspect(aspect) {
  const a = String(aspect || "").trim().toLowerCase();
  if (!a) return null;
  if (a === "square") return { w: 1, h: 1 };
  if (a === "portrait") return { w: 2, h: 3 };
  if (a === "landscape" || a === "widescreen") return { w: 16, h: 9 };
  const m = a.match(/^(\d+)\s*:\s*(\d+)$/);
  if (m) {
    const w = Number(m[1]), h = Number(m[2]);
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}


function getNormalizedSizeString(s) {
  const m = String(s || "").trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const w = Math.max(1, Number(m[1]));
  const h = Math.max(1, Number(m[2]));
  return `${w}x${h}`;
}


function getBuiltSize({ size, aspect, targetLongEdge = 1024 }) {
  const sNorm = getNormalizedSizeString(size);
  if (sNorm) return sNorm;
  const a = getParsedAspect(aspect) || { w: 1, h: 1 };
  const ratio = a.w / a.h;
  let w, h;
  if (ratio >= 1) {
    w = targetLongEdge;
    h = Math.round(w / ratio);
  } else {
    h = targetLongEdge;
    w = Math.round(h * ratio);
  }
  w = getRoundedToMultiple(w);
  h = getRoundedToMultiple(h);
  return `${w}x${h}`;
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getImage || {};
  const apiKey = await getSecret(wo, String(toolCfg.apiKey || wo?.apiKey || ""));
  if (!apiKey) return { ok: false, error: "Missing API key for images (toolsconfig.getImage.apiKey / workingObject.apiKey)" };
  const promptRaw = String(args?.prompt || "").trim();
  if (!promptRaw) return { ok: false, error: "Missing prompt" };
  const model = String(toolCfg.model || "gpt-image-1");
  const imagesEndpoint = String(toolCfg.endpoint || "https://api.openai.com/v1/images/generations");
  const requestedSize = String(args?.size || toolCfg.size || "");
  const aspect = args?.aspect ? String(args.aspect) : (toolCfg.aspect ? String(toolCfg.aspect) : "");
  const targetLongEdge = Number.isFinite(args?.targetLongEdge) ? Number(args.targetLongEdge) : Number.isFinite(toolCfg.targetLongEdge) ? Number(toolCfg.targetLongEdge) : 1024;
  let n = Number.isFinite(args?.n) ? Number(args.n) : (Number.isFinite(toolCfg.n) ? Number(toolCfg.n) : 1);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 4) n = 4;
  const strictPrompt = Boolean(args?.strictPrompt || false);
  const negative = args?.negative || null;
  const preferDigitalPainting = args?.preferDigitalPainting !== false;
  const extraNeg = Array.isArray(negative) ? negative : (negative ? [negative] : []);
  let enhancedPrompt;
  if (strictPrompt) {
    enhancedPrompt = promptRaw;
  } else {
    const aiEnhanced = await callEnhancerApi(promptRaw, toolCfg, wo);
    enhancedPrompt = aiEnhanced ?? getHeuristicEnhancedPrompt(promptRaw, toolCfg, { extraNegatives: extraNeg, extraQuality: [], preferDigitalPainting });
  }
  const finalSize = getBuiltSize({ size: requestedSize, aspect, targetLongEdge });
  const body = { model, prompt: enhancedPrompt, size: finalSize, n };
  let res, data;
  try {
    res = await fetch(imagesEndpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const raw = await res.text();
    try { data = JSON.parse(raw); } catch { return { ok: false, error: "Invalid JSON from Images API", details: typeof raw === "string" ? raw.slice(0, 500) : String(raw) }; }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, details: data?.error?.message || null, endpoint: imagesEndpoint, model, size: finalSize, n, enhancedPrompt };
  }
  const images = Array.isArray(data?.data) ? data.data : [];
  if (!images.length) {
    return { ok: false, error: "No image data returned by API", model, size: finalSize, n, enhancedPrompt };
  }
  const saved = await getPersistImages(images, wo);
  const okFiles = saved.filter(x => x.ok);
  return { ok: okFiles.length > 0, endpoint: imagesEndpoint, model, size: finalSize, n, prompt: promptRaw, enhancedPrompt, strictPrompt, aspect: aspect || undefined, url: okFiles[0]?.url || null, files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })), failed: saved.filter(x => !x.ok).map(x => ({ error: x.error })) };
}


function getDefaultExport() {
  return {
    name: MODULE_NAME,
    invoke: getInvoke
  };
}


function getDefault() {
  return getDefaultExport();
}

export default getDefault();
