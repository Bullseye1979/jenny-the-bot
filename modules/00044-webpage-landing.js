/************************************************************************************/
/* filename: 00044-webpage-landing.js                                               */
/* Version 1.0                                                                      */
/* Purpose: Landing page at GET / after login. Renders the role-filtered menu       */
/*          (wo.web.menu set by 00043-webpage-menu) and a welcome message.          */
/*          Config key: webpage-landing. Only reads own config + workingObject.     */
/************************************************************************************/

import { getItem }                         from "../core/registry.js";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";

const MODULE_NAME = "webpage-landing";


function getStr(v) { return v == null ? "" : String(v); }
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = getItem(key);
  if (!entry?.res) return;
  const { res } = entry;
  if (res.writableEnded || res.headersSent) return;
  const r = wo.http?.response || {};
  try {
    res.writeHead(Number(r.status ?? 200), r.headers ?? { "Content-Type": "text/html; charset=utf-8" });
    res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? ""));
  } catch {}
}


function buildHtml(wo) {
  const username = escHtml(getStr(wo.webAuth?.username) || "Guest");
  const role     = escHtml(getStr(wo.webAuth?.role) || "");
  const menu     = Array.isArray(wo.web?.menu) ? wo.web.menu : [];
  const menuHtml = getMenuHtml(menu, "/", role);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Home \u2014 Jenny</title>
${getThemeHeadScript()}
<style>
body { margin: 0; }
.wrap {
  margin-top: var(--hh);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - var(--hh));
  padding: 2rem 1rem;
  box-sizing: border-box;
  color: var(--txt, #eee);
  text-align: center;
}
.welcome { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.4rem; }
.sub     { font-size: 0.85rem; color: var(--muted, #888); }
</style>
</head>
<body>
${menuHtml}
<div class="wrap">
  <div class="welcome">Welcome, ${username}</div>
  ${role ? `<div class="sub">${role}</div>` : ""}
</div>
</body>
</html>`;
}


export default async function getWebpageLanding(coreData) {
  const wo = coreData?.workingObject;
  if (!wo) return coreData;

  const cfg    = coreData?.config?.[MODULE_NAME] ?? {};
  if (cfg.enabled === false) return coreData;
  if (getStr(wo.flow).toLowerCase() !== "webpage") return coreData;
  if (getStr(wo.http?.method).toUpperCase() !== "GET") return coreData;
  if (getStr(wo.http?.path) !== "/" && getStr(wo.http?.path) !== "") return coreData;

  const port    = Number(cfg.port ?? 3111);
  if (Number(wo.http?.port) !== port) return coreData;

  if (!wo.webAuth?.role) {
    wo.http.response = { status: 302, headers: { Location: "/auth/login?next=%2F" }, body: "" };
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  wo.http.response = {
    status:  200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body:    buildHtml(wo)
  };
  wo.jump = true;
  await setSendNow(wo);
  return coreData;
}
