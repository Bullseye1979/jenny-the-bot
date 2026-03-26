/************************************************************************************/
/* filename: 00057-webpage-gdpr.js                                                  *
/* Version 1.0                                                                      *
/* Purpose: GDPR data-export SPA.  Authenticated users can download an Excel file  *
/*          containing all personal data held for their account:                   *
/*            • Sheet 1 – Context entries (id = userId or id = userId-prefixed)    *
/*            • Sheet 2 – GDPR consent records                                     *
/*            • Sheet 3 – Files stored in the user documents directory             *
/* Flow: webpage                                                                    *
/* Port: 3121 (cfg.port)                                                            *
/************************************************************************************/

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import mysql   from "mysql2/promise";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { setJsonResp } from "../shared/webpage/utils.js";
import { getUserId } from "../core/file.js";

const MODULE_NAME   = "webpage-gdpr";
const __dirname_gdpr = path.dirname(fileURLToPath(import.meta.url));
const PUB_DOCUMENTS  = path.join(__dirname_gdpr, "..", "pub", "documents");

function getDbConfig(wo) {
  const db = wo?.db || {};
  const { host, user, password, database } = db;
  if (!host || !user || !database) return null;
  return { host, user, password: password || "", database, charset: "utf8mb4" };
}

function getCssPath() {
  return path.join(__dirname_gdpr, "../shared/webpage/style.css");
}

async function buildGdprWorkbook(userId, dbCfg, gdprTable) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jenny Bot";
  wb.created = new Date();

  function setHeaderRow(sheet, headers) {
    const row = sheet.addRow(headers);
    row.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  let conn = null;
  try {
    conn = await mysql.createConnection(dbCfg);

    const ctxSheet = wb.addWorksheet("Context");
    setHeaderRow(ctxSheet, ["ctx_id", "timestamp", "channel_id", "userid", "role", "text", "frozen"]);
    ctxSheet.columns = [
      { key: "ctx_id",  width: 12 },
      { key: "ts",      width: 22 },
      { key: "id",      width: 30 },
      { key: "userid",  width: 30 },
      { key: "role",    width: 12 },
      { key: "text",    width: 60 },
      { key: "frozen",  width: 8  }
    ];

    let ctxRows = [];
    try {
      const [rows] = await conn.execute(
        "SELECT ctx_id, ts, id, userid, role, text, frozen FROM context WHERE userid = ? AND role = 'user' ORDER BY ctx_id",
        [userId]
      );
      ctxRows = rows;
    } catch { /* table might not exist */ }

    for (const r of ctxRows) {
      ctxSheet.addRow([
        r.ctx_id,
        r.ts instanceof Date ? r.ts.toISOString() : String(r.ts ?? ""),
        String(r.id ?? ""),
        String(r.userid ?? ""),
        String(r.role ?? ""),
        String(r.text ?? ""),
        r.frozen ? "yes" : "no"
      ]);
    }

    const gdprSheet = wb.addWorksheet("GDPR Consent");
    setHeaderRow(gdprSheet, ["user_id", "channel_id", "chat_consent", "voice_consent", "disclaimer_sent", "updated_at"]);
    gdprSheet.columns = [
      { key: "user_id",    width: 24 },
      { key: "channel_id", width: 24 },
      { key: "chat",       width: 14 },
      { key: "voice",      width: 14 },
      { key: "disclaimer", width: 18 },
      { key: "updated_at", width: 22 }
    ];

    let gdprRows = [];
    try {
      const [rows] = await conn.execute(
        `SELECT user_id, channel_id, chat, voice, disclaimer, updated_at FROM \`${gdprTable}\` WHERE user_id = ?`,
        [userId]
      );
      gdprRows = rows;
    } catch { /* table might not exist */ }

    for (const r of gdprRows) {
      gdprSheet.addRow([
        String(r.user_id ?? ""),
        String(r.channel_id ?? ""),
        r.chat       ? "yes" : "no",
        r.voice      ? "yes" : "no",
        r.disclaimer ? "yes" : "no",
        r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? "")
      ]);
    }

    await conn.end().catch(() => {});
    conn = null;

  } catch (e) {
    if (conn) { try { await conn.end(); } catch {} }
    wb.getWorksheet("Context")  || wb.addWorksheet("Context");
    wb.getWorksheet("GDPR Consent") || wb.addWorksheet("GDPR Consent");
    const errSheet = wb.addWorksheet("Export Errors");
    errSheet.addRow(["error", String(e?.message || e)]);
  }

  const fileSheet = wb.addWorksheet("Files");
  setHeaderRow(fileSheet, ["filename", "size_bytes", "modified"]);
  fileSheet.columns = [
    { key: "filename", width: 40 },
    { key: "size",     width: 14 },
    { key: "modified", width: 24 }
  ];

  try {
    const userDir = path.join(PUB_DOCUMENTS, userId);
    const entries = fs.existsSync(userDir) ? fs.readdirSync(userDir) : [];
    for (const name of entries.sort()) {
      try {
        const stat = fs.statSync(path.join(userDir, name));
        if (stat.isFile()) {
          fileSheet.addRow([name, stat.size, stat.mtime.toISOString()]);
        }
      } catch {}
    }
  } catch {}

  return wb;
}

export default async function getWebpageGdpr(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const port     = Number(cfg.port     || 3121);
  const basePath = String(cfg.basePath || "/gdpr").replace(/\/$/, "");
  const gdprTable = String(cfg.gdprTable || "gdpr");

  if (wo.http?.port !== port) return coreData;

  const method  = String(wo.http?.method || "GET").toUpperCase();
  const urlPath = String(wo.http?.path   || "/").replace(/\/$/, "") || "/";

  if (method === "GET" && urlPath === basePath + "/style.css") {
    try {
      const css = fs.readFileSync(getCssPath(), "utf-8");
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

  const userId   = getUserId(wo);
  const username = String(wo.webAuth?.username || userId);
  const role     = String(wo.webAuth?.role || "").toLowerCase();
  const menu     = Array.isArray(wo.web?.menu) ? wo.web.menu : [];

  if (method === "GET" && urlPath === basePath + "/export.xlsx") {
    const dbCfg = getDbConfig(wo);
    if (!dbCfg) {
      setJsonResp(wo, 503, { ok: false, error: "database_not_configured" });
      wo.jump = true;
      return coreData;
    }

    try {
      const wb = await buildGdprWorkbook(userId, dbCfg, gdprTable);
      const buf = await wb.xlsx.writeBuffer();
      const filename = `gdpr-export-${userId}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      wo.http.response = {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        },
        body: Buffer.from(buf)
      };
    } catch (e) {
      setJsonResp(wo, 500, { ok: false, error: String(e?.message || e) });
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
<title>GDPR Data Export</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${basePath}/style.css">
<style>
#gdpr-view{padding:20px;max-width:700px;margin:calc(var(--hh,52px) + 20px) auto 20px;}
.gdpr-card{background:var(--bg2,#fff);border:1px solid var(--bdr,#e2e8f0);border-radius:10px;padding:24px 28px;margin-bottom:20px;}
.gdpr-card h2{margin:0 0 12px;font-size:16px;color:var(--txt,#1e293b);}
.gdpr-card p{margin:0 0 10px;font-size:14px;color:var(--muted,#64748b);line-height:1.6;}
.gdpr-dl{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:var(--acc,#3b82f6);color:#fff;border-radius:7px;text-decoration:none;font-size:14px;font-weight:500;}
.gdpr-dl:hover{background:var(--acc2,#2563eb);}
.gdpr-info{font-size:12px;color:var(--muted,#94a3b8);margin-top:10px;}
</style>
</head>
<body>
<header>
  <h1>&#128274; GDPR Data Export</h1>
  ${menuHtml}
</header>
<div id="gdpr-view">
  <div class="gdpr-card">
    <h2>Your personal data</h2>
    <p>Logged in as <strong>${escHtmlJs(username)}</strong> (ID: <code>${escHtmlJs(userId)}</code>).</p>
    <p>The export contains all personal data stored for your account in three sheets:</p>
    <ul style="font-size:14px;color:var(--muted,#64748b);line-height:1.8;padding-left:20px;">
      <li><strong>Context</strong> – conversation history entries associated with your user ID</li>
      <li><strong>GDPR Consent</strong> – your consent records per channel</li>
      <li><strong>Files</strong> – files stored in your personal documents folder</li>
    </ul>
    <a class="gdpr-dl" href="${basePath}/export.xlsx">&#11015; Download Excel export</a>
    <p class="gdpr-info">The file is generated on demand and contains a snapshot of your current data.</p>
  </div>
</div>
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

function escHtmlJs(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
