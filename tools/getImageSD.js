/**************************************************************/
/* filename: "getImageSD.js"                                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/







import { fetch, Agent } from "undici";
import { saveFile } from "../core/file.js";

const MODULE_NAME = "getImageSD";


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


function getStripDataUrlPrefix(b64) {
  if (typeof b64 !== "string") return b64;
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}


async function getPersistSDImages(b64List, wo) {
  const out = [];
  for (const raw of b64List) {
    try {
      const b64 = getStripDataUrlPrefix(raw);
      if (!b64 || typeof b64 !== "string") {
        out.push({ ok: false, error: "Empty image payload" });
        continue;
      }
      const buf = Buffer.from(b64, "base64");
      const saved = await saveFile(wo, buf, { prefix: "img", ext: ".png" });
      out.push({
        ok: true,
        filename: saved.filename,
        path: saved.absPath,
        url: saved.url,
        source: "b64"
      });
    } catch (e) {
      out.push({ ok: false, error: e?.message || String(e) });
    }
  }
  return out;
}


function getNumSafe(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const toolCfg = wo?.toolsconfig?.getImageSD || {};

  const baseUrl = typeof toolCfg.baseUrl === "string" ? toolCfg.baseUrl : null;
  if (!baseUrl) return { ok: false, error: "Missing toolsconfig.getImageSD.baseUrl" };

  const prompt = String(args?.prompt || "").trim();
  if (!prompt) return { ok: false, error: "Missing prompt" };

  const sizeStr = String(toolCfg.size || "1024x1024");
  const { width, height } = getParseSize(sizeStr);

  let n = getNumSafe(toolCfg.n, 1);
  if (n < 1) n = 1;
  if (n > 8) n = 8;

  const steps = getNumSafe(toolCfg.steps, 20);
  const cfg_scale = getNumSafe(toolCfg.cfgScale ?? toolCfg.cfg, 6.5);
  const sampler_name = typeof toolCfg.sampler === "string" && toolCfg.sampler.length ? toolCfg.sampler : "DPM++ 2M Karras";
  const seed = getNumSafe(toolCfg.seed, -1);

  const negativePrompt = String(toolCfg.negativePrompt || "").trim();
  const negative_prompt = [
    negativePrompt,
    (typeof toolCfg.negativeExtra === "string" && toolCfg.negativeExtra.trim()) ? toolCfg.negativeExtra.trim() : ""
  ].filter(Boolean).join(", ");

  const model = (typeof toolCfg.model === "string" && toolCfg.model.length) ? toolCfg.model : null;

  const timeoutMs = getNumSafe(toolCfg.timeoutMs, 120000);
  const netTimeoutMs = getNumSafe(toolCfg.networkTimeoutMs, 1800000);
  const agent = new Agent({ headersTimeout: netTimeoutMs, bodyTimeout: 0 });

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
    if (toolCfg.headers && typeof toolCfg.headers === "object") {
      for (const [k, v] of Object.entries(toolCfg.headers)) {
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

  const saved = await getPersistSDImages(images, wo);
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
    url: okFiles[0]?.url || null,
    files: okFiles.map(f => ({ filename: f.filename, path: f.path, url: f.url })),
    failed: saved.filter(x => !x.ok).map(x => ({ error: x.error }))
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
