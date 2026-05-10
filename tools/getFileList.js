/**************************************************************/
/* filename: "getFileList.js"                                 */
/* Version 1.0                                                */
/* Purpose: LLM-callable tool implementation.                 */
/**************************************************************/

import fs from "node:fs/promises";
import path from "node:path";
import { getUserDir } from "../core/file.js";

const MODULE_NAME = "getFileList";
const DEFAULT_PREVIEW_WORDS = 200;
const MAX_PREVIEW_CHARS = 16000;
const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".xml"
]);

function getSafePath(rawPath) {
  const normalized = String(rawPath || "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
}

function detectStartHint(name) {
  const lower = String(name || "").toLowerCase();
  const hints = [
    /\(einstieg\)/i,
    /\(start\)/i,
    /\bstart here\b/i,
    /\bdefault\b/i,
    /\bbegin\b/i,
    /\bintro\b/i,
    /\bentry\b/i
  ];
  const match = hints.find((rx) => rx.test(lower));
  return match ? match.source : null;
}

function buildPreview(text, wordLimit) {
  const words = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "";
  return words.slice(0, wordLimit).join(" ");
}

async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const directory = getSafePath(args?.directory || "");
  const previewWords = Math.max(20, Math.min(400, Math.floor(Number(args?.previewWords) || DEFAULT_PREVIEW_WORDS)));
  const absDir = path.join(getUserDir(wo), directory);

  let dirEntries;
  try {
    dirEntries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return { ok: false, error: `Directory not found: ${directory || "."}` };
  }

  const entries = [];
  for (const entry of dirEntries) {
    const relPath = directory ? `${directory}/${entry.name}` : entry.name;
    const startHint = detectStartHint(entry.name);
    const item = {
      name: entry.name,
      path: relPath,
      type: entry.isDirectory() ? "directory" : "file",
      start_hint: startHint
    };

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
        try {
          const raw = await fs.readFile(path.join(absDir, entry.name), "utf8");
          item.preview = buildPreview(raw.slice(0, MAX_PREVIEW_CHARS), previewWords);
        } catch {
          item.preview = "";
        }
      } else {
        item.preview = "";
      }
    }

    entries.push(item);
  }

  entries.sort((a, b) => {
    const aRank = a.start_hint ? 0 : 1;
    const bRank = b.start_hint ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
  });

  return {
    ok: true,
    directory: directory || ".",
    count: entries.length,
    preview_words: previewWords,
    entries
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
