/**********************************************************************************/
/* filename: 00052-webpage-wiki.js                                                */
/* Version 1.0                                                                    */
/* Purpose: Fandom-style AI-driven wiki. Per-channel wiki at /wiki/{channelId}.  */
/*          Articles stored in MySQL; AI generates article + DALL-E image on     */
/*          first search. Roles: allowedRoles (read), creatorRoles (generate),   */
/*          editorRoles (edit+delete), adminRoles (all — includes editor+creator).*/
/**********************************************************************************/

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getDb, getThemeHeadScript } from "../shared/webpage/interface.js";
/* sharp is optional — if not installed, thumbnail generation is skipped gracefully */
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* sharp not available */ }

const MODULE_NAME = "webpage-wiki";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* Width used for article card thumbnails on the homepage */
const THUMB_WIDTH = 400;

/* Resolve or generate a JPEG thumbnail cached to thumbsDir/{filename}.jpg.
 * Regenerates automatically when the source file is newer than the cached thumbnail.
 * Returns { buf, mime } or null on failure (also null when sharp is not installed). */
async function getThumb(srcPath, thumbsDir, filename, width) {
  if (!sharp) return null;
  const thumbPath = path.join(thumbsDir, filename + ".jpg");
  try {
    const [srcStat, thumbStat] = await Promise.all([
      fs.promises.stat(srcPath),
      fs.promises.stat(thumbPath).catch(() => null)
    ]);
    if (thumbStat && thumbStat.mtimeMs >= srcStat.mtimeMs) {
      return { buf: await fs.promises.readFile(thumbPath), mime: "image/jpeg" };
    }
  } catch { /* srcPath missing — fall through to sharp */ }
  try {
    await fs.promises.mkdir(thumbsDir, { recursive: true });
    const buf = await sharp(srcPath)
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    await fs.promises.writeFile(thumbPath, buf);
    return { buf, mime: "image/jpeg" };
  } catch { return null; }
}

/* Extract the URL path from an absolute or relative URL */
function getUrlPath(url) {
  if (!url) return "";
  try { return new URL(url).pathname.split("?")[0]; } catch { return String(url).split("?")[0]; }
}

/* Derive the thumbnail URL for a given image URL and width.
 * Works for both relative (/documents/wiki/img.png) and absolute (https://host/documents/wiki/img.png).
 * Returns the pre-generated thumbnail path; the original URL is used as onerror fallback. */
function getThumbUrl(imageUrl, width) {
  if (!imageUrl) return imageUrl;
  const urlPath = getUrlPath(imageUrl);
  if (!urlPath.startsWith("/")) return imageUrl;
  const dir      = path.posix.dirname(urlPath);
  const filename = path.posix.basename(urlPath);
  const thumbPath = `${dir}/thumbnails/${width}/${filename}.jpg`;
  try { const u = new URL(imageUrl); return u.origin + thumbPath; } catch { return thumbPath; }
}

/* Eagerly generate a thumbnail for a freshly saved image URL (fire-and-forget). */
async function ensureThumb(imageUrl, width) {
  if (!imageUrl || !sharp) return;
  const urlPath = getUrlPath(imageUrl);
  if (!urlPath.startsWith("/")) return;
  const absPath  = path.join(__dirname, "..", "pub", urlPath);
  const thumbDir = path.join(path.dirname(absPath), "thumbnails", String(width));
  await getThumb(absPath, thumbDir, path.basename(absPath), width);
}


function getStr(v) { return v == null ? "" : String(v); }


function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function getUserRoleLabels(wo) {
  const out = [], seen = new Set();
  const primary = getStr(wo?.webAuth?.role).trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = getStr(r).trim().toLowerCase();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  return out;
}


function getIsAllowed(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set(getUserRoleLabels(wo));
  return req.some(r => have.has(getStr(r).trim().toLowerCase()));
}


async function setSendNow(wo) {
  const res = wo?.http?.res;
  if (!res || res.writableEnded || res.headersSent) return;
  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "text/html; charset=utf-8" };
  const body    = r.body    ?? "";
  try {
    res.writeHead(status, headers);
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  } catch { /* already sent */ }
}


async function sendJson(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(data)
  };
  await setSendNow(wo);
}


async function sendHtml(wo, status, html) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html
  };
  await setSendNow(wo);
}


async function sendText(wo, status, text) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: text
  };
  await setSendNow(wo);
}


function getSlug(title) {
  return getStr(title).toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}


async function getWikiDb(coreData) {
  const db = await getDb(coreData);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      channel_id  VARCHAR(128)  NOT NULL,
      slug        VARCHAR(128)  NOT NULL,
      title       VARCHAR(512)  NOT NULL,
      intro       TEXT,
      sections    LONGTEXT,
      infobox     TEXT,
      categories  TEXT,
      related     TEXT,
      image_url   VARCHAR(512),
      image_prompt TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY ux_chan_slug (channel_id, slug),
      FULLTEXT KEY ft_search (title, intro, categories, related)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  /* Migrate existing tables that predate updated_at / model */
  await db.execute(
    "ALTER TABLE wiki_articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT NULL"
  );
  await db.execute(
    "ALTER TABLE wiki_articles ADD COLUMN IF NOT EXISTS model VARCHAR(256) NULL DEFAULT NULL"
  );
  return db;
}


function getMaxAgeDays(channel) {
  const v = Number(channel.maxAgeDays ?? 7);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 7;
}


async function dbPruneExpiredArticles(db, channelId, maxAgeDays) {
  if (!maxAgeDays || maxAgeDays <= 0) return;
  await db.execute(
    "DELETE FROM wiki_articles WHERE channel_id = ? AND updated_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [channelId, maxAgeDays]
  );
}


async function dbGetRecentArticles(db, channelId, maxAgeDays = 0, limit = 10) {
  let sql = "SELECT slug, title, intro, categories, image_url, created_at FROM wiki_articles WHERE channel_id = ?";
  const params = [channelId];
  if (maxAgeDays > 0) { sql += " AND (updated_at IS NOT NULL OR created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))"; params.push(maxAgeDays); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const [rows] = await db.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}


async function dbGetArticle(db, channelId, slug, maxAgeDays = 0) {
  const [rows] = await db.execute(
    "SELECT * FROM wiki_articles WHERE channel_id = ? AND slug = ? LIMIT 1",
    [channelId, slug]
  );
  if (!Array.isArray(rows) || !rows.length) return null;
  const article = rows[0];
  if (maxAgeDays > 0 && article.created_at && !article.updated_at) {
    const ageDays = (Date.now() - new Date(article.created_at).getTime()) / 86400000;
    if (ageDays > maxAgeDays) {
      await dbDeleteArticle(db, channelId, slug).catch(() => {});
      return null;
    }
  }
  return article;
}


async function dbSearchArticles(db, channelId, query, maxAgeDays = 0) {
  const q = getStr(query).trim();
  if (!q) return [];
  const ageClause = maxAgeDays > 0 ? " AND (updated_at IS NOT NULL OR created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))" : "";
  /* FULLTEXT for longer queries; LIKE fallback for short ones */
  if (q.length >= 3) {
    try {
      const ftQuery = q.split(/\s+/).filter(Boolean).map(w => `+${w}*`).join(" ");
      const ftParams = [channelId, ftQuery, ...(maxAgeDays > 0 ? [maxAgeDays] : [])];
      const [rows] = await db.execute(
        `SELECT slug, title, intro, categories, image_url, created_at FROM wiki_articles WHERE channel_id = ? AND MATCH(title, intro, categories, related) AGAINST (? IN BOOLEAN MODE)${ageClause} LIMIT 20`,
        ftParams
      );
      if (rows.length) return rows;
    } catch { /* fall through to LIKE */ }
  }
  const like = `%${q}%`;
  const likeParams = [channelId, like, like, ...(maxAgeDays > 0 ? [maxAgeDays] : [])];
  const [rows] = await db.execute(
    `SELECT slug, title, intro, categories, image_url, created_at FROM wiki_articles WHERE channel_id = ? AND (title LIKE ? OR intro LIKE ?)${ageClause} LIMIT 20`,
    likeParams
  );
  return rows;
}


async function dbSaveArticle(db, channelId, slug, article) {
  let finalSlug = slug;
  let attempt   = 0;
  while (true) {
    try {
      await db.execute(
        `INSERT INTO wiki_articles (channel_id, slug, title, intro, sections, infobox, categories, related, image_url, image_prompt, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          channelId,
          finalSlug,
          getStr(article.title),
          getStr(article.intro),
          JSON.stringify(Array.isArray(article.sections) ? article.sections : []),
          JSON.stringify(article.infobox || {}),
          JSON.stringify(Array.isArray(article.categories) ? article.categories : []),
          JSON.stringify(Array.isArray(article.relatedTerms) ? article.relatedTerms : []),
          article.image_url || null,
          article.imagePrompt || null,
          article._model || null
        ]
      );
      return finalSlug;
    } catch (e) {
      if (e?.code === "ER_DUP_ENTRY" && attempt < 10) {
        attempt++;
        finalSlug = `${slug}-${attempt + 1}`;
        continue;
      }
      throw e;
    }
  }
}


async function dbDeleteArticle(db, channelId, slug) {
  await db.execute(
    "DELETE FROM wiki_articles WHERE channel_id = ? AND slug = ?",
    [channelId, slug]
  );
}


async function dbUpdateArticle(db, channelId, slug, updates) {
  const toJson = (v, fallback) => {
    if (typeof v === "string") return v;
    return JSON.stringify(v ?? fallback);
  };
  await db.execute(
    `UPDATE wiki_articles
        SET title=?, intro=?, sections=?, infobox=?, categories=?, related=?, image_url=?,
            updated_at=NOW()
      WHERE channel_id=? AND slug=?`,
    [
      getStr(updates.title),
      getStr(updates.intro),
      toJson(updates.sections, []),
      toJson(updates.infobox,  {}),
      toJson(updates.categories, []),
      toJson(updates.related,    []),
      getStr(updates.image_url) || null,
      channelId,
      slug
    ]
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Embedded image generation — independent of tools/getImage.js.
   Config keys under core.json["webpage-wiki"].imageGen:
     apiKey        — API key for the image generation endpoint (required)
     endpoint      — image endpoint URL (default: OpenAI images/generations)
     model         — model name (default: gpt-image-1)
     size          — explicit size string e.g. "1024x1024" (overrides aspect)
     aspect        — aspect ratio e.g. "1:1", "16:9", "portrait" (default: 1:1)
     publicBaseUrl — prefix for returned image URLs (optional; relative if unset)
   ───────────────────────────────────────────────────────────────────────────── */

function wikiImgResolveSize(cfg) {
  const raw = String(cfg?.size || "").trim();
  const mSize = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (mSize) return `${Number(mSize[1])}x${Number(mSize[2])}`;
  const asp = String(cfg?.aspect || "").trim().toLowerCase();
  const mAsp = asp === "portrait"   ? [null, "2", "3"]
             : asp === "landscape"  ? [null, "16", "9"]
             : asp === "widescreen" ? [null, "16", "9"]
             : asp.match(/^(\d+)\s*:\s*(\d+)$/);
  if (mAsp) {
    const aw = Number(mAsp[1]), ah = Number(mAsp[2]);
    if (aw > 0 && ah > 0) {
      const base = 1024;
      const ratio = aw / ah;
      const w = ratio >= 1 ? base : Math.round(base * ratio / 64) * 64 || 64;
      const h = ratio >= 1 ? Math.round(base / ratio / 64) * 64 || 64 : base;
      return `${w}x${h}`;
    }
  }
  return "1024x1024";
}

function wikiImgEnhancePrompt(raw) {
  const p = String(raw || "").replace(/\s+/g, " ").trim();
  return [
    p,
    "Style: digital painting, painterly brushwork, studio quality, cinematic, creative angles",
    "Quality: vibrant colors, vibrant lighting, sharp focus, high quality, highly detailed faces, anatomically correct hands",
    "Avoid: text, captions, logos, watermarks, deformed hands, extra fingers, low-res, distorted anatomy"
  ].join(" | ");
}

async function wikiGenImage(prompt, imgCfg, wo) {
  const apiKey = getStr(imgCfg?.apiKey || wo?.apiKey || "");
  if (!apiKey) throw new Error("Wiki image generation requires imageGen.apiKey in webpage-wiki config");

  const endpoint = getStr(imgCfg?.endpoint || "https://api.openai.com/v1/images/generations");
  const model    = getStr(imgCfg?.model    || "gpt-image-1");
  const size     = wikiImgResolveSize(imgCfg);
  const finalPrompt = wikiImgEnhancePrompt(prompt);

  let res, data;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: finalPrompt, size, n: 1 })
    });
    const raw = await res.text();
    try { data = JSON.parse(raw); }
    catch { throw new Error(`Image API non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300)}`); }
  } catch (e) {
    throw new Error(`Image API request failed: ${e?.message || String(e)}`);
  }
  if (!res.ok) {
    throw new Error(`Image API error (HTTP ${res.status}): ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  }

  const img = Array.isArray(data?.data) ? data.data[0] : null;
  if (!img) throw new Error("Image API returned no image data");

  let buf, ext;
  if (img.url) {
    try {
      const imgRes = await fetch(img.url);
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
      const ct = String(imgRes.headers.get("content-type") || "");
      ext = ct.includes("jpeg") || ct.includes("jpg") ? ".jpg"
          : ct.includes("webp") ? ".webp"
          : ".png";
      buf = Buffer.from(await imgRes.arrayBuffer());
    } catch (e) {
      throw new Error(`Failed to download generated image: ${e?.message || String(e)}`);
    }
  } else if (img.b64_json) {
    buf = Buffer.from(img.b64_json, "base64");
    ext = ".png";
  } else {
    throw new Error("Image API returned neither url nor b64_json");
  }

  const { saveFile } = await import("../core/file.js");
  const fileWo = { ...(wo || {}), userId: "wiki" };
  if (imgCfg?.publicBaseUrl) fileWo.baseUrl = getStr(imgCfg.publicBaseUrl);
  const saved = await saveFile(fileWo, buf, { prefix: "img", ext });
  return saved.url;
}


/* NOTE: The wiki AI system prompt and tools (getInformation, getTimeline) are
 * configured in core.json per wiki channelId (api-channel-config), just like
 * the browser-extension channel. cfg.apiUrl points to the internal API flow. */


async function callPipelineForArticle(query, channel, coreData, promptAddition) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  /* POST to the internal API flow.
   * All AI parameters (model, endpoint, apiKey, systemPrompt, tools, etc.) are
   * configured per channel-ID in core.json (api-channel-config / core-channel-config),
   * mirroring how the browser-extension channel is configured. */
  const apiUrl    = getStr(cfg.apiUrl || "http://localhost:3400/api");
  const apiSecret = getStr(wo.apiSecret || "");

  const payload = `Topic: ${query}` + (promptAddition ? `\n\nAdditional context: ${promptAddition}` : "");
  const reqBody = { channelID: channel.channelId, payload, userId: "wiki", doNotWriteToContext: true };

  const headers = { "Content-Type": "application/json" };
  if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

  let data;
  try {
    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
    data = await res.json();
    if (!res.ok) throw new Error(`API responded ${res.status}: ${data?.error || res.statusText}`);
  } catch (e) {
    throw new Error(`API call failed: ${e?.message || String(e)}`);
  }

  const responseText = getStr(data?.response || "").trim();
  if (!responseText) throw new Error("API returned no response: " + JSON.stringify(data).slice(0, 200));

  /* Parse the JSON article from the AI response */
  let article = null;
  try { article = JSON.parse(responseText); } catch {
    const m = responseText.match(/\{[\s\S]*\}/);
    if (m) { try { article = JSON.parse(m[0]); } catch { /* ignored */ } }
  }
  if (!article || typeof article !== "object") {
    throw new Error("AI returned no valid JSON article: " + responseText.slice(0, 200));
  }

  /* Generate article illustration via embedded image gen (independent of AI) */
  const imgCfg    = (cfg.imageGen && typeof cfg.imageGen === "object") ? cfg.imageGen : {};
  const imgPrompt = getStr(article.infobox?.imageAlt || article.title || query);
  if (imgPrompt) {
    try {
      article.image_url = await wikiGenImage(imgPrompt, imgCfg, wo);
    } catch { /* image generation failed — article saves without image, regen available in editor */ }
  }

  return article;
}


async function callPipelineForImageOnly(article, channel, coreData, promptAddition) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const globalOverrides = (cfg.overrides && typeof cfg.overrides === "object") ? cfg.overrides : {};
  const chanOverrides   = (channel.overrides && typeof channel.overrides === "object") ? channel.overrides : {};
  const overrides       = { ...globalOverrides, ...chanOverrides };

  const infobox     = safeParseJson(article.infobox, {});
  const basePrompt  = getStr(article.image_prompt || infobox.imageAlt || article.title);
  const imagePrompt = basePrompt + (promptAddition ? `\n${promptAddition}` : "");

  if (!imagePrompt.trim()) throw new Error("No image prompt available for this article");

  const imgCfg  = (cfg.imageGen && typeof cfg.imageGen === "object") ? cfg.imageGen : {};
  const imgBase = { apiKey: getStr(overrides.apiKey || wo.apiKey || "") };
  return wikiGenImage(imagePrompt, imgCfg, imgBase);
}


function getStyleCss() {
  let sharedCss = "";
  try {
    const cssPath = path.join(__dirname, "..", "shared", "webpage", "style.css");
    sharedCss = fs.readFileSync(cssPath, "utf-8");
  } catch { /* ignore */ }
  return sharedCss;
}


function buildPageHeader(title, basePath, channelId, menu, role, webAuth) {
  const chPath   = channelId ? `${basePath}/${channelId}` : basePath;
  const menuHtml = getMenuHtml(menu, chPath, role, null, null, webAuth);
  const searchBar = channelId
    ? `<div class="wiki-search-bar"><form class="wiki-search-form" action="${escHtml(chPath)}/search" method="get"><input class="wiki-search-input" type="text" name="q" placeholder="Search or create…" autocomplete="off"><button class="wiki-search-btn" type="submit">Go</button></form></div>`
    : "";
  return `<header>
  <a class="wiki-logo-link" href="${escHtml(chPath)}">
    <span class="wiki-logo">🗺️</span>
    <span class="wiki-title">${escHtml(title)}</span>
  </a>
  ${menuHtml}
</header>${searchBar}`;
}


function buildWikiCss() {
  return `
/* === Wiki theme vars — light === */
:root {
  --wiki-bg: var(--bg);
  --wiki-surface: var(--bg2);
  --wiki-surface2: #dde4f0;
  --wiki-accent: #e94560;
  --wiki-accent2: #533483;
  --wiki-text: var(--txt);
  --wiki-text-muted: var(--muted);
  --wiki-border: var(--bdr);
  --wiki-link: var(--acc);
  --wiki-infobox-bg: #eef2ff;
  --wiki-toc-bg: #f8fafc;
  --wiki-chip-bg: #e2e8f0;
  --wiki-chip-text: var(--txt);
}
/* === Wiki theme vars — dark === */
[data-theme="dark"] {
  --wiki-bg: #1a1a2e;
  --wiki-surface: #16213e;
  --wiki-surface2: #0f3460;
  --wiki-text: #e0e0e0;
  --wiki-text-muted: #a0a0b0;
  --wiki-border: #2a2a4a;
  --wiki-link: #7eb8f7;
  --wiki-infobox-bg: #1e2a4a;
  --wiki-toc-bg: #1e1e3a;
  --wiki-chip-bg: #2a2a4a;
  --wiki-chip-text: #b0b0d0;
}
* { box-sizing: border-box; }
body { background: var(--wiki-bg); color: var(--wiki-text); font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; overflow-y: auto; padding-top: var(--hh); }
a { color: var(--wiki-link); text-decoration: none; }
a:hover { text-decoration: underline; }
.wiki-logo-link { display: flex; align-items: center; gap: 6px; color: #f1f5f9; font-size: 15px; font-weight: 700; white-space: nowrap; letter-spacing: -.2px; text-decoration: none; flex-shrink: 0; }
.wiki-logo { font-size: 1em; }
.wiki-search-bar { display: flex; justify-content: flex-end; padding: 6px 16px; background: var(--wiki-surface); border-bottom: 1px solid var(--wiki-border); }
.wiki-search-form { display: flex; gap: 6px; }
.wiki-search-input { background: var(--wiki-bg); border: 1px solid var(--wiki-border); color: var(--wiki-text); padding: 7px 12px; border-radius: 4px; width: 260px; font-size: 0.95em; }
.wiki-search-input:focus { outline: none; border-color: var(--wiki-accent); }
.wiki-search-btn { background: var(--wiki-accent); color: #fff; border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; font-size: 0.95em; }
.wiki-search-btn:hover { background: #c73450; }
@media (max-width: 600px) { .wiki-search-bar { padding: 6px 10px; } .wiki-search-input { width: 100%; min-width: 0; } .wiki-search-form { width: 100%; } }
.wiki-breadcrumb { background: var(--wiki-surface2); padding: 7px 24px; font-size: 0.85em; color: var(--wiki-text-muted); border-bottom: 1px solid var(--wiki-border); }
.wiki-breadcrumb a { color: var(--wiki-text-muted); }
.wiki-breadcrumb a:hover { color: var(--wiki-link); }
.wiki-content-wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
.wiki-article-layout { display: flex; gap: 28px; align-items: flex-start; }
.wiki-article-main { flex: 1; min-width: 0; }
.wiki-article-sidebar { width: 300px; flex-shrink: 0; }
@media (max-width: 768px) { .wiki-article-layout { flex-direction: column; } .wiki-article-sidebar { width: 100%; } }
.wiki-article-title { font-size: 2em; font-weight: bold; color: var(--wiki-text); margin: 0 0 4px 0; border-bottom: 2px solid var(--wiki-accent); padding-bottom: 8px; display: flex; align-items: center; gap: 12px; }
.wiki-delete-btn { font-size: 0.5em; background: #8b2020; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; vertical-align: middle; }
.wiki-delete-btn:hover { background: var(--wiki-accent); }
.wiki-intro { margin: 16px 0; line-height: 1.7; font-size: 1.02em; }
.wiki-toc { background: var(--wiki-toc-bg); border: 1px solid var(--wiki-border); border-radius: 6px; padding: 14px 18px; margin: 18px 0; display: inline-block; min-width: 200px; max-width: 100%; }
.wiki-toc-title { font-weight: bold; margin-bottom: 8px; font-size: 0.95em; color: var(--wiki-text-muted); }
.wiki-toc ol { margin: 0; padding-left: 20px; }
.wiki-toc li { margin: 3px 0; font-size: 0.9em; }
.wiki-section { margin: 24px 0; }
.wiki-section h2 { font-size: 1.35em; border-bottom: 1px solid var(--wiki-border); padding-bottom: 4px; color: var(--wiki-text); }
.wiki-section h3 { font-size: 1.1em; color: var(--wiki-text); }
.wiki-section p { line-height: 1.75; }
.wiki-infobox { background: var(--wiki-infobox-bg); border: 1px solid var(--wiki-border); border-radius: 8px; overflow: hidden; }
.wiki-infobox-img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
.wiki-infobox table { width: 100%; border-collapse: collapse; }
.wiki-infobox td { padding: 7px 12px; border-top: 1px solid var(--wiki-border); font-size: 0.9em; vertical-align: top; }
.wiki-infobox td:first-child { font-weight: bold; color: var(--wiki-text-muted); white-space: nowrap; width: 40%; }
.wiki-categories { margin: 28px 0 12px; }
.wiki-categories-title { font-size: 0.85em; color: var(--wiki-text-muted); margin-bottom: 8px; }
.wiki-chip { display: inline-block; background: var(--wiki-chip-bg); color: var(--wiki-chip-text); border-radius: 20px; padding: 3px 12px; margin: 3px; font-size: 0.85em; cursor: pointer; border: 1px solid var(--wiki-border); }
.wiki-chip:hover { background: var(--wiki-surface2); color: var(--wiki-text); }
.wiki-seealso { margin: 16px 0; font-size: 0.95em; color: var(--wiki-text-muted); border-top: 1px solid var(--wiki-border); padding-top: 12px; }
.wiki-seealso a { color: var(--wiki-link); margin: 0 6px; }
.wiki-index { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; margin-top: 20px; }
.wiki-channel-card { background: var(--wiki-surface); border: 1px solid var(--wiki-border); border-radius: 8px; padding: 18px; }
.wiki-channel-card h3 { margin: 0 0 8px 0; color: var(--wiki-text); }
.wiki-channel-card p { margin: 0; font-size: 0.9em; color: var(--wiki-text-muted); }
.wiki-recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 18px; }
.wiki-article-card { background: var(--wiki-surface); border: 1px solid var(--wiki-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
.wiki-article-card-img { width: 100%; height: 130px; object-fit: cover; }
.wiki-article-card-img-placeholder { width: 100%; height: 130px; background: var(--wiki-surface2); display: flex; align-items: center; justify-content: center; font-size: 2em; }
.wiki-article-card-body { padding: 12px; flex: 1; }
.wiki-article-card-title { font-weight: bold; color: var(--wiki-text); margin-bottom: 4px; font-size: 0.95em; }
.wiki-article-card-intro { font-size: 0.82em; color: var(--wiki-text-muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wiki-search-results { margin-top: 18px; }
.wiki-search-result { background: var(--wiki-surface); border: 1px solid var(--wiki-border); border-radius: 6px; padding: 14px 18px; margin-bottom: 12px; }
.wiki-search-result h3 { margin: 0 0 4px 0; }
.wiki-search-result p { margin: 0; font-size: 0.88em; color: var(--wiki-text-muted); }
.wiki-spinner-wrap { text-align: center; padding: 60px 20px; }
.wiki-spinner { display: inline-block; width: 40px; height: 40px; border: 4px solid var(--wiki-border); border-top-color: var(--wiki-accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.wiki-spinner-msg { margin-top: 18px; color: var(--wiki-text-muted); font-size: 0.95em; }
.wiki-empty { text-align: center; padding: 50px 20px; color: var(--wiki-text-muted); font-size: 1.05em; }
.wiki-page-title { font-size: 1.8em; font-weight: bold; color: var(--wiki-text); margin-bottom: 16px; }
.wiki-expiry-badge { display: inline-block; font-size: 0.78em; font-weight: normal; padding: 2px 10px; border-radius: 20px; margin-left: 6px; vertical-align: middle; }
.wiki-expiry-ok   { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.wiki-expiry-warn { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.wiki-expiry-crit { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
[data-theme="dark"] .wiki-expiry-ok   { background: #1a3a1a; color: #7ecf7e; border: 1px solid #2e6b2e; }
[data-theme="dark"] .wiki-expiry-warn { background: #3a2a00; color: #f0b840; border: 1px solid #7a5c00; }
[data-theme="dark"] .wiki-expiry-crit { background: #3a1a00; color: #f07840; border: 1px solid #7a3000; }
.wiki-edit-btn { font-size: 0.5em; background: #1a5f3a; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; vertical-align: middle; text-decoration: none; display: inline-block; }
.wiki-edit-btn:hover { background: #238a52; }
.wiki-edit-form { max-width: 900px; margin: 0 auto; }
.wiki-edit-form h2 { font-size: 1.4em; color: var(--wiki-text); margin: 0 0 20px; border-bottom: 2px solid var(--wiki-accent); padding-bottom: 8px; }
.wiki-edit-field { margin-bottom: 18px; }
.wiki-edit-field label { display: block; font-size: 0.88em; color: var(--wiki-text-muted); margin-bottom: 5px; font-weight: bold; letter-spacing: .03em; }
.wiki-edit-input { width: 100%; background: var(--wiki-surface); border: 1px solid var(--wiki-border); color: var(--wiki-text); padding: 8px 12px; border-radius: 5px; font-size: 0.97em; box-sizing: border-box; }
.wiki-edit-input:focus { outline: none; border-color: var(--wiki-accent); }
.wiki-edit-textarea { width: 100%; background: var(--wiki-surface); border: 1px solid var(--wiki-border); color: var(--wiki-text); padding: 8px 12px; border-radius: 5px; font-size: 0.87em; font-family: monospace; box-sizing: border-box; resize: vertical; }
.wiki-edit-textarea:focus { outline: none; border-color: var(--wiki-accent); }
.wiki-edit-img-preview { max-width: 220px; max-height: 160px; display: block; margin-top: 8px; border-radius: 4px; border: 1px solid var(--wiki-border); object-fit: cover; }
.wiki-edit-img-preview.hidden { display: none; }
.wiki-upload-area { border: 2px dashed var(--wiki-border); border-radius: 6px; padding: 16px; text-align: center; cursor: pointer; color: var(--wiki-text-muted); font-size: 0.9em; margin-top: 6px; transition: border-color .2s; }
.wiki-upload-area:hover, .wiki-upload-area.dragover { border-color: var(--wiki-accent); color: var(--wiki-text); }
.wiki-edit-actions { display: flex; gap: 10px; margin-top: 24px; }
.wiki-save-btn { background: var(--wiki-accent); color: #fff; border: none; padding: 9px 28px; border-radius: 5px; cursor: pointer; font-size: 1em; font-weight: bold; }
.wiki-save-btn:hover { background: #c73450; }
.wiki-save-btn:disabled { opacity: .5; cursor: not-allowed; }
.wiki-cancel-btn { background: var(--wiki-surface2); color: var(--wiki-text); border: 1px solid var(--wiki-border); padding: 9px 20px; border-radius: 5px; cursor: pointer; font-size: 1em; text-decoration: none; display: inline-block; }
.wiki-cancel-btn:hover { border-color: var(--wiki-text-muted); }
.wiki-edit-notice { font-size: 0.82em; color: var(--wiki-text-muted); margin-top: 4px; }
.wiki-regen-btn { background: #2a5fa3; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.88em; margin-top: 6px; }
.wiki-regen-btn:hover { background: #1d4a80; }
.wiki-regen-btn:disabled { opacity: .5; cursor: not-allowed; }
.wiki-prompt-addition-block { margin-bottom: 20px; }
.wiki-prompt-addition-block label { display: block; font-size: .85em; color: var(--wiki-text-muted); margin-bottom: 5px; font-weight: bold; }
`;
}


function buildFullPage({ head = "", body, basePath, channelId = "", wikiTitle, menu, role, webAuth }) {
  const css = buildWikiCss();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(head || wikiTitle)}</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${escHtml(basePath)}/style.css">
<style>${css}</style>
</head>
<body>
${buildPageHeader(wikiTitle, basePath, channelId, menu, role, webAuth)}
${body}
</body>
</html>`;
}


function buildIndexPage(channels, basePath, menu, role, webAuth) {
  const cards = channels.map(ch => `
    <div class="wiki-channel-card">
      <h3><a href="${escHtml(basePath)}/${escHtml(ch.channelId)}">${escHtml(ch._title || ch.channelId)}</a></h3>
      <p>Channel ID: ${escHtml(ch.channelId)}</p>
    </div>`).join("");

  const body = `<div class="wiki-content-wrap">
  <div class="wiki-page-title">Available Wikis</div>
  ${cards ? `<div class="wiki-index">${cards}</div>` : `<div class="wiki-empty">No wikis configured.</div>`}
</div>`;

  return buildFullPage({ head: "Wiki Index", body, basePath, wikiTitle: "Wiki", menu, role, webAuth });
}


function buildChannelHomePage(channel, articles, basePath, menu, role, webAuth) {
  const chId    = channel.channelId;
  const chTitle = channel._title || `Wiki ${chId}`;
  const chPath  = `${basePath}/${chId}`;

  const articleCards = articles.map(a => {
    const cats = safeParseJson(a.categories, []);
    return `<a class="wiki-article-card" href="${escHtml(chPath)}/${escHtml(a.slug)}" style="text-decoration:none">
      ${a.image_url
        ? `<img class="wiki-article-card-img wiki-lazy" data-src="${escHtml(getThumbUrl(a.image_url, THUMB_WIDTH))}" data-fallback="${escHtml(a.image_url)}" alt="${escHtml(a.title)}">`
        : `<div class="wiki-article-card-img-placeholder">📄</div>`}
      <div class="wiki-article-card-body">
        <div class="wiki-article-card-title">${escHtml(a.title)}</div>
        <div class="wiki-article-card-intro">${escHtml(getStr(a.intro).slice(0, 150))}</div>
      </div>
    </a>`;
  }).join("");

  const body = `<div class="wiki-breadcrumb"><a href="${escHtml(basePath)}">Wiki</a> › ${escHtml(chTitle)}</div>
<div class="wiki-content-wrap">
  <div class="wiki-page-title">${escHtml(chTitle)}</div>
  <form class="wiki-search-form" action="${escHtml(chPath)}/search" method="get" style="margin-bottom:24px">
    <input class="wiki-search-input" type="text" name="q" placeholder="Search or generate an article…" autocomplete="off" style="width:340px">
    <button class="wiki-search-btn" type="submit">Go</button>
  </form>
  ${articles.length
    ? `<div style="color:var(--wiki-text-muted);font-size:.9em;margin-bottom:10px">Recent articles</div>
       <div class="wiki-recent">${articleCards}</div>`
    : `<div class="wiki-empty">No articles yet. Use the search bar to generate the first one!</div>`}
</div>
<script>
(function(){
  var imgs = Array.from(document.querySelectorAll('img.wiki-lazy'));
  if (!imgs.length) return;
  var concurrency = 2, active = 0, idx = 0;
  function loadNext() {
    while (active < concurrency && idx < imgs.length) {
      var img = imgs[idx++];
      active++;
      img.onload = function() { active--; loadNext(); };
      img.onerror = function() {
        var fb = img.dataset.fallback;
        if (fb && img.src !== fb) { img.src = fb; } else { active--; loadNext(); }
      };
      img.src = img.dataset.src;
    }
  }
  loadNext();
})();
</script>`;

  return buildFullPage({ head: chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role, webAuth });
}


function buildArticlePage(channel, article, basePath, isEditor, menu, role, maxAgeDays = 0, webAuth) {
  const chId    = channel.channelId;
  const chTitle = channel._title || `Wiki ${chId}`;
  const chPath  = `${basePath}/${chId}`;

  const sections  = safeParseJson(article.sections, []);
  const infobox   = safeParseJson(article.infobox, {});
  const categories = safeParseJson(article.categories, []);
  const related    = safeParseJson(article.related, []);

  /* --- Table of Contents --- */
  const tocItems = sections
    .filter(s => s.heading)
    .map((s, i) => {
      const anchor = `section-${i}`;
      return `<li><a href="#${anchor}">${escHtml(s.heading)}</a></li>`;
    }).join("");

  const tocHtml = tocItems
    ? `<div class="wiki-toc"><div class="wiki-toc-title">Contents</div><ol>${tocItems}</ol></div>`
    : "";

  /* --- Sections --- */
  const sectionsHtml = sections.map((s, i) => {
    const tag = `h${Math.min(Math.max(Number(s.level) || 2, 2), 4)}`;
    return `<div class="wiki-section" id="section-${i}">
  <${tag}>${escHtml(s.heading)}</${tag}>
  ${s.content ? s.content.split("\n").map(p => p.trim() ? `<p>${escHtml(p)}</p>` : "").join("") : ""}
</div>`;
  }).join("");

  /* --- Infobox --- */
  const fields = Array.isArray(infobox.fields) ? infobox.fields : [];
  const infoboxRows = fields.map(f =>
    `<tr><td>${escHtml(f.label || "")}</td><td>${escHtml(f.value || "")}</td></tr>`
  ).join("");
  const infoboxHtml = `<div class="wiki-infobox">
  ${article.image_url
    ? `<img class="wiki-infobox-img" src="${escHtml(article.image_url)}" alt="${escHtml(infobox.imageAlt || article.title)}" loading="lazy">`
    : ""}
  ${infoboxRows ? `<table>${infoboxRows}</table>` : ""}
</div>`;

  /* --- Categories --- */
  const catChips = categories.map(c =>
    `<a class="wiki-chip" href="${escHtml(chPath)}/search?q=${encodeURIComponent(c)}">${escHtml(c)}</a>`
  ).join("");

  /* --- See Also --- */
  const seeAlsoLinks = related.map(r =>
    `<a href="${escHtml(chPath)}/search?q=${encodeURIComponent(r)}">${escHtml(r)}</a>`
  ).join(" · ");

  /* --- Editor buttons + expiry badge --- */
  const editBtn = isEditor
    ? `<a class="wiki-edit-btn" href="${escHtml(chPath)}/${escHtml(article.slug)}/edit">✏️ Edit</a>`
    : "";
  const deleteBtn = isEditor
    ? `<button class="wiki-delete-btn" onclick="wikiDeleteArticle('${escHtml(chId)}','${escHtml(article.slug)}')">🗑 Delete</button>`
    : "";
  /* Expiry badge: only for articles never edited (updated_at IS NULL); visible to all users */
  /* Expiry badge: always shown for unedited articles (updated_at IS NULL); colour by urgency */
  let expiryBadge = "";
  if (maxAgeDays > 0 && article.created_at && !article.updated_at) {
    const ageDays       = (Date.now() - new Date(article.created_at).getTime()) / 86400000;
    const remainingDays = Math.ceil(maxAgeDays - ageDays);
    if (remainingDays <= 0) {
      expiryBadge = `<span class="wiki-expiry-badge wiki-expiry-crit">⚠️ Expired</span>`;
    } else if (remainingDays <= 2) {
      expiryBadge = `<span class="wiki-expiry-badge wiki-expiry-crit">⚠️ Expires in ${remainingDays === 1 ? "1 day" : remainingDays + " days"}</span>`;
    } else if (remainingDays <= 5) {
      expiryBadge = `<span class="wiki-expiry-badge wiki-expiry-warn">🕐 Expires in ${remainingDays} days</span>`;
    } else {
      expiryBadge = `<span class="wiki-expiry-badge wiki-expiry-ok">🕐 Expires in ${remainingDays} days</span>`;
    }
  }

  const body = `<div class="wiki-breadcrumb">
  <a href="${escHtml(basePath)}">Wiki</a> ›
  <a href="${escHtml(chPath)}">${escHtml(chTitle)}</a> ›
  ${escHtml(article.title)}
</div>
<div class="wiki-content-wrap">
  <div class="wiki-article-layout">
    <div class="wiki-article-main">
      <h1 class="wiki-article-title">${escHtml(article.title)} ${editBtn} ${deleteBtn} ${expiryBadge}</h1>
      <div class="wiki-intro">${escHtml(article.intro || "")}</div>
      ${tocHtml}
      ${sectionsHtml}
      ${catChips ? `<div class="wiki-categories"><div class="wiki-categories-title">Categories:</div>${catChips}</div>` : ""}
      ${seeAlsoLinks ? `<div class="wiki-seealso">See also: ${seeAlsoLinks}</div>` : ""}
      ${article.model ? `<div style="margin-top:18px;font-size:0.75em;color:var(--wiki-text-muted)">Generated by ${escHtml(article.model)}</div>` : ""}
    </div>
    <div class="wiki-article-sidebar">${infoboxHtml}</div>
  </div>
</div>
${isEditor ? `<script>
function wikiDeleteArticle(chId, slug) {
  if (!confirm('Delete this article permanently?')) return;
  fetch('/wiki/' + chId + '/api/article/' + slug, { method: 'DELETE' })
    .then(r => r.json())
    .then(d => { if (d.ok) { window.location.href = '/wiki/' + chId; } else { alert('Delete failed: ' + (d.error || 'unknown')); } })
    .catch(() => alert('Delete request failed'));
}
</script>` : ""}`;

  return buildFullPage({ head: article.title + " – " + chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role, webAuth });
}


function buildEditPage(channel, article, basePath, menu, role, webAuth) {
  const chId    = channel.channelId;
  const chTitle = channel._title || `Wiki ${chId}`;
  const chPath  = `${basePath}/${chId}`;
  const editUrl = `${chPath}/${escHtml(article.slug)}/edit`;

  /* Stringify JSON fields for textarea display */
  const sectionsJson    = JSON.stringify(safeParseJson(article.sections,   []), null, 2);
  const infoboxJson     = JSON.stringify(safeParseJson(article.infobox,    {}), null, 2);
  const categoriesText  = safeParseJson(article.categories, []).join("\n");
  const relatedText     = safeParseJson(article.related,    []).join("\n");
  const imageUrl        = getStr(article.image_url);

  const body = `<div class="wiki-breadcrumb">
  <a href="${escHtml(basePath)}">Wiki</a> ›
  <a href="${escHtml(chPath)}">${escHtml(chTitle)}</a> ›
  <a href="${escHtml(chPath)}/${escHtml(article.slug)}">${escHtml(article.title)}</a> ›
  Edit
</div>
<div class="wiki-content-wrap">
  <div class="wiki-edit-form">
    <h2>✏️ Edit: ${escHtml(article.title)}</h2>

    <div class="wiki-edit-field">
      <label for="wiki-title">Title</label>
      <input id="wiki-title" class="wiki-edit-input" type="text" value="${escHtml(article.title)}" maxlength="512">
    </div>

    <div class="wiki-edit-field">
      <label for="wiki-intro">Introduction</label>
      <textarea id="wiki-intro" class="wiki-edit-textarea" rows="5">${escHtml(article.intro || "")}</textarea>
    </div>

    <div class="wiki-edit-field">
      <label>Article Image</label>
      <input id="wiki-img-url" class="wiki-edit-input" type="text" value="${escHtml(imageUrl)}" placeholder="https://... or /wiki/${escHtml(chId)}/images/filename.png">
      <button type="button" class="wiki-regen-btn" id="wiki-regen-btn" onclick="wikiRegenImage()">🔄 Regenerate Image via AI</button>
      <textarea id="wiki-regen-addition" class="wiki-edit-textarea" rows="2" style="max-width:600px;margin-top:6px" placeholder="Optional: additional context for image (e.g. Irene has long red hair and wears leather armor)"></textarea>
      <p id="wiki-regen-status" class="wiki-edit-notice"></p>
      <p class="wiki-edit-notice">Paste a URL or upload a new image below. Uploading replaces the URL automatically.</p>
      ${imageUrl ? `<img id="wiki-img-preview" class="wiki-edit-img-preview" src="${escHtml(imageUrl)}" alt="Current image">` : `<img id="wiki-img-preview" class="wiki-edit-img-preview hidden" src="" alt="">`}
      <div class="wiki-upload-area" id="wiki-upload-drop">
        📁 Click to choose image, or drag &amp; drop here<br>
        <span style="font-size:.8em">(PNG, JPG, GIF, WebP — max 8 MB)</span>
        <input type="file" id="wiki-img-file" accept="image/*" style="display:none">
      </div>
      <p id="wiki-upload-status" class="wiki-edit-notice"></p>
    </div>

    <div class="wiki-edit-field">
      <label for="wiki-sections">Sections <span style="font-weight:normal">(JSON array)</span></label>
      <textarea id="wiki-sections" class="wiki-edit-textarea" rows="14">${escHtml(sectionsJson)}</textarea>
    </div>

    <div class="wiki-edit-field">
      <label for="wiki-infobox">Infobox <span style="font-weight:normal">(JSON object)</span></label>
      <textarea id="wiki-infobox" class="wiki-edit-textarea" rows="10">${escHtml(infoboxJson)}</textarea>
    </div>

    <div class="wiki-edit-field">
      <label for="wiki-categories">Categories <span style="font-weight:normal">(one per line)</span></label>
      <textarea id="wiki-categories" class="wiki-edit-textarea" rows="4">${escHtml(categoriesText)}</textarea>
    </div>

    <div class="wiki-edit-field">
      <label for="wiki-related">Related Terms <span style="font-weight:normal">(one per line)</span></label>
      <textarea id="wiki-related" class="wiki-edit-textarea" rows="4">${escHtml(relatedText)}</textarea>
    </div>

    <div class="wiki-edit-actions">
      <button id="wiki-save-btn" class="wiki-save-btn" onclick="wikiSaveArticle()">💾 Save</button>
      <a class="wiki-cancel-btn" href="${escHtml(chPath)}/${escHtml(article.slug)}">Cancel</a>
    </div>
    <p id="wiki-save-status" class="wiki-edit-notice" style="margin-top:10px"></p>
  </div>
</div>
<script>
(function() {
  const chId   = ${JSON.stringify(chId)};
  const slug   = ${JSON.stringify(article.slug)};
  const chPath = ${JSON.stringify(chPath)};

  const dropArea  = document.getElementById('wiki-upload-drop');
  const fileInput = document.getElementById('wiki-img-file');
  const imgUrl    = document.getElementById('wiki-img-url');
  const imgPrev   = document.getElementById('wiki-img-preview');
  const uploadSt  = document.getElementById('wiki-upload-status');

  dropArea.addEventListener('click', () => fileInput.click());
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
  dropArea.addEventListener('drop', e => { e.preventDefault(); dropArea.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) uploadImage(f); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadImage(fileInput.files[0]); });

  function uploadImage(file) {
    if (file.size > 8 * 1024 * 1024) { uploadSt.textContent = '❌ File too large (max 8 MB)'; return; }
    uploadSt.textContent = '⏳ Uploading…';
    const reader = new FileReader();
    reader.onload = async function(e) {
      const b64 = e.target.result.split(',')[1];
      const ext = file.name.split('.').pop().toLowerCase() || 'png';
      try {
        const resp = await fetch('/wiki/' + chId + '/api/upload-image/' + slug, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, ext: ext })
        });
        const data = await resp.json();
        if (data.ok) {
          imgUrl.value = data.url;
          imgPrev.src  = data.url;
          imgPrev.classList.remove('hidden');
          uploadSt.textContent = '✅ Uploaded';
        } else {
          uploadSt.textContent = '❌ ' + (data.error || 'Upload failed');
        }
      } catch { uploadSt.textContent = '❌ Upload request failed'; }
    };
    reader.readAsDataURL(file);
  }

  /* Live URL preview */
  imgUrl.addEventListener('input', function() {
    if (imgUrl.value.trim()) { imgPrev.src = imgUrl.value.trim(); imgPrev.classList.remove('hidden'); }
    else { imgPrev.classList.add('hidden'); }
  });

  window.wikiRegenImage = async function() {
    const btn    = document.getElementById('wiki-regen-btn');
    const status = document.getElementById('wiki-regen-status');
    const pa     = document.getElementById('wiki-regen-addition');
    const promptAddition = pa ? pa.value.trim() : '';
    if (btn) btn.disabled = true;
    status.textContent = '⏳ Regenerating image\u2026 this may take a moment.';
    try {
      const resp = await fetch('/wiki/' + chId + '/api/regen-image/' + slug, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptAddition: promptAddition })
      });
      const data = await resp.json();
      if (data.ok && data.image_url) {
        imgUrl.value = data.image_url;
        /* Append cache-buster so the browser fetches the new image even if a
           stale entry exists under the same path (e.g. immutable thumbnail) */
        imgPrev.src = data.image_url + (data.image_url.includes('?') ? '&' : '?') + '_t=' + Date.now();
        imgPrev.classList.remove('hidden');
        status.textContent = '\u2705 Image saved.';
      } else {
        status.textContent = '\u274C ' + (data.error || 'Regeneration failed');
      }
    } catch { status.textContent = '\u274C Request failed'; }
    if (btn) btn.disabled = false;
  };

  window.wikiSaveArticle = async function() {
    const btn    = document.getElementById('wiki-save-btn');
    const status = document.getElementById('wiki-save-status');
    let sections, infobox;
    try { sections = JSON.parse(document.getElementById('wiki-sections').value); } catch { status.textContent = '❌ Sections: invalid JSON'; return; }
    try { infobox  = JSON.parse(document.getElementById('wiki-infobox').value);  } catch { status.textContent = '❌ Infobox: invalid JSON'; return; }
    btn.disabled = true;
    status.textContent = '⏳ Saving…';
    const payload = {
      title:      document.getElementById('wiki-title').value.trim(),
      intro:      document.getElementById('wiki-intro').value.trim(),
      image_url:  document.getElementById('wiki-img-url').value.trim(),
      sections,
      infobox,
      categories: document.getElementById('wiki-categories').value.split('\\n').map(s=>s.trim()).filter(Boolean),
      related:    document.getElementById('wiki-related').value.split('\\n').map(s=>s.trim()).filter(Boolean)
    };
    try {
      const resp = await fetch('/wiki/' + chId + '/' + slug + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (data.ok) {
        window.location.href = chPath + '/' + slug;
      } else {
        status.textContent = '❌ ' + (data.error || 'Save failed');
        btn.disabled = false;
      }
    } catch { status.textContent = '❌ Save request failed'; btn.disabled = false; }
  };
})();
</script>`;

  return buildFullPage({ head: "Edit: " + article.title + " – " + chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role, webAuth });
}


function buildSearchPage(channel, query, results, basePath, menu, role, isCreator = false, webAuth) {
  const chId    = channel.channelId;
  const chTitle = channel._title || `Wiki ${chId}`;
  const chPath  = `${basePath}/${chId}`;

  const resultItems = results.map(r =>
    `<div class="wiki-search-result">
  <h3><a href="${escHtml(chPath)}/${escHtml(r.slug)}">${escHtml(r.title)}</a></h3>
  <p>${escHtml(getStr(r.intro).slice(0, 200))}</p>
</div>`).join("");

  const body = `<div class="wiki-breadcrumb">
  <a href="${escHtml(basePath)}">Wiki</a> ›
  <a href="${escHtml(chPath)}">${escHtml(chTitle)}</a> ›
  Search
</div>
<div class="wiki-content-wrap">
  <div class="wiki-page-title">Search: "${escHtml(query)}"</div>
  <form class="wiki-search-form" action="${escHtml(chPath)}/search" method="get" style="margin-bottom:24px">
    <input class="wiki-search-input" type="text" name="q" value="${escHtml(query)}" autocomplete="off" style="width:340px">
    <button class="wiki-search-btn" type="submit">Go</button>
  </form>
  ${isCreator ? `<div class="wiki-prompt-addition-block">
    <label for="wiki-prompt-addition">Additional context for generation <span style="font-weight:normal">(optional)</span></label>
    <textarea id="wiki-prompt-addition" class="wiki-edit-textarea" rows="3" style="max-width:600px" placeholder="e.g. Irene is also known as Hippomann. She is a fighter in the party\u2026"></textarea>
  </div>` : ""}
  <div id="wiki-results">
    ${results.length > 0
      ? `<div class="wiki-search-results">${resultItems}</div>
         <div style="margin-top:16px;color:var(--wiki-text-muted);font-size:.9em">
           ${results.length} result${results.length !== 1 ? "s" : ""} found.
           ${isCreator ? `<a href="#" id="wiki-gen-link" onclick="wikiGenerate(event)">Generate new article for this topic</a>` : ""}
         </div>`
      : isCreator
        ? `<div class="wiki-empty" style="text-align:left;padding:20px 0">
             No articles found for "<strong>${escHtml(query)}</strong>".
             <div style="margin-top:14px">
               <button class="wiki-search-btn" onclick="wikiGenerate(event)" id="wiki-gen-btn">✨ Generate article</button>
             </div>
           </div>`
        : `<div class="wiki-empty">No articles found for "<strong>${escHtml(query)}</strong>".</div>`}
    <div id="wiki-gen-results" style="display:none"></div>
  </div>
</div>
${isCreator ? `<script>
var WIKI_CHANNEL = ${JSON.stringify(chId)};
var WIKI_QUERY   = ${JSON.stringify(query)};
var WIKI_BASE    = ${JSON.stringify(chPath)};

function wikiGenerate(e) {
  if (e) e.preventDefault();
  var btn = document.getElementById('wiki-gen-btn') || document.getElementById('wiki-gen-link');
  if (btn) btn.style.display = 'none';
  document.getElementById('wiki-results').innerHTML =
    '<div class="wiki-spinner-wrap"><div class="wiki-spinner"></div><div class="wiki-spinner-msg">Generating article\u2026 this may take a moment.</div></div>';
  wikiDoGenerate(true);
}

function wikiDoGenerate(force) {
  var pa = document.getElementById('wiki-prompt-addition');
  var promptAddition = pa ? pa.value.trim() : '';
  fetch(WIKI_BASE + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: WIKI_QUERY, force: force === true, promptAddition: promptAddition })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.ok) {
      document.getElementById('wiki-results').innerHTML =
        '<div class="wiki-empty">Error: ' + (d.error || 'Generation failed') + '</div>';
      return;
    }
    if (d.slug) {
      window.location.href = WIKI_BASE + '/' + d.slug;
    } else if (Array.isArray(d.results)) {
      var html = '<div class="wiki-search-results">';
      for (var i = 0; i < d.results.length; i++) {
        var r = d.results[i];
        html += '<div class="wiki-search-result"><h3><a href="' + WIKI_BASE + '/' + r.slug + '">' + r.title + '</a></h3></div>';
      }
      html += '</div>';
      document.getElementById('wiki-results').innerHTML = html;
    }
  })
  .catch(function() {
    document.getElementById('wiki-results').innerHTML = '<div class="wiki-empty">Generation failed. Please try again.</div>';
  });
}
</script>` : ""}`;

  return buildFullPage({ head: `Search: ${query} – ${chTitle}`, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role, webAuth });
}


function safeParseJson(val, fallback) {
  if (typeof val !== "string") return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}


function resolveChannelConfig(cfg, rawChannel) {
  const resolved = Object.assign({}, rawChannel);

  const scalarKeys = ["maxAgeDays", "allowedRoles", "adminRoles", "editorRoles", "creatorRoles", "_title"];
  for (const key of scalarKeys) {
    if (resolved[key] === undefined && cfg[key] !== undefined) {
      resolved[key] = cfg[key];
    }
  }

  return resolved;
}


function getChannelConfig(cfg, channelId) {
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];
  const raw = channels.find(c => getStr(c.channelId) === channelId);
  if (!raw) return null;
  return resolveChannelConfig(cfg, raw);
}


export default async function getWebpageWiki(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage" && wo?.flow !== "webpage-wiki") return coreData;

  const cfg      = coreData?.config?.[MODULE_NAME] || {};
  const port     = Number(cfg.port ?? 3117);
  const basePath = getStr(cfg.basePath ?? "/wiki").replace(/\/+$/, "") || "/wiki";

  if (Number(wo.http?.port) !== port) return coreData;

  const url     = getStr(wo.http?.url || "/");
  const method  = getStr(wo.http?.method || "GET").toUpperCase();
  const urlPath = url.split("?")[0];

  if (!urlPath.startsWith(basePath)) return coreData;

  wo.stop = true; wo.stopReason = "wiki_request_handled";

  const menu    = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
  const role    = getStr(wo?.webAuth?.role || "");
  const webAuth = wo?.webAuth;

  if (method === "GET" && urlPath === basePath + "/style.css") {
    const css = getStyleCss();
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
      body: css
    };
    await setSendNow(wo);
    return coreData;
  }

  /* Parse path segments after basePath */
  const rest     = urlPath.slice(basePath.length).replace(/^\//, "");
  const segments = rest ? rest.split("/") : [];
  const channelId = segments[0] || "";

  if (!channelId) {
    if (method !== "GET") { await sendText(wo, 405, "405 Method Not Allowed"); return coreData; }
    const allChannels = Array.isArray(cfg.channels) ? cfg.channels : [];
    const visible = allChannels.filter(ch => {
      const allowed = Array.isArray(ch.allowedRoles) ? ch.allowedRoles : [];
      return getIsAllowed(wo, allowed);
    });
    const html = buildIndexPage(visible, basePath, menu, role, webAuth);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  /* Find channel config */
  const channel = getChannelConfig(cfg, channelId);
  if (!channel) {
    await sendHtml(wo, 404, buildFullPage({
      head: "404 – Wiki Not Found",
      body: `<div class="wiki-content-wrap"><div class="wiki-empty">Wiki not configured for channel <strong>${escHtml(channelId)}</strong>.</div></div>`,
      basePath, wikiTitle: "Wiki", menu, role, webAuth
    }));
    return coreData;
  }

  /* Read-access check */
  const allowedRoles = Array.isArray(channel.allowedRoles) ? channel.allowedRoles : [];
  if (!getIsAllowed(wo, allowedRoles)) {
    await sendText(wo, 403, "403 Forbidden");
    return coreData;
  }

  /* Role checks: admin ⊇ editor ⊇ {}, admin ⊇ creator ⊇ {}
     All three: empty array = nobody. No implicit defaults. */
  const adminRoles   = Array.isArray(channel.adminRoles)   ? channel.adminRoles   : [];
  const editorRoles  = Array.isArray(channel.editorRoles)  ? channel.editorRoles  : [];
  const creatorRoles = Array.isArray(channel.creatorRoles) ? channel.creatorRoles : [];
  const isAdmin   = adminRoles.length   > 0 && getIsAllowed(wo, adminRoles);
  const isEditor  = isAdmin || (editorRoles.length  > 0 && getIsAllowed(wo, editorRoles));
  const isCreator = isAdmin || (creatorRoles.length > 0 && getIsAllowed(wo, creatorRoles));

  /* Expiry config — 0 = no expiry */
  const maxAgeDays = getMaxAgeDays(channel);

  const seg1 = segments[1] || "";
  const seg2 = segments[2] || "";
  const seg3 = segments[3] || "";

  let db;
  try {
    db = await getWikiDb(coreData);
  } catch (e) {
    await sendText(wo, 500, "Database unavailable: " + getStr(e?.message));
    return coreData;
  }

  /* Passive cleanup — delete expired articles in the background */
  dbPruneExpiredArticles(db, channelId, maxAgeDays).catch(() => {});

  if (method === "POST" && seg1 === "api" && seg2 === "generate") {
    if (!isCreator) { await sendJson(wo, 403, { ok: false, error: "Forbidden – creator role required" }); return coreData; }
    let query = "";
    let force = false;
    let promptAddition = "";
    try {
      const bodyJson = wo.http?.json || (wo.http?.rawBody ? JSON.parse(wo.http.rawBody) : {});
      query           = getStr(bodyJson.query           || "").trim();
      force           = bodyJson.force === true;
      promptAddition  = getStr(bodyJson.promptAddition  || "").trim();
    } catch { query = ""; }

    /* Search first — skip if user explicitly requested generation */
    if (!force) {
      let results = [];
      try { results = await dbSearchArticles(db, channelId, query, maxAgeDays); } catch { results = []; }
      if (results.length === 1) {
        await sendJson(wo, 200, { ok: true, slug: results[0].slug, existing: true });
        return coreData;
      }
      if (results.length > 1) {
        await sendJson(wo, 200, { ok: true, results: results.map(r => ({ slug: r.slug, title: r.title })) });
        return coreData;
      }
    }

    /* Generate new article via pipeline (context loaded natively by core-ai) */
    try {
      const article   = await callPipelineForArticle(query, channel, coreData, promptAddition);
      const slug      = getSlug(article.title || query);
      const finalSlug = await dbSaveArticle(db, channelId, slug, article);
      ensureThumb(article.image_url, THUMB_WIDTH).catch(() => {});
      await sendJson(wo, 200, { ok: true, slug: finalSlug, generated: true });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Generation failed") });
    }
    return coreData;
  }

  if (method === "DELETE" && seg1 === "api" && seg2 === "article" && seg3) {
    if (!isEditor) { await sendJson(wo, 403, { ok: false, error: "Forbidden" }); return coreData; }
    try {
      const articleToDelete = await dbGetArticle(db, channelId, seg3, 0).catch(() => null);
      if (articleToDelete?.image_url) {
        const imgUrlStr = getStr(articleToDelete.image_url);
        const deleteFileAndThumbs = (absPath) => {
          try { fs.unlinkSync(absPath); } catch { /* already gone */ }
          const thumbsRoot = path.join(path.dirname(absPath), "thumbnails");
          try {
            for (const sz of fs.readdirSync(thumbsRoot)) {
              try { fs.unlinkSync(path.join(thumbsRoot, sz, path.basename(absPath) + ".jpg")); } catch { /* ignore */ }
            }
          } catch { /* no thumbnails dir */ }
        };
        /* Uploaded wiki image */
        const wikiImgPrefix = `/wiki/${channelId}/images/`;
        if (imgUrlStr.startsWith(wikiImgPrefix)) {
          const filename = imgUrlStr.slice(wikiImgPrefix.length).split("?")[0];
          if (filename && !filename.includes("/") && !filename.includes("..") && filename.length > 0) {
            deleteFileAndThumbs(path.join(__dirname, "..", "pub", "wiki", channelId, "images", filename));
          }
        }
        /* AI-generated wiki image in pub/documents/wiki/ */
        const docsWikiMatch = imgUrlStr.match(/\/documents\/wiki\/([^?#/]+)$/);
        if (docsWikiMatch) {
          const filename = docsWikiMatch[1];
          if (filename && !filename.includes("..")) {
            deleteFileAndThumbs(path.join(__dirname, "..", "pub", "documents", "wiki", filename));
          }
        }
      }
      await dbDeleteArticle(db, channelId, seg3);
      await sendJson(wo, 200, { ok: true });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Delete failed") });
    }
    return coreData;
  }

  if (!seg1) {
    if (method !== "GET") { await sendText(wo, 405, "405 Method Not Allowed"); return coreData; }
    let articles = [];
    try { articles = await dbGetRecentArticles(db, channelId, maxAgeDays); } catch { articles = []; }
    const html = buildChannelHomePage(channel, articles, basePath, menu, role, webAuth);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  if (seg1 === "search") {
    if (method !== "GET") { await sendText(wo, 405, "405 Method Not Allowed"); return coreData; }
    const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const query  = getStr(params.get("q") || "").trim();
    if (!query) {
      /* Redirect to homepage if no query */
      wo.http.response = {
        status: 302,
        headers: { "Location": `${basePath}/${channelId}`, "Content-Type": "text/plain" },
        body: ""
      };
      await setSendNow(wo);
      return coreData;
    }
    let results = [];
    try { results = await dbSearchArticles(db, channelId, query, maxAgeDays); } catch { results = []; }
    const html = buildSearchPage(channel, query, results, basePath, menu, role, isCreator, webAuth);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  if (method === "POST" && seg1 === "api" && seg2 === "upload-image" && seg3) {
    if (!isEditor) { await sendJson(wo, 403, { ok: false, error: "Forbidden" }); return coreData; }
    try {
      const bodyJson = wo.http?.json || (wo.http?.rawBody ? JSON.parse(wo.http.rawBody) : {});
      const b64 = getStr(bodyJson.base64 || "");
      const ext = getStr(bodyJson.ext || "png").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "png";
      if (!b64) { await sendJson(wo, 400, { ok: false, error: "Missing base64 data" }); return coreData; }
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 8 * 1024 * 1024) { await sendJson(wo, 400, { ok: false, error: "File too large (max 8 MB)" }); return coreData; }
      const imgDir = path.join(__dirname, "..", "pub", "wiki", channelId, "images");
      fs.mkdirSync(imgDir, { recursive: true });
      const filename = `${seg3}.${ext}`;
      fs.writeFileSync(path.join(imgDir, filename), buf);
      const publicUrl = `/wiki/${channelId}/images/${filename}`;
      ensureThumb(publicUrl, THUMB_WIDTH).catch(() => {});
      await sendJson(wo, 200, { ok: true, url: publicUrl });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Upload failed") });
    }
    return coreData;
  }

  if (method === "POST" && seg1 === "api" && seg2 === "regen-image" && seg3) {
    if (!isEditor) { await sendJson(wo, 403, { ok: false, error: "Forbidden – editor role required" }); return coreData; }
    let articleForRegen = null;
    try { articleForRegen = await dbGetArticle(db, channelId, seg3, 0); } catch { /* ignore */ }
    if (!articleForRegen) { await sendJson(wo, 404, { ok: false, error: "Article not found" }); return coreData; }
    let regenPromptAddition = "";
    try {
      const bodyJson = wo.http?.json || (wo.http?.rawBody ? JSON.parse(wo.http.rawBody) : {});
      regenPromptAddition = getStr(bodyJson.promptAddition || "").trim();
    } catch { /* ignore */ }
    try {
      const imageUrl = await callPipelineForImageOnly(articleForRegen, channel, coreData, regenPromptAddition);

      /* Delete old image file + its thumbnail caches */
      const oldUrl = getStr(articleForRegen.image_url || "");
      const deleteOldImageFile = (absPath) => {
        try { fs.unlinkSync(absPath); } catch { /* already gone */ }
        /* Remove cached thumbnails: thumbnails/{w}/{filename}.jpg next to the source file */
        const thumbsRoot = path.join(path.dirname(absPath), "thumbnails");
        try {
          const sizes = fs.readdirSync(thumbsRoot);
          for (const sz of sizes) {
            try { fs.unlinkSync(path.join(thumbsRoot, sz, path.basename(absPath) + ".jpg")); } catch { /* ignore */ }
          }
        } catch { /* no thumbnails dir — ignore */ }
      };
      /* Delete uploaded wiki image (belongs exclusively to this article) */
      const wikiImgPrefix = `/wiki/${channelId}/images/`;
      if (oldUrl.startsWith(wikiImgPrefix)) {
        const oldFilename = oldUrl.slice(wikiImgPrefix.length).split("?")[0];
        if (oldFilename && !oldFilename.includes("/") && !oldFilename.includes("..")) {
          deleteOldImageFile(path.join(__dirname, "..", "pub", "wiki", channelId, "images", oldFilename));
        }
      }
      /* Delete AI-generated wiki image from pub/documents/wiki/
         (safe to delete — this subdirectory is exclusively used by the wiki) */
      const docsWikiMatch = oldUrl.match(/\/documents\/wiki\/([^?#/]+)$/);
      if (docsWikiMatch) {
        const oldFilename = docsWikiMatch[1];
        if (oldFilename && !oldFilename.includes("..")) {
          deleteOldImageFile(path.join(__dirname, "..", "pub", "documents", "wiki", oldFilename));
        }
      }

      await db.execute(
        "UPDATE wiki_articles SET image_url=?, updated_at=NOW() WHERE channel_id=? AND slug=?",
        [imageUrl, channelId, seg3]
      );
      ensureThumb(imageUrl, THUMB_WIDTH).catch(() => {});
      await sendJson(wo, 200, { ok: true, image_url: imageUrl });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Image regeneration failed") });
    }
    return coreData;
  }

  if (method === "GET" && seg1 === "images" && seg2) {
    const imgDir  = path.join(__dirname, "..", "pub", "wiki", channelId, "images");
    const imgPath = path.resolve(imgDir, seg2);
    if (!imgPath.startsWith(path.resolve(imgDir))) { await sendText(wo, 400, "Bad Request"); return coreData; }
    try {
      const ext  = path.extname(seg2).toLowerCase().slice(1) || "png";
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
      const thumbW = parseInt(wo.http?.query?.w || "0", 10) || 0;
      if (thumbW > 0) {
        const thumbsDir = path.join(imgDir, "thumbnails", String(thumbW));
        const thumb = await getThumb(imgPath, thumbsDir, seg2, thumbW);
        if (!thumb) { await sendText(wo, 500, "Thumbnail generation failed"); return coreData; }
        wo.http.response = { status: 200, headers: { "Content-Type": thumb.mime, "Cache-Control": "public, max-age=604800, immutable" }, body: thumb.buf };
      } else {
        const data = fs.readFileSync(imgPath);
        wo.http.response = { status: 200, headers: { "Content-Type": mime, "Cache-Control": "public, max-age=604800, immutable" }, body: data };
      }
      await setSendNow(wo);
    } catch { await sendText(wo, 404, "Image not found"); }
    return coreData;
  }

  if (method === "GET" && seg2 === "edit" && seg1) {
    if (!isEditor) { await sendText(wo, 403, "403 Forbidden"); return coreData; }
    let article = null;
    try { article = await dbGetArticle(db, channelId, seg1, maxAgeDays); } catch { /* ignore */ }
    if (!article) {
      await sendHtml(wo, 404, buildFullPage({
        head: "404 – Article Not Found",
        body: `<div class="wiki-content-wrap"><div class="wiki-empty">Article "<strong>${escHtml(seg1)}</strong>" not found.</div></div>`,
        basePath, channelId, wikiTitle: channel._title || `Wiki ${channelId}`, menu, role, webAuth
      }));
      return coreData;
    }
    const html = buildEditPage(channel, article, basePath, menu, role, webAuth);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  if (method === "POST" && seg2 === "edit" && seg1) {
    if (!isEditor) { await sendJson(wo, 403, { ok: false, error: "Forbidden" }); return coreData; }
    try {
      const bodyJson = wo.http?.json || (wo.http?.rawBody ? JSON.parse(wo.http.rawBody) : {});
      const updates = {
        title:      getStr(bodyJson.title      || "").trim(),
        intro:      getStr(bodyJson.intro      || "").trim(),
        image_url:  getStr(bodyJson.image_url  || "").trim(),
        sections:   Array.isArray(bodyJson.sections)   ? JSON.stringify(bodyJson.sections)   : getStr(bodyJson.sections   || "[]"),
        infobox:    (bodyJson.infobox && typeof bodyJson.infobox === "object") ? JSON.stringify(bodyJson.infobox) : getStr(bodyJson.infobox || "{}"),
        categories: Array.isArray(bodyJson.categories) ? JSON.stringify(bodyJson.categories) : getStr(bodyJson.categories || "[]"),
        related:    Array.isArray(bodyJson.related)    ? JSON.stringify(bodyJson.related)    : getStr(bodyJson.related    || "[]")
      };
      if (!updates.title) { await sendJson(wo, 400, { ok: false, error: "Title is required" }); return coreData; }
      await dbUpdateArticle(db, channelId, seg1, updates);
      await sendJson(wo, 200, { ok: true });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Save failed") });
    }
    return coreData;
  }

  if (seg1 && method === "GET") {
    let article = null;
    try { article = await dbGetArticle(db, channelId, seg1, maxAgeDays); } catch { /* ignore */ }
    if (!article) {
      await sendHtml(wo, 404, buildFullPage({
        head: "404 – Article Not Found",
        body: `<div class="wiki-content-wrap"><div class="wiki-empty">Article "<strong>${escHtml(seg1)}</strong>" not found in this wiki.</div></div>`,
        basePath, channelId, wikiTitle: channel._title || `Wiki ${channelId}`, menu, role, webAuth
      }));
      return coreData;
    }
    const html = buildArticlePage(channel, article, basePath, isEditor, menu, role, maxAgeDays, webAuth);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  await sendText(wo, 405, "405 Method Not Allowed");
  return coreData;
}
