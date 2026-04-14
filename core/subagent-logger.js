/**************************************************************/
/* filename: "subagent-logger.js"                                   */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper.                     */
/**************************************************************/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIRNAME  = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR  = path.join(DIRNAME, "..", "logs", "subagents");
const LOG_FILE = path.join(LOG_DIR, "subagent.log");

let _dirReady = false;

function ensureDir() {
  if (_dirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  _dirReady = true;
}

export function logSubagent(level, source, event, fields = {}) {
  try {
    ensureDir();
    const entry = {
      ts:     new Date().toISOString(),
      level:  level  || "info",
      source: source || "subagent",
      event:  event  || "log",
      ...fields,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    process.stderr.write(`[subagent-logger] write failed: ${e?.message || String(e)}\n`);
  }
}
