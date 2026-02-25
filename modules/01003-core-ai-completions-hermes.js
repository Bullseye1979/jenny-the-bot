/******************************************************************************* 
/* filename: "core-ai-twopass-image.js"                                        *
/* Version 1.0                                                                 *
/* Purpose: Two-pass generation for models that struggle with multi-step.      *
/*          Pass 1 (LLM): Generate normal text response.                       *
/*          Pass 2 (LLM): Turn that text into ONE image description/prompt.    *
/*          Then call ONLY the FIRST tool in Tools[] with {prompt:<imgPrompt>} *
/*          Parse returned URL (string or JSON) and append it to the END of    *
/*          the Pass-1 text on its own line.                                   *
/* Persistence: Only persist the Pass-1 assistant text (NOT the prompt pass). *
/*******************************************************************************/
/******************************************************************************* 
/*                                                                             *
/*******************************************************************************/

import { getContext, setContext } from "../core/context.js";

const MODULE_NAME = "core-ai-twopass-image";

/******************************************************************************* 
/* functionSignature: getAssistantAuthorName (wo)                              *
/* Returns the assistant authorName (Botname).                                 *
/*******************************************************************************/
function getAssistantAuthorName(wo) {
  const v = (typeof wo?.Botname === "string" && wo.Botname.trim().length) ? wo.Botname.trim() : "";
  return v.length ? v : undefined;
}

/******************************************************************************* 
/* functionSignature: getBool (value, def)                                     *
/* Returns the boolean value or the default.                                   *
/*******************************************************************************/
function getBool(value, def) { return typeof value === "boolean" ? value : def; }

/******************************************************************************* 
/* functionSignature: getNum (value, def)                                      *
/* Converts to a finite number or returns the default.                         *
/*******************************************************************************/
function getNum(value, def) { return Number.isFinite(value) ? Number(value) : def; }

/******************************************************************************* 
/* functionSignature: getStr (value, def)                                      *
/* Returns a non-empty string or the default.                                  *
/*******************************************************************************/
function getStr(value, def) { return (typeof value === "string" && value.trim().length) ? value.trim() : def; }

/******************************************************************************* 
/* functionSignature: getTryParseJSON (text, fallback)                         *
/* Safely parses JSON with a fallback value on failure.                        *
/*******************************************************************************/
function getTryParseJSON(text, fallback = null) { try { return JSON.parse(text); } catch { return fallback; } }

/******************************************************************************* 
/* functionSignature: getShouldRunForThisModule (wo)                           *
/* Determines whether to process this request.                                 *
/*******************************************************************************/
function getShouldRunForThisModule(wo) {
  const v = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  return v === "twopass-image" || v === "core-ai-twopass-image" || v === "twopassimage";
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
  return {
    includeHistory: getBool(wo?.IncludeHistory, true),
    temperature: getNum(wo?.Temperature, 0.7),
    maxTokens: getNum(wo?.MaxTokens, 1200),
    requestTimeoutMs: getNum(wo?.RequestTimeoutMs, 120000),
    toolsList: Array.isArray(wo?.Tools) ? wo.Tools : [],
    imagePromptMaxTokens: getNum(wo?.ImagePromptMaxTokens, 200),
    imagePromptTemperature: getNum(wo?.ImagePromptTemperature, 0.4)
  };
}

/******************************************************************************* 
/* functionSignature: getPromptFromSnapshot (rows, includeHistory)             *
/* Maps history rows to chat messages.                                         *
/*******************************************************************************/
function getPromptFromSnapshot(rows, includeHistory) {
  if (!includeHistory) return [];
  const out = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i] || {};
    if (r.role === "user") out.push({ role: "user", content: r.content ?? "" });
    else if (r.role === "assistant") out.push({ role: "assistant", content: r.content ?? "" });
  }
  return out;
}

/******************************************************************************* 
/* functionSignature: getToolByName (name, wo)                                 *
/* Dynamically imports one tool module.                                        *
/*******************************************************************************/
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

/******************************************************************************* 
/* functionSignature: getExtractFirstUrlFromString (s)                         *
/* Extracts the first URL from an arbitrary string.                            *
/*******************************************************************************/
function getExtractFirstUrlFromString(s) {
  const txt = String(s ?? "");
  const m = txt.match(/\b(https?:\/\/[^\s<>"'`]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\b/i);
  return m ? String(m[1] || "").trim() : "";
}

/******************************************************************************* 
/* functionSignature: getExtractUrlFromToolResult (toolResultContent)          *
/* HARD extraction: regex first, then deep JSON scan.                          *
/*******************************************************************************/
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

/******************************************************************************* 
/* functionSignature: getSystemContentTextRun (wo)                             *
/* System content for pass 1.                                                  *
/*******************************************************************************/
function getSystemContentTextRun(wo) {
  return [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Persona === "string" ? wo.Persona.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
  ].filter(Boolean).join("\n\n");
}

/******************************************************************************* 
/* functionSignature: getSystemContentImagePromptRun ()                        *
/* System content for pass 2 (image prompt generator).                         *
/*******************************************************************************/
function getSystemContentImagePromptRun() {
  return [
    "You convert a story text into ONE concise image generation prompt.",
    "Rules:",
    "- Output ONLY the prompt text. No quotes. No markdown. No JSON. No extra lines.",
    "- Make it descriptive: subject, setting, lighting, mood, camera framing.",
    "- Do NOT include any URLs.",
    "- Keep it under 60 words.",
    "- If the story is abstract, pick a representative scene."
  ].join("\n");
}

/******************************************************************************* 
/* functionSignature: getCallChat (wo, body, timeoutMs)                        *
/* Calls the OpenAI-compatible chat endpoint and returns message content.      *
/*******************************************************************************/
async function getCallChat(wo, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(wo.Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${wo.APIKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, statusText: res.statusText, raw };
    }

    const data = getTryParseJSON(raw, null);
    const choice = data?.choices?.[0];
    const msg = choice?.message || {};
    const text = typeof msg.content === "string" ? msg.content : "";
    return { ok: true, text, raw };
  } catch (e) {
    const isAbort = e?.name === "AbortError" || String(e?.type).toLowerCase() === "aborted";
    return { ok: false, error: isAbort ? "timeout" : (e?.message || String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

/******************************************************************************* 
/* functionSignature: getCleanSingleLinePrompt (s)                             *
/* Normalizes the image prompt.                                                *
/*******************************************************************************/
function getCleanSingleLinePrompt(s) {
  return String(s ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/******************************************************************************* 
/* functionSignature: getCoreAi (coreData)                                     *
/* Pass1 text -> persist; Pass2 prompt -> tool -> append URL -> return.        *
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
      message: `Skipped: useAIModule="${String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim()}" not handled by ${MODULE_NAME}`
    });
    return coreData;
  }

  const skipContextWrites = wo?.doNotWriteToContext === true;
  const kiCfg = getKiCfg(wo);
  const userPromptRaw = String(wo.payload ?? "");

  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "started", message: "AI request started" });

  let snapshot = [];
  try { snapshot = await getContext(wo); } catch {}

  const history = getPromptFromSnapshot(snapshot, kiCfg.includeHistory);
  const system1 = getSystemContentTextRun(wo);

  const messages1 = [
    { role: "system", content: system1 },
    ...history,
    { role: "user", content: userPromptRaw }
  ];

  const persistQueue = [];

  /***** PASS 1: TEXT *****/
  const pass1 = await getCallChat(
    wo,
    { model: wo.Model, messages: messages1, temperature: kiCfg.temperature, max_tokens: kiCfg.maxTokens },
    kiCfg.requestTimeoutMs
  );

  if (!pass1.ok) {
    wo.Response = "[Empty AI response]";
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

  const textOut = String(pass1.text ?? "").trim();

  const assistantPass1 = { role: "assistant", authorName: getAssistantAuthorName(wo), content: textOut };
  if (assistantPass1.authorName == null) delete assistantPass1.authorName;
  persistQueue.push(getWithTurnId(assistantPass1, wo));

  /***** PASS 2: IMAGE PROMPT (NOT persisted) *****/
  const system2 = getSystemContentImagePromptRun();
  const messages2 = [
    { role: "system", content: system2 },
    { role: "user", content: textOut }
  ];

  const pass2 = await getCallChat(
    wo,
    { model: wo.Model, messages: messages2, temperature: kiCfg.imagePromptTemperature, max_tokens: kiCfg.imagePromptMaxTokens },
    kiCfg.requestTimeoutMs
  );

  let imagePrompt = "";
  if (pass2.ok) imagePrompt = getCleanSingleLinePrompt(pass2.text);
  if (!imagePrompt) imagePrompt = "A representative scene matching the provided story text, cinematic, detailed, high quality.";

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

        const toolMsg = { role: "tool", name: firstToolName, content };
        persistQueue.push(getWithTurnId(toolMsg, wo));
      } catch (e) {
        const toolMsg = { role: "tool", name: firstToolName, content: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
        persistQueue.push(getWithTurnId(toolMsg, wo));
        finalUrl = "";
      }
    }
  }

  const finalText = (finalUrl ? (textOut + "\n" + finalUrl) : textOut).trim();

  /***** Persist only PASS 1 (and tool log if you want). Do NOT persist pass 2. *****/
  if (!skipContextWrites) {
    for (const turn of persistQueue) {
      try { await setContext(wo, turn); } catch {}
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
  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: "AI response received."
  });

  return coreData;
}