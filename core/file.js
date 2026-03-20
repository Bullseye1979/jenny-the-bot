/************************************************************************************/
/* filename: core/file.js                                                            *
/* Version 1.0                                                                       *
/* Purpose: Centralised file persistence for all tools and flows.                    *
/*          Files are stored per user in pub/documents/{userId}/                     *
/*          Public URLs: {wo.baseUrl}/documents/{userId}/{filename}                  *
/************************************************************************************/

import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PUB_DOCUMENTS = path.join(__dirname, "..", "pub", "documents");
const IMAGE_EXTS    = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

function getRandSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

/************************************************************************************/
/* functionSignature: getUserId (wo)                                                 *
/* Resolves a safe userId from the workingObject.                                    *
/* Precedence: wo.userId → wo.webAuth.userId → wo.webAuth.id → "shared"             *
/************************************************************************************/
export function getUserId(wo) {
  const id = String(wo?.userId || wo?.webAuth?.userId || wo?.webAuth?.id || "").trim();
  return id.replace(/[^a-zA-Z0-9_-]/g, "") || "shared";
}

/************************************************************************************/
/* functionSignature: getPublicBaseUrl (wo, overrideUrl?)                            *
/* Resolves the base URL for constructing public file URLs.                          *
/* Uses wo.baseUrl with optional override.                                           *
/************************************************************************************/
export function getPublicBaseUrl(wo, overrideUrl) {
  const url = overrideUrl || wo?.baseUrl || "";
  return String(url).replace(/\/$/, "");
}

/************************************************************************************/
/* functionSignature: getUserDir (wo)                                                 *
/* Returns the absolute path to the user's documents directory.                      *
/************************************************************************************/
export function getUserDir(wo) {
  return path.join(PUB_DOCUMENTS, getUserId(wo));
}

/************************************************************************************/
/* functionSignature: ensureUserDir (wo)                                              *
/* Creates the user's directory if it doesn't exist. Returns the absolute path.      *
/************************************************************************************/
export async function ensureUserDir(wo) {
  const dir = getUserDir(wo);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/************************************************************************************/
/* functionSignature: getUniqueFilename (dir, baseName, ext)                         *
/* Generates a filename that does not exist in dir by appending -1, -2, etc.         *
/************************************************************************************/
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

/************************************************************************************/
/* functionSignature: saveFile (wo, buffer, options?)                                *
/* Saves a Buffer to the user's documents directory.                                  *
/*                                                                                   *
/* Options:                                                                          *
/*   prefix        — prefix for auto-generated filename (default: "file")             *
/*   ext           — file extension including dot (default: ".bin")                   *
/*   name          — explicit base name; collision-avoidance applied                  *
/*   publicBaseUrl — override wo.baseUrl for URL construction                         *
/*                                                                                   *
/* Returns: { filename, url, absPath, userId, dir }                                  *
/************************************************************************************/
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

/************************************************************************************/
/* functionSignature: deleteFile (wo, filename)                                       *
/* Deletes a file from the user's directory. Filename must not contain path seps.    *
/************************************************************************************/
export async function deleteFile(wo, filename) {
  const safe = path.basename(String(filename || ""));
  if (!safe) throw new Error("invalid filename");
  await fs.unlink(path.join(getUserDir(wo), safe));
}

/************************************************************************************/
/* functionSignature: listUserFiles (wo)                                              *
/* Returns an array of filenames in the user's directory, sorted.                    *
/************************************************************************************/
export async function listUserFiles(wo) {
  try {
    const entries = await fs.readdir(getUserDir(wo), { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name).sort();
  } catch {
    return [];
  }
}

/************************************************************************************/
/* functionSignature: listUserImages (wo)                                             *
/* Returns only image filenames from the user's directory.                            *
/************************************************************************************/
export async function listUserImages(wo) {
  const files = await listUserFiles(wo);
  return files.filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
}

export default { saveFile, deleteFile, listUserFiles, listUserImages, getUserId, getUserDir, getPublicBaseUrl, ensureUserDir, getUniqueFilename };
