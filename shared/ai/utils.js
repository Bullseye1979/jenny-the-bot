/**************************************************************/
/* filename: "shared/ai/utils.js"                            */
/* Version 1.0                                               */
/* Purpose: Shared utilities for core-ai pipeline modules.  */
/*          Extracted from 01000-01003 to eliminate         */
/*          duplication across completions, responses,       */
/*          pseudotoolcalls, and roleplay modules.           */
/**************************************************************/

import { getSecret }          from "../../core/secrets.js";
import { getPrefixedLogger }  from "../../core/logging.js";
import { putItem, getItem, deleteItem } from "../../core/registry.js";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join }      from "node:path";
import { fileURLToPath }      from "node:url";

const _dir         = dirname(fileURLToPath(import.meta.url));
const _manifestDir = join(_dir, "../../manifests");
const _logDir      = join(_dir, "../../logs");
const _toolcallLog = join(_logDir, "toolcalls.log");

try { mkdirSync(_logDir, { recursive: true }); } catch {}


/*
 * Returns the bot name from workingObject, or undefined if not set.
 */
export function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


/*
 * Resolves the bearer token for the AI endpoint and returns request headers.
 */
export async function getRequestHeaders(wo) {
  const headers = { "Content-Type": "application/json" };
  const keyName = typeof wo?.apiKey === "string" ? wo.apiKey.trim() : "";
  if (!keyName) return headers;
  const secret = String(await getSecret(wo, keyName) || "").trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}


/*
 * Builds request headers from an already-resolved API key string (synchronous).
 */
export function getAuthHeaders(apiKey, baseHeaders = {}) {
  const headers = { ...baseHeaders };
  const secret = String(apiKey || "").trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}


/*
 * Safely parses a JSON string, returning fallback on error.
 */
export function getTryParseJSON(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}


/*
 * Attaches turnId, userId, and timestamp to a context record.
 */
export function getWithTurnId(rec, wo) {
  const t   = typeof wo?.turnId === "string" && wo.turnId   ? wo.turnId   : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId   ? wo.userId   : undefined;
  return { ...(t ? { ...rec, turnId: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}


/*
 * Returns value if boolean, otherwise returns def.
 */
export function getBool(value, def) {
  return typeof value === "boolean" ? value : def;
}


/*
 * Returns a preview of a string, truncating at max characters.
 */
export function getPreview(str, max = 400) {
  const s = String(str ?? "");
  return s.length > max ? s.slice(0, max) + " …[truncated]" : s;
}


/*
 * Safely stringifies any value to JSON or a string fallback.
 */
export function getJsonSafe(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); }
}


/*
 * Returns true if the text appears to be cut off mid-sentence.
 */
export function getLooksCutOff(text) {
  const s = String(text ?? "").trimEnd();
  if (!s) return false;
  if (/[.!?:;*"»)\]}>~`]$/.test(s)) return false;
  if (/https?:\/\/\S+$/.test(s)) return false;
  return true;
}


/*
 * Returns a human-readable notice for when a limit is reached.
 */
export function getLimitNotice(kind) {
  if (kind === "tool") return "Tool budget reached. This is the partial result so far. Start a new AI run if you want me to continue the deep dive.";
  if (kind === "loop") return "Loop limit reached. This is the partial result so far. Start a new AI run if you want me to continue from here.";
  return "";
}


/*
 * Loads a tool manifest definition from manifests/ by name.
 */
export function getManifestDef(name, logFn) {
  try {
    const raw = readFileSync(join(_manifestDir, `${name}.json`), "utf8");
    const fn  = JSON.parse(raw);
    if (fn && typeof fn === "object" && fn.name && fn.description && fn.parameters) {
      return { type: "function", function: fn };
    }
  } catch {}
  if (logFn) logFn(`Tool "${name}" has no manifest in manifests/ — it will not be advertised to the AI.`, "warn");
  return null;
}


/*
 * Returns policyHint strings from manifests for a list of tool names.
 */
export function getManifestPolicyHints(toolNames) {
  const hints = [];
  for (const name of toolNames) {
    try {
      const raw = readFileSync(join(_manifestDir, `${name}.json`), "utf8");
      const m   = JSON.parse(raw);
      if (typeof m?.policyHint === "string" && m.policyHint.trim()) hints.push(m.policyHint.trim());
    } catch {}
  }
  return hints;
}


/*
 * Dynamically loads multiple tool modules by name.
 */
export async function getToolsByName(names, wo) {
  const log    = getPrefixedLogger(wo, import.meta.url);
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod  = await import(new URL(`../../tools/${name}.js`, import.meta.url).href);
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


/*
 * Dynamically loads a single tool module by name.
 */
export async function getToolByName(name, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  try {
    const mod  = await import(new URL(`../../tools/${name}.js`, import.meta.url).href);
    const tool = mod?.default ?? mod;
    if (tool && typeof tool.invoke === "function") {
      const manifestDef = getManifestDef(name, log);
      return { ...tool, definition: manifestDef || undefined };
    }
    log(`Tool "${name}" invalid (missing invoke).`, "warn");
    return null;
  } catch (e) {
    log(`Tool "${name}" load failed: ${e?.message || String(e)}`, "warn");
    return null;
  }
}


/*
 * Derives the tool status scope for registry keys from workingObject.
 */
export function getToolStatusScope(wo) {
  const explicit = String(wo?.toolcallScope ?? "").trim();
  if (explicit) return explicit;
  const callerFlow = String(wo?.callerFlow || "").trim();
  if (callerFlow) return callerFlow;
  return String(wo?.flow || "").trim();
}


/*
 * Derives the tool status channel key for registry keys from workingObject.
 */
export function getToolStatusKey(wo) {
  const explicit = String(wo?.toolStatusChannelOverride || "").trim();
  if (explicit) return explicit;
  return String(wo?.callerChannelId || wo?.channelId || "").trim();
}


/*
 * Sets up a stale-timeout to auto-clear the active tool status from the registry.
 */
export function setRememberActiveToolStatus(wo, payload, hasGlobalStatus = true) {
  if (!wo || !payload?.token) return;
  const staleMs = Number.isFinite(wo?.statusToolStaleMs) ? Number(wo.statusToolStaleMs) : 600000;
  wo._activeToolStatus = {
    token:           payload.token,
    statusKey:       String(payload.statusKey || ""),
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
    value:        timer,
    configurable: true,
    writable:     true,
    enumerable:   false
  });
}


/*
 * Appends a structured tool call entry to the toolcalls log file.
 */
export function writeToolcallLog(entry) {
  try { appendFileSync(_toolcallLog, JSON.stringify(entry) + "\n", "utf8"); } catch {}
}


/*
 * Returns the base fields for a toolcall log entry from workingObject.
 */
export function getToolcallLogBase(wo) {
  return {
    ts:            new Date().toISOString(),
    turnId:        String(wo.turnId || wo.callerTurnId || ""),
    channel:       String(wo.channelId || ""),
    callerChannel: String(wo.callerChannelId || ""),
    flow:          String(wo.flow || "")
  };
}


/*
 * Returns pagination/summary metadata for a tool result, keyed by tool name.
 */
export function getToolPaginationMeta(toolName, result) {
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


/*
 * Inspects a tool result for ok/error status.
 */
export function getToolResultMeta(result) {
  const value = typeof result === "string" ? getTryParseJSON(result, result) : result;
  if (value && typeof value === "object") {
    if (value.ok === false) return { ok: false, error: typeof value.error === "string" ? value.error : "" };
    if (typeof value.error === "string" && value.error.trim()) return { ok: false, error: value.error.trim() };
  }
  return { ok: true, error: "" };
}


/*
 * Injects a synthesis prompt when the tool budget is exhausted.
 */
export function setEnsureFinalSynthesisPrompt(messages, wo) {
  if (wo?.__didToolBudgetNotice === true) return false;
  wo.__didToolBudgetNotice = true;
  messages.push({
    role:    "user",
    content: "Tool-call budget exhausted. Provide the best possible final answer using only the existing conversation and prior tool outputs. Do not request or call any tools."
  });
  return true;
}


/*
 * Extracts a primary image URL from the ARTIFACTS block in AI response text.
 */
export function getParseArtifactsBlock(text) {
  const s      = String(text || "");
  const marker = "\nARTIFACTS:\n";
  const idx    = s.indexOf(marker);
  if (idx === -1) return { primaryImageUrl: null };

  const lines = s.slice(idx + marker.length).split("\n");
  for (const line of lines) {
    if (!line.trim()) break;
    const m = /^[a-z_]+:\s*(https?:\/\/\S+)/i.exec(line.trim());
    if (m) return { primaryImageUrl: m[1] };
  }
  return { primaryImageUrl: null };
}


/*
 * Expands a tool argument to the full accumulated assistant text when it is a substring.
 */
export function getExpandedToolArgs(args, wo) {
  const log  = getPrefixedLogger(wo, import.meta.url);
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


/*
 * Builds the channel-awareness block injected into every system prompt.
 * Includes agent type, depth, role prompts, and manifest policy hints.
 */
export function getChannelAwarenessBlock(wo) {
  const agentType  = typeof wo?.agentType === "string" ? wo.agentType.trim() : "";
  const agentDepth = Number.isFinite(Number(wo?.agentDepth)) ? Number(wo.agentDepth) : 0;
  const mode       = agentType ? "orchestrator-or-specialist" : "primary-user-channel";

  const lines = [
    "Channel awareness:",
    `- channel_awareness_mode: ${mode}`
  ];

  if (agentType) {
    lines.push(`- agent_type: ${agentType}`);
    lines.push(`- agent_depth: ${agentDepth}`);
    const delegatePrompt = String(wo?.agentDelegateRolePrompt ?? "").trim();
    if (delegatePrompt) delegatePrompt.split("\n").forEach(l => lines.push(`- ${l.trim()}`));
    else if (wo?.agentRolePrompt) lines.push(`- ${wo.agentRolePrompt}`);
  } else {
    if (wo?.primaryRolePrompt) lines.push(`- ${wo.primaryRolePrompt}`);
    getManifestPolicyHints(Array.isArray(wo?.tools) ? wo.tools : []).forEach(h => lines.push(`- ${h}`));
  }

  return lines.join("\n");
}


/*
 * Builds the main system message text from workingObject fields and runtime info.
 * earliestTimestamps is pre-fetched by the caller to keep this function synchronous.
 */
export function getSystemContentText(wo, { earliestTimestamps = [], moduleCfg = {} } = {}) {
  const nowIso = new Date().toISOString();
  const tz     = (typeof wo?.timezone === "string" && wo.timezone.trim()) ? wo.timezone.trim() : "Europe/Berlin";

  const base = [
    typeof wo.systemPrompt  === "string" ? wo.systemPrompt.trim()  : "",
    typeof wo.persona       === "string" ? wo.persona.trim()       : "",
    typeof wo.instructions  === "string" ? wo.instructions.trim()  : "",
    typeof wo._deliveryInstructions === "string" ? wo._deliveryInstructions.trim() : ""
  ].filter(Boolean).join("\n\n");

  const earliestLines = (Array.isArray(earliestTimestamps) ? earliestTimestamps : []).map(
    ({ channelId, earliestTs }) => `- context_earliest_record (channel "${channelId}"): ${earliestTs}`
  );

  const runtimeInfo = [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    ...earliestLines,
    ...(earliestLines.length ? ["- context_earliest_record shows how far back the database holds records for each channel, regardless of how many entries are visible in this context window. History tools can retrieve records all the way back to this date."] : []),
    "- When the user uses relative time terms (e.g., today, tomorrow), interpret them relative to current_time_iso unless another explicit reference time is provided.",
    "- If you generate calendar-like text, prefer explicit dates (YYYY-MM-DD) when helpful."
  ].join("\n");

  const agentInfo = (() => {
    const type  = typeof wo?.agentType === "string" ? wo.agentType.trim() : "";
    const depth = Number.isFinite(Number(wo?.agentDepth)) ? Number(wo.agentDepth) : 0;
    if (!type) return "Agent context:\n- agent_type: main-channel\n- agent_depth: 0";
    return ["Agent context:", `- agent_type: ${type}`, `- agent_depth: ${depth}`].join("\n");
  })();

  const policy              = (typeof wo?.policyPrompt === "string" ? wo.policyPrompt : "") || (typeof moduleCfg?.policyPrompt === "string" ? moduleCfg.policyPrompt : "");
  const systemPromptAddition = typeof wo?.systemPromptAddition === "string" ? wo.systemPromptAddition.trim() : "";

  const multiChannelNote = (() => {
    const raw      = Array.isArray(wo?.contextIDs) ? wo.contextIDs : [];
    const extraIds = raw.map(v => String(v || "").trim()).filter(v => v.length > 0);
    if (!extraIds.length) return "";
    const currentId = String(wo?.channelId ?? "").trim();
    const lines = [
      "Multi-channel context:",
      "- The context includes messages from multiple channels. Each message may carry a `channelId` field that identifies its source channel."
    ];
    if (currentId) lines.push(`- Treat "${currentId}" as your primary (effective) channelId for this conversation.`);
    return lines.join("\n");
  })();

  return [base, systemPromptAddition, agentInfo, getChannelAwarenessBlock(wo), runtimeInfo, policy, multiChannelNote]
    .filter(Boolean)
    .join("\n\n");
}


/*
 * Builds history messages from a context snapshot for the completions/pseudotoolcalls API.
 * Supports filtering of tool messages and system messages based on kiCfg flags.
 */
export function getPromptFromSnapshot(rows, kiCfg, allowToolHistory = true) {
  if (!kiCfg?.includeHistory) return [];
  const out            = [];
  const includeTools   = !!kiCfg.includeHistoryTools && !!allowToolHistory;
  const includeSystem  = !!kiCfg.includeHistorySystemMessages;
  let lastAssistantToolIds = new Set();

  for (let i = 0; i < (rows || []).length; i++) {
    const r    = rows[i] || {};
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
          id:   tc?.id,
          type: "function",
          function: {
            name:      tc?.function?.name,
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
          role:         "tool",
          tool_call_id: tcid,
          name:         r.name,
          content:      typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? "")
        });
      }
      continue;
    }
  }
  return out;
}


/*
 * Appends a runtime context JSON block to the user message content.
 */
export function getAppendedContextBlockToUserContent(baseText, contextObj) {
  if (!contextObj || typeof contextObj !== "object") return baseText ?? "";
  const jsonBlock = "```json\n" + JSON.stringify(contextObj) + "\n```";
  return (baseText ?? "") + "\n\n[context]\n" + jsonBlock;
}
