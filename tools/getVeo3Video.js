/***************************************************************
/* filename: "getVeo3Video.js"                                 *
/* Version 1.0                                                 *
/* Purpose: Generate short videos via Replicate (prepaid PAYG),*
/*          download to ./pub/documents and return public URL. *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "getVeo3Video";

/***************************************************************
/* functionSignature: getEnsureDir (absPath)                   *
/* Ensures a directory exists (recursive)                      *
/***************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/***************************************************************
/* functionSignature: getRandSuffix ()                         *
/* Returns a short random suffix                               *
/***************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/***************************************************************
/* functionSignature: getGuessExtFromCtype (ctype)             *
/* Maps a content-type to a common video extension             *
/***************************************************************/
function getGuessExtFromCtype(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("webm")) return ".webm";
  if (c.includes("quicktime") || c.includes("mov")) return ".mov";
  return ".mp4";
}

/***************************************************************
/* functionSignature: getBuildPublicUrl (base, filename)       *
/* Builds a public URL for a saved documents file              *
/***************************************************************/
function getBuildPublicUrl(base, filename) {
  if (!base) return `/documents/${filename}`;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/***************************************************************
/* functionSignature: getSaveBuffer (buf, dirAbs, ext)         *
/* Saves a buffer into pub/documents and returns metadata      *
/***************************************************************/
function getSaveBuffer(buf, dirAbs, ext = ".mp4") {
  getEnsureDir(dirAbs);
  const filename = `video_${Date.now()}_${getRandSuffix()}${ext}`;
  const abs = path.join(dirAbs, filename);
  fs.writeFileSync(abs, buf);
  return { filename, abs };
}

/***************************************************************
/* functionSignature: getDownloadToBuffer (url)                *
/* Downloads a URL into a Buffer and returns {buf,ctype}       *
/***************************************************************/
async function getDownloadToBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "video/mp4";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}

/***************************************************************
/* functionSignature: getStrictToolConfig (wo)                 *
/* Reads and validates toolsconfig for this module             *
/***************************************************************/
function getStrictToolConfig(wo) {
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};
  const apiToken = String(cfg.apiToken || "").trim();
  const baseUrl = String(cfg.baseUrl || "https://api.replicate.com/v1");
  const model = String(cfg.model || "google/veo-3-fast");
  const pollIntervalMs = Number.isFinite(cfg.pollIntervalMs) ? cfg.pollIntervalMs : 5000;
  const timeoutMs = Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 600000;
  const public_base_url = typeof cfg.public_base_url === "string" ? cfg.public_base_url : null;
  if (!apiToken) throw new Error(`[${MODULE_NAME}] missing toolsconfig.${MODULE_NAME}.apiToken`);
  return { apiToken, baseUrl, model, pollIntervalMs, timeoutMs, public_base_url };
}

/***************************************************************
/* functionSignature: getCreatePrediction (cfg, input, model)  *
/* Starts a Replicate prediction and returns its id            *
/***************************************************************/
async function getCreatePrediction(cfg, input, model) {
  const [owner, name] = String(model).split("/");
  const url = `${cfg.baseUrl}/models/${owner}/${name}/predictions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`start failed: ${res.status} ${res.statusText} ${raw.slice(0,200)}`);
  const data = JSON.parse(raw);
  const id = data?.id || data?.prediction?.id || null;
  if (!id) throw new Error("start failed: missing prediction id");
  return id;
}

/***************************************************************
/* functionSignature: getWaitPrediction (cfg, id)              *
/* Polls Replicate until the prediction is done or times out   *
/***************************************************************/
async function getWaitPrediction(cfg, id) {
  const started = Date.now();
  for (;;) {
    const res = await fetch(`${cfg.baseUrl}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${cfg.apiToken}` }
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${res.statusText} ${raw.slice(0,200)}`);
    const data = JSON.parse(raw);
    const s = String(data?.status || "");
    if (s === "succeeded") return data;
    if (s === "failed" || s === "canceled") throw new Error(`prediction ${s}`);
    if (Date.now() - started > cfg.timeoutMs) throw new Error("poll timed out");
    await new Promise(r => setTimeout(r, cfg.pollIntervalMs));
  }
}

/***************************************************************
/* functionSignature: getExtractFirstOutputUrl (data)          *
/* Extracts the first output URL from Replicate response       *
/***************************************************************/
function getExtractFirstOutputUrl(data) {
  const out = data?.output;
  if (!out) return null;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && out.length) return out[0];
  if (out?.video) return out.video;
  return null;
}

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Generates a Veo 3 video via Replicate and saves the file    *
/***************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const cfg = getStrictToolConfig(wo);

  const prompt = String(args?.prompt || wo?.payload || "").trim();
  const image_url = String(args?.image_url || "").trim();

  if (!prompt) return { ok: false, error: "Missing prompt" };

  const model = cfg.model;

  const input = image_url
    ? { prompt, image: image_url }
    : { prompt };

  let predictionId;
  try {
    predictionId = await getCreatePrediction(cfg, input, model);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  let finalData;
  try {
    finalData = await getWaitPrediction(cfg, predictionId);
  } catch (e) {
    return { ok: false, error: e?.message || String(e), predictionId };
  }

  const url = getExtractFirstOutputUrl(finalData);
  if (!url) return { ok: false, error: "No output URL returned", predictionId };

  const { buf, ctype } = await getDownloadToBuffer(url);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const documentsDir = path.join(__dirname, "..", "pub", "documents");
  const saved = getSaveBuffer(buf, documentsDir, getGuessExtFromCtype(ctype));

  return {
    ok: true,
    provider: "replicate",
    model,
    predictionId,
    input,
    file: { filename: saved.filename, path: saved.abs, url: getBuildPublicUrl(cfg.public_base_url, saved.filename) }
  };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Simple rule: if image_url is provided, animate/transform that image with the prompt; if not, generate a video from the prompt alone.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text prompt describing the video or the transformation to apply." },
          image_url: { type: "string", description: "Public image URL to animate/transform. Provide when the task is animation/transformation; omit for pure generation." }
        },
        required: ["prompt"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
