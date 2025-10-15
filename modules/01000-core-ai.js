/***************************************************************
/* filename: "01000-core-ai.js"                                *
/* Version 1.0                                                 *
/* Purpose: Platform-agnostic AI runner using payload as input *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fetch from "node-fetch";
import { getContext, setContext } from "../core/context.js";

const MODULE_NAME = "core-ai";

/***************************************************************
/* functionSignature: getNum (value, defaultValue)             *
/* Returns a finite number or the provided default             *
/***************************************************************/
function getNum(value, defaultValue) {
  return Number.isFinite(value) ? Number(value) : defaultValue;
}

/***************************************************************
/* functionSignature: getBool (value, defaultValue)            *
/* Returns a boolean or the provided default                   *
/***************************************************************/
function getBool(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

/***************************************************************
/* functionSignature: getStr (value, defaultValue)             *
/* Returns a non-empty string or the provided default          *
/***************************************************************/
function getStr(value, defaultValue) {
  return typeof value === "string" && value.length ? value : defaultValue;
}

/***************************************************************
/* functionSignature: getKiCfg (wo)                            *
/* Builds effective configuration from workingObject           *
/***************************************************************/
function getKiCfg(wo) {
  const includeHistory = getBool(wo?.IncludeHistory, true);
  const includeHistoryTools = getBool(wo?.IncludeHistoryTools, false);
  const includeRuntimeContext = getBool(wo?.IncludeRuntimeContext, true);
  const printRuntimeContextBox = getBool(wo?.PrintRuntimeContextBox, true);
  const toolsList = Array.isArray(wo?.Tools) ? wo.Tools : (Array.isArray(wo?.tools) ? wo.tools : []);
  const exposeTools = toolsList.length > 0;
  const toolChoice = getStr(wo?.ToolChoice, "auto");
  const temperature = getNum(wo?.Temperature, 0.7);
  const maxTokens = getNum(wo?.MaxTokens, 2000);
  const maxLoops = getNum(wo?.MaxLoops, 20);
  const requestTimeoutMs = getNum(wo?.RequestTimeoutMs, 120000);
  return {
    includeHistory,
    includeHistoryTools,
    includeRuntimeContext,
    printRuntimeContextBox,
    exposeTools,
    toolsList,
    toolChoice,
    temperature,
    maxTokens,
    maxLoops,
    requestTimeoutMs
  };
}

/***************************************************************
/* functionSignature: getTryParseJSON (text, fallback)         *
/* Parses JSON with fallback on error                          *
/***************************************************************/
function getTryParseJSON(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/***************************************************************
/* functionSignature: getRenderBoxedRed (title, text)          *
/* Renders a red console box for diagnostics                   *
/***************************************************************/
function getRenderBoxedRed(title, text) {
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  const lines = String(text).split("\n");
  const width = Math.min(200, Math.max(title.length + 4, ...lines.map(l => l.length + 2)) + 2);
  const top = "┏" + "━".repeat(width - 2) + "┓";
  const bottom = "┗" + "━".repeat(width - 2) + "┛";
  const pad = (s) => "│ " + s + " ".repeat(Math.max(0, width - 3 - s.length)) + "│";
  const out = [
    red + top,
    pad(" " + title + " "),
    "├" + "─".repeat(width - 2) + "┤",
    ...lines.map(pad),
    bottom + reset
  ].join("\n");
  return out;
}

/***************************************************************
/* functionSignature: setPrintContextJson (contextObj)         *
/* Prints runtime context as a boxed JSON to console           *
/***************************************************************/
function setPrintContextJson(contextObj) {
  const json = JSON.stringify(contextObj, null, 2);
  const boxed = getRenderBoxedRed("CONTEXT JSON", json);
  console.log(boxed);
}

/***************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, cfg, rec) *
/* Builds runtime context object from the last history record  *
/***************************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext) return null;
  if (!kiCfg.includeHistory) return null;
  if (!lastRecord || typeof lastRecord !== "object") return null;
  const metadata = {
    id: String(wo?.id ?? ""),
    flow: String(wo?.flow ?? ""),
    clientRef: String(wo?.clientRef ?? "")
  };
  const last = { ...lastRecord };
  if ("content" in last) delete last.content;
  return { metadata, last };
}

/***************************************************************
/* functionSignature: getAppendedContextBlockToUserContent (t,c,k)*
/* Appends a [context] JSON block to user content              *
/***************************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj, kiCfg) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  if (kiCfg.printRuntimeContextBox) setPrintContextJson(contextObj);
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/***************************************************************
/* functionSignature: getPromptFromSnapshot (rows, cfg)        *
/* Transforms context history into chat messages               *
/***************************************************************/
function getPromptFromSnapshot(rows, kiCfg) {
  if (!kiCfg.includeHistory) return [];
  const out = [];
  const includeTools = !!kiCfg.includeHistoryTools;
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
      const tcid = r.tool_call_id;
      if (includeTools && tcid && lastAssistantToolIds.has(tcid)) {
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

/***************************************************************
/* functionSignature: getToolsByName (names, wo)               *
/* Dynamically loads tool modules by name                      *
/***************************************************************/
async function getToolsByName(names, wo) {
  const loaded = [];
  for (const name of names) {
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

/***************************************************************
/* functionSignature: getToolDefs (toolModules)                *
/* Builds tool definitions for the Chat Completions API        *
/***************************************************************/
function getToolDefs(toolModules) {
  return toolModules
    .map(t => t.definition)
    .filter(d => d && d.type === "function" && d.function?.name);
}

/***************************************************************
/* functionSignature: getExecToolCall (toolModules, call, data)*
/* Executes a single tool call and returns a tool message      *
/***************************************************************/
async function getExecToolCall(toolModules, toolCall, coreData) {
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  const args = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  if (!tool) {
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: `Tool "${name}" not found` }) };
  }
  try {
    const result = await tool.invoke(args, coreData);
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  }
}

/***************************************************************
/* functionSignature: getSystemContent (wo)                    *
/* Composes system prompt with lightweight policy              *
/***************************************************************/
function getSystemContent(wo) {
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
  ].filter(Boolean).join("\n\n");
  const policy = [
    "Policy:",
    "- Do NOT run tools unless they are necessary to answer the payload.",
    "- Only answer the latest request. The history and [context] are just for reference."
  ].join("\n");
  const out = [policy, base || "You are a helpful assistant."].join("\n\n");
  return out;
}

/***************************************************************
/* functionSignature: getCoreAi (coreData)                     *
/* Orchestrates the AI request and persists conversation turns */
/***************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  if (!Array.isArray(wo.logging)) wo.logging = [];
  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "AI request started"
  });
  let snapshot = [];
  try {
    snapshot = await getContext(wo);
  } catch (e) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `getContext failed; continuing: ${e?.message || String(e)}`
    });
  }
  const messagesFromHistory = getPromptFromSnapshot(snapshot, kiCfg);
  const lastRecord = Array.isArray(snapshot) && snapshot.length ? snapshot[snapshot.length - 1] : null;
  const systemContent = getSystemContent(wo);
  let userContent = userPromptRaw;
  const runtimeCtx = getRuntimeContextFromLast(wo, kiCfg, lastRecord);
  if (runtimeCtx) {
    userContent = getAppendedContextBlockToUserContent(userContent, runtimeCtx, kiCfg);
  }
  let messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userContent }
  ];
  const toolModules = kiCfg.exposeTools ? await getToolsByName(kiCfg.toolsList, wo) : [];
  const toolDefs = kiCfg.exposeTools ? getToolDefs(toolModules) : [];
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
      }
      messages.push(assistantMsg);
      persistQueue.push(assistantMsg);
      if (toolCalls && toolCalls.length && toolModules.length) {
        for (const tc of toolCalls) {
          const toolMsg = await getExecToolCall(toolModules, tc, coreData);
          messages.push(toolMsg);
          persistQueue.push(toolMsg);
        }
        continue;
      }
      if (finish === "length") {
        messages.push({ role: "user", content: "continue" });
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
    } finally {
      clearTimeout(timer);
    }
  }
  for (const turn of persistQueue) {
    try {
      await setContext(wo, turn);
    } catch (e) {
      wo.logging?.push({
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
