/**************************************************************
/* filename: "core-ai-pseudotoolcalls.js"                     *
/* Version 1.0                                                *
/* Purpose: AI runner that uses ONLY pseudo tool calls. It    *
/*          generates strict, per-tool examples from JSON     *
/*          schemas, normalizes common arg aliases (e.g.      *
/*          getToken: color1→ring_color, image/src→url),      *
/*          executes one parsed pseudo call per loop,         *
/*          persists turns, and returns final assistant text. *
/**************************************************************/
/**************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-pseudotoolcalls";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/**************************************************************
/* functionSignature: getShouldRunForThisModule (wo)          *
/* Returns true when useAIModule equals "pseudotoolcalls".    *
/**************************************************************/
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  return v === "pseudotoolcalls";
}

/**************************************************************
/* functionSignature: getJsonSafe (v)                         *
/* Converts a value to JSON or string safely.                 *
/**************************************************************/
function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }

/**************************************************************
/* functionSignature: getPreview (str, max)                   *
/* Truncates a string with a marker at max length.            *
/**************************************************************/
function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }

/**************************************************************
/* functionSignature: getNum (value, def)                     *
/* Returns a finite number or the default.                    *
/**************************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/**************************************************************
/* functionSignature: getBool (value, def)                    *
/* Returns a boolean or the default.                          *
/**************************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/**************************************************************
/* functionSignature: getStr (value, def)                     *
/* Returns a non-empty string or the default.                 *
/**************************************************************/
function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }

/**************************************************************
/* functionSignature: getTryParseJSON (text, fallback)        *
/* Parses JSON or returns the fallback.                       *
/**************************************************************/
function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }

/**************************************************************
/* functionSignature: getWithTurnId (rec, wo)                 *
/* Injects workingObject.turn_id into a record if present.    *
/**************************************************************/
function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  return t ? { ...rec, turn_id: t } : rec;
}

/**************************************************************
/* functionSignature: getKiCfg (wo)                           *
/* Builds runtime configuration for pseudo tool calls.        *
/**************************************************************/
function getKiCfg(wo) {
  const includeHistory = getBool(wo?.IncludeHistory, true);
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
    includeRuntimeContext,
    toolsList,
    temperature: getNum(wo?.Temperature, 0.7),
    maxTokens: getNum(wo?.MaxTokens, 2000),
    maxLoops: getNum(wo?.MaxLoops, 20),
    requestTimeoutMs: getNum(wo?.RequestTimeoutMs, 120000)
  };
}

/**************************************************************
/* functionSignature: getRuntimeContextFromLast (wo, kiCfg,   *
/* lastRecord) Builds minimal runtime context from last turn. *
/**************************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}

/**************************************************************
/* functionSignature: getAppendedContextBlockToUserContent    *
/* (baseText, contextObj) Appends a JSON context block.       *
/**************************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/**************************************************************
/* functionSignature: getPromptFromSnapshot (rows, kiCfg)     *
/* Converts stored rows to chat messages without tools.       *
/**************************************************************/
function getPromptFromSnapshot(rows, kiCfg) {
  if (!kiCfg.includeHistory) return [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const role = r.role;
    if (role === "user") {
      out.push({ role: "user", content: r.content ?? "" });
      continue;
    }
    if (role === "assistant") {
      out.push({ role: "assistant", content: r.content ?? "" });
      continue;
    }
  }
  return out;
}

/**************************************************************
/* functionSignature: getToolsByName (names, wo)              *
/* Dynamically imports tool modules by name.                  *
/**************************************************************/
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

/**************************************************************
/* functionSignature: getExecToolCall (toolModules, toolCall, *
/* coreData) Executes a tool call and returns tool message.   *
/**************************************************************/
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
    const normalizedArgs = getNormalizedArgsForTool(name, args);
    const result = await tool.invoke(normalizedArgs, coreData);
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

/**************************************************************
/* functionSignature: getMaybePseudoToolCall (text)           *
/* Parses a single pseudo-tool call from assistant text.      *
/**************************************************************/
function getMaybePseudoToolCall(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/^\s*\[tool:([A-Za-z0-9_.\-]+)\]\s*(\{[\s\S]*\})\s*$/m);
  if (!m) return null;
  const name = m[1];
  let args = {};
  try { args = JSON.parse(m[2]); } catch { args = getTryParseJSON(m[2], {}); }
  return { name, args };
}

/**************************************************************
/* functionSignature: getPseudoToolSpecs (names, wo)          *
/* Loads tool parameter specs for pseudo guidance.            *
/**************************************************************/
async function getPseudoToolSpecs(names, wo) {
  const specs = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      const def = tool?.definition?.function;
      const parameters = def?.parameters || {};
      const description = def?.description || def?.name || name;
      const required = Array.isArray(parameters?.required) ? parameters.required : [];
      const flat = {};
      const meta = {};
      if (parameters?.properties && typeof parameters.properties === "object") {
        for (const [k, v] of Object.entries(parameters.properties)) {
          const t = typeof v?.type === "string" ? v.type : "string";
          meta[k] = {
            type: t,
            description: typeof v?.description === "string" ? v.description.trim() : "",
            required: required.includes(k),
            enum: Array.isArray(v?.enum) ? v.enum : undefined,
            minimum: Number.isFinite(v?.minimum) ? v.minimum : undefined,
            maximum: Number.isFinite(v?.maximum) ? v.maximum : undefined,
            default: Object.prototype.hasOwnProperty.call(v ?? {}, "default") ? v.default : undefined
          };
          if (Object.prototype.hasOwnProperty.call(v ?? {}, "default")) flat[k] = v.default;
          else if (t === "number" || t === "integer") flat[k] = 0;
          else if (t === "boolean") flat[k] = false;
          else if (t === "array") flat[k] = [];
          else if (t === "object") flat[k] = {};
          else flat[k] = meta[k].required ? `<${meta[k].description || k}>` : "";
        }
      }
      specs.push({ name, description, argsTemplate: flat, argsMeta: meta, required });
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

/**************************************************************
/* functionSignature: getPseudoExamplesFromDefs (specs)       *
/* Renders strict, per-tool examples and rules.               *
/**************************************************************/
function getPseudoExamplesFromDefs(specs) {
  if (!Array.isArray(specs) || !specs.length) return "";
  const names = specs.map(s => s.name).join(", ");
  const lines = [];
  lines.push("<EXAMPLES_STRICT>");
  lines.push("ALLOWED_TOOL_NAMES=" + names);
  for (const s of specs) {
    const args = { ...(s.argsTemplate ?? {}) };
    if (s.name === "getToken") {
      if (typeof args.url === "string") args.url = "<https://host/path/to/image.png>";
      if ("ring_color" in args || "color" in args) args.ring_color = "#00b3ff";
      if (Number.isFinite(args.size)) args.size = 512;
    }
    const prettyArgs = JSON.stringify(args);
    lines.push(`[tool:${s.name}]${prettyArgs}`);
    const legendParts = [];
    const metas = s.argsMeta || {};
    Object.keys(metas).forEach(k => {
      const m = metas[k] || {};
      const req = m.required ? "required" : "optional";
      const rng = (Number.isFinite(m.minimum) || Number.isFinite(m.maximum)) ? ` range=${m.minimum ?? "-"}..${m.maximum ?? "-"}` : "";
      const en = Array.isArray(m.enum) ? ` enum=${m.enum.join("|")}` : "";
      const def = Object.prototype.hasOwnProperty.call(m, "default") ? ` default=${JSON.stringify(m.default)}` : "";
      legendParts.push(`${k} (${m.type} – ${req}${rng}${en}${def}${m.description ? ` – ${m.description}` : ""})`);
    });
    if (legendParts.length) lines.push(`# args: ${legendParts.join("; ")}`);
    if (s.name === "getToken") {
      lines.push(`# note: Use "ring_color" (hex like "#00b3ff"), not "color1" or "ringColor".`);
      lines.push(`# note: Use "url" for the image source, not "image", "img" or "src".`);
    }
  }
  lines.push("</EXAMPLES_STRICT>");
  lines.push("<INCORRECT_EXAMPLES>");
  lines.push('[tool:getToken]{"image":"https://...", "color1":"#00b3ff"}');
  lines.push('[tool:getToken]{url:"https://..."}');
  lines.push("some text then [tool:getToken]{\"url\":\"https://...\"}");
  lines.push("```[tool:getToken]{\"url\":\"https://...\"}```");
  lines.push("</INCORRECT_EXAMPLES>");
  lines.push("<RULES>");
  lines.push("1) If any ALLOWED_TOOL_NAMES fits, you MUST call exactly one pseudo tool.");
  lines.push("2) The tool call MUST be the entire message, one line, no markdown, no commentary.");
  lines.push("3) Use valid JSON with double quotes only. No trailing commas.");
  lines.push("4) Match exact parameter names from the examples. Do not invent keys.");
  lines.push("5) If none fits, answer in natural language.");
  lines.push("</RULES>");
  return lines.join("\n");
}

/**************************************************************
/* functionSignature: getNormalizedArgsForTool (name, args)   *
/* Normalizes common alias keys and values per tool.          *
/**************************************************************/
function getNormalizedArgsForTool(name, args) {
  const a = typeof args === "object" && args ? { ...args } : {};
  if (name === "getToken") {
    if (typeof a.image === "string" && !a.url) a.url = a.image;
    if (typeof a.img === "string" && !a.url) a.url = a.img;
    if (typeof a.src === "string" && !a.url) a.url = a.src;
    if (typeof a.ringColor === "string" && !a.ring_color) a.ring_color = a.ringColor;
    if (typeof a.color1 === "string" && !a.ring_color) a.ring_color = a.color1;
    if (typeof a.color === "string" && !a.ring_color) a.ring_color = a.color;
    if (typeof a.ring_color === "string") {
      let c = a.ring_color.trim();
      if (!c.startsWith("#")) c = "#" + c;
      a.ring_color = c.toLowerCase();
    }
    if (typeof a.url === "string") {
      let u = a.url.trim();
      const md = u.match(/^!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
      if (md) u = md[1];
      const wrapped = u.match(/^<([^>]+)>$/);
      if (wrapped) u = wrapped[1];
      a.url = u;
    }
  }
  return a;
}

/**************************************************************
/* functionSignature: getSystemContent (wo, kiCfg)            *
/* Builds system prompt including pseudo-tool guidance.       *
/**************************************************************/
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
  const policy = [
    "Policy:",
    "- NEVER ANSWER TO OLDER USER REQUESTS",
    "- Use pseudo tools only when they match the user's request; otherwise answer naturally.",
    "- When you emit a pseudo tool call, do not include any extra prose in the same turn."
  ].join("\n");
  const specs = await getPseudoToolSpecs(kiCfg.toolsList || [], wo);
  const examples = getPseudoExamplesFromDefs(specs);
  const strict = [
    "STRICT PSEUDO TOOL FORMAT:",
    "[tool:NAME]{JSON_ARGS}",
    "No markdown. No quotes around the whole line. No commentary."
  ].join("\n");
  const decision = [
    "DECISION RULE:",
    "If at least one of ALLOWED_TOOL_NAMES can reasonably fulfill the user's request, you MUST respond with exactly one pseudo tool call in the strict format above. Otherwise, answer in natural language."
  ].join("\n");
  const parts = [];
  if (base) parts.push(base);
  parts.push(runtimeInfo);
  parts.push(policy);
  parts.push(strict);
  parts.push(decision);
  if (examples) parts.push(examples);
  return parts.filter(Boolean).join("\n\n");
}

/**************************************************************
/* functionSignature: getCoreAi (coreData)                    *
/* Runs AI loop with pseudo tool calls and persists turns.    *
/**************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];
  if (!getShouldRunForThisModule(wo)) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Skipped: useAIModule="${String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim()}" != "pseudotoolcalls"`
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
  const messagesFromHistory = getPromptFromSnapshot(snapshot, kiCfg);
  const lastRecord = Array.isArray(snapshot) && snapshot.length ? snapshot[snapshot.length - 1] : null;
  let userContent = userPromptRaw;
  const runtimeCtx = getRuntimeContextFromLast(wo, kiCfg, lastRecord);
  if (runtimeCtx) userContent = getAppendedContextBlockToUserContent(userContent, runtimeCtx);
  let messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userContent }
  ];
  const toolModules = await getToolsByName(kiCfg.toolsList, wo);
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
        max_tokens: kiCfg.maxTokens
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
      const assistantMsg = { role: "assistant", content: typeof msg.content === "string" ? msg.content : "" };
      messages.push(assistantMsg);
      persistQueue.push(getWithTurnId(assistantMsg, wo));
      if (!pseudoToolUsed) {
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
          const toolsForExec = toolModules.filter(t => (t.definition?.function?.name || t.name) === pt.name);
          const toolMsg = await getExecToolCall(
            toolsForExec,
            { id: "pseudo_" + pt.name, function: { name: pt.name, arguments: JSON.stringify(pt.args ?? {}) } },
            coreData
          );
          persistQueue.push(getWithTurnId(toolMsg, wo));
          const toolResultText = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? null);
          const userToolResult = { role: "user", content: `[tool_result:${pt.name}]\n${toolResultText}` };
          messages.push(userToolResult);
          persistQueue.push(getWithTurnId(userToolResult, wo));
          pseudoToolUsed = true;
          continue;
        }
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
