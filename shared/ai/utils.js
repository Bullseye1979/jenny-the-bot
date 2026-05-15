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
import { getSpecialistDispatcherToolName } from "../../core/tool-links.js";
import { putItem, getItem, deleteItem } from "../../core/registry.js";
import { readFileSync } from "node:fs";
import { dirname, join }      from "node:path";
import { fileURLToPath }      from "node:url";
import { getLogsRoot, getLogMaxBytes, getLogKeepFiles, setAppendRollingFile } from "../../core/log-paths.js";

const _dir         = dirname(fileURLToPath(import.meta.url));
const _manifestDir = join(_dir, "../../manifests");


/*
 * Returns the bot name from workingObject, or undefined if not set.
 */
export function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


export function getSpecialistToolName(wo) {
  return getSpecialistDispatcherToolName(wo);
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
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 8 && !/\n/.test(s)) {
    if (!/\b(?:and|or|but|because|with|without|to|for|of|in|on|at|from|into|onto|about|the|a|an|my|your|his|her|their|our|its)$/i.test(s)) {
      return false;
    }
  }
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
  const coreData = entry?.coreData && typeof entry.coreData === "object" ? entry.coreData : {};
  const { coreData: _coreData, ...logEntry } = entry && typeof entry === "object" ? entry : { value: entry };
  const dir = getLogsRoot(coreData);
  setAppendRollingFile({
    dir,
    basename: "toolcalls",
    text: JSON.stringify(logEntry) + "\n",
    maxBytes: getLogMaxBytes(coreData),
    keepFiles: getLogKeepFiles(coreData)
  }).catch(() => {});
}


/*
 * Returns the base fields for a toolcall log entry from workingObject.
 */
export function getToolcallLogBase(wo) {
  return {
    event:         "toolcall",
    ts:            new Date().toISOString(),
    turnId:        String(wo.turnId || wo.callerTurnId || ""),
    callerTurnId:  String(wo.callerTurnId || ""),
    channel:       String(wo.channelId || ""),
    callerChannel: String(wo.callerChannelId || ""),
    flow:          String(wo.flow || ""),
    callerFlow:    String(wo.callerFlow || ""),
    agentType:     String(wo.agentType || ""),
    agentDepth:    Number.isFinite(Number(wo.agentDepth)) ? Number(wo.agentDepth) : 0,
    useAiModule:   String(wo.useAiModule || ""),
    model:         String(wo.model || ""),
    fallbackActive: wo?.__aiFallbackApplied === true,
    fallbackReason: String(wo?.__aiProbeReason || ""),
    channelIds:    Array.isArray(wo.channelIds) ? wo.channelIds.map(v => String(v || "")).filter(Boolean) : [],
    callerChannelIds: Array.isArray(wo.callerChannelIds) ? wo.callerChannelIds.map(v => String(v || "")).filter(Boolean) : []
  };
}


function getLogSafeString(value, max = 240) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + " ...[truncated]" : s;
}


function getResultObject(result) {
  if (typeof result === "string") return getTryParseJSON(result, result);
  return result;
}


function getToolResultRows(value) {
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.files)) return value.files;
  return null;
}


function getSpecialistResponseSummary(row) {
  const responseText = typeof row?.response === "string" ? row.response.trim() : "";
  const parsed = responseText ? getTryParseJSON(responseText, null) : null;
  const base = {
    jobID: row?.jobID ?? null,
    type: typeof row?.type === "string" ? row.type : "",
    ok: row?.ok === true,
    error: typeof row?.error === "string" && row.error.trim() ? getLogSafeString(row.error, 200) : undefined
  };
  if (!parsed || typeof parsed !== "object") {
    return {
      ...base,
      responsePreview: responseText ? getLogSafeString(responseText, 200) : undefined
    };
  }
  return {
    ...base,
    status: typeof parsed.status === "string" ? parsed.status : undefined,
    nextPageId: parsed.nextPageId ?? parsed.next_page_id ?? undefined,
    cutoff: typeof parsed.cutoff === "string" ? parsed.cutoff : undefined,
    assignedStart: typeof parsed.assignedStart === "string" ? parsed.assignedStart : undefined,
    assignedEnd: typeof parsed.assignedEnd === "string" ? parsed.assignedEnd : undefined,
    actualStart: typeof parsed.actualStart === "string" ? parsed.actualStart : undefined,
    actualEnd: typeof parsed.actualEnd === "string" ? parsed.actualEnd : undefined,
    reason: typeof parsed.reason === "string" ? getLogSafeString(parsed.reason, 160) : undefined,
    responsePreview: responseText ? getLogSafeString(responseText, 200) : undefined
  };
}


function getUnfencedJsonText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? String(fenced[1] || "").trim() : raw;
}


export function getParsedSpecialistResponse(responseText) {
  const cleaned = getUnfencedJsonText(responseText);
  if (!cleaned) return null;
  const parsed = getTryParseJSON(cleaned, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}


export function getSpecialistsPaginationState(result) {
  const value = getResultObject(result);
  const rows = Array.isArray(value?.rows) ? value.rows : [];
  const pending = [];
  const summaries = [];
  let parseFailures = 0;

  for (const row of rows) {
    const parsed = getParsedSpecialistResponse(row?.response);
    const summary = {
      jobID: row?.jobID ?? null,
      type: typeof row?.type === "string" ? row.type : "",
      ok: row?.ok === true,
      parsed: !!parsed
    };
    if (!parsed) {
      parseFailures++;
      summaries.push(summary);
      continue;
    }
    const nextPageId = parsed.nextPageId ?? parsed.next_page_id ?? null;
    const status = typeof parsed.status === "string" ? parsed.status.trim().toUpperCase() : "";
    const assignedStart = typeof parsed.assignedStart === "string" ? parsed.assignedStart : "";
    const assignedEnd = typeof parsed.assignedEnd === "string" ? parsed.assignedEnd : "";
    const cutoff = typeof parsed.cutoff === "string" ? parsed.cutoff : "";
    const isPending = nextPageId != null || status === "PARTIAL";
    if (isPending) {
      pending.push({
        jobID: row?.jobID ?? null,
        type: typeof row?.type === "string" ? row.type : "",
        status: status || "PARTIAL",
        assignedStart,
        assignedEnd,
        nextPageId,
        cutoff
      });
    }
    summaries.push({
      ...summary,
      status,
      assignedStart,
      assignedEnd,
      nextPageId,
      cutoff
    });
  }

  return {
    pending: pending.length > 0,
    pendingCount: pending.length,
    parseFailures,
    pendingItems: pending,
    specialistSummaries: summaries
  };
}


export function setUpdatePaginationGuardState(wo, toolName, result) {
  if (!wo) return null;
  if (toolName === getSpecialistToolName(wo)) {
    wo.__specialistsPaginationState = getSpecialistsPaginationState(result);
  }

  let continuationState = null;
  const value = getResultObject(result);
  if (value && typeof value === "object") {
    const followupToolName = typeof value.requires_followup_tool === "string" && value.requires_followup_tool.trim()
      ? value.requires_followup_tool.trim()
      : typeof value.continuation_tool === "string" && value.continuation_tool.trim()
        ? value.continuation_tool.trim()
      : String(toolName || "").trim();
    const pendingItems = Array.isArray(value.pending_pages)
      ? value.pending_pages
      : Array.isArray(value.pendingItems)
        ? value.pendingItems
        : Array.isArray(value.pending_specialists)
          ? value.pending_specialists
        : [];
    const continuationPrompt = typeof value.continuation_prompt === "string" && value.continuation_prompt.trim()
      ? value.continuation_prompt.trim()
      : "";
    const hasExplicitContinuationMetadata = !!continuationPrompt
      || pendingItems.length > 0
      || (typeof value.requires_followup_tool === "string" && value.requires_followup_tool.trim())
      || (typeof value.continuation_tool === "string" && value.continuation_tool.trim());
    const continuationPending = value.pagination_pending === true
      || value.continuation_pending === true
      || ((value.has_more === true || value.hasMore === true) && hasExplicitContinuationMetadata);
    if (continuationPending && followupToolName) {
      continuationState = {
        pending: true,
        toolName: followupToolName,
        reason: value.pagination_pending === true
          ? "pagination_pending"
          : value.continuation_pending === true
            ? "continuation_pending"
            : "has_more",
        pendingItems,
        prompt: continuationPrompt || (
          `The previous tool result indicates more data is available for ${followupToolName}. ` +
          `Continue with the required follow-up tool call instead of finalizing, using the continuation information from the last tool result.`
        )
      };
    }
  }

  wo.__toolContinuationState = continuationState;
  return continuationState;
}


export function getNeedsPaginationContinuation(wo) {
  return wo?.__toolContinuationState?.pending === true;
}


export function getPaginationContinuationPrompt(wo) {
  const continuationState = wo?.__toolContinuationState || {};
  if (typeof continuationState.prompt === "string" && continuationState.prompt.trim()) {
    return continuationState.prompt;
  }
  const items = Array.isArray(continuationState?.pendingItems)
    ? continuationState.pendingItems
    : [];
  const toolName = String(continuationState?.toolName || "").trim() || "the required tool";
  const lines = [
    "The previous tool work is not complete yet.",
    "Do not synthesize or finalize.",
    `Call ${toolName} again only for the still-pending work.`
  ];
  if (items.length) {
    lines.push("Pending windows:");
    for (const item of items.slice(0, 12)) {
      lines.push(`- jobID=${item.jobID ?? "?"} start=${item.assignedStart || "?"} end=${item.assignedEnd || "?"} nextPageId=${item.nextPageId ?? "?"} status=${item.status || "PARTIAL"}`);
    }
  }
  return lines.join("\n");
}


export function getToolArgsMeta(toolName, args, wo) {
  const value = args && typeof args === "object" ? args : {};
  const preview = getPreview(getJsonSafe(value), 500);

  if (toolName === "getHistory") {
    return {
      argsPreview: preview,
      requestedStartInput: typeof value.start === "string" ? value.start : undefined,
      requestedEndInput: typeof value.end === "string" ? value.end : undefined,
      requestedStartCtxId: value.startCtxId ?? value.start_ctx_id ?? value.start_ctx ?? undefined
    };
  }

  if (toolName === getSpecialistToolName(wo)) {
    const specialists = Array.isArray(value.specialists) ? value.specialists : [];
    return {
      argsPreview: preview,
      specialistsRequested: specialists.length,
      specialistRequests: specialists.slice(0, 12).map((row) => ({
        jobID: row?.jobID ?? null,
        type: typeof row?.type === "string" ? row.type : "",
        promptPreview: typeof row?.prompt === "string" ? getLogSafeString(row.prompt, 180) : ""
      }))
    };
  }

  if (toolName === "getConfluence") {
    const markdown = typeof value.markdown === "string" ? value.markdown : "";
    const content = typeof value.content === "string" ? value.content : "";
    return {
      argsPreview: preview,
      op: typeof value.op === "string" ? value.op : (typeof value.action === "string" ? value.action : undefined),
      title: typeof value.title === "string" ? getLogSafeString(value.title, 120) : undefined,
      pageId: value.pageId ?? value.page_id ?? undefined,
      parentId: value.parentId ?? value.parent_id ?? undefined,
      spaceKey: typeof value.spaceKey === "string" ? value.spaceKey : undefined,
      markdownChars: markdown ? markdown.length : undefined,
      contentChars: content ? content.length : undefined
    };
  }

  return { argsPreview: preview };
}


export function getToolTraceMeta(toolName, result, wo) {
  const value = getResultObject(result);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.trim()
      ? { resultPreview: getLogSafeString(value, 240) }
      : {};
  }

  if (toolName === "getHistory") {
    return {
      requestedStart: typeof value.requested_start === "string" ? value.requested_start : undefined,
      requestedEnd: typeof value.requested_end === "string" ? value.requested_end : undefined,
      actualStart: typeof value.actual_start === "string" ? value.actual_start : undefined,
      actualEnd: typeof value.actual_end === "string" ? value.actual_end : undefined,
      dbEnd: typeof value.db_end === "string" ? value.db_end : undefined,
      fetchedCount: typeof value.fetched_count === "number" ? value.fetched_count : undefined,
      preloadedCount: typeof value.preloaded_count === "number" ? value.preloaded_count : undefined,
      maxRows: typeof value.max_rows === "number" ? value.max_rows : undefined,
      cappedByPreload: value.capped_by_preload === true ? true : undefined,
      cappedByChars: value.capped_by_chars === true ? true : undefined,
      channelsQueried: Array.isArray(value.channels) ? value.channels.slice(0, 12) : undefined
    };
  }

  if (toolName === getSpecialistToolName(wo)) {
    const rows = Array.isArray(value.rows) ? value.rows : [];
    const paginationState = getSpecialistsPaginationState(value);
    return {
      specialistsReturned: rows.length,
      specialistsComplete: typeof value.complete === "number" ? value.complete : undefined,
      specialistsFailed: typeof value.failed === "number" ? value.failed : undefined,
      specialistSummaries: rows.slice(0, 12).map(getSpecialistResponseSummary),
      paginationPending: paginationState.pending ? true : undefined,
      paginationPendingCount: paginationState.pendingCount || undefined,
      paginationParseFailures: paginationState.parseFailures || undefined,
      pendingPages: paginationState.pendingItems.slice(0, 12),
      continuationPending: value.continuation_pending === true ? true : undefined,
      pendingSpecialists: Array.isArray(value.pending_specialists) ? value.pending_specialists.slice(0, 12) : undefined
    };
  }

  if (toolName === "getConfluence") {
    return {
      op: typeof value.op === "string" ? value.op : undefined,
      ok: value.ok === true ? true : undefined,
      pageId: value.pageId ?? value.id ?? undefined,
      parentId: value.parentId ?? undefined,
      title: typeof value.title === "string" ? getLogSafeString(value.title, 120) : undefined,
      spaceKey: typeof value.spaceKey === "string" ? value.spaceKey : undefined,
      viewUrl: typeof value.viewUrl === "string" ? value.viewUrl : undefined
    };
  }

  const rows = getToolResultRows(value);
  return {
    resultPreview: getLogSafeString(getJsonSafe(value), 240),
    ok: value.ok === false ? false : (value.ok === true ? true : undefined),
    error: typeof value.error === "string" && value.error.trim() ? getLogSafeString(value.error, 200) : undefined,
    resultRows: rows ? rows.length : undefined
  };
}


/*
 * Returns pagination/summary metadata for a tool result, keyed by tool name.
 */
export function getToolPaginationMeta(toolName, result) {
  const v = getResultObject(result);
  if (!v || typeof v !== "object") return {};

  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const len = (x) => (typeof x === "string" ? x.length : Array.isArray(x) ? x.length : undefined);
  const out = (o) => Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined));

  const rows = getToolResultRows(v);
  return out({
    tool: typeof toolName === "string" ? toolName : undefined,
    rows: num(v.count) ?? (rows ? rows.length : undefined),
    hasMore: v.has_more === true ? true : undefined,
    nextCtxId: v.next_start_ctx_id ?? undefined,
    status: num(v.status),
    bytes: num(v.bytes),
    files: Array.isArray(v.files) ? v.files.length : undefined,
    outputBytes: len(Array.isArray(v.rows) ? v.rows[0] : undefined),
    responseLen: Array.isArray(v.rows) && v.rows[0] ? len(v.rows[0]) : undefined,
    exitCode: v.exitCode ?? undefined,
    mode: v.mode || undefined
  });
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


function getEscapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function getSkipWs(str, start = 0) {
  let i = Math.max(0, Math.floor(Number(start) || 0));
  while (i < str.length && /\s/.test(str[i])) i++;
  return i;
}


function getReadBalanced(str, openChar, closeChar, start = 0) {
  const i0 = getSkipWs(str, start);
  if (str[i0] !== openChar) return null;
  let depth = 0;
  let inStr = false;
  let esc   = false;
  for (let i = i0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") { inStr = true; continue; }
    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return { text: str.slice(i0, i + 1), start: i0, end: i + 1 };
    }
  }
  return null;
}


function getTryParseToolJson(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  const parsed = getTryParseJSON(raw, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
}


function getPseudoToolMatches(text, allowedToolNames = []) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const names = Array.isArray(allowedToolNames)
    ? allowedToolNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  if (!names.length) return [];

  const matches = [];

  for (const name of names) {
    const escaped = getEscapeRegExp(name);

    const bracketRe = new RegExp(`\\[tool:${escaped}\\]`, "g");
    for (const match of s.matchAll(bracketRe)) {
      const headStart = Number(match.index || 0);
      const headEnd   = headStart + match[0].length;
      const obj = getReadBalanced(s, "{", "}", headEnd);
      if (!obj) continue;
      const args = getTryParseToolJson(obj.text);
      if (!args) continue;
      matches.push({ name, args, start: headStart, end: obj.end });
    }

    const channelRe = new RegExp(`<\\|channel\\|?>call:${escaped}`, "g");
    for (const match of s.matchAll(channelRe)) {
      const headStart = Number(match.index || 0);
      const headEnd   = headStart + match[0].length;
      const obj = getReadBalanced(s, "{", "}", headEnd);
      if (!obj) continue;
      const args = getTryParseToolJson(obj.text);
      if (!args) continue;
      let end = obj.end;
      const tail = s.slice(end);
      const tailMatch = tail.match(/^\s*<tool_call\|>/);
      if (tailMatch) end += tailMatch[0].length;
      matches.push({ name, args, start: headStart, end });
    }

    const fnRe = new RegExp(`(^|[\\s\\n])${escaped}\\s*\\(`, "g");
    for (const match of s.matchAll(fnRe)) {
      const prefixLen  = match[1] ? match[1].length : 0;
      const headStart  = Number(match.index || 0) + prefixLen;
      const openParen  = s.indexOf("(", headStart + name.length);
      if (openParen < 0) continue;
      const paren = getReadBalanced(s, "(", ")", openParen);
      if (!paren) continue;
      const inner = String(paren.text || "").slice(1, -1).trim();
      const args = getTryParseToolJson(inner);
      if (!args) continue;
      matches.push({ name, args, start: headStart, end: paren.end });
    }
  }

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  return matches;
}


export function getExtractPseudoToolCall(text, allowedToolNames = []) {
  const matches = getPseudoToolMatches(text, allowedToolNames);
  if (!matches.length) return null;
  const picked = matches[matches.length - 1];
  const source = String(text || "");
  return {
    name:      picked.name,
    args:      picked.args,
    cleanText: source.slice(0, picked.start).trim(),
    toolText:  source.slice(picked.start, picked.end)
  };
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

function getNormalizeOffsetText(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Z";
  if (s === "GMT" || s === "UTC") return "Z";
  const m = s.match(/^(?:GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return "Z";
  const hh = String(Math.abs(Number(m[1]))).padStart(2, "0");
  const mm = String(m[2] || "00").padStart(2, "0");
  return `${String(m[1]).startsWith("-") ? "-" : "+"}${hh}:${mm}`;
}

function getLocalIsoForTimeZone(date, timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = dtf.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    const hh = get("hour");
    const mm = get("minute");
    const ss = get("second");
    const offsetText = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(date).find(p => p.type === "timeZoneName")?.value || "UTC";
    const offset = getNormalizeOffsetText(offsetText);
    if (!y || !m || !d || !hh || !mm || !ss) return date.toISOString();
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`;
  } catch {
    return date.toISOString();
  }
}


/*
 * Builds the main system message text from workingObject fields and runtime info.
 * earliestTimestamps is pre-fetched by the caller to keep this function synchronous.
 */
export function getSystemContentText(wo, { earliestTimestamps = [], moduleCfg = {} } = {}) {
  const now = new Date();
  const tz     = (typeof wo?.timezone === "string" && wo.timezone.trim()) ? wo.timezone.trim() : "Europe/Berlin";
  const nowIso = getLocalIsoForTimeZone(now, tz);
  const nowUtcIso = now.toISOString();

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
    `- current_time_utc_iso: ${nowUtcIso}`,
    `- timezone_hint: ${tz}`,
    ...earliestLines,
    ...(earliestLines.length ? ["- context_earliest_record shows how far back the database holds records for each channel, regardless of how many entries are visible in this context window. History tools can retrieve records all the way back to this date."] : []),
    "- current_time_iso is already expressed in timezone_hint and should be used for relative date boundaries such as today/current/heute unless another explicit reference time is provided.",
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

  function getPromptContentWithAuthor(row) {
    const content = typeof row?.content === "string" ? row.content : "";
    const authorName =
      typeof row?.authorName === "string" && row.authorName.trim().length
        ? row.authorName.trim()
        : "";
    if (!authorName || !content) return content;
    if (content.startsWith("[authorName:")) return content;
    return `[authorName: ${authorName}]\n${content}`;
  }

  for (let i = 0; i < (rows || []).length; i++) {
    const r    = rows[i] || {};
    const role = r.role;

    if (role === "system") {
      if (includeSystem) out.push({ role: "system", content: r.content ?? "" });
      continue;
    }

    if (role === "user") {
      out.push({ role: "user", content: getPromptContentWithAuthor(r) });
      lastAssistantToolIds = new Set();
      continue;
    }

    if (role === "assistant") {
      const msg = { role: "assistant", content: getPromptContentWithAuthor(r) };
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


export function getUserContentWithAuthor(baseText, wo) {
  const content = baseText ?? "";
  const authorName =
    typeof wo?.authorDisplayName === "string" && wo.authorDisplayName.trim().length
      ? wo.authorDisplayName.trim()
      : typeof wo?.authorName === "string" && wo.authorName.trim().length
        ? wo.authorName.trim()
        : "";
  if (!authorName || !content) return content;
  if (content.startsWith("[authorName:")) return content;
  return `[authorName: ${authorName}]\n${content}`;
}
