/*******************************************************************************
/* filename: 01003-core-ai-roleplay.js                                             *
/* Version 1.0                                                                 *
/* Purpose: Two-pass generation for models that struggle with multi-step.      *
/*          Pass 1 (LLM): Generate normal text response.                       *
/*          Pass 2 (LLM): Turn that text into ONE image description/prompt.    *
/*              - Pass 2 receives persona + optional ImagePersonaHint.         *
/*              - Pass 2 also receives CONTEXT (recent history) + latest user  *
/*                input, so the prompt reflects events, not just vibes.        *
/*          Then call ONLY the FIRST tool in tools[] with {prompt:<imgPrompt>} *
/*          Parse returned URL (string or JSON) and append it to the END of    *
/*          the Pass-1 text on its own line.                                   *
/* Persistence: Only persist the Pass-1 assistant text (NOT the prompt pass). *
/*******************************************************************************/
import { getContext } from "../core/context.js";

const MODULE_NAME = "core-ai-roleplay";


function getAssistantAuthorName(wo) {
  const v = (typeof wo?.botName === "string" && wo.botName.trim().length) ? wo.botName.trim() : "";
  return v.length ? v : undefined;
}


function getBool(value, def) { return typeof value === "boolean" ? value : def; }


function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }


function getStr(value, def) { return (typeof value === "string" && value.trim().length) ? value.trim() : def; }


function getTryParseJSON(text, fallback = null) { try { return JSON.parse(text); } catch { return fallback; } }


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
  const t = typeof wo?.turn_id === "string" && wo.turn_id ? wo.turn_id : undefined;
  const uid = typeof wo?.userId === "string" && wo.userId ? wo.userId : undefined;
  return { ...(t ? { ...rec, turn_id: t } : rec), ...(uid ? { userId: uid } : {}), ts: new Date().toISOString() };
}


function getKiCfg(wo) {
  return {
    includeHistory: getBool(wo?.includeHistory, true),
    temperature: getNum(wo?.temperature, 0.7),
    maxTokens: getNum(wo?.maxTokens, 1200),
    requestTimeoutMs: getNum(wo?.requestTimeoutMs, 120000),
    toolsList: Array.isArray(wo?.tools) ? wo.tools : [],
    imagePromptMaxTokens: getNum(wo?.ImagePromptMaxTokens, 260),
    imagePromptTemperature: getNum(wo?.ImagePromptTemperature, 0.35),
    imagePersonaHint: getStr(wo?.ImagePersonaHint, ""),
    imageContextTurns: Math.max(0, getNum(wo?.ImageContextTurns, 8)),
    maxLoops: Math.max(1, getNum(wo?.maxLoops, 5))
  };
}


function getStripTrailingUrl(text) {
  return String(text ?? "")
    .replace(/\n+(https?:\/\/\S+)\s*$/i, "")
    .trimEnd();
}


function getPromptFromSnapshot(rows, includeHistory) {
  if (!includeHistory) return [];
  const out = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i] || {};
    if (r.role === "user") out.push({ role: "user", content: r.content ?? "" });
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


async function getToolByName(name, wo) {
  try {
    const mod = await import(`../tools/${name}.js`);
    const tool = mod?.default ?? mod;
    if (tool && typeof tool.invoke === "function") return tool;

    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Tool "${name}" invalid (missing invoke).`
    });
    return null;
  } catch (e) {
    wo.logging?.push({
      timestamp: new Date().toISOString(),
      severity: "warn",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `Tool "${name}" load failed: ${e?.message || String(e)}`
    });
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
      "data", "file", "path", "uri", "src"
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


function getSystemContentTextRun(wo) {
  return [
    typeof wo.systemPrompt === "string" ? wo.systemPrompt.trim() : "",
    typeof wo.persona === "string" ? wo.persona.trim() : "",
    typeof wo.instructions === "string" ? wo.instructions.trim() : ""
  ].filter(Boolean).join("\n\n");
}


function getSystemContentImagePromptRun(personaText, imagePersonaHint) {
  const persona = String(personaText ?? "").trim();
  const hint = String(imagePersonaHint ?? "").trim();

  const anchor = [
    "Character anchor (MUST keep consistent across images):",
    persona ? `- persona: ${persona}` : "- persona: (none provided)",
    hint ? `- Fixed look hint: ${hint}` : ""
  ].filter(Boolean).join("\n");

  const rules = [
    "You convert the provided ROLEPLAY CONTEXT into ONE image generation prompt that depicts a concrete event.",
    "Rules:",
    "- Output ONLY the prompt text. No quotes. No markdown. No JSON. No extra lines.",
    "- The image MUST depict the most recent specific event/action from the context (not a generic mood shot).",
    "- Start by describing the main character using the Character anchor, then the event scene.",
    "- Include: setting, props, body language, facial expression, lighting, camera framing (e.g., close-up/medium/wide).",
    "- Do NOT include any URLs.",
    "- Keep it under 80 words."
  ].join("\n");

  return [anchor, rules].filter(Boolean).join("\n\n");
}


async function getCallChat(wo, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(wo.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${wo.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });

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
  } finally {
    clearTimeout(timer);
  }
}


function getCleanSingleLinePrompt(s) {
  return String(s ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export default async function getCoreAi(coreData) {
  const wo = coreData.workingObject;
  if (!Array.isArray(wo.logging)) wo.logging = [];

  if (!getShouldRunForThisModule(wo)) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Skipped: useAiModule="${String(wo?.useAiModule ?? "").trim()}" not handled by ${MODULE_NAME}`
    });
    return coreData;
  }

  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");
  if (!userPromptRaw.trim()) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "skipped", message: "Skipped: empty payload" });
    return coreData;
  }

  let snapshot = [];
  if (Array.isArray(wo._contextSnapshot)) {
    snapshot = wo._contextSnapshot;
  } else {
    try { snapshot = await getContext(wo); } catch {}
  }

  const history = getPromptFromSnapshot(snapshot, kiCfg.includeHistory);
  const system1 = getSystemContentTextRun(wo);

  /***** PASS 1: TEXT (with continue loop) *****/
  const pass1Messages = [
    { role: "system", content: system1 },
    ...history,
    { role: "user", content: userPromptRaw }
  ];
  let textOut = "";

  for (let i = 0; i < kiCfg.maxLoops; i++) {
    const pass1 = await getCallChat(
      wo,
      { model: wo.model, messages: pass1Messages, temperature: kiCfg.temperature, max_tokens: kiCfg.maxTokens },
      kiCfg.requestTimeoutMs
    );

    if (!pass1.ok) {
      wo.response = "[Empty AI response]";
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "warn",
        module: MODULE_NAME,
        exitStatus: "failed",
        message: pass1.error === "timeout"
          ? `AI request timed out after ${kiCfg.requestTimeoutMs} ms (AbortError).`
          : `AI request failed: ${String(pass1?.status || "")} ${String(pass1?.statusText || "")} ${String(pass1?.error || "")} ${String(pass1?.raw || "").slice(0, 300)}`
      });
      return coreData;
    }

    const chunkText = String(pass1.text ?? "").trim();
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: `AI pass1 turn ${i + 1}: finish_reason="${pass1.finish ?? "null"}" content_length=${chunkText.length}`
    });

    textOut += (textOut ? "\n" : "") + chunkText;
    pass1Messages.push({ role: "assistant", content: chunkText });

    const cutOff = pass1.finish === "length" || getLooksCutOff(chunkText);
    if (cutOff) {
      pass1Messages.push({ role: "user", content: "continue" });
      wo.logging.push({
        timestamp: new Date().toISOString(),
        severity: "info",
        module: MODULE_NAME,
        exitStatus: "success",
        message: `Continue triggered: finish_reason="${pass1.finish ?? "null"}" looks_cut_off=${getLooksCutOff(chunkText)}`
      });
      continue;
    }
    break;
  }

  textOut = textOut.trim();

  if (!Array.isArray(wo._contextPersistQueue)) wo._contextPersistQueue = [];
  const assistantPass1 = { role: "assistant", authorName: getAssistantAuthorName(wo), content: textOut };
  if (assistantPass1.authorName == null) delete assistantPass1.authorName;

  /***** PASS 2: IMAGE PROMPT (NOT persisted) *****/
  const personaForImages = getStr(wo?.persona, "");
  const system2 = getSystemContentImagePromptRun(personaForImages, kiCfg.imagePersonaHint);

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

  /***** TOOL: FIRST TOOL ONLY *****/
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

  wo.response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });
  return coreData;
}
