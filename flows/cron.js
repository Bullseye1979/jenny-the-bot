/**************************************************************
/* filename: "cron.js"                                       *
/* Version 1.0                                               *
/* Purpose: Global cron scheduler that triggers flows whose  *
/*          names equal the job id and injects channelId     *
/*          into context.                                    *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "cron";


function getNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}


function getStr(v, d) {
  return typeof v === "string" && v.length ? v : d;
}


function getBool(v, d) {
  return typeof v === "boolean" ? v : d;
}


function getParseEveryMinutes(expr) {
  const trimmed = expr.trim();
  if (trimmed === "* * * * *") return 1;
  const m = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(trimmed);
  if (!m) return null;
  const step = Number(m[1]);
  if (!Number.isFinite(step) || step <= 0) return null;
  return step;
}


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


export default async function getCronFlow(baseCore, runFlow, createRunCore) {
  const cronCore = createRunCore();
  const log = getPrefixedLogger(cronCore?.workingObject || {}, import.meta.url);

  const jobState = new Map();


  function getLiveCfg() {
    return baseCore?.config?.[MODULE_NAME] || baseCore?.config?.cron || {};
  }


  function getLiveJobs(cfg) {
    const defaultTz =
      getStr(cfg.timezone, "") ||
      getStr(baseCore?.workingObject?.timezone, "") ||
      "Europe/Berlin";
    const defaultChannelId = getStr(
      cfg.channelId || cfg.channel,
      "cron"
    );
    const jobsCfg = Array.isArray(cfg.jobs) ? cfg.jobs : [];
    return jobsCfg
      .map((j, idx) => {
        const id = getStr(j.id || j.cronId || j.cronID, `job-${idx + 1}`);
        const expr = getStr(j.cron || j.schedule, "");
        const enabled = getBool(j.enabled, true);
        if (!expr || !enabled) return null;
        const prev = jobState.get(id);
        const exprChanged = prev && prev.expr !== expr;
        return {
          id,
          expr,
          timezone: getStr(j.timezone || j.tz, defaultTz),
          flowName: id,
          channelId: getStr(j.channelId || j.channel, defaultChannelId),
          enabled: true,
          running: prev?.running ?? false,
          nextDueAt: (prev && !exprChanged) ? (prev.nextDueAt ?? 0) : 0
        };
      })
      .filter(Boolean);
  }


  async function setTickLoop() {
    const cfg = getLiveCfg();
    const tickMs = Math.max(5000, getNum(cfg.tickMs, 15000));
    const jobs = getLiveJobs(cfg);

    for (const job of jobs) {
      const prev = jobState.get(job.id);
      if (!prev || (prev.expr !== job.expr)) {
        if (!job.nextDueAt) job.nextDueAt = getNextDue(job, log);
      }
      jobState.set(job.id, job);
    }

    const now = Date.now();

    for (const job of jobs) {
      if (!job.enabled || !job.nextDueAt) continue;
      if (job.running) continue;

      if (now + 500 >= job.nextDueAt) {
        job.running = true;
        jobState.set(job.id, job);

        const rc = createRunCore();

        rc.workingObject.cronID = job.id;
        rc.workingObject.CronMeta = {
          id: job.id,
          cron: job.expr,
          timezone: job.timezone
        };

        rc.workingObject.timestamp = new Date().toISOString();

        const targetFlow = job.flowName;
        const channelId = job.channelId;

        rc.workingObject.flow = targetFlow;
        rc.workingObject.channelId = channelId;
        if (!rc.workingObject.id) rc.workingObject.id = channelId;

        log(
          `trigger cron job "${job.id}" → flow="${targetFlow}", channelId="${channelId}"`,
          "info",
          { moduleName: MODULE_NAME }
        );

        (async () => {
          try {
            await runFlow(targetFlow, rc);
          } catch (e) {
            log(
              `cron job "${job.id}" failed: ${e?.message || String(e)}`,
              "error",
              { moduleName: MODULE_NAME }
            );
          } finally {
            const s = jobState.get(job.id);
            if (s) {
              s.running = false;
              s.nextDueAt = getNextDue(s, log);
            }
          }
        })();
      }
    }

    setTimeout(setTickLoop, Math.max(1, tickMs));
  }

  setTimeout(setTickLoop, 1000);
}
