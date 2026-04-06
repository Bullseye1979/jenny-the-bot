/************************************************************************************/
/* filename: discord-voice-subagent-poll.js                                         */
/* Version 1.0                                                                      */
/* Purpose: Polls the registry for completed async subagent jobs whose callerFlow   */
/*          is "discord-voice" and delivers results via the discord-voice module    */
/*          pipeline with voiceSessionRef set so TTS modules can play the response. */
/************************************************************************************/

import { getItem, putItem, deleteItem, listKeys } from "../core/registry.js";
import { getPrefixedLogger }   from "../core/logging.js";
import { logSubagent }         from "../core/subagent-logger.js";
import { runPersonaPass, runParentChain } from "../core/subagent-poll-helpers.js";

const MODULE_NAME   = "discord-voice-subagent-poll";
const VOICE_REG_KEY = "discord-voice:registry";


function getIsHandledFlow(callerFlow) {
  const f = String(callerFlow || "");
  return f === "discord-voice" || f.startsWith("discord-voice-");
}


async function getVoiceSessionRef(guildId) {
  if (!guildId) return null;
  let reg = null;
  try { reg = await getItem(VOICE_REG_KEY); } catch { return null; }
  const keys = Array.isArray(reg?.list) ? reg.list : [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (typeof k !== "string" || !k.trim()) continue;
    try {
      const session = await getItem(k);
      const sgid = String(session?.guildId || session?.workingObject?.guildId || "").trim();
      if (sgid && sgid === guildId) {
        return k;
      }
    } catch {}
  }
  return null;
}


async function deliverViaFlow(job, response, createRunCore, runFlow, log) {
  logSubagent("info", "discord-voice-poll", "deliver_flow_start", {
    jobId:           job.jobId,
    callerChannelId: job.callerChannelId,
    responseLen:     response.length,
  });

  const _rc = createRunCore();
  const _wo = (_rc.workingObject ||= {});
  _wo.flow                = "discord-voice";
  _wo.channelID           = job.callerChannelId;
  _wo.guildId             = String(job.guildId || "");
  _wo.userId              = String(job.userId || "");
  _wo.authorDisplayname   = String(job.authorDisplayname || "");
  _wo.response            = response;
  _wo.question            = job.callerPayload || "";
  _wo.deliverSubagentJob  = { projectId: job.projectId || "" };
  _wo.skipAiCompletions   = true;
  _wo.doNotWriteToContext = true;
  _wo.bypassTriggerGate   = true;
  _wo.clientRef           = "discord:client";
  _wo.timestamp           = new Date().toISOString();

  /* Bypass channel gate — delivery is always allowed (same as discord-voice.js) */
  _wo.channelallowed = true;

  /* Look up active voice session so TTS modules can play the response */
  if (_wo.guildId) {
    try {
      const _ref = await getVoiceSessionRef(_wo.guildId);
      if (_ref) _wo.voiceSessionRef = _ref;
    } catch {}
  }

  try {
    await runFlow("discord-voice", _rc);
    logSubagent("info", "discord-voice-poll", "deliver_flow_done", { jobId: job.jobId });
  } catch (e) {
    log(`Delivery flow "discord-voice" failed for ${job.callerChannelId}: ${e?.message || String(e)}`, "error");
    logSubagent("error", "discord-voice-poll", "deliver_flow_failed", {
      jobId: job.jobId,
      error: e?.message || String(e),
    });
  }
}


export default async function getDiscordVoiceSubagentPollFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.[MODULE_NAME] || {};

  if (cfg.enabled !== true) return;

  const pollIntervalMs = Math.max(1000, Number.isFinite(Number(cfg.pollIntervalMs)) ? Number(cfg.pollIntervalMs) : 5000);
  const maxJobAgeMs    = Math.max(60000, Number.isFinite(Number(cfg.maxJobAgeMs))   ? Number(cfg.maxJobAgeMs)   : 86400000);

  const _pollRc = createRunCore();
  const log = getPrefixedLogger(_pollRc.workingObject, import.meta.url);
  log(`Starting — polling every ${pollIntervalMs}ms`);
  logSubagent("info", "discord-voice-poll", "poll_started", { pollIntervalMs, maxJobAgeMs });

  setInterval(async () => {
    let _keys;
    try { _keys = listKeys("job:"); } catch { return; }

    for (const _key of _keys) {
      let _job;
      try { _job = getItem(_key); } catch { continue; }
      if (!_job) continue;

      if (_job.status === "running") {
        const _ageMs = Date.now() - Date.parse(_job.startedAt);
        if (_ageMs > maxJobAgeMs) {
          logSubagent("warn", "discord-voice-poll", "job_timeout_expired", { jobId: _job.jobId, ageMs: _ageMs });
          try { await putItem({ ..._job, status: "error", error: "timeout", finishedAt: new Date().toISOString() }, _key); } catch { }
        }
        continue;
      }

      if (_job.status !== "done" && _job.status !== "error") continue;
      if (!_job.callerChannelId) continue;
      if (!getIsHandledFlow(_job.callerFlow)) continue;

      logSubagent("info", "discord-voice-poll", "job_found", {
        jobId:           _job.jobId,
        projectId:       _job.projectId || null,
        status:          _job.status,
        agentType:       _job.agentType || null,
        callerFlow:      _job.callerFlow || null,
        callerChannelId: _job.callerChannelId,
      });

      try { deleteItem(_key); } catch { }
      logSubagent("info", "discord-voice-poll", "job_deleted", { jobId: _job.jobId });

      if (_job.callerContextChannelID) {
        const _parentProjectId = String(_job.callerContextChannelID).replace(/^project-/, "");
        const _result = _job.status === "done"
          ? String(_job.result || "").trim()
          : `Background task failed: ${_job.error || "unknown error"}`;

        logSubagent("info", "discord-voice-poll", "branch_parent_chain", { jobId: _job.jobId, parentProjectId: _parentProjectId });

        (async () => {
          try {
            const _deliverFn = async (cFlow, cChannelId, resp, projId) => {
              const _syntheticJob = { ..._job, callerFlow: cFlow, callerChannelId: cChannelId, jobId: projId || _job.jobId };
              await deliverViaFlow(_syntheticJob, resp, createRunCore, runFlow, log);
            };
            await runParentChain(_parentProjectId, _job, _result, baseCore, createRunCore, runFlow, _deliverFn, log);
          } catch (e) {
            logSubagent("error", "discord-voice-poll", "parent_chain_exception", { jobId: _job.jobId, error: e?.message || String(e) });
          }
        })();
        continue;
      }

      const _rawResult = _job.status === "done"
        ? String(_job.result || "").trim()
        : `Background task failed: ${_job.error || "unknown error"}`;

      logSubagent("info", "discord-voice-poll", "branch_delivery", {
        jobId:           _job.jobId,
        callerFlow:      _job.callerFlow,
        callerChannelId: _job.callerChannelId,
      });

      (async () => {
        try {
          const _response = await runPersonaPass(
            {
              callerChannelId:   _job.callerChannelId,
              callerFlow:        _job.callerFlow,
              userId:            _job.userId,
              guildId:           _job.guildId,
              authorDisplayname: _job.authorDisplayname,
              agentType:         _job.agentType,
              jobId:             _job.jobId,
              projectId:         _job.projectId,
            },
            _rawResult,
            createRunCore,
            runFlow,
            log
          );
          if (_response) {
            await deliverViaFlow(_job, _response, createRunCore, runFlow, log);
          }
        } catch (e) {
          logSubagent("error", "discord-voice-poll", "delivery_failed", { jobId: _job.jobId, error: e?.message || String(e) });
        }
      })();
    }
  }, pollIntervalMs);
}
