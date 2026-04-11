
























/**************************************************************/
/* filename: "00054-webpage-timeline.js"                     */
/* Version 1.0                                               */
/* Purpose: Admin webpage for timeline browsing and editing. */
/**************************************************************/

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getMenuHtml, getDb, getThemeHeadScript } from "../shared/webpage/interface.js";
import { setSendNow, setJsonResp, getIsAllowedRoles } from "../shared/webpage/utils.js";

const MODULE_NAME = "webpage-timeline";
const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const CTX_TABLE    = "timeline_periods";
const PAGE_SIZE    = 50;
const SHARED_CSS   = path.join(__dirname, "..", "shared", "webpage", "style.css");




function getStr(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function getInt(v, def = 0) { const n = parseInt(v, 10); return isNaN(n) ? def : n; }

function getBasePath(cfg) {
  const bp = getStr(cfg?.basePath ?? "/timeline").trim();
  return bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/timeline";
}

function setHtmlResp(wo, html) {
  wo.http.response = {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache"
    },
    body: html
  };
}

function setCssResp(wo, css) {
  wo.http.response = { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" }, body: css };
}

function escLike(s) {
  return getStr(s).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}




async function dbChannels(pool) {
  const [rows] = await pool.execute(
    `SELECT channel_id AS id, COUNT(*) AS cnt FROM ${CTX_TABLE} GROUP BY channel_id ORDER BY channel_id ASC`
  );
  return rows.map(r => ({ id: getStr(r.id), cnt: Number(r.cnt) }));
}

async function dbColumns(pool) {
  try {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [CTX_TABLE]
    );
    if (rows.length) return rows.map(r => ({ name: getStr(r.COLUMN_NAME), type: getStr(r.DATA_TYPE) }));
  } catch (_) {  }
  return [
    { name: "id", type: "bigint" },
    { name: "channel_id", type: "varchar" },
    { name: "start_idx", type: "int" },
    { name: "end_idx", type: "int" },
    { name: "start_ts", type: "datetime" },
    { name: "end_ts", type: "datetime" },
    { name: "summary", type: "text" },
    { name: "model", type: "varchar" },
    { name: "checksum", type: "char" },
    { name: "frozen", type: "tinyint" },
    { name: "created_at", type: "datetime" },
    { name: "updated_at", type: "datetime" }
  ];
}

function safeFields(rawFields, fallback) {
  const safe = rawFields.filter(f => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f));
  return safe.length ? safe : fallback;
}

async function dbRecords(pool, { channel, page, limit, fields }) {
  const cols = ["id", "frozen", ...fields.filter(f => f !== "id" && f !== "frozen")];
  const colSql = safeFields(cols, ["id", "channel_id", "start_idx", "end_idx", "summary"]).join(", ");
  const offset = (page - 1) * limit;
  const where  = channel ? "WHERE channel_id = ?" : "";
  const wParams = channel ? [channel] : [];

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM ${CTX_TABLE} ${where}`, wParams
  );
  const [rows] = await pool.execute(
    `SELECT ${colSql} FROM ${CTX_TABLE} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...wParams, limit, offset]
  );
  return { rows, total: Number(total), page, pages: Math.ceil(Number(total) / limit) };
}

async function dbSearch(pool, { channel, q, page, limit, fields, searchFields }) {
  const cols = ["id", "frozen", ...fields.filter(f => f !== "id" && f !== "frozen")];
  const colSql  = safeFields(cols, ["id", "channel_id", "start_idx", "end_idx", "summary"]).join(", ");
  const sfSafe  = searchFields.filter(f => ["summary", "model", "checksum", "channel_id"].includes(f));
  if (!sfSafe.length) sfSafe.push("summary");
  const like    = `%${escLike(q)}%`;
  const offset  = (page - 1) * limit;
  const chanCond = channel ? "channel_id = ? AND " : "";
  const srCond   = sfSafe.map(f => `${f} LIKE ?`).join(" OR ");
  const where    = `WHERE ${chanCond}(${srCond})`;
  const wParams  = [...(channel ? [channel] : []), ...sfSafe.map(() => like)];

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM ${CTX_TABLE} ${where}`, wParams
  );
  const [rows] = await pool.execute(
    `SELECT ${colSql} FROM ${CTX_TABLE} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...wParams, limit, offset]
  );
  return { rows, total: Number(total), page, pages: Math.ceil(Number(total) / limit) };
}

async function dbDelete(pool, ids, { protectFrozen = true } = {}) {
  if (!ids.length) return 0;
  const ph = ids.map(() => "?").join(",");
  const [r] = await pool.execute(
    `DELETE FROM ${CTX_TABLE} WHERE id IN (${ph}) ${protectFrozen ? "AND COALESCE(frozen, 0) = 0" : ""}`,
    ids
  );
  return r.affectedRows;
}

async function dbDeleteChannel(pool, channelID, { protectFrozen = true } = {}) {
  const chan = getStr(channelID).trim();
  if (!chan) return 0;
  const [r] = await pool.execute(
    `DELETE FROM ${CTX_TABLE} WHERE channel_id = ? ${protectFrozen ? "AND COALESCE(frozen, 0) = 0" : ""}`,
    [chan]
  );
  return r.affectedRows;
}

async function dbDeleteChannels(pool, channelIDs, { protectFrozen = true } = {}) {
  const ids = Array.isArray(channelIDs)
    ? channelIDs.map(v => getStr(v).trim()).filter(Boolean)
    : [];
  if (!ids.length) return 0;
  const ph = ids.map(() => "?").join(",");
  const [r] = await pool.execute(
    `DELETE FROM ${CTX_TABLE} WHERE channel_id IN (${ph}) ${protectFrozen ? "AND COALESCE(frozen, 0) = 0" : ""}`,
    ids
  );
  return r.affectedRows;
}

async function dbGetRecord(pool, ctx_id) {
  const [rows] = await pool.execute(`SELECT * FROM ${CTX_TABLE} WHERE id = ?`, [ctx_id]);
  return rows[0] || null;
}

async function dbUpdateRecord(pool, { ctx_id, field, value }) {
  const allowed = ["channel_id", "start_idx", "end_idx", "start_ts", "end_ts", "summary", "model", "checksum"];
  if (!allowed.includes(field)) throw new Error("Field not editable: " + field);
  const [r] = await pool.execute(
    `UPDATE ${CTX_TABLE} SET \`${field}\` = ? WHERE id = ?`,
    [value, ctx_id]
  );
  return r.affectedRows;
}

async function dbFindReplace(pool, { search, channel, searchFields }) {
  const sf   = searchFields.filter(f => ["summary"].includes(f));
  if (!sf.length) sf.push("summary");
  const like = `%${escLike(search)}%`;
  const chanCond = channel ? "channel_id = ? AND " : "";
  const srCond   = sf.map(f => `${f} LIKE ?`).join(" OR ");
  const where    = `WHERE ${chanCond}(${srCond})`;
  const wParams  = [...(channel ? [channel] : []), ...sf.map(() => like)];

  const [rows] = await pool.execute(
    `SELECT id, channel_id, summary FROM ${CTX_TABLE} ${where} ORDER BY id DESC LIMIT 200`,
    wParams
  );
  const matches = [];
  for (const row of rows) {
    for (const field of sf) {
      const val = getStr(row[field]);
      if (val.includes(search)) {
        matches.push({ ctx_id: row.id, channel: getStr(row.channel_id), field, value: val });
      }
    }
  }
  return matches;
}

async function dbApplyReplace(pool, { ctx_id, field, search, replace, mode }) {
  if (!["summary"].includes(field)) throw new Error("Invalid field");
  let sql, params;
  if (mode === "full") {
    sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = ? WHERE id = ?`;
    params = [replace, ctx_id];
  } else {
    sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = REPLACE(\`${field}\`, ?, ?) WHERE id = ?`;
    params = [search, replace, ctx_id];
  }
  const [r] = await pool.execute(sql, params);
  return r.affectedRows;
}

async function dbReplaceAll(pool, { search, replace, channel, searchFields, mode }) {
  const sf = searchFields.filter(f => ["summary"].includes(f));
  if (!sf.length) sf.push("summary");
  const like = `%${escLike(search)}%`;
  let total = 0;
  for (const field of sf) {
    let sql, params;
    if (mode === "full") {
      if (channel) {
        sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = ? WHERE channel_id = ? AND \`${field}\` LIKE ?`;
        params = [replace, channel, like];
      } else {
        sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = ? WHERE \`${field}\` LIKE ?`;
        params = [replace, like];
      }
    } else {
      if (channel) {
        sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = REPLACE(\`${field}\`, ?, ?) WHERE channel_id = ? AND \`${field}\` LIKE ?`;
        params = [search, replace, channel, like];
      } else {
        sql    = `UPDATE ${CTX_TABLE} SET \`${field}\` = REPLACE(\`${field}\`, ?, ?) WHERE \`${field}\` LIKE ?`;
        params = [search, replace, like];
      }
    }
    const [r] = await pool.execute(sql, params);
    total += r.affectedRows;
  }
  return total;
}




function getTimelineCss() {
  return `
body{font-size:13px}
.page-wrap{display:flex;flex-direction:column;height:calc(100vh - var(--hh));margin-top:var(--hh)}
.ctx-layout{display:flex;flex:1;overflow:hidden}
.ctx-sidebar{width:220px;min-width:160px;background:var(--card);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;transition:width .2s}
.ctx-sidebar.collapsed{width:32px;min-width:32px}
.sidebar-title{padding:9px 12px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--bdr);font-size:11px;text-transform:uppercase;letter-spacing:.08em;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.ctx-sidebar.collapsed .sidebar-title{justify-content:center;padding:9px 4px}
.ctx-sidebar.collapsed .sidebar-title-text{display:none}
.ctx-sidebar.collapsed #channel-list{display:none}
.ctx-sidebar.collapsed .sidebar-channel-tools{display:none}
#sidebar-toggle{background:none;border:none;cursor:pointer;padding:0 2px;color:var(--muted);font-size:13px;line-height:1;flex-shrink:0}
#sidebar-toggle:hover{color:var(--txt)}
#btn-delete-channels{font-size:14px;line-height:1;padding:2px 4px}
#btn-delete-channels:disabled{opacity:.35;cursor:not-allowed}
.sidebar-channel-tools{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 10px;border-bottom:1px solid var(--bdr);font-size:11px;color:var(--muted)}
.sidebar-channel-tools label{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
#channel-list{overflow-y:auto;flex:1}
.channel-item{padding:7px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:6px;border-bottom:1px solid var(--bdr);user-select:none}
.channel-item:hover{background:var(--bg)}
.channel-item.active{background:#dbeafe;color:var(--acc)}
.channel-item-left{display:flex;align-items:center;gap:7px;min-width:0;flex:1}
.ch-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:12px}
.ch-cnt{color:var(--muted);font-size:11px;flex-shrink:0}
.ctx-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:var(--card);border-bottom:1px solid var(--bdr);align-items:center}
#search-input{flex:1;min-width:180px;padding:5px 8px;background:var(--bg);border:1px solid var(--bdr);color:var(--txt);border-radius:4px;font-size:13px;outline:none}
#search-input:focus{border-color:var(--acc)}
button{padding:5px 10px;border:1px solid transparent;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;transition:background .15s}
.btn-primary{background:var(--acc);color:#fff}
.btn-primary:hover{background:var(--acc2)}
.btn-secondary{background:var(--bg);color:var(--txt);border:1px solid var(--bdr)}
.btn-secondary:hover{background:var(--bdr)}
.btn-danger{background:var(--dan);color:#fff}
.btn-danger:hover{background:var(--dan2)}
button:disabled{opacity:.4;cursor:not-allowed}
.field-toggle{position:relative}
.field-panel{position:absolute;top:calc(100% + 4px);right:0;z-index:100;background:var(--card);border:1px solid var(--bdr);border-radius:6px;padding:10px 12px;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,.15)}
.field-panel.hidden{display:none}
.field-panel label{display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer;white-space:nowrap;font-size:12px}
.field-panel label:hover{color:var(--acc)}
#status-bar{padding:3px 10px;font-size:11px;color:var(--muted);background:var(--bg);border-bottom:1px solid var(--bdr);min-height:20px}
.table-wrap{flex:1;overflow:auto}
#records-table{width:100%;border-collapse:collapse;table-layout:auto}
#records-table th{background:var(--bg);padding:6px 8px;text-align:left;border-bottom:2px solid var(--bdr);white-space:nowrap;position:sticky;top:0;z-index:1;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.05em}
#records-table td{padding:4px 8px;border-bottom:1px solid var(--bdr);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;font-size:12px}
#records-table tbody tr:hover td{background:var(--bg)}
#records-table tbody tr.row-selected td{background:#dbeafe}
.row-frozen td{background:rgba(251,191,36,.08)}
.row-frozen .row-check{cursor:not-allowed}
.frozen-chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#a16207;background:#fef3c7;border:1px solid #fcd34d;border-radius:999px;padding:1px 6px;margin-left:6px}
.null-cell{color:var(--muted);font-style:italic}
.cell-expandable{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.btn-edit-row{background:transparent;color:var(--muted);border:none;padding:2px 5px;cursor:pointer;font-size:13px;line-height:1;border-radius:3px}
.btn-edit-row:hover{color:var(--acc);background:var(--bg)}
#pagination{padding:6px 10px;display:flex;gap:6px;align-items:center;background:var(--card);border-top:1px solid var(--bdr);flex-shrink:0}
#page-info{flex:1;color:var(--muted);font-size:11px}
#page-num{font-size:12px;color:var(--muted)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center}
.modal-overlay.hidden{display:none}
.modal-box{background:var(--card);border:1px solid var(--bdr);border-radius:8px;width:740px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.modal-box.modal-narrow{width:580px}
.modal-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bdr);font-weight:600;font-size:14px}
.btn-icon{background:transparent;color:var(--muted);font-size:16px;padding:2px 6px;border:none}
.btn-icon:hover{color:var(--txt);background:transparent}
.modal-body{padding:16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px}
.form-row{display:flex;flex-direction:column;gap:4px}
.form-row>span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.form-row input[type="text"]{padding:6px 9px;background:var(--bg);border:1px solid var(--bdr);color:var(--txt);border-radius:4px;font-size:13px;outline:none;width:100%}
.form-row input[type="text"]:focus{border-color:var(--acc)}
.form-row input[readonly]{opacity:.5;cursor:default}
.form-row textarea{padding:6px 9px;background:var(--bg);border:1px solid var(--bdr);color:var(--txt);border-radius:4px;font-size:12px;outline:none;width:100%;resize:vertical;font-family:monospace;line-height:1.5}
.form-row textarea:focus{border-color:var(--acc)}
.checkbox-row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)}
.checkbox-row label{display:flex;align-items:center;gap:5px;cursor:pointer}
.modal-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sr-count{font-size:12px;color:var(--muted);margin-left:auto}
.sr-warn{font-size:11px;color:#92400e;padding:4px 0}
#sr-results-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:300px;padding-right:4px}
.sr-item{background:var(--bg);border:1px solid var(--bdr);border-radius:4px;padding:8px 10px;display:flex;gap:10px;align-items:flex-start}
.sr-item.replaced{opacity:.5;border-color:#d1fae5}
.sr-item.skipped{opacity:.4}
.sr-item-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.sr-item-meta{font-size:10px;color:var(--muted)}
.sr-item-before{font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;color:var(--muted);line-height:1.5}
.sr-item-after{font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;color:#16a34a;line-height:1.5}
.sr-item-actions{display:flex;flex-direction:column;gap:4px;flex-shrink:0}
.sr-item-actions button{font-size:11px;padding:3px 8px}
.sr-status{font-size:11px;color:#16a34a;font-weight:600;padding:2px 0}
.sr-msg{color:var(--muted);font-size:12px;padding:8px 0}
mark{background:#fef3c7;color:#92400e;border-radius:2px;padding:0 1px}
.expand-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center}
.expand-overlay.hidden{display:none}
.expand-box{background:var(--card);border:1px solid var(--bdr);border-radius:6px;max-width:80vw;max-height:75vh;overflow:auto;padding:16px;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:12px;line-height:1.6;position:relative;min-width:400px}
.expand-close{position:sticky;top:0;float:right;margin-left:8px}
.cell-editable{cursor:text}
.cell-editable:hover{outline:1px solid var(--bdr);outline-offset:-1px}
.cell-editing{padding:2px 3px!important;overflow:visible!important;max-width:none!important;white-space:normal!important;position:relative;z-index:10}
.cell-saving{opacity:.5;pointer-events:none}
.cell-inline-input{width:100%;min-width:120px;padding:3px 5px;background:var(--bg);border:1px solid var(--acc);color:var(--txt);border-radius:3px;font-size:12px;outline:none;box-sizing:border-box}
.cell-inline-textarea{width:100%;min-width:320px;min-height:90px;padding:4px 6px;background:var(--bg);border:1px solid var(--acc);color:var(--txt);border-radius:3px;font-size:12px;font-family:monospace;line-height:1.45;outline:none;resize:vertical;box-sizing:border-box;display:block}
.cell-edit-hint{display:block;font-size:10px;color:var(--muted);margin-top:2px}
.btn-expand-cell{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:10px;padding:0 3px;line-height:1;vertical-align:middle;opacity:.7}
.btn-expand-cell:hover{color:var(--acc);opacity:1}
`.trim();
}




function getTimelineHtml({ menu, role, activePath, base, dbStatus, dbInfo, webAuth }) {
  const menuHtml = getMenuHtml(menu, activePath, role, null, null, webAuth);
  const dbBanner = dbStatus === "error"
    ? `<div id="db-banner" style="background:#fef2f2;color:#dc2626;padding:10px 16px;font-size:13px;font-weight:600;border-bottom:2px solid #ef4444;flex-shrink:0">
        Database error - timeline table not reachable: <span style="font-weight:400;font-family:monospace">${dbInfo.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</span>
       </div>`
    : `<div id="db-banner" style="display:none" data-count="${dbInfo}"></div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Timeline Editor</title>
${getThemeHeadScript()}
<link rel="stylesheet" href="${base}/style.css">
</head>
<body>
<header><h1>Timeline</h1>${menuHtml}</header>
<div class="page-wrap">
${dbBanner}
  <div class="ctx-layout">
    <div class="ctx-sidebar" id="ctx-sidebar">
      <div class="sidebar-title">
        <span class="sidebar-title-text">Channels</span>
        <button id="sidebar-toggle" title="Toggle channel list">&#9664;</button>
      </div>
      <div class="sidebar-channel-tools">
        <label><input type="checkbox" id="chk-channel-select-all"> Select all</label>
        <button class="btn-icon" id="btn-delete-channels" title="Delete selected channels">Delete</button>
      </div>
      <div id="channel-list"></div>
    </div>
    <div class="ctx-main">
      <div class="toolbar">
        <input id="search-input" type="text" placeholder="Search timeline...">
        <button class="btn-primary" id="btn-search">Search</button>
        <button class="btn-secondary" id="btn-clear-search">Reset</button>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--txt);cursor:pointer;user-select:none">
          <input type="checkbox" id="chk-search-json" style="cursor:pointer"> JSON
        </label>
        <button class="btn-secondary" id="btn-replace-open">Search &amp; Replace</button>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--txt);cursor:pointer;user-select:none">
          <input type="checkbox" id="chk-protect-frozen" checked style="cursor:pointer"> Frozen protection
        </label>
        <div style="flex:1"></div>
        <div class="field-toggle">
          <button class="btn-secondary" id="btn-fields">Fields</button>
          <div id="field-panel" class="field-panel hidden"></div>
        </div>
        <button class="btn-danger" id="btn-delete-sel" disabled>Delete selected</button>
      </div>
      <div id="status-bar"></div>
      <div class="table-wrap">
        <table id="records-table">
          <thead><tr id="table-head"></tr></thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
      <div id="pagination">
        <span id="page-info"></span>
        <button class="btn-secondary" id="btn-prev" disabled>Back</button>
        <span id="page-num"></span>
        <button class="btn-secondary" id="btn-next" disabled>Next</button>
      </div>
    </div>
  </div>
</div>

<!-- Search & Replace modal -->
<div id="modal-replace" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-header">Search &amp; Replace <button class="btn-icon" id="modal-close">X</button></div>
    <div class="modal-body">
      <div class="form-row"><span>Search</span><input type="text" id="sr-search" placeholder="Search timeline..."></div>
      <div class="form-row"><span>Replace with</span><input type="text" id="sr-replace" placeholder="Replacement..."></div>
      <div class="checkbox-row">
        <span>Fields:</span>
        <label><input type="checkbox" name="sr-field" value="summary" checked> summary</label>
      </div>
      <div class="checkbox-row">
        <span>Mode:</span>
        <label><input type="radio" name="sr-mode" value="partial" checked> Replace matched text only</label>
        <label><input type="radio" name="sr-mode" value="full"> Replace entire field value</label>
      </div>
      <p class="sr-warn">Replacing JSON fields modifies raw JSON strings. Use with caution.</p>
      <div class="modal-actions">
        <button class="btn-primary" id="btn-find-matches">Find matches</button>
        <button class="btn-danger" id="btn-replace-all">Replace all (no confirmation)</button>
        <span class="sr-count" id="sr-count"></span>
      </div>
      <div id="sr-results-list"></div>
    </div>
  </div>
</div>

<!-- Edit modal -->
<div id="modal-edit" class="modal-overlay hidden">
  <div class="modal-box modal-narrow">
    <div class="modal-header">Edit timeline entry <button class="btn-icon" id="edit-close">X</button></div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-row"><span>id</span><input type="text" id="edit-ctx-id" readonly></div>
        <div class="form-row"><span>Frozen</span><input type="text" id="edit-ts" readonly></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-row"><span>Channel</span><input type="text" id="edit-channel"></div>
        <div class="form-row"><span>Model</span><input type="text" id="edit-role"></div>
      </div>
      <div class="form-row"><span>Range</span><input type="text" id="edit-turn-id"></div>
      <div class="form-row"><span>Summary</span><textarea id="edit-text" style="height:180px"></textarea></div>
      <div class="modal-actions">
        <button class="btn-primary" id="edit-save">Save</button>
        <button class="btn-secondary" id="edit-cancel">Cancel</button>
        <span id="edit-status" style="font-size:11px;color:#888;margin-left:auto"></span>
      </div>
    </div>
  </div>
</div>

<!-- Expand overlay -->
<div id="expand-overlay" class="expand-overlay hidden">
  <div class="expand-box">
    <button class="btn-icon expand-close" id="expand-close">X</button>
    <div id="expand-content"></div>
  </div>
</div>

<script>
(function () {
'use strict';
var BASE = '${base}';
var currentChannel = null;
var currentPage = 1;
var pageSize = ${PAGE_SIZE};
var allCols = [];
var visibleCols = ['id', 'channel_id', 'start_idx', 'end_idx', 'summary'];
var isSearchMode = false;
var lastQ = '';
var selectedIds = new Set();
var srMatches = [];
var srDone = new Set();
var srSkippedSet = new Set();
var editCtxId = null;
var editOrig = {};
var protectFrozen = true;
var selectedChannelIds = (function () {
  if (typeof window === 'undefined') return new Set();
  if (!(window.__ctxSelectedChannelIds instanceof Set)) window.__ctxSelectedChannelIds = new Set();
  return window.__ctxSelectedChannelIds;
})();

async function api(path, method, body) {
  var opts = { method: method || 'GET', headers: {} };
  if (body != null) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  var r = await fetch(BASE + path, opts);
  if (!r.ok) { var t = await r.text(); throw new Error(t || r.status); }
  return r.json();
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function highlight(text, q) {
  if (!q) return escHtml(text);
  var esc = escHtml(q);
  return escHtml(text).split(esc).join('<mark>' + esc + '</mark>');
}
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '...' : s; }
function setStatus(msg, isError) {
  var el = document.getElementById('status-bar');
  el.textContent = msg || '';
  el.style.color = isError ? '#f87171' : '';
}
function updateDeleteBtn() { document.getElementById('btn-delete-sel').disabled = selectedIds.size === 0; }
function getProtectFrozen() {
  var el = document.getElementById('chk-protect-frozen');
  return !!(el && el.checked);
}
function updateChannelDeleteBtn() {
  var btn = document.getElementById('btn-delete-channels');
  if (btn) btn.disabled = selectedChannelIds.size === 0;
}
function syncChannelSelectAll() {
  var allChecks = Array.from(document.querySelectorAll('.channel-select-check'));
  var selectable = allChecks.length;
  var selected = allChecks.filter(function (c) { return c.checked; }).length;
  var master = document.getElementById('chk-channel-select-all');
  if (!master) return;
  master.checked = selectable > 0 && selected === selectable;
  master.indeterminate = selected > 0 && selected < selectable;
}

async function loadChannels() {
  try {
    var data = await api('/api/channels');
    console.log('[Timeline] /api/channels ->', data);
    renderChannels(data.channels || []);
  } catch (e) {
    console.error('[Timeline] /api/channels error:', e);
    document.getElementById('channel-list').innerHTML =
      '<div style="padding:10px 12px;color:#f87171;font-size:13px;font-weight:600;background:#2a0a0a;border-bottom:1px solid #5a1a1a">' +
      'Error:<br><span style="font-weight:400;font-size:11px;font-family:monospace">' + escHtml(e.message) + '</span></div>';
  }
}
function renderChannels(channels) {
  var list = document.getElementById('channel-list');
  list.innerHTML = '';
  var validIds = new Set(channels.map(function (c) { return String(c.id); }));
  selectedChannelIds.forEach(function (id) { if (!validIds.has(String(id))) selectedChannelIds.delete(String(id)); });
  var total = channels.reduce(function (s, c) { return s + c.cnt; }, 0);
  addChannelItem(list, null, 'All Channels', total);
  channels.forEach(function (ch) { addChannelItem(list, ch.id, ch.id, ch.cnt, true); });
  if (!channels.length) {
    var hint = document.createElement('div');
    hint.style.cssText = 'padding:8px 12px;color:#555;font-size:11px;font-style:italic';
    hint.textContent = total === 0 ? 'No data in DB' : '';
    list.appendChild(hint);
  }
  syncChannelSelectAll();
  updateChannelDeleteBtn();
}
function addChannelItem(container, id, label, cnt, selectable) {
  var div = document.createElement('div');
  div.className = 'channel-item' + (currentChannel === id ? ' active' : '');
  var left = document.createElement('div');
  left.className = 'channel-item-left';
  if (selectable) {
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'channel-select-check';
    chk.dataset.channelId = String(id);
    chk.checked = selectedChannelIds.has(String(id));
    chk.addEventListener('click', function (e) { e.stopPropagation(); });
    chk.addEventListener('change', function () {
      var cid = String(this.dataset.channelId || '');
      if (!cid) return;
      if (this.checked) selectedChannelIds.add(cid); else selectedChannelIds.delete(cid);
      syncChannelSelectAll();
      updateChannelDeleteBtn();
    });
    left.appendChild(chk);
  }
  var idSpan = document.createElement('span');
  idSpan.className = 'ch-id';
  idSpan.textContent = label;
  left.appendChild(idSpan);
  div.appendChild(left);
  var cntSpan = document.createElement('span');
  cntSpan.className = 'ch-cnt';
  cntSpan.textContent = String(cnt);
  div.appendChild(cntSpan);
  div.addEventListener('click', function () {
    currentChannel = id; currentPage = 1; isSearchMode = false;
    document.getElementById('search-input').value = ''; lastQ = '';
    loadAll();
  });
  container.appendChild(div);
}

async function loadColumns() {
  var data = await api('/api/columns');
  allCols = data.columns;
  renderFieldPanel();
}
function renderFieldPanel() {
  var panel = document.getElementById('field-panel');
  panel.innerHTML = '';
  allCols.forEach(function (col) {
    var lbl = document.createElement('label');
    var chk = document.createElement('input');
    chk.type = 'checkbox'; chk.value = col.name; chk.checked = visibleCols.includes(col.name);
    chk.addEventListener('change', function () {
      if (this.checked) { if (!visibleCols.includes(col.name)) visibleCols.push(col.name); }
      else { visibleCols = visibleCols.filter(function (c) { return c !== col.name; }); }
      currentPage = 1; loadPage();
    });
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(' ' + col.name + ' '));
    var typeSpan = document.createElement('span');
    typeSpan.style.cssText = 'color:#555;font-size:10px';
    typeSpan.textContent = col.type;
    lbl.appendChild(typeSpan);
    panel.appendChild(lbl);
  });
}

async function loadPage() {
  selectedIds.clear(); updateDeleteBtn();
  var p = new URLSearchParams({ page: currentPage, limit: pageSize, fields: visibleCols.join(',') });
  if (currentChannel) p.set('channel', currentChannel);
  var endpoint = '/api/records';
  if (isSearchMode && lastQ) {
    endpoint = '/api/search'; p.set('q', lastQ);
    var searchJson = document.getElementById('chk-search-json');
    var sf = 'summary';
    p.set('searchFields', sf);
  }
  setStatus('Loading...');
  try {
    var data = await api(endpoint + '?' + p);
    console.log('[Timeline] ' + endpoint + ' ->', data);
    renderTable(data.rows || []);
    renderPagination(data.total, data.page, data.pages);
    if ((data.total || 0) === 0) {
      setStatus(isSearchMode ? 'No results for "' + lastQ + '".' : 'Table is empty (0 entries in DB).');
    } else {
      setStatus((isSearchMode ? 'Search: ' : 'Entries: ') + data.total + ' total - Page ' + data.page + ' of ' + Math.max(1, data.pages));
    }
  } catch (e) {
    console.error('[Timeline] loadPage error:', e);
    setStatus('Error loading: ' + e.message, true);
  }
}

function renderTable(rows) {
  var thead = document.getElementById('table-head');
  var tbody = document.getElementById('table-body');
  thead.innerHTML = ''; tbody.innerHTML = '';

  var thChk = document.createElement('th');
  thChk.style.cssText = 'width:28px;padding:6px 4px';
  var chkAll = document.createElement('input'); chkAll.type = 'checkbox'; chkAll.id = 'chk-all';
  chkAll.addEventListener('change', function () {
    document.querySelectorAll('.row-check').forEach(function (c) {
      if (c.disabled) { c.checked = false; return; }
      c.checked = chkAll.checked;
      var id = Number(c.dataset.id);
      if (chkAll.checked) selectedIds.add(id); else selectedIds.delete(id);
    });
    updateDeleteBtn();
  });
  thChk.appendChild(chkAll); thead.appendChild(thChk);

  var thEdit = document.createElement('th');
  thEdit.style.cssText = 'width:28px;padding:6px 4px';
  thead.appendChild(thEdit);

  visibleCols.forEach(function (col) {
    var th = document.createElement('th'); th.textContent = col; thead.appendChild(th);
  });

  if (!rows.length) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = visibleCols.length + 2;
    td.style.cssText = 'padding:24px;text-align:center;color:#555;font-size:13px;font-style:italic';
    td.textContent = isSearchMode ? 'No results.' : 'No entries in database.';
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }

  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    var isFrozen = Number(row.frozen || 0) === 1;
    if (isFrozen) tr.classList.add('row-frozen');

    var tdChk = document.createElement('td');
    tdChk.style.cssText = 'padding:4px;';
    var chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'row-check';
    var rowId = row.id != null ? row.id : '';
    chk.dataset.id = rowId;
    if (isFrozen && protectFrozen) {
      chk.disabled = true;
      chk.title = 'Frozen entry (protected)';
    }
    if (selectedIds.has(Number(rowId))) { chk.checked = true; tr.classList.add('row-selected'); }
    chk.addEventListener('change', function () {
      if (this.disabled) return;
      var id = Number(this.dataset.id);
      if (this.checked) selectedIds.add(id); else selectedIds.delete(id);
      tr.classList.toggle('row-selected', this.checked);
      updateDeleteBtn();
    });
    tdChk.appendChild(chk); tr.appendChild(tdChk);

    var tdEdit = document.createElement('td');
    tdEdit.style.cssText = 'padding:2px 4px;';
    var btnEdit = document.createElement('button');
    btnEdit.className = 'btn-edit-row'; btnEdit.title = 'Edit'; btnEdit.textContent = 'Edit';
    (function (cid) {
      btnEdit.addEventListener('click', function () { openEditModal(cid); });
    })(row.id);
    tdEdit.appendChild(btnEdit); tr.appendChild(tdEdit);

    visibleCols.forEach(function (col) {
      var td = document.createElement('td'); td.dataset.col = col;
      var val = row[col];
      var rowCtxId = row.id;
      if (val == null) {
        td.dataset.value = '';
        if (EDITABLE_COLS.has(col)) {
          td.className = 'null-cell cell-editable';
          td.textContent = 'NULL';
          makeCellEditable(td, rowCtxId, col);
        } else {
          td.className = 'null-cell'; td.textContent = 'NULL';
        }
      } else {
        var s = String(val);
        td.dataset.value = s;
        renderCellContent(td, col, s);
        if (EDITABLE_COLS.has(col)) makeCellEditable(td, rowCtxId, col);
        if (col === 'id' && isFrozen) {
          var chip = document.createElement('span');
          chip.className = 'frozen-chip';
          chip.textContent = 'frozen';
          td.appendChild(chip);
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderPagination(total, page, pages) {
  document.getElementById('page-info').textContent = total + ' entries';
  document.getElementById('page-num').textContent = 'Page ' + page + ' / ' + Math.max(1, pages);
  document.getElementById('btn-prev').disabled = page <= 1;
  document.getElementById('btn-next').disabled = page >= pages;
}

async function doDelete() {
  if (!selectedIds.size) return;
  var ids = Array.from(selectedIds);
  var prot = getProtectFrozen();
  var suffix = prot ? ' (frozen remains protected)' : '';
  if (!confirm('Delete ' + ids.length + ' entries' + suffix + '? This cannot be undone.')) return;
  try {
    var data = await api('/api/delete', 'DELETE', { ids: ids, protectFrozen: prot });
    setStatus('Deleted: ' + data.deleted + ' entries.');
    selectedIds.clear(); updateDeleteBtn(); loadAll();
  } catch (e) { alert('Error deleting: ' + e.message); }
}

async function doDeleteChannels() {
  var channelIds = Array.from(selectedChannelIds);
  if (!channelIds.length) { alert('Please select at least one channel.'); return; }
  var prot = getProtectFrozen();
  var msg = prot
    ? ('Delete non-frozen entries in ' + channelIds.length + ' selected channel(s)? Frozen entries remain.')
    : ('Delete ALL entries in ' + channelIds.length + ' selected channel(s) including frozen?');
  if (!confirm(msg + ' This cannot be undone.')) return;
  try {
    var data = await api('/api/delete-channels', 'DELETE', { channelIDs: channelIds, protectFrozen: prot });
    var left = prot ? ' Frozen entries (if any) are kept.' : '';
    setStatus('Channel delete: ' + data.deleted + ' entries removed in ' + channelIds.length + ' channel(s).' + left);
    selectedChannelIds.clear();
    selectedIds.clear(); updateDeleteBtn(); loadAll();
  } catch (e) { alert('Error deleting channels: ' + e.message); }
}

function doSearch() {
  var q = document.getElementById('search-input').value.trim();
  if (!q) return;
  lastQ = q; isSearchMode = true; currentPage = 1; loadPage();
}
function clearSearch() {
  document.getElementById('search-input').value = '';
  lastQ = ''; isSearchMode = false; currentPage = 1; loadPage();
}

async function openEditModal(ctx_id) {
  document.getElementById('edit-status').textContent = 'Loading...';
  document.getElementById('modal-edit').classList.remove('hidden');
  try {
    var data = await api('/api/record?ctx_id=' + encodeURIComponent(ctx_id));
    var row = data.record;
    editCtxId = ctx_id;
    editOrig = {
      channel_id: String(row.channel_id || ''),
      model: String(row.model || ''),
      summary: String(row.summary || '')
    };
    document.getElementById('edit-ctx-id').value = String(row.id || '');
    document.getElementById('edit-ts').value = String(row.frozen || 0);
    document.getElementById('edit-channel').value = editOrig.channel_id;
    document.getElementById('edit-role').value = editOrig.model;
    document.getElementById('edit-turn-id').value = String(row.start_idx || '') + ' - ' + String(row.end_idx || '');
    document.getElementById('edit-text').value = editOrig.summary;
    document.getElementById('edit-status').textContent = '';
  } catch (e) {
    document.getElementById('edit-status').textContent = 'Error: ' + e.message;
  }
}

async function saveEdit() {
  if (!editCtxId) return;
  var fields = [
    { elId: 'edit-channel', field: 'channel_id' },
    { elId: 'edit-role', field: 'model' },
    { elId: 'edit-text', field: 'summary' }
  ];
  var changes = fields.filter(function (f) {
    return document.getElementById(f.elId).value !== editOrig[f.field];
  });
  if (!changes.length) {
    document.getElementById('edit-status').textContent = 'No changes.';
    return;
  }
  document.getElementById('edit-status').textContent = 'Saving...';
  var errors = [];
  for (var i = 0; i < changes.length; i++) {
    var f = changes[i];
    try {
      await api('/api/record', 'PATCH', { ctx_id: editCtxId, field: f.field, value: document.getElementById(f.elId).value });
    } catch (e) { errors.push(f.field + ': ' + e.message); }
  }
  if (errors.length) {
    document.getElementById('edit-status').textContent = 'Error: ' + errors.join(', ');
  } else {
    document.getElementById('edit-status').textContent = 'Saved';
    setTimeout(function () {
      document.getElementById('modal-edit').classList.add('hidden');
      loadPage();
    }, 700);
  }
}

function getSrFields() {
  return Array.from(document.querySelectorAll('input[name="sr-field"]:checked')).map(function (c) { return c.value; });
}
function getSrMode() {
  var el = document.querySelector('input[name="sr-mode"]:checked');
  return el ? el.value : 'partial';
}
async function findMatches() {
  var q = document.getElementById('sr-search').value.trim();
  if (!q) { alert('Enter search text.'); return; }
  document.getElementById('sr-count').textContent = 'Searching...';
  document.getElementById('sr-results-list').innerHTML = '';
  srMatches = [];
  srDone.clear();
  srSkippedSet.clear();
  try {
    var data = await api('/api/replace/find', 'POST', { search: q, channel: currentChannel, fields: getSrFields() });
    srMatches = data.matches || [];
    document.getElementById('sr-count').textContent = srMatches.length + ' matches';
    renderSrMatches(q);
  } catch (e) { alert('Error: ' + e.message); }
}

function renderSrMatches(q) {
  var rep = document.getElementById('sr-replace').value;
  var mode = getSrMode();
  var list = document.getElementById('sr-results-list');
  list.innerHTML = '';
  if (!srMatches.length) { list.innerHTML = '<div class="sr-msg">No matches.</div>'; return; }
  srMatches.forEach(function (m, i) {
    var item = document.createElement('div');
    item.className = 'sr-item'; item.id = 'sr-item-' + i;
    var beforeH = highlight(trunc(m.value, 300), q);
    var afterText = rep
      ? (mode === 'full' ? trunc(rep, 300) : trunc(String(m.value || '').split(q).join(rep), 300))
      : '';
    var afterH = rep ? escHtml(afterText) : '<span style="color:#555">(Enter replacement text)</span>';
    var isDone    = srDone.has(i);
    var isSkipped = srSkippedSet.has(i);
    item.innerHTML =
      '<div class="sr-item-info">' +
        '<div class="sr-item-meta">ID: ' + escHtml(String(m.ctx_id)) + ' &nbsp;|&nbsp; ch: ' + escHtml(m.channel) + ' &nbsp;|&nbsp; field: ' + escHtml(m.field) + '</div>' +
        '<div class="sr-item-before">' + beforeH + '</div>' +
        '<div class="sr-item-after">&rarr; ' + afterH + '</div>' +
      '</div>' +
      '<div class="sr-item-actions">' +
        (isDone
          ? '<span class="sr-status">Done</span>'
          : '<button class="btn-primary btn-apply" data-i="' + i + '">Replace</button>' +
            '<button class="btn-secondary btn-skip" data-i="' + i + '">Skip</button>') +
      '</div>';
    if (isDone)    item.classList.add('replaced');
    if (isSkipped) item.classList.add('skipped');
    list.appendChild(item);
  });
  list.querySelectorAll('.btn-apply').forEach(function (btn) {
    btn.addEventListener('click', function () { applySingle(parseInt(this.dataset.i, 10)); });
  });
  list.querySelectorAll('.btn-skip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(this.dataset.i, 10);
      srSkippedSet.add(idx);
      var el = document.getElementById('sr-item-' + idx);
      if (el) el.classList.add('skipped');
    });
  });
}

async function applySingle(i) {
  var m = srMatches[i]; if (!m) return;
  var search = document.getElementById('sr-search').value;
  var replace = document.getElementById('sr-replace').value;
  var mode = getSrMode();
  if (!search) { alert('Search text is empty.'); return; }
  try {
    await api('/api/replace/apply', 'POST', { ctx_id: m.ctx_id, field: m.field, search: search, replace: replace, mode: mode });
    srDone.add(i);
    var el = document.getElementById('sr-item-' + i);
    if (el) {
      el.classList.add('replaced');
      var actions = el.querySelector('.sr-item-actions');
      if (actions) actions.innerHTML = '<span class="sr-status">Done</span>';
    }
  } catch (e) { alert('Error: ' + e.message); }
}

async function replaceAll() {
  var search = document.getElementById('sr-search').value.trim();
  var replace = document.getElementById('sr-replace').value;
  var fields = getSrFields();
  var mode = getSrMode();
  if (!search) { alert('Enter search text.'); return; }
  var scope = currentChannel ? ' in channel "' + currentChannel + '"' : ' in ALL channels';
  var modeLabel = mode === 'full' ? ' (entire field)' : ' (matched text only)';
  if (!confirm('Replace all "' + search + '" with "' + replace + '"' + scope + modeLabel + '? This cannot be undone.')) return;
  try {
    var data = await api('/api/replace/all', 'POST', { search: search, replace: replace, channel: currentChannel, fields: fields, mode: mode });
    alert('Replaced in ' + data.updated + ' row(s).');
    document.getElementById('modal-replace').classList.add('hidden');
    loadAll();
  } catch (e) { alert('Error: ' + e.message); }
}

function expandShow(content, type) {
  var box = document.getElementById('expand-content');
  if (type === 'json') {
    try { box.textContent = JSON.stringify(JSON.parse(content), null, 2); } catch (_) { box.textContent = content; }
  } else { box.textContent = content; }
  document.getElementById('expand-overlay').classList.remove('hidden');
}

var EDITABLE_COLS = new Set(['summary', 'model', 'channel_id']);
var LONG_COLS     = new Set(['summary']);

function renderCellContent(td, col, val) {
  td.classList.remove('cell-editing', 'cell-saving');
  td.innerHTML = '';
  if (LONG_COLS.has(col)) {
    var limit = col === 'summary' ? 200 : 120;
    td.appendChild(document.createTextNode(trunc(val, limit)));
    if (val.length > limit) {
      var btnExp = document.createElement('button');
      btnExp.className = 'btn-expand-cell'; btnExp.title = 'Expand full content'; btnExp.textContent = 'Open';
      (function (v, c) { btnExp.addEventListener('click', function (e) { e.stopPropagation(); expandShow(v, c); }); })(val, col);
      td.appendChild(btnExp);
    }
  } else {
    td.textContent = val;
  }
}

function makeCellEditable(td, ctx_id, col) {
  td.classList.add('cell-editable');
  td.addEventListener('click', function (e) {
    if (e.target.classList.contains('btn-expand-cell')) return;
    startInlineEdit(td, ctx_id, col);
  });
}

function startInlineEdit(td, ctx_id, col) {
  if (td.classList.contains('cell-editing')) return;
  var originalVal = String(td.dataset.value || '');
  td.classList.add('cell-editing');
  var isLong = LONG_COLS.has(col);
  var el;
  if (isLong) {
    el = document.createElement('textarea');
    el.className = 'cell-inline-textarea';
    var hint = document.createElement('span');
    hint.className = 'cell-edit-hint'; hint.textContent = 'Ctrl+Enter to save | Esc to cancel';
  } else {
    el = document.createElement('input');
    el.type = 'text'; el.className = 'cell-inline-input';
  }
  el.value = originalVal;
  td.innerHTML = '';
  td.appendChild(el);
  if (isLong && hint) td.appendChild(hint);
  el.focus();
  if (!isLong) el.select();

  var saved = false;
  async function doSave() {
    if (saved) return; saved = true;
    var newVal = el.value;
    if (newVal === originalVal) { cancel(); return; }
    td.classList.add('cell-saving');
    try {
      await api('/api/record', 'PATCH', { ctx_id: ctx_id, field: col, value: newVal });
      td.dataset.value = newVal;
      renderCellContent(td, col, newVal);
    } catch (e) {
      saved = false;
      td.classList.remove('cell-saving');
      el.focus();
      setStatus('Save error (' + col + '): ' + e.message, true);
    }
  }
  function cancel() {
    saved = true;
    renderCellContent(td, col, originalVal);
  }
  el.addEventListener('blur', function () { doSave(); });
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (!isLong && e.key === 'Enter') { e.preventDefault(); doSave(); }
    else if (isLong && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
  });
}

function toggleSidebar() {
  var sb  = document.getElementById('ctx-sidebar');
  var btn = document.getElementById('sidebar-toggle');
  var collapsed = sb.classList.toggle('collapsed');
  btn.innerHTML = collapsed ? '&#9654;' : '&#9664;';
  try { localStorage.setItem('ctx_sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
}

function setupEvents() {
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('btn-search').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  document.getElementById('btn-clear-search').addEventListener('click', clearSearch);
  document.getElementById('btn-delete-sel').addEventListener('click', doDelete);
  document.getElementById('btn-delete-channels').addEventListener('click', doDeleteChannels);
  document.getElementById('chk-channel-select-all').addEventListener('change', function () {
    var checked = !!this.checked;
    document.querySelectorAll('.channel-select-check').forEach(function (c) {
      c.checked = checked;
      var cid = String(c.dataset.channelId || '');
      if (!cid) return;
      if (checked) selectedChannelIds.add(cid); else selectedChannelIds.delete(cid);
    });
    syncChannelSelectAll();
    updateChannelDeleteBtn();
  });
  document.getElementById('chk-protect-frozen').addEventListener('change', function () {
    protectFrozen = !!this.checked;
    if (!this.checked) {
      var ok = confirm('Disable frozen protection? Frozen entries can then be deleted.');
      if (!ok) {
        this.checked = true;
        protectFrozen = true;
        return;
      }
    }
    selectedIds.clear();
    updateDeleteBtn();
    loadPage();
  });
  document.getElementById('btn-prev').addEventListener('click', function () { if (currentPage > 1) { currentPage--; loadPage(); } });
  document.getElementById('btn-next').addEventListener('click', function () { currentPage++; loadPage(); });
  document.getElementById('btn-replace-open').addEventListener('click', function () {
    document.getElementById('modal-replace').classList.remove('hidden');
  });
  document.getElementById('modal-close').addEventListener('click', function () {
    document.getElementById('modal-replace').classList.add('hidden');
  });
  document.getElementById('modal-replace').addEventListener('click', function (e) {
    if (e.target === this) this.classList.add('hidden');
  });
  document.getElementById('btn-find-matches').addEventListener('click', findMatches);
  document.getElementById('btn-replace-all').addEventListener('click', replaceAll);
  document.getElementById('sr-replace').addEventListener('input', function () {
    var q = document.getElementById('sr-search').value;
    if (srMatches.length && q) renderSrMatches(q);
  });
  document.querySelectorAll('input[name="sr-mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var q = document.getElementById('sr-search').value;
      if (srMatches.length && q) renderSrMatches(q);
    });
  });
  document.getElementById('edit-close').addEventListener('click', function () {
    document.getElementById('modal-edit').classList.add('hidden');
  });
  document.getElementById('edit-cancel').addEventListener('click', function () {
    document.getElementById('modal-edit').classList.add('hidden');
  });
  document.getElementById('edit-save').addEventListener('click', saveEdit);
  document.getElementById('modal-edit').addEventListener('click', function (e) {
    if (e.target === this) this.classList.add('hidden');
  });
  document.getElementById('btn-fields').addEventListener('click', function (e) {
    e.stopPropagation();
    document.getElementById('field-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', function () { document.getElementById('field-panel').classList.add('hidden'); });
  document.getElementById('field-panel').addEventListener('click', function (e) { e.stopPropagation(); });
  document.getElementById('expand-close').addEventListener('click', function () { document.getElementById('expand-overlay').classList.add('hidden'); });
  document.getElementById('expand-overlay').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });
}

async function loadAll() {
  await loadChannels();
  await loadPage();
}
(async function () {
  setupEvents();
  try {
    if (localStorage.getItem('ctx_sidebar_collapsed') === '1') {
      var _sb = document.getElementById('ctx-sidebar');
      var _btn = document.getElementById('sidebar-toggle');
      if (_sb) _sb.classList.add('collapsed');
      if (_btn) _btn.innerHTML = '&#9654;';
    }
  } catch {}
  var banner = document.getElementById('db-banner');
  if (banner && banner.style.display !== 'none') {
    setStatus('DB error - page started without database. Check bot logs.', true);
    return;
  }
  if (banner && banner.dataset.count !== undefined) {
    console.log('[Timeline] Server-side DB ping OK, total rows:', banner.dataset.count);
  }
  try { await loadAll(); } catch (e) {
    console.error('[Timeline] loadAll error:', e);
    setStatus('Load error: ' + e.message, true);
  }
  loadColumns().catch(function (e) { console.error('[Timeline] loadColumns:', e); });
  protectFrozen = getProtectFrozen();
})();
})();
</script>
</body></html>`;
}




export default async function getWebpageTimeline(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3118);
  const basePath     = getBasePath(cfg);
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : ["admin"];

  if (Number(wo.http?.port) !== port) return coreData;

  const method  = getStr(wo.http?.method).toUpperCase();
  const urlPath = getStr(wo.http?.path);
  const query   = wo.http?.query || {};

  if (method === "GET" && urlPath === basePath + "/style.css") {
    let sharedCss = "";
    try { sharedCss = fs.readFileSync(SHARED_CSS, "utf-8"); } catch {  }
    setCssResp(wo, sharedCss + "\n" + getTimelineCss());
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!isAllowed) {
      if (!wo.webAuth?.userId) {
        wo.http.response = { status: 302, headers: { "Location": "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
      } else {
        const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
        setHtmlResp(wo, "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
          "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
          "<title>Timeline</title>" + getThemeHeadScript() +
          "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
          "<header><h1>Timeline</h1>" + menuHtml + "</header>" +
          "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
          "<div style=\"text-align:center;color:var(--txt)\">" +
          "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
          "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
          "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">&larr; Back to home</a>" +
          "</div></div></body></html>");
      }
      wo.web = wo.web || {}; wo.web.useLayout = false;
      wo.jump = true; await setSendNow(wo); return coreData;
    } else {
      let dbStatus = "ok";
      let dbInfo = "";
      try {
        const p = await getDb(coreData);
        const [[r]] = await p.execute(`SELECT COUNT(*) AS n FROM ${CTX_TABLE}`);
        dbInfo = String(r?.n ?? "?");
      } catch (e) {
        dbStatus = "error";
        dbInfo = String(e?.message || e);
      }
      setHtmlResp(wo, getTimelineHtml({
        menu: wo.web?.menu || [],
        role: wo.webAuth?.role || "",
        activePath: urlPath,
        base: basePath,
        dbStatus,
        dbInfo,
        webAuth: wo.webAuth
      }));
    }
    wo.web = wo.web || {}; wo.web.useLayout = false;
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (!isAllowed) {
    setJsonResp(wo, 403, { error: "forbidden" });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  let pool;
  try { pool = await getDb(coreData); } catch (e) {
    setJsonResp(wo, 503, { error: "DB not available: " + e.message });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  try {
    if (method === "GET" && urlPath === basePath + "/api/channels") {
      const channels = await dbChannels(pool);
      setJsonResp(wo, 200, { channels });
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "GET" && urlPath === basePath + "/api/columns") {
      const columns = await dbColumns(pool);
      setJsonResp(wo, 200, { columns });
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "GET" && urlPath === basePath + "/api/records") {
      const page    = Math.max(1, getInt(query.page, 1));
      const limit   = Math.min(200, Math.max(1, getInt(query.limit, PAGE_SIZE)));
      const channel = getStr(query.channel) || null;
      const fields  = getStr(query.fields).split(",").map(s => s.trim()).filter(Boolean);
      const result  = await dbRecords(pool, { channel, page, limit, fields });
      setJsonResp(wo, 200, result);
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "GET" && urlPath === basePath + "/api/search") {
      const q            = getStr(query.q);
      const page         = Math.max(1, getInt(query.page, 1));
      const limit        = Math.min(200, Math.max(1, getInt(query.limit, PAGE_SIZE)));
      const channel      = getStr(query.channel) || null;
      const fields       = getStr(query.fields).split(",").map(s => s.trim()).filter(Boolean);
      const searchFields = getStr(query.searchFields).split(",").map(s => s.trim()).filter(Boolean);
      const result = await dbSearch(pool, { channel, q, page, limit, fields, searchFields: searchFields.length ? searchFields : ["summary"] });
      setJsonResp(wo, 200, result);
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "GET" && urlPath === basePath + "/api/record") {
      const ctx_id = getInt(query.ctx_id, 0);
      if (!ctx_id) { setJsonResp(wo, 400, { error: "ctx_id required" }); wo.jump = true; await setSendNow(wo); return coreData; }
      const record = await dbGetRecord(pool, ctx_id);
      if (!record) { setJsonResp(wo, 404, { error: "Entry not found" }); wo.jump = true; await setSendNow(wo); return coreData; }
      setJsonResp(wo, 200, { record });
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "PATCH" && urlPath === basePath + "/api/record") {
      const body   = wo.http?.json || {};
      const ctx_id = getInt(body.ctx_id, 0);
      const field  = getStr(body.field);
      const value  = body.value !== undefined && body.value !== null ? String(body.value) : "";
      if (!ctx_id || !field) { setJsonResp(wo, 400, { error: "ctx_id and field required" }); wo.jump = true; await setSendNow(wo); return coreData; }
      const affected = await dbUpdateRecord(pool, { ctx_id, field, value });
      setJsonResp(wo, 200, { ok: true, affected });
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "DELETE" && urlPath === basePath + "/api/delete") {
      const body = wo.http?.json || {};
      const ids  = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
      const protectFrozen = body.protectFrozen !== false;
      if (!ids.length) { setJsonResp(wo, 400, { error: "No IDs provided" }); }
      else { const deleted = await dbDelete(pool, ids, { protectFrozen }); setJsonResp(wo, 200, { ok: true, deleted, protectFrozen }); }
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "DELETE" && urlPath === basePath + "/api/delete-channel") {
      const body = wo.http?.json || {};
      const channelID = getStr(body.channelID).trim();
      const protectFrozen = body.protectFrozen !== false;
      if (!channelID) { setJsonResp(wo, 400, { error: "channelID required" }); }
      else {
        const deleted = await dbDeleteChannel(pool, channelID, { protectFrozen });
        setJsonResp(wo, 200, { ok: true, deleted, channelID, protectFrozen });
      }
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "DELETE" && urlPath === basePath + "/api/delete-channels") {
      const body = wo.http?.json || {};
      const channelIDs = Array.isArray(body.channelIDs) ? body.channelIDs : [];
      const protectFrozen = body.protectFrozen !== false;
      if (!channelIDs.length) { setJsonResp(wo, 400, { error: "channelIDs required" }); }
      else {
        const deleted = await dbDeleteChannels(pool, channelIDs, { protectFrozen });
        setJsonResp(wo, 200, { ok: true, deleted, channelIDs, protectFrozen });
      }
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "POST" && urlPath === basePath + "/api/replace/find") {
      const body    = wo.http?.json || {};
      const search  = getStr(body.search);
      const channel = getStr(body.channel) || null;
      const fields  = Array.isArray(body.fields) ? body.fields : ["summary"];
      if (!search) { setJsonResp(wo, 400, { error: "search required" }); }
      else {
        const matches = await dbFindReplace(pool, { search, channel, searchFields: fields });
        setJsonResp(wo, 200, { matches });
      }
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "POST" && urlPath === basePath + "/api/replace/apply") {
      const body    = wo.http?.json || {};
      const ctx_id  = getInt(body.ctx_id, 0);
      const field   = getStr(body.field);
      const search  = getStr(body.search);
      const replace = getStr(body.replace);
      const mode    = body.mode === "full" ? "full" : "partial";
      if (!ctx_id || !field || !search) { setJsonResp(wo, 400, { error: "ctx_id, field and search required" }); }
      else { const affected = await dbApplyReplace(pool, { ctx_id, field, search, replace, mode }); setJsonResp(wo, 200, { ok: true, affected }); }
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    if (method === "POST" && urlPath === basePath + "/api/replace/all") {
      const body    = wo.http?.json || {};
      const search  = getStr(body.search);
      const replace = getStr(body.replace);
      const channel = getStr(body.channel) || null;
      const fields  = Array.isArray(body.fields) ? body.fields : ["summary"];
      const mode    = body.mode === "full" ? "full" : "partial";
      if (!search) { setJsonResp(wo, 400, { error: "search required" }); }
      else { const updated = await dbReplaceAll(pool, { search, replace, channel, searchFields: fields, mode }); setJsonResp(wo, 200, { ok: true, updated }); }
      wo.jump = true; await setSendNow(wo); return coreData;
    }
  } catch (e) {
    setJsonResp(wo, 500, { error: e.message });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  return coreData;
}


