/**************************************************************
/* filename: "getPDF.js"                                      *
/* Version 1.0                                                *
/* Purpose: Toolcall-ready HTML→PDF/HTML generator that saves *
/*          to ../pub/documents, requires CSS, extracts CSS   *
/*          from HTML, and uses toolsconfig.getPDF settings   *
/**************************************************************/
/**************************************************************/
/*                                                            *
/**************************************************************/

import path from "path";
import fs from "fs/promises";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

/**************************************************************
/* functionSignature: logDebug (label, obj)                   *
/* No-op debug helper to disable console output               *
/**************************************************************/
function logDebug(label, obj){}

/**************************************************************
/* functionSignature: normalizeFilename (s, fallback)         *
/* Returns fs-safe lowercased base filename without extension *
/**************************************************************/
function normalizeFilename(s, fallback = ""){
  const base = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || fallback || `document-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

/**************************************************************
/* functionSignature: ensureAbsoluteUrl (publicBaseUrl, path) *
/* Builds absolute URL using publicBaseUrl or returns relative*
/**************************************************************/
function ensureAbsoluteUrl(publicBaseUrl, urlPath){
  const u = String(urlPath || "");
  const base = String(publicBaseUrl || "").replace(/\/$/, "");
  if (/^https?:\/\//i.test(u)) return u;
  if (base) return `${base}${u.startsWith("/") ? "" : "/"}${u}`;
  return u;
}

/**************************************************************
/* functionSignature: extractBody (html)                      *
/* Returns innerHTML of <body> when available                 *
/**************************************************************/
function extractBody(html){
  const s = String(html || "");
  const open = s.toLowerCase().indexOf("<body");
  if (open === -1) return s;
  const gt = s.indexOf(">", open);
  if (gt === -1) return s;
  const close = s.toLowerCase().lastIndexOf("</body>");
  if (close === -1) return s;
  return s.slice(gt + 1, close);
}

/**************************************************************
/* functionSignature: enforcedCss ()                          *
/* Returns enforced CSS string for stable print layout        *
/**************************************************************/
function enforcedCss(){
  return [
    "@page{size:A4;margin:20mm !important}",
    "html,body{margin:0 !important;padding:0 !important}",
    "body{padding:10mm !important}",
    "table, thead, tbody, tr, th, td, figure, img, pre, blockquote{page-break-inside:avoid !important; break-inside:avoid !important}",
    "h1,h2,h3{break-after:avoid !important; page-break-after:auto !important}",
    "img{max-width:100% !important; height:auto !important; display:block !important}"
  ].join("");
}

/**************************************************************
/* functionSignature: buildPrintableHtml (bodyHtml, userCss,  *
/* title)                                                     *
/* Wraps body HTML and CSS into a full printable HTML         *
/**************************************************************/
function buildPrintableHtml(bodyHtml, userCss = "", title = "Document"){
  const cssFinal = `${String(userCss || "")}\n${enforcedCss()}`;
  const safeTitle = String(title || "Document").slice(0, 140);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${cssFinal}</style>
</head>
<body>
${bodyHtml || ""}
</body>
</html>`;
  return { html, cssFinal };
}

/**************************************************************
/* functionSignature: getPlainFromHTML (html, maxLen)         *
/* Returns lightweight plain text extracted from HTML         *
/**************************************************************/
function getPlainFromHTML(html, maxLen = 200000){
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "")
       .replace(/<style[\s\S]*?<\/style>/gi, "")
       .replace(/<[^>]+>/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, maxLen);
}

/**************************************************************
/* functionSignature: extractFence (str, lang)                *
/* Extracts first fenced ```<lang> ... ``` block              *
/**************************************************************/
function extractFence(str, lang){
  const src = String(str || "");
  const startToken = "```" + String(lang || "").toLowerCase();
  const start = src.toLowerCase().indexOf(startToken);
  if (start === -1) return "";
  const after = start + startToken.length;
  let i = after;
  while (i < src.length && (src[i] === " " || src[i] === "\t" || src[i] === "\r" || src[i] === "\n")) i++;
  const end = src.indexOf("```", i);
  if (end === -1) return src.slice(i).trim();
  return src.slice(i, end).trim();
}

/**************************************************************
/* functionSignature: tolerantExtractJsonStringValue (source, *
/* key)                                                       *
/* Extracts a JSON string value for key without regex flags   *
/**************************************************************/
function tolerantExtractJsonStringValue(source, key){
  const s = String(source || "");
  const needle = `"${key}"`;
  const kpos = s.toLowerCase().indexOf(needle.toLowerCase());
  if (kpos === -1) return { value:"", ok:false };
  let i = kpos + needle.length;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== ":") return { value:"", ok:false };
  i++;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== '"') return { value:"", ok:false };
  i++;
  let value = "";
  let ok = false;
  while (i < s.length){
    const ch = s[i++];
    if (ch === "\\"){
      if (i >= s.length){ value += "\\"; break; }
      const esc = s[i++];
      if (esc === "u"){
        const hex = s.slice(i, i+4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)){
          try{ value += String.fromCharCode(parseInt(hex,16)); }catch{ value += "\\u" + hex; }
          i += 4;
        } else {
          value += "\\u";
        }
      } else {
        const map = { n:"\n", r:"\r", t:"\t", b:"\b", f:"\f", '"':'"', "'":"'", "\\":"\\" };
        value += (map[esc] !== undefined) ? map[esc] : esc;
      }
    } else if (ch === '"'){
      ok = true; break;
    } else {
      value += ch;
    }
  }
  return { value, ok };
}

/**************************************************************
/* functionSignature: tolerantParseArgs (input)               *
/* Parses object, raw strings, fenced or JSON-like inputs     *
/**************************************************************/
function tolerantParseArgs(input){
  if (input && typeof input === "object" && !Array.isArray(input)){
    const { html, css, title, filename, raw } = input;
    if (html || css || title || filename){
      return {
        html: String(html || "").trim(),
        css: String(css || "").trim(),
        title: title ? String(title) : "",
        filename: filename ? String(filename) : ""
      };
    }
    if (typeof raw === "string" && raw.trim()){
      return tolerantParseArgs(raw);
    }
  }
  const raw = typeof input === "string" ? input : "";
  const str = String(raw || "").trim();
  if (!str) return { html:"", css:"", title:"", filename:"" };
  if (str[0] === "<"){
    let html = str;
    let css = "";
    const lower = str.toLowerCase();
    let pos = 0;
    while (true){
      const sIdx = lower.indexOf("<style", pos);
      if (sIdx === -1) break;
      const gt = str.indexOf(">", sIdx);
      if (gt === -1) break;
      const eIdx = lower.indexOf("</style>", gt);
      if (eIdx === -1) break;
      css += (css? "\n\n" : "") + str.slice(gt+1, eIdx).trim();
      html = html.slice(0, sIdx) + html.slice(eIdx + 9);
      pos = eIdx + 9;
    }
    return { html: html.trim(), css: css.trim(), title:"", filename:"" };
  }
  try{
    const obj = JSON.parse(str);
    return {
      html: String(obj.html || "").trim(),
      css: String(obj.css || "").trim(),
      title: obj.title ? String(obj.title) : "",
      filename: obj.filename ? String(obj.filename) : ""
    };
  }catch{}
  try{
    let s2 = str;
    if (s2.startsWith("```")) {
      const nl = s2.indexOf("\n");
      if (nl !== -1) s2 = s2.slice(nl+1);
      if (s2.endsWith("```")) s2 = s2.slice(0, -3);
    }
    const obj = JSON.parse(s2);
    return {
      html: String(obj.html || "").trim(),
      css: String(obj.css || "").trim(),
      title: obj.title ? String(obj.title) : "",
      filename: obj.filename ? String(obj.filename) : ""
    };
  }catch{}
  if (str.toLowerCase().includes('"html"')){
    const htmlRec = tolerantExtractJsonStringValue(str, "html");
    const cssRec  = tolerantExtractJsonStringValue(str, "css");
    const titleRec = tolerantExtractJsonStringValue(str, "title");
    const filenameRec = tolerantExtractJsonStringValue(str, "filename");
    if (htmlRec.value){
      let html = htmlRec.value;
      let css = cssRec.value || "";
      if (!css && html.toLowerCase().includes("<style")){
        let lower = html.toLowerCase();
        let pos = 0;
        let collected = "";
        while (true){
          const sIdx = lower.indexOf("<style", pos);
          if (sIdx === -1) break;
          const gt = html.indexOf(">", sIdx);
          if (gt === -1) break;
          const eIdx = lower.indexOf("</style>", gt);
          if (eIdx === -1) break;
          collected += (collected? "\n\n" : "") + html.slice(gt+1, eIdx).trim();
          html = html.slice(0, sIdx) + html.slice(eIdx + 9);
          lower = html.toLowerCase();
          pos = sIdx;
        }
        css = collected;
      }
      return {
        html: String(html).trim(),
        css: String(css).trim(),
        title: String(titleRec.value || "").trim(),
        filename: String(filenameRec.value || "").trim()
      };
    }
  }
  const fencedHtml = extractFence(str, "html");
  const fencedCss  = extractFence(str, "css");
  if (fencedHtml || fencedCss){
    let html = fencedHtml || "";
    let css = fencedCss || "";
    if (!html){
      const L = str.toLowerCase();
      const start = L.indexOf("<html");
      const end = L.lastIndexOf("</html>");
      if (start !== -1 && end !== -1 && end > start) html = str.slice(start, end+7);
    }
    if (!css && html){
      let lower = html.toLowerCase();
      let pos = 0; let collected = "";
      while (true){
        const sIdx = lower.indexOf("<style", pos);
        if (sIdx === -1) break;
        const gt = html.indexOf(">", sIdx);
        if (gt === -1) break;
        const eIdx = lower.indexOf("</style>", gt);
        if (eIdx === -1) break;
        collected += (collected? "\n\n" : "") + html.slice(gt+1, eIdx).trim();
        html = html.slice(0, sIdx) + html.slice(eIdx + 9);
        lower = html.toLowerCase();
        pos = sIdx;
      }
      css = collected;
    }
    return { html: (html||"").trim(), css: String(css||"").trim(), title:"", filename:"" };
  }
  {
    const L = str.toLowerCase();
    const start = L.indexOf("<html");
    const end = L.lastIndexOf("</html>");
    if (start !== -1 && end !== -1 && end > start){
      let html = str.slice(start, end+7);
      let lower = html.toLowerCase();
      let pos = 0; let collected = "";
      while (true){
        const sIdx = lower.indexOf("<style", pos);
        if (sIdx === -1) break;
        const gt = html.indexOf(">", sIdx);
        if (gt === -1) break;
        const eIdx = lower.indexOf("</style>", gt);
        if (eIdx === -1) break;
        collected += (collected? "\n\n" : "") + html.slice(gt+1, eIdx).trim();
        html = html.slice(0, sIdx) + html.slice(eIdx + 9);
        lower = html.toLowerCase();
        pos = sIdx;
      }
      return { html: html.trim(), css: collected.trim(), title:"", filename:"" };
    }
  }
  if (str.indexOf("<") !== -1 && str.indexOf(">") !== -1){
    let html = str;
    let css = "";
    let lower = html.toLowerCase();
    let pos = 0;
    while (true){
      const sIdx = lower.indexOf("<style", pos);
      if (sIdx === -1) break;
      const gt = html.indexOf(">", sIdx);
      if (gt === -1) break;
      const eIdx = lower.indexOf("</style>", gt);
      if (eIdx === -1) break;
      css += (css? "\n\n" : "") + html.slice(gt+1, eIdx).trim();
      html = html.slice(0, sIdx) + html.slice(eIdx + 9);
      lower = html.toLowerCase();
      pos = sIdx;
    }
    return { html: html.trim(), css: css.trim(), title:"", filename:"" };
  }
  return { html: str, css:"", title:"", filename:"" };
}

/**************************************************************
/* functionSignature: generatePdfAndHtml (parsed, cfg)        *
/* Generates files and returns public URLs and metadata        *
/**************************************************************/
async function generatePdfAndHtml(parsed, cfg){
  let browser = null;
  try{
    const htmlIn = String(parsed.html || "").trim();
    const cssIn = String(parsed.css || "");
    const title = String(parsed.title || "");
    const filenameArg = String(parsed.filename || "");
    if (!htmlIn) return { ok:false, error:"PDF_INPUT — Missing 'html' content." };
    const bodyHtml = extractBody(htmlIn);
    const { html: fullHtml, cssFinal } = buildPrintableHtml(bodyHtml, cssIn, title || "Document");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const documentsDir = path.join(__dirname, "..", "pub", "documents");
    await fs.mkdir(documentsDir, { recursive: true });
    const filename = normalizeFilename(filenameArg, "");
    const baseName = filename || normalizeFilename(title, "") || normalizeFilename("document");
    const pdfPath = path.join(documentsDir, `${baseName}.pdf`);
    const htmlPath = path.join(documentsDir, `${baseName}.html`);
    await fs.writeFile(htmlPath, fullHtml, "utf8");
    const headless = (cfg?.headless ?? "new");
    const chromeArgs = Array.isArray(cfg?.chromeArgs) ? cfg.chromeArgs : ["--no-sandbox"];
    const waitUntil = (cfg?.waitUntil ?? "networkidle0");
    const timeoutMs = Number.isFinite(cfg?.timeoutMs) ? cfg.timeoutMs : 120000;
    browser = await puppeteer.launch({ headless, args: chromeArgs });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil, timeout: timeoutMs });
    await page.pdf({
      path: pdfPath,
      format: String(cfg?.format || "A4"),
      printBackground: (cfg?.printBackground ?? true),
      margin: { top: "0", right: "0", bottom: "0", left: "0" }
    });
    const publicPdf = ensureAbsoluteUrl(cfg?.publicBaseUrl, `/documents/${path.basename(pdfPath)}`);
    const publicHtml = ensureAbsoluteUrl(cfg?.publicBaseUrl, `/documents/${path.basename(htmlPath)}`);
    const plainText = getPlainFromHTML(bodyHtml, 200000);
    return {
      ok: true,
      pdf: publicPdf,
      html: publicHtml,
      css: cssFinal,
      text: bodyHtml,
      filename: baseName
    };
  }catch(err){
    logDebug("UNEXPECTED", String(err?.stack || err));
    return { ok:false, error:"PDF_UNEXPECTED — Could not generate PDF/HTML." };
  }finally{
    try{ await browser?.close(); }catch{}
  }
}

/**************************************************************
/* functionSignature: getInvoke (args, coreData)              *
/* Toolcall entrypoint: parses, validates, renders PDF/HTML   *
/**************************************************************/
const MODULE_NAME = "getPDF";
async function getInvoke(args, coreData){
  try{
    const cfg = coreData?.workingObject?.toolsconfig?.getPDF || {};
    const payload = args?.json ?? args ?? {};
    const parsedInput = (payload.html || payload.css || payload.title || payload.filename)
      ? payload
      : (payload.raw ?? payload);
    const parsed = tolerantParseArgs(parsedInput);
    if (!parsed.css || !String(parsed.css).trim()){
      return { ok:false, error:"PDF_INPUT — Missing 'css' styles (provide via `css` param or <style>…</style> in HTML)." };
    }
    const result = await generatePdfAndHtml({
      html: parsed.html,
      css: parsed.css,
      title: payload.title ?? parsed.title,
      filename: payload.filename ?? parsed.filename
    }, cfg);
    return result;
  }catch(e){
    logDebug("TOOLCALL_INVOKE_ERROR", String(e?.stack || e));
    return { ok:false, error:"PDF_TOOLCALL_INVOKE — Unexpected error." };
  }
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description:
        "Generate a print-hardened A4 PDF and a matching HTML file from tolerant HTML input. CSS is REQUIRED. Accepts object fields or a raw string (fenced ```json / ```html / ```css, full <html>…</html>, body-only HTML). Saves both to ../pub/documents. Returns { ok, pdf, html, css, text, filename }. Always show the html-URL (html) and the PDF-URL (pdf).  IMPORTANT: Elements that are included in the PDF (e.g. images) need to be generated before this tool is called.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          html: { type: "string", description: "HTML content (full document or body-only). May include <style> blocks; they will be extracted into `css`." },
          css: { type: "string", description: "REQUIRED additional CSS to apply (or provide <style> inside HTML)." },
          title: { type: "string", description: "Optional document title (used in HTML <title>)." },
          filename: { type: "string", description: "Optional base filename without extension (normalized)." },
          raw: { type: "string", description: "Alternative free-form input (fenced JSON/HTML, unterminated JSON strings, etc.)." }
        },
        required: ["css"]
      }
    }
  },
  invoke: getInvoke
};
