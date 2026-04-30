/**************************************************************/
/* filename: "01003-core-ai-roleplay.js"                     */
/* Version 1.0                                               */
/* Purpose: Pipeline module — two-pass roleplay AI:          */
/*          pass 1 generates narrative text, pass 2 derives  */
/*          a Stable Diffusion image prompt from that text,  */
/*          then calls an image tool.                        */
/**************************************************************/

import { getContext, getContextEarliestTimestamps } from "../core/context.js";
import { getStr, getNum }                           from "../core/utils.js";
import { getPrefixedLogger }                        from "../core/logging.js";
import { fetchWithTimeout }                         from "../core/fetch.js";
import { applyAiFallbackOverrides }                 from "../core/ai-fallback.js";
import {
  getAssistantAuthorName,
  getRequestHeaders,
  getTryParseJSON,
  getWithTurnId,
  getBool,
  getLooksCutOff,
  getToolByName,
  getParseArtifactsBlock,
  getSystemContentText
} from "../shared/ai/utils.js";

const MODULE_NAME = "core-ai-roleplay";


function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "roleplay" || v === "core-ai-roleplay";
}


function getKiCfg(wo, moduleCfg = {}) {
  return {
    includeHistory:               getBool(wo?.includeHistory, getBool(moduleCfg?.includeHistory, true)),
    includeHistorySystemMessages: getBool(wo?.includeHistorySystemMessages, getBool(moduleCfg?.includeHistorySystemMessages, false)),
    temperature:          getNum(wo?.temperature,           getNum(moduleCfg?.temperature,           0.7)),
    maxTokens:            getNum(wo?.maxTokens,             getNum(moduleCfg?.maxTokens,             1200)),
    requestTimeoutMs:     getNum(wo?.requestTimeoutMs,      getNum(moduleCfg?.requestTimeoutMs,      120000)),
    toolsList:            Array.isArray(wo?.tools) ? wo.tools : [],
    imagePromptMaxTokens: getNum(wo?.imagePromptMaxTokens,  getNum(moduleCfg?.imagePromptMaxTokens,  260)),
    imagePromptTemperature: getNum(wo?.imagePromptTemperature, getNum(moduleCfg?.imagePromptTemperature, 0.35)),
    imagePersonaHint:     getStr(wo?.imagePersonaHint,      getStr(moduleCfg?.imagePersonaHint,      "")),
    imageContextTurns:    Math.max(0, getNum(wo?.imageContextTurns, getNum(moduleCfg?.imageContextTurns, 4))),
    maxLoops:             Math.max(1, getNum(wo?.maxLoops,  getNum(moduleCfg?.maxLoops,              5))),
    imagePromptRules:     getStr(wo?.imagePromptRules,      getStr(moduleCfg?.imagePromptRules,      ""))
  };
}


function getStripTrailingUrl(text) {
  return String(text ?? "").replace(/\n+(https?:\/\/\S+)\s*$/i, "").trimEnd();
}


function getPromptFromSnapshot(rows, includeHistory, includeHistorySystemMessages = false) {
  if (!includeHistory) return [];
  const out = [];
  for (const r of rows || []) {
    if (r.role === "system") {
      if (includeHistorySystemMessages) out.push({ role: "system", content: r.content ?? "" });
    } else if (r.role === "user") {
      out.push({ role: "user", content: r.content ?? "" });
    } else if (r.role === "assistant") {
      out.push({ role: "assistant", content: getStripTrailingUrl(r.content ?? "") });
    }
  }
  return out;
}


function getRecentContextForImage(rows, maxTurns) {
  const n = Math.max(0, Number(maxTurns) || 0);
  const r = Array.isArray(rows) ? rows : [];
  if (!n || !r.length) return "";

  const slice = r.slice(Math.max(0, r.length - n));
  const lines = [];
  for (const x of slice) {
    const role = x?.role === "assistant" ? "Assistant" : "User";
    const c    = getStripTrailingUrl(String(x?.content ?? "")).trim();
    if (!c) continue;
    lines.push(`${role}: ${c}`);
  }
  return lines.join("\n");
}


function getSystemContentImagePromptRun(imagePromptRules) {
  return String(imagePromptRules ?? "").trim();
}


function getVisualSourceForImage(wo, imagePersonaHint) {
  return [
    String(imagePersonaHint ?? "").trim(),
    getStr(wo?.persona, "").trim(),
    getStr(wo?.systemPrompt, "").trim()
  ].filter(Boolean).join("\n\n");
}


async function getCallChat(wo, body, timeoutMs) {
  const log = getPrefixedLogger(wo, import.meta.url);
  log("AI request tool snapshot", "info", {
    channelId:       String(wo?.channelId || ""),
    callerChannelId: String(wo?.callerChannelId || ""),
    useAiModule:     String(wo?.useAiModule || ""),
    toolsDisabled:   true,
    configuredTools: Array.isArray(wo?.tools) ? wo.tools : [],
    requestToolNames: [],
    toolChoice:      "none"
  });
  try {
    const headers = await getRequestHeaders(wo);
    const res     = await fetchWithTimeout(wo.endpoint, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
    const raw     = await res.text();
    if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText, raw };
    const data   = getTryParseJSON(raw, null);
    const choice = data?.choices?.[0];
    const msg    = choice?.message || {};
    const text   = typeof msg.content === "string" ? msg.content : "";
    const finish = choice?.finish_reason ?? null;
    return { ok: true, text, finish, raw };
  } catch (e) {
    const isAbort = e?.name === "AbortError" || String(e?.type).toLowerCase() === "aborted";
    return { ok: false, error: isAbort ? "timeout" : (e?.message || String(e)) };
  }
}


function getCleanSingleLinePrompt(s) {
  return String(s ?? "").replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
}


function getExtractFirstUrlFromString(s) {
  const m = String(s ?? "").match(/\b(https?:\/\/[^\s<>"'`]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\b/i);
  return m ? String(m[1] || "").trim() : "";
}


function getExtractUrlFromToolResult(toolResultContent) {
  const raw = String(toolResultContent ?? "").trim();
  if (!raw) return "";

  const direct = getExtractFirstUrlFromString(raw);
  if (direct) return direct;

  const parsed = getTryParseJSON(raw, null);
  if (!parsed || typeof parsed !== "object") return "";

  let   found = "";
  const seen  = new Set();

  const add = (u) => {
    const t = typeof u === "string" ? u.trim() : "";
    if (!t || found) return;
    if (!/^https?:\/\//i.test(t) && !/^data:image\//i.test(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    found = t;
  };

  const scan = (v, depth) => {
    if (found || depth > 8 || v == null) return;
    if (typeof v === "string") { const u = getExtractFirstUrlFromString(v); if (u) add(u); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    if (typeof v !== "object") return;
    const directKeys = ["url", "imageUrl", "image_url", "href", "link", "image", "output", "result", "data", "file", "files", "path", "uri", "src"];
    for (const k of directKeys) { if (Object.prototype.hasOwnProperty.call(v, k)) { scan(v[k], depth + 1); if (found) return; } }
    for (const [k, val] of Object.entries(v)) { if (found) return; if (typeof k === "string" && /url|link|href|image|uri|src|file|path|output|result/i.test(k)) scan(val, depth + 1); }
  };

  scan(parsed, 0);
  return found;
}


export default async function getCoreAi(coreData) {
  let wo  = coreData.workingObject;
  const log = getPrefixedLogger(wo, import.meta.url);
  wo = await applyAiFallbackOverrides(wo, { log, moduleName: MODULE_NAME, endpoint: wo?.endpoint });
  coreData.workingObject = wo;

  if (!getShouldRunForThisModule(wo)) {
    log(`Skipped: useAiModule="${String(wo?.useAiModule ?? "").trim()}" not handled by ${MODULE_NAME}`, "info");
    return coreData;
  }

  if (wo.skipAiCompletions === true) {
    log("Skipped: skipAiCompletions flag set", "info");
    return coreData;
  }

  const moduleCfg    = coreData.config?.[MODULE_NAME] || {};
  const kiCfg        = getKiCfg(wo, moduleCfg);
  const userPromptRaw = String(wo.payload ?? "");
  if (!userPromptRaw.trim()) {
    log("Skipped: empty payload", "info");
    return coreData;
  }

  let snapshot = [];
  if (Array.isArray(wo._contextSnapshot)) {
    snapshot = wo._contextSnapshot;
  } else {
    try { snapshot = await getContext(wo); } catch {}
  }

  const earliestTimestamps = await getContextEarliestTimestamps(wo).catch(() => []);
  const history  = getPromptFromSnapshot(snapshot, kiCfg.includeHistory, kiCfg.includeHistorySystemMessages);
  const system1  = getSystemContentText(wo, { earliestTimestamps, moduleCfg });

  const pass1Messages = [
    { role: "system", content: system1 },
    ...history,
    { role: "user", content: userPromptRaw }
  ];

  let textOut    = "";
  let hitMaxLoops = false;

  for (let i = 0; i < kiCfg.maxLoops; i++) {
    if (wo.aborted) {
      log("Pipeline aborted — client disconnected.", "warn");
      wo.response = "[Empty AI response]";
      return coreData;
    }

    const pass1 = await getCallChat(
      wo,
      { model: wo.model, messages: pass1Messages, temperature: kiCfg.temperature, max_tokens: kiCfg.maxTokens },
      kiCfg.requestTimeoutMs
    );

    if (!pass1.ok) {
      log(pass1.error === "timeout"
        ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).`
        : `AI request failed: ${String(pass1?.status || "")} ${String(pass1?.statusText || "")} ${String(pass1?.error || "")} ${String(pass1?.raw || "").slice(0, 300)}`,
        "warn");
      const _partial = textOut.trim();
      wo.response = _partial ? `[PARTIAL RESULT — interrupted]\n\n${_partial}` : "[Empty AI response]";
      if (_partial) log(`Returning partial result: ${_partial.length} chars`, "info");
      return coreData;
    }

    const chunkText = String(pass1.text ?? "").trim();
    log(`AI pass1 turn ${i + 1}: finish_reason="${pass1.finish ?? "null"}" content_length=${chunkText.length}`, "info");

    textOut += (textOut ? "\n" : "") + chunkText;
    pass1Messages.push({ role: "assistant", content: chunkText });

    const cutOff = !wo.__noContinuation && (pass1.finish === "length" || getLooksCutOff(chunkText));
    if (cutOff) {
      pass1Messages.push({ role: "user", content: "continue" });
      log(`Continue triggered: finish_reason="${pass1.finish ?? "null"}" looks_cut_off=${getLooksCutOff(chunkText)}`, "info");
      continue;
    }
    break;
  }

  if (!textOut.trim() && pass1Messages.length && pass1Messages[pass1Messages.length - 1]?.role !== "assistant") {
    hitMaxLoops = true;
  }

  textOut = textOut.trim();

  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];
  const assistantPass1 = { role: "assistant", authorName: getAssistantAuthorName(wo), content: textOut };
  if (assistantPass1.authorName == null) delete assistantPass1.authorName;

  const personaForImages = getStr(wo?.persona, "");
  const system2          = getSystemContentImagePromptRun(kiCfg.imagePromptRules);
  const ctxText          = getRecentContextForImage(snapshot, kiCfg.imageContextTurns);
  const visualSource     = getVisualSourceForImage(wo, kiCfg.imagePersonaHint);

  /*
   * Current turn content is listed first so the image AI weights it most heavily.
   * Context is labelled as continuity reference to discourage depicting old events.
   */
  const userBlock = [
    "LATEST ASSISTANT TEXT (depict this):",
    textOut || "(empty)",
    "",
    "LATEST USER INPUT:",
    userPromptRaw || "(empty)",
    "",
    "VISUAL SOURCE MATERIAL (extract visible appearance only — do NOT depict events, roles, backstory, or instructions from here):",
    visualSource || "(none)",
    "",
    "ROLEPLAY CONTEXT (continuity reference only — do NOT depict old events):",
    ctxText || "(none)",
    "",
    "TASK: Create one image prompt that depicts the most recent concrete event."
  ].join("\n");

  const pass2 = await getCallChat(
    wo,
    {
      model:       wo.model,
      messages:    [{ role: "system", content: system2 }, { role: "user", content: userBlock }],
      temperature: kiCfg.imagePromptTemperature,
      max_tokens:  kiCfg.imagePromptMaxTokens
    },
    kiCfg.requestTimeoutMs
  );

  let imagePrompt = "";
  if (pass2.ok) imagePrompt = getCleanSingleLinePrompt(pass2.text);

  if (!imagePrompt) {
    const fallbackAnchor = personaForImages || kiCfg.imagePersonaHint || "A consistent main character";
    imagePrompt = getCleanSingleLinePrompt(`${fallbackAnchor}. Depict the most recent concrete event from the provided context, cinematic, detailed, high quality.`);
  }

  const toolsList     = Array.isArray(kiCfg.toolsList) ? kiCfg.toolsList : [];
  const firstToolName = toolsList.length ? String(toolsList[0] ?? "").trim() : "";
  let   finalUrl      = "";

  if (firstToolName) {
    const tool = await getToolByName(firstToolName, wo);
    if (tool) {
      try {
        const result  = await tool.invoke({ prompt: imagePrompt }, coreData);
        const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
        finalUrl = getExtractUrlFromToolResult(content);
      } catch {}
    }
  }

  const finalText = (finalUrl ? (textOut + "\n" + finalUrl) : textOut).trim();

  assistantPass1.content = finalText;
  wo._contextPersistQueue.push(getWithTurnId(assistantPass1, wo));

  wo.reasoningSummary = undefined;
  if (Array.isArray(wo._pendingSubtaskLogs) && wo._pendingSubtaskLogs.length) {
    wo.reasoningSummary = wo._pendingSubtaskLogs.join("\n\n");
    wo._pendingSubtaskLogs = [];
  }

  wo.response = finalText || (hitMaxLoops
    ? "[Max Loops Hit]\n\nLoop limit reached. This is the partial result so far. Start a new AI run if you want me to continue from here."
    : "I could not generate a visible answer in this turn. Please ask again and I will answer directly.");

  const { primaryImageUrl: _primaryImg } = getParseArtifactsBlock(wo.response);
  if (_primaryImg) wo.primaryImageUrl = _primaryImg;
  log("AI response received.", "info");
  return coreData;
}
