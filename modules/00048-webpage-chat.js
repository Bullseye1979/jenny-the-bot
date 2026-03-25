/************************************************************************************/
/* filename: 00048-webpage-chat.js                                                   *
/* Version 2.0                                                                       *
/* Purpose: Webpage chat SPA (port 3112, /chat). Handles channel listing, context    *
/*          display, AI completions (via internal POST /api proxy), and subchannel   *
/*          CRUD. Config section: config["webpage-chat"]. Reads wo.db for DB access. *
/*          Subchannel names stored in chat_subchannels table.                       *
/*          AI calls are routed through POST localhost:3400/api — channel config      *
/*          is handled by core-channel-config (api flow), not webpage-channel-config.*
/************************************************************************************/

import fs     from "node:fs";
import crypto from "node:crypto";
import { getDb, getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";

const MODULE_NAME = "webpage-chat";


async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return;
  const { res } = entry;
  const r      = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "application/json" };
  const body    = r.body    ?? "";
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}


function setJsonResp(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}


function setNotFound(wo) {
  wo.http.response = {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    body: "Not Found"
  };
}


function getBody(wo) {
  return String(wo.http?.rawBody ?? wo.http?.body ?? "");
}


function getIsAllowedRoles(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set();
  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary) have.add(primary);
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (v) have.add(v);
    }
  }
  for (const r of req) {
    const need = String(r || "").trim().toLowerCase();
    if (!need) continue;
    if (have.has(need)) return true;
  }
  return false;
}


function getUserRoleLabels(wo) {
  const out = [];
  const seen = new Set();
  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (!v || seen.has(v)) continue;
      seen.add(v); out.push(v);
    }
  }
  return out;
}


function getIsChatVisibleForUser(wo, chatEntry) {
  const required = Array.isArray(chatEntry?.roles) ? chatEntry.roles : [];
  if (!required.length) return true;
  const userRoles = getUserRoleLabels(wo);
  if (!userRoles.length) return false;
  for (const rr of required) {
    const need = String(rr || "").trim().toLowerCase();
    if (!need) continue;
    if (userRoles.includes(need)) return true;
  }
  return false;
}


function getChatEntryByChannelID(chats, channelID) {
  const id = String(channelID || "").trim();
  if (!id) return null;
  for (const c of chats) {
    if (String(c?.channelID || "").trim() === id) return c;
  }
  return null;
}


function getBasePath(cfg) {
  const bp = String(cfg.basePath ?? "/chat").trim();
  return bp && bp.startsWith("/") ? bp.replace(/\/+$/, "") : "/chat";
}


async function getEnsureChatSubchannelsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_subchannels (
      subchannel_id CHAR(36)     NOT NULL,
      channel_id    VARCHAR(128) NOT NULL,
      name          VARCHAR(255) NOT NULL DEFAULT '',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (subchannel_id),
      KEY idx_csc_channel (channel_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  try {
    await pool.query(`ALTER TABLE chat_subchannels ADD COLUMN IF NOT EXISTS system_prompt TEXT NULL`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE chat_subchannels ADD COLUMN IF NOT EXISTS persona TEXT NULL`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE chat_subchannels ADD COLUMN IF NOT EXISTS instructions TEXT NULL`);
  } catch {}
}




/* Channel-config helpers removed — AI is now handled via POST /api.
   core-channel-config (00010, api flow) applies per-channel overrides
   on the API side. No local wo overrides needed here. */


export default async function getWebpageChat(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg      = coreData?.config?.[MODULE_NAME] || {};
  const port     = Number(cfg.port ?? 3112);
  const chats    = Array.isArray(cfg.chats) ? cfg.chats : [];
  const basePath = getBasePath(cfg);

  if (Number(wo.http?.port) !== port) return coreData;

  const method  = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const isAllowed    = getIsAllowedRoles(wo, allowedRoles);

  /* ---- GET /chat/style.css ---- */
  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
      body:    fs.readFileSync(cssFile, "utf-8")
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat ---- */
  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!isAllowed) {
      const menu = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
      wo.http.response = {
        status:  403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body:    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
                 "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                 "<title>Chat</title>" + getThemeHeadScript() +
                 "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
                 "<header><h1>\uD83D\uDCAC Chat</h1>" + menu + "</header>" +
                 "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
                 "<div style=\"text-align:center;color:var(--txt)\">" +
                 "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
                 "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
                 "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">Go to home</a>" +
                 "</div></div></body></html>"
      };
      wo.web.useLayout = false;
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getChatHtml({ menu: wo.web?.menu || [], role: wo.webAuth?.role || "", activePath: urlPath, chatBase: basePath, webAuth: wo.webAuth })
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat/api/chats ---- */
  if (method === "GET" && urlPath === basePath + "/api/chats") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }
    const publicChats = chats
      .filter(c => getIsChatVisibleForUser(wo, c))
      .map(c => ({ label: String(c.label || c.channelID || "Chat"), channelID: String(c.channelID || "") }))
      .filter(c => c.channelID);
    setJsonResp(wo, 200, publicChats);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat/api/context?channelID=xxx[&subchannelId=yyy] ---- */
  if (method === "GET" && urlPath === basePath + "/api/context") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const rawUrl      = String(wo.http?.url ?? "");
    const urlObj      = new URL(rawUrl, "http://localhost");
    const channelID   = String(urlObj.searchParams.get("channelID")   || "").trim();
    const subchannelId = String(urlObj.searchParams.get("subchannelId") || "").trim();

    if (!channelID) { setJsonResp(wo, 400, { error: "channelID required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) { setNotFound(wo); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      /* Use direct DB query for display — getContext() strips the last user
         message by design (for AI calls). For the chat view we want all rows. */
      const pool = await getDb(coreData);
      let subSql = subchannelId ? "AND COALESCE(subchannel,'') = ?" : "AND subchannel IS NULL";
      const subArg = subchannelId ? [subchannelId] : [];
      const [rows] = await pool.query(
        `SELECT role, text, json, ts
           FROM context
          WHERE id = ?
            AND role IN ('user','assistant')
            ${subSql}
            AND JSON_VALID(json) = 1
          ORDER BY ctx_id DESC
          LIMIT 200`,
        [channelID, ...subArg]
      );
      const result = (rows || []).reverse()
        .map(r => {
          let text = "";
          try {
            const obj = JSON.parse(r.json);
            if (obj?.internal_meta === true) return null;
            text = typeof obj?.content === "string" ? obj.content : (r.text || "");
          } catch (_) { text = r.text || ""; }
          if (!text || /^META\|/.test(text)) return null;
          return { role: String(r.role || "assistant"), text, ts: r.ts };
        })
        .filter(Boolean);
      setJsonResp(wo, 200, result);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /chat/api/chat ---- */
  if (method === "POST" && urlPath === basePath + "/api/chat") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    let reqData = wo.http?.json ?? null;
    if (reqData === null) {
      try { reqData = JSON.parse(getBody(wo)); }
      catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }
    }

    const channelID    = String(reqData?.channelID    || "").trim();
    const payload      = String(reqData?.payload      || "").trim();
    const subchannelId = String(reqData?.subchannelId || "").trim();

    if (!channelID || !payload) {
      setJsonResp(wo, 400, { error: "channelID and payload required" });
      wo.jump = true; await setSendNow(wo); return coreData;
    }

    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) { setNotFound(wo); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      wo.channelID = channelID;
      wo.subchannel = subchannelId || null;

      /* ---- Admin slash commands — handled before AI call ---- */
      if (payload.startsWith("/")) {
        const cmdToken = payload.split(/\s+/)[0].slice(1).toLowerCase();

        if (cmdToken === "purgedb") {
          const deleted = await setPurgeContext(wo);
          setJsonResp(wo, 200, { response: `${deleted} items removed` });
          wo.jump = true;
          await setSendNow(wo);
          return coreData;
        }

        if (cmdToken === "freeze") {
          await setFreezeContext(wo);
          setJsonResp(wo, 200, { response: `freeze ok` });
          wo.jump = true;
          await setSendNow(wo);
          return coreData;
        }
      }

      /* Load subchannel AI config overrides */
      let subConfig = null;
      if (subchannelId) {
        try {
          const pool = await getDb(coreData);
          const [scRows] = await pool.query(
            "SELECT system_prompt, persona, instructions FROM chat_subchannels WHERE subchannel_id = ? LIMIT 1",
            [subchannelId]
          );
          if (scRows && scRows.length) subConfig = scRows[0];
        } catch {}
      }

      /* Build the API request body.
         Context writing is handled by 00072-api-add-context on the API side,
         so we do NOT set doNotWriteToContext.
         Subchannel overrides are sent as promptAddition so the API-side system
         can incorporate them (the API flow's core-ai-context-loader will apply
         the subchannel context). We pass subchannelId so context is scoped. */
      const apiUrl    = String(cfg.apiUrl    || "http://localhost:3400/api").trim();
      const apiSecret = String(cfg.apiSecret || "").trim();

      const reqBody = {
        channelID,
        payload,
        userId: String(wo.userId || wo.webAuth?.userId || "webpage-chat"),
        ...(subchannelId ? { subchannel: subchannelId } : {})
      };

      /* Carry subchannel prompt overrides as extra fields so api-add-context
         or the system prompt builder on the API side can apply them */
      if (subConfig?.system_prompt) reqBody.systemPrompt  = String(subConfig.system_prompt).trim();
      if (subConfig?.persona)       reqBody.persona        = String(subConfig.persona).trim();
      if (subConfig?.instructions)  reqBody.instructions   = String(subConfig.instructions).trim();

      const headers = { "Content-Type": "application/json" };
      if (apiSecret) headers["Authorization"] = `Bearer ${apiSecret}`;

      let data;
      try {
        const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(reqBody) });
        data = await res.json();
        if (!res.ok) throw new Error(`API responded ${res.status}: ${data?.error || res.statusText}`);
      } catch (fetchErr) {
        throw new Error(`API call failed: ${fetchErr?.message || String(fetchErr)}`);
      }

      const responseText = String(data?.response || "").trim();
      if (!responseText) throw new Error("API returned no response");

      setJsonResp(wo, 200, { response: responseText });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;

    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
  }

  /* ---- GET /chat/api/subchannels?channelID=xxx ---- */
  if (method === "GET" && urlPath === basePath + "/api/subchannels") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const rawUrl    = String(wo.http?.url ?? "");
    const urlObj    = new URL(rawUrl, "http://localhost");
    const channelID = String(urlObj.searchParams.get("channelID") || "").trim();
    if (!channelID) { setJsonResp(wo, 400, { error: "channelID required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) { setNotFound(wo); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const pool = await getDb(coreData);
      await getEnsureChatSubchannelsTable(pool);
      const [rows] = await pool.query(
        "SELECT subchannel_id, name, system_prompt, persona, instructions, created_at FROM chat_subchannels WHERE channel_id = ? ORDER BY created_at ASC",
        [channelID]
      );
      setJsonResp(wo, 200, rows.map(r => ({ subchannelId: r.subchannel_id, name: r.name, systemPrompt: r.system_prompt || "", persona: r.persona || "", instructions: r.instructions || "", createdAt: r.created_at })));
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /chat/api/subchannels — create ---- */
  if (method === "POST" && urlPath === basePath + "/api/subchannels") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    let body = wo.http?.json ?? null;
    if (body === null) {
      try { body = JSON.parse(getBody(wo)); }
      catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }
    }

    const channelID = String(body?.channelID || "").trim();
    const name      = String(body?.name      || "").trim();
    if (!channelID) { setJsonResp(wo, 400, { error: "channelID required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    const chatEntry = getChatEntryByChannelID(chats, channelID) || {};
    if (!getIsChatVisibleForUser(wo, chatEntry)) { setNotFound(wo); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const pool        = await getDb(coreData);
      await getEnsureChatSubchannelsTable(pool);
      const subchannelId = crypto.randomUUID();
      await pool.execute(
        "INSERT INTO chat_subchannels (subchannel_id, channel_id, name) VALUES (?, ?, ?)",
        [subchannelId, channelID, name]
      );
      setJsonResp(wo, 200, { subchannelId, name, channelID });
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- PATCH /chat/api/subchannels — rename ---- */
  if (method === "PATCH" && urlPath === basePath + "/api/subchannels") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    let body = wo.http?.json ?? null;
    if (body === null) {
      try { body = JSON.parse(getBody(wo)); }
      catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }
    }

    const subchannelId = String(body?.subchannelId || "").trim();
    if (!subchannelId) { setJsonResp(wo, 400, { error: "subchannelId required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const pool = await getDb(coreData);
      await getEnsureChatSubchannelsTable(pool);
      const setClauses = [];
      const setArgs    = [];
      if (body?.name         !== undefined) { setClauses.push("name = ?");          setArgs.push(String(body.name         ?? "").trim()); }
      if (body?.systemPrompt !== undefined) { setClauses.push("system_prompt = ?"); setArgs.push(String(body.systemPrompt ?? "") || null); }
      if (body?.persona      !== undefined) { setClauses.push("persona = ?");       setArgs.push(String(body.persona      ?? "") || null); }
      if (body?.instructions !== undefined) { setClauses.push("instructions = ?");  setArgs.push(String(body.instructions ?? "") || null); }
      if (!setClauses.length) { setJsonResp(wo, 400, { error: "nothing to update" }); wo.jump = true; await setSendNow(wo); return coreData; }
      setArgs.push(subchannelId);
      const [res] = await pool.execute(
        `UPDATE chat_subchannels SET ${setClauses.join(", ")} WHERE subchannel_id = ?`,
        setArgs
      );
      if (Number(res?.affectedRows || 0) === 0) {
        setJsonResp(wo, 404, { error: "subchannel not found" });
      } else {
        setJsonResp(wo, 200, { subchannelId, updated: true });
      }
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- DELETE /chat/api/subchannels — delete ---- */
  if (method === "DELETE" && urlPath === basePath + "/api/subchannels") {
    if (!isAllowed) { setJsonResp(wo, 403, { error: "forbidden" }); wo.jump = true; await setSendNow(wo); return coreData; }

    let body = wo.http?.json ?? null;
    if (body === null) {
      try { body = JSON.parse(getBody(wo)); }
      catch (_) { setJsonResp(wo, 400, { error: "Invalid JSON" }); wo.jump = true; await setSendNow(wo); return coreData; }
    }

    const subchannelId = String(body?.subchannelId || "").trim();
    if (!subchannelId) { setJsonResp(wo, 400, { error: "subchannelId required" }); wo.jump = true; await setSendNow(wo); return coreData; }

    try {
      const pool = await getDb(coreData);
      await getEnsureChatSubchannelsTable(pool);

      /* Look up channelID before deleting so we can purge context entries */
      const [scRows] = await pool.query(
        "SELECT channel_id FROM chat_subchannels WHERE subchannel_id = ? LIMIT 1",
        [subchannelId]
      );
      const channelIDForSub = scRows?.[0]?.channel_id ? String(scRows[0].channel_id) : null;

      /* Remove the subchannel name mapping */
      await pool.execute(
        "DELETE FROM chat_subchannels WHERE subchannel_id = ?",
        [subchannelId]
      );

      /* Purge context: delete non-frozen, promote frozen to main channel */
      let purgeResult = { deleted: 0, promoted: 0 };
      if (channelIDForSub) {
        const purgeWo = { db: wo.db, config: wo.config, channelID: channelIDForSub };
        purgeResult = await setPurgeSubchannel(purgeWo, subchannelId);
      }

      setJsonResp(wo, 200, { deleted: true, subchannelId, ...purgeResult });
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }

    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  return coreData;
}



function getChatHtml(opts) {
  const chatBase   = String(opts?.chatBase || "/chat").replace(/\/+$/, "") || "/chat";
  const activePath = String(opts?.activePath || chatBase);
  const role       = String(opts?.role || "").trim();
  const menuHtml = getMenuHtml(opts?.menu || [], activePath, role, null, null, opts?.webAuth);

  return (
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">\n" +
    "<title>\u{1F4AC} Chat</title>\n" +
    getThemeHeadScript() + "\n" +
    "<link rel=\"stylesheet\" href=\"" + chatBase + "/style.css\">\n" +
    "<style>\n" +
    "/* Subchannel controls — added to shared channel bar */\n" +
    "#chat-sub-sel{max-width:150px;padding:4px 6px;border:1px solid var(--bdr);border-radius:4px;font-size:12px;background:var(--bg2);color:var(--txt);cursor:pointer}\n" +
    "#chat-sub-sel:focus{outline:none;border-color:var(--acc)}\n" +
    ".chat-sub-btn{width:26px;height:26px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}\n" +
    ".chat-sub-btn:hover{border-color:var(--acc);color:var(--acc)}\n" +
    "/* Sub-config modal */\n" +
    "#sub-cfg-modal textarea{width:100%;margin-top:4px;resize:vertical;background:var(--bg);color:var(--txt);border:1px solid var(--bdr);border-radius:4px;padding:6px;font-size:13px;box-sizing:border-box}\n" +
    "#sub-cfg-modal .modal-box{background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:20px;width:min(520px,95vw);max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px}\n" +
    "#sub-cfg-modal label{font-size:12px;color:var(--muted)}\n" +
    "#sub-cfg-modal .modal-footer{display:flex;gap:8px;justify-content:flex-end}\n" +
    "#sub-cfg-modal .btn-cancel{padding:6px 14px;border:1px solid var(--bdr);background:transparent;color:var(--txt);border-radius:4px;cursor:pointer}\n" +
    "#sub-cfg-modal .btn-save{padding:6px 14px;border:none;background:var(--acc);color:#fff;border-radius:4px;cursor:pointer}\n" +
    "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    "<header>\n" +
    "  <h1>\u{1F4AC} Chat</h1>\n" +
    (menuHtml ? ("  " + menuHtml + "\n") : "") +
    "</header>\n" +
    "\n" +
    "<div id=\"chat-view\">\n" +
    "  <div id=\"chat-center\">\n" +
    "    <div id=\"chat-channel-bar\">\n" +
    "      <select id=\"chat-sel\" onchange=\"onChatSel(this.value)\"><option value=\"\">Loading\u2026</option></select>\n" +
    "      <select id=\"chat-sub-sel\" onchange=\"onSubSel(this.value)\" style=\"display:none\"></select>\n" +
    "      <button class=\"chat-sub-btn\" id=\"sub-new-btn\" onclick=\"subCreate()\" title=\"New subchannel\" style=\"display:none\">\u271A</button>\n" +
    "      <button class=\"chat-sub-btn\" id=\"sub-ren-btn\" onclick=\"subRename()\" title=\"Rename subchannel\" style=\"display:none\">\u270E</button>\n" +
    "      <button class=\"chat-sub-btn\" id=\"sub-del-btn\" onclick=\"subDelete()\" title=\"Delete subchannel\" style=\"display:none\">\u2715</button>\n" +
    "      <button class=\"chat-sub-btn\" id=\"sub-cfg-btn\" onclick=\"subConfig()\" title=\"Subchannel settings\" style=\"display:none\">\u2699</button>\n" +
    "      <button id=\"chat-reload-btn\" onclick=\"reloadContext()\" title=\"Reload\">\u21BB</button>\n" +
    "    </div>\n" +
    "    <div id=\"chat-msgs\"><div class=\"chat-loading\">Select a channel to start chatting.</div></div>\n" +
    "  </div>\n" +
    "  <div id=\"chat-footer\">\n" +
    "    <textarea id=\"chat-input\" placeholder=\"Type a message\u2026  (Enter = send \u2022 Shift+Enter = newline)\" rows=\"1\"></textarea>\n" +
    "    <button id=\"chat-send-btn\" onclick=\"sendMessage()\" title=\"Send\">\u27A4</button>\n" +
    "  </div>\n" +
    "</div>\n" +
    "<div id=\"sub-cfg-modal\" style=\"display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:900;align-items:center;justify-content:center\">\n" +
    "  <div class=\"modal-box\">\n" +
    "    <div style=\"display:flex;justify-content:space-between;align-items:center\">\n" +
    "      <strong>Subchannel Settings</strong>\n" +
    "      <button onclick=\"subConfigClose()\" style=\"background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px\">\u2715</button>\n" +
    "    </div>\n" +
    "    <label>System Prompt<br><textarea id=\"cfg-system-prompt\" rows=\"5\"></textarea></label>\n" +
    "    <label>Persona<br><textarea id=\"cfg-persona\" rows=\"3\"></textarea></label>\n" +
    "    <label>Instructions<br><textarea id=\"cfg-instructions\" rows=\"3\"></textarea></label>\n" +
    "    <div class=\"modal-footer\">\n" +
    "      <button class=\"btn-cancel\" onclick=\"subConfigClose()\">Cancel</button>\n" +
    "      <button class=\"btn-save\" onclick=\"subConfigSave()\">Save</button>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</div>\n" +
    "<div id=\"toast\" class=\"toast\"></div>\n" +
    "\n" +
    "<script>\n" +
    "var CHAT_BASE=\"" + chatBase + "\";\n" +
    "var chatChannelID=\"\", chatSubchannelId=\"\", chatMessages=[], chatSending=false, chatSubchannelList=[];\n" +
    "\n" +
    "function toast(msg,ms){var t=document.getElementById(\"toast\");t.textContent=msg;t.classList.add(\"on\");setTimeout(function(){t.classList.remove(\"on\");},ms||2400);}\n" +
    "\n" +
    "/* ---- Channel loading ---- */\n" +
    "function loadChats(){\n" +
    "  fetch(CHAT_BASE+\"/api/chats\")\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(list){\n" +
    "      var sel=document.getElementById(\"chat-sel\");\n" +
    "      sel.innerHTML=\"\";\n" +
    "      if(!list||!list.length){var o=document.createElement(\"option\");o.value=\"\";o.textContent=\"No chats configured\";sel.appendChild(o);return;}\n" +
    "      list.forEach(function(c){var o=document.createElement(\"option\");o.value=c.channelID;o.textContent=c.label||c.channelID;sel.appendChild(o);});\n" +
    "      if(list[0]&&list[0].channelID){sel.value=list[0].channelID;onChatSel(list[0].channelID);}\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Failed to load chats: \"+e.message,6000);});\n" +
    "}\n" +
    "\n" +
    "function onChatSel(channelID){\n" +
    "  chatChannelID=channelID;\n" +
    "  chatSubchannelId=\"\";\n" +
    "  if(!channelID){document.getElementById(\"chat-msgs\").innerHTML=\"<div class='chat-loading'>Select a channel.</div>\";hideSubUI();return;}\n" +
    "  loadSubchannels(channelID);\n" +
    "}\n" +
    "\n" +
    "/* ---- Subchannel UI ---- */\n" +
    "function hideSubUI(){[\"chat-sub-sel\",\"sub-new-btn\",\"sub-ren-btn\",\"sub-del-btn\",\"sub-cfg-btn\"].forEach(function(id){document.getElementById(id).style.display=\"none\";});}\n" +
    "\n" +
    "function loadSubchannels(channelID, autoSelectId){\n" +
    "  fetch(CHAT_BASE+\"/api/subchannels?channelID=\"+encodeURIComponent(channelID))\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(list){\n" +
    "      var sel=document.getElementById(\"chat-sub-sel\");\n" +
    "      sel.innerHTML=\"\";\n" +
    "      var main=document.createElement(\"option\");main.value=\"\";main.textContent=\"Main (no subchannel)\";sel.appendChild(main);\n" +
    "      chatSubchannelList=Array.isArray(list)?list:[];\n" +
    "      chatSubchannelList.forEach(function(s){var o=document.createElement(\"option\");o.value=s.subchannelId;o.textContent=s.name||s.subchannelId.slice(0,8);sel.appendChild(o);});\n" +
    "      sel.style.display=\"\";\n" +
    "      document.getElementById(\"sub-new-btn\").style.display=\"\";\n" +
    "      if(autoSelectId){sel.value=autoSelectId;onSubSel(autoSelectId);}\n" +
    "      else{onSubSel(\"\");}\n" +
    "    })\n" +
    "    .catch(function(){hideSubUI();loadContext(channelID,\"\");});\n" +
    "}\n" +
    "\n" +
    "function onSubSel(subchannelId){\n" +
    "  chatSubchannelId=subchannelId;\n" +
    "  var renBtn=document.getElementById(\"sub-ren-btn\");\n" +
    "  var delBtn=document.getElementById(\"sub-del-btn\");\n" +
    "  var cfgBtn=document.getElementById(\"sub-cfg-btn\");\n" +
    "  renBtn.style.display=subchannelId?\"\":\"none\";\n" +
    "  delBtn.style.display=subchannelId?\"\":\"none\";\n" +
    "  cfgBtn.style.display=subchannelId?\"\":\"none\";\n" +
    "  loadContext(chatChannelID,subchannelId);\n" +
    "}\n" +
    "\n" +
    "function subCreate(){\n" +
    "  var name=prompt(\"Subchannel name:\");\n" +
    "  if(name===null)return;\n" +
    "  fetch(CHAT_BASE+\"/api/subchannels\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({channelID:chatChannelID,name:name.trim()})})\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(d){\n" +
    "      if(d&&d.error){toast(\"Error: \"+d.error,5000);return;}\n" +
    "      loadSubchannels(chatChannelID, d.subchannelId);\n" +
    "      toast(\"Subchannel created\");\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Error: \"+e.message,5000);});\n" +
    "}\n" +
    "\n" +
    "function subRename(){\n" +
    "  if(!chatSubchannelId)return;\n" +
    "  var sel=document.getElementById(\"chat-sub-sel\");\n" +
    "  var cur=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].textContent:\"\";\n" +
    "  var name=prompt(\"New name:\",cur);\n" +
    "  if(name===null)return;\n" +
    "  fetch(CHAT_BASE+\"/api/subchannels\",{method:\"PATCH\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({subchannelId:chatSubchannelId,name:name.trim()})})\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(d){\n" +
    "      if(d&&d.error){toast(\"Error: \"+d.error,5000);return;}\n" +
    "      loadSubchannels(chatChannelID);\n" +
    "      toast(\"Renamed\");\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Error: \"+e.message,5000);});\n" +
    "}\n" +
    "\n" +
    "function subDelete(){\n" +
    "  if(!chatSubchannelId)return;\n" +
    "  if(!confirm(\"Delete this subchannel? Non-frozen entries will be deleted. Frozen entries will be promoted to the main channel.\"))return;\n" +
    "  fetch(CHAT_BASE+\"/api/subchannels\",{method:\"DELETE\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({subchannelId:chatSubchannelId})})\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(d){\n" +
    "      if(d&&d.error){toast(\"Error: \"+d.error,5000);return;}\n" +
    "      chatSubchannelId=\"\";\n" +
    "      loadSubchannels(chatChannelID);\n" +
    "      toast(\"Deleted\");\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Error: \"+e.message,5000);});\n" +
    "}\n" +
    "\n" +
    "function subConfig(){\n" +
    "  if(!chatSubchannelId)return;\n" +
    "  var sc=chatSubchannelList.find(function(s){return s.subchannelId===chatSubchannelId;});\n" +
    "  document.getElementById(\"cfg-system-prompt\").value=sc&&sc.systemPrompt?sc.systemPrompt:\"\";\n" +
    "  document.getElementById(\"cfg-persona\").value=sc&&sc.persona?sc.persona:\"\";\n" +
    "  document.getElementById(\"cfg-instructions\").value=sc&&sc.instructions?sc.instructions:\"\";\n" +
    "  var m=document.getElementById(\"sub-cfg-modal\");m.style.display=\"flex\";\n" +
    "}\n" +
    "\n" +
    "function subConfigClose(){\n" +
    "  document.getElementById(\"sub-cfg-modal\").style.display=\"none\";\n" +
    "}\n" +
    "\n" +
    "function subConfigSave(){\n" +
    "  if(!chatSubchannelId)return;\n" +
    "  var payload={\n" +
    "    subchannelId:chatSubchannelId,\n" +
    "    systemPrompt:document.getElementById(\"cfg-system-prompt\").value,\n" +
    "    persona:document.getElementById(\"cfg-persona\").value,\n" +
    "    instructions:document.getElementById(\"cfg-instructions\").value\n" +
    "  };\n" +
    "  fetch(CHAT_BASE+\"/api/subchannels\",{method:\"PATCH\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(payload)})\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(d){\n" +
    "      if(d&&d.error){toast(\"Error: \"+d.error,5000);return;}\n" +
    "      subConfigClose();\n" +
    "      loadSubchannels(chatChannelID);\n" +
    "      toast(\"Settings saved\");\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Error: \"+e.message,5000);});\n" +
    "}\n" +
    "\n" +
    "/* ---- Context loading ---- */\n" +
    "function reloadContext(){loadContext(chatChannelID,chatSubchannelId);}\n" +
    "\n" +
    "function loadContext(channelID,subchannelId){\n" +
    "  if(!channelID){document.getElementById(\"chat-msgs\").innerHTML=\"<div class='chat-loading'>Select a channel.</div>\";return;}\n" +
    "  document.getElementById(\"chat-msgs\").innerHTML=\"<div class='chat-loading'>Loading\u2026</div>\";\n" +
    "  var url=CHAT_BASE+\"/api/context?channelID=\"+encodeURIComponent(channelID);\n" +
    "  if(subchannelId)url+=\"&subchannelId=\"+encodeURIComponent(subchannelId);\n" +
    "  fetch(url).then(function(r){return r.json();})\n" +
    "    .then(function(data){\n" +
    "      if(data&&data.error){toast(\"Context error: \"+data.error,5000);chatMessages=[];renderMessages();return;}\n" +
    "      chatMessages=Array.isArray(data)?data:[];\n" +
    "      renderMessages();\n" +
    "    })\n" +
    "    .catch(function(e){toast(\"Context error: \"+e.message,4000);});\n" +
    "}\n" +
    "\n" +
    "/* ---- Rendering ---- */\n" +
    "function renderMessages(){\n" +
    "  var el=document.getElementById(\"chat-msgs\");el.innerHTML=\"\";\n" +
    "  if(!chatMessages.length){el.innerHTML=\"<div class='chat-empty'>No messages yet. Send the first!</div>\";return;}\n" +
    "  chatMessages.forEach(function(m){el.appendChild(buildMsgEl(m.role||\"assistant\",m.text||\"\"));});\n" +
    "  el.scrollTop=el.scrollHeight;\n" +
    "}\n" +
    "function escHtml(s){return String(s).replace(/&/g,\"&amp;\").replace(/</g,\"&lt;\").replace(/>/g,\"&gt;\");}\n" +
    "function safeUrl(u){return /^https?:/i.test(u)?u:\"\";}\n" +
    "function mdInline(s){\n" +
    "  var ls=[],li=0;\n" +
    "  function lph(h){var k=\"\\x00L\"+(li++)+\"\\x00\";ls.push({k:k,v:h});return k;}\n" +
    "  s=s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,function(_,t,u){u=safeUrl(u.replace(/[.,;!?\\]>]+$/,\"\"));if(!u)return t;return lph(\"<a href='\"+escHtml(u)+\"' target='_blank' rel='noopener noreferrer' data-url='\"+escHtml(u)+\"'>\"+t+\"</a>\");});\n" +
    "  s=s.replace(/https?:\\/\\/[^\\s<>\"&]+/g,function(u){u=safeUrl(u.replace(/[.,;!?\\]>]+$/,\"\"));if(!u)return u;return lph(\"<a href='\"+escHtml(u)+\"' target='_blank' rel='noopener noreferrer' data-url='\"+escHtml(u)+\"'>\"+escHtml(u)+\"</a>\");});\n" +
    "  s=s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g,\"<strong><em>$1</em></strong>\");\n" +
    "  s=s.replace(/\\*\\*(.+?)\\*\\*/g,\"<strong>$1</strong>\");\n" +
    "  s=s.replace(/__(.+?)__/g,\"<strong>$1</strong>\");\n" +
    "  s=s.replace(/\\*([^*\\n]+)\\*/g,\"<em>$1</em>\");\n" +
    "  s=s.replace(/_([^_\\n]+)_/g,\"<em>$1</em>\");\n" +
    "  for(var i=0;i<ls.length;i++)s=s.split(ls[i].k).join(ls[i].v);\n" +
    "  return s;\n" +
    "}\n" +
    "function renderMarkdown(raw){\n" +
    "  var snips=[],n=0,t=String(raw||\"\");\n" +
    "  t=t.replace(/```[\\w]*\\n?([\\s\\S]*?)```/g,function(_,c){var i=n++;snips[i]=\"<pre><code>\"+escHtml(c.replace(/\\n$/,\"\"))+\"</code></pre>\";return \"\\x00S\"+i+\"\\x00\";});\n" +
    "  t=t.replace(/`([^`\\n]+)`/g,function(_,c){var i=n++;snips[i]=\"<code>\"+escHtml(c)+\"</code>\";return \"\\x00S\"+i+\"\\x00\";});\n" +
    "  var lines=t.split(\"\\n\"),html=\"\",inUl=false;\n" +
    "  for(var i=0;i<lines.length;i++){\n" +
    "    var ln=lines[i];\n" +
    "    var hm=ln.match(/^(#{1,3})\\s+(.+)$/);\n" +
    "    if(hm){if(inUl){html+=\"</ul>\";inUl=false;}html+=\"<h\"+hm[1].length+\">\"+mdInline(escHtml(hm[2]))+\"</h\"+hm[1].length+\">\";continue;}\n" +
    "    var bm=ln.match(/^>\\s*(.*)/);\n" +
    "    if(bm){if(inUl){html+=\"</ul>\";inUl=false;}html+=\"<blockquote>\"+mdInline(escHtml(bm[1]))+\"</blockquote>\";continue;}\n" +
    "    if(/^(-{3,}|\\*{3,})$/.test(ln.trim())){if(inUl){html+=\"</ul>\";inUl=false;}html+=\"<hr>\";continue;}\n" +
    "    var lm=ln.match(/^(?:[*\\-]|\\d+\\.)\\s+(.+)$/);\n" +
    "    if(lm){if(!inUl){html+=\"<ul>\";inUl=true;}html+=\"<li>\"+mdInline(escHtml(lm[1]))+\"</li>\";continue;}\n" +
    "    if(!ln.trim()){if(inUl){html+=\"</ul>\";inUl=false;}html+=\"<br>\";continue;}\n" +
    "    if(inUl){html+=\"</ul>\";inUl=false;}\n" +
    "    html+=mdInline(escHtml(ln))+\"<br>\";\n" +
    "  }\n" +
    "  if(inUl)html+=\"</ul>\";\n" +
    "  html=html.replace(/(<br>\\s*)+$/,\"\");\n" +
    "  for(var j=0;j<snips.length;j++)html=html.split(\"\\x00S\"+j+\"\\x00\").join(snips[j]);\n" +
    "  return html;\n" +
    "}\n" +
    "function injectEmbeds(el){\n" +
    "  var as=[].slice.call(el.querySelectorAll(\"a[data-url]\"));\n" +
    "  for(var i=0;i<as.length;i++){\n" +
    "    var a=as[i],u=a.getAttribute(\"data-url\"),emb=null;\n" +
    "    var ytM=u.match(/(?:youtube\\.com\\/watch\\?(?:[^&]*&)*v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);\n" +
    "    if(ytM){emb=document.createElement(\"div\");emb.className=\"chat-embed\";var yi=document.createElement(\"iframe\");yi.src=\"https://www.youtube.com/embed/\"+ytM[1];yi.setAttribute(\"frameborder\",\"0\");yi.setAttribute(\"allowfullscreen\",\"\");emb.appendChild(yi);}\n" +
    "    else{var vmM=u.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/);if(vmM){emb=document.createElement(\"div\");emb.className=\"chat-embed\";var vi=document.createElement(\"iframe\");vi.src=\"https://player.vimeo.com/video/\"+vmM[1];vi.setAttribute(\"frameborder\",\"0\");vi.setAttribute(\"allowfullscreen\",\"\");emb.appendChild(vi);}\n" +
    "    else if(/\\.(mp4|webm|ogg|mov|m4v)(\\?.*)?$/i.test(u)){emb=document.createElement(\"div\");emb.className=\"chat-embed\";var dv=document.createElement(\"video\");dv.src=u;dv.controls=true;emb.appendChild(dv);}\n" +
    "    else if(/\\.(jpg|jpeg|png|gif|webp|svg)(\\?.*)?$/i.test(u)){emb=document.createElement(\"div\");emb.className=\"chat-embed\";var im=document.createElement(\"img\");im.src=u;im.className=\"chat-img\";im.alt=\"\";im.loading=\"lazy\";im.onerror=function(){if(this.parentNode)this.parentNode.removeChild(this);};emb.appendChild(im);}}\n" +
    "    if(emb)a.parentNode.insertBefore(emb,a.nextSibling);\n" +
    "  }\n" +
    "}\n" +
    "function buildMsgEl(role,text){\n" +
    "  var wrap=document.createElement(\"div\");wrap.className=\"chat-msg \"+(role===\"user\"?\"user\":\"assistant\");\n" +
    "  var bubble=document.createElement(\"div\");bubble.className=\"chat-bubble\";bubble.innerHTML=renderMarkdown(text);\n" +
    "  injectEmbeds(bubble);wrap.appendChild(bubble);return wrap;\n" +
    "}\n" +
    "function appendMessage(role,text){\n" +
    "  chatMessages.push({role:role,text:text});\n" +
    "  var el=document.getElementById(\"chat-msgs\");\n" +
    "  var emptyEl=el.querySelector(\".chat-empty\");if(emptyEl)emptyEl.remove();\n" +
    "  el.appendChild(buildMsgEl(role,text));el.scrollTop=el.scrollHeight;\n" +
    "}\n" +
    "\n" +
    "/* ---- Send ---- */\n" +
    "function sendMessage(){\n" +
    "  if(chatSending)return;\n" +
    "  if(!chatChannelID){toast(\"Please select a channel first\");return;}\n" +
    "  var inp=document.getElementById(\"chat-input\");\n" +
    "  var text=inp.value.trim();if(!text)return;\n" +
    "  inp.value=\"\";\n" +
    "  appendMessage(\"user\",text);\n" +
    "  chatSending=true;\n" +
    "  var btn=document.getElementById(\"chat-send-btn\");btn.disabled=true;btn.textContent=\"\u23F3\";\n" +
    "  var thinkWrap=document.createElement(\"div\");thinkWrap.className=\"chat-msg assistant\";\n" +
    "  var thinkBub=document.createElement(\"div\");thinkBub.className=\"chat-bubble chat-thinking\";\n" +
    "  var thinkLbl=document.createElement(\"span\");thinkLbl.className=\"label\";\n" +
    "  thinkBub.appendChild(thinkLbl);\n" +
    "  [1,2,3].forEach(function(){var d=document.createElement(\"span\");d.className=\"dot\";thinkBub.appendChild(d);});\n" +
    "  thinkWrap.appendChild(thinkBub);\n" +
    "  var msgsEl=document.getElementById(\"chat-msgs\");msgsEl.appendChild(thinkWrap);msgsEl.scrollTop=msgsEl.scrollHeight;\n" +
    "  var payload={channelID:chatChannelID,payload:text};\n" +
    "  if(chatSubchannelId)payload.subchannelId=chatSubchannelId;\n" +
    "  fetch(CHAT_BASE+\"/api/chat\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(payload)})\n" +
    "    .then(function(r){return r.json();})\n" +
    "    .then(function(d){\n" +
    "      if(thinkWrap.parentNode)thinkWrap.parentNode.removeChild(thinkWrap);\n" +
    "      chatSending=false;btn.disabled=false;btn.textContent=\"\u27A4\";\n" +
    "      if(d&&d.response!==undefined)appendMessage(\"assistant\",String(d.response||\"\"));\n" +
    "      else if(d&&d.error)toast(\"Error: \"+d.error,6000);\n" +
    "    })\n" +
    "    .catch(function(e){\n" +
    "      if(thinkWrap.parentNode)thinkWrap.parentNode.removeChild(thinkWrap);\n" +
    "      chatSending=false;btn.disabled=false;btn.textContent=\"\u27A4\";\n" +
    "      toast(\"Send failed: \"+e.message,5000);\n" +
    "    });\n" +
    "}\n" +
    "\n" +
    "document.getElementById(\"chat-input\").addEventListener(\"keydown\",function(e){if(e.key===\"Enter\"&&!e.shiftKey){e.preventDefault();sendMessage();}});\n" +
    "\n" +
    "loadChats();\n" +
    "</script>\n" +
    "</body>\n" +
    "</html>"
  );
}

export const fn = getWebpageChat;
