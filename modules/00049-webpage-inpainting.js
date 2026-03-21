/**********************************************************************************/
/* filename: 00049-webpage-inpainting.js                                          */
/* Version 1.0                                                                    */
/* Purpose: Webpage-flow wrapper for the inpainting UI with role gate.            */
/**********************************************************************************/

"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { getMenuHtml } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";
import { saveFile } from "../core/file.js";

const MODULE_NAME = "webpage-inpainting";

const __filename_inp = fileURLToPath(import.meta.url);
const __dirname_inp  = path.dirname(__filename_inp);
const INPAINT_RESULTS_DIR = path.join(__dirname_inp, "..", "pub", "inpainting", "results");
try { fs.mkdirSync(INPAINT_RESULTS_DIR, { recursive: true }); } catch {}

const _inpaintAuthTokens = new Map();



async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return;
  const { res } = entry;

  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "text/plain; charset=utf-8" };
  const body    = r.body    ?? "";

  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body));
}



/**********************************************************************************/
function setJsonResp(wo, status, obj) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj ?? {})
  };
}



/**********************************************************************************/
function getBasePath(cfg) {
  const bp = String(cfg?.basePath ?? "/inpainting").trim();
  if (!bp || !bp.startsWith("/")) return "/inpainting";
  return bp.replace(/\/+$/,"");
}



/**********************************************************************************/
function getUserRoleLabels(wo) {
  const out = [];
  const seen = new Set();

  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }

  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }

  return out;
}



/**********************************************************************************/
function getIsAllowedByRoles(wo, cfg) {
  const required = Array.isArray(cfg?.allowedRoles) ? cfg.allowedRoles : [];
  if (!required.length) return true;

  const userRoles = getUserRoleLabels(wo);
  if (!userRoles.length) return true;

  for (const rr of required) {
    const need = String(rr || "").trim().toLowerCase();
    if (!need) continue;
    if (userRoles.includes(need)) return true;
  }
  return false;
}



/**********************************************************************************/
function setHtmlResp(wo, html) {
  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: String(html || "")
  };
}



/**********************************************************************************/
function setCssResp(wo, cssText) {
  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
    body: String(cssText || "")
  };
}





function setForbiddenPage(wo, menu, activePath, basePath) {
  const role = String(wo?.webAuth?.role || "").trim();
  const menuHtml = getMenuHtml(menu || [], activePath, role);
  const bp = typeof basePath === "string" && basePath.trim() ? basePath.trim() : "/inpainting";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>🎨 Inpainting</title>
<link rel="stylesheet" href="${bp}/style.css">
</head>
<body>
${menuHtml}
<div class="page">
  <div class="content-card">
    <h2>Access denied</h2>
    <p>You don’t have the required role(s) to use this page.</p>
  </div>
</div>
</body>
</html>`;

  setHtmlResp(wo, html);
}



/**********************************************************************************/
function getMultipartBoundary(ct) {
  const m = /boundary=([^\s;]+)/i.exec(String(ct || ""));
  return m ? m[1].replace(/^"|"$/g, "") : null;
}



function parseMultipart(rawBytes, boundary) {
  const out = { fields: {}, files: {} };
  if (!Buffer.isBuffer(rawBytes) || !boundary) return out;

  const boundaryBuf = Buffer.from(`--${boundary}`);

  let pos = rawBytes.indexOf(boundaryBuf);
  if (pos < 0) return out;
  pos += boundaryBuf.length;

  while (pos < rawBytes.length) {
    const next2 = rawBytes.slice(pos, pos + 2).toString();
    if (next2 === "--") break;
    if (next2 === "\r\n") pos += 2;
    let headerEnd = -1;
    for (let i = pos; i < rawBytes.length - 3; i++) {
      if (rawBytes[i] === 0x0d && rawBytes[i+1] === 0x0a && rawBytes[i+2] === 0x0d && rawBytes[i+3] === 0x0a) {
        headerEnd = i;
        break;
      }
    }
    if (headerEnd < 0) break;

    const headerSection = rawBytes.slice(pos, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;

    const nextBoundary = rawBytes.indexOf(boundaryBuf, bodyStart);
    const bodyEnd = nextBoundary < 0
      ? rawBytes.length
      : (rawBytes[nextBoundary - 2] === 0x0d && rawBytes[nextBoundary - 1] === 0x0a
          ? nextBoundary - 2
          : nextBoundary);
    const body = rawBytes.slice(bodyStart, bodyEnd);

    const headers = {};
    for (const line of headerSection.split("\r\n")) {
      const ci = line.indexOf(":");
      if (ci < 0) continue;
      headers[line.slice(0, ci).toLowerCase().trim()] = line.slice(ci + 1).trim();
    }

    const cd = headers["content-disposition"] || "";
    const nameMatch    = /name="([^"]*)"/.exec(cd);
    const filenameMatch = /filename="([^"]*)"/.exec(cd);

    if (nameMatch) {
      const fieldName = nameMatch[1];
      const filename  = filenameMatch ? filenameMatch[1] : null;
      const contentType = headers["content-type"] || "application/octet-stream";
      if (filename !== null) {
        out.files[fieldName] = { buffer: body, filename, contentType };
      } else {
        out.fields[fieldName] = body.toString("utf8");
      }
    }

    if (nextBoundary < 0) break;
    pos = nextBoundary + boundaryBuf.length;
  }

  return out;
}



function buildMultipartBody(fields) {
  const boundary = `----FormBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value && typeof value === "object" && Buffer.isBuffer(value.buffer)) {
      const fn = value.filename || `${name}.bin`;
      const ct = value.contentType || "application/octet-stream";
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fn}"\r\nContent-Type: ${ct}\r\n\r\n`));
      parts.push(value.buffer);
      parts.push(Buffer.from("\r\n"));
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value ?? "")}\r\n`));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}



function getEngineMaskBuffer(maskBuffer) {
  const png = PNG.sync.read(maskBuffer);
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const isInpaint = data[i + 3] < 250;
    data[i]     = isInpaint ? 255 : 0;
    data[i + 1] = isInpaint ? 255 : 0;
    data[i + 2] = isInpaint ? 255 : 0;
    data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function inpaintGetAuthUsers(cfg) {
  const auth = cfg?.auth || {};
  const out = [];
  if (Array.isArray(auth.users)) {
    for (const u of auth.users) {
      const username = String(u?.username || "").trim();
      const password = String(u?.password || "").trim();
      if (username && password) out.push({ username, password });
    }
  }
  const legacy = String(auth.password || "").trim();
  if (legacy) out.push({ username: "default", password: legacy });
  return out;
}

function inpaintGetAuthEnabled(cfg) {
  if (cfg?.auth?.enabled === false) return false;
  return inpaintGetAuthUsers(cfg).length > 0;
}

function inpaintGetAuthTtlMinutes(cfg) {
  const n = Number(cfg?.auth?.tokenTtlMinutes);
  if (!Number.isFinite(n) || n <= 0) return 720;
  return Math.min(24 * 60 * 7, Math.floor(n));
}

function inpaintIssueToken(cfg, username) {
  const token = `t_${Date.now()}_${Math.random().toString(16).slice(2)}_${Math.random().toString(16).slice(2)}`;
  const expiresAtMs = Date.now() + inpaintGetAuthTtlMinutes(cfg) * 60 * 1000;
  _inpaintAuthTokens.set(token, { expiresAtMs, username: String(username || "") });
  return { token, expiresAtMs };
}

function inpaintGetIsTokenValid(token) {
  const t = String(token || "").trim();
  if (!t) return false;
  const entry = _inpaintAuthTokens.get(t);
  if (!entry) return false;
  if (entry.expiresAtMs && Date.now() > entry.expiresAtMs) {
    _inpaintAuthTokens.delete(t);
    return false;
  }
  return true;
}

function inpaintGetTokenFromWo(wo) {
  const h = wo?.http?.headers || {};
  const direct = String(h["x-inpaint-auth"] || "").trim();
  if (direct) return direct;
  const auth = String(h["authorization"] || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return String((m && m[1]) || "").trim();
}

function inpaintGetIsAuthed(wo) {
  return inpaintGetIsTokenValid(inpaintGetTokenFromWo(wo));
}



/**********************************************************************************/
function getProxyRequestBody(wo) {
  if (Buffer.isBuffer(wo?.http?.rawBodyBytes)) return wo.http.rawBodyBytes;
  const s = String(wo?.http?.rawBody ?? wo?.http?.body ?? "");
  return Buffer.from(s, "utf8");
}



/**********************************************************************************/
async function setProxy(wo, targetUrl) {
  const method = String(wo?.http?.method || "GET").toUpperCase();
  const hdrIn = wo?.http?.headers || {};

  const { default: https } = await import("node:https");
  const { default: http } = await import("node:http");

  const u = new URL(targetUrl);
  const mod = u.protocol === "https:" ? https : http;

  const headers = {};
  for (const [k, v] of Object.entries(hdrIn)) {
    const kk = String(k || "").toLowerCase();
    if (!kk) continue;
    if (kk === "host") continue;
    if (kk === "content-length") continue;
    headers[k] = v;
  }

  const bodyBuf = (method === "GET" || method === "HEAD") ? null : getProxyRequestBody(wo);
  if (bodyBuf && bodyBuf.length) headers["Content-Length"] = String(bodyBuf.length);

  const resp = await new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        method,
        path: u.pathname + u.search,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ status: Number(res.statusCode || 502), headers: res.headers || {}, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    if (bodyBuf && bodyBuf.length) req.write(bodyBuf);
    req.end();
  });

  const outHeaders = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
  for (const [k, v] of Object.entries(resp.headers || {})) {
    const kk = String(k || "").toLowerCase();
    if (!kk) continue;
    if (kk === "transfer-encoding") continue;
    if (kk === "connection") continue;
    if (kk === "keep-alive") continue;
    if (kk === "content-length") continue;
    outHeaders[k] = v;
  }
  outHeaders["Content-Length"] = String(resp.body?.length || 0);

  wo.http.response = { status: resp.status, headers: outHeaders, body: resp.body };
}



/**********************************************************************************/
function getInpaintHtml(opts) {
  const basePath   = String(opts?.basePath || "/inpainting").replace(/\/+$/,"") || "/inpainting";
  const activePath = String(opts?.activePath || basePath) || basePath;
  const role       = String(opts?.role || "").trim();
  const isLoggedIn = !!opts?.isLoggedIn;
  const menuHtml   = getMenuHtml(opts?.menu || [], activePath, role);

  const toolCss = `:root {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
        font-size: 14px;
        color-scheme: dark;
      }
      body {
        margin: 0;
        padding: 0.75rem;
        background: #0b0b0b;
        color: #eee;
        display: flex;
        justify-content: center;
      }
      .app {
        width: 100%;
        max-width: 720px;
      }
      h1 {
        margin: 0 0 0.75rem 0;
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      .canvas-area {
        position: relative;
        border: 1px solid #333;
        border-radius: 8px;
        background: radial-gradient(
          circle at top,
          #222 0,
          #111 55%,
          #0a0a0a 100%
        );
        overflow: hidden;
        transition: outline 0.1s, background-color 0.1s;
      }
      .canvas-area.drag-over {
        outline: 2px dashed rgba(114, 137, 218, 0.85);
        background-color: rgba(114, 137, 218, 0.07);
      }
      .canvas-inner {
        position: relative;
        width: 100%;
      }
      canvas {
        display: block;
        width: 100%;
        height: auto;
      }
      #maskCanvas,
      #cursorCanvas {
        position: absolute;
        left: 0;
        top: 0;
      }
      #maskCanvas {
        pointer-events: auto;
        opacity: 0.6;
      }
      #cursorCanvas {
        pointer-events: none;
      }

      .overlay-hint {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 0.75rem;
        font-size: 0.85rem;
        color: #bbb;
        pointer-events: none;
        backdrop-filter: blur(2px);
      }
      .overlay-hint span {
        opacity: 0.9;
        margin: 0.1rem 0;
      }
      .overlay-hint strong {
        color: #0af;
        font-weight: 500;
      }
      .overlay-hint.hidden {
        display: none;
      }

      #controls {
        margin-top: 0.6rem;
        display: none;
        flex-direction: column;
        gap: 0.45rem;
      }

      #prompt {
        width: 100%;
        min-height: 52px;
        max-height: 100px;
        resize: vertical;
        font-size: 0.9rem;
        padding: 0.4rem 0.45rem;
        border-radius: 6px;
        border: 1px solid #333;
        background: #161616;
        color: #eee;
        box-sizing: border-box;
      }

      .control-row {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        justify-content: space-between;
        flex-wrap: wrap;
      }

      .left-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex: 1 1 auto;
        flex-wrap: wrap;
      }

      .slider-wrap {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.8rem;
        color: #aaa;
        white-space: nowrap;
        padding: 0.2rem 0.35rem;
        border-radius: 999px;
        background: #141414;
        border: 1px solid #2b2b2b;
      }
      .slider-wrap span {
        font-size: 0.95rem;
      }
      #brushSize {
        width: 110px;
      }

      .engine-wrap {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.8rem;
        color: #aaa;
        white-space: nowrap;
        padding: 0.2rem 0.35rem;
        border-radius: 999px;
        background: #141414;
        border: 1px solid #2b2b2b;
      }
      #engineSelect {
        font-size: 0.8rem;
        background: black;
        color: #eee;
        border-radius: 999px;
        border: 1px solid #333;
        padding: 0.15rem 0.5rem;
      }

      #status {
        font-size: 0.78rem;
        color: #c0c0c0;
      }

      #publishNotice {
        display: none;
        font-size: 0.75rem;
        padding: 0.12rem 0.45rem;
        border-radius: 999px;
        border: 1px solid rgba(59, 130, 246, 0.30);
        background: rgba(59, 130, 246, 0.08);
        color: #2563eb;
        white-space: nowrap;
      }

      #apiError {
        display: none;
        margin-top: 0.25rem;
        padding: 0.45rem 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(200, 0, 0, 0.25);
        background: rgba(200, 0, 0, 0.06);
        color: #b91c1c;
        font-size: 0.82rem;
        line-height: 1.25;
      }

      .buttons {
        display: flex;
        gap: 0.3rem;
        flex-wrap: wrap;
        flex-shrink: 0;
      }
      button {
        padding: 0.3rem 0.55rem;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        background: linear-gradient(135deg, #0af, #6cf);
        color: #000;
        font-size: 0.9rem;
        font-weight: 600;
      }
      button.secondary {
        background: #f1f5f9;
        color: var(--txt, #1e293b);
        border: 1px solid #cbd5e1;
        font-weight: 500;
      }
      button.secondary:hover {
        background: #e2e8f0;
      }
      button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .hint-card {
        margin-top: 0.55rem;
        border: 1px solid var(--bdr, #e2e8f0);
        background: var(--card, #fff);
        border-radius: 10px;
        padding: 0.55rem 0.6rem;
      }
      .hint-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.35rem;
      }
      .hint-title {
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--txt, #1e293b);
      }
      .hint-badge {
        font-size: 0.7rem;
        padding: 0.1rem 0.4rem;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.08);
        color: #2563eb;
        border: 1px solid rgba(59, 130, 246, 0.25);
      }
      .hint-list {
        list-style: none;
        padding: 0;
        margin: 0.2rem 0 0;
      }
      .hint-list li {
        display: flex;
        align-items: flex-start;
        gap: 0.35rem;
        margin: 0.15rem 0;
        line-height: 1.25;
      }
      .hint-icon {
        font-size: 0.85rem;
        margin-top: 0.03rem;
      }
      .hint-text-strong {
        font-weight: 500;
        color: var(--txt, #1e293b);
      }
      .hint-sub {
        font-size: 0.74rem;
        color: var(--muted, #64748b);
      }
      `;

  const appInner = `<div class="app">
      <h1>In-/Outpainting Tool</h1>

      <div id="canvasArea" class="canvas-area">
        <div class="canvas-inner">
          <canvas id="imageCanvas"></canvas>
          <canvas id="maskCanvas"></canvas>
          <canvas id="cursorCanvas"></canvas>
        </div>
        <div id="overlayHint" class="overlay-hint">
          <span class="hint-text-strong">How to start</span>
          <span>Open the page with a URL parameter, for example:</span>
          <span><strong>?src=https:
          <span>Once the image is visible, you can paint your mask.</span>
          <span>Inpainting is only available for allowed image origins.</span>
        </div>
      </div>

      <div id="controls">
        <textarea
          id="prompt"
          placeholder="e.g. 'replace the background with a sunset beach scene'"
        ></textarea>

        <div class="control-row">
          <div class="left-controls">
            <div class="slider-wrap">
              <span title="Brush size">\ud83d\udd8c</span>
              <input type="range" id="brushSize" min="5" max="80" value="25" />
              <span id="brushSizeLabel">25 px</span>
            </div>

            <div class="engine-wrap">
              <span title="Image engine">\u2699</span>
              <select id="engineSelect"></select>
            </div>

            <span id="status"></span>
            <span id="publishNotice">\u2705 Sent</span>
          </div>

          <div class="buttons">
            <button id="editBtn" title="Run in-/outpainting">\u270f\ufe0f</button>
            <button
              id="modeBtn"
              class="secondary"
              title="Mask mode: reveal areas to be edited"
            >
              \u25ce
            </button>
            <button
              id="outBtn"
              class="secondary"
              title="Image mode: inpainting only inside the original image"
            >
              \u25a3
            </button>
            <button
              id="viewBtn"
              class="secondary"
              title="View mode: hide/show the mask overlay"
            >
              \ud83d\udd76
            </button>
            <button
              id="resetBtn"
              class="secondary"
              title="Reset back to the original image"
            >
              \u27f3
            </button>
            <button
              id="downloadBtn"
              class="secondary"
              title="Download the current image as PNG"
            >
              \u2b07
            </button>
            <button
              id="galleryBtn"
              class="secondary"
              title="Save to gallery"
              disabled
            >
              \ud83d\uddbc
            </button>
            <button
              id="unlockBtn"
              class="secondary"
              title="Unlock editing and local upload with credentials"
            >
              \ud83d\udd12
            </button>
            <button
              id="uploadBtn"
              class="secondary"
              title="Upload a local image (requires unlock)"
              disabled
            >
              \ud83d\udce4
            </button>
            <button
              id="publishBtn"
              class="secondary"
              title="Send current image to the selected channel via API"
              style="display:none;"
              disabled
            >
              \ud83d\udce8
            </button>
          </div>
        </div>

        <div id="apiError"></div>

        <div class="hint-card">
          <div class="hint-header">
            <div class="hint-title">Quick guide</div>
            <div class="hint-badge">Workflow</div>
          </div>
          <ul class="hint-list">
            <li>
              <span class="hint-icon">1\ufe0f\u20e3</span>
              <span>
                <span class="hint-text-strong">Load an image</span><br />
                Call this page with <span class="hint-sub">?src=&lt;image-url&gt;</span>.
              </span>
            </li>
            <li>
              <span class="hint-icon">2\ufe0f\u20e3</span>
              <span>
                <span class="hint-text-strong">Inpainting (\u270f\ufe0f + \u25ce)</span><br />
                Use the brush to reveal the areas you want the AI to change. Dark areas are protected.
              </span>
            </li>
            <li>
              <span class="hint-icon">3\ufe0f\u20e3</span>
              <span>
                <span class="hint-text-strong">Outpainting (\u26f6)</span><br />
                Shrinks the image and lets the AI extend the borders with smooth transitions. The brush is disabled in this mode.
              </span>
            </li>
            <li>
              <span class="hint-icon">4\ufe0f\u20e3</span>
              <span>
                <span class="hint-text-strong">View mode (\ud83d\udd76)</span><br />
                Hides the mask overlay. If the image origin is not allowed, view mode is forced until you unlock.
              </span>
            </li>
          </ul>
        </div>
      </div>

      <input
        id="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style="display:none;"
      />`;

  const toolScript = `const CANVAS_SIZE = 1024;
        const OUTPAINT_SCALE = 0.8;
        const OUTPAINT_OVERLAP = 32;

        const canvasArea = document.getElementById("canvasArea");
        const imageCanvas = document.getElementById("imageCanvas");
        const maskCanvas = document.getElementById("maskCanvas");
        const cursorCanvas = document.getElementById("cursorCanvas");
        const overlayHint = document.getElementById("overlayHint");
        const controlsEl = document.getElementById("controls");
        const promptInput = document.getElementById("prompt");
        const editBtn = document.getElementById("editBtn");
        const modeBtn = document.getElementById("modeBtn");
        const outBtn = document.getElementById("outBtn");
        const viewBtn = document.getElementById("viewBtn");
        const resetBtn = document.getElementById("resetBtn");
        const downloadBtn = document.getElementById("downloadBtn");
        const galleryBtn  = document.getElementById("galleryBtn");
        const unlockBtn = document.getElementById("unlockBtn");
        const uploadBtn = document.getElementById("uploadBtn");
        const fileInput = document.getElementById("fileInput");
        const publishBtn = document.getElementById("publishBtn");
        const statusEl = document.getElementById("status");
        const publishNotice = document.getElementById("publishNotice");
        const apiErrorEl = document.getElementById("apiError");
        const brushSizeSlider = document.getElementById("brushSize");
        const brushSizeLabel = document.getElementById("brushSizeLabel");
        const engineSelect = document.getElementById("engineSelect");

        const imgCtx = imageCanvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");
        const cursorCtx = cursorCanvas.getContext("2d");

        let imageLoaded = false;
        let drawing = false;
        let brushSize = parseInt(brushSizeSlider.value, 10) || 25;

        let drawOffsetX = 0;
        let drawOffsetY = 0;
        let drawWidth = 0;
        let drawHeight = 0;

        let originalImageSrc = null;
        let workingImageSrc = null;
        let preOutpaintSrc = null;
        let maskMode = "erase";
        let outpaintMode = false;

        let hostsWhitelist = [];
        let originHost = null;
        let configLoaded = false;
        let supportsUnlock = false;

        let authToken = "";
        let tokenValid = false;

        let allowEdit = false;

        let callbackId = null;

        let viewModeEnabled = false;
        let viewModeForced = false;


        function setPublishNotice(text, isError) {
          if (!text) {
            publishNotice.style.display = "none";
            return;
          }
          publishNotice.textContent = text;
          publishNotice.style.display = "inline";
          if (isError) {
            publishNotice.style.borderColor = "rgba(255, 80, 80, 0.5)";
            publishNotice.style.background = "rgba(255, 80, 80, 0.12)";
            publishNotice.style.color = "#ffd2d2";
          } else {
            publishNotice.style.borderColor = "rgba(0, 170, 255, 0.35)";
            publishNotice.style.background = "rgba(0, 170, 255, 0.09)";
            publishNotice.style.color = "#9ddcff";
          }
        }


        function setApiError(text) {
          const t = String(text || "").trim();
          if (!t) {
            apiErrorEl.style.display = "none";
            apiErrorEl.textContent = "";
            return;
          }
          apiErrorEl.textContent = t;
          apiErrorEl.style.display = "block";
        }


        function clearApiError() {
          setApiError("");
        }


        function setWorkingImageSrc(src) {
          const s = String(src || "").trim();
          if (!s) return;
          workingImageSrc = s;
        }


        function initCanvases() {
          imageCanvas.width = CANVAS_SIZE;
          imageCanvas.height = CANVAS_SIZE;
          maskCanvas.width = CANVAS_SIZE;
          maskCanvas.height = CANVAS_SIZE;
          cursorCanvas.width = CANVAS_SIZE;
          cursorCanvas.height = CANVAS_SIZE;
        }


        function updateBrushLabel() {
          brushSizeLabel.textContent = \`\${brushSize} px\`;
        }


        function handleBrushSizeInput() {
          brushSize = parseInt(brushSizeSlider.value, 10) || 25;
          updateBrushLabel();
        }


        function updateMaskModeButton() {
          if (maskMode === "erase") {
            modeBtn.title = "Mask mode: reveal areas to be edited";
            modeBtn.textContent = "\u25ce";
          } else {
            modeBtn.title = "Mask mode: protect areas (do not edit)";
            modeBtn.textContent = "\u25c9";
          }
        }


        function updateOutpaintButton() {
          if (outpaintMode) {
            outBtn.textContent = "\u26f6";
            outBtn.title =
              "Image mode: outpainting (image shrinks, borders are extended by the AI, brush disabled)";
          } else {
            outBtn.textContent = "\u25a3";
            outBtn.title =
              "Image mode: inpainting (only within the original image, brush enabled)";
          }
          applyMaskInteractivity();
        }


        function getIsTrustedHost() {
          if (!originHost) return false;
          const low = String(originHost || "").toLowerCase();
          return (hostsWhitelist || [])
            .map((h) => String(h || "").toLowerCase())
            .includes(low);
        }


        function getPreferredViewMode() {
          const raw = String(
            window.sessionStorage.getItem("inpaintViewMode") || ""
          ).trim();
          return raw === "1";
        }


        function setPreferredViewMode(enabled) {
          window.sessionStorage.setItem("inpaintViewMode", enabled ? "1" : "0");
        }


        function applyViewModeUi() {
          if (viewModeEnabled) {
            maskCanvas.style.opacity = "0";
            cursorCanvas.style.opacity = "0";
            viewBtn.textContent = "\ud83d\udc41";
            viewBtn.title = "View mode enabled (mask hidden). Click to show mask.";
          } else {
            maskCanvas.style.opacity = "0.6";
            cursorCanvas.style.opacity = "1";
            viewBtn.textContent = "\ud83d\udd76";
            viewBtn.title = "View mode disabled (mask visible). Click to hide mask.";
          }
          applyMaskInteractivity();
        }


        function setViewMode(enabled, forced) {
          viewModeEnabled = !!enabled;
          viewModeForced = !!forced;

          viewBtn.disabled = !!viewModeForced || !imageLoaded || !allowEdit;

          applyViewModeUi();
        }


        function applyMaskInteractivity() {
          const canPaint = !!(imageLoaded && allowEdit && !outpaintMode && !viewModeEnabled);
          maskCanvas.style.pointerEvents = canPaint ? "auto" : "none";
          if (!canPaint) {
            cursorCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          }
        }


        function recomputeAccessState() {
          if (!configLoaded) {
            statusEl.textContent = "Loading configuration\u2026";
            editBtn.disabled = true;
            modeBtn.disabled = true;
            outBtn.disabled = true;
            uploadBtn.disabled = true;
            viewBtn.disabled = true;
            updateUnlockButton();
            return;
          }

          const isTrusted = getIsTrustedHost();
          const forcedView = !!(imageLoaded && originHost && !allowEdit && !tokenValid);

          if (!imageLoaded) {
            statusEl.textContent =
              "No image loaded. Unlock to upload a local image, or open with ?src=\u2026";
          } else if (forcedView) {
            statusEl.textContent =
              "Image origin is not allowed \u2013 view only. Unlock to enable all functions.";
          } else if (!allowEdit && originHost) {
            statusEl.textContent =
              "Editing disabled. Unlock or use an allowed origin.";
          } else if (allowEdit) {
            statusEl.textContent =
              "Editing enabled (" + (tokenValid ? "unlocked" : "allowed") + ").";
          }

          editBtn.disabled = !(allowEdit && imageLoaded);
          modeBtn.disabled = !(allowEdit && imageLoaded) || outpaintMode || viewModeEnabled;
          outBtn.disabled = !(allowEdit && imageLoaded);
          resetBtn.disabled = !imageLoaded;
          downloadBtn.disabled = !imageLoaded;
          galleryBtn.disabled  = !imageLoaded || !INPAINT_LOGGED_IN;

          uploadBtn.disabled = !INPAINT_LOGGED_IN && !(supportsUnlock && tokenValid);

          if (forcedView) {
            setViewMode(true, true);
          } else {
            if (viewModeForced) {
              const pref = getPreferredViewMode();
              setViewMode(pref, false);
            } else {
              viewBtn.disabled = !imageLoaded || !allowEdit;
              applyViewModeUi();
            }
          }

          updateUnlockButton();
        }


        function updateUnlockButton() {
          if (INPAINT_LOGGED_IN) {
            unlockBtn.style.display = "none";
            uploadBtn.style.display = "inline-flex";
            return;
          }
          if (!supportsUnlock) {
            unlockBtn.style.display = "none";
            uploadBtn.style.display = "none";
            return;
          }

          unlockBtn.style.display = "inline-flex";
          uploadBtn.style.display = "inline-flex";

          if (tokenValid) {
            unlockBtn.textContent = "\ud83d\udd13";
            unlockBtn.title = "Unlocked (session). Click to lock this session.";
          } else {
            unlockBtn.textContent = "\ud83d\udd12";
            unlockBtn.title = "Unlock editing and local upload with credentials";
          }
        }


        function getAuthHeaders() {
          const headers = {};
          if (tokenValid && authToken) headers["x-inpaint-auth"] = authToken;
          return headers;
        }


        function refreshCanEditFromServer() {
          const o = String(originalImageSrc || "").trim();
          if (!o) {
            allowEdit = INPAINT_LOGGED_IN;
            recomputeAccessState();
            return;
          }
          if (INPAINT_LOGGED_IN) {
            allowEdit = true;
          } else if (o.startsWith("data:") || o.startsWith("blob:")) {
            allowEdit = true;
          } else if (o.startsWith(INPAINT_BASE + "/proxy")) {
            allowEdit = true;
          } else {
            try {
              const u = new URL(o);
              const myOrigin = window.location.origin;
              if (u.origin === myOrigin && u.pathname.startsWith(INPAINT_BASE + "/results/")) {
                allowEdit = true;
              } else if (hostsWhitelist.length) {
                allowEdit = hostsWhitelist
                  .map(h => String(h || "").toLowerCase())
                  .includes(u.hostname.toLowerCase());
              } else {
                allowEdit = false;
              }
            } catch {
              allowEdit = false;
            }
          }
          recomputeAccessState();
        }


        async function fetchConfig() {
          try {
            const res = await fetch(INPAINT_BASE + "/api/config");
            if (!res.ok) throw new Error("Config request failed");
            const data = await res.json();

            hostsWhitelist = data.hostsWhitelist || [];
            supportsUnlock = !!data.supportsUnlock;
            configLoaded = true;

            const engines = data.engines || [];
            const defaultEngineId = data.defaultEngineId || null;

            engineSelect.innerHTML = "";

            if (!engines.length) {
              const opt = document.createElement("option");
              opt.value = "";
              opt.textContent = "No engines configured";
              engineSelect.appendChild(opt);
              engineSelect.disabled = true;
            } else {
              for (const e of engines) {
                const opt = document.createElement("option");
                opt.value = e.id;
                opt.textContent = e.label || e.id;
                engineSelect.appendChild(opt);
              }
              engineSelect.disabled = false;
              if (defaultEngineId) engineSelect.value = defaultEngineId;
            }

            recomputeAccessState();
          } catch (e) {
            engineSelect.innerHTML = "";
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "Config error";
            engineSelect.appendChild(opt);
            engineSelect.disabled = true;
            statusEl.textContent = "Error while loading configuration.";
            setApiError("Config error: " + String((e && e.message) || e));
          }
        }


        async function validateTokenFromSession() {
          const t = String(
            window.sessionStorage.getItem("inpaintAuthToken") || ""
          ).trim();
          authToken = t;

          if (!t) {
            tokenValid = false;
            updateUnlockButton();
            return false;
          }

          try {
            const res = await fetch(INPAINT_BASE + "/api/validate-token", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-inpaint-auth": t,
              },
              body: "{}",
            });

            const data = await res.json().catch(() => ({}));
            tokenValid = !!data.valid;

            if (!tokenValid) {
              window.sessionStorage.removeItem("inpaintAuthToken");
              authToken = "";
            }

            updateUnlockButton();
            return tokenValid;
          } catch {
            tokenValid = false;
            updateUnlockButton();
            return false;
          }
        }


        function lockSession() {
          window.sessionStorage.removeItem("inpaintAuthToken");
          authToken = "";
          tokenValid = false;
          updateUnlockButton();
          refreshCanEditFromServer();
        }


        async function unlockWithCredentials() {
          if (!supportsUnlock) return false;

          clearApiError();

          if (tokenValid) {
            const ok = window.confirm("Lock this session (remove unlock token)?");
            if (ok) lockSession();
            return tokenValid;
          }

          const username = window.prompt("Username:");
          if (!username) return false;

          const password = window.prompt("Password:");
          if (!password) return false;

          try {
            const res = await fetch(INPAINT_BASE + "/api/unlock", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
              tokenValid = false;
              updateUnlockButton();
              setApiError(
                "Unlock failed: " + String(data.error || "invalid_credentials")
              );
              return false;
            }

            const token = String(data.token || "").trim();
            if (!token) {
              tokenValid = false;
              updateUnlockButton();
              setApiError("Unlock failed: no token returned.");
              return false;
            }

            window.sessionStorage.setItem("inpaintAuthToken", token);
            await validateTokenFromSession();
            refreshCanEditFromServer();
            return tokenValid;
          } catch (e) {
            tokenValid = false;
            updateUnlockButton();
            setApiError("Unlock error: " + String((e && e.message) || e));
            return false;
          }
        }


        async function uploadLocalFile(file) {
          if (!file) return;

          clearApiError();

          if (!INPAINT_LOGGED_IN && !tokenValid) {
            const ok = await unlockWithCredentials();
            if (!ok) return;
          }

          const fd = new FormData();
          fd.append("image", file, file.name || "upload.png");

          statusEl.textContent = "Uploading\u2026";
          uploadBtn.disabled = true;

          try {
            const res = await fetch(INPAINT_BASE + "/api/upload-local", {
              method: "POST",
              headers: { ...getAuthHeaders() },
              body: fd,
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(String(data.error || "upload_failed"));
            }

            const url = data && data.url ? data.url : "";
            if (!url) throw new Error("upload_returned_no_url");

            const abs = new URL(url, window.location.origin).toString();

            originalImageSrc = abs;
            setWorkingImageSrc(abs);
            outpaintMode = false;
            updateOutpaintButton();

            try {
              const u = new URL(abs);
              originHost = u.host;
            } catch {
              originHost = null;
            }

            statusEl.textContent = "Loading uploaded image\u2026";
            loadImageFromSrc(abs, { scaleMode: "fit", maskMode: "fullBlack" });
            refreshCanEditFromServer();
          } catch (e) {
            statusEl.textContent =
              "Upload error: " + String((e && e.message) || e);
            setApiError(statusEl.textContent);
          } finally {
            recomputeAccessState();
          }
        }


        function setMaskFullBlack() {
          maskCtx.setTransform(1, 0, 0, 1, 0, 0);
          maskCtx.globalCompositeOperation = "source-over";
          maskCtx.fillStyle = "rgba(0,0,0,1)";
          maskCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          maskCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          maskCtx.beginPath();
        }


        function setMaskFullTransparent() {
          maskCtx.setTransform(1, 0, 0, 1, 0, 0);
          maskCtx.globalCompositeOperation = "source-over";
          maskCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          maskCtx.beginPath();
        }


        function setMaskForOutpaintDefault() {
          const overlap = Math.max(0, Math.floor(OUTPAINT_OVERLAP || 0));

          const x0 = Math.max(0, Math.floor(drawOffsetX + overlap));
          const y0 = Math.max(0, Math.floor(drawOffsetY + overlap));
          const x1 = Math.min(CANVAS_SIZE, Math.ceil(drawOffsetX + drawWidth - overlap));
          const y1 = Math.min(CANVAS_SIZE, Math.ceil(drawOffsetY + drawHeight - overlap));

          const w = Math.max(0, x1 - x0);
          const h = Math.max(0, y1 - y0);

          maskCtx.setTransform(1, 0, 0, 1, 0, 0);
          maskCtx.globalCompositeOperation = "source-over";

          maskCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

          if (w > 0 && h > 0) {
            maskCtx.fillStyle = "rgba(0,0,0,1)";
            maskCtx.fillRect(x0, y0, w, h);
          }

          maskCtx.beginPath();
        }

        function loadImageFromSrc(src, options = {}) {
          const { scaleMode = "fit", maskMode = "fullBlack" } = options;

          const img = new Image();

          img.onload = () => {
            initCanvases();

            imgCtx.setTransform(1, 0, 0, 1, 0, 0);
            imgCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            imgCtx.fillStyle = "black";
            imgCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

            const baseScale = Math.min(
              CANVAS_SIZE / img.width,
              CANVAS_SIZE / img.height
            );

            let scale = baseScale;
            if (scaleMode === "shrinkForOutpaint") {
              scale = baseScale * OUTPAINT_SCALE;
            }

            drawWidth = img.width * scale;
            drawHeight = img.height * scale;
            drawOffsetX = (CANVAS_SIZE - drawWidth) / 2;
            drawOffsetY = (CANVAS_SIZE - drawHeight) / 2;

            imgCtx.drawImage(
              img,
              0,
              0,
              img.width,
              img.height,
              drawOffsetX,
              drawOffsetY,
              drawWidth,
              drawHeight
            );

                        if (maskMode === "fullBlack") setMaskFullBlack();
            else if (maskMode === "fullTransparent") setMaskFullTransparent();
            else if (maskMode === "outpaintDefault") setMaskForOutpaintDefault();
            else setMaskFullBlack();
overlayHint.classList.add("hidden");
            controlsEl.style.display = "flex";

            imageLoaded = true;

            const pref = getPreferredViewMode();
            if (!viewModeForced) viewModeEnabled = pref;

            refreshCanEditFromServer();
          };

          img.onerror = () => {
            statusEl.textContent =
              "Error loading image (CORS / same-origin restrictions?).";
            setApiError(statusEl.textContent);
          };

          img.crossOrigin = "anonymous";
          img.src = src;
        }


        function getCanvasPos(evt) {
          const rect = maskCanvas.getBoundingClientRect();
          return {
            x: ((evt.clientX - rect.left) / rect.width) * maskCanvas.width,
            y: ((evt.clientY - rect.top) / rect.height) * maskCanvas.height,
          };
        }


        function drawCursor(evt) {
          if (!imageLoaded || outpaintMode || viewModeEnabled || !allowEdit) {
            cursorCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            return;
          }
          const pos = getCanvasPos(evt);
          cursorCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          cursorCtx.beginPath();
          cursorCtx.arc(pos.x, pos.y, brushSize, 0, Math.PI * 2);
          cursorCtx.strokeStyle = "rgba(255,255,255,0.9)";
          cursorCtx.lineWidth = 1;
          cursorCtx.stroke();
        }


        function clearCursor() {
          cursorCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        }


        function startDraw(evt) {
          if (!imageLoaded) return;
          if (!allowEdit) return;
          if (outpaintMode) return;
          if (viewModeEnabled) return;

          drawing = true;
          draw(evt);
        }


        function stopDraw() {
          drawing = false;
          maskCtx.beginPath();
        }


        function draw(evt) {
          if (!drawing) return;

          const pos = getCanvasPos(evt);

          if (maskMode === "erase") {
            maskCtx.globalCompositeOperation = "destination-out";
            maskCtx.fillStyle = "rgba(0,0,0,1)";
          } else {
            maskCtx.globalCompositeOperation = "source-over";
            maskCtx.fillStyle = "rgba(0,0,0,1)";
          }

          maskCtx.beginPath();
          maskCtx.arc(pos.x, pos.y, brushSize, 0, Math.PI * 2);
          maskCtx.fill();

          drawCursor(evt);
        }


        function handleModeBtnClick() {
          if (!allowEdit || !imageLoaded) return;
          maskMode = maskMode === "erase" ? "protect" : "erase";
          updateMaskModeButton();
        }


        function handleOutBtnClick() {
          if (!imageLoaded) return;
          if (!allowEdit) return;

          if (!outpaintMode) {
            preOutpaintSrc = workingImageSrc || originalImageSrc;
            outpaintMode = true;
            updateOutpaintButton();
            const base = imageCanvas.toDataURL("image/png");
            loadImageFromSrc(base, { scaleMode: "shrinkForOutpaint", maskMode: "outpaintDefault" });
            statusEl.textContent = "Outpainting mode enabled.";
          } else {
            outpaintMode = false;
            updateOutpaintButton();
            const back = preOutpaintSrc || workingImageSrc || originalImageSrc;
            preOutpaintSrc = null;
            if (back) {
              loadImageFromSrc(back, { scaleMode: "fit", maskMode: "fullBlack" });
            }
            statusEl.textContent = "Inpainting mode enabled.";
          }
        }


        function handleViewBtnClick() {
          if (!imageLoaded) return;
          if (!allowEdit) return;
          if (viewModeForced) return;

          viewModeEnabled = !viewModeEnabled;
          setPreferredViewMode(viewModeEnabled);
          applyViewModeUi();
          recomputeAccessState();
        }


        function handleMaskMouseDown(e) {
          startDraw(e);
        }


        function handleMaskMouseMove(e) {
          if (drawing) draw(e);
          else drawCursor(e);
        }


        function handleMaskMouseLeave() {
          clearCursor();
        }


        function handleTouchStart(e) {
          e.preventDefault();
          if (!e.touches || !e.touches[0]) return;
          startDraw(e.touches[0]);
        }


        function handleTouchEnd(e) {
          e.preventDefault();
          stopDraw();
          clearCursor();
        }


        function handleTouchMove(e) {
          e.preventDefault();
          if (!e.touches || !e.touches[0]) return;
          if (drawing) draw(e.touches[0]);
          else drawCursor(e.touches[0]);
        }


        function handleResetClick() {
          setPublishNotice("", false);
          clearApiError();

          const _resetSrc = originalImageSrc || workingImageSrc;
          if (!_resetSrc) {
            statusEl.textContent = "No original image available.";
            return;
          }

          outpaintMode = false;
          updateOutpaintButton();

          /**********************************************************************************/
          let loadSrc = _resetSrc;
          try {
            const u = new URL(originalImageSrc, window.location.href);
            if (u.origin !== window.location.origin &&
                !originalImageSrc.startsWith("data:") &&
                !originalImageSrc.startsWith("blob:")) {
              loadSrc = INPAINT_BASE + "/proxy?url=" + encodeURIComponent(originalImageSrc);
            }
          } catch {}

          setWorkingImageSrc(loadSrc);
          loadImageFromSrc(loadSrc, { scaleMode: "fit", maskMode: "fullBlack" });
          statusEl.textContent = "Reset back to the original image.";
        }


        function handleDownloadClick() {
          clearApiError();

          if (!imageLoaded) return;

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = drawWidth;
          cropCanvas.height = drawHeight;
          const cropCtx = cropCanvas.getContext("2d");

          cropCtx.drawImage(
            imageCanvas,
            drawOffsetX,
            drawOffsetY,
            drawWidth,
            drawHeight,
            0,
            0,
            drawWidth,
            drawHeight
          );

          cropCanvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "image.png";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, "image/png");
        }


        function handleGalleryClick() {
          clearApiError();
          if (!imageLoaded || !INPAINT_LOGGED_IN) return;

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = drawWidth;
          cropCanvas.height = drawHeight;
          const cropCtx = cropCanvas.getContext("2d");
          cropCtx.drawImage(imageCanvas, drawOffsetX, drawOffsetY, drawWidth, drawHeight, 0, 0, drawWidth, drawHeight);

          galleryBtn.disabled = true;
          const origLabel = galleryBtn.textContent;

          cropCanvas.toBlob(async (blob) => {
            if (!blob) { galleryBtn.disabled = false; return; }
            try {
              const r = await fetch("/gallery/api/files", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "image/png", "X-Filename": "inpainting.png" },
                body: blob
              });
              if (!r.ok && r.headers.get("content-type") && !r.headers.get("content-type").includes("json")) {
                galleryBtn.disabled = false;
                setApiError(r.status === 401 || r.status === 302 ? "Gallery: not logged in" : "Gallery upload failed: " + r.status);
                return;
              }
              let d = null;
              try { d = await r.json(); } catch { /* non-JSON response (e.g. redirect to login page) */ }
              if (d && d.ok) {
                galleryBtn.textContent = "\u2713";
                setTimeout(() => { galleryBtn.textContent = origLabel; galleryBtn.disabled = false; }, 1500);
              } else {
                galleryBtn.disabled = false;
                setApiError(d ? "Gallery upload failed: " + (d.error || "unknown") : "Gallery: not logged in");
              }
            } catch (e) {
              galleryBtn.disabled = false;
              setApiError("Gallery upload failed: " + e.message);
            }
          }, "image/png");
        }


        async function handleUnlockClick() {
          await unlockWithCredentials();
        }


        async function handleUploadClick() {
          if (!INPAINT_LOGGED_IN && !supportsUnlock) return;
          if (!INPAINT_LOGGED_IN && !tokenValid) {
            const ok = await unlockWithCredentials();
            if (!ok) return;
          }
          fileInput.click();
        }


        async function handleFileInputChange(e) {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (!f) return;
          await uploadLocalFile(f);
        }


        let _dragCounter = 0;

        function handleDragEnter(e) {
          if (!INPAINT_LOGGED_IN && !supportsUnlock) return;
          e.preventDefault();
          _dragCounter++;
          canvasArea.classList.add("drag-over");
        }

        function handleDragLeave(e) {
          _dragCounter = Math.max(0, _dragCounter - 1);
          if (_dragCounter === 0) canvasArea.classList.remove("drag-over");
        }

        function handleDragOver(e) {
          if (!INPAINT_LOGGED_IN && !supportsUnlock) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }


        async function handleDrop(e) {
          if (!INPAINT_LOGGED_IN && !supportsUnlock) return;
          e.preventDefault();
          _dragCounter = 0;
          canvasArea.classList.remove("drag-over");

          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (!f) return;

          await uploadLocalFile(f);
        }


        async function storeCurrentViewAndGetUrl() {
          if (!imageLoaded) throw new Error("No image loaded.");

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = drawWidth;
          cropCanvas.height = drawHeight;
          const cropCtx = cropCanvas.getContext("2d");

          cropCtx.drawImage(
            imageCanvas,
            drawOffsetX,
            drawOffsetY,
            drawWidth,
            drawHeight,
            0,
            0,
            drawWidth,
            drawHeight
          );

          const blob = await new Promise((resolve) =>
            cropCanvas.toBlob(resolve, "image/png")
          );
          if (!blob) throw new Error("Could not create PNG blob.");

          const fd = new FormData();
          fd.append("image", blob, "current.png");

          const res = await fetch(INPAINT_BASE + "/api/store", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(String(data.error || "store_failed"));

          if (!data || !data.url) throw new Error("store_returned_no_url");
          return new URL(data.url, window.location.origin).toString();
        }


        async function handlePublishClick() {
          if (!callbackId) {
            setApiError("No channel ID in URL.");
            return;
          }

          clearApiError();
          setPublishNotice("\u23f3 Sending\u2026", false);

          publishBtn.disabled = true;
          editBtn.disabled = true;
          resetBtn.disabled = true;
          downloadBtn.disabled = true;
          galleryBtn.disabled  = true;

          try {
            statusEl.textContent = "Storing current view\u2026";
            const editedAbsUrl = await storeCurrentViewAndGetUrl();

            statusEl.textContent = "Sending to channel\u2026";
            const res = await fetch(INPAINT_BASE + "/api/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                channelId: callbackId,
                editedUrl: editedAbsUrl,
              }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const msg  = String(data.error || "publish_failed");
              const det  = String(data.details || "").trim();
              throw new Error(det ? \`\${msg}: \${det}\` : msg);
            }

            setPublishNotice("\u2705 Sent", false);
            statusEl.textContent = "Sent to channel \u2705";
          } catch (e) {
            setPublishNotice("\u274c Send failed", true);
            statusEl.textContent = "Publish error: " + String((e && e.message) || e);
            setApiError(statusEl.textContent);
          } finally {
            publishBtn.disabled = false;
            editBtn.disabled = false;
            resetBtn.disabled = false;
            downloadBtn.disabled = false;
            galleryBtn.disabled  = !INPAINT_LOGGED_IN;
            recomputeAccessState();
          }
        }


        async function handleEditClick() {
          setPublishNotice("", false);
          clearApiError();

          if (!imageLoaded || !allowEdit) {
            setApiError("Editing is not allowed for this image origin. Unlock to enable.");
            return;
          }

          const prompt = promptInput.value.trim();
          if (!prompt) {
            setApiError("Please enter a prompt.");
            return;
          }

          editBtn.disabled = true;
          resetBtn.disabled = true;
          downloadBtn.disabled = true;
          galleryBtn.disabled  = true;
          viewBtn.disabled = true;
          if (callbackId) publishBtn.disabled = true;

          statusEl.textContent = "Sending image\u2026";

          try {
            const imageBlob = await new Promise((resolve) =>
              imageCanvas.toBlob(resolve, "image/png")
            );
            const maskBlob = await new Promise((resolve) =>
              maskCanvas.toBlob(resolve, "image/png")
            );

            const formData = new FormData();
            formData.append("prompt", prompt);
            formData.append("image", imageBlob, "image.png");
            formData.append("mask", maskBlob, "mask.png");

            if (originalImageSrc) {
              formData.append("origin", originalImageSrc);
            }

            if (engineSelect.value) {
              formData.append("engineId", engineSelect.value);
            }

            const res = await fetch(INPAINT_BASE + "/api/edit", {
              method: "POST",
              headers: { ...getAuthHeaders() },
              body: formData,
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const msg = String(data.message || data.error || "edit_failed");
              const det = String(data.details || "").trim();
              throw new Error(det ? \`\${msg}: \${det}\` : msg);
            }

            statusEl.textContent = "Response received\u2026";

            const editedImg = new Image();
            editedImg.onload = () => {
              const tmpCanvas = document.createElement("canvas");
              tmpCanvas.width = CANVAS_SIZE;
              tmpCanvas.height = CANVAS_SIZE;
              const tmpCtx = tmpCanvas.getContext("2d");
              tmpCtx.drawImage(editedImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

              if (outpaintMode) {
                const nextDataUrl = tmpCanvas.toDataURL("image/png");
                setWorkingImageSrc(nextDataUrl);
                preOutpaintSrc = null;
                statusEl.textContent = "Done (outpainting). Result is shown in the canvas.";

                outpaintMode = false;
                updateOutpaintButton();

                loadImageFromSrc(nextDataUrl, { scaleMode: "fit", maskMode: "fullBlack" });
              } else {
                const cropCanvas = document.createElement("canvas");
                cropCanvas.width = drawWidth;
                cropCanvas.height = drawHeight;
                const cropCtx = cropCanvas.getContext("2d");

                cropCtx.drawImage(
                  tmpCanvas,
                  drawOffsetX,
                  drawOffsetY,
                  drawWidth,
                  drawHeight,
                  0,
                  0,
                  drawWidth,
                  drawHeight
                );

                const nextDataUrl = cropCanvas.toDataURL("image/png");
                setWorkingImageSrc(nextDataUrl);
                statusEl.textContent = "Done (inpainting). Result is shown in the canvas.";

                loadImageFromSrc(nextDataUrl, { scaleMode: "fit", maskMode: "fullBlack" });
              }
            };

            editedImg.onerror = () => {
              statusEl.textContent = "Error loading AI image.";
              setApiError(statusEl.textContent);
            };

            editedImg.src = data.url;
          } catch (err) {
            statusEl.textContent = "Error: " + String(err && err.message ? err.message : err);
            setApiError(statusEl.textContent);
          } finally {
            editBtn.disabled = false;
            resetBtn.disabled = false;
            downloadBtn.disabled = false;
            galleryBtn.disabled  = !INPAINT_LOGGED_IN;
            viewBtn.disabled = false;
            if (publishBtn.style.display !== "none") publishBtn.disabled = !callbackId;
            refreshCanEditFromServer();
          }
        }


        function loadFromQueryUrl() {
          const params = new URLSearchParams(window.location.search);
          const rawImageUrl = params.get("image") || params.get("src") || params.get("url");

          let imageUrl = rawImageUrl;
          if (rawImageUrl) {
            try {
              const u0 = new URL(rawImageUrl, window.location.href);
              const rawHref = u0.href;
              originalImageSrc = rawHref;
              if (u0.origin !== window.location.origin) {
                imageUrl = INPAINT_BASE + "/proxy?url=" + encodeURIComponent(u0.href);
              } else {
                imageUrl = u0.href;
              }
            } catch {
              imageUrl = rawImageUrl;
            }
          }

          callbackId = params.get("id") || null;
          if (callbackId) {
            publishBtn.style.display = "inline-flex";
            publishBtn.disabled = false;
          } else {
            publishBtn.style.display = "none";
          }

          if (!imageUrl) {
            if (INPAINT_LOGGED_IN) {
              statusEl.textContent = "No image loaded. Upload a local image or call this page with ?src=\u2026";
              overlayHint.classList.remove("hidden");
              controlsEl.style.display = "flex";
            } else if (supportsUnlock) {
              statusEl.textContent = "No image URL found. Unlock to upload a local image, or call this page with ?src=\u2026";
              overlayHint.classList.remove("hidden");
              controlsEl.style.display = "flex";
            } else {
              statusEl.textContent = "No image URL provided. Call this page with ?src=\u2026";
              overlayHint.classList.remove("hidden");
            }
            imageLoaded = false;
            allowEdit = false;
            setViewMode(true, true);
            recomputeAccessState();
            return;
          }

          setWorkingImageSrc(imageUrl);
          outpaintMode = false;
          updateOutpaintButton();

          try {
            const u = new URL(originalImageSrc);
            originHost = u.host;
          } catch {
            originHost = null;
          }

          statusEl.textContent = "Loading image from URL\u2026";
          loadImageFromSrc(imageUrl, { scaleMode: "fit", maskMode: "fullBlack" });
        }


        function bindEvents() {
          brushSizeSlider.addEventListener("input", handleBrushSizeInput);

          modeBtn.addEventListener("click", handleModeBtnClick);
          outBtn.addEventListener("click", handleOutBtnClick);
          viewBtn.addEventListener("click", handleViewBtnClick);

          maskCanvas.addEventListener("mousedown", handleMaskMouseDown);
          window.addEventListener("mouseup", stopDraw);
          maskCanvas.addEventListener("mousemove", handleMaskMouseMove);
          maskCanvas.addEventListener("mouseleave", handleMaskMouseLeave);

          maskCanvas.addEventListener("touchstart", handleTouchStart);
          maskCanvas.addEventListener("touchend", handleTouchEnd);
          maskCanvas.addEventListener("touchmove", handleTouchMove);

          resetBtn.addEventListener("click", handleResetClick);
          downloadBtn.addEventListener("click", handleDownloadClick);
          galleryBtn.addEventListener("click", handleGalleryClick);

          unlockBtn.addEventListener("click", handleUnlockClick);
          uploadBtn.addEventListener("click", handleUploadClick);
          fileInput.addEventListener("change", handleFileInputChange);

          canvasArea.addEventListener("dragenter", handleDragEnter);
          canvasArea.addEventListener("dragleave", handleDragLeave);
          canvasArea.addEventListener("dragover", handleDragOver);
          canvasArea.addEventListener("drop", handleDrop);

          publishBtn.addEventListener("click", handlePublishClick);
          editBtn.addEventListener("click", handleEditClick);
        }


        async function bootstrap() {
          initCanvases();
          updateBrushLabel();
          updateMaskModeButton();
          updateOutpaintButton();

          bindEvents();

          viewModeEnabled = getPreferredViewMode();
          applyViewModeUi();

          await Promise.all([fetchConfig(), validateTokenFromSession()]);
          loadFromQueryUrl();
        }

        bootstrap();`

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>🎨 Inpainting</title>
<link rel="stylesheet" href="${basePath}/style.css">
<style>
${toolCss}
body{padding:0;margin:0;background:var(--bg,#f0f2f5);color:var(--txt,#1e293b);display:block}
.app{max-width:980px;margin:0 auto;padding:12px;margin-top:var(--hh)}
.app h1{display:none}
header h1{margin:0}
</style>
</head>
<body>
<header>
  <h1>🎨 Inpainting</h1>
  ${menuHtml || ""}
</header>
<div class="app">
${appInner}
</div>
<script>
var INPAINT_BASE=${JSON.stringify(basePath)};
var INPAINT_LOGGED_IN=${JSON.stringify(isLoggedIn)};
${toolScript}
</script>
</body>
</html>`;
}



/**********************************************************************************/
export default async function getWebpageInpainting(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3113);
  const basePath = getBasePath(cfg);

  if (Number(wo.http?.port) !== port) return coreData;

  const method = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  const allowed = getIsAllowedByRoles(wo, cfg);

  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    setCssResp(wo, fs.readFileSync(cssFile, "utf-8"));
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!allowed) setForbiddenPage(wo, wo.web?.menu || [], urlPath, basePath);
    else setHtmlResp(wo, getInpaintHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, basePath, isLoggedIn: !inpaintGetAuthEnabled(cfg) || !!wo.webAuth?.role }));
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (!allowed && urlPath.startsWith(basePath + "/api/")) {
    setJsonResp(wo, 403, { error: "forbidden" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/proxy") {
    const q = wo.http?.query || {};
    const srcUrl = String(q.url || q.src || q.image || q.u || "").trim();
    if (!srcUrl) {
      setJsonResp(wo, 400, { error: "missing url" });
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    try {
      const u = new URL(srcUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");

      const isLoggedInProxy = !!wo.webAuth?.role || !inpaintGetAuthEnabled(cfg);
      if (!isLoggedInProxy) {
        const wl = cfg?.imageWhitelist || {};
        const hosts = Array.isArray(wl.hosts) ? wl.hosts : [];
        const paths = Array.isArray(wl.paths) ? wl.paths : [];
        if (hosts.length && !hosts.includes(u.hostname)) throw new Error("host_not_allowed");
        if (paths.length && !paths.some((p) => String(u.pathname || "").startsWith(String(p || "")))) throw new Error("path_not_allowed");
      }

      await setProxy(wo, u.href);
    } catch {
      setJsonResp(wo, 400, { error: "invalid url" });
    }
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  function getEnabledEnginesPublic(cfg0) {
    const engines = Array.isArray(cfg0?.engines) ? cfg0.engines : [];
    return engines.filter((e) => e && e.enabled !== false).map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      enabled: e.enabled !== false,
      default: !!e.default
    }));
  }

  function getDefaultEngineId(cfg0) {
    const engines = Array.isArray(cfg0?.engines) ? cfg0.engines : [];
    const enabled = engines.filter((e) => e && e.enabled !== false);
    if (!enabled.length) return null;
    const explicit = enabled.find((e) => e && e.default);
    return String((explicit || enabled[0])?.id || "") || null;
  }

  function getIsOriginWhitelisted(cfg0, origin) {
    const wl = cfg0?.imageWhitelist || {};
    const hosts = Array.isArray(wl.hosts) ? wl.hosts : [];
    const paths = Array.isArray(wl.paths) ? wl.paths : [];
    if (!origin) return false;
    if (!hosts.length) return false;
    try {
      const u = new URL(origin);
      if (!hosts.includes(u.hostname)) return false;
      if (paths.length) return paths.some((p) => u.pathname.startsWith(p));
      return true;
    } catch {
      return false;
    }
  }

  function getIsEditAllowed(cfg0, origin) {
    const o = String(origin || "").trim();
    if (!o) return true;
    if (o.startsWith("data:") || o.startsWith("blob:")) return true;
    if (o.startsWith(basePath + "/proxy")) return true;
    return getIsOriginWhitelisted(cfg0, o);
  }

  if (urlPath === basePath + "/api/config" && method === "GET") {
    const wl = cfg?.imageWhitelist || {};
    const authEnabled = inpaintGetAuthEnabled(cfg);
    /**********************************************************************************/
    const rawChannels = Array.isArray(cfg?.apiChannels) ? cfg.apiChannels : [];
    const apiChannelsPub = rawChannels
      .filter(ch => ch && String(ch.channelId || "").trim())
      .map(ch => ({ channelId: String(ch.channelId), label: String(ch.label || ch.channelId) }));
    setJsonResp(wo, 200, {
      hostsWhitelist: Array.isArray(wl.hosts) ? wl.hosts : [],
      supportsUnlock: authEnabled,
      supportsUpload: authEnabled,
      apiChannels: apiChannelsPub,
      engines: getEnabledEnginesPublic(cfg),
      defaultEngineId: getDefaultEngineId(cfg)
    });
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath === basePath + "/api/can-edit" && method === "POST") {
    let origin = "";
    try {
      const raw = String(wo.http?.rawBody ?? wo.http?.body ?? "");
      const j = raw ? JSON.parse(raw) : {};
      origin = j?.origin || "";
    } catch {}
    setJsonResp(wo, 200, { allowed: getIsEditAllowed(cfg, origin) });
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath === basePath + "/api/validate-token" && method === "POST") {
    const enabled = inpaintGetAuthEnabled(cfg);
    if (!enabled) {
      setJsonResp(wo, 200, { valid: false });
    } else {
      const token = inpaintGetTokenFromWo(wo);
      setJsonResp(wo, 200, { valid: inpaintGetIsTokenValid(token) });
    }
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (urlPath === basePath + "/api/unlock" && method === "POST") {
    const enabled = inpaintGetAuthEnabled(cfg);
    if (!enabled) {
      setJsonResp(wo, 404, { error: "unlock_disabled" });
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    let username = "", password = "";
    try {
      const raw = String(wo.http?.rawBody ?? wo.http?.body ?? "");
      const j = raw ? JSON.parse(raw) : {};
      username = String(j?.username || "").trim();
      password = String(j?.password || "").trim();
    } catch {}
    if (!username || !password) {
      setJsonResp(wo, 400, { error: "username_password_required" });
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const users = inpaintGetAuthUsers(cfg);
    const ok = users.some(u => u.username === username && u.password === password);
    if (!ok) {
      setJsonResp(wo, 401, { error: "invalid_credentials" });
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    const issued = inpaintIssueToken(cfg, username);
    setJsonResp(wo, 200, { token: issued.token, expiresAtMs: issued.expiresAtMs });
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  function getIsSelfResultsAllowed(origin) {
    if (!origin) return false;
    try {
      const u = new URL(origin);
      const rawHost = String(wo.http?.headers?.["x-forwarded-host"] || wo.http?.headers?.["host"] || "");
      const reqHost = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
      if (!reqHost) return false;
      if (u.hostname.toLowerCase() !== reqHost) return false;
      const p = String(u.pathname || "");
      if (!p.startsWith(basePath + "/results/")) return false;
      if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) return false;
      return true;
    } catch { return false; }
  }

  if (method === "GET" && urlPath.startsWith(basePath + "/results/")) {
    const filename = urlPath.slice((basePath + "/results/").length).replace(/\.\./g, "");
    if (!filename || filename.includes("/")) {
      setJsonResp(wo, 404, { error: "not_found" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const rawUrl = String(wo.http?.url || urlPath);
    const qs     = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
    const qParams = new URLSearchParams(qs.slice(1));
    const idVal = qParams.get("id") || "";
    const rawVal = qParams.get("raw") || "";
    if (idVal && rawVal !== "1") {
      const ua  = String(wo.http?.headers?.["user-agent"] || "").toLowerCase();
      const ref = String(wo.http?.headers?.["referer"] || "").toLowerCase();
      const isDiscord = ua.includes("discord") || ref.includes("discord");
      const isFromUi  = ref.includes("/?src=") || ref.includes(basePath);
      if (!isDiscord && !isFromUi) {
        const reqHost = String(wo.http?.headers?.["x-forwarded-host"] || wo.http?.headers?.["host"] || "");
        const proto   = String(wo.http?.headers?.["x-forwarded-proto"] || "https");
        if (reqHost) {
          const rawSrc = `${proto}://${reqHost}${urlPath}?raw=1`;
          const target = `${basePath}/?src=${encodeURIComponent(rawSrc)}&id=${encodeURIComponent(idVal)}`;
          wo.http.response = { status: 303, headers: { Location: target, "Cache-Control": "no-store" }, body: "" };
          wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
        }
      }
    }
    const absPath = path.join(INPAINT_RESULTS_DIR, filename);
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) throw new Error("not_file");
      wo.http.response = { status: 200, filePath: absPath, headers: { "Cache-Control": "no-store" } };
    } catch {
      setJsonResp(wo, 404, { error: "not_found" });
      await setSendNow(wo);
    }
    wo.web.useLayout = false; wo.jump = true; return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/store") {
    const ct = String(wo.http?.headers?.["content-type"] || "");
    const boundary = getMultipartBoundary(ct);
    const rawBytes = Buffer.isBuffer(wo.http?.rawBodyBytes) ? wo.http.rawBodyBytes : Buffer.from(String(wo.http?.rawBody ?? ""), "utf8");
    const parsed   = parseMultipart(rawBytes, boundary);
    const imageFile = parsed.files?.image;

    if (!imageFile) {
      setJsonResp(wo, 400, { error: "image_required" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const filename = `client-${Date.now()}.png`;
    try {
      let resultUrl;
      if (wo.webAuth?.role && wo.http?.query?.toGallery === "1") {
        const saved = await saveFile(wo, imageFile.buffer, { prefix: "inpaint", ext: ".png" });
        resultUrl = saved.url;
      } else {
        fs.writeFileSync(path.join(INPAINT_RESULTS_DIR, filename), imageFile.buffer);
        resultUrl = basePath + "/results/" + filename;
      }
      setJsonResp(wo, 200, { url: resultUrl });
    } catch (e) {
      setJsonResp(wo, 500, { error: "store_failed", details: String(e?.message || e) });
    }
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/upload-local") {
    const isSessionAuth = !!wo.webAuth?.role;
    if (!isSessionAuth && inpaintGetAuthEnabled(cfg) && !inpaintGetIsAuthed(wo)) {
      setJsonResp(wo, 401, { error: "unauthorized" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const ct = String(wo.http?.headers?.["content-type"] || "");
    const boundary = getMultipartBoundary(ct);
    const rawBytes = Buffer.isBuffer(wo.http?.rawBodyBytes) ? wo.http.rawBodyBytes : Buffer.from(String(wo.http?.rawBody ?? ""), "utf8");
    const parsed   = parseMultipart(rawBytes, boundary);
    const imageFile = parsed.files?.image;

    if (!imageFile) {
      setJsonResp(wo, 400, { error: "image_required" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const origName = String(imageFile.filename || "").toLowerCase();
    const ext   = path.extname(origName);
    const safeExt = /\.(png|jpe?g|webp|gif|bmp)$/i.test(ext) ? ext : ".png";
    const filename = `upload-${Date.now()}${safeExt}`;

    try {
      let resultUrl;
      if (wo.webAuth?.role && wo.http?.query?.toGallery === "1") {
        const saved = await saveFile(wo, imageFile.buffer, { prefix: "upload", ext: safeExt });
        resultUrl = saved.url;
      } else {
        fs.writeFileSync(path.join(INPAINT_RESULTS_DIR, filename), imageFile.buffer);
        resultUrl = basePath + "/results/" + filename;
      }
      setJsonResp(wo, 200, { url: resultUrl });
    } catch (e) {
      setJsonResp(wo, 500, { error: "upload_failed", details: String(e?.message || e) });
    }
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/publish") {
    const apiUrl     = String(cfg?.apiUrl || "").trim();
    const rawChannels = Array.isArray(cfg?.apiChannels) ? cfg.apiChannels : [];

    if (!apiUrl || !rawChannels.length) {
      setJsonResp(wo, 503, { error: "api_channels_not_configured" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    let channelId = "", editedUrl = "";
    try {
      const raw = String(wo.http?.rawBody ?? wo.http?.body ?? "");
      const j = raw ? JSON.parse(raw) : {};
      channelId = String(j?.channelId || "").trim();
      editedUrl = String(j?.editedUrl  || "").trim();
    } catch {}

    if (!channelId) { setJsonResp(wo, 400, { error: "missing_channelId" });  wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData; }
    if (!editedUrl) { setJsonResp(wo, 400, { error: "missing_editedUrl" });  wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData; }

    /**********************************************************************************/
    const chCfg = rawChannels.find(ch => String(ch.channelId || "") === channelId);
    if (!chCfg) {
      setJsonResp(wo, 403, { error: "channel_not_allowed" });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const bearerToken = String(chCfg.bearerToken || "").trim();

    try {
      const { default: nodeFetch } = await import("node-fetch");
      const headers = { "Content-Type": "application/json" };
      if (bearerToken) headers["Authorization"] = "Bearer " + bearerToken;

      const resp = await nodeFetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ channelID: channelId, payload: editedUrl })
      });

      const text = await resp.text().catch(() => "");
      if (!resp.ok) {
        let detail = text.slice(0, 500);
        try { const j = JSON.parse(text); detail = j.error || j.message || detail; } catch {}
        setJsonResp(wo, 502, { error: "api_forward_failed", status: resp.status, details: detail });
      } else {
        setJsonResp(wo, 200, { ok: true, forwardedStatus: resp.status });
      }
    } catch (e) {
      setJsonResp(wo, 502, { error: "api_forward_error", details: String(e?.message || e) });
    }
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/edit") {
    const ct = String(wo.http?.headers?.["content-type"] || "");
    const boundary = getMultipartBoundary(ct);
    const rawBytes = Buffer.isBuffer(wo.http?.rawBodyBytes) ? wo.http.rawBodyBytes : Buffer.from(String(wo.http?.rawBody ?? ""), "utf8");
    const parsed   = parseMultipart(rawBytes, boundary);

    const prompt    = String(parsed.fields?.prompt || "Edit the transparent areas of the mask in a reasonable way.");
    const origin    = String(parsed.fields?.origin || "");
    const engineId  = String(parsed.fields?.engineId || "") || getDefaultEngineId(cfg);
    const imageFile = parsed.files?.image;
    const maskFile  = parsed.files?.mask;

    if (!imageFile || !maskFile) {
      setJsonResp(wo, 400, { error: "Both 'image' and 'mask' are required." });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const isSessionAuth = !!wo.webAuth?.role;
    const allowedByWhitelist = getIsOriginWhitelisted(cfg, origin);
    const allowedBySelf      = getIsSelfResultsAllowed(origin);
    const allowedByToken     = inpaintGetIsAuthed(wo);

    if (!isSessionAuth && !allowedByWhitelist && !allowedBySelf && !allowedByToken) {
      setJsonResp(wo, 403, { error: "not_whitelisted", message: "The provided image origin is not allowed for inpainting." });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const engines = Array.isArray(cfg.engines) ? cfg.engines : [];
    const engine  = engines.find(e => e?.id === engineId && e?.enabled !== false);
    if (!engine) {
      setJsonResp(wo, 400, { error: "invalid_engine", message: "Invalid or disabled engine." });
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }

    const type = engine.type;
    const ecfg = engine.config || {};

    try {
      const { default: nodeFetch } = await import("node-fetch");
      let filename;

      if (type === "openai") {
        const apiKey    = ecfg.apiKey;
        const model     = ecfg.model || "dall-e-2";
        const size      = ecfg.size  || "1024x1024";
        const baseUrl   = String(ecfg.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
        if (!apiKey) throw new Error("Missing OpenAI apiKey in engine config");
        const fullPrompt = ecfg.promptPrefix ? `${ecfg.promptPrefix} ${prompt}`.trim() : prompt;

        const isDallE2 = model === "dall-e-2";

        const formFields = {
          model,
          prompt: fullPrompt,
          image: { buffer: imageFile.buffer, filename: "image.png", contentType: "image/png" },
          mask:  { buffer: maskFile.buffer,  filename: "mask.png",  contentType: "image/png" },
          size
        };
        if (isDallE2) {
          formFields.n = "1";
          formFields.response_format = "b64_json";
        }
        if (!isDallE2 && ecfg.quality)      formFields.quality       = ecfg.quality;
        if (!isDallE2 && ecfg.background)   formFields.background    = ecfg.background;
        if (!isDallE2 && ecfg.outputFormat) formFields.output_format = ecfg.outputFormat;

        const { body: formBody, contentType: formCt } = buildMultipartBody(formFields);
        const response = await nodeFetch(`${baseUrl}/v1/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": formCt },
          body: formBody
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`OpenAI error ${response.status}: ${response.statusText} – ${text.slice(0, 500)}`);
        }

        const json  = await response.json();
        const data0 = json.data?.[0];
        let buffer;
        if (data0?.b64_json) {
          buffer = Buffer.from(data0.b64_json, "base64");
        } else if (data0?.url) {
          const imgRes = await nodeFetch(data0.url);
          buffer = Buffer.from(await imgRes.arrayBuffer());
        } else {
          throw new Error("OpenAI returned neither URL nor Base64");
        }

        filename = `edit-openai-${Date.now()}.png`;
        if (wo.webAuth?.role && wo.http?.query?.toGallery === "1") {
          const saved = await saveFile(wo, buffer, { prefix: "inpaint", ext: ".png" });
          filename = null;
          setJsonResp(wo, 200, { url: saved.url, engine: `${engine.type}:${engine.id}` });
        } else {
          fs.writeFileSync(path.join(INPAINT_RESULTS_DIR, filename), buffer);
        }

      } else if (type === "a1111") {
        const sdUrl              = String(ecfg.sdUrl || "http://127.0.0.1:7860");
        const width              = Number(ecfg.width) || 1024;
        const height             = Number(ecfg.height) || 1024;
        const steps              = Number(ecfg.steps)  || 25;
        const cfgScale           = Number(ecfg.cfgScale) || 7;
        const denoisingStrength  = Number(ecfg.denoisingStrength ?? 0.75);
        const samplerName        = String(ecfg.samplerName || "Euler a");
        const inpaintFullResPad  = Number(ecfg.inpaintFullResPadding || 32);
        const maskBlur           = Number(ecfg.maskBlur || 4);
        const inpaintingFill     = Number(ecfg.inpaintingFill ?? 1);
        const negPrompt          = String(ecfg.negativePrompt || "");
        const fullPrompt         = ecfg.promptPrefix ? `${ecfg.promptPrefix} ${prompt}`.trim() : prompt;

        const engineMaskBuf = getEngineMaskBuffer(maskFile.buffer);
        const imageB64      = imageFile.buffer.toString("base64");
        const maskB64       = engineMaskBuf.toString("base64");

        const payload = {
          init_images: [`data:image/png;base64,${imageB64}`],
          mask: `data:image/png;base64,${maskB64}`,
          prompt: fullPrompt,
          negative_prompt: negPrompt,
          denoising_strength: denoisingStrength,
          cfg_scale: cfgScale,
          steps,
          sampler_name: samplerName,
          width,
          height,
          inpaint_full_res: true,
          inpaint_full_res_padding: inpaintFullResPad,
          mask_blur: maskBlur,
          inpainting_fill: inpaintingFill,
          inpaint_only_masked: true,
          inpainting_mask_invert: 0
        };

        const response = await nodeFetch(`${sdUrl}/sdapi/v1/img2img`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const json  = await response.json();
        const outB64 = String(json.images?.[0] || "").replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(outB64, "base64");

        filename = `edit-sd-${Date.now()}.png`;
        if (wo.webAuth?.role && wo.http?.query?.toGallery === "1") {
          const saved = await saveFile(wo, buffer, { prefix: "inpaint", ext: ".png" });
          filename = null;
          setJsonResp(wo, 200, { url: saved.url, engine: `${engine.type}:${engine.id}` });
        } else {
          fs.writeFileSync(path.join(INPAINT_RESULTS_DIR, filename), buffer);
        }

      } else if (type === "replicate") {
        const apiToken     = ecfg.apiToken;
        const apiUrl       = String(ecfg.apiUrl || "https://api.replicate.com/v1");
        const modelVersion = ecfg.modelVersion;
        if (!apiToken || !modelVersion) throw new Error("Missing Replicate apiToken or modelVersion");

        const fullPrompt    = ecfg.promptPrefix ? `${ecfg.promptPrefix} ${prompt}`.trim() : prompt;
        const engineMaskBuf = getEngineMaskBuffer(maskFile.buffer);
        const imageB64      = imageFile.buffer.toString("base64");
        const maskB64       = engineMaskBuf.toString("base64");

        const predictionPayload = {
          version: modelVersion,
          input: {
            prompt: fullPrompt,
            image: `data:image/png;base64,${imageB64}`,
            mask:  `data:image/png;base64,${maskB64}`,
            guidance_scale:      Number(ecfg.guidanceScale || 9),
            num_inference_steps: Number(ecfg.numInferenceSteps || 40),
            prompt_strength:     Number(ecfg.promptStrength ?? 1.0),
            num_outputs: 1
          }
        };

        let response = await nodeFetch(`${apiUrl}/predictions`, {
          method: "POST",
          headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(predictionPayload)
        });
        let prediction = await response.json();

        let attempts = 0;
        while (["starting", "processing", "queued"].includes(prediction.status) && attempts < 90) {
          await new Promise(r => setTimeout(r, 2000));
          response   = await nodeFetch(`${apiUrl}/predictions/${prediction.id}`, { headers: { Authorization: `Token ${apiToken}` } });
          prediction = await response.json();
          attempts++;
        }

        if (prediction.status !== "succeeded") throw new Error(`Replicate failed: ${prediction.status}`);

        const outUrl = prediction.output?.[0];
        const imgRes = await nodeFetch(outUrl);
        const buffer = Buffer.from(await imgRes.arrayBuffer());

        filename = `edit-replicate-${Date.now()}.png`;
        if (wo.webAuth?.role && wo.http?.query?.toGallery === "1") {
          const saved = await saveFile(wo, buffer, { prefix: "inpaint", ext: ".png" });
          filename = null;
          setJsonResp(wo, 200, { url: saved.url, engine: `${engine.type}:${engine.id}` });
        } else {
          fs.writeFileSync(path.join(INPAINT_RESULTS_DIR, filename), buffer);
        }

      } else {
        throw new Error(`Unknown engine type: ${type}`);
      }

      if (filename !== null) {
        setJsonResp(wo, 200, { url: basePath + "/results/" + filename, engine: `${engine.type}:${engine.id}` });
      }
    } catch (err) {
      setJsonResp(wo, 500, { error: "Image edit failed", details: String(err?.message || err) });
    }
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  return coreData;
}

export const fn = getWebpageInpainting;
