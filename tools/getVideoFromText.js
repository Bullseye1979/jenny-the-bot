/**********************************************************************************/
/* filename: getVideoFromText.js                                                   *
/* Version 1.0                                                                     *
/* Purpose: Create a short video from text via Replicate (Google Veo 3), save      *
/*          it under ./pub/documents, and return a public URL.                     *
/**********************************************************************************/

import { saveFile } from "../core/file.js";
import { getSecret } from "../core/secrets.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getVideoFromText";


function getGuessExtFromCtype(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (c.includes("webm")) return ".webm";
  if (c.includes("quicktime") || c.includes("mov")) return ".mov";
  return ".mp4";
}


async function getDownloadToBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "video/mp4";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}


async function resolveToolConfig(wo = {}, args = {}) {
  const tc = wo?.toolsconfig?.getVideoFromText || {};
  const apiToken = await getSecret(wo, String(args.videoApiToken || tc.videoApiToken || wo.videoApiToken || "").trim());
  const baseUrl  = String(args.videoBaseUrl  || tc.videoBaseUrl  || wo.videoBaseUrl  || "https://api.replicate.com/v1").trim();
  const model    = String(args.videoModel    || tc.videoModel    || wo.videoModel    || "google/veo-3").trim();
  const pollIntervalMs = Number.isFinite(args.videoPollIntervalMs)
    ? args.videoPollIntervalMs
    : (Number.isFinite(tc.videoPollIntervalMs) ? tc.videoPollIntervalMs
      : (Number.isFinite(wo.videoPollIntervalMs) ? wo.videoPollIntervalMs : 5000));
  const timeoutMs = Number.isFinite(args.videoTimeoutMs)
    ? args.videoTimeoutMs
    : (Number.isFinite(tc.videoTimeoutMs) ? tc.videoTimeoutMs
      : (Number.isFinite(wo.videoTimeoutMs) ? wo.videoTimeoutMs : 600000));
  const publicBaseUrl = typeof (args.videoPublicBaseUrl || tc.videoPublicBaseUrl || wo.videoPublicBaseUrl) === "string"
    ? String(args.videoPublicBaseUrl || tc.videoPublicBaseUrl || wo.videoPublicBaseUrl).replace(/\/+$/, "")
    : null;
  if (!apiToken) throw new Error(`[${MODULE_NAME}] missing toolsconfig.getVideoFromText.videoApiToken (or args.videoApiToken)`);
  return { apiToken, baseUrl, model, pollIntervalMs, timeoutMs, publicBaseUrl };
}


async function getCreatePrediction(cfg, input, model) {

  const url = `${cfg.baseUrl}/predictions`;
  const payload = {
    version: String(model),
    input
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`start failed: ${res.status} ${res.statusText} ${raw.slice(0, 200)}`);
  }

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


function getBuildInput(prompt) {
  const p = String(prompt || "");
  return { prompt: p };
}


async function getRunSinglePrediction({ cfg, model, input, wo }) {
  let predictionId;
  try {
    predictionId = await getCreatePrediction(cfg, input, model);
    const finalData = await getWaitPrediction(cfg, predictionId);
    const url = getExtractFirstOutputUrl(finalData);
    if (!url) return { ok: false, error: "No output URL returned", predictionId };
    const { buf, ctype } = await getDownloadToBuffer(url);
    const ext = getGuessExtFromCtype(ctype);
    const saved = await saveFile(wo, buf, { prefix: "video", ext });
    return {
      ok: true,
      provider: "replicate",
      model,
      predictionId,
      file: {
        filename: saved.filename,
        path: saved.absPath,
        url: saved.url
      }
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), predictionId };
  }
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo = coreData?.workingObject || {};
  let cfg;
  try {
    cfg = await resolveToolConfig(wo, args);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  const prompt = String(args?.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };
  const input = getBuildInput(prompt);
  const res = await getRunSinglePrediction({ cfg, model: cfg.model, input, wo });
  if (res.ok) res.input = input;
  return res;
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
