/**********************************************************************************/
/* filename: interface.js                                                          *
/* Version 1.0                                                                     *
/* Purpose: Shared webpage utilities and menu renderer.                            *
/**********************************************************************************/

/**********************************************************************************/
/*                                                                                 *
/**********************************************************************************/

"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

let dbPool = null;

/**********************************************************************************/
/* functionSignature: getBody (req)                                                *
/* Purpose: Reads request body into a string.                                      *
/**********************************************************************************/
function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**********************************************************************************/
/* functionSignature: readJsonFile (filePath)                                      *
/* Purpose: Reads and parses a JSON file.                                          *
/**********************************************************************************/
function readJsonFile(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**********************************************************************************/
/* functionSignature: writeJsonFile (filePath, data)                               *
/* Purpose: Writes data as pretty-printed JSON.                                    *
/**********************************************************************************/
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**********************************************************************************/
/* functionSignature: isAuthorized (req, token)                                    *
/* Purpose: Returns true if no token is required or the request carries the        *
/*          correct Bearer/Basic token.                                            *
/**********************************************************************************/
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

/**********************************************************************************/
/* functionSignature: getDb (coreData)                                             *
/* Purpose: Returns (creating if needed) a mysql2 connection pool using DB config  *
/*          from workingObject.                                                    *
/**********************************************************************************/
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

/**********************************************************************************/
/* functionSignature: getMenuHtml (menu, activePath, role, rightHtmlOpt)           *
/* Purpose: Renders header nav links from wo.web.menu (webpage-menu) and shows     *
/*          effective role + logout.                                               *
/* Optional: rightHtmlOpt renders custom right-side controls (e.g., Save button)   *
/*          left of role/logout.                                                   *
/**********************************************************************************/
function getMenuHtml(menu, activePath, role, rightHtmlOpt) {
  const items = Array.isArray(menu) ? menu : [];
  const VISIBLE = 3; /* first N items shown directly on desktop */

  const cur = String(activePath || "/") || "/";
  const r0  = String(role || "").trim();
  const r   = r0 ? r0.toLowerCase() : "";

  /* Collect role-filtered items */
  const filtered = [];
  for (const it of items) {
    const text  = String(it.text || it.label || it.name || "").trim();
    const link  = String(it.link || it.href  || it.url  || "").trim();
    const roles = Array.isArray(it.roles) ? it.roles : [];
    if (!text || !link) continue;
    /* Role gate: roles empty => show; admin => show all; else must match */
    if (roles.length && r && r !== "admin") {
      const ok = roles.map(x => String(x || "").trim().toLowerCase()).filter(Boolean).includes(r);
      if (!ok) continue;
    }
    filtered.push({ text, link });
  }

  const primary  = filtered.slice(0, VISIBLE);   /* shown directly on desktop */
  const overflow = filtered.slice(VISIBLE);       /* always in dropdown */

  function mkLink(it, extraClass) {
    const isActive = (cur === it.link) || (it.link !== "/" && cur.startsWith(it.link));
    return '<a href="' + escAttr(it.link) + '" class="nav-link' +
      (isActive ? " active" : "") +
      (extraClass ? " " + extraClass : "") +
      '">' + escHtml(it.text) + "</a>";
  }

  let nav = '<nav class="nav-links">';

  /* Direct primary items (hidden on mobile via CSS) */
  for (const it of primary) nav += mkLink(it, "nav-primary");

  /* Collapsible dropdown — always rendered so mobile can use it too */
  nav += '<details class="nav-more' + (overflow.length ? " has-overflow" : "") + '">';
  nav += '<summary class="nav-link nav-more-btn">&#xB7;&#xB7;&#xB7;</summary>';
  nav += '<div class="nav-more-drop">';
  /* Primary items repeated inside dropdown — shown only on mobile via CSS */
  for (const it of primary)  nav += mkLink(it, "nav-more-item nav-more-primary");
  /* Overflow items always visible in dropdown */
  for (const it of overflow) nav += mkLink(it, "nav-more-item");
  nav += "</div></details>";

  nav += "</nav>";

  /* Close dropdown when clicking outside (runs once per page) */
  nav += '<script>!function(){if(window._navMoreReady)return;window._navMoreReady=true;' +
         'document.addEventListener("click",function(e){' +
         'var d=document.querySelector(".nav-more[open]");' +
         'if(d&&!d.contains(e.target))d.removeAttribute("open");' +
         '},true);}();</script>';

  const roleLabel = r ? r : "unknown";
  const rightHtml = String(rightHtmlOpt || "");
  const right =
    '<div class="nav-right" style="margin-left:auto;display:flex;align-items:center;gap:10px;white-space:nowrap;flex-shrink:0">' +
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

/**********************************************************************************/
/* functionSignature: escHtml (s)                                                  *
/**********************************************************************************/
function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

/**********************************************************************************/
/* functionSignature: escAttr (s)                                                  *
/**********************************************************************************/
function escAttr(s) {
  return escHtml(s).replace(/'/g,"&#39;");
}

/**********************************************************************************/
/* Named exports                                                                   *
/**********************************************************************************/
export { getBody, readJsonFile, writeJsonFile, isAuthorized, getDb, getMenuHtml };
