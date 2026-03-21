/********************************************************************************
/* filename: "core-ai-completions.js"                                           *
/* Version 1.0                                                                  *
/* Purpose: Platform-agnostic AI runner for chat completions with real tool     *
/*          calls only                                                          *
/********************************************************************************/
import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-completions";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;


function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "completions";
}


function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }


function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }


function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }


function getBool(value, def) { return typeof value === "boolean" ? value : def; }


function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }


function getLooksCutOff(text) {
  const s = String(text ?? "").trimEnd();
  if (!s) return false;
  // Ends with a recognised closing character — treat as complete
  if (/[.!?)\]"'`}]$/.test(s)) return false;
  return true;
}


function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }


function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined;
  return { ...(t ? { ...rec, turn_id: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}


function getKiCfg(wo) {
  const includeHistory = getBool(wo?.includeHistory, true);
  const includeHistoryTools = getBool(wo?.includeHistoryTools, false);
  const includeRuntimeContext = getBool(wo?.includeRuntimeContext, false);
  const toolsList = Array.isArray(wo?.tools) ? wo.tools : [];
  if (Array.isArray(wo?.tools) && !Array.isArray(wo?.tools)) {
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: 'Config key "tools" is ignored. Use "tools" (capital T).'
    });
  }
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


async function getToolsByName(names, wo) {
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      if (tool && typeof tool.invoke === "function") {
        loaded.push(tool);
      } else {
        wo.logging?.push({
          timestamp: new Date().toISOString(),
          severity: "warn",
          module: MODULE_NAME,
          exitStatus: "success",
          message: `Tool "${name}" invalid (missing invoke); skipped.`
        });
      }
    } catch (e) {
      wo.logging?.push({
        timestamp: new Date().toISOString(),
        severity: "warn",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Tool "${name}" load failed: ${e?.message || String(e)}`
      });
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
  const full = typeof wo?._fullAssistantText === "string" ? wo._fullAssistantText : "";
  if (!full || !args || typeof args !== "object") return args;
  const candidateKeys = ["body", "content", "text", "message"];
  for (const key of candidateKeys) {
    const v = args[key];
    if (typeof v === "string" && v.length && full.length > v.length && full.includes(v)) {
      wo.logging?.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Expanded tool argument "${key}" to full assistant text.`,
        details: {
          original_length: v.length,
          full_length: full.length
        }
      });
      return { ...args, [key]: full };
    }
  }
  return args;
}


async function getExecToolCall(toolModules, toolCall, coreData) {
  const wo = coreData?.workingObject || {};
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  let args = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();
  args = getExpandedToolArgs(args, wo);
  wo.logging?.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Tool call start",
    details: {
      tool_call_id: toolCall?.id || null,
      tool: name || null,
      args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX)
    }
  });
  if (!tool) {
    const msg = { error: `Tool "${name}" not found` };
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Tool call failed (not found)",
      details: { tool_call_id: toolCall?.id || null, tool: name || null }
    });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(msg) };
  }
  /* Channel-specific toolcall key (for API / browser-extension consumers) */
  const _tcCh = String(coreData?.workingObject?.channelID ?? "").trim();
  try {
    try { await putItem(name, "status:tool"); } catch {}
    if (_tcCh) try { await putItem(name, "status:tool:" + _tcCh); } catch {}
    const result = await tool.invoke(args, coreData);
    const durationMs = Date.now() - startTs;
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "Tool call success",
      details: {
        tool_call_id: toolCall?.id || null,
        tool: name,
        duration_ms: durationMs,
        result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX)
      }
    });
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Tool call error",
      details: { tool_call_id: toolCall?.id || null, tool: name, duration_ms: durationMs, error: String(e?.message || e) }
    });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs)
      ? Number(coreData.workingObject.StatusToolClearDelayMs)
      : 800;
    setTimeout(() => {
      try { putItem("", "status:tool"); } catch {}
      if (_tcCh) try { putItem("", "status:tool:" + _tcCh); } catch {}
    }, Math.max(0, delayMs));
  }
}


async function getSystemContent(wo, kiCfg) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.systemPrompt === "string" ? wo.systemPrompt.trim() : "",
    typeof wo.persona === "string" ? wo.persona.trim() : "",
    typeof wo.instructions === "string" ? wo.instructions.trim() : ""
  ].filter(Boolean).join("\n\n");

  const runtimeInfo = [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    "- When the user says “today”, “tomorrow”, or uses relative terms, interpret them relative to current_time_iso unless the user gives another explicit reference time.",
    "- If you generate calendar-ish text, prefer explicit dates (YYYY-MM-DD) when it helps the user."
  ].join("\n");
  const commonPolicy = [
    "Policy:",
    "- Do not answer unrelated older user requests.",
    "- If the latest user message asks you to continue your previous response, continue exactly where you stopped — do not repeat, summarize, or restart.",
    "- If tools are available, use them only when necessary.",
    "- When you emit a tool call, do not include extra prose in the same turn.",
    "- ALWAYS answer in human readable plain text, unless you are explicitly told to answer in a different format"
  ].join("\n");
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
  const parts = [];
  if (base) parts.push(base);
  parts.push(runtimeInfo);
  parts.push(commonPolicy);
  if (multiChannelNote) parts.push(multiChannelNote);
  return parts.filter(Boolean).join("\n\n");
}


export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];
  const skipContextWrites = wo?.doNotWriteToContext === true;
  if (!getShouldRunForThisModule(wo)) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Skipped: useAiModule="${String(wo?.useAiModule ?? wo?.useAiModule ?? "").trim()}" != "completions"`
    });
    return coreData;
  }
  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  if (!userPromptRaw.trim()) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "skipped", message: "Skipped: empty payload" });
    return coreData;
  }
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "started", message: "AI request started" });
  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch (e) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` });
  }
  const systemContent = await getSystemContent(wo, kiCfg);
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
  const persistQueue = [];
  let accumulatedText = "";
  for (let i = 0; i < kiCfg.maxLoops; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), kiCfg.requestTimeoutMs);
    try {
      const toolsDisabled = wo.__forceNoTools === true;
      const body = {
        model: wo.model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens: kiCfg.maxTokens,
        tools: (!toolsDisabled && toolDefs.length) ? toolDefs : undefined,
        tool_choice: (!toolsDisabled && toolDefs.length) ? kiCfg.toolChoice : undefined
      };
      const res = await fetch(wo.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${wo.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const raw = await res.text();
      if (!res.ok) {
        wo.response = "[Empty AI response]";
        wo.logging.push({
          timestamp: new Date().toISOString(),
          severity: "warn",
          module: MODULE_NAME,
          exitStatus: "failed",
          message: `HTTP ${res.status} ${res.statusText}`
        });
        return coreData;
      }
      const data = getTryParseJSON(raw, null);
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      const msg = choice?.message || {};
      const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `AI turn ${i + 1}: finish_reason="${finish ?? "null"}" content_length=${typeof msg.content === "string" ? msg.content.length : 0} tool_calls=${toolCalls?.length ?? 0}`
      });
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
        wo.logging.push({
          timestamp: new Date().toISOString(),
          severity: "info",
          module: MODULE_NAME,
          exitStatus: "success",
          message: `Assistant requested tool call(s): ${toolCalls.map(t => t?.function?.name).filter(Boolean).join(", ") || "(unknown)"}`,
          details: { count: toolCalls.length, ids: toolCalls.map(t => t?.id).filter(Boolean) }
        });
      }
      messages.push(assistantMsg);
      if (assistantMsg.content || (Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length)) {
        persistQueue.push(getWithTurnId(assistantMsg, wo));
      }
      if (toolCalls && toolCalls.length && toolModules.length) {
        wo._fullAssistantText = accumulatedText;
        for (const tc of toolCalls) {
          const toolMsg = await getExecToolCall(toolModules, tc, coreData);
          messages.push(toolMsg);
          persistQueue.push(getWithTurnId(toolMsg, wo));
        }
        wo._fullAssistantText = undefined;
        continue;
      }
      // Continue when: token limit hit (explicit) OR finish_reason is absent and the
      // output appears truncated (local backends like oobabooga sometimes return null
      // instead of "length" when hitting a stop token mid-sentence).
      // Not applied for finish === "stop" to avoid false positives on short outputs.
      const cutOff = finish === "length" || getLooksCutOff(chunkText);
      if (cutOff) {
        const cont = {
          role: "user",
          content: "Continue exactly where you stopped. Do not restart, do not summarize, do not repeat the previous text. Output only the missing continuation."
        };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        wo.logging.push({
          timestamp: new Date().toISOString(),
          severity: "info",
          module: MODULE_NAME,
          exitStatus: "success",
          message: `Continue triggered: finish_reason="${finish ?? "null"}" looks_cut_off=${getLooksCutOff(chunkText)}`
        });
        /* Disable tools for the continuation pass — model should resume output, not call more tools */
        wo.__forceNoTools = true;
        continue;
      }
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.response = "[Empty AI response]";
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: isAbort ? "warn" : "error",
        module: MODULE_NAME,
        exitStatus: "failed",
        message: isAbort
          ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).`
          : `AI request failed: ${err?.message || String(err)}`
      });
      return coreData;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!skipContextWrites) {
    for (const turn of persistQueue) {
      try { await setContext(wo, turn); }
      catch (e) {
        wo.logging.push({
          timestamp: new Date().toISOString(),
          severity: "warn",
          module: MODULE_NAME,
          exitStatus: "success",
          message: `Persist failed (role=${turn.role}): ${e?.message || String(e)}`
        });
      }
    }
  } else {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `doNotWriteToContext=true → skipped context persistence for ${persistQueue.length} turn(s).`
    });
  }
  wo.response = (accumulatedText || "").trim() || "[Empty AI response]";
  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: "AI response received."
  });
  return coreData;
}
