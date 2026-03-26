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


function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}


function readJsonFile(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}


function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}


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


/* getMenuHtml(menu, activePath, role, rightHtmlOpt, extraDropdownHtml, userInfo)
   userInfo = { userId, username, guildId }  — optional; enables profile dropdown */
function getMenuHtml(menu, activePath, role, rightHtmlOpt, extraDropdownHtml, userInfo) {
  const items = Array.isArray(menu) ? menu : [];

  const cur = String(activePath || "/") || "/";
  const r0  = String(role || "").trim();
  const r   = r0 ? r0.toLowerCase() : "";

  const filtered = [];
  for (const it of items) {
    const text  = String(it.text || it.label || it.name || "").trim();
    const link  = String(it.link || it.href  || it.url  || "").trim();
    const roles = Array.isArray(it.roles) ? it.roles : [];
    if (!text || !link) continue;
    if (roles.length && r && r !== "admin") {
      const ok = roles.map(x => String(x || "").trim().toLowerCase()).filter(Boolean).includes(r);
      if (!ok) continue;
    }
    filtered.push({ text, link });
  }

  function mkLink(it, extraClass) {
    const isActive = (cur === it.link) || (it.link !== "/" && cur.startsWith(it.link));
    return '<a href="' + escAttr(it.link) + '" class="nav-link' +
      (isActive ? " active" : "") +
      (extraClass ? " " + extraClass : "") +
      '">' + escHtml(it.text) + "</a>";
  }

  let nav = '<nav class="nav-links">';
  nav += '<details class="nav-more has-overflow">';
  nav += '<summary class="nav-link nav-more-btn">&#xB7;&#xB7;&#xB7;</summary>';
  nav += '<div class="nav-more-drop">';
  for (const it of filtered) nav += mkLink(it, "nav-more-item");
  if (extraDropdownHtml) nav += extraDropdownHtml;
  nav += "</div></details>";
  nav += "</nav>";

  const ui      = userInfo && typeof userInfo === "object" ? userInfo : {};
  const uid     = String(ui.userId   || "");
  const uname   = String(ui.username || "");
  const gid     = String(ui.guildId  || "");
  const isDark  = false; /* initial state resolved by script below */

  let profileRows = "";
  if (uname) profileRows += '<div class="nav-pi-row"><span class="nav-pi-lbl">User</span><span class="nav-pi-val">'  + escHtml(uname) + "</span></div>";
  if (uid)   profileRows += '<div class="nav-pi-row"><span class="nav-pi-lbl">User ID</span><span class="nav-pi-val nav-pi-mono">'  + escHtml(uid)   + "</span></div>";
  if (gid)   profileRows += '<div class="nav-pi-row"><span class="nav-pi-lbl">Guild ID</span><span class="nav-pi-val nav-pi-mono">' + escHtml(gid)   + "</span></div>";

  const profileDrop =
    '<details class="nav-more nav-profile has-overflow" id="nav-profile-det">' +
      '<summary class="nav-link nav-profile-btn">\uD83D\uDC64 ' + escHtml(r ? r : "guest") + '</summary>' +
      '<div class="nav-more-drop nav-profile-drop">' +
        (profileRows ? '<div class="nav-pi-block">' + profileRows + '</div>' : "") +
        '<button class="nav-link nav-more-item" id="jenny-theme-btn"' +
          ' style="width:100%;text-align:left;cursor:pointer;border:none;font-size:13px;padding:6px 14px"' +
          ' onclick="toggleTheme()">\uD83C\uDF19 Dark Mode</button>' +
        (r
          ? '<a class="nav-link nav-more-item" href="/auth/logout" style="display:block;padding:6px 14px">Logout</a>'
          : '<a class="nav-link nav-more-item" href="/auth/login"  style="display:block;padding:6px 14px">Login</a>') +
      '</div>' +
    '</details>';

  const script =
    '<script>!function(){if(window._navMoreReady)return;window._navMoreReady=true;' +
    'document.addEventListener("click",function(e){' +
      'document.querySelectorAll(".nav-more[open]").forEach(function(d){' +
        'if(!d.contains(e.target))d.removeAttribute("open");' +
      '});' +
    '},true);' +
    'function applyTheme(dark){' +
      'document.documentElement.setAttribute("data-theme",dark?"dark":"light");' +
      'var b=document.getElementById("jenny-theme-btn");' +
      'if(b)b.textContent=dark?"\u2600\uFE0F Light Mode":"\uD83C\uDF19 Dark Mode";' +
      'localStorage.setItem("jenny-theme",dark?"dark":"light");' +
    '}' +
    'window.toggleTheme=function(){' +
      'applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");' +
      'document.querySelectorAll(".nav-more[open]").forEach(function(d){d.removeAttribute("open");});' +
    '};' +
    'applyTheme(localStorage.getItem("jenny-theme")==="dark");' +
    '}();<\/script>';

  const rightHtml = String(rightHtmlOpt || "");
  /* nav-wrap contains only the ... dropdown (flex:0 so h1 sits right next to it).
     nav-right-slot is a separate header sibling so margin-left:auto pushes it to the
     far right of the header regardless of the h1 width. */
  const rightSlot =
    '<div class="nav-right-slot">' +
      (rightHtml ? rightHtml : "") +
      profileDrop +
    '</div>';

  return (
    '<div class="nav-wrap">' +
      nav + script +
    '</div>' +
    rightSlot
  );
}


function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}


function escAttr(s) {
  return escHtml(s).replace(/'/g,"&#39;");
}


function getThemeHeadScript() {
  return '<script>!function(){var t=localStorage.getItem("jenny-theme");' +
         'document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light");}();<\/script>';
}

/**********************************************************************************/
/* Named exports                                                                   *
/**********************************************************************************/
export { getBody, readJsonFile, writeJsonFile, isAuthorized, getDb, getMenuHtml, getThemeHeadScript, escHtml };
