/******************************************************************************* 
/* filename: "core-ai-imagecompose.js"                                         *
/* Version 1.1                                                                 *
/* Purpose: Generates ONE text response that may contain ONE image placeholder *
/*          in curly braces: { ... }.                                          *
/*          Then ALWAYS calls ONLY the FIRST tool in Tools[] with:             *
/*          { "prompt": "<placeholder text>" }                                 *
/*          and replaces the placeholder with the returned URL (plain URL).    *
/* Notes:                                                                      *
/*          - No tool selection, no pseudo toolcalls, no multi-step logic.     *
/*          - Only 1 image supported.                                          *
/*******************************************************************************/
/******************************************************************************* 
/*                                                                             *
/*******************************************************************************/

import { getContext, setContext } from "../core/context.js";

const MODULE_NAME = "core-ai-imagecompose";

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
  return v === "imagecompose" || v === "core-ai-imagecompose";
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
    toolsList: Array.isArray(wo?.Tools) ? wo.Tools : []
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
/* functionSignature: getExtractFirstBracePrompt (text)                        *
/* Extracts first { ... } placeholder. Returns { before, prompt, after } or    *
/* null if not found. Supports escaping \{ and \}.                             *
/*******************************************************************************/
function getExtractFirstBracePrompt(text) {
  const s = String(text ?? "");
  let i = 0;
  let before = "";
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\" && i + 1 < s.length) {
      const nx = s[i + 1];
      if (nx === "{" || nx === "}") {
        before += nx;
        i += 2;
        continue;
      }
    }

    if (ch === "{") break;
    before += ch;
    i += 1;
  }

  if (i >= s.length || s[i] !== "{") return null;
  i += 1;

  let prompt = "";
  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\" && i + 1 < s.length) {
      const nx = s[i + 1];
      if (nx === "{" || nx === "}") {
        prompt += nx;
        i += 2;
        continue;
      }
    }

    if (ch === "}") {
      const after = s.slice(i + 1);
      return { before, prompt: prompt.trim(), after };
    }

    prompt += ch;
    i += 1;
  }

  return null;
}

/******************************************************************************* 
/* functionSignature: getExtractUrlFromToolResult (toolResult)                 *
/* Tries to find a URL inside tool result (string or json).                    *
/*******************************************************************************/
function getExtractUrlFromToolResult(toolResult) {
  const s = typeof toolResult === "string" ? toolResult.trim() : "";
  if (s && (/^https?:\/\//i.test(s) || /^data:image\//i.test(s))) return s;

  const parsed = (typeof toolResult === "string") ? getTryParseJSON(toolResult, null) : toolResult;
  const seen = new Set();
  let found = "";

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
    if (depth > 6) return;
    if (v == null) return;
    if (typeof v === "string") { add(v); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    if (typeof v !== "object") return;

    const directKeys = ["url", "imageUrl", "image_url", "href", "link", "image", "output", "result", "data"];
    for (const k of directKeys) {
      if (Object.prototype.hasOwnProperty.call(v, k)) scan(v[k], depth + 1);
      if (found) return;
    }

    for (const [k, val] of Object.entries(v)) {
      if (found) return;
      if (typeof k === "string" && /url|link|href|image/i.test(k)) scan(val, depth + 1);
    }
  };

  if (parsed && typeof parsed === "object") scan(parsed, 0);
  return found;
}

/******************************************************************************* 
/* functionSignature: getSystemContent (wo)                                    *
/* Produces system content for { ... } placeholders.                           *
/*******************************************************************************/
function getSystemContent(wo) {
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Persona === "string" ? wo.Persona.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
  ].filter(Boolean).join("\n\n");

  const contract = [
    "Image placeholder contract:",
    "- Write normal plain text.",
    "- If you want an image generated, put the image prompt inside curly braces like {a cat on a skateboard}.",
    "- Use at most ONE placeholder per response.",
    "- Do NOT output any tool call syntax or JSON. Curly braces are placeholders only."
  ].join("\n");

  return [base, contract].filter(Boolean).join("\n\n");
}

/******************************************************************************* 
/* functionSignature: getCoreAi (coreData)                                     *
/* Single model call -> optional single image generation -> compose -> persist. *
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

  let snapshot = [];
  try { snapshot = await getContext(wo); } catch {}

  const messagesFromHistory = getPromptFromSnapshot(snapshot, kiCfg.includeHistory);
  const systemContent = getSystemContent(wo);

  const messages = [
    { role: "system", content: systemContent },
    ...messagesFromHistory,
    { role: "user", content: userPromptRaw }
  ];

  const persistQueue = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), kiCfg.requestTimeoutMs);

  let modelText = "";
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
    const msg = choice?.message || {};
    modelText = typeof msg.content === "string" ? msg.content : "";
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

  const parsed = getExtractFirstBracePrompt(modelText);
  let finalText = String(modelText || "").trim();

  const toolsList = Array.isArray(kiCfg.toolsList) ? kiCfg.toolsList : [];
  const firstToolName = toolsList.length ? String(toolsList[0] ?? "").trim() : "";

  if (parsed && parsed.prompt && firstToolName) {
    const tool = await getToolByName(firstToolName, wo);

    if (tool) {
      try {
        const result = await tool.invoke({ prompt: parsed.prompt }, coreData);
        const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
        const url = getExtractUrlFromToolResult(content);

        const toolMsg = { role: "tool", name: firstToolName, content };
        persistQueue.push(getWithTurnId(toolMsg, wo));

        if (url) {
          finalText = (parsed.before + url + parsed.after).trim();
        } else {
          finalText = (parsed.before + "[image_missing]" + parsed.after).trim();
        }
      } catch (e) {
        const toolMsg = { role: "tool", name: firstToolName, content: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
        persistQueue.push(getWithTurnId(toolMsg, wo));
        finalText = (parsed.before + "[image_error]" + parsed.after).trim();
      }
    } else {
      finalText = (parsed.before + "[image_tool_missing]" + parsed.after).trim();
    }
  } else if (parsed && parsed.prompt && !firstToolName) {
    finalText = (parsed.before + "[no_image_tool]" + parsed.after).trim();
  }

  const assistantFinal = { role: "assistant", authorName: getAssistantAuthorName(wo), content: finalText };
  if (assistantFinal.authorName == null) delete assistantFinal.authorName;

  persistQueue.push(getWithTurnId(assistantFinal, wo));

  if (!skipContextWrites) {
    for (const turn of persistQueue) {
      try { await setContext(wo, turn); } catch {}
    }
  }

  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: MODULE_NAME, exitStatus: "success", message: "AI response received." });
  return coreData;
}