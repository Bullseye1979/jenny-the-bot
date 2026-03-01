"use strict";

import { getChatHtml, isAuthorized, getDb } from "../shared/webpage/interface.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "webpage-chat";

/********************************************************************************************************************
* functionSignature: setSendNow (wo)
********************************************************************************************************************/
async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return;
  const { res } = entry;
  const r = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "application/json" };
  const body    = r.body    ?? "";
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/********************************************************************************************************************
* functionSignature: setJsonResp (wo, status, data)
********************************************************************************************************************/
function setJsonResp(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

/********************************************************************************************************************
* functionSignature: getBody (wo)
* Purpose: Returns the raw request body string from workingObject.
********************************************************************************************************************/
function getBody(wo) {
  return String(wo.http?.rawBody ?? wo.http?.body ?? "");
}

/********************************************************************************************************************
* functionSignature: getWebpageChat (coreData)
* Purpose: Handles all requests arriving on the chat port.
*          Routes: GET /chat              →  chat SPA
*                  GET /api/chats         →  list configured channels
*                  GET /api/context       →  last 100 context rows from MySQL
*                  POST /api/chat         →  proxy message to the bot API
*                  GET /api/toolcall      →  poll channel-specific tool-call status
********************************************************************************************************************/
export default async function getWebpageChat(coreData) {
  const wo = coreData?.workingObject || {};

  /* Only active in the webpage flow */
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port     ?? 3111);
  const token        = String(cfg.token    ?? "").trim();
  const label        = String(cfg.label    ?? "💬 Chat").trim();
  const globalApiUrl = String(cfg.apiUrl   ?? "http://localhost:3400/api").trim();
  const chats        = Array.isArray(cfg.chats) ? cfg.chats : [];

  /* Always add ourselves to the nav menu (cross-port linking) */
  if (Array.isArray(wo.web?.menu)) {
    wo.web.menu.push({ label, port, path: "/chat" });
  }

  /* Only handle requests arriving on our port */
  if (wo.http?.port !== port) return coreData;

  /* Skip if another module already handled this request */
  if (wo.jump) return coreData;

  const method  = String(wo.http?.method  ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? wo.http?.url ?? "/").split("?")[0];
  const headers = wo.http?.headers ?? {};

  /* Auth guard */
  if (!isAuthorized({ headers }, token)) {
    setJsonResp(wo, 401, { error: "unauthorized" });
    wo.http.response.headers["WWW-Authenticate"] = "Basic realm=\"Jenny Chat\"";
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /chat or /chat/index.html  →  Serve chat SPA ---- */
  if (method === "GET" && (urlPath === "/chat" || urlPath === "/chat/")) {
    wo.http.response = {
      status:  200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body:    getChatHtml()
    };
    wo.web.useLayout = false;
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /api/chats — public channel list (no apiSecret exposed) ---- */
  if (method === "GET" && urlPath === "/api/chats") {
    const publicChats = chats
      .map(c => ({ label: String(c.label || c.channelID || "Chat"), channelID: String(c.channelID || "") }))
      .filter(c => c.channelID);
    setJsonResp(wo, 200, publicChats);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /api/context?channelID=xxx — last 100 context rows ---- */
  if (method === "GET" && urlPath === "/api/context") {
    const rawUrl    = String(wo.http?.url ?? "/api/context");
    const urlObj    = new URL(rawUrl, "http://localhost");
    const channelID = String(urlObj.searchParams.get("channelID") || "").trim();
    if (!channelID) {
      setJsonResp(wo, 400, { error: "channelID parameter required" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    try {
      const pool = await getDb(coreData);
      const [rows] = await pool.query(
        "SELECT role, text, json, ts FROM context WHERE id = ? ORDER BY ctx_id DESC LIMIT 100",
        [channelID]
      );
      const msgs = rows.reverse()
        .filter(r => { const rl = String(r.role || "").toLowerCase(); return rl === "user" || rl === "assistant"; })
        .map(r => {
          let text = String(r.text || "");
          try {
            const obj = JSON.parse(r.json);
            if (typeof obj?.content === "string" && obj.content) text = obj.content;
          } catch (_) {}
          return { role: String(r.role || "assistant"), text, ts: r.ts };
        });
      setJsonResp(wo, 200, msgs);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- POST /api/chat — proxy message to the bot API ---- */
  if (method === "POST" && urlPath === "/api/chat") {
    /* wo.http.json is pre-parsed by flows/webpage.js; fall back to manual parse of rawBody */
    let reqData = wo.http?.json ?? null;
    if (reqData === null) {
      try { reqData = JSON.parse(getBody(wo)); }
      catch (e) {
        setJsonResp(wo, 400, { error: "Invalid JSON" });
        wo.jump = true;
        await setSendNow(wo);
        return coreData;
      }
    }
    const channelID = String(reqData?.channelID || "").trim();
    const payload   = String(reqData?.payload   || "").trim();
    if (!channelID || !payload) {
      setJsonResp(wo, 400, { error: "channelID and payload required" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
    /* Find the matching chat entry for apiSecret + apiUrl */
    const chatEntry  = chats.find(c => String(c.channelID || "") === channelID) || {};
    const apiSecret  = String(chatEntry.apiSecret || "").trim();
    const chatApiUrl = String(chatEntry.apiUrl || globalApiUrl).trim();
    const reqHeaders = { "Content-Type": "application/json" };
    if (apiSecret) reqHeaders["Authorization"] = "Bearer " + apiSecret;
    try {
      const { default: https } = await import("https");
      const { default: http  } = await import("http");
      const apiUrlObj = new URL(chatApiUrl);
      const postBody  = JSON.stringify({ channelID, payload });
      const result    = await new Promise((resolve, reject) => {
        const mod = apiUrlObj.protocol === "https:" ? https : http;
        const reqOpts = {
          hostname: apiUrlObj.hostname,
          port:     apiUrlObj.port || (apiUrlObj.protocol === "https:" ? 443 : 80),
          path:     apiUrlObj.pathname + apiUrlObj.search,
          method:   "POST",
          headers:  { ...reqHeaders, "Content-Length": Buffer.byteLength(postBody) }
        };
        const r = mod.request(reqOpts, (res) => {
          let buf = "";
          res.on("data", d => { buf += d; });
          res.on("end",  () => {
            try { resolve(JSON.parse(buf)); }
            catch (_) { resolve({ response: buf }); }
          });
        });
        r.on("error", reject);
        r.write(postBody);
        r.end();
      });
      setJsonResp(wo, 200, result);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* ---- GET /api/toolcall?channelID=xxx ---- */
  if (method === "GET" && urlPath === "/api/toolcall") {
    const rawUrl    = String(wo.http?.url ?? "/api/toolcall");
    const urlObj    = new URL(rawUrl, "http://localhost");
    const channelID = String(urlObj.searchParams.get("channelID") || "").trim();
    /* Proxy to the bot API's /toolcall endpoint */
    const chatApiUrl = String(globalApiUrl).trim().replace(/\/api\/?$/, "/toolcall");
    const tcUrl = channelID
      ? chatApiUrl + "?channelID=" + encodeURIComponent(channelID)
      : chatApiUrl;
    try {
      const { default: https } = await import("https");
      const { default: http  } = await import("http");
      const tcUrlObj = new URL(tcUrl);
      const result   = await new Promise((resolve, reject) => {
        const mod = tcUrlObj.protocol === "https:" ? https : http;
        const r = mod.get({
          hostname: tcUrlObj.hostname,
          port:     tcUrlObj.port || (tcUrlObj.protocol === "https:" ? 443 : 80),
          path:     tcUrlObj.pathname + tcUrlObj.search
        }, (res) => {
          let buf = "";
          res.on("data", d => { buf += d; });
          res.on("end",  () => {
            try { resolve(JSON.parse(buf)); }
            catch (_) { resolve({}); }
          });
        });
        r.on("error", reject);
      });
      setJsonResp(wo, 200, result);
    } catch (e) {
      setJsonResp(wo, 500, { error: String(e?.message || e) });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /* Unknown path on this port — let other modules or webpage-output handle it */
  return coreData;
}
