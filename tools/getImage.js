/********************************************************************************
/* filename: "getImage.js"                                                      *
/* Version 1.0                                                                  *
/* Purpose: Generate high-quality images via OpenAI API and persist them to     *
/*          ./pub/documents with AI prompt enhancement, digital-painting bias,  *
/*          camera/lens suggestions, and generic aspect handling                *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "getImage";

/********************************************************************************
/* functionSignature: getEnsureDir (absPath)                                    *
/* Ensures a directory exists (recursive).                                      *
/********************************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/********************************************************************************
/* functionSignature: getContentTypeToExt (ctype)                               *
/* Maps image content-type to a filename extension.                             *
/********************************************************************************/
function getContentTypeToExt(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("image/jpeg") || c.includes("image/jpg")) return ".jpg";
  if (c.includes("image/webp")) return ".webp";
  if (c.includes("image/gif")) return ".gif";
  if (c.includes("image/png")) return ".png";
  return ".png";
}

/********************************************************************************
/* functionSignature: getHttpGetBuffer (url)                                    *
/* Downloads a URL and returns buffer and inferred extension.                   *
/********************************************************************************/
async function getHttpGetBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ext: getContentTypeToExt(ct) };
}

/********************************************************************************
/* functionSignature: getRandSuffix ()                                          *
/* Generates a short random base36 suffix.                                      *
/********************************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/********************************************************************************
/* functionSignature: getSaveBuffer (buf, dirAbs, ext)                          *
/* Saves a buffer to disk under pub/documents and returns meta.                 *
/********************************************************************************/
function getSaveBuffer(buf, dirAbs, ext = ".png") {
  getEnsureDir(dirAbs);
  const filename = `img_${Date.now()}_${getRandSuffix()}${ext}`;
  const abs = path.join(dirAbs, filename);
  fs.writeFileSync(abs, buf);
  return { filename, abs };
}

/********************************************************************************
/* functionSignature: getBuildPublicUrl (base, filename)                        *
/* Builds a public URL for the saved file if base is provided.                  *
/********************************************************************************/
function getBuildPublicUrl(base, filename) {
  if (!base) return null;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/********************************************************************************
/* functionSignature: getPersistImages (apiImages, publicBaseUrl)               *
/* Persists API image payloads to disk and returns file info.                   *
/********************************************************************************/
async function getPersistImages(apiImages, publicBaseUrl) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const documentsDir = path.join(__dirname, "..", "pub", "documents");
  const out = [];
  for (const img of apiImages) {
    try {
      if (img?.url) {
        const { buf, ext } = await getHttpGetBuffer(img.url);
        const saved = getSaveBuffer(buf, documentsDir, ext);
        out.push({ ok: true, filename: saved.filename, path: saved.abs, url: getBuildPublicUrl(publicBaseUrl, saved.filename), source: "url" });
      } else if (img?.b64_json) {
        const buf = Buffer.from(img.b64_json, "base64");
        const saved = getSaveBuffer(buf, documentsDir, ".png");
        out.push({ ok: true, filename: saved.filename, path: saved.abs, url: getBuildPublicUrl(publicBaseUrl, saved.filename), source: "b64" });
      } else {
        out.push({ ok: false, error: "Unknown image payload" });
      }
    } catch (e) {
      out.push({ ok: false, error: e?.message || String(e) });
    }
  }
  return out;
}

/********************************************************************************
/* functionSignature: getSanitized (text)                                       *
/* Collapses whitespace in a string and trims.                                  *
/********************************************************************************/
function getSanitized(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/********************************************************************************
/* functionSignature: getModelPolicyHints (modelName)                           *
/* Provides model-specific safety guidance hints.                               *
/********************************************************************************/
function getModelPolicyHints(modelName) {
  const m = String(modelName || "").toLowerCase();
  const base = [
    "Ensure full compliance with the image model's safety and content filters.",
    "No sexual or erotic content; no minors; no graphic violence/gore.",
    "No political persuasion or propaganda.",
    "No copyrighted logos/trademarks on the image.",
    "No real-person deepfakes; no impersonation.",
    "Avoid hate/harassment content."
  ];
  if (m.includes("dall") || m.includes("gpt-image")) {
    base.push("Prefer neutral brandless designs and generic signage.");
  }
  return base;
}

/********************************************************************************
/* functionSignature: getHeuristicEnhancedPrompt (basePrompt, opts)             *
/* Builds an enhanced prompt via deterministic heuristics.                      *
/********************************************************************************/
function getHeuristicEnhancedPrompt(basePrompt, { extraNegatives = [], extraQuality = [], preferDigitalPainting = true } = {}) {
  const ENHANCER_DEFAULT_QUALITY = [
    "cinematic",
    "creative angles",
    "symbolism",
    "no text",
    "vibrant colors",
    "vibrant lighting",
    "realistic faces",
    "faces with character",
    "high quality",
    "highly detailed faces",
    "anatomically correct hands: 5 fingers per hand",
    "no additional limbs",
    "sharp focus",
    "clean edges",
    "cohesive lighting",
    "consistent perspective"
  ];
  const ENHANCER_DEFAULT_NEGATIVE = [
    "text, captions, logos, watermarks",
    "misspelled words",
    "deformed hands, extra fingers, fused fingers",
    "doll-like faces, plastic skin",
    "low-res, heavy compression artifacts, banding",
    "distorted anatomy, extra limbs, missing limbs",
    "overexposed highlights, crushed blacks"
  ];
  const p = getSanitized(basePrompt);
  const quality = [...ENHANCER_DEFAULT_QUALITY, ...extraQuality];
  if (preferDigitalPainting) quality.unshift("digital painting", "painterly brushwork", "studio quality");
  const negatives = [...ENHANCER_DEFAULT_NEGATIVE, ...extraNegatives];
  return [
    p,
    `Style/Quality: ${quality.join(", ")}`,
    "Camera/Lens: suggest a cinematic lens and appropriate focal length; choose an angle that enhances the subject (low/high/three-quarter as appropriate); use rule of thirds or strong leading lines when suitable.",
    `Avoid: ${negatives.join(", ")}`,
    "Compose for readability and balance; prioritize subject clarity."
  ].join(" | ");
}

/********************************************************************************
/* functionSignature: getResolveEnhancerConfig (args, wo, toolCfg, modelName)   *
/* Resolves enhancer configuration from layered sources.                        *
/********************************************************************************/
function getResolveEnhancerConfig(args, wo, toolCfg, imageModelName) {
  const epArg = args?.enhancerEndpoint;
  const epCfg = toolCfg?.enhancerEndpoint || toolCfg?.endpoint;
  const epWO  = wo?.Endpoint;
  const endpoint = String(epArg || epCfg || epWO || "https://api.openai.com/v1/chat/completions");
  const keyArg = args?.enhancerApiKey;
  const keyCfg = toolCfg?.enhancerApiKey || toolCfg?.apiKey;
  const keyWO  = wo?.APIKey;
  const apiKey = String(keyArg || keyCfg || keyWO || "");
  const model = String(args?.enhancerModel || toolCfg?.enhancerModel || toolCfg?.model || wo?.Model || "gpt-4o-mini");
  const tempArg = args?.enhancerTemperature;
  const tempCfg = toolCfg?.enhancerTemperature;
  const tempWO  = wo?.Temperature;
  const temperature = Number.isFinite(tempArg) ? tempArg : Number.isFinite(tempCfg) ? tempCfg : Number.isFinite(tempWO) ? tempWO : 0.7;
  const mtArg = args?.enhancerMaxTokens;
  const mtCfg = toolCfg?.enhancerMaxTokens;
  const mtWO  = wo?.MaxTokens;
  const max_tokens = Number.isFinite(mtArg) ? mtArg : Number.isFinite(mtCfg) ? mtCfg : Number.isFinite(mtWO) ? mtWO : 350;
  const timeout = Number.isFinite(toolCfg?.enhancerTimeoutMs) ? toolCfg.enhancerTimeoutMs : Number.isFinite(wo?.RequestTimeoutMs) ? wo.RequestTimeoutMs : 60000;
  const preferDigitalPainting = args?.preferDigitalPainting !== false;
  return { endpoint, apiKey, model, temperature, max_tokens, timeout, preferDigitalPainting, imageModelName };
}

/********************************************************************************
/* functionSignature: getAiEnhancedPrompt (opts)                                *
/* Produces an enhanced prompt using a GPT enhancer with fallback on failure.   *
/********************************************************************************/
async function getAiEnhancedPrompt({
  endpoint,
  apiKey,
  enhancerModel,
  temperature,
  max_tokens,
  basePrompt,
  imageModelName,
  preferDigitalPainting = true,
  extraQuality = [],
  extraNegatives = [],
  timeoutMs = 60000
}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const system = [
    "You are an expert prompt engineer for image generation.",
    "Rewrite and enhance the user's prompt for an image generation model.",
    "Prefer a digital painting aesthetic when appropriate, but exercise creative freedom to make the image compelling.",
    "Include suitable camera angle and lens suggestions when beneficial.",
    "Ensure the result is a single line of plain text with no explanations.",
    ...getModelPolicyHints(imageModelName)
  ].join(" ");
  const content = [
    `USER_PROMPT: ${getSanitized(basePrompt)}`,
    `MANDATORY_QUALITY_TAGS: ${[...(preferDigitalPainting ? ["digital painting","painterly brushwork","studio quality"] : []), "cinematic", "creative angles", "symbolism", "no text", "vibrant colors", "vibrant lighting", "realistic faces", "faces with character", "high quality", "highly detailed faces", "anatomically correct hands: 5 fingers per hand", "no additional limbs", "sharp focus", "clean edges", "cohesive lighting", "consistent perspective", ...extraQuality].join(", ")}`,
    `NEGATIVE_TAGS: ${["text, captions, logos, watermarks", "misspelled words", "deformed hands, extra fingers, fused fingers", "doll-like faces, plastic skin", "low-res, heavy compression artifacts, banding", "distorted anatomy, extra limbs, missing limbs", "overexposed highlights, crushed blacks", ...extraNegatives].join(", ")}`,
    "OUTPUT_FORMAT: single line; no markdown; no quotes; no role labels."
  ].join("\n");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: enhancerModel, messages: [{ role: "system", content: system }, { role: "user", content }], temperature, max_tokens }),
      signal: controller ? controller.signal : undefined
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { throw new Error("Invalid JSON from Enhancer API"); }
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status} ${res.statusText}`);
    const text = data?.choices?.[0]?.message?.content || "";
    const singleLine = getSanitized(text).replace(/^["“”'`]+|["“”'`]+$/g, "");
    if (!singleLine) throw new Error("Empty enhancer result");
    return singleLine;
  } catch (e) {
    return getHeuristicEnhancedPrompt(basePrompt, { extraNegatives, extraQuality, preferDigitalPainting });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/********************************************************************************
/* functionSignature: getBuildEnhancedPrompt (opts)                             *
/* Wrapper: tries GPT enhancer with heuristic fallback.                         *
/********************************************************************************/
async function getBuildEnhancedPrompt({
  wo,
  toolCfg,
  args,
  basePrompt,
  imageModelName,
  negative,
  extraTags = []
}) {
  const cfg = getResolveEnhancerConfig(args, wo, toolCfg, imageModelName);
  const extraNeg = Array.isArray(negative) ? negative : (negative ? [negative] : []);
  if (!cfg.apiKey) {
    return getHeuristicEnhancedPrompt(basePrompt, { extraNegatives: extraNeg, extraQuality: Array.isArray(extraTags) ? extraTags : [], preferDigitalPainting: cfg.preferDigitalPainting });
  }
  return await getAiEnhancedPrompt({
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey,
    enhancerModel: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
    basePrompt,
    imageModelName,
    preferDigitalPainting: cfg.preferDigitalPainting,
    extraQuality: Array.isArray(extraTags) ? extraTags : [],
    extraNegatives: extraNeg,
    timeoutMs: cfg.timeout
  });
}

/********************************************************************************
/* functionSignature: getRoundedToMultiple (x, m)                               *
/* Rounds a number to the nearest multiple with a minimum.                      *
/********************************************************************************/
function getRoundedToMultiple(x, m = 64) {
  return Math.max(m, Math.round(x / m) * m);
}

/********************************************************************************
/* functionSignature: getParsedAspect (aspect)                                  *
/* Parses aspect tokens like 'portrait', '16:9', '1:1'.                         *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getNormalizedSizeString (s)                               *
/* Validates and normalizes an explicit 'WxH' size string.                      *
/********************************************************************************/
function getNormalizedSizeString(s) {
  const m = String(s || "").trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const w = Math.max(1, Number(m[1]));
  const h = Math.max(1, Number(m[2]));
  return `${w}x${h}`;
}

/********************************************************************************
/* functionSignature: getBuiltSize (opts)                                       *
/* Derives final WxH string from size or aspect and target long edge.           *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getInvoke (args, coreData)                                *
/* Calls the Images API, saves results, and returns file metadata.              *
/********************************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getImage || {};
  const apiKey = String(args?.apiKey || toolCfg.apiKey || wo?.APIKey || "");
  if (!apiKey) return { ok: false, error: "Missing API key for images (args.apiKey / toolsconfig.getImage.apiKey / workingObject.APIKey)" };
  const promptRaw = String(args?.prompt || "").trim();
  if (!promptRaw) return { ok: false, error: "Missing prompt" };
  const model = String(args?.model || toolCfg.model || "gpt-image-1");
  const imagesEndpoint = String(args?.endpoint || toolCfg.endpoint || "https://api.openai.com/v1/images/generations");
  const requestedSize = String(args?.size || toolCfg.size || "");
  const aspect = args?.aspect ? String(args.aspect) : (toolCfg.aspect ? String(toolCfg.aspect) : "");
  const targetLongEdge = Number.isFinite(args?.targetLongEdge) ? Number(args.targetLongEdge) : Number.isFinite(toolCfg.targetLongEdge) ? Number(toolCfg.targetLongEdge) : 1024;
  let n = Number.isFinite(args?.n) ? Number(args.n) : (Number.isFinite(toolCfg.n) ? Number(toolCfg.n) : 1);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 4) n = 4;
  const strictPrompt = Boolean(args?.strictPrompt || false);
  const negative = args?.negative || null;
  const publicBaseUrl = typeof toolCfg.public_base_url === "string" ? toolCfg.public_base_url : null;
  const enhancedPrompt = strictPrompt ? promptRaw : await getBuildEnhancedPrompt({ wo, toolCfg, args, basePrompt: promptRaw, imageModelName: model, negative, extraTags: [] });
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
  const saved = await getPersistImages(images, publicBaseUrl);
  const okFiles = saved.filter(x => x.ok);
  return { ok: okFiles.length > 0, endpoint: imagesEndpoint, model, size: finalSize, n, prompt: promptRaw, enhancedPrompt, strictPrompt, aspect: aspect || undefined, files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })), failed: saved.filter(x => !x.ok).map(x => ({ error: x.error })) };
}

/********************************************************************************
/* functionSignature: getDefaultExport ()                                       *
/* Constructs the tool definition object with schema and invoke.                *
/********************************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description: "Generate one or more high-quality images from a prompt using the configured Images model; returns local paths/URLs. Model-agnostic; automatically enhances prompts unless strictPrompt=true. Never change set model unless it is explicitly stated.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Short, clean scene description (no on-image text)." },
            model: { type: "string", description: "Images model (defaults from toolsconfig.getImage.model)." },
            endpoint: { type: "string", description: "Images endpoint URL (defaults from toolsconfig.getImage.endpoint or OpenAI default)." },
            apiKey: { type: "string", description: "API key for the images endpoint (overrides toolsconfig/workingObject)." },
            size: { type: "string", description: "Explicit size 'WxH' (e.g., 1152x896). If omitted, derived from 'aspect' and 'targetLongEdge'." },
            aspect: { type: "string", description: "Preferred aspect (e.g., '1:1', '16:9', '9:16', 'portrait', 'landscape')." },
            targetLongEdge: { type: "number", description: "If 'size' is omitted, long edge target in px (default 1024)." },
            n: { type: "integer", minimum: 1, maximum: 4, description: "Number of images to generate (subject to model limits)." },
            strictPrompt: { type: "boolean", description: "If true, sends the prompt exactly as given (no enhancement)." },
            negative: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Extra negatives to avoid." },
            enhancerEndpoint: { type: "string", description: "Chat/completions endpoint for the prompt enhancer." },
            enhancerApiKey: { type: "string", description: "API key for the prompt enhancer." },
            enhancerModel: { type: "string", description: "GPT model for the prompt enhancer." },
            enhancerTemperature: { type: "number", description: "Temperature for the prompt enhancer." },
            enhancerMaxTokens: { type: "number", description: "max_tokens for the prompt enhancer." },
            preferDigitalPainting: { type: "boolean", description: "Prefer a digital painting style (default: true)." }
          },
          required: ["prompt"],
          additionalProperties: false
        }
      }
    },
    invoke: getInvoke
  };
}

/********************************************************************************
/* functionSignature: getDefault ()                                             *
/* Default export factory for module consumers.                                 *
/********************************************************************************/
function getDefault() {
  return getDefaultExport();
}

export default getDefault();
