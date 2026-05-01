/**************************************************************/
/* filename: "log-paths.js"                                  */
/* Version 1.0                                               */
/* Purpose: Shared log path and rotation helpers.            */
/**************************************************************/

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getNum, getObj, getStr } from "./utils.js";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(DIRNAME, "..");
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 2;


export function getLogsRoot(configOrCoreData) {
  const cfg = getObj(configOrCoreData?.config, configOrCoreData || {});
  const logging = getObj(cfg.logging, {});
  const coreOutput = getObj(cfg["core-output"], {});
  const raw = getStr(logging.logsDir, getStr(coreOutput.logsDir, "logs")).trim();
  if (!raw) return path.join(REPO_ROOT, "logs");
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}


export function getLogMaxBytes(configOrCoreData, fallback = DEFAULT_MAX_BYTES) {
  const cfg = getObj(configOrCoreData?.config, configOrCoreData || {});
  const logging = getObj(cfg.logging, {});
  const coreOutput = getObj(cfg["core-output"], {});
  return Math.max(1024, getNum(logging.maxFileBytes, getNum(coreOutput.maxFileBytes, fallback)));
}


export function getLogKeepFiles(configOrCoreData, fallback = DEFAULT_KEEP_FILES) {
  const cfg = getObj(configOrCoreData?.config, configOrCoreData || {});
  const logging = getObj(cfg.logging, {});
  const coreOutput = getObj(cfg["core-output"], {});
  return Math.max(1, Math.floor(getNum(logging.keepFiles, getNum(coreOutput.keepFiles, fallback))));
}


export async function setAppendRollingFile({ dir, basename, ext = ".log", text, maxBytes = DEFAULT_MAX_BYTES, keepFiles = DEFAULT_KEEP_FILES }) {
  await fsp.mkdir(dir, { recursive: true });
  const escapedBase = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escapedBase}-(\\d+)${escapedExt}$`);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter(ent => ent.isFile() && re.test(ent.name))
    .map(ent => ({ name: ent.name, index: Number(ent.name.match(re)[1]), full: path.join(dir, ent.name) }))
    .sort((a, b) => a.index - b.index);

  let idx = files.length ? files[files.length - 1].index : 1;
  let currentPath = path.join(dir, `${basename}-${idx}${ext}`);
  const payload = Buffer.from(String(text || ""), "utf8");
  const size = (await fsp.stat(currentPath).catch(() => null))?.size || 0;

  if (size === 0 && !files.length) await fsp.writeFile(currentPath, "");
  if (size + payload.length > maxBytes) {
    idx += 1;
    currentPath = path.join(dir, `${basename}-${idx}${ext}`);
    await fsp.writeFile(currentPath, "");
  }

  const updated = [
    ...files.filter(f => f.index !== idx),
    { name: path.basename(currentPath), index: idx, full: currentPath }
  ].sort((a, b) => a.index - b.index);
  const keep = new Set(updated.slice(-keepFiles).map(f => f.index));
  for (const file of updated) {
    if (!keep.has(file.index)) await fsp.rm(file.full, { force: true }).catch(() => {});
  }

  await fsp.appendFile(currentPath, payload);
  return currentPath;
}
