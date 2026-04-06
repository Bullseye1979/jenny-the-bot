/************************************************************************************/
/* filename: subagent-logger.js                                                     *
/* Version 1.0                                                                      *
/* Purpose: Simple append-only file logger for the async subagent system.          *
/*          Writes one JSON line per event directly to logs/subagents/subagent.log. *
/*          Synchronous — safe to call from poll intervals, IIFEs, and tool code.   *
/*                                                                                  *
/* Usage:                                                                           *
/*   import { logSubagent } from "../core/subagent-logger.js";                     *
/*   logSubagent("info", "spawn", "job_created", { jobId, projectId, ... });        *
/************************************************************************************/

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

// Log resolved paths on first load so we can verify in console output
console.log(`[subagent-logger] LOG_FILE resolved to: ${LOG_FILE}`);


/**
 * Append one log line to logs/subagents/subagent.log.
 *
 * @param {"info"|"warn"|"error"} level
 * @param {string} source   - caller module: "getSubAgent" | "spawn" | "poll" | "poll-chain"
 * @param {string} event    - machine-readable event key, e.g. "job_created", "job_done"
 * @param {object} [fields] - arbitrary key/value context (jobId, projectId, error, etc.)
 */
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
    // logging must never crash the caller — but do report so the path can be debugged
    process.stderr.write(`[subagent-logger] write failed: ${e?.message || String(e)}\n`);
  }
}
