/**************************************************************/
/* filename: "getZIP.js"                                            */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import path from "node:path";
import JSZip from "jszip";
import { saveFile, getUserId, getPublicBaseUrl } from "../core/file.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getZIP";


function getFilenameFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || "file");
  } catch {
    const parts = String(rawUrl).split("/").filter(Boolean);
    return parts[parts.length - 1] || "file";
  }
}


function getRelativePath(fileUrl, baseUrl) {
  if (!baseUrl) return null;
  const base = String(baseUrl).replace(/\/?$/, "/");
  const file = String(fileUrl);
  if (!file.startsWith(base)) return null;
  try {
    return decodeURIComponent(file.slice(base.length));
  } catch {
    return file.slice(base.length);
  }
}


function getSafeZipPath(relPath) {
  const normalized = String(relPath || "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter(s => s && s !== "." && s !== "..");
  return segments.join("/") || "file";
}


async function getDownloadBuffer(url, timeoutMs) {
  try {
    const res = await fetchWithTimeout(String(url), {}, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, buf };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : (e?.message || String(e)) };
  }
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const wo = coreData?.workingObject || {};

  const urls       = Array.isArray(args?.urls) ? args.urls.map(u => String(u || "").trim()).filter(Boolean) : [];
  const baseUrl    = String(args?.baseUrl || "").trim();
  const zipName    = String(args?.filename || "").trim() || "archive";
  const timeoutMs  = Math.max(5000, Number.isFinite(Number(args?.timeoutMs)) ? Number(args.timeoutMs) : 30000);

  if (!urls.length) return { ok: false, error: "urls array is required and must not be empty" };

  const zip     = new JSZip();
  const results = [];
  let   added   = 0;

  for (const url of urls) {
    const relPath  = getRelativePath(url, baseUrl);
    const zipPath  = relPath ? getSafeZipPath(relPath) : getSafeZipPath(getFilenameFromUrl(url));
    const download = await getDownloadBuffer(url, timeoutMs);

    if (!download.ok) {
      results.push({ url, zipPath, ok: false, error: download.error });
      continue;
    }

    zip.file(zipPath, download.buf);
    results.push({ url, zipPath, ok: true, bytes: download.buf.length });
    added++;
  }

  if (!added) {
    return { ok: false, error: "No files could be downloaded", results };
  }

  let zipBuffer;
  try {
    zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  } catch (e) {
    return { ok: false, error: `Failed to generate ZIP: ${e?.message || String(e)}`, results };
  }

  const baseName = path.basename(zipName, ".zip") || "archive";

  try {
    const saved = await saveFile(wo, zipBuffer, { name: baseName, ext: ".zip" });
    return {
      ok:       true,
      filename: saved.filename,
      url:      saved.url,
      path:     saved.absPath,
      bytes:    zipBuffer.length,
      files:    added,
      results
    };
  } catch (e) {
    return { ok: false, error: `Failed to save ZIP: ${e?.message || String(e)}`, results };
  }
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
