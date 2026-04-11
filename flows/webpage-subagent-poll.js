/************************************************************************************/
/* filename: webpage-subagent-poll.js                                               *
/* Version 1.0                                                                      *
/* Purpose: Polls the registry for completed async subagent jobs whose callerFlow   *
/*          starts with "webpage" and delivers results via SSE.                     *
/*          Each connected webpage client subscribes to                             *
/*            GET /api/async-results/stream?channelId=<callerChannelId>            *
/*          The poll flow runs a persona pass through the API flow so               *
/*          core-channel-config applies the channel config, then pushes the         *
/*          formatted response as an SSE event to all connected clients.            *
/*                                                                                  *
/*  Event payload:                                                                  *
/*    { type: "async_result", response, callerFlow, agentType, jobId, projectId,   *
/*      audioBase64?, audioMime? }                                                  *
/************************************************************************************/

import { getItem, putItem, deleteItem, listKeys } from "../core/registry.js";
import { getPrefixedLogger }   from "../core/logging.js";
import { logSubagent }         from "../core/subagent-logger.js";
import { pushAsyncResult, getSseConnectionCount } from "../core/async-sse.js";
import { runPersonaPass, runParentChain } from "../core/subagent-poll-helpers.js";

const MODULE_NAME = "webpage-subagent-poll";


function getIsHandledFlow(callerFlow) {
  const _f = String(callerFlow || "");
  return _f.startsWith("webpage") || _f === "api";
}


async function deliverToOutput(callerFlow, callerChannelId, response, jobId, projectId, agentType, log, createRunCore, runFlow) {
  let audioBase64 = null;
  let audioMime = null;

  if (String(callerFlow || "").startsWith("webpage-voice")) {
    try {
      const _voicePayload = await getVoicePayload({
        callerFlow,
        callerChannelId,
        response,
        jobId,
        projectId,
      }, createRunCore, runFlow);
      audioBase64 = _voicePayload.audioBase64;
      audioMime = _voicePayload.audioMime;
    } catch (e) {
      logSubagent("error", "webpage-poll", "tts_payload_failed", {
        callerFlow,
        callerChannelId,
        jobId,
        error: e?.message || String(e),
      });
    }
  }

  logSubagent("info", "webpage-poll", "sse_push", {
    callerFlow,
    callerChannelId,
    jobId,
    responseLen: response.length,
    connections: getSseConnectionCount(callerChannelId),
    hasAudio: !!audioBase64,
  });

  const _sent = pushAsyncResult(callerChannelId, {
    type:       "async_result",
    response,
    callerFlow,
    agentType:  agentType || null,
    jobId:      jobId     || null,
    projectId:  projectId || null,
    audioBase64,
    audioMime,
  });

  if (_sent === 0) {
    log(`SSE push to ${callerChannelId}: no active connections (callerFlow: ${callerFlow})`, "warn");
    logSubagent("warn", "webpage-poll", "sse_no_connections", { callerChannelId, callerFlow, jobId });
  } else {
    logSubagent("info", "webpage-poll", "sse_push_ok", { callerChannelId, sent: _sent, jobId });
  }

  return {
    sent: _sent,
    audioBase64,
    audioMime,
  };
}


async function getVoicePayload({ callerFlow, callerChannelId, response, jobId, projectId }, createRunCore, runFlow) {
  const _rc = createRunCore();
  const _wo = (_rc.workingObject ||= {});
  _wo.flow                = "webpage";
  _wo.overrideFlow        = String(callerFlow || "");
  _wo.channelId           = String(callerChannelId || "");
  _wo.response            = String(response || "");
  _wo.skipAiCompletions   = true;
  _wo.doNotWriteToContext = true;
  _wo.bypassTriggerGate   = true;
  _wo.bypassGdprGate      = true;
  _wo.channelAllowed      = true;
  _wo.isWebpageVoice      = true;
  _wo.synthesizeSpeech    = true;
  _wo.ttsFormat           = "mp3";
  _wo.deliverSubagentJob  = {
    jobId: String(jobId || ""),
    projectId: String(projectId || ""),
  };
  _wo.timestamp           = new Date().toISOString();

  await runFlow("webpage", _rc);

  const _buffers = Array.isArray(_wo.ttsSegments)
    ? _wo.ttsSegments.map((segment) => segment?.buffer).filter((buffer) => Buffer.isBuffer(buffer))
    : [];

  if (!_buffers.length) {
    return { audioBase64: null, audioMime: null };
  }

  return {
    audioBase64: Buffer.concat(_buffers).toString("base64"),
    audioMime: "audio/mpeg",
  };
}


export default async function getWebpageSubagentPollFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.[MODULE_NAME] || {};

  if (cfg.enabled !== true) return;

  const pollIntervalMs = Math.max(1000, Number.isFinite(Number(cfg.pollIntervalMs)) ? Number(cfg.pollIntervalMs) : 5000);
  const maxJobAgeMs    = Math.max(60000, Number.isFinite(Number(cfg.maxJobAgeMs))   ? Number(cfg.maxJobAgeMs)   : 86400000);

  const _pollRc = createRunCore();
  const log = getPrefixedLogger(_pollRc.workingObject, import.meta.url);
  log(`Starting — polling every ${pollIntervalMs}ms`);
  logSubagent("info", "webpage-poll", "poll_started", { pollIntervalMs, maxJobAgeMs });

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
          logSubagent("warn", "webpage-poll", "job_timeout_expired", { jobId: _job.jobId, ageMs: _ageMs });
          try { await putItem({ ..._job, status: "error", error: "timeout", finishedAt: new Date().toISOString() }, _key); } catch { }
        }
        continue;
      }

      if (_job.status !== "done" && _job.status !== "error") continue;
      if (!_job.callerChannelId) continue;
      if (!getIsHandledFlow(_job.callerFlow)) continue;
      if (_job.personaResult) continue;

      logSubagent("info", "webpage-poll", "job_found", {
        jobId:          _job.jobId,
        projectId:      _job.projectId || null,
        status:         _job.status,
        agentType:      _job.agentType || null,
        callerFlow:     _job.callerFlow || null,
        callerChannelId: _job.callerChannelId,
      });

      const _result = _job.status === "done"
        ? String(_job.result || "").trim()
        : `Background task failed: ${_job.error || "unknown error"}`;

      try { deleteItem(_key); } catch { }
      logSubagent("info", "webpage-poll", "job_deleted", { jobId: _job.jobId });

      const _parentContextChannelId = String(_job.callerContextChannelId || _job.callerContextChannelID || "").trim();
      if (_parentContextChannelId) {
        const _parentProjectId = _parentContextChannelId.replace(/^project-/, "");

        logSubagent("info", "webpage-poll", "branch_parent_chain", { jobId: _job.jobId, parentProjectId: _parentProjectId });

        (async () => {
          try {
            const _deliverFn = (cFlow, cChannelId, resp, projId) =>
              deliverToOutput(cFlow, cChannelId, resp, _job.jobId, projId, _job.agentType, log, createRunCore, runFlow);
            await runParentChain(_parentProjectId, _job, _result, baseCore, createRunCore, runFlow, _deliverFn, log);
          } catch (e) {
            logSubagent("error", "webpage-poll", "parent_chain_exception", { jobId: _job.jobId, error: e?.message || String(e) });
          }
        })();
        continue;
      }

      const _rawResult = _job.status === "done"
        ? String(_job.result || "").trim()
        : `Background task failed: ${_job.error || "unknown error"}`;

      const _capturedJob = _job;
      const _capturedKey = _key;
      (async () => {
        try {
          const _response = await runPersonaPass(
            {
              callerChannelId:   _capturedJob.callerChannelId,
              callerFlow:        _capturedJob.callerFlow,
              userId:            _capturedJob.userId,
              guildId:           _capturedJob.guildId,
              authorDisplayname: _capturedJob.authorDisplayname,
              agentType:         _capturedJob.agentType,
              jobId:             _capturedJob.jobId,
              projectId:         _capturedJob.projectId,
            },
            _rawResult,
            createRunCore,
            runFlow,
            log
          );
          if (_response) {
            const _delivery = await deliverToOutput(_capturedJob.callerFlow, _capturedJob.callerChannelId, _response, _capturedJob.jobId, _capturedJob.projectId, _capturedJob.agentType, log, createRunCore, runFlow);
            if (_delivery.sent === 0) {
              try {
                await putItem({
                  ..._capturedJob,
                  personaResult: _response,
                  personaAudioBase64: _delivery.audioBase64,
                  personaAudioMime: _delivery.audioMime,
                  status: "done"
                }, _capturedKey);
                logSubagent("info", "webpage-poll", "sse_miss_fallback_saved", { jobId: _capturedJob.jobId, callerChannelId: _capturedJob.callerChannelId });
              } catch (e) {
                logSubagent("error", "webpage-poll", "sse_miss_fallback_failed", { jobId: _capturedJob.jobId, error: e?.message || String(e) });
              }
            }
          }
        } catch (e) {
          logSubagent("error", "webpage-poll", "delivery_failed", { jobId: _capturedJob.jobId, error: e?.message || String(e) });
        }
      })();
    }
  }, pollIntervalMs);
}
