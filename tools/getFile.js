/**************************************************************/
/* filename: "getFile.js"                                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import fs     from "node:fs/promises";
import path   from "node:path";
import { getUserDir, getUserId, getPublicBaseUrl } from "../core/file.js";
import { getPrefixedLogger } from "../core/logging.js";

const FS_TIMEOUT_MS = 10000;
function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${FS_TIMEOUT_MS}ms`)), FS_TIMEOUT_MS);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const MODULE_NAME = "getFile";


function getExtFromContentType(contentType) {
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const map = {
    "text/plain":               ".txt",
    "text/html":                ".html",
    "text/css":                 ".css",
    "text/javascript":          ".js",
    "application/javascript":   ".js",
    "application/json":         ".json",
    "application/xml":          ".xml",
    "text/xml":                 ".xml",
    "text/csv":                 ".csv",
    "text/markdown":            ".md",
    "application/pdf":          ".pdf",
    "application/zip":          ".zip"
  };
  return map[ct] || null;
}


function getExtFromFilename(filename) {
  const base = path.basename(String(filename || ""));
  const dot  = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot).toLowerCase();
  return ext.length > 1 && ext.length <= 8 ? ext : null;
}


function getSafePath(rawFilename) {
  const normalized = String(rawFilename || "").replace(/\\/g, "/");
  const segments   = normalized.split("/").filter(s => s && s !== "." && s !== "..");
  if (!segments.length) return { dir: "", base: "file" };
  const base = segments.pop();
  return { dir: segments.join("/"), base };
}

function getPositiveIntOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return NaN;
  return Math.floor(n);
}

function getChunkMeta(chunkIndex, totalChunks) {
  if (chunkIndex == null || totalChunks == null) return {};
  return {
    chunkIndex,
    totalChunks,
    hasMoreChunks: chunkIndex < totalChunks
  };
}


async function getInvoke(args, coreData) {
  const _log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const log = (msg) => { _log(msg); };
  const wo  = coreData?.workingObject || {};

  const filename    = String(args?.filename    || "").trim();
  const content     = String(args?.content     ?? "");
  const encoding    = String(args?.encoding    || "text").trim().toLowerCase();
  const contentType = String(args?.contentType || "").trim();
  const overwrite   = args?.overwrite === true;
  const append      = args?.append    === true;
  const search      = args?.search  != null ? String(args.search)  : null;
  const replace     = args?.replace != null ? String(args.replace) : null;
  const chunkIndex  = getPositiveIntOrNull(args?.chunkIndex);
  const totalChunks = getPositiveIntOrNull(args?.totalChunks);

  if (Number.isNaN(chunkIndex) || Number.isNaN(totalChunks)) {
    return { ok: false, error: "chunkIndex and totalChunks must be positive integers when provided" };
  }

  const hasChunking = chunkIndex != null || totalChunks != null;
  if (hasChunking && (chunkIndex == null || totalChunks == null)) {
    return { ok: false, error: "chunkIndex and totalChunks must be provided together" };
  }
  if (hasChunking && chunkIndex > totalChunks) {
    return { ok: false, error: "chunkIndex must be less than or equal to totalChunks" };
  }
  if (hasChunking && !filename) {
    return { ok: false, error: "filename is required for chunked writing" };
  }

  const effectiveAppend = append || (hasChunking && chunkIndex > 1);
  const effectiveOverwrite = hasChunking
    ? (!append && chunkIndex === 1)
    : overwrite;
  const isAppend  = effectiveAppend && !effectiveOverwrite && filename;
  const isReplace = search !== null && replace !== null && !overwrite && !append && filename;

  if (hasChunking && isReplace) {
    return { ok: false, error: "chunked writing is not supported together with search+replace mode" };
  }

  log(`invoke: filename=${filename || "(none)"} overwrite=${overwrite} append=${append} effectiveOverwrite=${effectiveOverwrite} effectiveAppend=${effectiveAppend} isReplace=${isReplace} chunkIndex=${chunkIndex ?? "-"} totalChunks=${totalChunks ?? "-"} contentLen=${String(args?.content ?? "").length}`);

  if (!isReplace && args?.content == null) {
    log("rejected: content empty");
    return { ok: false, error: "content is required" };
  }

  const userRoot = getUserDir(wo);
  const { dir: subDir, base: baseName } = getSafePath(filename);
  const ext = getExtFromFilename(filename)
    || getExtFromContentType(contentType)
    || (encoding === "base64" ? ".bin" : ".txt");
  const targetDir = subDir ? path.join(userRoot, subDir) : userRoot;

  log(`resolved: userRoot=${userRoot} targetDir=${targetDir} ext=${ext}`);

  // ── APPEND ──────────────────────────────────────────────────────────────
  if (isAppend) {
    const { dir: aSubDir, base: aBase } = getSafePath(filename);
    const aExt = getExtFromFilename(filename) || ".txt";
    const aNameNoExt = aBase.replace(/\.[^.]+$/, "") || "file";
    const aSafeBase  = aNameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    const aFinalName = aSafeBase + aExt;
    const aTargetDir = aSubDir ? path.join(userRoot, aSubDir) : userRoot;
    const aAbsPath   = path.join(aTargetDir, aFinalName);

    log(`append: path=${aAbsPath}`);

    let appendBuffer;
    try {
      appendBuffer = Buffer.from(content, "utf8");
    } catch (e) {
      return { ok: false, error: `Failed to encode append content: ${e?.message || String(e)}` };
    }

    try {
      log("append: mkdir start");
      await withTimeout(fs.mkdir(aTargetDir, { recursive: true }), "mkdir");
      log("append: mkdir done, appendFile start");
      await withTimeout(fs.appendFile(aAbsPath, appendBuffer), "appendFile");
      log("append: appendFile done");
    } catch (e) {
      log(`append: error ${e?.message}`);
      return { ok: false, error: `Failed to append to file: ${e?.message || String(e)}` };
    }

    log("append: stat start");
    const stat    = await withTimeout(fs.stat(aAbsPath), "stat");
    log(`append: done bytes=${stat.size}`);
    const userId  = getUserId(wo);
    const baseUrl = getPublicBaseUrl(wo);
    const relPath = aSubDir ? `${aSubDir}/${aFinalName}` : aFinalName;
    const url     = baseUrl
      ? `${baseUrl}/documents/${userId}/${relPath}`
      : `/documents/${userId}/${relPath}`;

    return { ok: true, filename: relPath, url, path: aAbsPath, bytes: stat.size, appended: appendBuffer.length, ...getChunkMeta(chunkIndex, totalChunks) };
  }

  // ── REPLACE (find-and-replace within existing file) ────────────────────
  if (isReplace) {
    if (search === "") {
      return { ok: false, error: "search string must not be empty — use overwrite: true to replace an entire file" };
    }

    const { dir: rSubDir, base: rBase } = getSafePath(filename);
    const rExt = getExtFromFilename(filename) || ".txt";
    const rNameNoExt = rBase.replace(/\.[^.]+$/, "") || "file";
    const rSafeBase  = rNameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    const rFinalName = rSafeBase + rExt;
    const rTargetDir = rSubDir ? path.join(userRoot, rSubDir) : userRoot;
    const rAbsPath   = path.join(rTargetDir, rFinalName);

    log(`replace: path=${rAbsPath} searchLen=${search.length}`);

    let existing;
    try {
      log("replace: readFile start");
      existing = await withTimeout(fs.readFile(rAbsPath, "utf8"), "readFile");
      log(`replace: readFile done existingLen=${existing.length}`);
    } catch (e) {
      if (e?.code === "ENOENT") {
        return { ok: false, error: `File not found: ${filename} — use overwrite: true with content to create a new file` };
      }
      return { ok: false, error: `File not found or unreadable for replace: ${e?.message || String(e)}` };
    }

    if (!existing.includes(search)) {
      return { ok: false, error: "search string not found in file — no changes made" };
    }

    const updated = existing.split(search).join(replace);

    try {
      log("replace: writeFile start");
      await withTimeout(fs.writeFile(rAbsPath, updated, "utf8"), "writeFile");
      log("replace: writeFile done");
    } catch (e) {
      return { ok: false, error: `Failed to write replaced file: ${e?.message || String(e)}` };
    }

    const userId  = getUserId(wo);
    const baseUrl = getPublicBaseUrl(wo);
    const relPath = rSubDir ? `${rSubDir}/${rFinalName}` : rFinalName;
    const url     = baseUrl
      ? `${baseUrl}/documents/${userId}/${relPath}`
      : `/documents/${userId}/${relPath}`;
    const occurrences = (existing.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

    return { ok: true, filename: relPath, url, path: rAbsPath, bytes: Buffer.byteLength(updated, "utf8"), occurrences };
  }

  // ── WRITE / OVERWRITE ─────────────────────────────────────────────────
  let buffer;
  try {
    buffer = encoding === "base64"
      ? Buffer.from(content, "base64")
      : Buffer.from(content, "utf8");
  } catch (e) {
    return { ok: false, error: `Failed to encode content: ${e?.message || String(e)}` };
  }

  let finalName;
  if (filename && effectiveOverwrite) {
    const nameNoExt = baseName.replace(/\.[^.]+$/, "") || "file";
    const safeBase  = nameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    finalName = safeBase + ext;
  } else if (filename) {
    const nameNoExt = baseName.replace(/\.[^.]+$/, "") || "file";
    const safeBase  = nameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    let candidate = safeBase + ext;
    let counter   = 0;
    log(`write: unique-name loop start for ${safeBase}`);
    while (counter < 50) {
      try {
        await fs.access(path.join(targetDir, candidate));
        counter++;
        candidate = safeBase + "-" + counter + ext;
      } catch {
        break;
      }
    }
    log(`write: unique-name loop done counter=${counter} candidate=${candidate}`);
    if (counter >= 50) {
      return { ok: false, error: `Too many files named '${safeBase}' — use overwrite: true to update the existing file` };
    }
    finalName = candidate;
  } else {
    finalName = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  }

  const absPath = path.join(targetDir, finalName);
  log(`write: path=${absPath} bufferLen=${buffer.length}`);

  try {
    log("write: mkdir start");
    await withTimeout(fs.mkdir(targetDir, { recursive: true }), "mkdir");
    log("write: mkdir done, writeFile start");
    await withTimeout(fs.writeFile(absPath, buffer), "writeFile");
    log("write: writeFile done");
  } catch (e) {
    log(`write: error ${e?.message}`);
    return { ok: false, error: `Failed to write file: ${e?.message || String(e)}` };
  }

  const userId  = getUserId(wo);
  const baseUrl = getPublicBaseUrl(wo);
  const relPath = subDir ? `${subDir}/${finalName}` : finalName;
  const url     = baseUrl
    ? `${baseUrl}/documents/${userId}/${relPath}`
    : `/documents/${userId}/${relPath}`;

  log(`write: success relPath=${relPath}`);
  return { ok: true, filename: relPath, url, path: absPath, bytes: buffer.length, ...getChunkMeta(chunkIndex, totalChunks) };
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
