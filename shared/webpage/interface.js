/********************************************************************************************************************
* filename: "interface.js"
* Version 3.0
* Purpose: Shared webpage utilities + menu renderer.
*          UI HTML lives in the webpage modules:
*            - modules/00047-webpage-config-editor.js
*            - modules/00048-webpage-chat.js
********************************************************************************************************************/
/********************************************************************************************************************
*
********************************************************************************************************************/

"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** Lazily-created mysql2 connection pool — shared across all context requests. */
let dbPool = null;

/********************************************************************************************************************
* functionSignature: getBody (req)
* Purpose: Reads request body into a string.
********************************************************************************************************************/
function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/********************************************************************************************************************
* functionSignature: readJsonFile (filePath)
* Purpose: Reads and parses a JSON file.
********************************************************************************************************************/
function readJsonFile(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/********************************************************************************************************************
* functionSignature: writeJsonFile (filePath, data)
* Purpose: Writes data as pretty-printed JSON.
********************************************************************************************************************/
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/********************************************************************************************************************
* functionSignature: isAuthorized (req, token)
* Purpose: Returns true if no token is required or the request carries the correct Bearer/Basic token.
********************************************************************************************************************/
function isAuthorized(req, token) {
  if (!token) return true;
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ") && auth.slice(7).trim() === token) return true;
  if (auth.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    if (decoded === "admin:" + token || decoded.split(":")[1] === token) return true;
  }
  return false;
}

/********************************************************************************************************************
* functionSignature: getDb (coreData)
* Purpose: Returns (creating if needed) a mysql2 connection pool using DB config from workingObject.
********************************************************************************************************************/
async function getDb(coreData) {
  if (dbPool) return dbPool;

  let mysql2;
  try { mysql2 = await import("mysql2/promise"); }
  catch (e) { throw new Error("mysql2 module not available: " + String(e?.message || e)); }

  const db = coreData?.workingObject?.db || {};
  dbPool = mysql2.createPool({
    host:            String(db.host     || "localhost"),
    port:            Number(db.port     || 3306),
    user:            String(db.user     || ""),
    password:        String(db.password || ""),
    database:        String(db.database || ""),
    charset:         String(db.charset  || "utf8mb4"),
    connectionLimit: 3,
    waitForConnections: true,
  });

  return dbPool;
}

/********************************************************************************************************************
* functionSignature: getMenuHtml (menu, activePath, role, rightHtmlOpt)
* Purpose: Renders header nav links from wo.web.menu (webpage-menu) and shows effective role + logout.
*          Optional: rightHtmlOpt renders custom right-side controls (e.g., Save button) left of role/logout.
********************************************************************************************************************/
function getMenuHtml(menu, activePath, role, rightHtmlOpt) {
  const items = Array.isArray(menu) ? menu : [];

  const cur = String(activePath || "/") || "/";
  const r0  = String(role || "").trim();
  const r   = r0 ? r0.toLowerCase() : "";

  let nav = '<nav class="nav-links">';

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const text  = String(it.text || it.label || it.name || "").trim();
    const link  = String(it.link || it.href  || it.url  || "").trim();
    const roles = Array.isArray(it.roles) ? it.roles : [];

    if (!text || !link) continue;

    /* Role gate:
       - roles empty => show
       - role missing => show everything (fallback)
       - admin => show everything
       - else => must match roles[] */
    if (roles.length && r && r !== "admin") {
      const ok = roles.map(x => String(x || "").trim().toLowerCase()).filter(Boolean).includes(r);
      if (!ok) continue;
    }

    const isActive = (cur === link) || (link !== "/" && cur.startsWith(link));
    nav += '<a href="' + escAttr(link) + '" class="nav-link' + (isActive ? " active" : "") + '">' +
           escHtml(text) + '</a>';
  }

  nav += "</nav>";

  const roleLabel = r ? r : "unknown";

  const rightHtml = String(rightHtmlOpt || "");

  const right =
    '<div class="nav-right" style="margin-left:auto;display:flex;align-items:center;gap:10px;white-space:nowrap">' +
      (rightHtml ? rightHtml : "") +
      '<span class="nav-role">role: ' + escHtml(roleLabel) + '</span>' +
      '<a class="nav-logout" href="/auth/logout">Logout</a>' +
    '</div>';

  return (
    '<div class="nav-wrap" style="display:flex;align-items:center;gap:12px;width:100%">' +
      nav +
      right +
    '</div>'
  );
}

/********************************************************************************************************************
* functionSignature: escHtml (s)
********************************************************************************************************************/
function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

/********************************************************************************************************************
* functionSignature: escAttr (s)
********************************************************************************************************************/
function escAttr(s) {
  return escHtml(s).replace(/'/g,"&#39;");
}

/********************************************************************************************************************
* Named exports
********************************************************************************************************************/
export { getBody, readJsonFile, writeJsonFile, isAuthorized, getDb, getMenuHtml };
