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
import { getMenuHtml, getDb } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";
import getCoreAi from "./01000-core-ai-completions.js";

const MODULE_NAME = "webpage-wiki";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**********************************************************************************/
/* functionSignature: getStr (v)                                                  */
/* Returns a string; empty string for nullish.                                    */
/**********************************************************************************/
function getStr(v) { return v == null ? "" : String(v); }

/**********************************************************************************/
/* functionSignature: escHtml (s)                                                 */
/* Escapes HTML special characters.                                               */
/**********************************************************************************/
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**********************************************************************************/
/* functionSignature: getUserRoleLabels (wo)                                      */
/* Returns all role labels for the current user.                                  */
/**********************************************************************************/
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

/**********************************************************************************/
/* functionSignature: getIsAllowed (wo, allowedRoles)                             */
/* Returns true if the user has one of the allowed roles, or no roles required.   */
/**********************************************************************************/
function getIsAllowed(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set(getUserRoleLabels(wo));
  return req.some(r => have.has(getStr(r).trim().toLowerCase()));
}

/**********************************************************************************/
/* functionSignature: setSendNow (wo)                                             */
/* Writes the HTTP response back via the registered response object.              */
/**********************************************************************************/
async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = getItem(key);
  if (!entry?.res) return;
  const { res } = entry;
  if (res.writableEnded || res.headersSent) return;
  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "text/html; charset=utf-8" };
  const body    = r.body    ?? "";
  try {
    res.writeHead(status, headers);
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  } catch { /* already sent */ }
}

/**********************************************************************************/
/* functionSignature: sendJson (wo, status, data)                                 */
/* Sends a JSON response.                                                         */
/**********************************************************************************/
async function sendJson(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(data)
  };
  await setSendNow(wo);
}

/**********************************************************************************/
/* functionSignature: sendHtml (wo, status, html)                                 */
/* Sends an HTML response.                                                        */
/**********************************************************************************/
async function sendHtml(wo, status, html) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html
  };
  await setSendNow(wo);
}

/**********************************************************************************/
/* functionSignature: sendText (wo, status, text)                                 */
/* Sends a plain-text response.                                                   */
/**********************************************************************************/
async function sendText(wo, status, text) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: text
  };
  await setSendNow(wo);
}

/**********************************************************************************/
/* functionSignature: getSlug (title)                                             */
/* Converts a title string to a URL-safe slug.                                    */
/**********************************************************************************/
function getSlug(title) {
  return getStr(title).toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}


/**********************************************************************************/
/* functionSignature: getWikiDb (coreData)                                        */
/* Returns the db pool, auto-creating the wiki_articles table if needed.          */
/**********************************************************************************/
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
  /* Migrate existing tables that predate updated_at */
  await db.execute(
    "ALTER TABLE wiki_articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT NULL"
  );
  return db;
}

/**********************************************************************************/
/* functionSignature: getMaxAgeDays (channel)                                     */
/* Returns configured article TTL in days (0 = no expiry). Default: 7.           */
/**********************************************************************************/
function getMaxAgeDays(channel) {
  const v = Number(channel.maxAgeDays ?? 7);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 7;
}

/**********************************************************************************/
/* functionSignature: dbPruneExpiredArticles (db, channelId, maxAgeDays)          */
/* Bulk-deletes all articles older than maxAgeDays for a channel.                 */
/**********************************************************************************/
async function dbPruneExpiredArticles(db, channelId, maxAgeDays) {
  if (!maxAgeDays || maxAgeDays <= 0) return;
  await db.execute(
    "DELETE FROM wiki_articles WHERE channel_id = ? AND updated_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [channelId, maxAgeDays]
  );
}

/**********************************************************************************/
/* functionSignature: dbGetRecentArticles (db, channelId, maxAgeDays, limit)      */
/* Returns the most recent non-expired articles for a channel.                    */
/**********************************************************************************/
async function dbGetRecentArticles(db, channelId, maxAgeDays = 0, limit = 10) {
  let sql = "SELECT slug, title, intro, categories, image_url, created_at FROM wiki_articles WHERE channel_id = ?";
  const params = [channelId];
  if (maxAgeDays > 0) { sql += " AND (updated_at IS NOT NULL OR created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))"; params.push(maxAgeDays); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const [rows] = await db.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

/**********************************************************************************/
/* functionSignature: dbGetArticle (db, channelId, slug, maxAgeDays)              */
/* Returns a single article by channel + slug; deletes and returns null if        */
/* the article has exceeded its TTL.                                              */
/**********************************************************************************/
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

/**********************************************************************************/
/* functionSignature: dbSearchArticles (db, channelId, query, maxAgeDays)         */
/* Full-text + LIKE fallback search; filters out expired articles.                */
/**********************************************************************************/
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

/**********************************************************************************/
/* functionSignature: dbSaveArticle (db, channelId, slug, article)                */
/* Inserts a new wiki article row; returns final slug (handles duplicates).       */
/**********************************************************************************/
async function dbSaveArticle(db, channelId, slug, article) {
  let finalSlug = slug;
  let attempt   = 0;
  while (true) {
    try {
      await db.execute(
        `INSERT INTO wiki_articles (channel_id, slug, title, intro, sections, infobox, categories, related, image_url, image_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          article.imagePrompt || null
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

/**********************************************************************************/
/* functionSignature: dbDeleteArticle (db, channelId, slug)                       */
/* Deletes a wiki article row.                                                    */
/**********************************************************************************/
async function dbDeleteArticle(db, channelId, slug) {
  await db.execute(
    "DELETE FROM wiki_articles WHERE channel_id = ? AND slug = ?",
    [channelId, slug]
  );
}

/**********************************************************************************/
/* functionSignature: dbUpdateArticle (db, channelId, slug, updates)              */
/* Updates an existing wiki article row (edit by editor or admin).                */
/**********************************************************************************/
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

/**********************************************************************************/
/* Default system prompt for wiki article generation via core-ai pipeline.        */
/**********************************************************************************/
const DEFAULT_WIKI_SYSTEM_PROMPT = `You are a wiki article generator for a Discord community server.
Your ONLY sources of information are the tool results you receive. Do NOT use your own general knowledge.
Every fact in the article MUST come directly from what getInformation or getTimeline returns.
If the tools return no relevant data, write a short stub article saying there is no information yet.

The user message contains:
1. The TOPIC to write about.
2. A snapshot of recent channel messages — for context only, not a substitute for tool calls.

MANDATORY STEPS — follow in order, ALL required:
1. REQUIRED: Call getInformation with the topic as search query. This is your PRIMARY factual source. Do this BEFORE writing anything.
2. REQUIRED: Call getTimeline to retrieve the full chronological event history for this channel. You MUST do this regardless of the topic — the timeline provides the correct order of events.
3. REQUIRED: Call getImage to generate an illustration for the article. Use the imageAlt field from the infobox as the prompt. Put the URL from files[0].url into infobox.imageUrl.
4. Combine the results from getInformation and getTimeline. Use the timeline to establish the correct chronological order of all events. Events MUST be presented in chronological order throughout the entire article — in the intro, in sections, and in the infobox. Never describe a later event before an earlier one.
5. Write the article using ONLY what the tool results contain. Do NOT add facts from your training data.
6. OUTPUT a single raw JSON object — no markdown fences, no prose before or after — using this schema:
{
  "title": "Article Title",
  "intro": "One to two paragraph introduction — facts from tool results only, events in chronological order",
  "sections": [{"heading": "Section Heading", "level": 2, "content": "Section text — tool results only, events in chronological order"}],
  "infobox": {
    "imageAlt": "Image description",
    "imageUrl": "<URL returned by getImage, or null>",
    "fields": [{"label": "Label", "value": "Value — from tool results only"}]
  },
  "categories": ["Category1", "Category2"],
  "relatedTerms": ["Term1", "Term2", "Term3"]
}

CRITICAL RULES:
- You MUST call both getInformation AND getTimeline before writing. No exceptions.
- ALL events and developments MUST be in strict chronological order (earliest first).
- Every sentence must be traceable to a tool result. If unsure, omit it.
- Do NOT invent names, dates, stats, or lore not found in the tool results.
- Final output MUST be raw JSON only. Always call getImage and put files[0].url in infobox.imageUrl. If getImage fails or returns no url, set infobox.imageUrl to null.`;

/**********************************************************************************/
/* functionSignature: getChannelContextSnippet (db, channelId, limit)             */
/* Returns the last N user/assistant messages from the channel's context table    */
/* as a formatted text block, injected directly into the AI payload.              */
/**********************************************************************************/
async function getChannelContextSnippet(db, channelId, limit = 150) {
  if (!channelId || limit <= 0) return "";
  try {
    const [rows] = await db.execute(
      `SELECT role, text FROM context
        WHERE id = ? AND role IN ('user', 'assistant') AND text IS NOT NULL AND text != ''
        ORDER BY ctx_id DESC LIMIT ?`,
      [channelId, limit]
    );
    if (!Array.isArray(rows) || !rows.length) return "";
    return rows
      .slice()
      .reverse()
      .map(r => `[${r.role}]: ${getStr(r.text).slice(0, 500)}`)
      .join("\n");
  } catch {
    return "";
  }
}

/**********************************************************************************/
/* functionSignature: callPipelineForArticle (query, channel, coreData, ctxSnippet) */
/* Generates a wiki article via core-ai pipeline. Channel context is pre-loaded   */
/* and injected into the payload so the AI uses it as primary source.             */
/* doNotWriteToContext=true: wiki turns are never saved to the channel context.   */
/**********************************************************************************/
async function callPipelineForArticle(query, channel, coreData, ctxSnippet = "") {
  const wo = coreData?.workingObject || {};

  /* Build payload: topic + pre-loaded channel history */
  const historyBlock = ctxSnippet.trim()
    ? `\n\n--- Channel conversation history (primary source) ---\n${ctxSnippet.trim()}\n--- End of history ---`
    : "\n\n(No channel conversation history available for this topic.)";

  const syntheticWo = {
    flow:                "webpage",
    channelID:           channel.channelId,
    useAiModule:         "completions",
    endpoint:            getStr(wo.endpoint || ""),
    apiKey:              getStr(wo.apiKey   || ""),
    model:               "gpt-4o-mini",
    temperature:         0.7,
    maxTokens:           4000,
    maxLoops:            5,
    requestTimeoutMs:    120000,
    systemPrompt:        DEFAULT_WIKI_SYSTEM_PROMPT,
    tools:               ["getImage", "getTimeline", "getInformation"],
    payload:             `Topic: ${query}${historyBlock}`,
    doNotWriteToContext: true,
    includeHistory:      false,
    db:                  wo.db,
    toolsconfig:         wo.toolsconfig || {},
    timezone:            wo.timezone    || "Europe/Berlin",
    logging:             []
  };

  const syntheticCoreData = { workingObject: syntheticWo, config: coreData.config };
  const result            = await getCoreAi(syntheticCoreData);
  const responseText      = getStr(result?.workingObject?.response || "").trim();

  if (!responseText || responseText === "[Empty AI response]") {
    const logMsg = (syntheticWo.logging || [])
      .filter(e => e.severity === "warn" || e.severity === "error")
      .map(e => e.message || "")
      .filter(Boolean)
      .join(" | ");
    throw new Error("Pipeline returned no response" + (logMsg ? ": " + logMsg : ""));
  }

  /* Parse the JSON article */
  let article = null;
  try { article = JSON.parse(responseText); } catch {
    const m = responseText.match(/\{[\s\S]*\}/);
    if (m) { try { article = JSON.parse(m[0]); } catch { /* ignored */ } }
  }
  if (!article || typeof article !== "object") {
    throw new Error("AI returned no valid JSON article: " + responseText.slice(0, 200));
  }

  /* Map infobox.imageUrl (from getImage tool) → article.image_url for DB storage */
  if (!article.image_url && article.infobox?.imageUrl) {
    article.image_url = article.infobox.imageUrl;
  }

  return article;
}

/**********************************************************************************/
/* functionSignature: getStyleCss ()                                              */
/* Returns the wiki-specific CSS (loaded from shared + wiki additions).           */
/**********************************************************************************/
function getStyleCss() {
  let sharedCss = "";
  try {
    const cssPath = path.join(__dirname, "..", "shared", "webpage", "style.css");
    sharedCss = fs.readFileSync(cssPath, "utf-8");
  } catch { /* ignore */ }
  return sharedCss;
}

/**********************************************************************************/
/* functionSignature: buildPageHeader (title, basePath, channelId, menu, role)    */
/* Returns the wiki page header HTML with search bar.                             */
/**********************************************************************************/
function buildPageHeader(title, basePath, channelId, menu, role) {
  const menuHtml = getMenuHtml(menu, basePath + (channelId ? `/${channelId}` : ""), role);
  const chPath = channelId ? `${basePath}/${channelId}` : basePath;
  return `<div class="wiki-header">
  <div class="wiki-header-top">
    ${menuHtml}
  </div>
  <div class="wiki-header-bar">
    <a class="wiki-logo-link" href="${escHtml(chPath)}">
      <span class="wiki-logo">📖</span>
      <span class="wiki-title">${escHtml(title)}</span>
    </a>
    ${channelId ? `<form class="wiki-search-form" action="${escHtml(chPath)}/search" method="get">
      <input class="wiki-search-input" type="text" name="q" placeholder="Search or create…" autocomplete="off">
      <button class="wiki-search-btn" type="submit">Go</button>
    </form>` : ""}
  </div>
</div>`;
}

/**********************************************************************************/
/* functionSignature: buildWikiCss ()                                             */
/* Returns the wiki-specific inline styles.                                       */
/**********************************************************************************/
function buildWikiCss() {
  return `
:root {
  --wiki-bg: #1a1a2e;
  --wiki-surface: #16213e;
  --wiki-surface2: #0f3460;
  --wiki-accent: #e94560;
  --wiki-accent2: #533483;
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
body { background: var(--wiki-bg); color: var(--wiki-text); font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; overflow-y: auto; }
a { color: var(--wiki-link); text-decoration: none; }
a:hover { text-decoration: underline; }
.wiki-header { background: var(--wiki-surface); border-bottom: 2px solid var(--wiki-accent); margin-bottom: 0; }
.wiki-header-top { padding: 0 20px; }
.wiki-header-bar { display: flex; align-items: center; gap: 16px; padding: 10px 20px; flex-wrap: wrap; }
.wiki-logo-link { display: flex; align-items: center; gap: 8px; color: var(--wiki-text); font-size: 1.3em; font-weight: bold; text-decoration: none; flex-shrink: 0; }
.wiki-logo { font-size: 1.4em; }
.wiki-search-form { display: flex; gap: 6px; margin-left: auto; }
.wiki-search-input { background: var(--wiki-bg); border: 1px solid var(--wiki-border); color: var(--wiki-text); padding: 7px 12px; border-radius: 4px; width: 260px; font-size: 0.95em; }
.wiki-search-input:focus { outline: none; border-color: var(--wiki-accent); }
.wiki-search-btn { background: var(--wiki-accent); color: #fff; border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; font-size: 0.95em; }
.wiki-search-btn:hover { background: #c73450; }
.wiki-breadcrumb { background: var(--wiki-surface2); padding: 7px 24px; font-size: 0.85em; color: var(--wiki-text-muted); border-bottom: 1px solid var(--wiki-border); }
.wiki-breadcrumb a { color: var(--wiki-text-muted); }
.wiki-breadcrumb a:hover { color: var(--wiki-link); }
.wiki-content-wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }
.wiki-article-layout { display: flex; gap: 28px; align-items: flex-start; }
.wiki-article-main { flex: 1; min-width: 0; }
.wiki-article-sidebar { width: 300px; flex-shrink: 0; }
@media (max-width: 768px) { .wiki-article-layout { flex-direction: column; } .wiki-article-sidebar { width: 100%; } }
.wiki-article-title { font-size: 2em; font-weight: bold; color: #fff; margin: 0 0 4px 0; border-bottom: 2px solid var(--wiki-accent); padding-bottom: 8px; display: flex; align-items: center; gap: 12px; }
.wiki-delete-btn { font-size: 0.5em; background: #8b2020; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; vertical-align: middle; }
.wiki-delete-btn:hover { background: var(--wiki-accent); }
.wiki-intro { margin: 16px 0; line-height: 1.7; font-size: 1.02em; }
.wiki-toc { background: var(--wiki-toc-bg); border: 1px solid var(--wiki-border); border-radius: 6px; padding: 14px 18px; margin: 18px 0; display: inline-block; min-width: 200px; max-width: 100%; }
.wiki-toc-title { font-weight: bold; margin-bottom: 8px; font-size: 0.95em; color: var(--wiki-text-muted); }
.wiki-toc ol { margin: 0; padding-left: 20px; }
.wiki-toc li { margin: 3px 0; font-size: 0.9em; }
.wiki-section { margin: 24px 0; }
.wiki-section h2 { font-size: 1.35em; border-bottom: 1px solid var(--wiki-border); padding-bottom: 4px; color: #fff; }
.wiki-section h3 { font-size: 1.1em; color: #ddd; }
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
.wiki-channel-card h3 { margin: 0 0 8px 0; color: #fff; }
.wiki-channel-card p { margin: 0; font-size: 0.9em; color: var(--wiki-text-muted); }
.wiki-recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 18px; }
.wiki-article-card { background: var(--wiki-surface); border: 1px solid var(--wiki-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
.wiki-article-card-img { width: 100%; height: 130px; object-fit: cover; }
.wiki-article-card-img-placeholder { width: 100%; height: 130px; background: var(--wiki-surface2); display: flex; align-items: center; justify-content: center; font-size: 2em; }
.wiki-article-card-body { padding: 12px; flex: 1; }
.wiki-article-card-title { font-weight: bold; color: #fff; margin-bottom: 4px; font-size: 0.95em; }
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
.wiki-page-title { font-size: 1.8em; font-weight: bold; color: #fff; margin-bottom: 16px; }
.wiki-expiry-badge { display: inline-block; font-size: 0.78em; font-weight: normal; padding: 2px 10px; border-radius: 20px; margin-left: 6px; vertical-align: middle; }
.wiki-expiry-ok   { background: #1a3a1a; color: #7ecf7e; border: 1px solid #2e6b2e; }
.wiki-expiry-warn { background: #3a2a00; color: #f0b840; border: 1px solid #7a5c00; }
.wiki-expiry-crit { background: #3a1a00; color: #f07840; border: 1px solid #7a3000; }
.wiki-edit-btn { font-size: 0.5em; background: #1a5f3a; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; vertical-align: middle; text-decoration: none; display: inline-block; }
.wiki-edit-btn:hover { background: #238a52; }
.wiki-edit-form { max-width: 900px; margin: 0 auto; }
.wiki-edit-form h2 { font-size: 1.4em; color: #fff; margin: 0 0 20px; border-bottom: 2px solid var(--wiki-accent); padding-bottom: 8px; }
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
`;
}

/**********************************************************************************/
/* functionSignature: buildFullPage (head, body, basePath, channelId, menu, role) */
/* Wraps content in the full wiki HTML page.                                      */
/**********************************************************************************/
function buildFullPage({ head = "", body, basePath, channelId = "", wikiTitle, menu, role }) {
  const css = buildWikiCss();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(head || wikiTitle)}</title>
<link rel="stylesheet" href="${escHtml(basePath)}/style.css">
<style>${css}</style>
</head>
<body>
${buildPageHeader(wikiTitle, basePath, channelId, menu, role)}
${body}
</body>
</html>`;
}

/**********************************************************************************/
/* functionSignature: buildIndexPage (channels, basePath, menu, role)             */
/* Renders the wiki index page listing all accessible channels.                   */
/**********************************************************************************/
function buildIndexPage(channels, basePath, menu, role) {
  const cards = channels.map(ch => `
    <div class="wiki-channel-card">
      <h3><a href="${escHtml(basePath)}/${escHtml(ch.channelId)}">${escHtml(ch._title || ch.channelId)}</a></h3>
      <p>Channel ID: ${escHtml(ch.channelId)}</p>
    </div>`).join("");

  const body = `<div class="wiki-content-wrap">
  <div class="wiki-page-title">Available Wikis</div>
  ${cards ? `<div class="wiki-index">${cards}</div>` : `<div class="wiki-empty">No wikis configured.</div>`}
</div>`;

  return buildFullPage({ head: "Wiki Index", body, basePath, wikiTitle: "Wiki", menu, role });
}

/**********************************************************************************/
/* functionSignature: buildChannelHomePage (channel, articles, basePath, menu, role) */
/* Renders the channel wiki homepage with search bar + recent articles.           */
/**********************************************************************************/
function buildChannelHomePage(channel, articles, basePath, menu, role) {
  const chId    = channel.channelId;
  const chTitle = channel._title || `Wiki ${chId}`;
  const chPath  = `${basePath}/${chId}`;

  const articleCards = articles.map(a => {
    const cats = safeParseJson(a.categories, []);
    return `<a class="wiki-article-card" href="${escHtml(chPath)}/${escHtml(a.slug)}" style="text-decoration:none">
      ${a.image_url
        ? `<img class="wiki-article-card-img" src="${escHtml(a.image_url)}" alt="${escHtml(a.title)}" loading="lazy">`
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
</div>`;

  return buildFullPage({ head: chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role });
}

/**********************************************************************************/
/* functionSignature: buildArticlePage (channel, article, basePath, isEditor, menu, role, maxAgeDays) */
/* Renders a full Fandom-style wiki article page.                                 */
/**********************************************************************************/
function buildArticlePage(channel, article, basePath, isEditor, menu, role, maxAgeDays = 0) {
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

  return buildFullPage({ head: article.title + " – " + chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role });
}

/**********************************************************************************/
/* functionSignature: buildEditPage (channel, article, basePath, menu, role)      */
/* Renders the edit form for an existing wiki article (editor or admin only).     */
/**********************************************************************************/
function buildEditPage(channel, article, basePath, menu, role) {
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

  /* ── Image upload ── */
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

  /* ── Save ── */
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

  return buildFullPage({ head: "Edit: " + article.title + " – " + chTitle, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role });
}

/**********************************************************************************/
/* functionSignature: buildSearchPage (channel, query, results, basePath, menu, role, isCreator) */
/* Renders a search results page. Creators see a generate button/spinner;         */
/* non-creators see search results only.                                          */
/**********************************************************************************/
function buildSearchPage(channel, query, results, basePath, menu, role, isCreator = false) {
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
  <div id="wiki-results">
    ${results.length > 0
      ? `<div class="wiki-search-results">${resultItems}</div>
         <div style="margin-top:16px;color:var(--wiki-text-muted);font-size:.9em">
           ${results.length} result${results.length !== 1 ? "s" : ""} found.
           ${isCreator ? `<a href="#" id="wiki-gen-link" onclick="wikiGenerate(event)">Generate new article for this topic</a>` : ""}
         </div>`
      : isCreator
        ? `<div class="wiki-spinner-wrap" id="wiki-gen-spinner">
             <div class="wiki-spinner"></div>
             <div class="wiki-spinner-msg">Generating article… this may take a moment.</div>
           </div>`
        : `<div class="wiki-empty">No articles found for "<strong>${escHtml(query)}</strong>".</div>`}
    <div id="wiki-gen-results" style="display:none"></div>
  </div>
</div>
${isCreator ? `<script>
var WIKI_CHANNEL = ${JSON.stringify(chId)};
var WIKI_QUERY   = ${JSON.stringify(query)};
var WIKI_BASE    = ${JSON.stringify(chPath)};
var WIKI_HAS_RESULTS = ${results.length > 0 ? "true" : "false"};

function wikiGenerate(e) {
  if (e) e.preventDefault();
  document.getElementById('wiki-results').innerHTML =
    '<div class="wiki-spinner-wrap"><div class="wiki-spinner"></div><div class="wiki-spinner-msg">Generating article\u2026 this may take a moment.</div></div>';
  wikiDoGenerate(true);
}

function wikiDoGenerate(force) {
  fetch(WIKI_BASE + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: WIKI_QUERY, force: force === true })
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

if (!WIKI_HAS_RESULTS) { wikiDoGenerate(); }
</script>` : ""}`;

  return buildFullPage({ head: `Search: ${query} – ${chTitle}`, body, basePath, channelId: chId, wikiTitle: chTitle, menu, role });
}

/**********************************************************************************/
/* functionSignature: safeParseJson (val, fallback)                               */
/* Parses a JSON string; returns fallback on error.                               */
/**********************************************************************************/
function safeParseJson(val, fallback) {
  if (typeof val !== "string") return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**********************************************************************************/
/* functionSignature: resolveChannelConfig (cfg, rawChannel)                      */
/* Merges global defaults from the top-level webpage-wiki config onto a single    */
/* channel entry, similar to how core-channel-config applies overrides.           */
/* Arrays are replaced, plain objects are shallow-merged (channel wins).          */
/**********************************************************************************/
function resolveChannelConfig(cfg, rawChannel) {
  const resolved = Object.assign({}, rawChannel);

  /* Top-level scalar / array defaults (channel wins if present) */
  const scalarKeys = ["maxAgeDays", "allowedRoles", "adminRoles", "editorRoles", "creatorRoles", "_title"];
  for (const key of scalarKeys) {
    if (resolved[key] === undefined && cfg[key] !== undefined) {
      resolved[key] = cfg[key];
    }
  }

  /* ai block: global defaults, channel overrides individual keys */
  const globalAi  = (cfg.ai && typeof cfg.ai === "object") ? cfg.ai : {};
  const channelAi = (rawChannel.ai && typeof rawChannel.ai === "object") ? rawChannel.ai : {};
  resolved.ai = Object.assign({}, globalAi, channelAi);

  return resolved;
}

/**********************************************************************************/
/* functionSignature: getChannelConfig (cfg, channelId)                           */
/* Finds and resolves the channel config entry by channelId (global defaults      */
/* merged with channel-level overrides).                                          */
/**********************************************************************************/
function getChannelConfig(cfg, channelId) {
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];
  const raw = channels.find(c => getStr(c.channelId) === channelId);
  if (!raw) return null;
  return resolveChannelConfig(cfg, raw);
}

/**********************************************************************************/
/* functionSignature: getWebpageWiki (coreData)                                   */
/* Main module entry: handles all /wiki/* routes.                                 */
/**********************************************************************************/
export default async function getWebpageWiki(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg      = coreData?.config?.[MODULE_NAME] || {};
  const port     = Number(cfg.port ?? 3117);
  const basePath = getStr(cfg.basePath ?? "/wiki").replace(/\/+$/, "") || "/wiki";

  if (Number(wo.http?.port) !== port) return coreData;

  const url     = getStr(wo.http?.url || "/");
  const method  = getStr(wo.http?.method || "GET").toUpperCase();
  const urlPath = url.split("?")[0];

  if (!urlPath.startsWith(basePath)) return coreData;

  wo.stop = true;

  const menu = Array.isArray(wo?.web?.menu) ? wo.web.menu : [];
  const role = getStr(wo?.webAuth?.role || "");

  /* ── GET /wiki/style.css ── */
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

  /* ── GET /wiki  (index) ── */
  if (!channelId) {
    if (method !== "GET") { await sendText(wo, 405, "405 Method Not Allowed"); return coreData; }
    const allChannels = Array.isArray(cfg.channels) ? cfg.channels : [];
    const visible = allChannels.filter(ch => {
      const allowed = Array.isArray(ch.allowedRoles) ? ch.allowedRoles : [];
      return getIsAllowed(wo, allowed);
    });
    const html = buildIndexPage(visible, basePath, menu, role);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  /* Find channel config */
  const channel = getChannelConfig(cfg, channelId);
  if (!channel) {
    await sendHtml(wo, 404, buildFullPage({
      head: "404 – Wiki Not Found",
      body: `<div class="wiki-content-wrap"><div class="wiki-empty">Wiki not configured for channel <strong>${escHtml(channelId)}</strong>.</div></div>`,
      basePath, wikiTitle: "Wiki", menu, role
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

  const seg1 = segments[1] || "";  /* slug / "search" / "api" / "images" */
  const seg2 = segments[2] || "";  /* under api: "article" or filename */
  const seg3 = segments[3] || "";  /* under api/article: slug */

  let db;
  try {
    db = await getWikiDb(coreData);
  } catch (e) {
    await sendText(wo, 500, "Database unavailable: " + getStr(e?.message));
    return coreData;
  }

  /* Passive cleanup — delete expired articles in the background */
  dbPruneExpiredArticles(db, channelId, maxAgeDays).catch(() => {});

  /* ── POST /wiki/{ch}/api/generate ── */
  if (method === "POST" && seg1 === "api" && seg2 === "generate") {
    if (!isCreator) { await sendJson(wo, 403, { ok: false, error: "Forbidden – creator role required" }); return coreData; }
    let query = "";
    let force = false;
    try {
      const bodyJson = wo.http?.json || (wo.http?.rawBody ? JSON.parse(wo.http.rawBody) : {});
      query = getStr(bodyJson.query || "").trim();
      force = bodyJson.force === true;
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

    /* Generate new article — pre-load channel context, then run pipeline */
    try {
      const ctxLimit   = Number(channel.contextMessages ?? 150);
      const ctxSnippet = ctxLimit > 0
        ? await getChannelContextSnippet(db, channelId, ctxLimit)
        : "";
      const article   = await callPipelineForArticle(query, channel, coreData, ctxSnippet);
      const slug      = getSlug(article.title || query);
      const finalSlug = await dbSaveArticle(db, channelId, slug, article);
      await sendJson(wo, 200, { ok: true, slug: finalSlug, generated: true });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Generation failed") });
    }
    return coreData;
  }

  /* ── DELETE /wiki/{ch}/api/article/{slug} ── */
  if (method === "DELETE" && seg1 === "api" && seg2 === "article" && seg3) {
    if (!isEditor) { await sendJson(wo, 403, { ok: false, error: "Forbidden" }); return coreData; }
    try {
      /* Images are stored in pub/documents/ (managed by getImage tool) — not deleted here */
      await dbDeleteArticle(db, channelId, seg3);
      await sendJson(wo, 200, { ok: true });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Delete failed") });
    }
    return coreData;
  }

  /* ── GET /wiki/{ch} (channel homepage) ── */
  if (!seg1) {
    if (method !== "GET") { await sendText(wo, 405, "405 Method Not Allowed"); return coreData; }
    let articles = [];
    try { articles = await dbGetRecentArticles(db, channelId, maxAgeDays); } catch { articles = []; }
    const html = buildChannelHomePage(channel, articles, basePath, menu, role);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  /* ── GET /wiki/{ch}/search?q= ── */
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
    const html = buildSearchPage(channel, query, results, basePath, menu, role, isCreator);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  /* ── POST /wiki/{ch}/api/upload-image/{slug} — upload image for article ── */
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
      await sendJson(wo, 200, { ok: true, url: publicUrl });
    } catch (e) {
      await sendJson(wo, 500, { ok: false, error: getStr(e?.message || "Upload failed") });
    }
    return coreData;
  }

  /* ── GET /wiki/{ch}/images/{filename} — serve uploaded article images ── */
  if (method === "GET" && seg1 === "images" && seg2) {
    const imgDir  = path.join(__dirname, "..", "pub", "wiki", channelId, "images");
    const imgPath = path.resolve(imgDir, seg2);
    if (!imgPath.startsWith(path.resolve(imgDir))) { await sendText(wo, 400, "Bad Request"); return coreData; }
    try {
      const data = fs.readFileSync(imgPath);
      const ext  = path.extname(seg2).toLowerCase().slice(1) || "png";
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
      wo.http.response = { status: 200, headers: { "Content-Type": mime, "Cache-Control": "max-age=86400" }, body: data };
      await setSendNow(wo);
    } catch { await sendText(wo, 404, "Image not found"); }
    return coreData;
  }

  /* ── GET /wiki/{ch}/{slug}/edit — editor edit form ── */
  if (method === "GET" && seg2 === "edit" && seg1) {
    if (!isEditor) { await sendText(wo, 403, "403 Forbidden"); return coreData; }
    let article = null;
    try { article = await dbGetArticle(db, channelId, seg1, maxAgeDays); } catch { /* ignore */ }
    if (!article) {
      await sendHtml(wo, 404, buildFullPage({
        head: "404 – Article Not Found",
        body: `<div class="wiki-content-wrap"><div class="wiki-empty">Article "<strong>${escHtml(seg1)}</strong>" not found.</div></div>`,
        basePath, channelId, wikiTitle: channel._title || `Wiki ${channelId}`, menu, role
      }));
      return coreData;
    }
    const html = buildEditPage(channel, article, basePath, menu, role);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  /* ── POST /wiki/{ch}/{slug}/edit — save edited article ── */
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

  /* ── GET /wiki/{ch}/{slug} ── */
  if (seg1 && method === "GET") {
    let article = null;
    try { article = await dbGetArticle(db, channelId, seg1, maxAgeDays); } catch { /* ignore */ }
    if (!article) {
      await sendHtml(wo, 404, buildFullPage({
        head: "404 – Article Not Found",
        body: `<div class="wiki-content-wrap"><div class="wiki-empty">Article "<strong>${escHtml(seg1)}</strong>" not found in this wiki.</div></div>`,
        basePath, channelId, wikiTitle: channel._title || `Wiki ${channelId}`, menu, role
      }));
      return coreData;
    }
    const html = buildArticlePage(channel, article, basePath, isEditor, menu, role, maxAgeDays);
    await sendHtml(wo, 200, html);
    return coreData;
  }

  await sendText(wo, 405, "405 Method Not Allowed");
  return coreData;
}
