/******************************************************************************* 
/* filename: "core-ai-pseudotoolcalls.js"                                      *
/* Version 1.0                                                                 *
/* Purpose: Pseudo tool runner that renders a compact tool catalog and         *
/*          executes pseudo tool invocations with schema checks.               *
/*******************************************************************************/
/******************************************************************************* 
/*                                                                             *
/*******************************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-pseudotoolcalls";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/******************************************************************************* 
/* functionSignature: getAssistantAuthorName (wo)                              *
/* Returns the assistant authorName (Botname).                                  *
/*******************************************************************************/
function getAssistantAuthorName(wo) {
  const v = (typeof wo?.Botname === "string" && wo.Botname.trim().length) ? wo.Botname.trim() : "";
  return v.length ? v : undefined;
}

/******************************************************************************* 
/* functionSignature: getJsonSafe (v)                                          *
/* Returns a compact JSON-safe string for logging.                             *
/*******************************************************************************/
function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }

/******************************************************************************* 
/* functionSignature: getPreview (str, max)                                    *
/* Produces a truncated preview with suffix marker.                            *
/*******************************************************************************/
function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }

/******************************************************************************* 
/* functionSignature: getNum (value, def)                                      *
/* Converts to a finite number or returns the default.                         *
/*******************************************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/******************************************************************************* 
/* functionSignature: getBool (value, def)                                     *
/* Returns the boolean value or the default.                                   *
/*******************************************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/******************************************************************************* 
/* functionSignature: getStr (value, def)                                      *
/* Returns a non-empty string or the default.                                  *
/*******************************************************************************/
function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }

/******************************************************************************* 
/* functionSignature: getTryParseJSON (text, fallback)                         *
/* Safely parses JSON with a fallback value on failure.                        *
/*******************************************************************************/
function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }

/******************************************************************************* 
/* functionSignature: getShouldRunForThisModule (wo)                           *
/* Determines whether to process this request.                                 *
/*******************************************************************************/
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  return v === "pseudotoolcalls";
}

/******************************************************************************* 
/* functionSignature: getWithTurnId (rec, wo)                                  *
/* Adds workingObject.turn_id to a record if present.                          *
/*******************************************************************************/
function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  return t ? { ...rec, turn_id: t } : rec;
}

/******************************************************************************* 
/* functionSignature: getKiCfg (wo)                                            *
/* Builds runtime configuration from working object.                           *
/*******************************************************************************/
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

/******************************************************************************* 
/* functionSignature: getRuntimeContextFromLast (wo, kiCfg, lastRecord)        *
/* Extracts minimal runtime context from last record.                          *
/*******************************************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}

/******************************************************************************* 
/* functionSignature: getAppendedContextBlockToUserContent (baseText, ctxObj)  *
/* Appends a JSON context block to user content.                               *
/*******************************************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/******************************************************************************* 
/* functionSignature: getPromptFromSnapshot (rows, kiCfg)                      *
/* Maps history rows to chat messages.                                         *
/*******************************************************************************/
function getPromptFromSnapshot(rows, kiCfg) {
  if (!kiCfg.includeHistory) return [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    if (r.role === "user") out.push({ role: "user", content: r.content ?? "" });
    else if (r.role === "assistant") out.push({ role: "assistant", content: r.content ?? "" });
  }
  return out;
}

/******************************************************************************* 
/* functionSignature: getToolsByName (names, wo)                               *
/* Dynamically imports and validates tool modules.                             *
/*******************************************************************************/
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

/******************************************************************************* 
/* functionSignature: getExtractPseudoToolCall (text)                          *
/* Extracts a pseudo tool call even if other text is present.                  *
/* Returns { name, args, cleanText, toolLine } or null.                        *
/*******************************************************************************/
function getExtractPseudoToolCall(text) {
  if (!text || typeof text !== "string") return null;

  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = String(lines[i] || "").trim();
    const m = line.match(/^\[tool:([A-Za-z0-9_.\-]+)\]\s*(\{[\s\S]*\})\s*$/);
    if (!m) continue;

    const name = m[1];
    let args = {};
    try { args = JSON.parse(m[2]); } catch { args = getTryParseJSON(m[2], {}); }

    const cleanText = lines.slice(0, i).concat(lines.slice(i + 1)).join("\n").trim();
    return { name, args, cleanText, toolLine: line };
  }

  return null;
}

/******************************************************************************* 
/* functionSignature: getPseudoToolSpecs (names, wo)                           *
/* Loads schemas and renders compact two-line specs.                           *
/*******************************************************************************/
async function getPseudoToolSpecs(names, wo) {
  const specs = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = (mod?.default ?? mod) || {};
      const def = tool?.definition?.function;
      const parameters = def?.parameters || {};
      const description = def?.description || def?.name || name;
      const required = Array.isArray(parameters?.required) ? parameters.required : [];
      const props = (parameters?.properties && typeof parameters.properties === "object") ? parameters.properties : {};

      const meta = {};
      Object.entries(props).forEach(([k, v]) => {
        meta[k] = {
          type: typeof v?.type === "string" ? v.type : "string",
          description: typeof v?.description === "string" ? v.description.trim() : "",
          required: required.includes(k),
          enum: Array.isArray(v?.enum) ? v.enum : undefined,
          minimum: Number.isFinite(v?.minimum) ? v.minimum : undefined,
          maximum: Number.isFinite(v?.maximum) ? v.maximum : undefined,
          default: Object.prototype.hasOwnProperty.call(v ?? {}, "default") ? v.default : undefined,
          aliases: Array.isArray(v?.["x-aliases"]) ? v["x-aliases"].filter(a => typeof a === "string" && a.trim()).map(a => a.trim()) : []
        };
      });

      const argsTemplate = {};
      Object.entries(meta).forEach(([k, m]) => {
        if (m.required) argsTemplate[k] = getConcreteExampleValue(k, m);
      });

      specs.push({
        name: def?.name || tool?.name || name,
        description,
        argsTemplate,
        argsMeta: meta,
        required,
        additionalProperties: parameters?.additionalProperties
      });
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

/******************************************************************************* 
/* functionSignature: getConcreteExampleValue (key, meta)                      *
/* Builds concrete placeholders from schema hints.                             *
/*******************************************************************************/
function getConcreteExampleValue(key, meta) {
  const m = meta || {};
  const t = m.type || "string";
  const enums = Array.isArray(m.enum) ? m.enum : null;
  if (enums && enums.length) return enums[0];
  const k = String(key || "").toLowerCase();
  if (t === "string") {
    if (/^(q|query)$/.test(k)) return "<USER_TEXT>";
    if (/prompt/.test(k)) return "<USER_TEXT>";
    if (/^(url|uri|link)$/.test(k)) return "<URL>";
    if (/(^hl$|^lr$|lang|language)/.test(k)) return "<LANG>";
    if (/^(text|message|content)$/.test(k)) return "<USER_TEXT>";
    return "<VALUE>";
  }
  if (t === "integer" || t === "number") {
    const hasMin = Number.isFinite(m.minimum);
    const hasMax = Number.isFinite(m.maximum);
    if (hasMin && hasMax) return Math.round((m.minimum + m.maximum) / 2);
    if (hasMin) return Math.max(m.minimum, 1);
    if (hasMax) return Math.min(m.maximum, 1);
    if (/(^num$|limit|count|(^k$)|steps|size)/.test(k)) return 3;
    if (/seed/.test(k)) return 1;
    return 1;
  }
  if (t === "boolean") return true;
  if (t === "array") return [];
  if (t === "object") return {};
  return "<VALUE>";
}

/******************************************************************************* 
/* functionSignature: getShortDesc (s, max)                                    *
/* Normalizes whitespace and truncates text.                                   *
/*******************************************************************************/
function getShortDesc(s, max = 80) { const txt = (s || "").replace(/\s+/g, " ").trim(); return txt.length > max ? txt.slice(0, max - 1) + "…" : txt; }

/******************************************************************************* 
/* functionSignature: getRenderPseudoCatalog (specs)                           *
/* Renders a two-line catalog entry for each tool.                             *
/*******************************************************************************/
function getRenderPseudoCatalog(specs) {
  if (!Array.isArray(specs) || !specs.length) return "";
  const lines = [];
  lines.push("<TOOLS_MINI>");
  for (const s of specs) {
    const reqKeys = (s.required || []).join(",");
    const desc = getShortDesc(s.description || s.name || "", 80);
    lines.push(`${s.name}: ${desc} — required:[${reqKeys}] — format [tool:${s.name}]{...}`);
    const ex = JSON.stringify(s.argsTemplate || {});
    lines.push(`eg: [tool:${s.name}]${ex}`);
  }
  lines.push("</TOOLS_MINI>");
  return lines.join("\n");
}

/******************************************************************************* 
/* functionSignature: getNormalizeArgsBySchema (_name, args, spec)             *
/* Normalizes and validates arguments by schema.                               *
/*******************************************************************************/
function getNormalizeArgsBySchema(_name, args, spec) {
  const a = (args && typeof args === "object") ? { ...args } : {};
  const meta = spec?.argsMeta || {};
  const required = Array.isArray(spec?.required) ? spec.required : [];
  const additionalProps = spec?.additionalProperties;

  for (const [key, m] of Object.entries(meta)) {
    if (a[key] != null) continue;
    for (const alias of (m.aliases || [])) {
      if (a[alias] != null) { a[key] = a[alias]; delete a[alias]; break; }
    }
  }

  for (const [key, m] of Object.entries(meta)) {
    if (!(key in a)) continue;
    let v = a[key];
    switch (m.type) {
      case "string": a[key] = typeof v === "string" ? v.trim() : String(v ?? ""); break;
      case "number":
      case "integer": {
        let n = (typeof v === "string" && v.trim() !== "") ? Number(v) : (Number.isFinite(v) ? Number(v) : NaN);
        if (!Number.isFinite(n)) n = NaN;
        if (Number.isFinite(m.minimum)) n = Math.max(m.minimum, n);
        if (Number.isFinite(m.maximum)) n = Math.min(m.maximum, n);
        if (m.type === "integer" && Number.isFinite(n)) n = Math.trunc(n);
        a[key] = n;
        break;
      }
      case "boolean": {
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          if (s === "true" || s === "1" || s === "yes") v = true;
          else if (s === "false" || s === "0" || s === "no") v = false;
        }
        a[key] = Boolean(v);
        break;
      }
      case "array": if (!Array.isArray(v)) a[key] = (v == null ? [] : [v]); break;
      case "object": if (typeof v !== "object" || v === null || Array.isArray(v)) a[key] = {}; break;
      default: break;
    }
  }

  if (additionalProps === false) {
    const allowed = new Set(Object.keys(meta));
    Object.keys(a).forEach(k => { if (!allowed.has(k)) delete a[k]; });
  }

  const errors = [];
  for (const k of required) {
    if (!(k in a)) { errors.push({ field: k, reason: "required_missing" }); continue; }
    const m = meta[k]; const v = a[k];
    if (m?.type === "string" && String(v).trim() === "") errors.push({ field: k, reason: "required_empty_string" });
    if ((m?.type === "number" || m?.type === "integer") && !Number.isFinite(v)) errors.push({ field: k, reason: "required_not_number" });
  }
  Object.entries(meta).forEach(([k, m]) => {
    if (!Array.isArray(m.enum) || !(k in a)) return;
    const v = a[k];
    if (!m.enum.includes(v)) errors.push({ field: k, reason: "enum_invalid", allowed: m.enum });
  });
  Object.entries(meta).forEach(([k, m]) => {
    if (!(k in a)) return;
    const v = a[k];
    if ((m.type === "number" || m.type === "integer") && Number.isFinite(v)) {
      if (Number.isFinite(m.minimum) && v < m.minimum) errors.push({ field: k, reason: "min_violation", min: m.minimum, got: v });
      if (Number.isFinite(m.maximum) && v > m.maximum) errors.push({ field: k, reason: "max_violation", max: m.maximum, got: v });
    }
  });

  return { args: a, errors };
}

/******************************************************************************* 
/* functionSignature: getExpandedToolArgs (args, wo)                            *
/* Expands common text fields to the full assistant text if available.         *
/*******************************************************************************/
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

/******************************************************************************* 
/* functionSignature: getExecToolCall (toolModules, toolCall, coreData, specs)  *
/* Executes one tool call with validation and mapping.                          *
/*******************************************************************************/
async function getExecToolCall(toolModules, toolCall, coreData, toolSpecsByName) {
  const wo = coreData?.workingObject || {};
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  let args = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  args = getExpandedToolArgs(args, wo);
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();

  wo.logging?.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Tool call start",
    details: { tool_call_id: toolCall?.id || null, tool: name || null, args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX) }
  });

  if (!tool) {
    const msg = { ok: false, error: `Tool "${name}" not found` };
    wo.logging?.push({ timestamp: new Date().toISOString(), severity: "error", module: MODULE_NAME, exitStatus: "failed", message: "Tool call failed (not found)" });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(msg) };
  }

  const spec = toolSpecsByName[name];
  let normalizedArgs = args;
  let validationErrors = [];
  if (spec) {
    const { args: norm, errors } = getNormalizeArgsBySchema(name, args, spec);
    normalizedArgs = norm;
    validationErrors = errors;
  }

  if (validationErrors.length) {
    const errPayload = { ok: false, error: "Validation failed", errors: validationErrors, normalized_preview: normalizedArgs };
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Validation failed for tool "${name}"`,
      details: errPayload
    });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(errPayload) };
  }

  try {
    try { await putItem(name, "status:tool"); } catch {}
    const result = await tool.invoke(normalizedArgs, coreData);
    const durationMs = Date.now() - startTs;

    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "Tool call success",
      details: { tool_call_id: toolCall?.id || null, tool: name, duration_ms: durationMs, result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX) }
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
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData?.workingObject?.StatusToolClearDelayMs) : 800;
    setTimeout(() => { try { putItem("", "status:tool"); } catch {} }, Math.max(0, delayMs));
  }
}

/******************************************************************************* 
/* functionSignature: getSystemContentBase (wo)                                *
/* Builds system content, runtime hints, and contract.                         *
/*******************************************************************************/
function getSystemContentBase(wo) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Persona === "string" ? wo.Persona.trim() : "",
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
    "- Always answer the latest user turn.",
    "- Use recent conversation history for continuity and accuracy.",
    "- If the user asks to recall or summarize prior discussion, use the provided history.",
    "- ALWAYS answer in human readable plain text, unless you are explicitly told to answer in a different format",
    "- NEVER ANSWER with JSON unless you are explicitly asked. DO NOT imitate the format from the context"
  ].join("\n");
  const toolContract = "Tool call contract: Emit EXACTLY ONE line '[tool:NAME]{JSON}'; valid json example: '{\"parameter1\":\"value1\",\"parameter2\":\"value2\"}' ; ensure that the JSON is a valid json; do not add additional text; set ALL required fields; replace placeholders in angle brackets with best-known values (e.g., <USER_TEXT>, <URL>, <LANG>, <CHANNEL_ID>, …) using the latest user message, provided context, or sensible defaults; keep explicit mappings: <USER_TEXT>=latest user text, <URL>=valid URL from message if present, <LANG>=language code like \"en\"; if a required placeholder cannot be resolved, do not emit a tool call (optional fields may be omitted); otherwise, write a normal response; no markdown, no extra text.";

  const multiChannelNote = (() => {
    const raw = Array.isArray(wo?.contextIDs) ? wo.contextIDs : [];
    const extraIds = raw
      .map(v => String(v || "").trim())
      .filter(v => v.length > 0);
    if (!extraIds.length) return "";

    const currentId = String(wo?.id ?? "").trim();
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
  parts.push(policy);
  parts.push(toolContract);
  if (multiChannelNote) parts.push(multiChannelNote);
  return parts;
}

/******************************************************************************* 
/* functionSignature: getSystemContent (wo, specs)                              *
/* Produces system content including compact catalog.                          *
/*******************************************************************************/
async function getSystemContent(wo, specs) {
  const parts = getSystemContentBase(wo);
  const catalog = getRenderPseudoCatalog(specs || []);
  if (catalog) parts.push(catalog);
  return parts.filter(Boolean).join("\n\n");
}

/******************************************************************************* 
/* functionSignature: getCoreAi (coreData)                                     *
/* Orchestrates pseudo tool calls and persistence.                              *
/*******************************************************************************/
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

  const skipContextWrites = wo?.doNotWriteToContext === true;

  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "started", message: "AI request started" });

  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch (e) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: MODULE_NAME, exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` });
  }

  const toolModules = await getToolsByName(kiCfg.toolsList, wo);
  const specsArr = await getPseudoToolSpecs(kiCfg.toolsList || [], wo);
  const toolSpecsByName = {};
  specsArr.forEach(s => { toolSpecsByName[s.name] = s; });

  const systemContent = await getSystemContent(wo, specsArr);
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

  const persistQueue = [];
  let finalText = "";
  let accumulatedText = "";
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
      const msgText = typeof msg.content === "string" ? msg.content : "";

      const extracted = (!pseudoToolUsed && msgText) ? getExtractPseudoToolCall(msgText) : null;
      const looksLikePseudoTool = !!extracted;

      const assistantMsg = { role: "assistant", authorName: getAssistantAuthorName(wo), content: msgText };
      if (assistantMsg.authorName == null) delete assistantMsg.authorName;

      messages.push(assistantMsg);
      persistQueue.push(getWithTurnId(assistantMsg, wo));

      if (msgText) {
        const clean = extracted ? (extracted.cleanText || "") : msgText;
        const chunk = String(clean || "").trim();
        if (!looksLikePseudoTool && chunk) {
          accumulatedText += (accumulatedText ? "\n" : "") + chunk;
        }
        if (looksLikePseudoTool && extracted?.cleanText) {
          const chunk2 = String(extracted.cleanText || "").trim();
          if (chunk2) accumulatedText += (accumulatedText ? "\n" : "") + chunk2;
        }
      }

      if (!pseudoToolUsed && extracted) {
        const pt = extracted;

        wo._fullAssistantText = accumulatedText.trim();

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
          wo._fullAssistantText = undefined;
          continue;
        }

        const toolMsg = await getExecToolCall(
          toolModules,
          { id: "pseudo_" + pt.name, function: { name: pt.name, arguments: JSON.stringify(pt.args ?? {}) } },
          coreData,
          toolSpecsByName
        );

        persistQueue.push(getWithTurnId(toolMsg, wo));

        const toolResultText = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? null);
        const userToolResult = { role: "user", content: `[tool_result:${pt.name}]\n${toolResultText}` };
        messages.push(userToolResult);
        persistQueue.push(getWithTurnId(userToolResult, wo));

        pseudoToolUsed = true;
        wo._fullAssistantText = undefined;
        continue;
      }

      if (finish === "length") {
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue;
      }

      finalText = accumulatedText || msgText.trim() || "";
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.Response = "[Empty AI response]";
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: isAbort ? "warn" : "error",
        module: MODULE_NAME,
        exitStatus: "failed",
        message: isAbort ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}`
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
      message: `doNotWriteToContext=true → skipped persistence of ${persistQueue.length} turn(s)`
    });
  }

  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });
  return coreData;
}