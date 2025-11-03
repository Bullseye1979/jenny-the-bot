/********************************************************************************
/* filename: "getAnimatedPicture.js"                                            *
/* Version 1.0                                                                  *
/* Purpose: Animate an image via Replicate (Veo) and save the video to          *
/*          ./pub/documents, returning a public URL                             *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "getAnimatedPicture";

/********************************************************************************
/* functionSignature: getEnsureDir (absPath)                                    *
/* Ensures a directory exists                                                   *
/********************************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/********************************************************************************
/* functionSignature: getRandSuffix ()                                          *
/* Returns a short random lowercase base36 suffix                               *
/********************************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/********************************************************************************
/* functionSignature: getGuessExtFromCtype (ctype)                              *
/* Guesses a video file extension from content-type                             *
/********************************************************************************/
function getGuessExtFromCtype(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("webm")) return ".webm";
  if (c.includes("quicktime") || c.includes("mov")) return ".mov";
  return ".mp4";
}

/********************************************************************************
/* functionSignature: getBuildPublicUrl (base, filename)                        *
/* Builds a public URL for a given filename                                     *
/********************************************************************************/
function getBuildPublicUrl(base, filename) {
  if (!base) return `/documents/${filename}`;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/********************************************************************************
/* functionSignature: getSaveBuffer (buf, dirAbs, ext)                          *
/* Saves a buffer to disk with a generated name                                 *
/********************************************************************************/
function getSaveBuffer(buf, dirAbs, ext = ".mp4") {
  getEnsureDir(dirAbs);
  const filename = `video_${Date.now()}_${getRandSuffix()}${ext}`;
  const abs = path.join(dirAbs, filename);
  fs.writeFileSync(abs, buf);
  return { filename, abs };
}

/********************************************************************************
/* functionSignature: getDownloadToBuffer (url)                                 *
/* Downloads a URL and returns buffer and content-type                          *
/********************************************************************************/
async function getDownloadToBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "video/mp4";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}

/********************************************************************************
/* functionSignature: resolveToolConfig (wo, args)                              *
/* Build config from toolsconfig.getAnimatedPicture with                        *
/* args overrides and legacy workingObject fallbacks                            *
/********************************************************************************/
function resolveToolConfig(wo = {}, args = {}) {
  const tc = wo?.toolsconfig?.getAnimatedPicture || {};
  const apiToken = String(args.videoApiToken || tc.videoApiToken || wo.videoApiToken || "").trim();
  const baseUrl = String(args.videoBaseUrl || tc.videoBaseUrl || wo.videoBaseUrl || "https://api.replicate.com/v1").trim();
  const model = String(args.videoModel || tc.videoModel || wo.videoModel || "google/veo-3").trim();
  const pollIntervalMs = Number.isFinite(args.videoPollIntervalMs)
    ? args.videoPollIntervalMs
    : (Number.isFinite(tc.videoPollIntervalMs) ? tc.videoPollIntervalMs
      : (Number.isFinite(wo.videoPollIntervalMs) ? wo.videoPollIntervalMs : 5000));
  const timeoutMs = Number.isFinite(args.videoTimeoutMs)
    ? args.videoTimeoutMs
    : (Number.isFinite(tc.videoTimeoutMs) ? tc.videoTimeoutMs
      : (Number.isFinite(wo.videoTimeoutMs) ? wo.videoTimeoutMs : 600000));
  const public_base_url = typeof (args.videoPublicBaseUrl || tc.videoPublicBaseUrl || wo.videoPublicBaseUrl) === "string"
    ? String(args.videoPublicBaseUrl || tc.videoPublicBaseUrl || wo.videoPublicBaseUrl).replace(/\/+$/, "")
    : null;
  if (!apiToken) throw new Error(`[${MODULE_NAME}] missing toolsconfig.getAnimatedPicture.videoApiToken (or args.videoApiToken)`);
  return { apiToken, baseUrl, model, pollIntervalMs, timeoutMs, public_base_url };
}

/********************************************************************************
/* functionSignature: getCreatePrediction (cfg, input, model)                   *
/* Starts a prediction and returns its id                                       *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getWaitPrediction (cfg, id)                               *
/* Polls a prediction until completion or timeout                               *
/********************************************************************************/
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

/********************************************************************************
/* functionSignature: getExtractFirstOutputUrl (data)                           *
/* Extracts the first output URL from prediction data                           *
/********************************************************************************/
function getExtractFirstOutputUrl(data) {
  const out = data?.output;
  if (!out) return null;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && out.length) return out[0];
  if (out?.video) return out.video;
  return null;
}

/********************************************************************************
/* functionSignature: getValidateImageUrl (u)                                   *
/* Validates and normalizes an http/https image URL                             *
/********************************************************************************/
function getValidateImageUrl(u) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

/********************************************************************************
/* functionSignature: getBuildInput (prompt, imageUrl)                          *
/* Builds a minimal image-to-video input object                                 *
/********************************************************************************/
function getBuildInput(prompt, imageUrl) {
  const p = String(prompt || "");
  return {
    prompt: p,
    image: imageUrl
  };
}

/********************************************************************************
/* functionSignature: getRunSinglePrediction ({ cfg, model, input })            *
/* Runs one prediction, downloads, saves, and returns metadata                  *
/********************************************************************************/
async function getRunSinglePrediction({ cfg, model, input }) {
  let predictionId;
  try {
    predictionId = await getCreatePrediction(cfg, input, model);
    const finalData = await getWaitPrediction(cfg, predictionId);
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
      file: {
        filename: saved.filename,
        path: saved.abs,
        url: getBuildPublicUrl(cfg.public_base_url, saved.filename)
      }
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), predictionId };
  }
}

/********************************************************************************
/* functionSignature: getInvoke (args, coreData)                                *
/* Main entry: validates input, runs prediction, returns result                 *
/********************************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  let cfg;
  try {
    cfg = resolveToolConfig(wo, args);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  const prompt = String(args?.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };
  const imageURL = getValidateImageUrl(args?.imageURL);
  if (!imageURL) return { ok: false, error: `[${MODULE_NAME}] Missing or invalid 'imageURL' (must be http/https).` };
  const input = getBuildInput(prompt, imageURL);
  const res = await getRunSinglePrediction({ cfg, model: cfg.model, input });
  if (res.ok) res.input = input;
  return res;
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description:
        "Animate/transform an existing image from the provided imageURL into a short video using Replicate (Google Veo 3). Use this when asked to animate something.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Describe how the given image should be animated/transformed." },
          imageURL: { type: "string", format: "uri", description: "Public image URL (http/https) to animate/transform." },
          videoApiToken: { type: "string", description: "Override Replicate API token (defaults to toolsconfig.getAnimatedPicture.videoApiToken)" },
          videoBaseUrl: { type: "string", description: "Override Replicate base URL (defaults to toolsconfig.getAnimatedPicture.videoBaseUrl)" },
          videoModel: { type: "string", description: "Override model (defaults to toolsconfig.getAnimatedPicture.videoModel, e.g., 'google/veo-3')" },
          videoPollIntervalMs: { type: "number", description: "Override poll interval in ms (defaults to toolsconfig…)" },
          videoTimeoutMs: { type: "number", description: "Override timeout in ms (defaults to toolsconfig…)" },
          videoPublicBaseUrl: { type: "string", description: "Override public base URL for saved files (defaults to toolsconfig…)" }
        },
        required: ["prompt", "imageURL"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
