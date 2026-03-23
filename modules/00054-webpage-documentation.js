/************************************************************************************/
/* filename: 00054-webpage-documentation.js                                               *
/* Version 1.0                                                                      *
/* Purpose: Markdown documentation browser. Lists .md files from documentation/    *
/*          and extra paths (e.g. extension README), renders them as formatted      *
/*          HTML with navigation sidebar.                                           *
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";

const MODULE_NAME = "webpage-documentation";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSS_PATH = path.resolve(__dirname, "../shared/webpage/style.css");
const DOCS_DIR = path.resolve(__dirname, "../documentation");

// Extra .md files from outside the documentation/ directory.
// name: used as URL param and display label (must be unique, must end in .md)
// filePath: absolute path to the actual file
const EXTRA_DOCS = [
  {
    name: "Browser-Extension.md",
    filePath: path.resolve(__dirname, "../extensions/jenny-extension/README.md")
  }
];


function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function getDocFiles() {
  const files = [];
  try {
    const main = fs.readdirSync(DOCS_DIR)
      .filter(f => f.toLowerCase().endsWith(".md"))
      .sort()
      .map(f => ({ name: f, filePath: path.join(DOCS_DIR, f) }));
    files.push(...main);
  } catch {}
  for (const e of EXTRA_DOCS) {
    try {
      if (fs.existsSync(e.filePath)) files.push(e);
    } catch {}
  }
  return files;
}


function getFilePath(files, name) {
  const entry = files.find(f => f.name === name);
  return entry ? entry.filePath : null;
}


function getMdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines = [];
  let inTable = false;
  let tableRows = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let olCounter = 0;
  let olPaused = false;

  function flushTable() {
    if (!tableRows.length) return;
    let html = "<table><thead><tr>";
    const headers = tableRows[0];
    for (const h of headers) html += `<th>${inlineHtml(h.trim())}</th>`;
    html += "</tr></thead><tbody>";
    for (let r = 2; r < tableRows.length; r++) {
      if (!tableRows[r]) continue;
      html += "<tr>";
      for (const c of tableRows[r]) html += `<td>${inlineHtml(c.trim())}</td>`;
      html += "</tr>";
    }
    html += "</tbody></table>";
    out.push(html);
    tableRows = [];
    inTable = false;
  }

  function flushList() {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
    olCounter = 0;
    olPaused = false;
  }

  function flushBlockquote() {
    if (inBlockquote) { out.push("</blockquote>"); inBlockquote = false; }
  }

  function inlineHtml(text) {
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    text = text.replace(/_(.+?)_/g, "<em>$1</em>");
    text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`);
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = href.startsWith("#") ? href : escHtml(href);
      return `<a href="${safeHref}">${label}</a>`;
    });
    return text;
  }

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      if (!inCodeBlock) {
        flushList(); flushBlockquote(); flushTable();
        inCodeBlock = true;
        codeLang = fenceMatch[2].trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        const langAttr = codeLang ? ` class="language-${escHtml(codeLang)}"` : "";
        out.push(`<pre><code${langAttr}>${escHtml(codeLines.join("\n"))}</code></pre>`);
        codeLang = "";
        codeLines = [];
      }
      i++; continue;
    }

    if (inCodeBlock) { codeLines.push(line); i++; continue; }

    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      flushList(); flushBlockquote(); flushTable();
      out.push("<hr>");
      i++; continue;
    }

    const hMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hMatch) {
      flushList(); flushBlockquote(); flushTable();
      const level = hMatch[1].length;
      const text = hMatch[2];
      const id = text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s/g, "-")
        .replace(/^-+|-+$/g, "");
      out.push(`<h${level} id="${id}">${inlineHtml(escHtml(text))}</h${level}>`);
      i++; continue;
    }

    if (line.startsWith("> ") || line === ">") {
      flushList(); flushTable();
      if (!inBlockquote) { out.push("<blockquote>"); inBlockquote = true; }
      const bqContent = line.startsWith("> ") ? line.slice(2) : "";
      out.push(`<p>${inlineHtml(escHtml(bqContent))}</p>`);
      i++; continue;
    }
    if (inBlockquote && !(line.startsWith("> ") || line === ">")) flushBlockquote();

    if (/^\|.+\|/.test(line)) {
      flushList(); flushBlockquote();
      inTable = true;
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      tableRows.push(cells.every(c => /^[-: ]+$/.test(c)) ? null : cells);
      i++; continue;
    }
    if (inTable) flushTable();

    const ulMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (ulMatch) {
      flushBlockquote();
      if (!inUl) {
        if (inOl) { out.push("</ol>"); inOl = false; olPaused = true; }
        out.push("<ul>"); inUl = true;
      }
      out.push(`<li>${inlineHtml(escHtml(ulMatch[2]))}</li>`);
      i++; continue;
    }

    const olMatch = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      flushBlockquote();
      if (!inOl) {
        if (inUl) { out.push("</ul>"); inUl = false; }
        if (olPaused) {
          out.push(`<ol start="${olCounter + 1}">`);
          olPaused = false;
        } else {
          out.push("<ol>");
          olCounter = 0;
        }
        inOl = true;
      }
      olCounter++;
      out.push(`<li>${inlineHtml(escHtml(olMatch[2]))}</li>`);
      i++; continue;
    }

    if (line.trim() === "") {
      flushList(); flushBlockquote();
      i++; continue;
    }

    flushList(); flushBlockquote();
    out.push(`<p>${inlineHtml(escHtml(line))}</p>`);
    i++;
  }

  flushList(); flushBlockquote(); flushTable();
  if (inCodeBlock) out.push(`<pre><code>${escHtml(codeLines.join("\n"))}</code></pre>`);

  return out.join("\n");
}


function getDocNavHtml(files, currentName, basePath) {
  if (!files.length) return "<p class='doc-empty'>No .md files found.</p>";
  const items = files.map(({ name }) => {
    const label = name.replace(/\.md$/i, "").replace(/[_-]/g, " ");
    const active = name === currentName ? " class='doc-nav-active'" : "";
    return `<a href="${basePath}?file=${encodeURIComponent(name)}"${active}>${escHtml(label)}</a>`;
  });
  return `<nav class="doc-nav">${items.join("")}</nav>`;
}


function getPageHtml(wo, files, currentName, content, basePath) {
  const menu     = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
  const role     = String(wo?.webAuth?.role || "");
  const menuHtml = getMenuHtml(menu, basePath, role, null, null, wo?.webAuth);
  const navHtml  = getDocNavHtml(files, currentName, basePath);
  const title    = currentName ? currentName.replace(/\.md$/i, "").replace(/[_-]/g, " ") : "Documentation";
  const docHtml  = content !== null ? getMdToHtml(content) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} — Docs</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
  .doc-layout{display:flex;height:calc(100vh - var(--hh));margin-top:var(--hh);overflow:hidden}
  .doc-sidebar{width:200px;min-width:160px;background:var(--card);border-right:1px solid var(--bdr);overflow-y:auto;overflow-x:hidden;padding:10px 0;flex-shrink:0}
  .doc-main{flex:1;overflow-y:auto;padding:20px 28px;background:var(--bg)}
  .doc-nav a{display:block;padding:7px 14px;color:var(--txt);text-decoration:none;font-size:13px;border-left:3px solid transparent;transition:background .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .doc-nav a:hover{background:var(--bg);color:var(--acc)}
  .doc-nav-active{background:var(--bg)!important;color:var(--acc)!important;border-left-color:var(--acc)!important;font-weight:600}
  .doc-content{max-width:860px}
  .doc-content h1,.doc-content h2,.doc-content h3,.doc-content h4,.doc-content h5,.doc-content h6{margin:1.4em 0 .4em;color:var(--txt);line-height:1.3}
  .doc-content h1{font-size:1.7em;border-bottom:2px solid var(--bdr);padding-bottom:.3em}
  .doc-content h2{font-size:1.35em;border-bottom:1px solid var(--bdr);padding-bottom:.2em}
  .doc-content h3{font-size:1.1em}
  .doc-content p{margin:.6em 0;line-height:1.65}
  .doc-content a{color:var(--acc)}
  .doc-content a:hover{color:var(--acc2)}
  .doc-content code{background:var(--bg3);border:1px solid var(--bdr);border-radius:3px;padding:1px 5px;font-family:monospace;font-size:.9em}
  .doc-content pre{background:var(--hdr);color:var(--hdr-txt);border-radius:var(--r);padding:14px 16px;overflow-x:auto;margin:.8em 0}
  .doc-content pre code{background:none;border:none;padding:0;color:inherit;font-size:.88em}
  .doc-content table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:13px}
  .doc-content th{background:var(--hdr);color:var(--hdr-txt);padding:7px 10px;text-align:left}
  .doc-content td{padding:6px 10px;border-bottom:1px solid var(--bdr)}
  .doc-content tr:nth-child(even) td{background:var(--bg3)}
  .doc-content ul,.doc-content ol{padding-left:1.6em;margin:.5em 0}
  .doc-content li{margin:.25em 0;line-height:1.55}
  .doc-content blockquote{border-left:4px solid var(--acc);margin:.7em 0;padding:8px 14px;background:var(--acc-tint);border-radius:0 var(--r) var(--r) 0}
  .doc-content blockquote p{margin:.2em 0;color:var(--acc2)}
  .doc-content hr{border:none;border-top:1px solid var(--bdr);margin:1.4em 0}
  .doc-empty{padding:16px;color:var(--muted);font-size:13px}
</style>
<script>
document.addEventListener("click", function(e) {
  const a = e.target.closest("a[href^='#']");
  if (!a) return;
  const id = a.getAttribute("href").slice(1);
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  const main = document.querySelector(".doc-main");
  if (!main) return;
  const mainRect = main.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  main.scrollTop += targetRect.top - mainRect.top;
});
</script>
</head>
<body>
<header>
  <h1>📖 Docs</h1>
  ${menuHtml}
</header>
<div class="doc-layout">
  <aside class="doc-sidebar">
    ${navHtml}
  </aside>
  <main class="doc-main">
    <div class="doc-content">
      ${docHtml || `<p class="doc-empty">Select a document from the sidebar.</p>`}
    </div>
  </main>
</div>
</body>
</html>`;
}


export default async function getWebpageDocumentation(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3116);
  if (Number(wo.http?.port) !== port) return coreData;

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const basePath = String(cfg.basePath ?? "/docs");
  const method = String(wo.http?.method ?? "GET").toUpperCase();

  const urlPath = String(wo.http?.path ?? "/");
  const fileParam = String(wo.http?.query?.file ?? "");

  if (method !== "GET") return coreData;

  // CSS
  if (urlPath === basePath + "/style.css") {
    try {
      const css = fs.readFileSync(CSS_PATH, "utf8");
      wo.http.response = { status: 200, headers: { "Content-Type": "text/css" }, body: css };
    } catch {
      wo.http.response = { status: 404, headers: { "Content-Type": "text/plain" }, body: "Not found" };
    }
    wo.jump = true;
    return coreData;
  }

  if (urlPath !== basePath && urlPath !== basePath + "/") return coreData;

  // Access control
  if (allowedRoles.length > 0) {
    const userRole = String(wo?.webAuth?.role || "").toLowerCase();
    const userRoles = [userRole, ...(wo?.webAuth?.roles || []).map(r => String(r).toLowerCase())].filter(Boolean);
    const hasRole = userRoles.some(r => r === "admin" || allowedRoles.map(a => a.toLowerCase()).includes(r));
    if (!hasRole) {
      wo.http.response = {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: `<!DOCTYPE html><html><body><h1>Access Denied</h1></body></html>`
      };
      wo.jump = true;
      return coreData;
    }
  }

  const files = getDocFiles();
  let currentName = "";
  let content = null;

  if (fileParam) {
    const safeName = path.basename(fileParam);
    const filePath = getFilePath(files, safeName);
    if (filePath) {
      currentName = safeName;
      try { content = fs.readFileSync(filePath, "utf8"); } catch { content = "_File could not be read._"; }
    }
  } else if (files.length) {
    currentName = files[0].name;
    try { content = fs.readFileSync(files[0].filePath, "utf8"); } catch { content = "_File could not be read._"; }
  }

  const html = getPageHtml(wo, files, currentName, content, basePath);
  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html
  };
  wo.jump = true;
  return coreData;
}
