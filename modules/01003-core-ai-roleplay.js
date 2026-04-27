/**************************************************************/
/* filename: "01003-core-ai-roleplay.js"                            */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


import { getContext, getContextEarliestTimestamps } from "../core/context.js";
import { getStr, getNum } from "../core/utils.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { applyAiFallbackOverrides } from "../core/ai-fallback.js";
import { readFileSync }  from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _manifestDir = join(dirname(fileURLToPath(import.meta.url)), "../manifests");

const MODULE_NAME = "core-ai-roleplay";


function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


function getBool(value, def) { return typeof value === "boolean" ? value : def; }


function getTryParseJSON(text, fallback = null) { try { return JSON.parse(text); } catch { return fallback; } }


async function getRequestHeaders(wo) {
  const headers = { "Content-Type": "application/json" };
  const keyName = typeof wo?.apiKey === "string" ? wo.apiKey.trim() : "";
  if (!keyName) return headers;
  const secret = String(await getSecret(wo, keyName) || "").trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}


function getLooksCutOff(text) {
  const s = String(text ?? "").trimEnd();
  if (!s) return false;
  const last = s[s.length - 1];
  return !/[.!?:;*"»)\]}>~`]/.test(last);
}


function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAiModule ?? "").trim().toLowerCase();
  return v === "roleplay" || v === "core-ai-roleplay";
}


function getWithTurnId(rec, wo) {
  const t = typeof wo?.turnId === "string" && wo.turnId ? wo.turnId : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined;
  return { ...(t ? { ...rec, turnId: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}


function getKiCfg(wo) {
  return {
    includeHistory: getBool(wo?.includeHistory, true),
    includeHistorySystemMessages: getBool(wo?.includeHistorySystemMessages, false),
    temperature: getNum(wo?.temperature, 0.7),
    maxTokens: getNum(wo?.maxTokens, 1200),
    requestTimeoutMs: getNum(wo?.requestTimeoutMs, 120000),
    toolsList: Array.isArray(wo?.tools) ? wo.tools : [],
    imagePromptMaxTokens: getNum(wo?.imagePromptMaxTokens, 260),
    imagePromptTemperature: getNum(wo?.imagePromptTemperature, 0.35),
    imagePersonaHint: getStr(wo?.imagePersonaHint, ""),
    imageContextTurns: Math.max(0, getNum(wo?.imageContextTurns, 8)),
    maxLoops: Math.max(1, getNum(wo?.maxLoops, 5)),
    imagePromptRules: getStr(wo?.imagePromptRules, "")
  };
}

function getLimitNotice() {
  return "Loop limit reached. This is the partial result so far. Start a new AI run if you want me to continue from here.";
}


function getStripTrailingUrl(text) {
  return String(text ?? "")
    .replace(/\n+(https?:\/\/\S+)\s*$/i, "")
    .trimEnd();
}


function getPromptFromSnapshot(rows, includeHistory, includeHistorySystemMessages = false) {
  if (!includeHistory) return [];
  const out = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i] || {};
    if (r.role === "system") {
      if (includeHistorySystemMessages) out.push({ role: "system", content: r.content ?? "" });
    }
    else if (r.role === "user") out.push({ role: "user", content: r.content ?? "" });
    else if (r.role === "assistant") out.push({ role: "assistant", content: getStripTrailingUrl(r.content ?? "") });
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
    const c = getStripTrailingUrl(String(x?.content ?? "")).trim();
    if (!c) continue;
    lines.push(`${role}: ${c}`);
  }
  return lines.join("\n");
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


async function getToolByName(name, wo) {
  const log = getPrefixedLogger(wo, import.meta.url);
  try {
    const mod = await import(`../tools/${name}.js`);
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


function getExtractFirstUrlFromString(s) {
  const txt = String(s ?? "");
  const m = txt.match(/\b(https?:\/\/[^\s<>"'`]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\b/i);
  return m ? String(m[1] || "").trim() : "";
}


function getExtractUrlFromToolResult(toolResultContent) {
  const raw = String(toolResultContent ?? "").trim();
  if (!raw) return "";

  const direct = getExtractFirstUrlFromString(raw);
  if (direct) return direct;

  const parsed = getTryParseJSON(raw, null);
  if (!parsed || typeof parsed !== "object") return "";

  let found = "";
  const seen = new Set();

  const add = (u) => {
    const t = typeof u === "string" ? u.trim() : "";
    if (!t) return;
    if (!/^https?:\/\//i.test(t) && !/^data:image\//i.test(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    if (!found) found = t;
  };

  const scan = (v, depth) => {
    if (found) return;
    if (depth > 8) return;
    if (v == null) return;

    if (typeof v === "string") {
      const u = getExtractFirstUrlFromString(v);
      if (u) add(u);
      return;
    }

    if (Array.isArray(v)) {
      for (const x of v) scan(x, depth + 1);
      return;
    }

    if (typeof v !== "object") return;

    const directKeys = [
      "url", "imageUrl", "image_url", "href", "link", "image", "output", "result",
      "data", "file", "files", "path", "uri", "src"
    ];

    for (const k of directKeys) {
      if (Object.prototype.hasOwnProperty.call(v, k)) scan(v[k], depth + 1);
      if (found) return;
    }

    for (const [k, val] of Object.entries(v)) {
      if (found) return;
      if (typeof k === "string" && /url|link|href|image|uri|src|file|path|output|result/i.test(k)) scan(val, depth + 1);
    }
  };

  scan(parsed, 0);
  return found;
}


function getChannelAwarenessBlock(wo) {
  const agentType = typeof wo?.agentType === "string" ? wo.agentType.trim() : "";
  const agentDepth = Number.isFinite(Number(wo?.agentDepth)) ? Number(wo.agentDepth) : 0;
  const mode = agentType ? "orchestrator-or-specialist" : "primary-user-channel";

  const lines = [
    "Channel awareness:",
    `- channel_awareness_mode: ${mode}`
  ];

  if (agentType) {
    lines.push(`- agent_type: ${agentType}`);
    lines.push(`- agent_depth: ${agentDepth}`);
    const delegatePrompt = wo?.agentDelegateRolePrompt ?? "";
    if (delegatePrompt) delegatePrompt.split("\n").forEach(l => lines.push(`- ${l}`));
  } else {
    if (wo?.primaryRolePrompt) lines.push(`- ${wo.primaryRolePrompt}`);
    const toolNames = Array.isArray(wo?.tools) ? wo.tools : [];
    getManifestPolicyHints(toolNames).forEach(h => lines.push(`- ${h}`));
  }

  return lines.join("\n");
}


function getSystemContentTextRun(wo, moduleCfg, earliestTimestamps) {
  const base = [
    typeof wo.systemPrompt === "string" ? wo.systemPrompt.trim() : "",
    typeof wo.persona === "string" ? wo.persona.trim() : "",
    typeof wo.instructions === "string" ? wo.instructions.trim() : "",
    typeof wo._deliveryInstructions === "string" ? wo._deliveryInstructions.trim() : ""
  ].filter(Boolean).join("\n\n");

  const stamps = Array.isArray(earliestTimestamps) ? earliestTimestamps : [];

  const nowIso = new Date().toISOString();
  const tz = typeof wo?.timezone === "string" && wo.timezone.trim() ? wo.timezone.trim() : "Europe/Berlin";
  const earliestLines = stamps.map(
    ({ channelId, earliestTs }) => `- context_earliest_record (channel "${channelId}"): ${earliestTs}`
  );
  const runtimeInfo = stamps.length ? [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    ...earliestLines,
    "- context_earliest_record shows how far back the database holds records for each channel, regardless of how many entries are visible in this context window."
  ].join("\n") : "";

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

  const policy = getStr(wo?.policyPrompt, "") || getStr(moduleCfg?.policyPrompt, "");
  const systemPromptAddition = typeof wo?.systemPromptAddition === "string" ? wo.systemPromptAddition.trim() : "";

  return [base, agentInfo, getChannelAwarenessBlock(wo), runtimeInfo, policy, systemPromptAddition].filter(Boolean).join("\n\n");
}


function getSystemContentImagePromptRun(personaText, imagePersonaHint, imagePromptRules) {
  const persona = String(personaText ?? "").trim();
  const hint = String(imagePersonaHint ?? "").trim();

  const anchor = [
    "Character anchor (MUST keep consistent across ALL images):",
    persona ? `- persona: ${persona}` : "- persona: (none provided)",
    hint ? `- Fixed look hint: ${hint}` : ""
  ].filter(Boolean).join("\n");

  const rules = String(imagePromptRules ?? "").trim();

  return [anchor, rules].filter(Boolean).join("\n\n");
}


async function getCallChat(wo, body, timeoutMs) {
  try {
    const requestToolNames = Array.isArray(wo?.tools) ? wo.tools : [];
    const log = getPrefixedLogger(wo, import.meta.url);
    log("AI request tool snapshot", "info", {
      channelId: String(wo?.channelId || ""),
      callerChannelId: String(wo?.callerChannelId || ""),
      useAiModule: String(wo?.useAiModule || ""),
      toolsDisabled: true,
      configuredTools: requestToolNames,
      requestToolNames: [],
      toolChoice: "none"
    });
    const headers = await getRequestHeaders(wo);
    const res = await fetchWithTimeout(wo.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, timeoutMs);

    const raw = await res.text();
    if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText, raw };

    const data = getTryParseJSON(raw, null);
    const choice = data?.choices?.[0];
    const msg = choice?.message || {};
    const text = typeof msg.content === "string" ? msg.content : "";
    const finish = choice?.finish_reason ?? null;
    return { ok: true, text, finish, raw };
  } catch (e) {
    const isAbort = e?.name === "AbortError" || String(e?.type).toLowerCase() === "aborted";
    return { ok: false, error: isAbort ? "timeout" : (e?.message || String(e)) };
  }
}


function getCleanSingleLinePrompt(s) {
  return String(s ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


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


export default async function getCoreAi(coreData) {
  let wo = coreData.workingObject;
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

  const kiCfg = getKiCfg(wo);
  const moduleCfg = coreData.config?.[MODULE_NAME] || {};
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

  const _earliestTimestamps = await getContextEarliestTimestamps(wo).catch(() => []);
  const history = getPromptFromSnapshot(snapshot, kiCfg.includeHistory, kiCfg.includeHistorySystemMessages);
  const system1 = getSystemContentTextRun(wo, moduleCfg, _earliestTimestamps);

  
  const pass1Messages = [
    { role: "system", content: system1 },
    ...history,
    { role: "user", content: userPromptRaw }
  ];
  let textOut = "";
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
        : `AI request failed: ${String(pass1?.status || "")} ${String(pass1?.statusText || "")} ${String(pass1?.error || "")} ${String(pass1?.raw || "").slice(0, 300)}`, "warn");
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
  const system2 = getSystemContentImagePromptRun(personaForImages, kiCfg.imagePersonaHint, kiCfg.imagePromptRules);

  const ctxText = getRecentContextForImage(snapshot, kiCfg.imageContextTurns);
  const userBlock = [
    "ROLEPLAY CONTEXT (recent turns):",
    ctxText || "(none)",
    "",
    "LATEST USER INPUT:",
    userPromptRaw || "(empty)",
    "",
    "LATEST ASSISTANT TEXT (what happened this turn):",
    textOut || "(empty)",
    "",
    "TASK: Create one image prompt that depicts the most recent concrete event."
  ].join("\n");

  const pass2 = await getCallChat(
    wo,
    {
      model: wo.model,
      messages: [
        { role: "system", content: system2 },
        { role: "user", content: userBlock }
      ],
      temperature: kiCfg.imagePromptTemperature,
      max_tokens: kiCfg.imagePromptMaxTokens
    },
    kiCfg.requestTimeoutMs
  );

  let imagePrompt = "";
  if (pass2.ok) imagePrompt = getCleanSingleLinePrompt(pass2.text);

  if (!imagePrompt) {
    const fallbackAnchor = (personaForImages || kiCfg.imagePersonaHint || "A consistent main character");
    imagePrompt = `${fallbackAnchor}. Depict the most recent concrete event from the provided context, cinematic, detailed, high quality.`;
    imagePrompt = getCleanSingleLinePrompt(imagePrompt);
  }

  
  const toolsList = Array.isArray(kiCfg.toolsList) ? kiCfg.toolsList : [];
  const firstToolName = toolsList.length ? String(toolsList[0] ?? "").trim() : "";
  let finalUrl = "";

  if (firstToolName) {
    const tool = await getToolByName(firstToolName, wo);
    if (tool) {
      try {
        const result = await tool.invoke({ prompt: imagePrompt }, coreData);
        const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
        finalUrl = getExtractUrlFromToolResult(content);
      } catch {
        finalUrl = "";
      }
    }
  }

  const finalText = (finalUrl ? (textOut + "\n" + finalUrl) : textOut).trim();

  assistantPass1.content = finalText;
  wo._contextPersistQueue.push(getWithTurnId(assistantPass1, wo));

  wo.reasoningSummary = undefined;

  if (Array.isArray(wo._pendingSubtaskLogs) && wo._pendingSubtaskLogs.length) {
    const _logBlock = wo._pendingSubtaskLogs.join("\n\n");
    wo.reasoningSummary = _logBlock;
    wo._pendingSubtaskLogs = [];
  }

  wo.response = finalText || (hitMaxLoops ? ("[Max Loops Hit]\n\n" + getLimitNotice()) : "I could not generate a visible answer in this turn. Please ask again and I will answer directly.");
  const { primaryImageUrl: _primaryImg } = getParseArtifactsBlock(wo.response);
  if (_primaryImg) wo.primaryImageUrl = _primaryImg;
  log("AI response received.", "info");
  return coreData;
}
