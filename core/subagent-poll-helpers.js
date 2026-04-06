/************************************************************************************/
/* filename: subagent-poll-helpers.js                                               *
/* Version 1.0                                                                      *
/* Purpose: Shared helpers for async subagent poll flows.                           *
/*          runPersonaPass  — runs the API flow with the caller's channelID so that *
/*            core-channel-config applies the channel persona to the subagent       *
/*            result before delivery.                                                *
/*          runParentChain  — wakes up a parent project by writing the child result *
/*            to the project context and re-running the parent via the API flow.    *
/*            Recurses until there is no parent context channel, then calls the     *
/*            supplied deliverFn.                                                    *
/************************************************************************************/

import { getItem }              from "./registry.js";
import { setContext, getContext } from "./context.js";
import { logSubagent }           from "./subagent-logger.js";

const SUBAGENT_RESULT_TOOL_NAME = "getSubAgentResult";

function getSubagentCallId(jobId) {
  const raw = String(jobId || "").trim() || "unknown";
  return `subagent_${raw}`.slice(0, 120);
}

function getSubagentToolArgs(job) {
  const projectId = String(job?.projectId || "").trim();
  return {
    event: "subagent_result",
    source: "async_subagent_poll",
    jobId: String(job?.jobId || "").trim() || "unknown",
    agentType: String(job?.agentType || "").trim() || "unknown",
    status: String(job?.status || "").trim() || "unknown",
    ...(projectId ? { projectId } : {})
  };
}

function getSubagentToolOutput(job, rawResult) {
  const isDone = String(job?.status || "") === "done";
  const projectId = String(job?.projectId || "").trim();
  const base = {
    ok: isDone,
    event: "subagent_result",
    jobId: String(job?.jobId || "").trim() || "unknown",
    agentType: String(job?.agentType || "").trim() || "unknown",
    status: String(job?.status || "").trim() || "unknown"
  };

  if (isDone) {
    return {
      ...base,
      result: String(rawResult || "").trim()
    };
  }

  return {
    ...base,
    error: String(job?.error || rawResult || "unknown error"),
    ...(projectId ? { _meta: { projectId } } : {})
  };
}

async function setWriteSubagentToolExchange(contextWo, job, rawResult) {
  const toolCallId = getSubagentCallId(job?.jobId);
  const toolName = SUBAGENT_RESULT_TOOL_NAME;
  const args = getSubagentToolArgs(job);
  const output = getSubagentToolOutput(job, rawResult);

  await setContext(contextWo, {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: toolCallId,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(args)
        }
      }
    ]
  });

  await setContext(contextWo, {
    role: "tool",
    name: toolName,
    tool_call_id: toolCallId,
    content: JSON.stringify(output)
  });
}


/**
 * Run the API flow with the caller's channelID so core-channel-config applies
 * the channel persona. Injects the job result as a synthetic tool response in
 * the caller channel context so the AI continues naturally (Old English, etc.).
 * Returns the AI response text, or "" on failure.
 *
 * @param {{ callerChannelId, callerFlow, userId, guildId, authorDisplayname, agentType, jobId }} ctx
 * @param {string}   rawResult      — raw job result string (job.result or error text)
 * @param {Function} createRunCore
 * @param {Function} runFlow
 * @param {Function} log
 * @returns {Promise<string>}
 */
export async function runPersonaPass(ctx, rawResult, createRunCore, runFlow, log) {
  const { callerChannelId, callerFlow, userId, guildId, authorDisplayname, agentType, jobId } = ctx;

  const _rc = createRunCore();
  const _wo = (_rc.workingObject ||= {});
  _wo.channelID             = callerChannelId;
  _wo.flow                  = "api";
  _wo.channelType           = "API";
  _wo.isDM                  = false;
  if (String(callerFlow || "").startsWith("discord")) {
    _wo.overrideFlow        = String(callerFlow);
  }
  _wo.userId                = String(userId || "");
  _wo.guildId               = String(guildId || "");
  _wo.authorDisplayname     = String(authorDisplayname || "");

  const _projectId = String(ctx.projectId || "");
  const _rawText = String(rawResult || "").trim();
  const _resultContent = _rawText || "(The subagent completed but produced no output.)";

  logSubagent("info", "poll-delivery", "persona_pass_result_preview", {
    jobId,
    rawResultLen: _rawText.length,
    rawResultPreview: _rawText.slice(0, 120),
  });

  const _payload = "A background subagent tool result is now available in context. Continue naturally and present it to the user in your current persona.";

  logSubagent("info", "poll-delivery", "persona_pass_start", {
    jobId,
    callerChannelId,
    callerFlow,
    rawResultLen: _rawText.length,
  });

  _wo.payload             = _payload;
  _wo.toolChoice          = "none";
  _wo.includeHistoryTools = true;
  _wo.doNotWriteToContext = true;
  _wo.__noContinuation    = true;
  _wo.timestamp           = new Date().toISOString();

  try {
    await setWriteSubagentToolExchange(_wo, {
      jobId,
      agentType,
      status: "done",
      projectId: _projectId
    }, _resultContent);
  } catch (e) {
    logSubagent("warn", "poll-delivery", "persona_pass_tool_exchange_write_failed", {
      jobId,
      error: e?.message || String(e)
    });
  }

  const _startMs = Date.now();

  try {
    await runFlow("api", _rc);
  } catch (e) {
    logSubagent("error", "poll-delivery", "persona_pass_failed", {
      jobId,
      callerChannelId,
      error:      e?.message || String(e),
      durationMs: Date.now() - _startMs,
    });
    return "";
  }

  const _response = String(_wo.response || "").trim();
  logSubagent("info", "poll-delivery", "persona_pass_done", {
    jobId,
    durationMs:  Date.now() - _startMs,
    responseLen: _response.length,
  });

  if (_response) {
    try {
      await setContext(_wo, { role: "assistant", content: _response });
    } catch (e) {
      logSubagent("warn", "poll-delivery", "persona_pass_ctx_write_failed", { jobId, error: e?.message || String(e) });
    }
  }

  /* Append project ID tag after context write so TTS can strip it */
  const _deliveryResponse = (_response && _projectId)
    ? `${_response}\n\n<PROJECTID>${_projectId}</PROJECTID>`
    : _response;

  return _deliveryResponse;
}


/**
 * Wake up a parent project: write child result to project context, re-run the
 * parent via the API flow (with caller channel persona), then either recurse to
 * the grandparent or call deliverFn with the final response.
 *
 * @param {string}   projectId
 * @param {string}   contextContent — content to write as user message into project context
 * @param {object}   baseCore
 * @param {Function} createRunCore
 * @param {Function} runFlow
 * @param {Function} deliverFn       — async (callerFlow, callerChannelId, response, projectId) => void
 * @param {Function} log
 */
export async function runParentChain(projectId, job, rawResult, baseCore, createRunCore, runFlow, deliverFn, log) {
  logSubagent("info", "poll-chain", "chain_start", {
    projectId,
    jobId: job?.jobId || null,
    status: job?.status || null,
    rawResultLen: String(rawResult || "").length
  });

  const _project = getItem("project:" + projectId);
  if (!_project?.channelId) {
    log(`No project entry for ${projectId} — cannot wake up parent`, "warn");
    logSubagent("warn", "poll-chain", "chain_no_project_entry", { projectId });
    return;
  }

  logSubagent("info", "poll-chain", "chain_project_found", {
    projectId,
    channelId:              _project.channelId,
    callerChannelId:        _project.callerChannelId || null,
    callerFlow:             _project.callerFlow || null,
    callerContextChannelID: _project.callerContextChannelID || null,
    agentType:              _project.agentType || null,
    agentDepth:             _project.agentDepth ?? null,
  });

  const _contextChannelID = "project-" + projectId;
  const _contextWo = { ...(baseCore?.workingObject || {}), contextChannelID: _contextChannelID };

  try {
    await setWriteSubagentToolExchange(_contextWo, job, rawResult);
    logSubagent("info", "poll-chain", "chain_context_written", { projectId, contextChannelID: _contextChannelID });
  } catch (e) {
    log(`Context write failed for ${projectId}: ${e?.message || String(e)}`, "error");
    logSubagent("error", "poll-chain", "chain_context_write_failed", { projectId, error: e?.message || String(e) });
    return;
  }

  const _rc = createRunCore();
  const _wo = (_rc.workingObject ||= {});
  _wo.flow              = "api";
  _wo.channelID         = _project.callerChannelId || _project.channelId;
  _wo.contextChannelID  = _contextChannelID;
  _wo.payload           = "A new background subagent tool result was added to context. Continue from this tool output and respond accordingly.";
  _wo.callerChannelId   = _project.callerChannelId;
  _wo.userId            = _project.userId || "";
  _wo.guildId           = _project.guildId || "";
  _wo.authorDisplayname = _project.authorDisplayname || "";
  _wo.agentDepth        = Number(_project.agentDepth || 0);
  _wo.agentType         = _project.agentType || "";
  _wo.toolChoice        = "none";
  _wo.doNotWriteToContext = true;
  _wo.timestamp         = new Date().toISOString();

  logSubagent("info", "poll-chain", "chain_api_run_start", {
    projectId,
    channelID:        _wo.channelID,
    contextChannelID: _contextChannelID,
    agentType:        _project.agentType || null,
    agentDepth:       Number(_project.agentDepth || 0),
  });

  const _chainStartMs = Date.now();

  try {
    await runFlow("api", _rc);
  } catch (e) {
    log(`Parent run failed for ${projectId}: ${e?.message || String(e)}`, "error");
    logSubagent("error", "poll-chain", "chain_api_run_failed", {
      projectId,
      error:      e?.message || String(e),
      durationMs: Date.now() - _chainStartMs,
    });
    return;
  }

  const _response = String(_wo.response || "").trim();
  logSubagent("info", "poll-chain", "chain_api_run_complete", {
    projectId,
    durationMs:  Date.now() - _chainStartMs,
    responseLen: _response.length,
    hasResponse: !!_response,
  });

  if (!_response) return;

  if (_project.callerContextChannelID) {
    const _grandparentProjectId = String(_project.callerContextChannelID).replace(/^project-/, "");
    logSubagent("info", "poll-chain", "chain_recurse", { projectId, grandparentProjectId: _grandparentProjectId });
    await runParentChain(
      _grandparentProjectId,
      {
        ...job,
        projectId,
        result: _response,
        status: "done",
        agentType: job?.agentType || _project.agentType || "subagent-parent"
      },
      _response,
      baseCore,
      createRunCore,
      runFlow,
      deliverFn,
      log
    );
    return;
  }

  await deliverFn(_project.callerFlow, _project.callerChannelId, _response, projectId);
}


/**
 * Build the delivery payload string from a completed or failed job result.
 *
 * @param {{ status, result, error, agentType }} job
 * @returns {string}
 */
export function buildResultPayload(job) {
  const _result = job.status === "done"
    ? String(job.result || "").trim()
    : `Background task failed: ${job.error || "unknown error"}`;

  return job.status === "done"
    ? `[Async ${job.agentType} task completed]\n\n${_result}\n\nPresent this result to the user.`
    : `[Async ${job.agentType} task failed]\nError: ${job.error || "unknown"}\n\nInform the user that the background task failed.`;
}
