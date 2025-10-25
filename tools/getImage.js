/***************************************************************
/* filename: "getImage.js"                                     *
/* Version 1.0                                                 *
/* Purpose: Generate images via OpenAI API and persist to      *
/*          ./pub/documents                                    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const MODULE_NAME = "getImage";

/***************************************************************
/* functionSignature: getEnsureDir (absPath)                   *
/* Creates a directory recursively if it does not exist        *
/***************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/***************************************************************
/* functionSignature: getContentTypeToExt (ctype)              *
/* Maps a content-type string to a file extension              *
/***************************************************************/
function getContentTypeToExt(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("image/jpeg") || c.includes("image/jpg")) return ".jpg";
  if (c.includes("image/webp")) return ".webp";
  if (c.includes("image/gif")) return ".gif";
  if (c.includes("image/png")) return ".png";
  return ".png";
}

/***************************************************************
/* functionSignature: getHttpGetBuffer (url)                   *
/* Downloads a URL and returns { buf, ext }                    *
/***************************************************************/
async function getHttpGetBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ext: getContentTypeToExt(ct) };
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
/* functionSignature: getPersistImages (apiImages, baseUrl)    *
/* Persists API image payloads to ./pub/documents              *
/***************************************************************/
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

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Generates images via API and returns saved file info        *
/***************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getImage || {};
  const apiKey = typeof toolCfg.apiKey === "string" ? toolCfg.apiKey : null;
  if (!apiKey) return { ok: false, error: "Missing toolsconfig.getImage.apiKey" };
  const prompt = String(args?.prompt || "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };
  const model = String(args?.model || toolCfg.model || "dall-e-3");
  const size = String(args?.size || toolCfg.size || "1024x1024");
  let n = Number.isFinite(args?.n) ? Number(args.n) : Number.isFinite(toolCfg.n) ? Number(toolCfg.n) : 1;
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 4) n = 4;
  const publicBaseUrl = typeof toolCfg.public_base_url === "string" ? toolCfg.public_base_url : null;
  const body = { model, prompt, size, n };
  let res, data;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const raw = await res.text();
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, details: data?.error?.message || null };
  }
  const images = Array.isArray(data?.data) ? data.data : [];
  if (!images.length) return { ok: false, error: "No image data returned by API" };
  const saved = await getPersistImages(images, publicBaseUrl);
  const okFiles = saved.filter(x => x.ok);
  return {
    ok: okFiles.length > 0,
    model, size, n, prompt,
    files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })),
    failed: saved.filter(x => !x.ok).map(x => ({ error: x.error }))
  };
}

export default {
  name: "getImage",
  definition: {
    type: "function",
    function: {
      name: "getImage",
      description: "Generate one or more images from a prompt using the configured OpenAI Images model; returns local paths/URLs.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Production-ready image description (avoid on-image text)." },
          model: { type: "string", description: "Images model (defaults from toolsconfig.getImage.model)." },
          size: { type: "string", description: "e.g., 1024x1024; defaults from toolsconfig." },
          n: { type: "integer", minimum: 1, maximum: 4, description: "Number of images to generate." }
        },
        required: ["prompt"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
