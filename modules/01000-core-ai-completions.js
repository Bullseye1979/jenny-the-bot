/**************************************************************/
/* filename: "01000-core-ai-completions.js"                         */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


import { getContext, getContextEarliestTimestamps } from "../core/context.js";
import { getStr, getNum } from "../core/utils.js";
import { putItem, getItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { applyAiFallbackOverrides } from "../core/ai-fallback.js";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join }                           from "node:path";
import { fileURLToPath }                           from "node:url";

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


function getBool(value, def) { return typeof value === "boolean" ? value : def; }


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

function getToolDefsForCurrentStep(toolDefs, wo, totalToolCalls, maxToolCalls) {
  const defs = Array.isArray(toolDefs) ? toolDefs : [];
  if (wo?.__forceNoTools === true) return { toolDefs: [], mode: "final_only" };
  if (Number.isFinite(maxToolCalls) && totalToolCalls >= maxToolCalls) return { toolDefs: [], mode: "final_only" };
  return { toolDefs: defs, mode: "normal" };
}


function getTryParseJSON(text, fallback = {}) { try { return JSON.parse(text); } catch { return fallback; } }


function getWithTurnId(rec, wo) {
  const t = typeof wo?.turnId === "string" && wo.turnId ? wo.turnId : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined;
  return { ...(t ? { ...rec, turnId: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}

function getToolcallLogBase(wo) {
  return {
    ts: new Date().toISOString(),
    turnId: String(wo.turnId || wo.callerTurnId || ""),
    channel: String(wo.channelId || ""),
    callerChannel: String(wo.callerChannelId || ""),
    flow: String(wo.flow || "")
  };
}


function getToolStatusScope(wo) {
  const explicit =
    String(wo?.toolcallScope ?? "").trim();
  if (explicit) return explicit;
  const callerFlow = String(wo?.callerFlow || "").trim();
  if (callerFlow) return callerFlow;
  return String(wo?.flow || "").trim();
}


function getToolStatusKey(wo) {
  const explicit = String(wo?.toolStatusChannelOverride || "").trim();
  if (explicit) return explicit;
  return String(wo?.callerChannelId || wo?.channelId || "").trim();
}


function setRememberActiveToolStatus(wo, payload, hasGlobalStatus) {
  if (!wo || !payload?.token) return;
  const staleMs = Number.isFinite(wo?.statusToolStaleMs) ? Number(wo.statusToolStaleMs) : 600000;
  wo._activeToolStatus = {
    token: payload.token,
    statusKey: String(payload.statusKey || ""),
    hasGlobalStatus: hasGlobalStatus !== false
  };
  if (wo._activeToolStatusTimer) {
    try { clearTimeout(wo._activeToolStatusTimer); } catch {}
  }
  const timer = setTimeout(() => {
    try {
      const current = getItem("status:tool");
      if (hasGlobalStatus !== false && current?.token === payload.token) deleteItem("status:tool");
    } catch {}
    if (payload.statusKey) {
      try {
        const current = getItem("status:tool:" + payload.statusKey);
        if (current?.token === payload.token) deleteItem("status:tool:" + payload.statusKey);
      } catch {}
    }
  }, Math.max(1000, staleMs));
  Object.defineProperty(wo, "_activeToolStatusTimer", {
    value: timer,
    configurable: true,
    writable: true,
    enumerable: false
  });
}


function getKiCfg(wo) {
  const includeHistory = getBool(wo?.includeHistory, true);
  const includeHistoryTools = getBool(wo?.includeHistoryTools, false);
  const includeHistorySystemMessages = getBool(wo?.includeHistorySystemMessages, false);
  const includeRuntimeContext = getBool(wo?.includeRuntimeContext, false);
  const _toolsRaw = Array.isArray(wo?.tools) ? wo.tools : [];
  const _toolsBlacklist = Array.isArray(wo?.toolsBlacklist) ? wo.toolsBlacklist : [];
  const toolsList = _toolsBlacklist.length ? _toolsRaw.filter(t => !_toolsBlacklist.includes(t)) : _toolsRaw;
  return {
    includeHistory,
    includeHistoryTools,
    includeHistorySystemMessages,
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
  const metadata = { id: String(wo?.channelId ?? ""), flow: String(wo?.flow ?? ""), clientRef: String(wo?.clientRef ?? "") };
  const last = { ...lastRecord }; if ("content" in last) delete last.content;
  return { metadata, last };
}


function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}


function getChannelAwarenessBlock(wo) {
  const agentType = typeof wo?.agentType === "string" ? wo.agentType.trim() : "";
  const mode = agentType ? "orchestrator-or-specialist" : "primary-user-channel";

  const lines = [
    "Channel awareness:",
    `- channel_awareness_mode: ${mode}`,
  ];

  if (agentType) {
    lines.push(`- agent_type: ${agentType}`);
    if (wo?.agentRolePrompt) lines.push(`- ${wo.agentRolePrompt}`);
  } else {
    if (wo?.primaryRolePrompt) lines.push(`- ${wo.primaryRolePrompt}`);
    const toolNames = Array.isArray(wo?.tools) ? wo.tools : [];
    getManifestPolicyHints(toolNames).forEach(h => lines.push(`- ${h}`));
  }

  return lines.join("\n");
}


function getPromptFromSnapshot(rows, kiCfg, allowToolHistory = true) {
  if (!kiCfg.includeHistory) return [];
  const out = [];
  const includeTools = !!kiCfg.includeHistoryTools && !!allowToolHistory;
  const includeSystem = !!kiCfg.includeHistorySystemMessages;
  let lastAssistantToolIds = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const role = r.role;
    if (role === "system") {
      if (includeSystem) out.push({ role: "system", content: r.content ?? "" });
      continue;
    }
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


function getManifestPolicyHints(toolNames) {
  const hints = [];
  for (const name of toolNames) {
    try {
      const raw = readFileSync(join(_manifestDir, `${name}.json`), "utf8");
      const m = JSON.parse(raw);
      if (typeof m?.policyHint === "string" && m.policyHint.trim()) hints.push(m.policyHint.trim());
    } catch {}
  }
  return hints;
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


function getToolPaginationMeta(toolName, result) {
  const v = typeof result === "string" ? getTryParseJSON(result, result) : result;
  if (!v || typeof v !== "object") return {};

  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const len = (x) => (typeof x === "string" ? x.length : Array.isArray(x) ? x.length : undefined);
  const out = (o) => Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined));

  const stdPage = out({ rows: num(v.count), hasMore: v.has_more === true ? true : undefined, nextCtxId: v.next_start_ctx_id ?? undefined });

  switch (toolName) {
    case "getHistory":
    case "getGoogle":
    case "getTavily":
    case "getWebpage":
    case "getJira":
    case "getConfluence":
      return stdPage;

    case "getYoutube":
      return out({ rows: num(v.count), hasMore: v.has_more === true ? true : undefined, nextCtxId: v.next_start_ctx_id ?? undefined, mode: v.mode || undefined });

    case "getSpecialists": {
      const r = Array.isArray(v.rows) ? v.rows : [];
      return { specialistCount: num(v.count) ?? r.length, complete: num(v.complete) ?? r.filter(x => x.ok).length, failed: num(v.failed) ?? r.filter(x => !x.ok).length };
    }

    case "getOrchestrator":
      return out({ rows: num(v.count), responseLen: Array.isArray(v.rows) && v.rows[0] ? len(v.rows[0]) : undefined });

    case "getShell":
      return out({ exitCode: v.exitCode ?? undefined, outputBytes: len(Array.isArray(v.rows) ? v.rows[0] : undefined) });

    case "getApi":
    case "getGraph":
      return out({ status: num(v.status) });

    case "getFile":
    case "getFileContent":
    case "getText":
      return out({ bytes: num(v.bytes) });

    case "getZIP":
      return out({ bytes: num(v.bytes), files: Array.isArray(v.files) ? v.files.length : undefined });

    default:
      return {};
  }
}


function getToolResultMeta(result) {
  const value = typeof result === "string" ? getTryParseJSON(result, result) : result;
  if (value && typeof value === "object") {
    if (value.ok === false) {
      return { ok: false, error: typeof value.error === "string" ? value.error : "" };
    }
    if (typeof value.error === "string" && value.error.trim()) {
      return { ok: false, error: value.error.trim() };
    }
  }
  return { ok: true, error: "" };
}


function getLimitNotice(kind) {
  if (kind === "tool") {
    return "Tool budget reached. This is the partial result so far. Start a new AI run if you want me to continue the deep dive.";
  }
  if (kind === "loop") {
    return "Loop limit reached. This is the partial result so far. Start a new AI run if you want me to continue from here.";
  }
  return "";
}


function setEnsureFinalSynthesisPrompt(messages, wo) {
  if (wo?.__didToolBudgetNotice === true) return false;
  wo.__didToolBudgetNotice = true;
  messages.push({
    role: "user",
    content: "Tool-call budget exhausted. Provide the best possible final answer using only the existing conversation and prior tool outputs. Do not request or call any tools."
  });
  return true;
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
    writeToolcallLog({ ...getToolcallLogBase(wo), tool: "", status: "skipped_no_name", durationMs: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name: null, content: JSON.stringify({ error: "Tool call has no function name" }) };
  }
  log("Tool call start", "info", { tool_call_id: toolCall?.id || null, tool: name || null, args_preview: getPreview(getJsonSafe(args), ARG_PREVIEW_MAX) });
  if (!tool) {
    const msg = { error: `Tool "${name}" not found` };
    log("Tool call failed (not found)", "error", { tool_call_id: toolCall?.id || null, tool: name || null });
    writeToolcallLog({ ...getToolcallLogBase(wo), tool: String(name || ""), status: "not_found", durationMs: 0 });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify(msg) };
  }
  const _currentFlow = String(coreData?.workingObject?.flow || "");
  const _statusScope = getToolStatusScope(coreData?.workingObject || {});
  const _hasGlobalStatus = _currentFlow !== "api" || !!_statusScope;
  const _statusToken = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const _statusKey = getToolStatusKey(coreData?.workingObject || {});
  const _statusPayload = {
    name,
    flow: _currentFlow,
    scope: _statusScope,
    token: _statusToken,
    channelId: _statusKey,
    statusKey: _statusKey,
    toolCallId: toolCall?.id || ""
  };
  if (!Number.isFinite(wo._statusToolGen)) wo._statusToolGen = 0;
  const _myGen = ++wo._statusToolGen;
  try {
    wo._dashboardActiveTool = _statusPayload;
    if (_hasGlobalStatus) {
      try { await putItem(_statusPayload, "status:tool"); } catch {}
    }
    if (_statusKey) try { await putItem(_statusPayload, "status:tool:" + _statusKey); } catch {}
    const result = await tool.invoke(args, coreData);
    const durationMs = Date.now() - startTs;
    const resultMeta = getToolResultMeta(result);
    const logLevel = resultMeta.ok ? "info" : "warn";
    const logLabel = resultMeta.ok ? "Tool call success" : "Tool call returned error payload";
    log(logLabel, logLevel, {
      tool_call_id: toolCall?.id || null,
      tool: name,
      durationMs: durationMs,
      error: resultMeta.error || undefined,
      result_preview: getPreview(getJsonSafe(result), RESULT_PREVIEW_MAX)
    });
    writeToolcallLog({
      ...getToolcallLogBase(wo),
      tool: name,
      status: resultMeta.ok ? "success" : "returned_error",
      durationMs,
      ...(resultMeta.error ? { error: resultMeta.error } : {}),
      ...getToolPaginationMeta(name, result),
    });
    const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
    return { role: "tool", tool_call_id: toolCall?.id, name, content };
  } catch (e) {
    const durationMs = Date.now() - startTs;
    log("Tool call error", "error", { tool_call_id: toolCall?.id || null, tool: name, durationMs: durationMs, error: String(e?.message || e) });
    writeToolcallLog({ ...getToolcallLogBase(wo), tool: name, status: "error", durationMs, error: String(e?.message || e) });
    return { role: "tool", tool_call_id: toolCall?.id, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  } finally {
    if (wo._statusToolGen === _myGen) {
      setRememberActiveToolStatus(wo, _statusPayload, _hasGlobalStatus);
    }
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

  const earliestTimestamps = await getContextEarliestTimestamps(wo).catch(() => []);
  const earliestLines = earliestTimestamps.map(
    ({ channelId, earliestTs }) => `- context_earliest_record (channel "${channelId}"): ${earliestTs}`
  );

  const runtimeInfo = [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    ...earliestLines,
    ...(earliestLines.length
      ? ["- context_earliest_record shows how far back the database holds records for each channel, regardless of how many entries are visible in this context window. History tools can retrieve records all the way back to this date."]
      : []),
    "- When the user says \u201ctoday\u201d, \u201ctomorrow\u201d, or uses relative terms, interpret them relative to current_time_iso unless the user gives another explicit reference time.",
    "- If you generate calendar-ish text, prefer explicit dates (YYYY-MM-DD) when it helps the user."
  ].join("\n");

  const commonPolicy = getStr(wo?.policyPrompt, "") || getStr(moduleCfg?.policyPrompt, "");

  const multiChannelNote = (() => {
    const raw = Array.isArray(wo?.contextIDs) ? wo.contextIDs : [];
    const extraIds = raw
      .map(v => String(v || "").trim())
      .filter(v => v.length > 0);
    if (!extraIds.length) return "";
    const currentId = String(wo?.channelId ?? "").trim();
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

  const agentInfo = (() => {
    const type  = typeof wo?.agentType === "string" ? wo.agentType.trim() : "";
    const depth = Number.isFinite(Number(wo?.agentDepth)) ? Number(wo.agentDepth) : 0;
    if (!type) return "Agent context:\n- agent_type: main-channel\n- agent_depth: 0";
    return [
      "Agent context:",
      `- agent_type: ${type}`,
      `- agent_depth: ${depth}`
    ].join("\n");
  })();

  const parts = [];
  if (base) parts.push(base);
  if (systemPromptAddition) parts.push(systemPromptAddition);
  if (agentInfo) parts.push(agentInfo);
  parts.push(getChannelAwarenessBlock(wo));
  parts.push(runtimeInfo);
  parts.push(commonPolicy);
  if (multiChannelNote) parts.push(multiChannelNote);
  return parts.filter(Boolean).join("\n\n");
}

async function getRequestHeaders(wo) {
  const headers = { "Content-Type": "application/json" };
  const keyName = typeof wo?.apiKey === "string" ? wo.apiKey.trim() : "";
  if (!keyName) return headers;
  const secret = String(await getSecret(wo, keyName) || "").trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}


export default async function getCoreAi(coreData) {
  let wo = coreData.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);
  wo = await applyAiFallbackOverrides(wo, { log, moduleName: MODULE_NAME, endpoint: wo?.endpoint });
  coreData.workingObject = wo;
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
  const toolCallLog = [];
  let totalToolCalls = 0;
  let accumulatedText = "";
  let hitMaxLoops = false;
  let hitMaxToolCalls = false;
  let emptyOutputConsec = 0;
  for (let i = 0; i < kiCfg.maxLoops; i++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }
    try {
      const toolStep = getToolDefsForCurrentStep(toolDefs, wo, totalToolCalls, kiCfg.maxToolCalls);
      const activeToolDefs = Array.isArray(toolStep.toolDefs) ? toolStep.toolDefs : [];
      const toolsDisabled = activeToolDefs.length === 0;
      const requestToolNames = (!toolsDisabled && activeToolDefs.length)
        ? activeToolDefs.map((tool) => String(tool?.function?.name || tool?.name || "").trim()).filter(Boolean)
        : [];
      log("AI request tool snapshot", "info", {
        channelId: String(wo?.channelId || ""),
        callerChannelId: String(wo?.callerChannelId || ""),
        useAiModule: String(wo?.useAiModule || ""),
        toolsDisabled,
        toolMode: toolStep.mode,
        configuredTools: Array.isArray(wo?.tools) ? wo.tools : [],
        requestToolNames,
        toolChoice: (!toolsDisabled && activeToolDefs.length) ? kiCfg.toolChoice : "none"
      });
      const body = {
        model: wo.model,
        messages,
        temperature: kiCfg.temperature,
        max_tokens: kiCfg.maxTokens,
        tools: (!toolsDisabled && activeToolDefs.length) ? activeToolDefs : undefined,
        tool_choice: (!toolsDisabled && activeToolDefs.length) ? kiCfg.toolChoice : undefined
      };
      const headers = await getRequestHeaders(wo);
      const res = await fetchWithTimeout(wo.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }, kiCfg.requestTimeoutMs);
      const raw = await res.text();
      if (!res.ok) {
        let _errBody = "";
        try { _errBody = raw.slice(0, 800); } catch {}
        log(`HTTP ${res.status} ${res.statusText}: ${_errBody}`, "warn");
        if (totalToolCalls > 0) {
          log(`Suppressing partial-result fallback after ${totalToolCalls} tool call(s)`, "info");
        }
        wo.response = accumulatedText.trim() || "Die Anfrage konnte technisch nicht sauber zu Ende gefuehrt werden. Es liegt noch kein verlaessliches Endergebnis vor.";
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
          hitMaxToolCalls = true;
          log(`maxToolCalls limit reached (${totalToolCalls}/${kiCfg.maxToolCalls}) — requesting synthesis`, "warn");
          wo.__forceNoTools = true;
          setEnsureFinalSynthesisPrompt(messages, wo);
          continue;
        }
        wo._fullAssistantText = accumulatedText;
        for (const tc of toolCalls) {
          if (totalToolCalls >= kiCfg.maxToolCalls) {
            hitMaxToolCalls = true;
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
          try {
            const parsedToolMsg = JSON.parse(toolMsg.content || "{}");
            if (parsedToolMsg?.ok === false || (typeof parsedToolMsg?.error === "string" && parsedToolMsg.error.trim())) _tcStatus = "failed";
            if (typeof parsedToolMsg?.url === "string" && parsedToolMsg.url) wo.primaryImageUrl = parsedToolMsg.url;
          } catch {}
          toolCallLog.push({ tool: tcName, task: tcTask, status: _tcStatus, durationMs: _tcMs });
          wo.toolCallLog = toolCallLog.slice();
          totalToolCalls++;
        }
        wo._fullAssistantText = undefined;
        continue;
      }
      const cutOff = !wo.__noContinuation && (finish === "length" || getLooksCutOff(chunkText));
      if (cutOff) {
        if (finish === "length" && !chunkText) {
          emptyOutputConsec++;
          if (emptyOutputConsec >= 2) {
            log(`Empty output loop guard triggered (${emptyOutputConsec} consecutive empty length-truncated responses) — breaking`, "warn");
            break;
          }
        } else {
          emptyOutputConsec = 0;
        }
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
      emptyOutputConsec = 0;
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
  if (!accumulatedText.trim() && !hitMaxToolCalls && messages.length && messages[messages.length - 1]?.role !== "assistant") {
    hitMaxLoops = true;
  }
  const reasoningEnabled = wo?.reasoning != null && wo?.reasoning !== false && wo?.reasoning !== 0;
  if (reasoningEnabled) {
    const parts = [];
    if (toolCallLog.length) {
      parts.push("Tools called:\n" + toolCallLog.map(e => `- ${e.tool}${e.task ? ` (${e.task})` : ""}: ${e.status}`).join("\n"));
    }
    if (!parts.length) {
      parts.push("Answered from context — no tool calls.");
    }
    wo.reasoningSummary = parts.join("\n\n");
  } else {
    wo.reasoningSummary = undefined;
  }
  wo.toolCallLog = toolCallLog;
  const _finalText = (accumulatedText || "").trim();
  if (_finalText) {
    if (hitMaxToolCalls) {
      wo.response = _finalText + "\n\n" + getLimitNotice("tool");
    } else if (hitMaxLoops) {
      wo.response = _finalText + "\n\n" + getLimitNotice("loop");
    } else {
      wo.response = _finalText;
    }
  } else if (hitMaxToolCalls) {
    wo.response = "[Max Tool Calls Hit]\n\n" + getLimitNotice("tool");
  } else if (hitMaxLoops) {
    wo.response = "[Max Loops Hit]\n\n" + getLimitNotice("loop");
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
