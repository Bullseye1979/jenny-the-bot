/***************************************************************
/* filename: "core-ai-responses.js"                            *
/* Purpose: Responses Runner (GPT-5) mit Context-Übersetzer     *
/*  - DB-Kontext (json/text/role) → Responses input             *
/*  - Systemprompt wie im Original                              *
/*  - Tools: image_generation (Model) + generische Function-Tools*
/*  - Bildausgabe speichern/spiegeln → ./pub/documents + baseUrl *
/*  - Loop bis finalem Text                                     *
/*  - KEIN temperature                                          *
/***************************************************************/

import { getContext, setContext } from "../core/context.js";
import { putItem } from "../core/registry.js"; // optional status Anzeige
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* ---------------- Small utils ---------------- */
const toStr = (v) => (typeof v === "string" ? v : (v == null ? "" : String(v)));
const getStr = (v, d) => (typeof v === "string" && v.length ? v : d);
const getNum = (v, d) => (Number.isFinite(v) ? Number(v) : d);
const getJSON = (t, f = null) => { try { return JSON.parse(t); } catch { return f; } };
const ARG_PREVIEW_MAX = 400;
const RESULT_PREVIEW_MAX = 400;
const MODULE_NAME = "core-ai-responses";
function getWithTurnId(rec, wo) { const t = (typeof wo?.turn_id === "string" && wo.turn_id) ? wo.turn_id : undefined; return t ? { ...rec, turn_id: t } : rec; }
function getPreview(s, n=400){ const t=toStr(s); return t.length>n? t.slice(0,n)+" …[truncated]" : t; }

/***************************************************************
/* System content (EXAKT wie im Original aufgebaut)            *
/***************************************************************/
function getSystemContent(wo) {
  const now = new Date();
  const tz = getStr(wo?.timezone, "Europe/Berlin");
  const nowIso = now.toISOString();
  const base = [
    typeof wo.SystemPrompt === "string" ? wo.SystemPrompt.trim() : "",
    typeof wo.Instructions === "string" ? wo.Instructions.trim() : ""
  ].filter(Boolean).join("\n\n");
  const runtimeInfo = [
    "Runtime info:",
    `- current_time_iso: ${nowIso}`,
    `- timezone_hint: ${tz}`,
    "- When the user says “today”, “tomorrow”, or uses relative terms, interpret them relative to current_time_iso unless the user gives another explicit reference time.",
    "- If you generate calendar-ish text, prefer explicit dates (YYYY-MM-DD) when it helps the user."
  ].join("\n");
  const policy = [
    "Policy:",
    "- NEVER ANSWER TO OLDER USER REQUESTS",
    "- Use tools only when necessary.",
    "- When you emit a tool call, do not include extra prose in the same turn."
  ].join("\n");

  const parts = [];
  if (base) parts.push(base);
  parts.push(runtimeInfo);
  parts.push(policy);
  return parts.filter(Boolean).join("\n\n");
}

/***************************************************************
/* DB → Chat-Messages (bevorzugt JSON, dann content/text)      *
/***************************************************************/
function pickPayload(row){
  if (typeof row?.json === "string" && row.json.length) return row.json;
  if (typeof row?.content === "string" && row.content.length) return row.content;
  if (typeof row?.text === "string" && row.text.length) return row.text;
  return "";
}
function mapSnapshotToChat(rows){
  const out = [];
  for (const r of rows || []) {
    const role = r?.role;
    const payload = pickPayload(r);
    if (role === "system")    out.push({ role: "system",    content: payload });
    else if (role === "user") out.push({ role: "user",      content: payload });
    else if (role === "assistant") out.push({ role: "assistant", content: payload });
    else if (role === "tool") out.push({ role: "assistant", content: payload }); // tool→assistant (ohne tool_fields)
  }
  return out;
}

/***************************************************************
/* Chat → Responses `input` (TEXT ONLY)                        *
/*  - NIE tool_calls im input; role:"tool" → "assistant"       *
/***************************************************************/
function toResponsesInput(messages) {
  return messages.map(m => {
    const role = (m.role === "tool") ? "assistant" : m.role;
    const type = (role === "assistant") ? "output_text" : "input_text";
    const text = toStr(m.content ?? "");
    return { role, content: [{ type, text }] };
  });
}

/***************************************************************
/* Tool-Defs: Chat→Responses Flatten                           *
/*  Chat: {type:"function", function:{name,description,parameters}}
/*  Resp: {type:"function", name, description, parameters}      *
/***************************************************************/
function normalizeToolDefs(toolsLike){
  if (!Array.isArray(toolsLike)) return [];
  const out = [];
  for (const d of toolsLike) {
    if (!d) continue;
    if (d.type === "function" && d.name) { out.push(d); continue; }
    if (d.type === "function" && d.function?.name) {
      out.push({
        type: "function",
        name: d.function.name,
        description: d.function.description || "",
        parameters: d.function.parameters || { type:"object", properties:{} }
      });
    }
  }
  return out;
}
function normalizeToolChoice(tc){
  if (!tc || tc === "auto" || tc === "none") return tc || "auto";
  if (tc?.type === "function" && tc?.name) return tc;
  if (tc?.type === "function" && tc?.function?.name) return { type:"function", name: tc.function.name };
  return "auto";
}

/***************************************************************
/* Dynamic tool loader & executor (generische Tools)           *
/***************************************************************/
async function getToolsByName(names, wo) {
  const loaded = [];
  for (const name of names || []) {
    try {
      const mod = await import(`../tools/${name}.js`);
      const tool = mod?.default ?? mod;
      if (tool && typeof tool.invoke === "function") loaded.push(tool);
      else wo.logging?.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"success", message:`Tool "${name}" invalid (missing invoke); skipped.` });
    } catch (e) {
      wo.logging?.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"success", message:`Tool "${name}" load failed: ${e?.message || String(e)}` });
    }
  }
  return loaded;
}
async function execGenericTool(toolModules, call, coreData){
  const wo = coreData?.workingObject ?? {};
  const name = call?.function?.name || call?.name;
  const argsRaw = call?.function?.arguments ?? call?.arguments ?? "{}";
  const args = typeof argsRaw === "string" ? getJSON(argsRaw, {}) : (argsRaw || {});
  const tool = toolModules.find(t => (t.definition?.function?.name || t.definition?.name || t.name) === name);

  wo.logging?.push({ timestamp:new Date().toISOString(), severity:"info", module:MODULE_NAME, exitStatus:"started",
    message:"Tool call start", details:{ tool:name, args_preview:getPreview(args, ARG_PREVIEW_MAX) } });

  if (!tool) {
    const err = { error:`Tool "${name}" not found` };
    return { ok:false, name, content: JSON.stringify(err) };
  }
  try {
    try { await putItem(name, "status:tool"); } catch {}
    const res = await tool.invoke(args, coreData);
    const content = typeof res === "string" ? res : JSON.stringify(res ?? null);
    wo.logging?.push({ timestamp:new Date().toISOString(), severity:"info", module:MODULE_NAME, exitStatus:"success", message:"Tool call success", details:{ tool:name, result_preview:getPreview(content, RESULT_PREVIEW_MAX) } });
    return { ok:true, name, content };
  } catch(e){
    wo.logging?.push({ timestamp:new Date().toISOString(), severity:"error", module:MODULE_NAME, exitStatus:"failed", message:"Tool call error", details:{ tool:name, error:String(e?.message||e) }});
    return { ok:false, name, content: JSON.stringify({ error: e?.message || String(e) }) };
  } finally {
    const delayMs = Number.isFinite(coreData?.workingObject?.StatusToolClearDelayMs) ? Number(coreData.workingObject.StatusToolClearDelayMs) : 800;
    setTimeout(()=>{ try{ putItem("", "status:tool"); }catch{} }, Math.max(0, delayMs));
  }
}

/***************************************************************
/* Bildspeicher / URL-Spiegel                                  *
/***************************************************************/
const DOC_DIR = path.resolve("./pub/documents");
function ensureDir(){ if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive:true }); }
function extFromMime(m) {
  const mime = (m||"").toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg")||mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("bmp")) return ".bmp";
  if (mime.includes("svg")) return ".svg";
  return ".png";
}
async function saveB64(b64, mime, baseUrl){
  ensureDir();
  const ext = extFromMime(mime||"image/png");
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(DOC_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return `${baseUrl.replace(/\/+$/,"")}/documents/${filename}`;
}
async function mirrorURL(url, baseUrl){
  ensureDir();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const mime = res.headers.get("content-type") || "image/png";
  const ext = extFromMime(mime);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(DOC_DIR, filename);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return `${baseUrl.replace(/\/+$/,"")}/documents/${filename}`;
}

/***************************************************************
/* Responses-Auswertung                                        *
/*  - Text aggregieren                                         *
/*  - tool_calls sammeln (function / image_generation)         *
/*  - Bilder extrahieren (b64/url)                             *
/***************************************************************/
function parseResponsesOutput(raw){
  const out = { text:"", toolCalls:[], images:[] };
  const arr = Array.isArray(raw?.output) ? raw.output : [];

  for (const part of arr) {
    const t = part?.type;

    // Textteile
    if (t === "output_text" && typeof part?.text === "string") out.text += part.text;

    // Message-Container
    if (t === "message" && Array.isArray(part?.content)) {
      for (const c of part.content) {
        if (c?.type === "output_text" && typeof c?.text === "string") out.text += c.text;
        // evtl. Bildteile innerhalb message
        const curl = c?.image_url?.url || c?.image_url || c?.url;
        if ((c?.type === "image" || c?.type === "image_url" || c?.type === "output_image") && typeof curl === "string" && /^https?:\/\//i.test(curl)) {
          out.images.push({ kind:"url", url: curl });
        }
        const cb64 = c?.b64_json || c?.data?.b64_json;
        if (typeof cb64 === "string" && cb64.length) out.images.push({ kind:"b64", b64: cb64, mime: c?.mime || "image/png" });
      }
    }

    // Images (Top-Level)
    const url1 = part?.image_url?.url || part?.image_url || part?.url;
    if ((t === "image" || t === "image_url" || t === "output_image") && typeof url1 === "string" && /^https?:\/\//i.test(url1)) {
      out.images.push({ kind:"url", url: url1 });
    }
    const b64a = part?.b64_json || part?.data?.b64_json;
    if (typeof b64a === "string" && b64a.length) out.images.push({ kind:"b64", b64: b64a, mime: part?.mime || "image/png" });

    // Tool-Calls (function + image_generation)
    if (t === "tool_call" || t === "function_call") {
      out.toolCalls.push({
        id: part?.id || part?.call_id,
        type: part?.type,
        name: part?.name || part?.function?.name,
        arguments: typeof part?.arguments === "string"
          ? part.arguments
          : (part?.function?.arguments ?? JSON.stringify(part?.function?.arguments ?? {}))
      });
    }
  }
  out.text = out.text.trim();
  return out;
}

/***************************************************************
/* MAIN                                                        *
/***************************************************************/
export default async function getCoreAi(coreData){
  const wo = coreData?.workingObject ?? {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const gate = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  if (gate && gate !== "responses") {
    wo.logging.push({ timestamp:new Date().toISOString(), severity:"info", module:MODULE_NAME, exitStatus:"skipped", message:`Skipped: useAIModule="${gate}" != "responses"` });
    return coreData;
  }

  const endpoint = getStr(wo?.EndpointResponses, "");
  const apiKey   = getStr(wo?.APIKey, "");
  const model    = getStr(wo?.Model, "");
  const baseUrl  = getStr(wo?.baseUrl, "");
  const maxTokens = getNum(wo?.MaxTokens, 2000);
  const maxLoops  = getNum(wo?.MaxLoops, 16);
  const maxToolCalls = getNum(wo?.MaxToolCalls, 8);
  const timeoutMs = getNum(wo?.RequestTimeoutMs, 120000);

  if (!endpoint || !apiKey || !model) {
    wo.Response = "[Empty AI response]";
    wo.logging.push({ timestamp:new Date().toISOString(), severity:"error", module:MODULE_NAME, exitStatus:"failed", message:`Missing required: ${!endpoint?"EndpointResponses ":""}${!apiKey?"APIKey ":""}${!model?"Model":""}`.trim() });
    return coreData;
  }

  // Kontext laden & übersetzen
  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch(e){ wo.logging.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"success", message:`getContext failed; continuing: ${e?.message || String(e)}` }); }
  const sys = getSystemContent(wo);
  const fromDb = mapSnapshotToChat(Array.isArray(snapshot)? snapshot : []);
  const userPayloadRaw = toStr(wo?.payload ?? "");

  // Chat-Array inkl. system + aktueller Prompt
  let messages = [
    { role:"system", content: sys },
    ...fromDb,
    ...(userPayloadRaw ? [{ role:"user", content:userPayloadRaw }] : [])
  ];

  // Tools: image_generation (immer), plus generische Tools (optional)
  const toolNames = Array.isArray(wo?.Tools) ? wo.Tools : [];
  const genericTools = await getToolsByName(toolNames, wo);
  const toolDefs = normalizeToolDefs(genericTools.map(t => t.definition).filter(Boolean));
  const toolsForResponses = [{ type:"image_generation" }, ...toolDefs];
  const toolChoice = normalizeToolChoice(wo?.ToolChoice) || "auto";

  const persistQueue = [];
  let finalText = "";
  let totalToolCalls = 0;

  for (let iter = 0; iter < maxLoops; iter++){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), timeoutMs);

    try {
      const body = {
        model,
        input: toResponsesInput(messages),
        instructions: sys,
        tools: toolsForResponses,
        tool_choice: toolChoice,
        ...(maxTokens ? { max_output_tokens: maxTokens } : {})
      };

      const res = await fetch(endpoint, {
        method:"POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);

      const rawText = await res.text();
      if (!res.ok) {
        wo.Response = "[Empty AI response]";
        wo.logging.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"failed", message:`HTTP ${res.status} ${res.statusText} ${rawText.slice(0,300)}` });
        return coreData;
      }

      const data = getJSON(rawText, {});
      const parsed = parseResponsesOutput(data);

      // Model-Bilder direkt verarbeiten (Base64/URL → speichern/spiegeln)
      const hostedLinks = [];
      if (baseUrl && parsed.images.length) {
        for (const it of parsed.images) {
          try {
            if (it.kind === "b64") hostedLinks.push(await saveB64(it.b64, it.mime || "image/png", baseUrl));
            else if (it.kind === "url") hostedLinks.push(await mirrorURL(it.url, baseUrl));
          } catch(e){
            wo.logging.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"success", message:`Image persist failed: ${e?.message || String(e)}` });
          }
        }
      }

      // Toolcalls auswerten
      const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
      const hasToolCalls = toolCalls.length > 0;

      // Persist assistant-Text (ohne tool_fields)
      const assistantMsg = { role:"assistant", content: (parsed.text || "").trim() };
      if (assistantMsg.content) {
        messages.push(assistantMsg);
        persistQueue.push(getWithTurnId(assistantMsg, wo));
      }

      // Wenn Bilder erzeugt wurden: Links in Assistant-Turn anhängen & persistieren
      if (hostedLinks.length) {
        const linkBlock = `[images]\n${hostedLinks.map(u=>`- ${u}`).join("\n")}`;
        const imgMsg = { role:"assistant", content: linkBlock };
        messages.push(imgMsg);
        persistQueue.push(getWithTurnId(imgMsg, wo));
      }

      // Generische Tools ausführen
      if (hasToolCalls && genericTools.length && totalToolCalls < maxToolCalls) {
        for (const tc of toolCalls) {
          const isGeneric = toolDefs.some(d => d?.name === tc?.name);
          const isModelTool = (tc?.name === "image_generation"); // wird vom Provider gehandhabt → Bilder kommen als Parts

          if (isModelTool) {
            // Nichts zu tun: Bilder kamen bereits als Output-Parts und wurden oben gespeichert.
            continue;
          }

          if (isGeneric) {
            if (totalToolCalls >= maxToolCalls) break;
            const result = await execGenericTool(genericTools, tc, coreData);
            totalToolCalls++;

            // Tool-Ergebnis als "assistant"-Turn (ohne tool_fields) zurück in den Fluss
            const toolResultMsg = { role:"assistant", content: toStr(result?.content ?? "") };
            messages.push(toolResultMsg);
            persistQueue.push(getWithTurnId(toolResultMsg, wo));
          }
        }

        // Fortsetzung anstoßen
        const cont = { role:"user", content:"continue" };
        messages.push(cont);
        persistQueue.push(getWithTurnId(cont, wo));
        continue; // nächste Schleifenrunde
      }

      // Keine Toolcalls mehr → finalisieren
      finalText = [
        assistantMsg.content,
        hostedLinks.length ? `[images]\n${hostedLinks.map(u=>`- ${u}`).join("\n")}` : ""
      ].filter(Boolean).join("\n\n");
      break;

    } catch(err){
      clearTimeout(timer);
      const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
      wo.Response = "[Empty AI response]";
      wo.logging.push({ timestamp:new Date().toISOString(), severity:isAbort?"warn":"error", module:MODULE_NAME, exitStatus:"failed",
        message: isAbort ? `AI request timed out after ${timeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}` });
      return coreData;
    }
  }

  // Persist queued turns
  for (const turn of persistQueue) {
    try { await setContext(wo, turn); }
    catch(e){ wo.logging.push({ timestamp:new Date().toISOString(), severity:"warn", module:MODULE_NAME, exitStatus:"success", message:`Persist failed (role=${turn.role}): ${e?.message || String(e)}` }); }
  }

  wo.Response = finalText || "[Empty AI response]";
  wo.logging.push({ timestamp:new Date().toISOString(), severity:"info", module:MODULE_NAME, exitStatus:"success", message:"AI response received." });
  return coreData;
}
