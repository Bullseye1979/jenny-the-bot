/***************************************************************************************
/* filename: "core-ai-completions.js"                                                  *
/* Version 1.0                                                                          *
/* Purpose: Platform-agnostic AI runner for chat completions with real tool calls only. *
/***************************************************************************************/
/***************************************************************************************
/*                                                                                     *
/***************************************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-completions";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/***************************************************************************************
/* functionSignature: getShouldRunForThisModule (wo)                                    *
/* Returns true when useAIModule equals "completions".                                  *
/***************************************************************************************/
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  return v === "completions";
}

/***************************************************************************************
/* functionSignature: getJsonSafe (v)                                                   *
/* Converts a value to a JSON-safe string for logging.                                  *
/***************************************************************************************/
function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }

/***************************************************************************************
/* functionSignature: getPreview (str, max)                                             *
/* Truncates a string to max length with a suffix marker.                               *
/***************************************************************************************/
function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }

/***************************************************************************************
/* functionSignature: getNum (value, def)                                               *
/* Returns a finite number or the provided default.                                     *
/***************************************************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/***************************************************************************************
/* functionSignature: getBool (value, def)                                              *
/* Returns a boolean value or the provided default.                                     *
/***************************************************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/***************************************************************************************
/* functionSignature: getStr (value, def)                                               *
/* Returns a non-empty string or the provided default.                                  *
/***************************************************************************************/
function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }

/***************************************************************************************
/* functionSignature: getTryParseJSON (text, fallback)                                  *
/* Parses JSON text with a fallback value on failure.                                   *
/***************************************************************************************/
function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }

/***************************************************************************************
/* functionSignature: getWithTurnId (rec, wo)                                           *
/* Injects workingObject.turn_id into a record if present.                              *
/***************************************************************************************/
function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  return t ? { ...rec, turn_id: t } : rec;
}

/***************************************************************************************
/* functionSignature: getKiCfg (wo)                                                     *
/* Builds runtime configuration for the completions runner.                              *
/***************************************************************************************/
function getKiCfg(wo) {
  const includeHistory = getBool(wo?.IncludeHistory, true);
  const includeHistoryTools = getBool(wo?.IncludeHistoryTools, false);
  const includeRuntimeContext = getBool(wo?.IncludeRuntimeContext, false);
  const toolsList = Array.isArray(wo?.Tools) ? wo.Tools : [];
  if (Array.isArray(wo?.tools) && !Array.isArray(wo?.Tools)) {
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: 'Config key "tools" is ignored. Use "Tools" (capital T).'
    });
  }
  return {
    includeHistory,
    includeHistoryTools,
    includeRuntimeContext,
    exposeTools: toolsList.length > 0,
    toolsList,
    toolChoice: getStr(wo?.ToolChoice, "auto"),
    temperature: getNum(wo?.Temperature, 0.7),
    maxTokens: getNum(wo?.MaxTokens, 2000),
    maxLoops: getNum(wo?.MaxLoops, 20),
    requestTimeoutMs: getNum(wo?.RequestTimeoutMs, 120000)
  };
}

/***************************************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, kiCfg, lastRecord)                 *
/* Builds minimal runtime context from the last history turn.                           *
/***************************************************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}

/***************************************************************************************
/* functionSignature: getAppendedContextBlockToUserContent (baseText, contextObj)       *
/* Appends a JSON context block to the user content.                                    *
/***************************************************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/***************************************************************************************
/* functionSignature: getPromptFromSnapshot (rows, kiCfg, allowToolHistory)             *
/* Converts stored rows into chat messages including tool turns when allowed.           *
/***************************************************************************************/
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

/***************************************************************************************
/* functionSignature: getToolsByName (names, wo)                                        *
/* Dynamically imports tool modules by name and validates them.                         *
/***************************************************************************************/
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

/***************************************************************************************
/* functionSignature: getToolDefs (toolModules)                                         *
/* Extracts JSON schema function definitions from tool modules.                         *
/***************************************************************************************/
function getToolDefs(toolModules) {
  return toolModules
    .map(t => t.definition)
    .filter(d => d && d.type === "function" && d.function?.name);
}

/***************************************************************************************
/* functionSignature: getExecToolCall (toolModules, toolCall, coreData)                 *
/* Executes a single tool call and returns a structured tool message.                   *
/***************************************************************************************/
async function getExecToolCall(toolModules, toolCall, coreData) {
  const wo = coreData?.workingObject || {};
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  const args = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();
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
  try {
    try { await putItem(name, "status:tool"); } catch {}
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
    setTimeout(() => { try { putItem("", "status:tool"); } catch {} }, Math.max(0, delayMs));
  }
}

/***************************************************************************************
/* functionSignature: getSystemContent (wo, kiCfg)                                      *
/* Builds the system prompt with runtime info and policy notes.                         *
/***************************************************************************************/
async function getSystemContent(wo, kiCfg) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
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
    "- NEVER ANSWER TO OLDER USER REQUESTS",
    "- If tools are available, use them only when necessary.",
    "- When you emit a tool call, do not include extra prose in the same turn.",
    "- DO NOT answer with JSON, unless you are explicitly asked to."
  ].join("\n");
  const parts = [];
  if (base) parts.push(base);
  parts.push(runtimeInfo);
  parts.push(commonPolicy);
  return parts.filter(Boolean).join("\n\n");
}

/***************************************************************************************
/* functionSignature: getCoreAi (coreData)                                              *
/* Runs the AI loop, executes tools, persists turns, and returns final text.            *
/***************************************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];
  if (!getShouldRunForThisModule(wo)) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Skipped: useAIModule="${String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim()}" != "completions"`
    });
    return coreData;
  }
  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
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
    ...messagesFromHistory,{ role: "user", content: userContent }
  ];
  const sendRealTools = kiCfg.exposeTools;
  const toolModules = sendRealTools ? await getToolsByName(kiCfg.toolsList, wo) : [];
  const toolDefs = sendRealTools ? getToolDefs(toolModules) : [];
  const persistQueue = [];
  let finalText = "";
  for (let i = 0; i < kiCfg.maxLoops; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), kiCfg.requestTimeoutMs);
    try {
      const body = {
        model: wo.Model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens: kiCfg.maxTokens,
        tools: toolDefs.length ? toolDefs : undefined,
        tool_choice: toolDefs.length ? kiCfg.toolChoice : undefined
      };
      const res = await fetch(wo.Endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${wo.APIKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const raw = await res.text();
      if (!res.ok) {
        wo.Response = "[Empty AI response]";
        wo.logging.push({
          timestamp: new Date().toISOString(),
          severity: "warn",
          module: MODULE_NAME,
          exitStatus: "failed",
          message: `HTTP ${res.status} ${res.statusText} ${typeof raw === "string" ? raw.slice(0,300) : ""}`
        });
        return coreData;
      }
      const data = getTryParseJSON(raw, null);
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      const msg = choice?.message || {};
      const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : null;
      const assistantMsg = { role: "assistant", content: typeof msg.content === "string" ? msg.content : "" };
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
      persistQueue.push(getWithTurnId(assistantMsg, wo));
      if (toolCalls && toolCalls.length && toolModules.length) {
        for (const tc of toolCalls) {
          const toolMsg = await getExecToolCall(toolModules, tc, coreData);
          messages.push(toolMsg);
          persistQueue.push(getWithTurnId(toolMsg, wo));
        }
        continue;
      }
      if (finish === "length") {
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue;
      }
      finalText = typeof msg.content === "string" ? msg.content.trim() : "";
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.Response = "[Empty AI response]";
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
    }
  }
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
  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: "AI response received."
  });
  return coreData;
}
