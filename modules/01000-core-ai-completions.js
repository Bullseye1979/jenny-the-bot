/********************************************************************************
/* filename: 01000-core-ai-completions.js                                           *
/* Version 1.0                                                                  *
/* Purpose: Platform-agnostic AI runner for chat completions with real tool     *
/*          calls only                                                          *
/********************************************************************************/
import { getContext } from "../core/context.js";
import { putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const _manifestDir = join(dirname(fileURLToPath(import.meta.url)), "../manifests");
const _logDir      = join(dirname(fileURLToPath(import.meta.url)), "../logs");
const _toolcallLog = join(_logDir, "toolcalls.log");

try { mkdirSync(_logDir, { recursive: true }); } catch {}

const MODULE_NAME = "core-ai-completions";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;


function writeToolcallLog(entry) {
  try {
    appendFileSync(_toolcallLog, JSON.stringify(entry) + "\n", "utf8");
  } catch {}
}


function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "completions";
}


function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }


function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }


function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }


function getBool(value, def) { return typeof value === "boolean" ? value : def; }


function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }


function getParseArtifactsBlock(text) {
  const s = String(text || "");
  const marker = "\nARTIFACTS:\n";
  const idx = s.indexOf(marker);
  if (idx === -1) return { primaryImageUrl: null };

  const lines = s.slice(idx + marker.length).split("\n");
  for (const line of lines) {
    if (!line.trim()) break;
    const m = /^[a-z_]+:\s*(https?:\/\/\S+)/i.exec(line.trim());
    if (m) return { primaryImageUrl: m[1] };
  }

  return { primaryImageUrl: null };
}


function getLooksCutOff(text) {
  const s = String(text ?? "").trimEnd();
  if (!s) return false;
  if (/[.!?)\]"'`}]$/.test(s)) return false;
  if (/https?:\/\/\S+$/.test(s)) return false;
  return true;
}


function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }


function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined;
  return { ...(t ? { ...rec, turn_id: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}


function getToolStatusScope(wo) {
  const explicit =
    String(wo?.toolcallScope ?? wo?.toolStatusScope ?? wo?.statusScope ?? "").trim();
  if (explicit) return explicit;
  const callerFlow = String(wo?.callerFlow || "").trim();
  if (callerFlow) return callerFlow;
  return String(wo?.flow || "").trim();
}


function getKiCfg(wo) {
  const includeHistory = getBool(wo?.includeHistory, true);
  const includeHistoryTools = getBool(wo?.includeHistoryTools, false);
  const includeRuntimeContext = getBool(wo?.includeRuntimeContext, false);
  const toolsList = Array.isArray(wo?.tools) ? wo.tools : [];
  return {
    includeHistory,
    includeHistoryTools,
    includeRuntimeContext,
    exposeTools: toolsList.length > 0,
    toolsList,
    toolChoice: getStr(wo?.toolChoice, "auto"),
    temperature: getNum(wo?.temperature, 0.7),
    maxTokens: getNum(wo?.maxTokens, 2000),
    maxLoops: getNum(wo?.maxLoops, 20),
    maxToolCalls: getNum(wo?.maxToolCalls, 8),
    requestTimeoutMs: getNum(wo?.requestTimeoutMs, 120000)
  };
}


function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.channelID ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}


function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}


function getPromptFromSnapshot(rows, kiCfg, allowToolHistory = true) {
  if (!kiCfg.includeHistory) return [];
  const out = [];
  const includeTools = !!kiCfg.includeHistoryTools && !!allowToolHistory;
  let lastAssistantToolIds = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const role = r.role;
    if (role === "user") {
      out.push({ role: "user", content: r.content ?? "" });
      lastAssistantToolIds = new Set();
      continue;
    }
    if (role === "assistant") {
      const msg = { role: "assistant", content: r.content ?? "" };
      if (includeTools && Array.isArray(r.tool_calls) && r.tool_calls.length) {
        msg.tool_calls = r.tool_calls.map(tc => ({
          id: tc?.id,
          type: "function",
          function: {
            name: tc?.function?.name,
            arguments: typeof tc?.function?.arguments === "string"
              ? tc.function.arguments
              : (tc?.function?.arguments ? JSON.stringify(tc.function.arguments) : "{}")
          }
        }));
        lastAssistantToolIds = new Set(msg.tool_calls.map(tc => tc.id).filter(Boolean));
      } else {
        lastAssistantToolIds = new Set();
      }
      out.push(msg);
      continue;
    }
    if (role === "tool") {
      if (!includeTools) continue;
      const tcid = r.tool_call_id;
      if (tcid && lastAssistantToolIds.has(tcid)) {
        out.push({
          role: "tool",
          tool_call_id: tcid,
          name: r.name,
          content: typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? "")
        });
      }
      continue;
    }
  }
  return out;
}


function getManifestDef(name, logFn) {
  try {
    const raw = readFileSync(join(_manifestDir, `${name}.json`), "utf8");
    const fn = JSON.parse(raw);
    if (fn && typeof fn === "object" && fn.name && fn.description && fn.parameters) {
      return { type: "function", function: fn };
    }
  } catch {}
  if (logFn) logFn(`Tool "${name}" has no manifest in manifests/ — it will not be advertised to the AI.`, "warn");
  return null;
}


async function getToolsByName(names, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      if (tool && typeof tool.invoke === "function") {
        const manifestDef = getManifestDef(name, log);
        loaded.push({ ...tool, definition: manifestDef || undefined });
      } else {
        log(`Tool "${name}" invalid (missing invoke); skipped.`, "warn");
      }
    } catch (e) {
      log(`Tool "${name}" load failed: ${e?.message || String(e)}`, "warn");
    }
  }
  return loaded;
}


function getToolDefs(toolModules) {
  return toolModules
    .map(t => t.definition)
    .filter(d => d && d.type === "function" && d.function?.name);
}


function getExpandedToolArgs(args, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  const full = typeof wo?._fullAssistantText === "string" ? wo._fullAssistantText : "";
  if (!full || !args || typeof args !== "object") return args;
  const candidateKeys = ["body", "content", "text", "message"];
  for (const key of candidateKeys) {
    const v = args[key];
    if (typeof v === "string" && v.length && full.length > v.length && full.includes(v)) {
      log(`Expanded tool argument "${key}" to full assistant text.`, "info", { original_length: v.length, full_length: full.length });
      return { ...args, [key]: full };
    }
  }
  return args;
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
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  let args = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();
  args = getExpandedToolArgs(args, wo);
  if (!name) {
    writeToolcallLog({ ts: new Date().toISOString(), turn_id: String(wo.turn_id || wo.callerTurnId || ""), channel: String(wo.channelID || ""), caller_channel: String(wo.callerChannelId || ""), flow: String(wo.flow || ""), tool: "", status: "skipped_no_name", duration_ms: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name: null, content: JSON.stringify({ error: "Tool call has no function name" }) };
  }
  log("Tool call start", "info", { tool_call_id: toolCall?.id || null, tool: name || null, args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX) });
  if (!tool) {
    const msg = { error: `Tool "${name}" not found` };
    log("Tool call failed (not found)", "error", { tool_call_id: toolCall?.id || null, tool: name || null });
    writeToolcallLog({ ts: new Date().toISOString(), turn_id: String(wo.turn_id || wo.callerTurnId || ""), channel: String(wo.channelID || ""), caller_channel: String(wo.callerChannelId || ""), flow: String(wo.flow || ""), tool: String(name || ""), status: "not_found", duration_ms: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(msg) };
  }
  const _tcCh = String(coreData?.workingObject?.channelID ?? "").trim();
  const _callerCh = String(coreData?.workingObject?.callerChannelId ?? "").trim();
  const _currentFlow = String(coreData?.workingObject?.flow || "");
  const _statusScope = getToolStatusScope(coreData?.workingObject || {});
  const _hasGlobalStatus = _currentFlow !== "api" || !!_statusScope;
  if (!Number.isFinite(wo._statusToolGen)) wo._statusToolGen = 0;
  const _myGen = ++wo._statusToolGen;
  try {
    if (_hasGlobalStatus) {
      try { await putItem({ name, flow: _currentFlow, scope: _statusScope }, "status:tool"); } catch {}
    }
    if (_tcCh) try { await putItem(name, "status:tool:" + _tcCh); } catch {}
    if (_callerCh && _callerCh !== _tcCh) try { await putItem(name, "status:tool:" + _callerCh); } catch {}
    const result = await tool.invoke(args, coreData);
    const durationMs = Date.now() - startTs;
    log("Tool call success", "info", { tool_call_id: toolCall?.id || null, tool: name, duration_ms: durationMs, result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX) });
    writeToolcallLog({ ts: new Date().toISOString(), turn_id: String(wo.turn_id || wo.callerTurnId || ""), channel: String(wo.channelID || ""), caller_channel: String(wo.callerChannelId || ""), flow: String(wo.flow || ""), tool: name, status: "success", duration_ms: durationMs });
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    log("Tool call error", "error", { tool_call_id: toolCall?.id || null, tool: name, duration_ms: durationMs, error: String(e?.message || e) });
    writeToolcallLog({ ts: new Date().toISOString(), turn_id: String(wo.turn_id || wo.callerTurnId || ""), channel: String(wo.channelID || ""), caller_channel: String(wo.callerChannelId || ""), flow: String(wo.flow || ""), tool: name, status: "error", duration_ms: durationMs, error: String(e?.message || e) });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs)
      ? Number(coreData.workingObject.StatusToolClearDelayMs)
      : 800;
    setTimeout(() => {
      if (wo._statusToolGen !== _myGen) return;
      if (_hasGlobalStatus) { try { putItem("", "status:tool"); } catch {} }
      if (_tcCh) try { putItem("", "status:tool:" + _tcCh); } catch {}
      if (_callerCh && _callerCh !== _tcCh) try { putItem("", "status:tool:" + _callerCh); } catch {}
    }, Math.max(0, delayMs));
  }
}


async function getSystemContent(wo, kiCfg, moduleCfg) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.systemPrompt === "string" ? wo.systemPrompt.trim() : "",
    typeof wo.persona === "string" ? wo.persona.trim() : "",
    typeof wo.instructions === "string" ? wo.instructions.trim() : "",
    typeof wo._deliveryInstructions === "string" ? wo._deliveryInstructions.trim() : ""
  ].filter(Boolean).join("\n\n");

  const runtimeInfo = [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    "- When the user says \u201ctoday\u201d, \u201ctomorrow\u201d, or uses relative terms, interpret them relative to current_time_iso unless the user gives another explicit reference time.",
    "- If you generate calendar-ish text, prefer explicit dates (YYYY-MM-DD) when it helps the user."
  ].join("\n");

  const defaultPolicy = [
    "Policy:",
    "- Do not answer unrelated older user requests.",
    "- If the latest user message asks you to continue your previous response, continue exactly where you stopped \u2014 do not repeat, summarize, or restart.",
    "- If tools are available, use them only when necessary.",
    "- When you emit a tool call, do not include extra prose in the same turn.",
    "- ALWAYS answer in human readable plain text, unless you are explicitly told to answer in a different format"
  ].join("\n");
  const commonPolicy = getStr(wo?.policyPrompt, "") || getStr(moduleCfg?.policyPrompt, "") || defaultPolicy;

  const multiChannelNote = (() => {
    const raw = Array.isArray(wo?.contextIDs) ? wo.contextIDs : [];
    const extraIds = raw
      .map(v => String(v || "").trim())
      .filter(v => v.length > 0);
    if (!extraIds.length) return "";
    const currentId = String(wo?.channelID ?? "").trim();
    const lines = [
      "Multi-channel context:",
      "- The context includes messages from multiple channels. Each message may carry a `channelId` field that identifies its source channel."
    ];
    if (currentId) {
      lines.push(`- Treat "${currentId}" as your primary (effective) channelId for this conversation.`);
    }
    return lines.join("\n");
  })();
  const systemPromptAddition = typeof wo?.systemPromptAddition === "string" ? wo.systemPromptAddition.trim() : "";

  const parts = [];
  if (base) parts.push(base);
  if (systemPromptAddition) parts.push(systemPromptAddition);
  parts.push(runtimeInfo);
  parts.push(commonPolicy);
  if (multiChannelNote) parts.push(multiChannelNote);
  return parts.filter(Boolean).join("\n\n");
}


export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);
  if (!getShouldRunForThisModule(wo)) {
    log(`Skipped: useAiModule="${String(wo?.useAiModule ?? "").trim()}" != "completions"`, "info");
    return coreData;
  }
  if (wo.skipAiCompletions === true) {
    log("Skipped: skipAiCompletions flag set", "info");
    return coreData;
  }
  const kiCfg = getKiCfg(wo);
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
    catch (e) {
      log(`getContext failed; continuing: ${e?.message || String(e)}`, "warn");
    }
  }
  const moduleCfg = coreData.config?.[MODULE_NAME] || {};
  const systemContent = await getSystemContent(wo, kiCfg, moduleCfg);
  const allowToolHistory = !!kiCfg.includeHistoryTools;
  const messagesFromHistory = getPromptFromSnapshot(snapshot, kiCfg, allowToolHistory);
  const lastRecord = Array.isArray(snapshot) && snapshot.length ? snapshot[snapshot.length - 1] : null;
  let userContent = userPromptRaw;
  const runtimeCtx = getRuntimeContextFromLast(wo, kiCfg, lastRecord);
  if (runtimeCtx) userContent = getAppendedContextBlockToUserContent(userContent, runtimeCtx);
  let messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userContent }
  ];
  const sendRealTools = kiCfg.exposeTools;
  const toolModules = sendRealTools ? await getToolsByName(kiCfg.toolsList, wo) : [];
  const toolDefs = sendRealTools ? getToolDefs(toolModules) : [];
  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];
  const subagentLog = [];
  const toolCallLog = [];
  let totalToolCalls = 0;
  let accumulatedText = "";
  for (let i = 0; i < kiCfg.maxLoops; i++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }
    try {
      const toolsDisabled = wo.__forceNoTools === true || totalToolCalls >= kiCfg.maxToolCalls;
      const body = {
        model: wo.model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens: kiCfg.maxTokens,
        tools: (!toolsDisabled && toolDefs.length) ? toolDefs : undefined,
        tool_choice: (!toolsDisabled && toolDefs.length) ? kiCfg.toolChoice : undefined
      };
      const res = await fetchWithTimeout(wo.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await getSecret(wo, wo.apiKey)}` },
        body: JSON.stringify(body)
      }, kiCfg.requestTimeoutMs);
      const raw = await res.text();
      if (!res.ok) {
        wo.response = "[Empty AI response]";
        log(`HTTP ${res.status} ${res.statusText}`, "warn");
        return coreData;
      }
      const data = getTryParseJSON(raw, null);
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      const msg = choice?.message || {};
      const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
      log(`AI turn ${i + 1}: finish_reason="${finish ?? "null"}" content_length=${typeof msg.content === "string" ? msg.content.length : 0} tool_calls=${toolCalls?.length ?? 0}`, "info");
      const assistantMsg = {
        role: "assistant",
        authorName: getAssistantAuthorName(wo),
        content: typeof msg.content === "string" ? msg.content : ""
      };
      if (assistantMsg.authorName == null) delete assistantMsg.authorName;
      const chunkText = typeof msg.content === "string" ? msg.content : "";
      if (chunkText) {
        accumulatedText += (accumulatedText ? "\n" : "") + chunkText;
      }
      if (toolCalls && toolCalls.length) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id: tc?.id,
          type: "function",
          function: {
            name: tc?.function?.name,
            arguments: typeof tc?.function?.arguments === "string"
              ? tc.function.arguments
              : (tc?.function?.arguments ? JSON.stringify(tc.function.arguments) : "{}")
          }
        }));
        log(`Assistant requested tool call(s): ${toolCalls.map(t => t?.function?.name).filter(Boolean).join(", ") || "(unknown)"}`, "info", { count: toolCalls.length, ids: toolCalls.map(t => t?.id).filter(Boolean) });
      }
      messages.push(assistantMsg);
      if (assistantMsg.content || (Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length)) {
        wo._contextPersistQueue.push(getWithTurnId(assistantMsg, wo));
      }
      if (toolCalls && toolCalls.length && toolModules.length) {
        if (totalToolCalls >= kiCfg.maxToolCalls) {
          log(`maxToolCalls limit reached (${totalToolCalls}/${kiCfg.maxToolCalls}) — stopping tool execution`, "warn");
          break;
        }
        wo._fullAssistantText = accumulatedText;
        for (const tc of toolCalls) {
          if (totalToolCalls >= kiCfg.maxToolCalls) {
            log(`maxToolCalls limit reached mid-batch (${totalToolCalls}/${kiCfg.maxToolCalls}) — skipping remaining tool calls`, "warn");
            break;
          }
          const tcName = tc?.function?.name || "?";
          const tcTask = getToolTask(tc);
          const _tcTs = Date.now();
          const toolMsg = await getExecToolCall(toolModules, tc, coreData);
          const _tcMs = Date.now() - _tcTs;
          messages.push(toolMsg);
          wo._contextPersistQueue.push(getWithTurnId(toolMsg, wo));
          let _tcStatus = "success";
          try { if (JSON.parse(toolMsg.content || "{}").ok === false) _tcStatus = "failed"; } catch {}
          toolCallLog.push({ tool: tcName, task: tcTask, status: _tcStatus, duration_ms: _tcMs });
          totalToolCalls++;
          if (tcName === "getSubAgent") {
            try {
              const r = JSON.parse(toolMsg.content || "{}");
              subagentLog.push({ type: r.type || "generic", channel_id: r.channel_id || "?", ok: !!r.ok, error: r.error || null });
            } catch (e) {
              log(`getSubAgent result parse error: ${e?.message || String(e)}`, "warn");
            }
          }
        }
        wo._fullAssistantText = undefined;
        continue;
      }
      const cutOff = !wo.__noContinuation && (finish === "length" || getLooksCutOff(chunkText));
      if (cutOff) {
        const cont = {
          role: "user",
          content: "Continue exactly where you stopped. Do not restart, do not summarize, do not repeat the previous text. Output only the missing continuation."
        };
        messages.push(cont);
        wo._contextPersistQueue.push(getWithTurnId(cont, wo));
        log(`Continue triggered: finish_reason="${finish ?? "null"}" looks_cut_off=${getLooksCutOff(chunkText)}`, "info");
        wo.__forceNoTools = true;
        continue;
      }
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.response = "[Empty AI response]";
      log(isAbort
        ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).`
        : `AI request failed: ${err?.message || String(err)}`, isAbort ? "warn" : "error");
      return coreData;
    }
  }
  const reasoningEnabled = wo?.reasoning != null && wo?.reasoning !== false && wo?.reasoning !== 0;
  if (reasoningEnabled) {
    const parts = [];
    if (subagentLog.length) {
      parts.push(subagentLog.map((s, i) =>
        `--- Subagent ${i + 1} (${s.type} → ${s.channel_id}) ---\n` +
        (s.ok ? "✓ Completed successfully" : `✗ Error: ${s.error}`)
      ).join("\n\n"));
    }
    const directTools = toolCallLog.filter(e => e.tool !== "getSubAgent");
    if (directTools.length) {
      parts.push("Tools called:\n" + directTools.map(e => `- ${e.tool}${e.task ? ` (${e.task})` : ""}: ${e.status}`).join("\n"));
    }
    if (!parts.length) {
      parts.push("Answered from context — no tool calls.");
    }
    wo.reasoningSummary = parts.join("\n\n");
  } else {
    wo.reasoningSummary = undefined;
  }
  wo.toolCallLog  = toolCallLog;
  wo.subagentLog  = subagentLog;
  const _finalText = (accumulatedText || "").trim();
  if (_finalText) {
    wo.response = _finalText;
  } else if (subagentLog.length) {
    wo.response = "The sub-agent has been started and is working. I will share the result as soon as it arrives.";
  } else {
    wo.response = "[Empty AI response]";
  }
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
