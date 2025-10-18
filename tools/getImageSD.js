/***************************************************************
/* filename: "getImageSD.js"                                   *
/* Version 1.0                                                 *
/* Purpose: Generate image(s) via Stable Diffusion A1111 API,  *
/*          persist under ./pub/documents, and return links    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetch, Agent } from "undici";

const MODULE_NAME = "getImageSD";

const DEFAULT_NEGATIVE_PROMPT = [
  "worst quality, low quality, normal quality, lowres, jpeg artifacts, blurry, oversaturated, undersaturated, washed out",
  "bad lighting, harsh lighting, overexposed, underexposed, noisy, grainy, posterized",
  "bad anatomy, malformed anatomy, deformed, disfigured, mutated, distorted, asymmetrical",
  "bad proportions, out of frame, cropped body, warped perspective",
  "bad hands, bad feet, deformed hands, malformed hands, mangled hands",
  "extra fingers, extra digits, extra limbs, extra arms, extra legs",
  "missing fingers, fewer digits, fewer fingers, fused fingers, webbed fingers",
  "long fingers, short fingers, broken fingers, distorted fingers",
  "incorrect finger count, more than 5 fingers per hand, less than 5 fingers per hand",
  "polydactyly, syndactyly",
  "floating limbs, disconnected limbs, duplicate limbs, fused limbs",
  "cross-eye, lazy eye, wonky eyes, deformed face, malformed face",
  "text, watermark, signature, logo, captions, UI, interface elements",
  "glitches, tiling, pattern artifacts, banding, moire"
].join(", ");

/***************************************************************
/* functionSignature: getEnsureDir (absPath)                   *
/* Creates a directory recursively if it does not exist        *
/***************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/***************************************************************
/* functionSignature: getRandSuffix ()                         *
/* Returns a short random suffix for filenames                 *
/***************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/***************************************************************
/* functionSignature: getSaveBuffer (buf, dirAbs, ext)         *
/* Saves a buffer to directory with timestamped name           *
/***************************************************************/
function getSaveBuffer(buf, dirAbs, ext = ".png") {
  getEnsureDir(dirAbs);
  const filename = `img_${Date.now()}_${getRandSuffix()}${ext}`;
  const abs = path.join(dirAbs, filename);
  fs.writeFileSync(abs, buf);
  return { filename, abs };
}

/***************************************************************
/* functionSignature: getBuildPublicUrl (base, filename)       *
/* Builds a public URL for a saved document file               *
/***************************************************************/
function getBuildPublicUrl(base, filename) {
  if (!base) return null;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/***************************************************************
/* functionSignature: getParseSize (sizeStr, defW, defH)       *
/* Parses "WxH" into width and height rounded to multiples of 8*
/***************************************************************/
function getParseSize(sizeStr, defW = 1024, defH = 1024) {
  const m = String(sizeStr || "").match(/^\s*(\d+)\s*[xX]\s*(\d+)\s*$/);
  let width = defW, height = defH;
  if (m) {
    width = Math.max(64, Math.min(2048, parseInt(m[1], 10)));
    height = Math.max(64, Math.min(2048, parseInt(m[2], 10)));
  }
  width = Math.round(width / 8) * 8;
  height = Math.round(height / 8) * 8;
  return { width, height };
}

/***************************************************************
/* functionSignature: getStripDataUrlPrefix (b64)              *
/* Removes data URL prefix if present from base64 string       *
/***************************************************************/
function getStripDataUrlPrefix(b64) {
  if (typeof b64 !== "string") return b64;
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

/***************************************************************
/* functionSignature: getPersistSDImages (b64List, baseUrl)    *
/* Persists base64 images to ./pub/documents                   *
/***************************************************************/
async function getPersistSDImages(b64List, publicBaseUrl) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const documentsDir = path.join(__dirname, "..", "pub", "documents");
  const out = [];
  for (const raw of b64List) {
    try {
      const b64 = getStripDataUrlPrefix(raw);
      if (!b64 || typeof b64 !== "string") {
        out.push({ ok: false, error: "Empty image payload" });
        continue;
      }
      const buf = Buffer.from(b64, "base64");
      const saved = getSaveBuffer(buf, documentsDir, ".png");
      out.push({
        ok: true,
        filename: saved.filename,
        path: saved.abs,
        url: getBuildPublicUrl(publicBaseUrl, saved.filename),
        source: "b64"
      });
    } catch (e) {
      out.push({ ok: false, error: e?.message || String(e) });
    }
  }
  return out;
}

/***************************************************************
/* functionSignature: getNumSafe (value, fallback)             *
/* Parses a number or returns the fallback                     *
/***************************************************************/
function getNumSafe(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Generates images via A1111 API and returns saved file info  *
/***************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const baseUrl = typeof wo.SD_BaseURL === "string" ? wo.SD_BaseURL : null;
  if (!baseUrl) return { ok: false, error: "Missing wo.SD_BaseURL (e.g., http://127.0.0.1:7860)" };
  const prompt = String(args?.prompt || "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };

  const sizeStr = String(wo.SD_Size || "1024x1024");
  const { width, height } = getParseSize(sizeStr);

  let n = getNumSafe(wo.SD_N, 1);
  if (n < 1) n = 1;
  if (n > 8) n = 8;

  const steps = getNumSafe(wo.SD_Steps, 20);
  const cfg_scale = getNumSafe(wo.SD_CFG, 6.5);
  const sampler_name =
    typeof wo.SD_Sampler === "string" && wo.SD_Sampler.length ? wo.SD_Sampler : "DPM++ 2M Karras";
  const seed = getNumSafe(wo.SD_Seed, -1);

  const negative_prompt = [
    DEFAULT_NEGATIVE_PROMPT,
    (typeof wo.SD_NegativeExtra === "string" && wo.SD_NegativeExtra.trim()) ? wo.SD_NegativeExtra.trim() : ""
  ].filter(Boolean).join(", ");

  const model = (typeof wo.SD_Model === "string" && wo.SD_Model.length) ? wo.SD_Model : null;

  const timeoutMs = getNumSafe(wo.SD_TimeoutMs, 120000);
  const netTimeoutMs = getNumSafe(wo.SD_NetworkTimeoutMs, 1800000);
  const agent = new Agent({ headersTimeout: netTimeoutMs, bodyTimeout: 0 });

  const publicBaseUrl = typeof wo.SD_PublicBaseURL === "string" ? wo.SD_PublicBaseURL : null;

  const batch_size = Math.min(n, 4);
  const n_iter = Math.ceil(n / batch_size);

  const payload = {
    prompt,
    negative_prompt,
    width,
    height,
    steps,
    cfg_scale,
    sampler_name,
    seed,
    batch_size,
    n_iter
  };

  if (model) {
    payload.override_settings = { sd_model_checkpoint: String(model) };
    payload.override_settings_restore_afterwards = true;
  }

  const endpoint = String(baseUrl).replace(/\/+$/, "") + "/sdapi/v1/txt2img";

  let res, data;
  try {
    const headers = { "Content-Type": "application/json" };
    if (wo.SD_Headers && typeof wo.SD_Headers === "object") {
      for (const [k, v] of Object.entries(wo.SD_Headers)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      dispatcher: agent,
      signal: controller.signal
    });
    clearTimeout(timer);
    const raw = await res.text();
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Failed to parse A1111 response JSON", raw: raw?.slice(0, 800) ?? null };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, details: typeof data === "object" ? data : null };
  }

  const images = Array.isArray(data?.images) ? data.images : [];
  if (!images.length) return { ok: false, error: "No image data returned by A1111" };

  const saved = await getPersistSDImages(images, publicBaseUrl);
  const okFiles = saved.filter(x => x.ok);

  return {
    ok: okFiles.length > 0,
    prompt,
    size: `${width}x${height}`,
    n,
    steps,
    cfg_scale,
    sampler: sampler_name,
    model: model || null,
    files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })),
    failed: saved.filter(x => !x.ok).map(x => ({ error: x.error }))
  };
}

export default {
  name: "getImageSD",
  definition: {
    type: "function",
    function: {
      name: "getImageSD",
      description: "Generate one or more images from a prompt using Stable Diffusion and return local paths/URLs.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Production-ready image description (avoid on-image text)." }
        },
        required: ["prompt"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
