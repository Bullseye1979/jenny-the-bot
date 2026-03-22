/************************************************************************************/
/* filename: 00056-webpage-gallery.js                                                *
/* Version 1.0                                                                       *
/* Purpose: Gallery SPA — shows images in the logged-in user's documents directory.  *
/*          Users can open images in inpainting or delete them.                      *
/* Flow: webpage                                                                     *
/* Port: 3120 (cfg.port)                                                             *
/************************************************************************************/

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { saveFile, deleteFile, listUserImages, getUserId, getPublicBaseUrl } from "../core/file.js";

const MODULE_NAME    = "webpage-gallery";
const __dirname_gal  = path.dirname(fileURLToPath(import.meta.url));
const CSS_FILE       = path.join(__dirname_gal, "../shared/webpage/style.css");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

function getRequestBaseUrl(wo) {
  const h = wo?.http?.headers || {};
  const host  = String(h["x-forwarded-host"] || h["host"] || "").trim();
  const proto = String(h["x-forwarded-proto"] || "https").trim();
  return host ? `${proto}://${host}` : "";
}

function setJsonResp(wo, status, obj) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj ?? {})
  };
}

export default async function getWebpageGallery(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const port          = Number(cfg.port || 3120);
  const basePath      = String(cfg.basePath || "/gallery").replace(/\/$/, "");
  const inpaintingUrl = String(cfg.inpaintingUrl || "").replace(/\/$/, "");

  if (wo.http?.port !== port) return coreData;

  const method  = String(wo.http?.method || "GET").toUpperCase();
  const urlPath = String(wo.http?.path || "/").replace(/\/$/, "") || "/";

  if (method === "GET" && urlPath === basePath + "/style.css") {
    try {
      const css = fs.readFileSync(CSS_FILE, "utf-8");
      wo.http.response = { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public,max-age=60" }, body: css };
    } catch {
      wo.http.response = { status: 404, headers: { "Content-Type": "text/plain" }, body: "Not found" };
    }
    wo.jump = true;
    return coreData;
  }

  if (!wo.webAuth?.role) {
    wo.http.response = { status: 302, headers: { "Location": "/" }, body: "" };
    wo.jump = true;
    return coreData;
  }

  const role = String(wo.webAuth?.role || "").toLowerCase();
  const menu = Array.isArray(wo.web?.menu) ? wo.web.menu : [];

  if (method === "GET" && urlPath === basePath + "/api/files") {
    const userId  = getUserId(wo);
    const baseUrl = getRequestBaseUrl(wo) || getPublicBaseUrl(wo);
    const images  = await listUserImages(wo);

    const files = images.map(filename => {
      const url = baseUrl
        ? `${baseUrl}/documents/${userId}/${filename}`
        : `/documents/${userId}/${filename}`;
      return { filename, url };
    });

    setJsonResp(wo, 200, { ok: true, files });
    wo.jump = true;
    return coreData;
  }

  if (method === "DELETE" && urlPath === basePath + "/api/files") {
    const body     = wo.http?.json || {};
    const filename = String(body.filename || "").trim();

    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      setJsonResp(wo, 400, { ok: false, error: "invalid_filename" });
      wo.jump = true;
      return coreData;
    }

    const ext = path.extname(filename).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      setJsonResp(wo, 400, { ok: false, error: "not_an_image" });
      wo.jump = true;
      return coreData;
    }

    try {
      await deleteFile(wo, filename);
      setJsonResp(wo, 200, { ok: true });
    } catch {
      setJsonResp(wo, 404, { ok: false, error: "not_found" });
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "POST" && urlPath === basePath + "/api/files") {
    const rawBody = wo.http?.rawBodyBytes;
    if (!rawBody || !rawBody.length) {
      setJsonResp(wo, 400, { ok: false, error: "no_body" });
      wo.jump = true;
      return coreData;
    }

    const headerFilename = String(wo.http?.headers?.["x-filename"] || "").trim();
    const safeFilename   = path.basename(headerFilename) || "upload";
    const ext            = path.extname(safeFilename).toLowerCase();

    if (!IMAGE_EXTS.has(ext)) {
      setJsonResp(wo, 400, { ok: false, error: "not_an_image" });
      wo.jump = true;
      return coreData;
    }

    try {
      const baseName = path.basename(safeFilename, ext) || "gallery";
      const baseUrl  = getRequestBaseUrl(wo) || getPublicBaseUrl(wo);
      const result   = await saveFile(wo, rawBody, { ext, name: baseName, publicBaseUrl: baseUrl });
      setJsonResp(wo, 200, { ok: true, url: result.url, filename: result.filename });
    } catch {
      setJsonResp(wo, 500, { ok: false, error: "save_failed" });
    }
    wo.jump = true;
    return coreData;
  }

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    const menuHtml = getMenuHtml(menu, basePath, role, null, null, wo.webAuth);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gallery</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
body{overflow-y:auto}
#gallery-view{padding:20px;max-width:1200px;margin:calc(var(--hh,52px) + 20px) auto 20px;}
#gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;}
.gal-card{background:var(--bg2,#fff);border:1px solid var(--bdr,#e2e8f0);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;}
.gal-thumb{width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;background:var(--bg,#f8f9fa);}
.gal-info{padding:8px 10px;font-size:11px;color:var(--muted,#64748b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gal-actions{display:flex;gap:6px;padding:0 10px 10px;}
.gal-btn{flex:1;padding:5px 4px;font-size:11px;border:none;border-radius:5px;cursor:pointer;font-weight:500;}
.gal-btn-inp{background:var(--acc,#3b82f6);color:#fff;}
.gal-btn-inp:hover{background:var(--acc2,#2563eb);}
.gal-btn-del{background:var(--bg2,#f1f5f9);color:var(--txt,#1e293b);border:1px solid var(--bdr,#e2e8f0);}
.gal-btn-del:hover{background:#fecaca;color:#dc2626;border-color:#fca5a5;}
#gallery-empty{text-align:center;padding:60px 20px;color:var(--muted,#64748b);display:none;}
#gallery-loading{text-align:center;padding:60px 20px;color:var(--muted,#64748b);}
</style>
</head>
<body>
<header>
  <h1>&#128444; Gallery</h1>
  ${menuHtml}
</header>
<div id="gallery-view">
  <div id="gallery-loading">Loading&#8230;</div>
  <div id="gallery-grid"></div>
  <div id="gallery-empty">No images found in your gallery.</div>
</div>
<script>
var INPAINTING_URL = ${JSON.stringify(inpaintingUrl)};
var BASE_PATH = ${JSON.stringify(basePath)};

function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

async function loadGallery(){
  var grid    = document.getElementById("gallery-grid");
  var empty   = document.getElementById("gallery-empty");
  var loading = document.getElementById("gallery-loading");
  try {
    var r = await fetch(BASE_PATH + "/api/files", { redirect: "error" });
    var d = await r.json();
    if (!d.ok || !d.files || !d.files.length) {
      empty.style.display = "block";
      return;
    }
    d.files.forEach(function(f) {
      var card = document.createElement("div");
      card.className = "gal-card";
      card.innerHTML =
        '<img class="gal-thumb" src="' + escHtml(f.url) + '" alt="" loading="lazy" onerror="this.style.opacity=0.3">' +
        '<div class="gal-info" title="' + escHtml(f.filename) + '">' + escHtml(f.filename) + '</div>' +
        '<div class="gal-actions">' +
          '<button class="gal-btn gal-btn-inp" data-url="' + escHtml(f.url) + '">&#9998; Inpainting</button>' +
          '<button class="gal-btn gal-btn-del" data-filename="' + escHtml(f.filename) + '">&#128465; Delete</button>' +
        '</div>';
      card.querySelector(".gal-btn-inp").addEventListener("click", function() {
        var url = this.getAttribute("data-url");
        if (INPAINTING_URL) window.open(INPAINTING_URL + "?src=" + encodeURIComponent(url) + "&toGallery=1", "_blank");
        else alert("Inpainting URL not configured");
      });
      card.querySelector(".gal-btn-del").addEventListener("click", async function() {
        var fn = this.getAttribute("data-filename");
        if (!confirm("Delete " + fn + "?")) return;
        try {
          var r2 = await fetch(BASE_PATH + "/api/files", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: fn })
          });
          var d2 = await r2.json();
          if (d2.ok) { card.remove(); if (!grid.children.length) empty.style.display = "block"; }
          else alert("Delete failed: " + (d2.error || "unknown"));
        } catch(e) { alert("Delete failed: " + e.message); }
      });
      grid.appendChild(card);
    });
  } catch(e) {
    empty.textContent = "Error loading gallery: " + (e.message || String(e));
    empty.style.display = "block";
  } finally {
    loading.style.display = "none";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadGallery);
} else {
  loadGallery();
}
</script>
</body>
</html>`;

    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: html
    };
    wo.jump = true;
    return coreData;
  }

  return coreData;
}
