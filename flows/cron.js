/***************************************************************/
/* filename: "cron.js"                                         *
/* Version 1.0                                                 *
/* Purpose: Global cron scheduler that triggers the "cron" flow *
/*          with cronID using minimal cron parsing.            *
/***************************************************************/

/***************************************************************/
/*                                                             *
/***************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "cron";

/***************************************************************/
/* functionSignature: getNum (v, d)                            *
/* Parses a number or falls back to default                    *
/***************************************************************/
function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/***************************************************************/
/* functionSignature: getStr (v, d)                            *
/* Returns a non-empty string or a default                     *
/***************************************************************/
function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}

/***************************************************************/
/* functionSignature: getBool (v, d)                           *
/* Returns a boolean or a default                              *
/***************************************************************/
function getBool(v, d) {
  return typeof v === "boolean" ? v : d;
}

/***************************************************************/
/* functionSignature: getParseEveryMinutes (expr)              *
/* Parses "* * * * *" or "* slash N * * * *" into minutes      *
/***************************************************************/
function getParseEveryMinutes(expr) {
  const trimmed = expr.trim();
  if (trimmed === "* * * * *") return 1;
  const m = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(trimmed);
  if (!m) return null;
  const step = Number(m[1]);
  if (!Number.isFinite(step) || step <= 0) return null;
  return step;
}

/***************************************************************/
/* functionSignature: getNextDue (job, log)                    *
/* Computes the next due timestamp from the cron expression    *
/***************************************************************/
function getNextDue(job, log) {
  const stepMinutes = getParseEveryMinutes(job.expr);
  if (!stepMinutes) {
    log(
      `invalid or unsupported cron expression for job "${job.id}": ${job.expr} (only "* * * * *" or "*/N * * * *" supported)`,
      "error",
      { moduleName: MODULE_NAME }
    );
    job.enabled = false;
    return 0;
  }
  const next = Date.now() + stepMinutes * 60_000;
  return next;
}

/***************************************************************/
/* functionSignature: setTickLoop ()                           *
/* Internal scheduler loop that evaluates and triggers jobs    *
/***************************************************************/
function setTickLoop() {}

/***************************************************************/
/* functionSignature: getCronFlow (baseCore, runFlow, createRunCore) *
/* Sets up the cron scheduler and starts the periodic loop     *
/***************************************************************/
export default async function getCronFlow(baseCore, runFlow, createRunCore) {
  const cronCore = createRunCore();
  const log = getPrefixedLogger(cronCore?.workingObject || {}, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || baseCore?.config?.cron || {};

  const tickMs = Math.max(5000, getNum(cfg.tickMs, 15000));
  const defaultTz =
    getStr(cfg.timezone, "") ||
    getStr(baseCore?.workingObject?.timezone, "") ||
    "Europe/Berlin";

  const jobsCfg = Array.isArray(cfg.jobs) ? cfg.jobs : [];
  if (!jobsCfg.length) {
    log("no cron jobs configured; cron flow idle", "info", { moduleName: MODULE_NAME });
    return;
  }

  const jobs = jobsCfg
    .map((j, idx) => {
      const id = getStr(j.id || j.cronId, `job-${idx + 1}`);
      const expr = getStr(j.cron || j.schedule, "");
      const enabled = getBool(j.enabled, true);
      const timezone = getStr(j.timezone || j.tz, defaultTz);
      if (!expr || !enabled) return null;
      return {
        id,
        expr,
        timezone,
        enabled: true,
        nextDueAt: 0,
        running: false
      };
    })
    .filter(Boolean);

  if (!jobs.length) {
    log("no enabled cron jobs after filtering", "info", { moduleName: MODULE_NAME });
    return;
  }

  for (const job of jobs) {
    job.nextDueAt = getNextDue(job, log);
  }

  async function setTickLoop() {
    const now = Date.now();

    for (const job of jobs) {
      if (!job.enabled || !job.nextDueAt) continue;
      if (job.running) continue;

      if (now + 500 >= job.nextDueAt) {
        job.running = true;
        const rc = createRunCore();
        rc.workingObject.cronID = job.id;
        rc.workingObject.CronMeta = {
          id: job.id,
          cron: job.expr,
          timezone: job.timezone
        };

        log(`trigger cron job "${job.id}"`, "info", { moduleName: MODULE_NAME });

        try {
          await runFlow(MODULE_NAME, rc);
        } catch (e) {
          log(
            `cron job "${job.id}" failed: ${e?.message || String(e)}`,
            "error",
            { moduleName: MODULE_NAME }
          );
        } finally {
          job.running = false;
          job.nextDueAt = getNextDue(job, log);
        }
      }
    }

    setTimeout(setTickLoop, tickMs);
  }

  setTimeout(setTickLoop, 1000);
}
