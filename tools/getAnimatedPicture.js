/***************************************************************
/* filename: "geAnimatedPicture.js"                            *
/* Version 1.0                                                 *
/* Purpose: Animate/transform ONE existing image per prompt    *
/*          via Replicate (Veo), save video under ./pub        *
/*          and return a public URL.                           *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "geAnimatedPicture";

/***************************************************************
/* utils                                                       *
/***************************************************************/
function getEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}
function getGuessExtFromCtype(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("webm")) return ".webm";
  if (c.includes("quicktime") || c.includes("mov")) return ".mov";
  return ".mp4";
}
function getBuildPublicUrl(base, filename) {
  if (!base) return `/documents/${filename}`;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}
function getSaveBuffer(buf, dirAbs, ext = ".mp4") {
  getEnsureDir(dirAbs);
  const filename = `video_${Date.now()}_${getRandSuffix()}${ext}`;
  const abs = path.join(dirAbs, filename);
  fs.writeFileSync(abs, buf);
  return { filename, abs };
}
async function getDownloadToBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "video/mp4";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}

/***************************************************************
/* config from workingObject (video*)                          *
/***************************************************************/
function getStrictToolConfigFromWO(wo = {}) {
  const apiToken = String(wo.videoApiToken || "").trim();
  if (!apiToken) throw new Error(`[${MODULE_NAME}] missing workingObject.videoApiToken`);

  const baseUrl = String(wo.videoBaseUrl || "https://api.replicate.com/v1").trim();
  const model = String(wo.videoModel || "google/veo-3-fast").trim();

  const pollIntervalMs = Number.isFinite(wo.videoPollIntervalMs) ? wo.videoPollIntervalMs : 5000;
  const timeoutMs = Number.isFinite(wo.videoTimeoutMs) ? wo.videoTimeoutMs : 600000;

  const public_base_url =
    typeof wo.videoPublicBaseUrl === "string" ? wo.videoPublicBaseUrl.replace(/\/+$/, "") : null;

  return { apiToken, baseUrl, model, pollIntervalMs, timeoutMs, public_base_url };
}

/***************************************************************
/* replicate helpers                                           *
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
function getExtractFirstOutputUrl(data) {
  const out = data?.output;
  if (!out) return null;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && out.length) return out[0];
  if (out?.video) return out.video;
  return null;
}

/***************************************************************
/* input-building                                              *
/***************************************************************/
function validateImageUrl(u) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}
function buildInput(prompt, imageUrl) {
  const p = String(prompt || "");
  return {
    prompt: p,
    text_prompt: p,
    image: imageUrl,
    image_url: imageUrl,
    init_image: imageUrl
  };
}

/***************************************************************
/* single prediction                                           *
/***************************************************************/
async function runSinglePrediction({ cfg, model, input }) {
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

/***************************************************************
/* invoke                                                      *
/***************************************************************/
async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const cfg = getStrictToolConfigFromWO(wo);

  const prompt = String(args?.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };

  const imageURL = validateImageUrl(args?.imageURL);
  if (!imageURL) return { ok: false, error: `[${MODULE_NAME}] Missing or invalid 'imageURL' (must be http/https).` };

  const input = buildInput(prompt, imageURL);
  const res = await runSinglePrediction({ cfg, model: cfg.model, input });
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
        "Animate/transform an existing image from the provided imageURL into a short video using Replicate Veo. Use this when asked to animate something.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Describe how the given image should be animated/transformed." },
          imageURL: { type: "string", format: "uri", description: "Public image URL (http/https) to animate/transform." }
        },
        required: ["prompt", "imageURL"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
