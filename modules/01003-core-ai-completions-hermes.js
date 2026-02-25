/******************************************************************************* 
/* filename: "core-ai-completions-hermes.js"                                   *
/* Version 1.0                                                                 *
/* Purpose: Hermes-compatible multi-step tool runner for Oobabooga OpenAI API. *
/*          Uses Hermes-style <tools>/<tool_call>/<tool_response> blocks while *
/*          still calling an OpenAI-compatible chat-completions endpoint.      *
/*          Triggers when useAIModule is "hermes" OR "completions-hermes".     *
/*******************************************************************************/
/******************************************************************************* 
/*                                                                             *
/*******************************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-completions-hermes";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/******************************************************************************* 
/* functionSignature: getAssistantAuthorName (wo)                              *
/* Returns the assistant authorName (Botname).                                 *
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
  return v === "hermes" || v === "completions-hermes";
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
    else if (r.role === "tool") out.push({ role: "tool", name: r.name, content: r.content ?? "" });
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
/* functionSignature: getPseudoToolSpecs (names, wo)                           *
/* Loads schemas and renders compact specs.                                    *
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
          default: Object.prototype.hasOwnProperty.call(v ?? {}, "default") ? v.default : undefined
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
/* functionSignature: getRenderHermesTools (specs)                             *
/* Renders a Hermes-friendly <tools> catalog.                                  *
/*******************************************************************************/
function getRenderHermesTools(specs) {
  if (!Array.isArray(specs) || !specs.length) return "";
  const tools = specs.map(s => ({
    name: s.name,
    description: String(s.description || s.name || ""),
    required: Array.isArray(s.required) ? s.required : [],
    properties: s.argsMeta || {},
    example: s.argsTemplate || {}
  }));
  return "<tools>\n" + JSON.stringify(tools) + "\n</tools>";
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
      case "boolean": a[key] = Boolean(v); break;
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

  return { args: a, errors };
}

/******************************************************************************* 
/* functionSignature: getLastHermesToolCall (text)                             *
/* Extracts the last <tool_call>...</tool_call> JSON payload.                  *
/* Returns { name, args, raw } or null.                                        *
/*******************************************************************************/
function getLastHermesToolCall(text) {
  if (!text || typeof text !== "string") return null;
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m = null;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;

  const payload = getTryParseJSON(last.trim(), null);
  if (!payload || typeof payload !== "object") return null;

  const name = String(payload.name ?? payload.tool ?? payload.function ?? "").trim();
  const args = (payload.arguments && typeof payload.arguments === "object") ? payload.arguments
    : (payload.args && typeof payload.args === "object") ? payload.args
      : {};

  if (!name) return null;
  return { name, args, raw: payload };
}

/******************************************************************************* 
/* functionSignature: getExecToolCall (toolModules, name, args, coreData, spec)*
/* Executes one tool call with validation.                                     *
/*******************************************************************************/
async function getExecToolCall(toolModules, name, args, coreData, toolSpecsByName) {
  const wo = coreData?.workingObject || {};
  const tool = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();

  wo.logging?.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Tool call start",
    details: { tool: name || null, args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX) }
  });

  if (!tool) {
    const msg = { ok: false, error: `Tool "${name}" not found` };
    wo.logging?.push({ timestamp: new Date().toISOString(), severity: "error", module: MODULE_NAME, exitStatus: "failed", message: "Tool call failed (not found)" });
    return { role: "tool", name, content: JSON.stringify(msg) };
  }

  const spec = toolSpecsByName[name];
  let normalizedArgs = (args && typeof args === "object") ? { ...args } : {};
  let validationErrors = [];
  if (spec) {
    const { args: norm, errors } = getNormalizeArgsBySchema(name, normalizedArgs, spec);
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
    return { role: "tool", name, content: JSON.stringify(errPayload) };
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
      details: { tool: name, duration_ms: durationMs, result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX) }
    });

    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Tool call error",
      details: { tool: name, duration_ms: durationMs, error: String(e?.message || e) }
    });
    return { role: "tool", name, content: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData?.workingObject?.StatusToolClearDelayMs) : 800;
    setTimeout(() => { try { putItem("", "status:tool"); } catch {} }, Math.max(0, delayMs));
  }
}

/******************************************************************************* 
/* functionSignature: getSystemContentBase (wo, hermesToolsBlock)              *
/* Builds Hermes-compatible system content including <tools>.                  *
/*******************************************************************************/
function getSystemContentBase(wo, hermesToolsBlock) {
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
    `- timezone_hint: ${tz}`
  ].join("\n");

  const hermesContract = [
    "Hermes tool calling contract:",
    "- Tools are defined in the <tools> block.",
    "- If you need a tool, respond with EXACTLY one tool call block and nothing else:",
    "  <tool_call>{\"name\":\"TOOL_NAME\",\"arguments\":{...}}</tool_call>",
    "- Use ONLY tool names from the <tools> catalog.",
    "- Arguments MUST match the schema (required fields must be present).",
    "- After you receive a <tool_response> block, continue normally.",
    "- Do not use any other tool syntax."
  ].join("\n");

  const parts = [];
  if (base) parts.push(base);
  if (hermesToolsBlock) parts.push(hermesToolsBlock);
  parts.push(runtimeInfo);
  parts.push(hermesContract);
  return parts.filter(Boolean).join("\n\n");
}

/******************************************************************************* 
/* functionSignature: getCoreAi (coreData)                                     *
/* Hermes-compatible multi-step loop over an OpenAI-style chat endpoint.       *
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
      message: `Skipped: useAIModule="${String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim()}" not in [hermes, completions-hermes]`
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

  const hermesToolsBlock = getRenderHermesTools(specsArr);
  const systemContent = getSystemContentBase(wo, hermesToolsBlock);

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
          message: `HTTP ${res.status} ${res.statusText} ${typeof raw === "string" ? raw.slice(0, 300) : ""}`
        });
        return coreData;
      }

      const data = getTryParseJSON(raw, null);
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      const msg = choice?.message || {};
      const msgText = typeof msg.content === "string" ? msg.content : "";

      const assistantMsg = { role: "assistant", authorName: getAssistantAuthorName(wo), content: msgText };
      if (assistantMsg.authorName == null) delete assistantMsg.authorName;

      messages.push(assistantMsg);
      persistQueue.push(getWithTurnId(assistantMsg, wo));

      const tc = getLastHermesToolCall(msgText);
      if (tc) {
        const toolMsg = await getExecToolCall(toolModules, tc.name, tc.args, coreData, toolSpecsByName);

        messages.push(toolMsg);
        persistQueue.push(getWithTurnId(toolMsg, wo));

        const toolResponseBlock = "<tool_response>\n" + JSON.stringify({
          name: tc.name,
          content: toolMsg.content
        }) + "\n</tool_response>";

        const toolResponseUser = { role: "user", content: toolResponseBlock };
        messages.push(toolResponseUser);
        persistQueue.push(getWithTurnId(toolResponseUser, wo));

        continue;
      }

      if (finish === "length") {
        const cont = { role: "user", content: "continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue;
      }

      finalText = msgText.trim() || "";
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