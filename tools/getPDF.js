/**********************************************************************************/
/* filename: getPDF.js                                                             *
/* Version 1.0                                                                     *
/* Purpose: Generates a print-ready A4 PDF and matching HTML file from HTML/CSS   *
/*          input. Saves both files to pub/documents/ and returns public URLs.    *
/*          Accepts structured fields (html, css, title, filename) or a           *
/*          free-form raw string containing fenced code blocks or inline HTML.    *
/*                                                                                 *
/* Config (toolsconfig.getPDF):                                                    *
/*   headless    - puppeteer headless mode (default: "new")                       *
/*   chromeArgs  - array of Chrome launch args (default: ["--no-sandbox"])        *
/*   waitUntil   - puppeteer page load event (default: "networkidle0")            *
/*   timeoutMs   - puppeteer page load timeout in ms (default: 120000)            *
/*   format      - PDF paper format (default: "A4")                               *
/*   printBackground - include backgrounds in PDF (default: true)                 *
/**********************************************************************************/

import path from "path";
import fs from "fs/promises";
import puppeteer from "puppeteer";
import { ensureUserDir, getUniqueFilename, getUserId, getPublicBaseUrl } from "../core/file.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "getPDF";


function normalizeFilename(s, fallback = "") {
  const base = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || fallback || `document-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}


function ensureAbsoluteUrl(publicBaseUrl, urlPath) {
  const u = String(urlPath || "");
  const base = String(publicBaseUrl || "").replace(/\/$/, "");
  if (/^https?:\/\//.test(u)) return u;
  if (base) return `${base}${u.startsWith("/") ? "" : "/"}${u}`;
  return u;
}


function extractBody(html) {
  const s = String(html || "");
  const open = s.toLowerCase().indexOf("<body");
  if (open === -1) return s;
  const gt = s.indexOf(">", open);
  if (gt === -1) return s;
  const close = s.toLowerCase().lastIndexOf("</body>");
  if (close === -1) return s;
  return s.slice(gt + 1, close);
}


function enforcedCss() {
  return [
    "@page{size:A4;margin:20mm !important}",
    "html,body{margin:0 !important;padding:0 !important}",
    "body{padding:10mm !important}",
    "table, thead, tbody, tr, th, td, figure, img, pre, blockquote{page-break-inside:avoid !important; break-inside:avoid !important}",
    "h1,h2,h3{break-after:avoid !important; page-break-after:auto !important}",
    "img{max-width:100% !important; height:auto !important; display:block !important}"
  ].join("");
}


function buildPrintableHtml(bodyHtml, userCss = "", title = "Document") {
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


function extractFence(str, lang) {
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


function tolerantExtractJsonStringValue(source, key) {
  const s = String(source || "");
  const needle = `"${key}"`;
  const kpos = s.toLowerCase().indexOf(needle.toLowerCase());
  if (kpos === -1) return { value: "", ok: false };
  let i = kpos + needle.length;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== ":") return { value: "", ok: false };
  i++;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== '"') return { value: "", ok: false };
  i++;
  let value = "";
  let ok = false;
  while (i < s.length) {
    const ch = s[i++];
    if (ch === "\\") {
      if (i >= s.length) { value += "\\"; break; }
      const esc = s[i++];
      if (esc === "u") {
        const hex = s.slice(i, i + 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          try { value += String.fromCharCode(parseInt(hex, 16)); } catch { value += "\\u" + hex; }
          i += 4;
        } else {
          value += "\\u";
        }
      } else {
        const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "'": "'", "\\": "\\" };
        value += (map[esc] !== undefined) ? map[esc] : esc;
      }
    } else if (ch === '"') {
      ok = true; break;
    } else {
      value += ch;
    }
  }
  return { value, ok };
}


function tolerantParseArgs(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const { html, css, title, filename, raw } = input;
    if (html || css || title || filename) {
      return {
        html: String(html || "").trim(),
        css: String(css || "").trim(),
        title: title ? String(title) : "",
        filename: filename ? String(filename) : ""
      };
    }
    if (typeof raw === "string" && raw.trim()) {
      return tolerantParseArgs(raw);
    }
  }
  const raw = typeof input === "string" ? input : "";
  const str = String(raw || "").trim();
  if (!str) return { html: "", css: "", title: "", filename: "" };
  if (str[0] === "<") {
    let html = str;
    let css = "";
    const lower = str.toLowerCase();
    let pos = 0;
    while (true) {
      const sIdx = lower.indexOf("<style", pos);
      if (sIdx === -1) break;
      const gt = str.indexOf(">", sIdx);
      if (gt === -1) break;
      const eIdx = lower.indexOf("</style>", gt);
      if (eIdx === -1) break;
      css += (css ? "\n\n" : "") + str.slice(gt + 1, eIdx).trim();
      html = html.slice(0, sIdx) + html.slice(eIdx + 9);
      pos = eIdx + 9;
    }
    return { html: html.trim(), css: css.trim(), title: "", filename: "" };
  }
  try {
    const obj = JSON.parse(str);
    return {
      html: String(obj.html || "").trim(),
      css: String(obj.css || "").trim(),
      title: obj.title ? String(obj.title) : "",
      filename: obj.filename ? String(obj.filename) : ""
    };
  } catch {}
  try {
    let s2 = str;
    if (s2.startsWith("```")) {
      const nl = s2.indexOf("\n");
      if (nl !== -1) s2 = s2.slice(nl + 1);
      if (s2.endsWith("```")) s2 = s2.slice(0, -3);
    }
    const obj = JSON.parse(s2);
    return {
      html: String(obj.html || "").trim(),
      css: String(obj.css || "").trim(),
      title: obj.title ? String(obj.title) : "",
      filename: obj.filename ? String(obj.filename) : ""
    };
  } catch {}
  if (str.toLowerCase().includes('"html"')) {
    const htmlRec = tolerantExtractJsonStringValue(str, "html");
    const cssRec  = tolerantExtractJsonStringValue(str, "css");
    const titleRec = tolerantExtractJsonStringValue(str, "title");
    const filenameRec = tolerantExtractJsonStringValue(str, "filename");
    if (htmlRec.value) {
      let html = htmlRec.value;
      let css = cssRec.value || "";
      if (!css && html.toLowerCase().includes("<style")) {
        let lower = html.toLowerCase();
        let pos = 0;
        let collected = "";
        while (true) {
          const sIdx = lower.indexOf("<style", pos);
          if (sIdx === -1) break;
          const gt = html.indexOf(">", sIdx);
          if (gt === -1) break;
          const eIdx = lower.indexOf("</style>", gt);
          if (eIdx === -1) break;
          collected += (collected ? "\n\n" : "") + html.slice(gt + 1, eIdx).trim();
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
  if (fencedHtml || fencedCss) {
    let html = fencedHtml || "";
    let css = fencedCss || "";
    if (!html) {
      const L = str.toLowerCase();
      const start = L.indexOf("<html");
      const end = L.lastIndexOf("</html>");
      if (start !== -1 && end !== -1 && end > start) html = str.slice(start, end + 7);
    }
    if (!css && html) {
      let lower = html.toLowerCase();
      let pos = 0; let collected = "";
      while (true) {
        const sIdx = lower.indexOf("<style", pos);
        if (sIdx === -1) break;
        const gt = html.indexOf(">", sIdx);
        if (gt === -1) break;
        const eIdx = lower.indexOf("</style>", gt);
        if (eIdx === -1) break;
        collected += (collected ? "\n\n" : "") + html.slice(gt + 1, eIdx).trim();
        html = html.slice(0, sIdx) + html.slice(eIdx + 9);
        lower = html.toLowerCase();
        pos = sIdx;
      }
      css = collected;
    }
    return { html: (html || "").trim(), css: String(css || "").trim(), title: "", filename: "" };
  }
  {
    const L = str.toLowerCase();
    const start = L.indexOf("<html");
    const end = L.lastIndexOf("</html>");
    if (start !== -1 && end !== -1 && end > start) {
      let html = str.slice(start, end + 7);
      let lower = html.toLowerCase();
      let pos = 0; let collected = "";
      while (true) {
        const sIdx = lower.indexOf("<style", pos);
        if (sIdx === -1) break;
        const gt = html.indexOf(">", sIdx);
        if (gt === -1) break;
        const eIdx = lower.indexOf("</style>", gt);
        if (eIdx === -1) break;
        collected += (collected ? "\n\n" : "") + html.slice(gt + 1, eIdx).trim();
        html = html.slice(0, sIdx) + html.slice(eIdx + 9);
        lower = html.toLowerCase();
        pos = sIdx;
      }
      return { html: html.trim(), css: collected.trim(), title: "", filename: "" };
    }
  }
  if (str.indexOf("<") !== -1 && str.indexOf(">") !== -1) {
    let html = str;
    let css = "";
    let lower = html.toLowerCase();
    let pos = 0;
    while (true) {
      const sIdx = lower.indexOf("<style", pos);
      if (sIdx === -1) break;
      const gt = html.indexOf(">", sIdx);
      if (gt === -1) break;
      const eIdx = lower.indexOf("</style>", gt);
      if (eIdx === -1) break;
      css += (css ? "\n\n" : "") + html.slice(gt + 1, eIdx).trim();
      html = html.slice(0, sIdx) + html.slice(eIdx + 9);
      lower = html.toLowerCase();
      pos = sIdx;
    }
    return { html: html.trim(), css: css.trim(), title: "", filename: "" };
  }
  return { html: str, css: "", title: "", filename: "" };
}


async function generatePdfAndHtml(parsed, cfg, wo) {
  let browser = null;
  try {
    const htmlIn = String(parsed.html || "").trim();
    const cssIn = String(parsed.css || "");
    const title = String(parsed.title || "");
    const filenameArg = String(parsed.filename || "");
    if (!htmlIn) return { ok: false, error: "Missing 'html' content." };
    const bodyHtml = extractBody(htmlIn);
    const { html: fullHtml, cssFinal } = buildPrintableHtml(bodyHtml, cssIn, title || "Document");
    const dir = await ensureUserDir(wo);
    const filename = normalizeFilename(filenameArg, "");
    const baseName = filename || normalizeFilename(title, "") || normalizeFilename("document");
    const pdfFilename = await getUniqueFilename(dir, baseName, ".pdf");
    const htmlFilename = await getUniqueFilename(dir, baseName, ".html");
    const pdfPath = path.join(dir, pdfFilename);
    const htmlPath = path.join(dir, htmlFilename);
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
    const userId = getUserId(wo);
    const baseUrl = getPublicBaseUrl(wo);
    const publicPdf  = baseUrl ? `${baseUrl}/documents/${userId}/${pdfFilename}`  : `/documents/${userId}/${pdfFilename}`;
    const publicHtml = baseUrl ? `${baseUrl}/documents/${userId}/${htmlFilename}` : `/documents/${userId}/${htmlFilename}`;
    return {
      ok:       true,
      pdf:      publicPdf,
      html:     publicHtml,
      css:      cssFinal,
      text:     bodyHtml,
      filename: baseName
    };
  } catch (err) {
    return { ok: false, error: `Could not generate PDF/HTML: ${err?.message || String(err)}` };
  } finally {
    try { await browser?.close(); } catch {}
  }
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  try {
    const wo = coreData?.workingObject || {};
    const cfg = wo?.toolsconfig?.getPDF || {};
    const payload = args?.json ?? args ?? {};
    const parsedInput = (payload.html || payload.css || payload.title || payload.filename)
      ? payload
      : (payload.raw ?? payload);
    const parsed = tolerantParseArgs(parsedInput);
    if (!parsed.css || !String(parsed.css).trim()) {
      return { ok: false, error: "Missing 'css' styles (provide via 'css' param or <style>…</style> in HTML)." };
    }
    return await generatePdfAndHtml({
      html:     parsed.html,
      css:      parsed.css,
      title:    payload.title    ?? parsed.title,
      filename: payload.filename ?? parsed.filename
    }, cfg, wo);
  } catch (e) {
    return { ok: false, error: `Unexpected error: ${e?.message || String(e)}` };
  }
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
