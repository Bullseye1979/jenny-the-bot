/**************************************************************/
/* filename: "file.js"                                              */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper.                     */
/**************************************************************/








import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PUB_DOCUMENTS = path.join(__dirname, "..", "pub", "documents");
const IMAGE_EXTS    = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

function getRandSuffix() {
  return Math.random().toString(36).slice(2, 8);
}


export function getUserId(wo) {
  const id = String(wo?.userId || wo?.webAuth?.userId || wo?.webAuth?.id || "").trim();
  return id.replace(/[^a-zA-Z0-9_-]/g, "") || "shared";
}


export function getPublicBaseUrl(wo, overrideUrl) {
  const url = overrideUrl || wo?.baseUrl || "";
  return String(url).replace(/\/$/, "");
}


export function getUserDir(wo) {
  return path.join(PUB_DOCUMENTS, getUserId(wo));
}


export async function ensureUserDir(wo) {
  const dir = getUserDir(wo);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}


export async function getUniqueFilename(dir, baseName, ext) {
  const safeBase = String(baseName || "file").replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  let filename = safeBase + ext;
  let counter  = 0;
  while (true) {
    try {
      await fs.access(path.join(dir, filename));
      counter++;
      filename = safeBase + "-" + counter + ext;
    } catch {
      break;
    }
  }
  return filename;
}


export async function saveFile(wo, buffer, options = {}) {
  const dir = await ensureUserDir(wo);
  const ext = String(options.ext || ".bin");

  let filename;
  if (options.name) {
    filename = await getUniqueFilename(dir, options.name, ext);
  } else {
    const prefix = String(options.prefix || "file");
    filename = `${prefix}_${Date.now()}_${getRandSuffix()}${ext}`;
  }

  await fs.writeFile(path.join(dir, filename), buffer);

  const userId  = getUserId(wo);
  const baseUrl = getPublicBaseUrl(wo, options.publicBaseUrl);
  const url     = baseUrl
    ? `${baseUrl}/documents/${userId}/${filename}`
    : `/documents/${userId}/${filename}`;

  return { filename, url, absPath: path.join(dir, filename), userId, dir };
}


export async function deleteFile(wo, filename) {
  const safe = path.basename(String(filename || ""));
  if (!safe) throw new Error("invalid filename");
  await fs.unlink(path.join(getUserDir(wo), safe));
}


export async function listUserFiles(wo) {
  try {
    const entries = await fs.readdir(getUserDir(wo), { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name).sort();
  } catch {
    return [];
  }
}


export async function listUserImages(wo) {
  const files = await listUserFiles(wo);
  return files.filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
}

export default { saveFile, deleteFile, listUserFiles, listUserImages, getUserId, getUserDir, getPublicBaseUrl, ensureUserDir, getUniqueFilename };
