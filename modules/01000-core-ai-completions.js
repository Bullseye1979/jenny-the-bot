/**************************************************************/
/* filename: "01000-core-ai-completions.js"                  */
/* Version 1.0                                               */
/* Purpose: AI pipeline module — OpenAI-compatible chat      */
/*          completions API with native tool call loop.      */
/**************************************************************/

import { getContext, getContextEarliestTimestamps } from "../core/context.js";
import { getStr, getNum }                           from "../core/utils.js";
import { putItem }                                  from "../core/registry.js";
import { getPrefixedLogger }                        from "../core/logging.js";
import { fetchWithTimeout }                         from "../core/fetch.js";
import { applyAiFallbackOverrides }                 from "../core/ai-fallback.js";
import {
  getAssistantAuthorName,
  getRequestHeaders,
  getTryParseJSON,
  getWithTurnId,
  getBool,
  getPreview,
  getJsonSafe,
  getLooksCutOff,
  getLimitNotice,
  getManifestDef,
  getManifestPolicyHints,
  getToolsByName,
  getToolStatusScope,
  getToolStatusKey,
  setRememberActiveToolStatus,
  writeToolcallLog,
  getToolcallLogBase,
  getToolArgsMeta,
  getToolPaginationMeta,
  getToolTraceMeta,
  getToolResultMeta,
  setEnsureFinalSynthesisPrompt,
  getParseArtifactsBlock,
  getExpandedToolArgs,
  getChannelAwarenessBlock,
  getSystemContentText,
  getPromptFromSnapshot,
  getAppendedContextBlockToUserContent
} from "../shared/ai/utils.js";

const MODULE_NAME     = "core-ai-completions";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "completions";
}


function getToolDefsForCurrentStep(toolDefs, wo, totalToolCalls, maxToolCalls) {
  const defs = Array.isArray(toolDefs) ? toolDefs : [];
  if (wo?.__forceNoTools === true) return { toolDefs: [], mode: "final_only" };
  if (Number.isFinite(maxToolCalls) && totalToolCalls >= maxToolCalls) return { toolDefs: [], mode: "final_only" };
  return { toolDefs: defs, mode: "normal" };
}


function getToolChoiceForStep(wo, fallbackChoice, toolsDisabled) {
  if (toolsDisabled) return undefined;
  void wo;
  if (fallbackChoice && typeof fallbackChoice === "object") return "required";
  return fallbackChoice || "auto";
}


function getKiCfg(wo) {
  const _toolsRaw       = Array.isArray(wo?.tools) ? wo.tools : [];
  const _toolsBlacklist = Array.isArray(wo?.toolsBlacklist) ? wo.toolsBlacklist : [];
  const toolsList       = _toolsBlacklist.length ? _toolsRaw.filter(t => !_toolsBlacklist.includes(t)) : _toolsRaw;
  return {
    includeHistory:               getBool(wo?.includeHistory, true),
    includeHistoryTools:          getBool(wo?.includeHistoryTools, false),
    includeHistorySystemMessages: getBool(wo?.includeHistorySystemMessages, false),
    includeRuntimeContext:        getBool(wo?.includeRuntimeContext, false),
    exposeTools:                  toolsList.length > 0,
    toolsList,
    toolChoice:       getStr(wo?.toolChoice, "auto"),
    temperature:      getNum(wo?.temperature, 0.7),
    maxTokens:        getNum(wo?.maxTokens, 2000),
    maxLoops:         getNum(wo?.maxLoops, 20),
    maxToolCalls:     getNum(wo?.maxToolCalls, 8),
    requestTimeoutMs: getNum(wo?.requestTimeoutMs, 120000)
  };
}


function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = {
    id:        String(wo?.channelId ?? ""),
    flow:      String(wo?.flow ?? ""),
    clientRef: String(wo?.clientRef ?? "")
  };
  const last = { ...lastRecord };
  if ("content" in last) delete last.content;
  return { metadata, last };
}


function getToolDefs(toolModules) {
  return toolModules
    .map(t => t.definition)
    .filter(d => d && d.type === "function" && d.function?.name);
}


function getToolTask(tc) {
  try {
    const args = JSON.parse(tc?.function?.arguments || "{}");
    const keys = ["prompt", "task", "query", "title", "filename", "description", "url", "type"];
    for (const k of keys) {
      const v = args[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80) + (v.length > 80 ? "…" : "");
    }
  } catch {}
  return "";
}


async function getExecToolCall(toolModules, toolCall, coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const name     = toolCall?.function?.name || toolCall?.name;
  const argsRaw  = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  let   args     = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  const tool     = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs  = Date.now();
  args = getExpandedToolArgs(args, wo);

  if (!name) {
    writeToolcallLog({ ...getToolcallLogBase(wo), coreData, tool: "", status: "skipped_no_name", durationMs: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name: null, content: JSON.stringify({ error: "Tool call has no function name" }) };
  }

  log("Tool call start", "info", {
    tool_call_id: toolCall?.id || null,
    tool:         name || null,
    args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX)
  });

  if (!tool) {
    log("Tool call failed (not found)", "error", { tool_call_id: toolCall?.id || null, tool: name || null });
    writeToolcallLog({ ...getToolcallLogBase(wo), coreData, tool: String(name || ""), status: "not_found", durationMs: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: `Tool "${name}" not found` }) };
  }

  const _currentFlow    = String(coreData?.workingObject?.flow || "");
  const _statusScope    = getToolStatusScope(coreData?.workingObject || {});
  const _hasGlobalStatus = _currentFlow !== "api" || !!_statusScope;
  const _statusToken    = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const _statusKey      = getToolStatusKey(coreData?.workingObject || {});
  const _statusPayload  = {
    name,
    flow:        _currentFlow,
    scope:       _statusScope,
    token:       _statusToken,
    channelId:   _statusKey,
    statusKey:   _statusKey,
    toolCallId:  toolCall?.id || ""
  };

  if (!Number.isFinite(wo._statusToolGen)) wo._statusToolGen = 0;
  const _myGen = ++wo._statusToolGen;

  try {
    wo._dashboardActiveTool = _statusPayload;
    if (_hasGlobalStatus) { try { await putItem(_statusPayload, "status:tool"); } catch {} }
    if (_statusKey)        { try { await putItem(_statusPayload, "status:tool:" + _statusKey); } catch {} }

    const result     = await tool.invoke(args, coreData);
    const durationMs = Date.now() - startTs;
    const resultMeta = getToolResultMeta(result);
    const logLevel   = resultMeta.ok ? "info" : "warn";
    const logLabel   = resultMeta.ok ? "Tool call success" : "Tool call returned error payload";

    log(logLabel, logLevel, {
      tool_call_id:   toolCall?.id || null,
      tool:           name,
      durationMs,
      error:          resultMeta.error || undefined,
      result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX)
    });

    writeToolcallLog({
      ...getToolcallLogBase(wo),
      coreData,
      tool:   name,
      status: resultMeta.ok ? "success" : "returned_error",
      durationMs,
      ...(resultMeta.error ? { error: resultMeta.error } : {}),
      ...getToolArgsMeta(name, args),
      ...getToolPaginationMeta(name, result),
      ...getToolTraceMeta(name, result)
    });
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    log("Tool call error", "error", { tool_call_id: toolCall?.id || null, tool: name, durationMs, error: String(e?.message || e) });
    writeToolcallLog({
      ...getToolcallLogBase(wo),
      coreData,
      tool: name,
      status: "error",
      durationMs,
      error: String(e?.message || e),
      ...getToolArgsMeta(name, args)
    });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  } finally {
    if (wo._statusToolGen === _myGen) {
      setRememberActiveToolStatus(wo, _statusPayload, _hasGlobalStatus);
    }
  }
}


export default async function getCoreAi(coreData) {
  let wo  = coreData.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);

  wo = await applyAiFallbackOverrides(wo, { log, moduleName: MODULE_NAME, endpoint: wo?.endpoint });
  coreData.workingObject = wo;

  if (!getShouldRunForThisModule(wo)) {
    log(`Skipped: useAiModule="${String(wo?.useAiModule ?? "").trim()}" != "completions"`, "info");
    return coreData;
  }

  if (wo.skipAiCompletions === true) {
    log("Skipped: skipAiCompletions flag set", "info");
    return coreData;
  }

  const kiCfg       = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  if (!userPromptRaw.trim()) {
    log("Skipped: empty payload", "info");
    return coreData;
  }

  log("AI request started", "info");

  let snapshot = [];
  if (Array.isArray(wo._contextSnapshot)) {
    snapshot = wo._contextSnapshot;
  } else {
    try { snapshot = await getContext(wo); }
    catch (e) { log(`getContext failed; continuing: ${e?.message || String(e)}`, "warn"); }
  }

  const moduleCfg          = coreData.config?.[MODULE_NAME] || {};
  const earliestTimestamps = await getContextEarliestTimestamps(wo).catch(() => []);
  const systemContent      = getSystemContentText(wo, { earliestTimestamps, moduleCfg });
  const allowToolHistory   = !!kiCfg.includeHistoryTools;
  const messagesFromHistory = getPromptFromSnapshot(snapshot, kiCfg, allowToolHistory);
  const lastRecord          = Array.isArray(snapshot) && snapshot.length ? snapshot[snapshot.length - 1] : null;
  let   userContent         = userPromptRaw;
  const runtimeCtx          = getRuntimeContextFromLast(wo, kiCfg, lastRecord);
  if (runtimeCtx) userContent = getAppendedContextBlockToUserContent(userContent, runtimeCtx);

  let messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userContent }
  ];

  const sendRealTools = kiCfg.exposeTools;
  const toolModules   = sendRealTools ? await getToolsByName(kiCfg.toolsList, wo) : [];
  const toolDefs      = sendRealTools ? getToolDefs(toolModules) : [];

  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];

  const toolCallLog     = [];
  let   totalToolCalls  = 0;
  let   accumulatedText = "";
  let   hitMaxLoops     = false;
  let   hitMaxToolCalls = false;
  let   emptyOutputConsec = 0;

  for (let i = 0; i < kiCfg.maxLoops; i++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }

    try {
      const toolStep       = getToolDefsForCurrentStep(toolDefs, wo, totalToolCalls, kiCfg.maxToolCalls);
      const activeToolDefs = Array.isArray(toolStep.toolDefs) ? toolStep.toolDefs : [];
      const toolsDisabled  = activeToolDefs.length === 0;
      const requestToolNames = !toolsDisabled
        ? activeToolDefs.map(tool => String(tool?.function?.name || tool?.name || "").trim()).filter(Boolean)
        : [];

      log("AI request tool snapshot", "info", {
        channelId:       String(wo?.channelId || ""),
        callerChannelId: String(wo?.callerChannelId || ""),
        useAiModule:     String(wo?.useAiModule || ""),
        toolsDisabled,
        toolMode:        toolStep.mode,
        configuredTools: Array.isArray(wo?.tools) ? wo.tools : [],
        requestToolNames,
        toolChoice:      !toolsDisabled ? getToolChoiceForStep(wo, kiCfg.toolChoice, toolsDisabled) : "none"
      });

      const toolChoiceForStep = getToolChoiceForStep(wo, kiCfg.toolChoice, toolsDisabled);
      const body = {
        model:       wo.model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens:  kiCfg.maxTokens,
        tools:       !toolsDisabled ? activeToolDefs : undefined,
        tool_choice: toolChoiceForStep
      };

      const headers = await getRequestHeaders(wo);
      const res     = await fetchWithTimeout(wo.endpoint, { method: "POST", headers, body: JSON.stringify(body) }, kiCfg.requestTimeoutMs);
      const raw     = await res.text();

      if (!res.ok) {
        log(`HTTP ${res.status} ${res.statusText}: ${raw.slice(0, 800)}`, "warn");
        writeToolcallLog({
          ...getToolcallLogBase(wo),
          event: "ai_error",
          coreData,
          loop: i + 1,
          errorType: "http_error",
          httpStatus: res.status,
          httpStatusText: res.statusText,
          responsePreview: getPreview(raw, RESULT_PREVIEW_MAX),
          contentPreview: getPreview(accumulatedText, RESULT_PREVIEW_MAX)
        });
        wo.response = accumulatedText.trim() || "[Empty AI response]";
        return coreData;
      }

      const data      = getTryParseJSON(raw, null);
      const choice    = data?.choices?.[0];
      const finish    = choice?.finish_reason;
      const msg       = choice?.message || {};
      const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
      const toolNamesRequested = toolCalls?.map(tc => String(tc?.function?.name || "").trim()).filter(Boolean) || [];
      const contentText = typeof msg.content === "string" ? msg.content : "";

      log(`AI turn ${i + 1}: finish_reason="${finish ?? "null"}" content_length=${typeof msg.content === "string" ? msg.content.length : 0} tool_calls=${toolCalls?.length ?? 0}`, "info");
      writeToolcallLog({
        ...getToolcallLogBase(wo),
        event: "ai_turn",
        coreData,
        loop: i + 1,
        finishReason: finish ?? null,
        contentLen: contentText.length,
        contentPreview: getPreview(contentText, RESULT_PREVIEW_MAX),
        toolMode: toolStep.mode,
        toolsDisabled,
        toolCallsRequested: toolNamesRequested,
        totalToolCallsBefore: totalToolCalls,
        maxToolCalls: kiCfg.maxToolCalls
      });

      const assistantMsg = {
        role:       "assistant",
        authorName: getAssistantAuthorName(wo),
        content:    contentText
      };
      if (assistantMsg.authorName == null) delete assistantMsg.authorName;

      const chunkText = typeof msg.content === "string" ? msg.content : "";
      if (chunkText) accumulatedText += (accumulatedText ? "\n" : "") + chunkText;

      if (toolCalls && toolCalls.length) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id:   tc?.id,
          type: "function",
          function: {
            name:      tc?.function?.name,
            arguments: typeof tc?.function?.arguments === "string"
              ? tc.function.arguments
              : (tc?.function?.arguments ? JSON.stringify(tc.function.arguments) : "{}")
          }
        }));
        log(`Assistant requested tool call(s): ${toolCalls.map(t => t?.function?.name).filter(Boolean).join(", ") || "(unknown)"}`, "info", {
          count: toolCalls.length,
          ids:   toolCalls.map(t => t?.id).filter(Boolean)
        });
      }

      messages.push(assistantMsg);
      if (assistantMsg.content || (Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length)) {
        wo._contextPersistQueue.push(getWithTurnId(assistantMsg, wo));
      }

      if (toolCalls && toolCalls.length && toolModules.length) {
        if (totalToolCalls >= kiCfg.maxToolCalls) {
          hitMaxToolCalls = true;
          log(`maxToolCalls limit reached (${totalToolCalls}/${kiCfg.maxToolCalls}) - requesting synthesis`, "warn");
          writeToolcallLog({
            ...getToolcallLogBase(wo),
            event: "ai_limit",
            coreData,
            loop: i + 1,
            limitType: "maxToolCalls",
            totalToolCalls,
            maxToolCalls: kiCfg.maxToolCalls
          });
          wo.__forceNoTools = true;
          setEnsureFinalSynthesisPrompt(messages, wo);
          continue;
        }

        wo._fullAssistantText = accumulatedText;
        for (const tc of toolCalls) {
          if (totalToolCalls >= kiCfg.maxToolCalls) {
            hitMaxToolCalls = true;
            log(`maxToolCalls limit reached mid-batch (${totalToolCalls}/${kiCfg.maxToolCalls}) - skipping remaining`, "warn");
            writeToolcallLog({
              ...getToolcallLogBase(wo),
              event: "ai_limit",
              coreData,
              loop: i + 1,
              limitType: "maxToolCallsMidBatch",
              totalToolCalls,
              maxToolCalls: kiCfg.maxToolCalls,
              pendingTool: tcName
            });
            break;
          }

          const tcName    = tc?.function?.name || "?";
          const tcTask    = getToolTask(tc);
          const _tcTs     = Date.now();
          const toolMsg   = await getExecToolCall(toolModules, tc, coreData);
          const _tcMs     = Date.now() - _tcTs;

          messages.push(toolMsg);
          wo._contextPersistQueue.push(getWithTurnId(toolMsg, wo));

          let _tcStatus = "success";
          try {
            const parsed = JSON.parse(toolMsg.content || "{}");
            if (parsed?.ok === false || (typeof parsed?.error === "string" && parsed.error.trim())) _tcStatus = "failed";
            if (typeof parsed?.url === "string" && parsed.url) wo.primaryImageUrl = parsed.url;
          } catch {}

          toolCallLog.push({ tool: tcName, task: tcTask, status: _tcStatus, durationMs: _tcMs });
          wo.toolCallLog = toolCallLog.slice();
          totalToolCalls++;
        }

        wo._fullAssistantText = undefined;
        continue;
      }

      const emptyAssistantTurn = !chunkText.trim() && !(toolCalls && toolCalls.length);
      if (emptyAssistantTurn && !toolsDisabled) {
        log("Empty assistant turn with tools still enabled - stopping loop without rescue turn", "warn", {
          finishReason: finish ?? null,
          loop: i + 1
        });
        break;
      }

      const cutOff = !wo.__noContinuation && (finish === "length" || getLooksCutOff(chunkText));
      if (cutOff) {
        if (finish === "length" && !chunkText) {
          emptyOutputConsec++;
          if (emptyOutputConsec >= 2) {
            log(`Empty output loop guard triggered (${emptyOutputConsec} consecutive) — breaking`, "warn");
            break;
          }
        } else {
          emptyOutputConsec = 0;
        }
        const cont = { role: "user", content: "Continue exactly where you stopped. Do not restart, do not summarize, do not repeat the previous text. Output only the missing continuation." };
        messages.push(cont);
        wo._contextPersistQueue.push(getWithTurnId(cont, wo));
        log(`Continue triggered: finish_reason="${finish ?? "null"}" looks_cut_off=${getLooksCutOff(chunkText)}`, "info");
        writeToolcallLog({
          ...getToolcallLogBase(wo),
          event: "ai_continue",
          coreData,
          loop: i + 1,
          finishReason: finish ?? null,
          looksCutOff: getLooksCutOff(chunkText),
          contentPreview: getPreview(chunkText, RESULT_PREVIEW_MAX)
        });
        wo.__forceNoTools = true;
        continue;
      }

      emptyOutputConsec = 0;
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.response = "[Empty AI response]";
      writeToolcallLog({
        ...getToolcallLogBase(wo),
        event: "ai_error",
        coreData,
        loop: i + 1,
        errorType: isAbort ? "timeout" : "request_error",
        error: err?.message || String(err),
        contentPreview: getPreview(accumulatedText, RESULT_PREVIEW_MAX)
      });
      log(
        isAbort
          ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).`
          : `AI request failed: ${err?.message || String(err)}`,
        isAbort ? "warn" : "error"
      );
      return coreData;
    }
  }

  if (!accumulatedText.trim() && !hitMaxToolCalls && messages.length && messages[messages.length - 1]?.role !== "assistant") {
    hitMaxLoops = true;
  }

  const reasoningEnabled = wo?.reasoning != null && wo?.reasoning !== false && wo?.reasoning !== 0;
  if (reasoningEnabled) {
    const parts = [];
    if (toolCallLog.length) {
      parts.push("Tools called:\n" + toolCallLog.map(e => `- ${e.tool}${e.task ? ` (${e.task})` : ""}: ${e.status}`).join("\n"));
    }
    wo.reasoningSummary = parts.length ? parts.join("\n\n") : "Answered from context — no tool calls.";
  } else {
    wo.reasoningSummary = undefined;
  }

  wo.toolCallLog = toolCallLog;

  const _finalText = (accumulatedText || "").trim();
  if (_finalText) {
    wo.response = hitMaxToolCalls
      ? _finalText + "\n\n" + getLimitNotice("tool")
      : hitMaxLoops
        ? _finalText + "\n\n" + getLimitNotice("loop")
        : _finalText;
  } else if (hitMaxToolCalls) {
    wo.response = "[Max Tool Calls Hit]\n\n" + getLimitNotice("tool");
  } else if (hitMaxLoops) {
    wo.response = "[Max Loops Hit]\n\n" + getLimitNotice("loop");
  } else {
    wo.response = "[Empty AI response]";
  }

  writeToolcallLog({
    ...getToolcallLogBase(wo),
    event: "ai_final",
    coreData,
    toolCallsUsed: totalToolCalls,
    calledTools: toolCallLog.map(e => e.tool),
    hitMaxLoops,
    hitMaxToolCalls,
    responseState: hitMaxToolCalls ? "max_tool_calls"
      : hitMaxLoops ? "max_loops"
      : (_finalText ? "final_text" : "empty"),
    responsePreview: getPreview(wo.response || "", RESULT_PREVIEW_MAX),
    confluenceCallCount: toolCallLog.filter(e => e.tool === "getConfluence").length
  });

  const { primaryImageUrl: _primaryImg } = getParseArtifactsBlock(wo.response);
  if (_primaryImg) wo.primaryImageUrl = _primaryImg;

  if (Array.isArray(wo._pendingSubtaskLogs) && wo._pendingSubtaskLogs.length) {
    const _logBlock = wo._pendingSubtaskLogs.join("\n\n");
    wo.reasoningSummary = wo.reasoningSummary ? wo.reasoningSummary + "\n\n" + _logBlock : _logBlock;
    wo._pendingSubtaskLogs = [];
  }

  log("AI response received.", "info");
  return coreData;
}
