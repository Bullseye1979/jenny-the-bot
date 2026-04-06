










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
  const content     = args?.content;
  const encoding    = String(args?.encoding    || "text").trim().toLowerCase();
  const contentType = String(args?.contentType || "").trim();
  const overwrite   = args?.overwrite === true;

  if (content === undefined || content === null) {
    return { ok: false, error: "content is required" };
  }

  let buffer;
  try {
    buffer = encoding === "base64"
      ? Buffer.from(String(content), "base64")
      : Buffer.from(String(content), "utf8");
  } catch (e) {
    return { ok: false, error: `Failed to encode content: ${e?.message || String(e)}` };
  }

  const { dir: subDir, base: baseName } = getSafePath(filename);

  const ext = getExtFromFilename(filename)
    || getExtFromContentType(contentType)
    || (encoding === "base64" ? ".bin" : ".txt");

  const userRoot = getUserDir(wo);
  const targetDir = subDir ? path.join(userRoot, subDir) : userRoot;

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

  return {
    ok:       true,
    filename: relPath,
    url,
    path:     absPath,
    bytes:    buffer.length
  };
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
