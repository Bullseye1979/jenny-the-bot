/**************************************************************/
/* filename: "getFile.js"                                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import fs   from "node:fs/promises";
import path from "node:path";
import { getUserDir, getUserId, getPublicBaseUrl } from "../core/file.js";

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


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};

  const filename    = String(args?.filename    || "").trim();
  const content     = String(args?.content     ?? "");
  const encoding    = String(args?.encoding    || "text").trim().toLowerCase();
  const contentType = String(args?.contentType || "").trim();
  const overwrite   = args?.overwrite === true;
  const append      = args?.append    === true;
  const search      = args?.search  != null ? String(args.search)  : null;
  const replace     = args?.replace != null ? String(args.replace) : null;

  const isAppend  = append && filename;
  const isReplace = search !== null && replace !== null && filename;

  if (!isAppend && !isReplace && args?.content === undefined) {
    return { ok: false, error: "content is required" };
  }

  const userRoot = getUserDir(wo);
  const { dir: subDir, base: baseName } = getSafePath(filename);
  const ext = getExtFromFilename(filename)
    || getExtFromContentType(contentType)
    || (encoding === "base64" ? ".bin" : ".txt");
  const targetDir = subDir ? path.join(userRoot, subDir) : userRoot;

  // ── APPEND ──────────────────────────────────────────────────────────────
  if (isAppend) {
    const { dir: aSubDir, base: aBase } = getSafePath(filename);
    const aExt = getExtFromFilename(filename) || ".txt";
    const aNameNoExt = aBase.replace(/\.[^.]+$/, "") || "file";
    const aSafeBase  = aNameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    const aFinalName = aSafeBase + aExt;
    const aTargetDir = aSubDir ? path.join(userRoot, aSubDir) : userRoot;
    const aAbsPath   = path.join(aTargetDir, aFinalName);

    let appendBuffer;
    try {
      appendBuffer = Buffer.from(content, "utf8");
    } catch (e) {
      return { ok: false, error: `Failed to encode append content: ${e?.message || String(e)}` };
    }

    try {
      await fs.mkdir(aTargetDir, { recursive: true });
      await fs.appendFile(aAbsPath, appendBuffer);
    } catch (e) {
      return { ok: false, error: `Failed to append to file: ${e?.message || String(e)}` };
    }

    const stat    = await fs.stat(aAbsPath);
    const userId  = getUserId(wo);
    const baseUrl = getPublicBaseUrl(wo);
    const relPath = aSubDir ? `${aSubDir}/${aFinalName}` : aFinalName;
    const url     = baseUrl
      ? `${baseUrl}/documents/${userId}/${relPath}`
      : `/documents/${userId}/${relPath}`;

    return { ok: true, filename: relPath, url, path: aAbsPath, bytes: stat.size, appended: appendBuffer.length };
  }

  // ── REPLACE (find-and-replace within existing file) ────────────────────
  if (isReplace) {
    const { dir: rSubDir, base: rBase } = getSafePath(filename);
    const rExt = getExtFromFilename(filename) || ".txt";
    const rNameNoExt = rBase.replace(/\.[^.]+$/, "") || "file";
    const rSafeBase  = rNameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    const rFinalName = rSafeBase + rExt;
    const rTargetDir = rSubDir ? path.join(userRoot, rSubDir) : userRoot;
    const rAbsPath   = path.join(rTargetDir, rFinalName);

    let existing;
    try {
      existing = await fs.readFile(rAbsPath, "utf8");
    } catch (e) {
      return { ok: false, error: `File not found or unreadable for replace: ${e?.message || String(e)}` };
    }

    if (!existing.includes(search)) {
      return { ok: false, error: "search string not found in file — no changes made" };
    }

    const updated = existing.split(search).join(replace);

    try {
      await fs.writeFile(rAbsPath, updated, "utf8");
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
  if (filename && overwrite) {
    const nameNoExt = baseName.replace(/\.[^.]+$/, "") || "file";
    const safeBase  = nameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    finalName = safeBase + ext;
  } else if (filename) {
    const nameNoExt = baseName.replace(/\.[^.]+$/, "") || "file";
    const safeBase  = nameNoExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
    let candidate = safeBase + ext;
    let counter   = 0;
    while (true) {
      try {
        await fs.access(path.join(targetDir, candidate));
        counter++;
        candidate = safeBase + "-" + counter + ext;
      } catch {
        break;
      }
    }
    finalName = candidate;
  } else {
    finalName = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  }

  const absPath = path.join(targetDir, finalName);

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(absPath, buffer);
  } catch (e) {
    return { ok: false, error: `Failed to write file: ${e?.message || String(e)}` };
  }

  const userId  = getUserId(wo);
  const baseUrl = getPublicBaseUrl(wo);
  const relPath = subDir ? `${subDir}/${finalName}` : finalName;
  const url     = baseUrl
    ? `${baseUrl}/documents/${userId}/${relPath}`
    : `/documents/${userId}/${relPath}`;

  return { ok: true, filename: relPath, url, path: absPath, bytes: buffer.length };
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
