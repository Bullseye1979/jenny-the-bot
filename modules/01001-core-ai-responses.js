/***************************************************************
/* filename: "core-ai-responses.min.js"                        *
/* Purpose: Minimaler Runner (ohne Tools, ohne temperature)     *
/*  - übernimmt History (system/user/assistant; tool→assistant) *
/*  - baut Systemprompt exakt wie im Original                   *
/*  - sendet nur { model, input, instructions }                 *
/*  - speichert Assistant-Output via setContext                 *
/*  - NEU: Bildausgabe (base64 oder Link) → ./pub/documents     *
/*        + neuer Link via wo.baseUrl                           *
/***************************************************************/

import { getContext, setContext } from "../core/context.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* ---------------- Small utils ---------------- */
const toStr = (v) => (typeof v === "string" ? v : (v == null ? "" : String(v)));
const getStr = (v, d) => (typeof v === "string" && v.length ? v : d);
function getWithTurnId(rec, wo) { const t = (typeof wo?.turn_id === "string" && wo.turn_id) ? wo.turn_id : undefined; return t ? { ...rec, turn_id: t } : rec; }

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
/* History → Responses `input`                                 *
/*  - role:"tool" → "assistant" (ohne tool-Felder)             *
/***************************************************************/
function toResponsesInput(messages) {
  return messages.map((m) => {
    const role = (m.role === "tool") ? "assistant" : m.role;
    const type = (role === "assistant") ? "output_text" : "input_text";
    const text = toStr(m.content ?? "");
    return { role, content: [{ type, text }] };
  });
}

/***************************************************************
/* Download/Save helpers for images                            *
/***************************************************************/
const DOC_DIR = path.resolve("./pub/documents");
function ensureDir(p = DOC_DIR) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function extFromMime(mime) {
  if (!mime) return ".png";
  const m = mime.toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("bmp")) return ".bmp";
  if (m.includes("svg")) return ".svg";
  return ".png";
}

function parseDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1] || "image/png";
  const isB64 = !!m[2];
  const data = m[3] || "";
  return { mime, isB64, data };
}

async function saveBase64Image(b64, mime, baseUrl) {
  ensureDir();
  const ext = extFromMime(mime);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(DOC_DIR, filename);
  const buf = Buffer.from(b64, "base64");
  fs.writeFileSync(filePath, buf);
  return `${baseUrl.replace(/\/+$/,"")}/documents/${filename}`;
}

async function downloadToLocal(url, baseUrl) {
  ensureDir();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const mime = res.headers.get("content-type") || "image/png";
  const ext = extFromMime(mime);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(DOC_DIR, filename);
  const arrayBuf = await res.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuf));
  return `${baseUrl.replace(/\/+$/,"")}/documents/${filename}`;
}

/***************************************************************
/* Responses-Normalisierung + Image-Extraktion                 *
/***************************************************************/
function extractImagesFromResponses(raw) {
  // Liefert Array von { kind: "b64", b64, mime } oder { kind: "url", url }
  const items = [];
  const output = Array.isArray(raw?.output) ? raw.output : [];

  for (const part of output) {
    const t = part?.type;

    // 1) output_image / image mit image_url.url
    const url1 = part?.image_url?.url || part?.image_url || part?.url;
    if ((t === "output_image" || t === "image" || t === "image_url") && typeof url1 === "string" && /^https?:\/\//i.test(url1)) {
      items.push({ kind: "url", url: url1 });
    }

    // 2) Base64-Varianten (ähnlich DALL·E: b64_json oder data.b64_json)
    const b64a = part?.b64_json;
    const b64b = part?.data?.b64_json;
    const dataUrl = part?.data_url || part?.image_base64 || part?.image_data_url;

    if (typeof b64a === "string" && b64a.length) items.push({ kind: "b64", b64: b64a, mime: part?.mime || "image/png" });
    if (typeof b64b === "string" && b64b.length) items.push({ kind: "b64", b64: b64b, mime: part?.mime || "image/png" });

    // 3) Falls ein data URL geliefert wurde
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const parsed = parseDataUrl(dataUrl);
      if (parsed && parsed.isB64) items.push({ kind: "b64", b64: parsed.data, mime: parsed.mime || "image/png" });
    }

    // 4) message-container mit content array
    if (t === "message" && Array.isArray(part?.content)) {
      for (const c of part.content) {
        const ct = c?.type;
        const curl = c?.image_url?.url || c?.image_url || c?.url;
        if ((ct === "image" || ct === "image_url" || ct === "output_image") && typeof curl === "string" && /^https?:\/\//i.test(curl)) {
          items.push({ kind: "url", url: curl });
        }
        const cb64a = c?.b64_json || c?.data?.b64_json;
        if (typeof cb64a === "string" && cb64a.length) items.push({ kind: "b64", b64: cb64a, mime: c?.mime || "image/png" });
        const cdataUrl = c?.data_url || c?.image_base64 || c?.image_data_url;
        if (typeof cdataUrl === "string" && cdataUrl.startsWith("data:")) {
          const parsed2 = parseDataUrl(cdataUrl);
          if (parsed2 && parsed2.isB64) items.push({ kind: "b64", b64: parsed2.data, mime: parsed2.mime || "image/png" });
        }
      }
    }
  }
  return items;
}

function normalizeAiText(raw) {
  // Reiner Text aus Responses
  if (Array.isArray(raw?.output)) {
    let assistantText = "";
    for (const part of raw.output) {
      const t = part?.type;
      if (t === "output_text" && typeof part.text === "string") assistantText += part.text;
      if (t === "message" && Array.isArray(part.content)) {
        for (const c of part.content) {
          if (c?.type === "output_text" && typeof c.text === "string") assistantText += c.text;
        }
      }
    }
    return (assistantText || "").trim();
  }
  // Fallbacks
  const choice = raw?.choices?.[0];
  if (choice?.message?.content) return String(choice.message.content).trim();
  if (typeof raw?.output_text === "string") return raw.output_text.trim();
  return "";
}

/***************************************************************
/* Früh-Exit bei reiner Begrüßung (ohne API-Call)              *
/***************************************************************/
function isJustGreeting(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  return /^(hi|hallo|hey|servus|moin|yo|ciao|guten\s(?:morgen|tag|abend))!?$/i.test(t);
}

/***************************************************************
/* MAIN                                                        *
/***************************************************************/
export default async function getCoreAi(coreData) {
  const wo = coreData?.workingObject ?? {};
  if (!Array.isArray(wo.logging)) wo.logging = [];

  const gate = String(wo?.useAIModule ?? wo?.UseAIModule ?? "").trim().toLowerCase();
  if (gate && gate !== "responses") {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: "core-ai-responses-min", exitStatus: "skipped", message: `Skipped: useAIModule="${gate}" != "responses"` });
    return coreData;
  }

  const endpoint = getStr(wo?.EndpointResponses, "");
  const apiKey   = getStr(wo?.APIKey, "");
  const model    = getStr(wo?.Model, "");
  const baseUrl  = getStr(wo?.baseUrl, "");

  if (!endpoint || !apiKey || !model) {
    wo.Response = "[Empty AI response]";
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "error", module: "core-ai-responses-min", exitStatus: "failed", message: `Missing required config: ${!endpoint ? "EndpointResponses " : ""}${!apiKey ? "APIKey " : ""}${!model ? "Model" : ""}`.trim() });
    return coreData;
  }
  if (!baseUrl) {
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: "core-ai-responses-min", exitStatus: "success", message: "baseUrl is empty – image links cannot be formed." });
  }

  const userPayloadRaw = toStr(wo?.payload ?? "");

  // Reine Grüße lokal beantworten
  if (isJustGreeting(userPayloadRaw)) {
    const reply = "Hi! Wie kann ich dir helfen?";
    wo.Response = reply;
    try { await setContext(wo, getWithTurnId({ role: "assistant", content: reply }, wo)); } catch {}
    return coreData;
  }

  // History laden
  let snapshot = [];
  try { snapshot = await getContext(wo); }
  catch (e) { wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: "core-ai-responses-min", exitStatus: "success", message: `getContext failed; continuing: ${e?.message || String(e)}` }); }

  // Systemprompt exakt wie im Original
  const systemContent = getSystemContent(wo);

  // Minimales Chat-Array inkl. system
  const messages = [
    { role: "system", content: systemContent },
    ...((Array.isArray(snapshot) ? snapshot : []).map((m) => {
      const role = m?.role;
      if (role === "system") return { role: "system", content: toStr(m.content ?? "") };
      if (role === "user") return { role: "user", content: toStr(m.content ?? "") };
      if (role === "assistant") return { role: "assistant", content: toStr(m.content ?? "") };
      if (role === "tool") return { role: "assistant", content: toStr(m.content ?? "") }; // tool→assistant
      return null;
    }).filter(Boolean)),
    ...(userPayloadRaw ? [{ role: "user", content: userPayloadRaw }] : [])
  ];

  // Nur das Nötigste (kein temperature, keine tools)
  const body = { model, input: toResponsesInput(messages), instructions: systemContent };

  // Request
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(wo?.RequestTimeoutMs) ? Number(wo.RequestTimeoutMs) : 120000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);

    const rawText = await res.text();
    if (!res.ok) {
      wo.Response = "[Empty AI response]";
      wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: "core-ai-responses-min", exitStatus: "failed", message: `HTTP ${res.status} ${res.statusText} ${typeof rawText === "string" ? rawText.slice(0, 300) : ""}` });
      return coreData;
    }

    const data = (() => { try { return JSON.parse(rawText); } catch { return null; } })() || {};
    const textOut = normalizeAiText(data);

    // --- Bildausgabe verarbeiten ---
    const imageItems = extractImagesFromResponses(data);
    const hostedLinks = [];

    if (baseUrl && imageItems.length) {
      for (const it of imageItems) {
        try {
          if (it.kind === "b64") {
            const link = await saveBase64Image(it.b64, it.mime || "image/png", baseUrl);
            hostedLinks.push(link);
          } else if (it.kind === "url" && typeof it.url === "string") {
            const link = await downloadToLocal(it.url, baseUrl);
            hostedLinks.push(link);
          }
        } catch (e) {
          wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: "core-ai-responses-min", exitStatus: "success", message: `Image persist failed: ${e?.message || String(e)}` });
        }
      }
    }

    // Finaltext + Links anhängen (so lieferst du explizit die neuen Links)
    let reply = textOut || "";
    if (hostedLinks.length) {
      const lines = hostedLinks.map((u) => `- ${u}`).join("\n");
      reply = reply
        ? `${reply}\n\n[images]\n${lines}`
        : `[images]\n${lines}`;
    }
    if (!reply) reply = "[Empty AI response]";

    // Persist assistant output
    try { await setContext(wo, getWithTurnId({ role: "assistant", content: reply }, wo)); } catch (e) {
      wo.logging.push({ timestamp: new Date().toISOString(), severity: "warn", module: "core-ai-responses-min", exitStatus: "success", message: `Persist failed (assistant): ${e?.message || String(e)}` });
    }

    wo.Response = reply;
    wo.logging.push({ timestamp: new Date().toISOString(), severity: "info", module: "core-ai-responses-min", exitStatus: "success", message: `AI response received${hostedLinks.length ? `; images: ${hostedLinks.length}` : ""}.` });
    return coreData;

  } catch (err) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError" || String(err?.type).toLowerCase() === "aborted";
    wo.Response = "[Empty AI response]";
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: isAbort ? "warn" : "error",
      module: "core-ai-responses-min",
      exitStatus: "failed",
      message: isAbort ? `AI request timed out after ${timeoutMs} ms (AbortError).` : `AI request failed: ${err?.message || String(err)}`
    });
    return coreData;
  }
}
