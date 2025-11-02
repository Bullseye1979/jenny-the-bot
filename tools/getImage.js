/********************************************************************************
/* filename: "getImage.js"                                                      *
/* Version 1.0                                                                  *
/* Purpose: Generate high-quality images via OpenAI API and                     *
/*          persist them to ./pub/documents                                    *
/*          – with prompt enhancement, style presets,                           *
/*            and generic aspect handling                                       *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

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
/* Persists API image payloads (url or b64) to disk and returns file info.      *
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
/* Collapses whitespace in a string and trims.                                   *
/********************************************************************************/
function getSanitized(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/********************************************************************************
/* functionSignature: getEnhancedPrompt (basePrompt, opts)                       *
/* Builds an enhanced prompt with style/quality/negatives unless strict.        *
/********************************************************************************/
function getEnhancedPrompt(basePrompt, { style, negative, extraTags = [] } = {}) {
  const STYLE_PRESETS = {
    cinematic: {
      tags: ["cinematic lighting", "global illumination", "volumetric light", "dynamic composition", "shallow depth of field", "anamorphic bokeh", "high detail", "photoreal textures", "subtle film grain"],
      camera: ["35mm lens", "low angle", "rule of thirds", "leading lines", "dramatic contrast"],
      color: ["rich color grading", "golden hour tones"]
    },
    digitalPainting: {
      tags: ["digital painting", "painterly brushwork", "high detail", "intricate textures", "studio quality"],
      camera: ["three-quarter view", "hero composition"],
      color: ["vibrant colors", "strong rim light"]
    },
    anime: {
      tags: ["anime style", "clean line art", "expressive faces", "cel shading", "dynamic pose", "sharp highlights"],
      camera: ["dynamic angle"],
      color: ["bold color palette"]
    },
    isometric: {
      tags: ["isometric view", "clean outlines", "sharp details", "orthographic look"],
      camera: ["isometric camera"],
      color: ["balanced color harmony"]
    },
    product: {
      tags: ["studio lighting", "seamless background", "photoreal", "sharp focus", "high fidelity"],
      camera: ["three-point lighting", "front three-quarter angle"],
      color: ["neutral color balance"]
    }
  };

  const UNIVERSAL_QUALITY = [
    "highly detailed", "sharp focus", "precise anatomy", "no distortions",
    "consistent limbs and fingers", "natural proportions", "clean edges",
    "realistic materials"
  ];

  const UNIVERSAL_NEGATIVE = [
    "no text or logos", "no watermarks", "no deformed hands",
    "no extra fingers", "no misshapen faces", "no low-res", "no artifacts"
  ];

  const p = getSanitized(basePrompt);
  const preset = STYLE_PRESETS[style] || null;
  const blocks = [];
  blocks.push(p);
  if (preset) {
    const tags = [...(preset.tags || []), ...(preset.camera || []), ...(preset.color || [])];
    if (tags.length) blocks.push(`Style: ${tags.join(", ")}`);
  }
  blocks.push(`Quality: ${[...UNIVERSAL_QUALITY, ...extraTags].join(", ")}`);
  const neg = [].concat(UNIVERSAL_NEGATIVE).concat(Array.isArray(negative) ? negative : (negative ? [negative] : []));
  blocks.push(`Avoid: ${neg.join(", ")}`);
  blocks.push("Render with cohesive lighting and consistent perspective. Keep scenes readable and balanced.");
  return blocks.join(" | ");
}

/********************************************************************************
/* functionSignature: getRoundedToMultiple (x, m)                                *
/* Rounds a number to the nearest multiple (min m).                              *
/********************************************************************************/
function getRoundedToMultiple(x, m = 64) {
  return Math.max(m, Math.round(x / m) * m);
}

/********************************************************************************
/* functionSignature: getParsedAspect (aspect)                                   *
/* Parses aspect tokens like 'portrait', '16:9', '1:1'.                          *
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
/* functionSignature: getNormalizedSizeString (s)                                *
/* Validates and normalizes an explicit 'WxH' size string.                       *
/********************************************************************************/
function getNormalizedSizeString(s) {
  const m = String(s || "").trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const w = Math.max(1, Number(m[1]));
  const h = Math.max(1, Number(m[2]));
  return `${w}x${h}`;
}

/********************************************************************************
/* functionSignature: getBuiltSize (opts)                                        *
/* Derives final WxH string from size or aspect and target long edge.            *
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
/* functionSignature: getInvoke (args, coreData)                                 *
/* Calls OpenAI Images API, saves results, returns file metadata.                *
/********************************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getImage || {};
  const apiKey = typeof toolCfg.apiKey === "string" ? toolCfg.apiKey : null;
  if (!apiKey) return { ok: false, error: "Missing toolsconfig.getImage.apiKey" };

  const promptRaw = String(args?.prompt || "").trim();
  if (!promptRaw) return { ok: false, error: "Missing prompt" };

  const model = String(args?.model || toolCfg.model || "gpt-image-1");
  const requestedSize = String(args?.size || toolCfg.size || "");
  const aspect = args?.aspect ? String(args.aspect) : (toolCfg.aspect ? String(toolCfg.aspect) : "");
  const targetLongEdge = Number.isFinite(args?.targetLongEdge) ? Number(args.targetLongEdge)
                        : Number.isFinite(toolCfg.targetLongEdge) ? Number(toolCfg.targetLongEdge)
                        : 1024;

  let n = Number.isFinite(args?.n) ? Number(args.n)
        : (Number.isFinite(toolCfg.n) ? Number(toolCfg.n) : 1);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 4) n = 4;

  const style = String(args?.style || "").trim() || null;
  const strictPrompt = Boolean(args?.strictPrompt || false);
  const negative = args?.negative || null;

  const publicBaseUrl = typeof toolCfg.public_base_url === "string" ? toolCfg.public_base_url : null;

  const enhancedPrompt = strictPrompt
    ? promptRaw
    : getEnhancedPrompt(promptRaw, { style, negative });

  const finalSize = getBuiltSize({ size: requestedSize, aspect, targetLongEdge });

  const body = { model, prompt: enhancedPrompt, size: finalSize, n };

  let res, data;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const raw = await res.text();
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Invalid JSON from Images API", details: raw?.slice?.(0, 500) || String(raw) };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `HTTP ${res.status} ${res.statusText}`,
      details: data?.error?.message || null,
      model,
      size: finalSize,
      n,
      enhancedPrompt
    };
  }

  const images = Array.isArray(data?.data) ? data.data : [];
  if (!images.length) {
    return { ok: false, error: "No image data returned by API", model, size: finalSize, n, enhancedPrompt };
  }

  const saved = await getPersistImages(images, publicBaseUrl);
  const okFiles = saved.filter(x => x.ok);

  return {
    ok: okFiles.length > 0,
    model,
    size: finalSize,
    n,
    prompt: promptRaw,
    enhancedPrompt,
    style: style || undefined,
    strictPrompt,
    aspect: aspect || undefined,
    files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })),
    failed: saved.filter(x => !x.ok).map(x => ({ error: x.error }))
  };
}

/********************************************************************************
/* functionSignature: getDefaultExport ()                                        *
/* Constructs the tool definition object with schema and invoke.                 *
/********************************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Generate one or more high-quality images from a prompt using the configured Images model; returns local paths/URLs. Model-agnostic; automatically enhances prompts unless strictPrompt=true.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Short, clean scene description (no on-image text)." },
            model: { type: "string", description: "Images model (defaults from toolsconfig.getImage.model)." },
            size: { type: "string", description: "Explicit size 'WxH' (e.g., 1152x896). If omitted, derived from 'aspect' and 'targetLongEdge'." },
            aspect: { type: "string", description: "Preferred aspect (e.g., '1:1', '16:9', '9:16', 'portrait', 'landscape')." },
            targetLongEdge: { type: "number", description: "If 'size' is omitted, long edge target in px (default 1024)." },
            n: { type: "integer", minimum: 1, maximum: 4, description: "Number of images to generate (subject to model limits)." },
            style: { type: "string", enum: ["cinematic","digitalPainting","anime","isometric","product"], description: "Optional style preset." },
            strictPrompt: { type: "boolean", description: "If true, sends the prompt exactly as given (no enhancement)." },
            negative: { oneOf: [ { type: "string" }, { type: "array", items: { type: "string" } } ], description: "Extra negatives to avoid (appended to universal negatives)." }
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
/* functionSignature: getDefault ()                                              *
/* Default export factory for module consumers.                                  *
/********************************************************************************/
function getDefault() {
  return getDefaultExport();
}

export default getDefault();
