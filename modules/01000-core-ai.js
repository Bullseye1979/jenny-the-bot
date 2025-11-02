/***************************************************************
/* filename: "core-ai.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Platform-agnostic AI runner that builds prompts    *
/* from context, executes tools (real or pseudo), persists     *
/* all turns with a shared turn_id, and returns the final      *
/* assistant text response.                                    *
/***************************************************************/
/***************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/***************************************************************
/* functionSignature: getJsonSafe (v)                          *
/* Convert arbitrary value to a JSON or string representation. *
/***************************************************************/
function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }

/***************************************************************
/* functionSignature: getPreview (str, max)                    *
/* Truncate a string to max characters with a marker.          *
/***************************************************************/
function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }

/***************************************************************
/* functionSignature: getNum (value, def)                      *
/* Return a finite number or a default value.                  *
/***************************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/***************************************************************
/* functionSignature: getBool (value, def)                     *
/* Return a boolean or a default value.                        *
/***************************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/***************************************************************
/* functionSignature: getStr (value, def)                      *
/* Return a non-empty string or a default value.               *
/***************************************************************/
function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }

/***************************************************************
/* functionSignature: getTryParseJSON (text, fallback)         *
/* Parse JSON string or return a fallback object.              *
/***************************************************************/
function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }

/***************************************************************
/* functionSignature: getWithTurnId (rec, wo)                  *
/* Clone record and inject workingObject.turn_id if present.   *
/***************************************************************/
function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  return t ? { ...rec, turn_id: t } : rec;
}

/***************************************************************
/* functionSignature: getKiCfg (wo)                            *
/* Build KI runtime configuration from workingObject.          *
/***************************************************************/
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
    requestTimeoutMs: getNum(wo?.RequestTimeoutMs, 120000),
    usePseudoTools: getBool((wo?.UsePseudoTools ?? wo?.UsePseudoToolcalls ?? wo?.UsePseusoTollcalls), false)
  };
}

/***************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, kiCfg,    *
/* lastRecord) Build minimal runtime context from last record. *
/***************************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}

/***************************************************************
/* functionSignature: getAppendedContextBlockToUserContent     *
/* (baseText, contextObj) Append a JSON context block to text. *
/***************************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/***************************************************************
/* functionSignature: getPromptFromSnapshot (rows, kiCfg,      *
/* allowToolHistory) Convert stored rows to chat messages.     *
/***************************************************************/
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

/***************************************************************
/* functionSignature: getToolsByName (names, wo)               *
/* Dynamically import tool modules by name.                    *
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
/* Extract JSON schema function definitions from tools.        *
/***************************************************************/
function getToolDefs(toolModules) {
  return toolModules
    .map(t => t.definition)
    .filter(d => d && d.type === "function" && d.function?.name);
}

/***************************************************************
/* functionSignature: getExecToolCall (toolModules, toolCall,  *
/* coreData) Execute a tool call and return tool-role message. *
/***************************************************************/
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

/***************************************************************
/* functionSignature: getMaybePseudoToolCall (text)            *
/* Parse a pseudo-tool invocation from assistant text.         *
/***************************************************************/
function getMaybePseudoToolCall(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/^\[tool:([A-Za-z0-9_.\-]+)\]\s*(\{[\s\S]*\})$/m);
  if (!m) return null;
  const name = m[1];
  let args = {};
  try { args = JSON.parse(m[2]); } catch { args = getTryParseJSON(m[2], {}); }
  return { name, args };
}

/***************************************************************
/* functionSignature: getPseudoToolSpecs (names, wo)           *
/* Load tool parameter specs for pseudo-tool guidance.         *
/***************************************************************/
async function getPseudoToolSpecs(names, wo) {
  const specs = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      const def = tool?.definition?.function;
      const parameters = def?.parameters || {};
      const description = def?.description || def?.name || name;
      const flat = {};
      const meta = {};
      if (parameters?.properties && typeof parameters.properties === "object") {
        for (const [k, v] of Object.entries(parameters.properties)) {
          const t = typeof v?.type === "string" ? v.type : "string";
          meta[k] = { type: t, description: typeof v?.description === "string" ? v.description.trim() : "" };
          if (Object.prototype.hasOwnProperty.call(v, "default")) flat[k] = v.default;
          else if (t === "number" || t === "integer") flat[k] = 0;
          else if (t === "boolean") flat[k] = false;
          else if (t === "array") flat[k] = [];
          else if (t === "object") flat[k] = {};
          else flat[k] = `<${meta[k].description || k}>`;
        }
      }
      specs.push({ name, description, argsTemplate: flat, argsMeta: meta });
    } catch (e) {
      wo?.logging?.push({
        timestamp: new Date().toISOString(),
        severity: "warn",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Spec load failed for "${name}": ${e?.message || String(e)}`
      });
    }
  }
  return specs;
}

/***************************************************************
/* functionSignature: getPseudoExamplesFromDefs (specs)        *
/* Render guidance examples for pseudo-tools.                  *
/***************************************************************/
function getPseudoExamplesFromDefs(specs) {
  if (!Array.isArray(specs) || !specs.length) return "";
  const names = specs.map(s => s.name).join(", ");
  const lines = [];
  lines.push("<EXAMPLES>");
  lines.push("# Pseudo-tool examples (valid JSON; placeholders in <...>).");
  lines.push("# THESE ARE THE ONLY AVAILABLE PSEUDO TOOLS. DO NOT INVENT NEW NAMES.");
  lines.push(`# ALLOWED_TOOL_NAMES: ${names}`);
  lines.push("# A TOOL CALL MUST BE THE ONLY CONTENT OF THE MESSAGE (no markdown, no extra text, no leading/trailing spaces).");
  for (const s of specs) {
    const args = JSON.stringify(s.argsTemplate ?? {}, null, 0);
    lines.push(`[tool:${s.name}]${args}`);
    const metas = s.argsMeta || {};
    const legendParts = Object.entries(metas).map(([k, m]) => {
      const desc = m?.description ? ` – ${m.description}` : "";
      return `${k} (${m?.type || "string"}${desc})`;
    });
    if (legendParts.length) lines.push(`# args: ${legendParts.join("; ")}`);
  }
  lines.push("# If none of the ALLOWED_TOOL_NAMES fits the user's request, respond in natural language instead of calling a tool.");
  lines.push("# End of examples.");
  lines.push("</EXAMPLES>");
  return lines.join("\n");
}

/***************************************************************
/* functionSignature: getSystemContent (wo, kiCfg)             *
/* Build system prompt string including runtime info and policy*/
/***************************************************************/
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
    "- When you emit a tool call, do not include extra prose in the same turn."
  ].join("\n");
  if (!kiCfg.usePseudoTools) {
    const parts = [];
    if (base) parts.push(base);
    parts.push(runtimeInfo);
    parts.push(commonPolicy);
    return parts.filter(Boolean).join("\n\n");
  }
  const toolsList = Array.isArray(wo?.Tools) ? wo.Tools : [];
  const specs = await getPseudoToolSpecs(toolsList, wo);
  const examples = getPseudoExamplesFromDefs(specs);
  const pseudoPolicy = [
    "Pseudo Tool Usage:",
    "- Output EXACTLY ONE line and NOTHING else when invoking a pseudo tool.",
    "- STRICT FORMAT (no markdown, no code fences, no commentary):",
    "  [tool:NAME]{JSON_ARGS}",
    "- The tool call MUST be the entire message without leading or trailing whitespace.",
    "- Use only the tools listed under <EXAMPLES> (ALLOWED_TOOL_NAMES). Do NOT invent names.",
    "- Do not chain multiple tools in one turn.",
    "- If no listed tool fits the task, answer in natural language."
  ].join("\n");
  const parts = [];
  if (base) parts.push(base);
  parts.push(runtimeInfo);
  parts.push(commonPolicy);
  parts.push(pseudoPolicy);
  if (examples) parts.push(examples);
  return parts.filter(Boolean).join("\n\n");
}

/***************************************************************
/* functionSignature: getCoreAi (coreData)                     *
/* Run AI loop, execute tools, persist turns, return response. *
/***************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  if (!Array.isArray(wo.logging)) wo.logging = [];
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "started", message: "AI request started" });

  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch (e) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` });
  }

  const systemContent = await getSystemContent(wo, kiCfg);

  const allowToolHistory = !kiCfg.usePseudoTools && !!kiCfg.includeHistoryTools;
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

  const sendRealTools = !kiCfg.usePseudoTools && kiCfg.exposeTools;
  const toolModules = sendRealTools ? await getToolsByName(kiCfg.toolsList, wo) : [];
  const toolDefs = sendRealTools ? getToolDefs(toolModules) : [];

  const persistQueue = [];
  let finalText = "";
  let pseudoToolUsed = false;

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

      if (kiCfg.usePseudoTools && !pseudoToolUsed) {
        const pt = getMaybePseudoToolCall(assistantMsg.content || "");
        if (pt) {
          if (Array.isArray(kiCfg.toolsList) && kiCfg.toolsList.length && !kiCfg.toolsList.includes(pt.name)) {
            const errMsg = `[tool_error:${pt.name}] Tool not allowed`;
            wo.logging.push({
              timestamp: new Date().toISOString(),
              severity: "warn",
              module: MODULE_NAME,
              exitStatus: "failed",
              message: `Pseudo tool not allowed: ${pt.name}`
            });
            const userErr = { role: "user", content: errMsg };
            messages.push(userErr);
            persistQueue.push(getWithTurnId(userErr, wo));
            pseudoToolUsed = true;
            continue;
          }
          const mods = await getToolsByName([pt.name], wo);
          const toolMsg = await getExecToolCall(
            mods,
            { id: "pseudo_" + pt.name, function: { name: pt.name, arguments: JSON.stringify(pt.args ?? {}) } },
            coreData
          );
          messages.push(toolMsg);
          persistQueue.push(getWithTurnId(toolMsg, wo));

          const toolResultText = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? null);
          const userToolResult = { role: "user", content: `[tool_result:${pt.name}]\n${toolResultText}` };
          messages.push(userToolResult);
          persistQueue.push(getWithTurnId(userToolResult, wo));
          pseudoToolUsed = true;
          continue;
        }
      }

      if (!kiCfg.usePseudoTools && toolCalls && toolCalls.length && toolModules.length) {
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
