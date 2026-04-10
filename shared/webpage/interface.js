/**************************************************************/
/* filename: "interface.js"                                         */
/* Version 1.0                                               */
/* Purpose: Shared helper implementation.                   */
/**************************************************************/










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




function getMenuHtml(menu, activePath, role, rightHtmlOpt, extraDropdownHtml, userInfo) {
  const items = Array.isArray(menu) ? menu : [];
  const cur = String(activePath || "/") || "/";
  const r0  = String(role || "").trim();
  const r   = r0 ? r0.toLowerCase() : "";
  const filtered = [];
  for (const it of items) {
    const text  = String(it.text || it.label || it.name || "").trim();
    const link  = String(it.link || it.href  || it.url  || "").trim();
    const icon  = String(it.icon || "").trim();
    const roles = Array.isArray(it.roles) ? it.roles : [];
    if (!text || !link) continue;
    if (roles.length && r && r !== "admin") {
      const ok = roles.map(x => String(x || "").trim().toLowerCase()).filter(Boolean).includes(r);
      if (!ok) continue;
    }
    const path = Array.isArray(it.path) ? it.path.map(part => String(part || "").trim()).filter(Boolean) : [text];
    filtered.push({ text, link, icon, path, label: String(it.label || path[path.length - 1] || text).trim() });
  }
  function getIsActiveLink(link) {
    return (cur === link) || (link !== "/" && cur.startsWith(link));
  }
  function getLinkLabel(it) {
    const iconHtml = it.icon ? '<span class="nav-icon">' + escHtml(it.icon) + "</span>" : "";
    return iconHtml + '<span class="nav-label">' + escHtml(it.label) + "</span>";
  }
  function mkLink(it, extraClass) {
    const isActive = (cur === it.link) || (it.link !== "/" && cur.startsWith(it.link));
    return '<a href="' + escAttr(it.link) + '" class="nav-link' +
      (isActive ? " active" : "") +
      (extraClass ? " " + extraClass : "") +
      '">' + getLinkLabel(it) + "</a>";
  }
  function getMakeNode(name, depth) {
    return { name, depth, items: [], groups: [] };
  }
  function getFindGroup(groups, name) {
    for (const group of groups) {
      if (group.name === name) return group;
    }
    return null;
  }
  const tree = [];
  for (const it of filtered) {
    const parts = Array.isArray(it.path) && it.path.length ? it.path : [it.label || it.text];
    let groups = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = String(parts[i] || "").trim();
      if (!name) continue;
      let group = getFindGroup(groups, name);
      if (!group) {
        group = getMakeNode(name, i);
        groups.push(group);
      }
      groups = group.groups;
      if (i === parts.length - 2) group.items.push({ ...it, label: String(parts[parts.length - 1] || it.label || it.text).trim() });
    }
    if (parts.length === 1) {
      tree.push({ ...getMakeNode(parts[0], 0), items: [{ ...it, label: parts[0] }], groups: [], standalone: true });
    }
  }
  function getGroupIsActive(group) {
    return group.items.some(item => getIsActiveLink(item.link)) || group.groups.some(child => getGroupIsActive(child));
  }
  function renderGroupItems(group, depth) {
    let html = '<div class="nav-cascade-list">';
    for (const item of group.items) html += mkLink(item, "nav-more-item");
    for (const child of group.groups) html += renderCascadeGroup(child, depth + 1);
    html += "</div>";
    return html;
  }
  function renderCascadeGroup(group, depth) {
    const open = getGroupIsActive(group) ? " open" : "";
    let html = '<details class="nav-more nav-cascade"' + open + ">";
    html += '<summary class="nav-link nav-more-item nav-cascade-btn"><span class="nav-label">' + escHtml(group.name) + '</span><span class="nav-cascade-arrow">&#8250;</span></summary>';
    html += '<div class="nav-more-drop nav-tree-drop nav-cascade-drop">';
    html += renderGroupItems(group, depth);
    html += "</div></details>";
    return html;
  }
  let nav = '<nav class="nav-links">';
  nav += '<details class="nav-more nav-main-menu has-overflow">';
  nav += '<summary class="nav-link nav-more-btn">...</summary>';
  nav += '<div class="nav-more-drop nav-tree-drop">';
  for (const node of tree) {
    if (node.standalone) {
      nav += mkLink(node.items[0], "nav-more-item");
      continue;
    }
    nav += renderCascadeGroup(node, 0);
  }
  if (extraDropdownHtml) nav += extraDropdownHtml;
  nav += "</div></details>";
  nav += "</nav>";
  const ui      = userInfo && typeof userInfo === "object" ? userInfo : {};
  const uid     = String(ui.userId   || "");
  const uname   = String(ui.username || "");
  const gid     = String(ui.guildId  || "");
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
    'function closeMenus(){document.querySelectorAll(".nav-more[open]").forEach(function(d){d.removeAttribute("open");});}' +
    'document.addEventListener("click",function(e){' +
      'if(e.target.closest(".nav-more-drop a[href]")){closeMenus();return;}' +
      'document.querySelectorAll(".nav-more[open]").forEach(function(d){' +
        'if(!d.contains(e.target))d.removeAttribute("open");' +
      '});' +
    '},true);' +
    'function setThemeButtonLabel(){' +
      'var b=document.getElementById("jenny-theme-btn");' +
      'if(!b)return;' +
      'var dark=document.documentElement.getAttribute("data-theme")==="dark";' +
      'b.textContent=dark?"\u2600\uFE0F Light Mode":"\uD83C\uDF19 Dark Mode";' +
    '}' +
    'function applyTheme(dark){' +
      'document.documentElement.setAttribute("data-theme",dark?"dark":"light");' +
      'setThemeButtonLabel();' +
      'localStorage.setItem("jenny-theme",dark?"dark":"light");' +
    '}' +
    'window.toggleTheme=function(){' +
      'applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");' +
      'closeMenus();' +
    '};' +
    'var savedTheme=localStorage.getItem("jenny-theme");' +
    'if(savedTheme==="dark"||savedTheme==="light"){document.documentElement.setAttribute("data-theme",savedTheme);}' +
    'else if(document.documentElement.getAttribute("data-theme")!=="dark"){document.documentElement.setAttribute("data-theme","light");}' +
    'setThemeButtonLabel();' +
    '}();<\/script>';
  const rightHtml = String(rightHtmlOpt || "");
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




export { getBody, readJsonFile, writeJsonFile, isAuthorized, getDb, getMenuHtml, getThemeHeadScript, escHtml };



