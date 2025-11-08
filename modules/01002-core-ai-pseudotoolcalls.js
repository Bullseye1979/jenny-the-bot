/***************************************************************************************
/* filename: "core-ai-pseudotoolcalls.js"                                              *
/* Version 1.0                                                                          *
/* Purpose: Pseudo tool runner; ultra-compact prompt: per tool only 2 lines (purpose + *
/*          required example)                                                           *
/***************************************************************************************/
/***************************************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js";

const MODULE_NAME = "core-ai-pseudotoolcalls";
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;

/*******************************************************
/* functionSignature: getJsonSafe (v)                 *
/* One-line JSON-safe stringifier with fallbacks.     *
/*******************************************************/
function getJsonSafe(v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } }

/*******************************************************
/* functionSignature: getPreview (str, max)           *
/* Returns a truncated preview string with suffix.     *
/*******************************************************/
function getPreview(str, max = 400) { const s = String(str ?? ""); return s.length > max ? s.slice(0, max) + " …[truncated]" : s; }

/*******************************************************
/* functionSignature: getNum (value, def)             *
/* Converts to number if finite, otherwise default.    *
/*******************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/*******************************************************
/* functionSignature: getBool (value, def)            *
/* Converts to boolean if already boolean else default.*
/*******************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/*******************************************************
/* functionSignature: getStr (value, def)             *
/* Returns non-empty string or default value.          *
/*******************************************************/
function getStr(value, def) { return (typeof value === "string" && value.length) ? value : def; }

/*******************************************************
/* functionSignature: getTryParseJSON (text, fallback)*
/* Safe JSON.parse with fallback value.               *
/*******************************************************/
function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }

/*******************************************************
/* functionSignature: getShouldRunForThisModule (wo)  *
/* Checks if this module should process the request.   *
/*******************************************************/
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  return v === "pseudotoolcalls";
}

/*******************************************************
/* functionSignature: getWithTurnId (rec, wo)         *
/* Adds turn_id from working object to a record.       *
/*******************************************************/
function getWithTurnId(rec, wo) {
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  return t ? { ...rec, turn_id: t } : rec;
}

/*******************************************************
/* functionSignature: getKiCfg (wo)                   *
/* Builds runtime configuration from working object.   *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getRuntimeContextFromLast (wo, kiCfg, lastRecord) *
/* Extracts minimal runtime context from history.      *
/*******************************************************/
function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.id ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}

/*******************************************************
/* functionSignature: getAppendedContextBlockToUserContent (baseText, contextObj) *
/* Appends JSON context block to user content.         *
/*******************************************************/
function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}

/*******************************************************
/* functionSignature: getPromptFromSnapshot (rows, kiCfg) *
/* Transforms history snapshot into prompt messages.   *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getToolsByName (names, wo)      *
/* Dynamically imports and validates tool modules.     *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getMaybePseudoToolCall (text)   *
/* Parses a single-line pseudo tool call from text.    *
/*******************************************************/
function getMaybePseudoToolCall(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/^\s*\[tool:([A-Za-z0-9_.\-]+)\]\s*(\{[\s\S]*\})\s*$/m);
  if (!m) return null;
  const name = m[1];
  let args = {};
  try { args = JSON.parse(m[2]); } catch { args = getTryParseJSON(m[2], {}); }
  return { name, args };
}

/*******************************************************
/* functionSignature: getPseudoToolSpecs (names, wo)  *
/* Loads tool schemas and builds compact specs.        *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getConcreteExampleValue (key, metaEntry) *
/* Produces placeholder example values by schema.      *
/*******************************************************/
function getConcreteExampleValue(key, metaEntry) {
  const m = metaEntry || {};
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

/*******************************************************
/* functionSignature: getShortDesc (s, max)           *
/* Normalizes whitespace and truncates description.    *
/*******************************************************/
function getShortDesc(s, max = 80) {
  const txt = (s || "").replace(/\s+/g, " ").trim();
  return txt.length > max ? txt.slice(0, max - 1) + "…" : txt;
}

/*******************************************************
/* functionSignature: getRenderPseudoCatalog (specs)  *
/* Renders a two-line catalog entry per tool.          *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getNormalizeArgsBySchema (name, args, spec) *
/* Normalizes and validates args against tool schema.  *
/*******************************************************/
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

/*******************************************************
/* functionSignature: getExecToolCall (toolModules, toolCall, coreData, toolSpecsByName) *
/* Executes a single tool call with schema validation. *
/*******************************************************/
async function getExecToolCall(toolModules, toolCall, coreData, toolSpecsByName) {
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

/*******************************************************
/* functionSignature: getSystemContentBase (wo)       *
/* Builds compact base system content string.          *
/*******************************************************/
function getSystemContentBase(wo) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
  ].filter(Boolean).join("\n\n");
  const rule1 = "If a tool fits, output EXACTLY ONE line [tool:NAME]{JSON}; set ALL required fields; replace <USER_TEXT> with the user's latest message, <URL> with a valid URL (from message if present), <LANG> with a code like \"en\"; no markdown, no extra text.";
  const parts = [];
  if (base) parts.push(base);
  parts.push(`time_iso=${nowIso} tz=${tz}`);
  parts.push(rule1);
  return parts;
}

/*******************************************************
/* functionSignature: getSystemContent (wo, specs)    *
/* Produces final system content including catalog.    *
/*******************************************************/
async function getSystemContent(wo, specs) {
  const parts = getSystemContentBase(wo);
  const catalog = getRenderPseudoCatalog(specs || []);
  if (catalog) parts.push(catalog);
  return parts.filter(Boolean).join("\n");
}

/*******************************************************
/* functionSignature: getCoreAi (coreData)            *
/* Core loop orchestrating pseudo tool calls.          *
/*******************************************************/
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
        message: isAbort ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}`
      });
      return coreData;
    } finally {
      clearTimeout(timer);
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
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });
  return coreData;
}
