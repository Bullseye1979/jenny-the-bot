/**************************************************************/
/* filename: "01002-core-ai-pseudotoolcalls.js"              */
/* Version 1.0                                               */
/* Purpose: Pipeline module — completions API with text-     */
/*          based pseudo tool call parsing for models        */
/*          without native function calling support.         */
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
  getManifestPolicyHints,
  getToolsByName,
  getToolStatusScope,
  getToolStatusKey,
  setRememberActiveToolStatus,
  writeToolcallLog,
  getToolcallLogBase,
  getToolPaginationMeta,
  getParseArtifactsBlock,
  getExpandedToolArgs,
  getChannelAwarenessBlock,
  getSystemContentText,
  getPromptFromSnapshot,
  getAppendedContextBlockToUserContent
} from "../shared/ai/utils.js";

const MODULE_NAME      = "core-ai-pseudotoolcalls";
const ARG_PREVIEW_MAX  = 400;
const RESULT_PREVIEW_MAX = 400;


function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "pseudotoolcalls";
}


function getKiCfg(wo) {
  const _toolsRaw       = Array.isArray(wo?.tools) ? wo.tools : [];
  const _toolsBlacklist = Array.isArray(wo?.toolsBlacklist) ? wo.toolsBlacklist : [];
  const toolsList       = _toolsBlacklist.length ? _toolsRaw.filter(t => !_toolsBlacklist.includes(t)) : _toolsRaw;
  return {
    includeHistory:               getBool(wo?.includeHistory, true),
    includeHistorySystemMessages: getBool(wo?.includeHistorySystemMessages, false),
    includeRuntimeContext:        getBool(wo?.includeRuntimeContext, false),
    toolsList,
    temperature:        getNum(wo?.temperature, 0.7),
    maxTokens:          getNum(wo?.maxTokens, 2000),
    maxLoops:           getNum(wo?.maxLoops, 20),
    requestTimeoutMs:   getNum(wo?.requestTimeoutMs, 120000),
    maxToolCallsTotal:  getNum(wo?.maxToolCallsTotal, 3),
    maxToolCallsPerTurn: getNum(wo?.maxToolCallsPerTurn, 1)
  };
}


function getRuntimeContextFromLast(wo, kiCfg, lastRecord) {
  if (!kiCfg.includeRuntimeContext || !kiCfg.includeHistory || !lastRecord) return null;
  const metadata = { id: String(wo?.channelId ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord };
  if ("content" in last) delete last.content;
  return { metadata, last };
}


function getConcreteExampleValue(key, meta) {
  const m    = meta || {};
  const t    = m.type || "string";
  const enums = Array.isArray(m.enum) ? m.enum : null;
  if (enums && enums.length) return enums[0];
  const k = String(key || "").toLowerCase();
  if (t === "string") {
    if (/^(q|query)$/.test(k))              return "<USER_TEXT>";
    if (/prompt/.test(k))                   return "<USER_TEXT>";
    if (/^(url|uri|link)$/.test(k))         return "<URL>";
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
  if (t === "array")   return [];
  if (t === "object")  return {};
  return "<VALUE>";
}


async function getPseudoToolSpecs(names, wo) {
  const log   = getPrefixedLogger(wo, import.meta.url);
  const specs = [];
  for (const name of names || []) {
    try {
      const mod  = await import(`../tools/${name}.js`);
      const tool = (mod?.default ?? mod) || {};
      const def  = tool?.definition?.function;
      const parameters  = def?.parameters || {};
      const description = def?.description || def?.name || name;
      const required    = Array.isArray(parameters?.required) ? parameters.required : [];
      const props       = (parameters?.properties && typeof parameters.properties === "object") ? parameters.properties : {};

      const meta = {};
      Object.entries(props).forEach(([k, v]) => {
        meta[k] = {
          type:        typeof v?.type === "string" ? v.type : "string",
          description: typeof v?.description === "string" ? v.description.trim() : "",
          required:    required.includes(k),
          enum:        Array.isArray(v?.enum) ? v.enum : undefined,
          minimum:     Number.isFinite(v?.minimum) ? v.minimum : undefined,
          maximum:     Number.isFinite(v?.maximum) ? v.maximum : undefined,
          default:     Object.prototype.hasOwnProperty.call(v ?? {}, "default") ? v.default : undefined,
          aliases:     Array.isArray(v?.["x-aliases"]) ? v["x-aliases"].filter(a => typeof a === "string" && a.trim()).map(a => a.trim()) : []
        };
      });

      const argsTemplate = {};
      Object.entries(meta).forEach(([k, m]) => { if (m.required) argsTemplate[k] = getConcreteExampleValue(k, m); });

      specs.push({
        name:                 def?.name || tool?.name || name,
        description,
        argsTemplate,
        argsMeta:             meta,
        required,
        additionalProperties: parameters?.additionalProperties
      });
    } catch (e) {
      log(`Spec load failed for "${name}": ${e?.message || String(e)}`, "warn");
    }
  }
  return specs;
}


function getShortDesc(s, max = 80) {
  const txt = (s || "").replace(/\s+/g, " ").trim();
  return txt.length > max ? txt.slice(0, max - 1) + "…" : txt;
}


function getRenderPseudoCatalog(specs) {
  if (!Array.isArray(specs) || !specs.length) return "";
  const lines = ["<TOOLS_MINI>"];
  for (const s of specs) {
    const reqKeys = (s.required || []).join(",");
    const desc    = getShortDesc(s.description || s.name || "", 80);
    lines.push(`${s.name}: ${desc} — required:[${reqKeys}] — format [tool:${s.name}]{...}`);
    lines.push(`eg: [tool:${s.name}]${JSON.stringify(s.argsTemplate || {})}`);
  }
  lines.push("</TOOLS_MINI>");
  return lines.join("\n");
}


function getNormalizeArgsBySchema(_name, args, spec) {
  const a        = (args && typeof args === "object") ? { ...args } : {};
  const meta     = spec?.argsMeta || {};
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
      case "string":
        a[key] = typeof v === "string" ? v.trim() : String(v ?? "");
        break;
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
          if (s === "true"  || s === "1" || s === "yes") v = true;
          if (s === "false" || s === "0" || s === "no")  v = false;
        }
        a[key] = Boolean(v);
        break;
      }
      case "array":  if (!Array.isArray(v)) a[key] = (v == null ? [] : [v]); break;
      case "object": if (typeof v !== "object" || v === null || Array.isArray(v)) a[key] = {}; break;
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
    if (m?.type === "string"  && String(v).trim() === "")      errors.push({ field: k, reason: "required_empty_string" });
    if ((m?.type === "number" || m?.type === "integer") && !Number.isFinite(v)) errors.push({ field: k, reason: "required_not_number" });
  }
  Object.entries(meta).forEach(([k, m]) => {
    if (!Array.isArray(m.enum) || !(k in a)) return;
    if (!m.enum.includes(a[k])) errors.push({ field: k, reason: "enum_invalid", allowed: m.enum });
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


function getExtractPseudoToolCall(text) {
  if (!text || typeof text !== "string") return null;

  const s      = String(text);
  const headRe = /\[tool:([A-Za-z0-9_.\-]+)\]/g;
  let m = null; let last = null;
  while ((m = headRe.exec(s)) !== null) last = { name: m[1], idx: m.index, headLen: m[0].length };
  if (!last) return null;

  const name      = last.name;
  const afterHead = s.slice(last.idx + last.headLen);

  const skipWs = (str) => {
    let i = 0;
    while (i < str.length && /\s/.test(str[i])) i++;
    return { rest: str.slice(i), skipped: i };
  };

  const tryReadJsonObject = (str) => {
    if (!str.startsWith("{")) return null;
    let depth = 0; let inStr = false; let esc = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
      } else {
        if (ch === "\"") { inStr = true; continue; }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) return { json: str.slice(0, i + 1), len: i + 1 }; }
      }
    }
    return null;
  };

  const { rest: tail0, skipped } = skipWs(afterHead);
  let jsonText = ""; let cutEnd = last.idx + last.headLen + skipped;

  const inline = tryReadJsonObject(tail0);
  if (inline) {
    jsonText = inline.json;
    cutEnd  += inline.len;
  } else {
    const { rest: tail1, skipped: skipped2 } = skipWs(tail0);
    const multi = tryReadJsonObject(tail1);
    if (!multi) return null;
    jsonText = multi.json;
    cutEnd  += skipped + skipped2 + multi.len;
  }

  let args = {};
  try { args = JSON.parse(jsonText); } catch { args = getTryParseJSON(jsonText, {}); }

  const before = s.slice(0, last.idx).trim();
  return { name, args, cleanText: before, toolText: `[tool:${name}]${jsonText}` };
}


function getExtractUrlsFromAny(obj) {
  const out  = [];
  const seen = new Set();

  const add = (u) => {
    const s = typeof u === "string" ? u.trim() : "";
    if (!s) return;
    if (!/^https?:\/\//i.test(s) && !/^data:image\//i.test(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const scan = (v, depth) => {
    if (depth > 5 || v == null) return;
    if (typeof v === "string") { add(v); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    if (typeof v !== "object") return;
    const directKeys = ["url", "imageUrl", "image_url", "href", "link", "image", "output", "result", "files"];
    for (const k of directKeys) { if (Object.prototype.hasOwnProperty.call(v, k)) scan(v[k], depth + 1); }
    for (const [k, val] of Object.entries(v)) { if (typeof k === "string" && /url|link|href|image/i.test(k)) scan(val, depth + 1); }
  };

  scan(obj, 0);
  return out;
}


function getExtractUrlsFromToolContent(toolContent) {
  const s      = String(toolContent ?? "").trim();
  if (!s) return [];
  const direct = (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) ? [s] : [];
  const parsed = getTryParseJSON(s, null);
  const urls   = parsed ? getExtractUrlsFromAny(parsed) : [];
  return [...new Set([...direct, ...urls])];
}


async function getExecToolCall(toolModules, toolCall, coreData, toolSpecsByName) {
  const wo   = coreData?.workingObject || {};
  const log  = getPrefixedLogger(wo, import.meta.url);
  const name = toolCall?.function?.name || toolCall?.name;
  const argsRaw = toolCall?.function?.arguments ?? toolCall?.arguments ?? "{}";
  let   args    = typeof argsRaw === "string" ? getTryParseJSON(argsRaw, {}) : (argsRaw || {});
  args = getExpandedToolArgs(args, wo);
  const tool    = toolModules.find(t => (t.definition?.function?.name || t.name) === name);
  const startTs = Date.now();

  log("Tool call start", "info", { tool_call_id: toolCall?.id || null, tool: name || null, args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX) });

  if (!tool) {
    log("Tool call failed (not found)", "error");
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ ok: false, error: `Tool "${name}" not found` }) };
  }

  const spec = toolSpecsByName[name];
  let normalizedArgs    = args;
  let validationErrors  = [];
  if (spec) {
    const { args: norm, errors } = getNormalizeArgsBySchema(name, args, spec);
    normalizedArgs   = norm;
    validationErrors = errors;
  }

  if (validationErrors.length) {
    const errPayload = { ok: false, error: "Validation failed", errors: validationErrors, normalized_preview: normalizedArgs };
    log(`Validation failed for tool "${name}"`, "warn", errPayload);
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(errPayload) };
  }

  const _statusScope   = getToolStatusScope(coreData?.workingObject || {});
  if (!Number.isFinite(wo._statusToolGen)) wo._statusToolGen = 0;
  const _myGen         = ++wo._statusToolGen;
  const _statusToken   = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const _statusKey     = getToolStatusKey(coreData?.workingObject || {});
  const _statusPayload = {
    name,
    flow:       String(coreData?.workingObject?.flow || ""),
    scope:      _statusScope,
    token:      _statusToken,
    channelId:  _statusKey,
    statusKey:  _statusKey,
    toolCallId: toolCall?.id || ""
  };

  try {
    wo._dashboardActiveTool = _statusPayload;
    try { await putItem(_statusPayload, "status:tool"); } catch {}
    if (_statusKey) try { await putItem(_statusPayload, "status:tool:" + _statusKey); } catch {}

    const result     = await tool.invoke(normalizedArgs, coreData);
    const durationMs = Date.now() - startTs;
    log("Tool call success", "info", { tool_call_id: toolCall?.id || null, tool: name, durationMs, result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX) });
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    log("Tool call error", "error", { tool_call_id: toolCall?.id || null, tool: name, durationMs, error: String(e?.message || e) });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  } finally {
    if (wo._statusToolGen === _myGen) {
      setRememberActiveToolStatus(wo, _statusPayload, true);
    }
  }
}


export default async function getCoreAi(coreData) {
  let wo  = coreData.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);
  wo = await applyAiFallbackOverrides(wo, { log, moduleName: MODULE_NAME, endpoint: wo?.endpoint });
  coreData.workingObject = wo;

  if (!getShouldRunForThisModule(wo)) {
    log(`Skipped: useAiModule="${String(wo?.useAiModule ?? "").trim()}" != "pseudotoolcalls"`, "info");
    return coreData;
  }

  if (wo.skipAiCompletions === true) {
    log("Skipped: skipAiCompletions flag set", "info");
    return coreData;
  }

  const kiCfg        = getKiCfg(wo);
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
  const toolModules        = await getToolsByName(kiCfg.toolsList, wo);
  const specsArr           = await getPseudoToolSpecs(kiCfg.toolsList || [], wo);
  const toolSpecsByName    = {};
  specsArr.forEach(s => { toolSpecsByName[s.name] = s; });

  const baseSystemContent  = getSystemContentText(wo, { earliestTimestamps, moduleCfg });
  const toolContract       = getStr(wo?.toolContractPrompt, "") || getStr(moduleCfg?.toolContractPrompt, "");
  const catalog            = getRenderPseudoCatalog(specsArr);
  const systemContent      = [baseSystemContent, toolContract, catalog].filter(Boolean).join("\n\n");

  const allowToolHistory      = false;
  const messagesFromHistory   = getPromptFromSnapshot(snapshot, kiCfg, allowToolHistory);
  const lastRecord            = Array.isArray(snapshot) && snapshot.length ? snapshot[snapshot.length - 1] : null;
  let   userContent           = userPromptRaw;
  const runtimeCtx            = getRuntimeContextFromLast(wo, kiCfg, lastRecord);
  if (runtimeCtx) userContent = getAppendedContextBlockToUserContent(userContent, runtimeCtx);

  let messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userContent }
  ];

  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];

  const toolCallLog     = [];
  let   finalText       = "";
  let   accumulatedText = "";
  let   toolCallsUsedTotal = 0;
  let   hitMaxLoops     = false;
  let   hitMaxToolCalls = false;

  for (let i = 0; i < kiCfg.maxLoops; i++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }

    try {
      log("AI request tool snapshot", "info", {
        channelId:       String(wo?.channelId || ""),
        callerChannelId: String(wo?.callerChannelId || ""),
        useAiModule:     String(wo?.useAiModule || ""),
        toolsDisabled:   false,
        configuredTools: Array.isArray(wo?.tools) ? wo.tools : [],
        requestToolNames: Array.isArray(kiCfg.toolsList) ? kiCfg.toolsList.slice() : [],
        toolChoice:      "pseudo-inline"
      });

      const body = {
        model:       wo.model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens:  kiCfg.maxTokens
      };

      const headers = await getRequestHeaders(wo);
      const res     = await fetchWithTimeout(wo.endpoint, { method: "POST", headers, body: JSON.stringify(body) }, kiCfg.requestTimeoutMs);
      const raw     = await res.text();

      if (!res.ok) {
        log(`HTTP ${res.status} ${res.statusText} ${raw.slice(0, 400)}`, "warn");
        wo.response = accumulatedText.trim() || "[Empty AI response]";
        return coreData;
      }

      const data       = getTryParseJSON(raw, null);
      const choice     = data?.choices?.[0];
      const finish     = choice?.finish_reason;
      const msg        = choice?.message || {};
      const msgText    = typeof msg.content === "string" ? msg.content : "";
      const extracted  = (!wo.__forceNoTools && msgText) ? getExtractPseudoToolCall(msgText) : null;

      log(`AI turn ${i + 1}: finish_reason="${finish ?? "null"}" content_length=${msgText.length} pseudo_tool=${extracted ? extracted.name : "none"}`, "info");

      const assistantMsg = { role: "assistant", authorName: getAssistantAuthorName(wo), content: msgText };
      if (assistantMsg.authorName == null) delete assistantMsg.authorName;
      messages.push(assistantMsg);
      wo._contextPersistQueue.push(getWithTurnId(assistantMsg, wo));

      const cleanAssistantText = extracted ? String(extracted.cleanText || "").trim() : String(msgText || "").trim();
      if (cleanAssistantText) accumulatedText += (accumulatedText ? "\n" : "") + cleanAssistantText;

      if (extracted) {
        if (toolCallsUsedTotal >= kiCfg.maxToolCallsTotal) {
          hitMaxToolCalls = true;
          log(`Tool call ignored: maxToolCallsTotal reached (${toolCallsUsedTotal}/${kiCfg.maxToolCallsTotal})`, "warn", { tool: extracted.name });
          finalText = accumulatedText || cleanAssistantText || msgText.trim() || "";
          break;
        }

        toolCallsUsedTotal++;
        wo._fullAssistantText = accumulatedText.trim();

        if (Array.isArray(kiCfg.toolsList) && kiCfg.toolsList.length && !kiCfg.toolsList.includes(extracted.name)) {
          log(`Pseudo tool not allowed: ${extracted.name}`, "warn");
          const userErr = { role: "user", content: `[tool_error:${extracted.name}] Tool not allowed` };
          messages.push(userErr);
          wo._contextPersistQueue.push(getWithTurnId(userErr, wo));
          wo._fullAssistantText = undefined;
          continue;
        }

        const _tcStartMs = Date.now();
        const toolMsg    = await getExecToolCall(
          toolModules,
          { id: "pseudo_" + extracted.name, function: { name: extracted.name, arguments: JSON.stringify(extracted.args ?? {}) } },
          coreData,
          toolSpecsByName
        );
        const _tcDurationMs = Date.now() - _tcStartMs;
        let   _tcStatus     = "success";
        try { const r = getTryParseJSON(typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? "{}"), {}); if (r?.ok === false) _tcStatus = "failed"; } catch {}
        toolCallLog.push({ tool: extracted.name, status: _tcStatus, durationMs: _tcDurationMs, task: "" });
        wo.toolCallLog = toolCallLog.slice();
        writeToolcallLog({ ...getToolcallLogBase(wo), tool: extracted.name, status: _tcStatus, durationMs: _tcDurationMs, ...getToolPaginationMeta(extracted.name, toolMsg.content) });

        wo._contextPersistQueue.push(getWithTurnId(toolMsg, wo));

        const toolResultText = typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content ?? null);
        const urls           = getExtractUrlsFromToolContent(toolResultText);
        const urlsText       = urls.length ? urls.join("\n") : "";

        const userToolResult = {
          role:    "user",
          content: `[tool_result:${extracted.name}]\n` +
                   toolResultText +
                   (urlsText ? `\n\nIMAGE_URLS:\n${urlsText}\n` : "\n") +
                   `\nINSTRUCTION: Continue your previous answer. If IMAGE_URLS are present, append the first URL at the VERY END of your final text. (toolCallsUsedTotal=${toolCallsUsedTotal}/${kiCfg.maxToolCallsTotal})`
        };
        messages.push(userToolResult);
        wo._contextPersistQueue.push(getWithTurnId(userToolResult, wo));
        wo._fullAssistantText = undefined;
        continue;
      }

      const cutOff = !wo.__noContinuation && (finish === "length" || getLooksCutOff(cleanAssistantText));
      if (cutOff) {
        const continuationPromptText = getStr(wo?.continuationPrompt, "") || getStr(moduleCfg?.continuationPrompt, "")
          || "Continue exactly where you stopped. Do not restart, do not summarize, do not repeat the previous text. Output only the missing continuation.";
        const cont = { role: "user", content: continuationPromptText };
        messages.push(cont);
        wo._contextPersistQueue.push(getWithTurnId(cont, wo));
        log(`Continue triggered: finish_reason="${finish ?? "null"}" looks_cut_off=${getLooksCutOff(cleanAssistantText)}`, "info");
        continue;
      }

      finalText = accumulatedText || msgText.trim() || "";
      break;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.response = "[Empty AI response]";
      log(isAbort ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}`, isAbort ? "warn" : "error");
      return coreData;
    }
  }

  if (!finalText && !hitMaxToolCalls && messages.length && messages[messages.length - 1]?.role !== "assistant") {
    hitMaxLoops = true;
  }

  const reasoningEnabled = wo?.reasoning != null && wo?.reasoning !== false && wo?.reasoning !== 0;
  if (reasoningEnabled) {
    const parts = toolCallLog.length
      ? ["Tools called:\n" + toolCallLog.map(e => {
          if (typeof e === "object") {
            const icon = e.status === "success" ? "✅" : (e.status === "failed" ? "❌" : "⚠️");
            const ms   = e.durationMs >= 1000 ? `${(e.durationMs / 1000).toFixed(1)}s` : `${e.durationMs}ms`;
            const task = e.task ? ` — ${e.task}` : "";
            return `${icon} **${e.tool}** (${ms})${task}`;
          }
          return `- ${e}`;
        }).join("\n")]
      : ["Answered from context — no tool calls."];
    wo.reasoningSummary = parts.join("\n\n");
  } else {
    wo.reasoningSummary = undefined;
  }

  if (Array.isArray(wo._pendingSubtaskLogs) && wo._pendingSubtaskLogs.length) {
    const _logBlock = wo._pendingSubtaskLogs.join("\n\n");
    wo.reasoningSummary = wo.reasoningSummary ? wo.reasoningSummary + "\n\n" + _logBlock : _logBlock;
    wo._pendingSubtaskLogs = [];
  }

  if (finalText) {
    wo.response = hitMaxToolCalls ? finalText + "\n\n" + getLimitNotice("tool")
                : hitMaxLoops    ? finalText + "\n\n" + getLimitNotice("loop")
                : finalText;
  } else if (hitMaxToolCalls) {
    const partial = (accumulatedText || "").trim();
    wo.response = partial ? (partial + "\n\n" + getLimitNotice("tool")) : ("[Max Tool Calls Hit]\n\n" + getLimitNotice("tool"));
  } else if (hitMaxLoops) {
    const partial = (accumulatedText || "").trim();
    wo.response = partial ? (partial + "\n\n" + getLimitNotice("loop")) : ("[Max Loops Hit]\n\n" + getLimitNotice("loop"));
  } else {
    wo.response = "[Empty AI response]";
  }

  wo.toolCallLog = toolCallLog.slice();
  const { primaryImageUrl: _primaryImg } = getParseArtifactsBlock(wo.response);
  if (_primaryImg) wo.primaryImageUrl = _primaryImg;
  log("AI response received.", "info");
  return coreData;
}
