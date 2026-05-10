/**************************************************************/
/* filename: "getFileSearch.js"                               */
/* Version 1.0                                                */
/* Purpose: LLM-callable tool implementation.                 */
/**************************************************************/

import fs from "node:fs/promises";
import path from "node:path";
import { getUserDir } from "../core/file.js";

const MODULE_NAME = "getFileSearch";
const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".xml"
]);
const DEFAULT_CONTEXT_CHARS = 220;
const DEFAULT_MAX_RESULTS = 12;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function getSafePath(rawPath) {
  const normalized = String(rawPath || "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
}

async function walkFiles(dir, relDir = "") {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkFiles(absPath, relPath));
    } else if (entry.isFile()) {
      out.push({ name: entry.name, path: relPath, absPath });
    }
  }
  return out;
}

function makeSnippet(text, start, end, radius) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text
    .slice(from, to)
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const directory = getSafePath(args?.directory || "");
  const query = String(args?.query || "").trim();
  const contextChars = Math.max(40, Math.min(800, Math.floor(Number(args?.contextChars) || DEFAULT_CONTEXT_CHARS)));
  const maxResults = Math.max(1, Math.min(50, Math.floor(Number(args?.maxResults) || DEFAULT_MAX_RESULTS)));

  if (!directory) return { ok: false, error: "directory is required" };
  if (!query) return { ok: false, error: "query is required" };

  const absDir = path.join(getUserDir(wo), directory);
  let files;
  try {
    files = await walkFiles(absDir, directory);
  } catch {
    return { ok: false, error: `Directory not found: ${directory}` };
  }

  const queryLower = query.toLowerCase();
  const results = [];

  for (const file of files) {
    if (results.length >= maxResults) break;
    const ext = path.extname(file.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    let stat;
    try {
      stat = await fs.stat(file.absPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    let text;
    try {
      text = await fs.readFile(file.absPath, "utf8");
    } catch {
      continue;
    }

    const lower = text.toLowerCase();
    let idx = lower.indexOf(queryLower);
    if (idx < 0) continue;

    while (idx >= 0 && results.length < maxResults) {
      const end = idx + query.length;
      results.push({
        file: file.path,
        match: text.slice(idx, end),
        snippet: makeSnippet(text, idx, end, contextChars),
        position: idx
      });
      idx = lower.indexOf(queryLower, idx + Math.max(1, query.length));
    }
  }

  return {
    ok: true,
    directory,
    query,
    count: results.length,
    results
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
