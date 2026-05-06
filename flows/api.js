/************************************************************************************/
/* filename: api.js                                                                  *
/* Version 1.0                                                                       *
/* Purpose: HTTP API flow starter (guaranteed JSON response) + polling endpoint for  *
/*          current toolcall registry. Adds GET context endpoint for UI usage.       *
/************************************************************************************/

import http from "node:http";
import path from "node:path";
import { setGlobalDispatcher, Agent } from "undici";
import { getItem, putItem, deleteItem } from "../core/registry.js";
import { getContext } from "../core/context.js";
import { saveFile } from "../core/file.js";
import { getStr, getNewUlid } from "../core/utils.js";
import { getSecret } from "../core/secrets.js";
import { getParseCookies, getVerifyToken, getSessionCookieName } from "../shared/webpage/session.js";

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));


function getBotName(workingObject, baseCore) {
  const fromWO = getStr(workingObject?.botName).trim();
  if (fromWO) return fromWO;

  const fromBase = getStr(baseCore?.workingObject?.botName).trim();
  if (fromBase) return fromBase;

  return "Bot";
}

function getToolcallRegistryKey(baseCore, apiCfg) {
  const toolcallCfg = baseCore?.config?.toolcall || {};
  const fromToolcall = getStr(toolcallCfg.registryKey).trim();
  if (fromToolcall) return fromToolcall;

  const fromApi = getStr(apiCfg?.toolcallRegistryKey).trim();
  if (fromApi) return fromApi;

  return "status:tool";
}

function getBrowserCode(value) {
  const code = getStr(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{7,63}$/.test(code)) return "";
  return code;
}

function getBrowserRegistryKey(kind, identity) {
  if (!identity?.type || !identity?.value) return "";
  return `browser-${kind}:${identity.type}:${identity.value}`;
}

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-filename");
}

function setCorsCredentialHeaders(req, res) {
  const origin = String(req.headers?.origin || "");
  res.setHeader("access-control-allow-origin", origin || "*");
  if (origin) res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-filename");
}

function getJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  setCorsHeaders(res);
  res.end(JSON.stringify(body));
}

function getJsonCredential(req, res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  setCorsCredentialHeaders(req, res);
  res.end(JSON.stringify(body));
}

function getReadBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;

    req.on("data", (c) => {
      if (aborted) return;

      size += c.length;
      if (size > max) {
        aborted = true;
        reject(new Error("body_too_large"));
        return;
      }

      chunks.push(c);
    });

    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

function getReadBodyBuffer(req, max = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > max) { aborted = true; reject(new Error("body_too_large")); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!aborted) resolve(Buffer.concat(chunks)); });
    req.on("error", (err) => { if (!aborted) reject(err); });
  });
}

function getHasToolValue(val) {
  if (!val) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return true;
    if (typeof val.tool === "string" && val.tool.trim()) return true;
  }
  return false;
}

function getToolIdentity(val) {
  if (!val) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return val.name.trim();
    if (typeof val.tool === "string" && val.tool.trim()) return val.tool.trim();
    try {
      return JSON.stringify(val);
    } catch {
      return "[object tool]";
    }
  }
  return String(val);
}

async function getToolcallSnapshot(registryKey) {
  const val = await getItem(registryKey);
  const hasTool = getHasToolValue(val);
  const identity = hasTool ? getToolIdentity(val) : "";

  return {
    ok: true,
    registryKey,
    hasTool,
    identity,
    value: val ?? null,
    timestamp: new Date().toISOString(),
  };
}

function getApiSecret(baseCore) {
  return String(baseCore?.workingObject?.apiSecret || "").trim();
}

function getMergeChannelIds(...groups) {
  const merged = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const value of group) {
      const id = String(value || "").trim();
      if (!id || merged.includes(id)) continue;
      merged.push(id);
    }
  }
  return merged;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getCloneJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => getCloneJsonValue(item));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      out[key] = getCloneJsonValue(entry);
    }
    return out;
  }
  return value;
}

function applyWorkingObjectPatch(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      applyWorkingObjectPatch(target[key], value);
      continue;
    }
    target[key] = getCloneJsonValue(value);
  }
}

function getBearerToken(req) {
  const auth = String(req.headers?.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

async function isBearerValid(req, baseCore) {
  const alias = getApiSecret(baseCore);
  if (!alias) return true;
  const secret = await getSecret(baseCore?.workingObject, alias);
  if (!secret) return true;
  return getBearerToken(req) === secret;
}

async function getContextSnapshot(baseCore, channelId, limit) {
  const n = Number(limit);
  const size = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 100;

  const woBase = baseCore?.workingObject || {};

  const wo = {
    ...woBase,
    channelId: String(channelId || ""),
    contextSize: size,
    simplifiedContext: true,
    detailedContext: false,
    contextMetaFrames: "off",
  };

  const rows = await getContext(wo);

  const out = [];
  for (const m of Array.isArray(rows) ? rows : []) {
    if (m?.internal_meta === true) continue;
    const role = String(m?.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    out.push({
      role,
      text: String(m?.content ?? ""),
      ts: m?.ts || null,
      channelId: m?.channelId ? String(m.channelId) : undefined,
    });
  }

  return out;
}

export default async function getApiFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.api || {};
  const host = String(cfg.host || "0.0.0.0");
  const port = Number(cfg.port || 3400);
  const apiPath = String(cfg.path || "/api");

  const toolcallPath = String(cfg.toolcallPath || "/toolcall");
  const toolcallRegistryKey = getToolcallRegistryKey(baseCore, cfg);

  const contextPath = String(cfg.contextPath || "/context");
  const browserActionPath = String(cfg.browserActionPath || "/browser-action");
  const browserStatusPath = String(cfg.browserStatusPath || "/browser-status");
  const sessionSecretAlias = String(cfg.sessionSecret || "");

  async function getSessionUser(req) {
    if (!sessionSecretAlias) return null;
    const secret = await getSecret(baseCore?.workingObject, sessionSecretAlias);
    if (!secret) return null;
    const cookies = getParseCookies(req.headers?.cookie);
    const token = String(cookies[getSessionCookieName()] || "");
    if (!token) return null;
    return getVerifyToken(secret, token);
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      setCorsCredentialHeaders(req, res);
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === "GET" && req.url === "/health") {
      return getJson(res, 200, { ok: true, botName: getBotName(undefined, baseCore) });
    }

    if (req.method === "GET" && (req.url === toolcallPath || req.url.startsWith(toolcallPath + "?"))) {
      if (!await isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized", botName: getBotName(undefined, baseCore) });
      }

      try {
        const _tcUrlObj = new URL(req.url, `http://localhost:${port}`);
        const _tcChannelId = String(_tcUrlObj.searchParams.get("channelId") || "").trim();
        const effectiveKey = _tcChannelId
          ? toolcallRegistryKey + ":" + _tcChannelId
          : toolcallRegistryKey;
        const snapshot = await getToolcallSnapshot(effectiveKey);
        return getJson(res, 200, { ...snapshot, botName: getBotName(undefined, baseCore) });
      } catch (e) {
        return getJson(res, 500, {
          ok: false,
          error: "registry_failed",
          reason: e?.message || String(e),
          timestamp: new Date().toISOString(),
          botName: getBotName(undefined, baseCore),
        });
      }
    }

    if (req.method === "GET" && (req.url === contextPath || req.url.startsWith(contextPath + "?"))) {
      if (!await isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized", botName: getBotName(undefined, baseCore) });
      }

      try {
        const _ctxUrlObj = new URL(req.url, `http://localhost:${port}`);
        const _ctxChannelId = String(_ctxUrlObj.searchParams.get("channelId") || "").trim();
        const _ctxLimit = String(_ctxUrlObj.searchParams.get("limit") || "").trim();

        if (!_ctxChannelId) {
          return getJson(res, 400, { ok: false, error: "channelId_required", botName: getBotName(undefined, baseCore) });
        }

        const msgs = await getContextSnapshot(baseCore, _ctxChannelId, _ctxLimit);
        return getJson(res, 200, { ok: true, channelId: _ctxChannelId, count: msgs.length, messages: msgs, botName: getBotName(undefined, baseCore) });
      } catch (e) {
        return getJson(res, 500, {
          ok: false,
          error: "context_failed",
          reason: e?.message || String(e),
          timestamp: new Date().toISOString(),
          botName: getBotName(undefined, baseCore),
        });
      }
    }

    const uploadPath = String(cfg.uploadPath || "/upload");

    if (req.method === "POST" && (req.url === uploadPath || req.url.startsWith(uploadPath + "?"))) {
      if (!await isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      const rawName = String(req.headers["x-filename"] || "upload").replace(/[/\\]/g, "_").trim() || "upload";
      let buf;
      try {
        buf = await getReadBodyBuffer(req, 50 * 1024 * 1024);
      } catch (e) {
        return getJson(res, e?.message === "body_too_large" ? 413 : 400, { ok: false, error: e?.message || "read_failed" });
      }
      try {
        const uploadUrlObj = new URL(req.url, `http://localhost:${port}`);
        const uploadUserId = String(uploadUrlObj.searchParams.get("userId") || "").trim().replace(/[^a-zA-Z0-9_-]/g, "") || "shared";
        const uploadWo = {
          ...baseCore?.workingObject,
          baseUrl: String(cfg.publicBaseUrl || baseCore?.workingObject?.baseUrl || ""),
          userId: uploadUserId
        };
        const { filename, url } = await saveFile(uploadWo, buf, {
          name: path.basename(rawName, path.extname(rawName)),
          ext: path.extname(rawName) || ".bin"
        });
        return getJson(res, 200, { ok: true, filename, url });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "save_failed", reason: e?.message || String(e) });
      }
    }

    const lastAssistantPath = String(cfg.lastAssistantPath || "/context/last-assistant");

    if (req.method === "GET" && (req.url === lastAssistantPath || req.url.startsWith(lastAssistantPath + "?"))) {
      if (!await isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      try {
        const _laUrl = new URL(req.url, `http://localhost:${port}`);
        const _laChannelId = String(_laUrl.searchParams.get("channelId") || "").trim();
        if (!_laChannelId) {
          return getJson(res, 400, { ok: false, error: "channelId_required" });
        }
        const _laMsgs = await getContextSnapshot(baseCore, _laChannelId, 50);
        let _laLast = null;
        for (let i = _laMsgs.length - 1; i >= 0; i--) {
          if (_laMsgs[i].role === "assistant") { _laLast = _laMsgs[i]; break; }
        }
        return getJson(res, 200, {
          ok:        true,
          channelId: _laChannelId,
          message:   _laLast || null,
          botName:   getBotName(undefined, baseCore),
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "last_assistant_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "GET" && (req.url === browserActionPath || req.url.startsWith(browserActionPath + "?"))) {
      try {
        const _baUrl = new URL(req.url, `http://localhost:${port}`);
        const _baSess = await getSessionUser(req);
        const _baCode = getBrowserCode(_baUrl.searchParams.get("browserCode"));
        const _baIdentities = [];
        if (_baSess?.userId) _baIdentities.push({ type: "user", value: _baSess.userId });
        if (_baCode) _baIdentities.push({ type: "code", value: _baCode });
        if (!_baIdentities.length) {
          return getJsonCredential(req, res, 401, { ok: false, error: "not_authenticated" });
        }
        let _baKey = "";
        let _baAction = null;
        for (const _baIdentity of _baIdentities) {
          const _baCandidateKey = getBrowserRegistryKey("action", _baIdentity);
          const _baCandidateAction = getItem(_baCandidateKey);
          if (_baCandidateAction) {
            _baKey = _baCandidateKey;
            _baAction = _baCandidateAction;
            break;
          }
        }
        if (!_baAction) {
          return getJsonCredential(req, res, 200, { ok: true, action: null });
        }
        deleteItem(_baKey);
        if (_baAction.expiresAt && Date.now() > _baAction.expiresAt) {
          return getJsonCredential(req, res, 200, { ok: true, action: null });
        }
        return getJsonCredential(req, res, 200, { ok: true, action: { type: _baAction.type, url: _baAction.url } });
      } catch (e) {
        return getJsonCredential(req, res, 500, { ok: false, error: "browser_action_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "POST" && req.url === browserStatusPath) {
      try {
        const _bsSess = await getSessionUser(req);
        let _bsBody;
        try {
          _bsBody = JSON.parse(await getReadBody(req, 4096));
        } catch {
          return getJsonCredential(req, res, 400, { ok: false, error: "invalid_json" });
        }
        const _bsUrl = String(_bsBody?.url || "").trim();
        const _bsTitle = String(_bsBody?.title || "").trim();
        if (!_bsUrl) {
          return getJsonCredential(req, res, 400, { ok: false, error: "url_required" });
        }
        let _bsParsed;
        try { _bsParsed = new URL(_bsUrl); } catch {
          return getJsonCredential(req, res, 400, { ok: false, error: "invalid_url" });
        }
        if (_bsParsed.protocol !== "https:" && _bsParsed.protocol !== "http:") {
          return getJsonCredential(req, res, 400, { ok: false, error: "invalid_url_scheme" });
        }
        const _bsCode = getBrowserCode(_bsBody?.browserCode);
        const _bsIdentities = [];
        if (_bsSess?.userId) _bsIdentities.push({ type: "user", value: _bsSess.userId });
        if (_bsCode) _bsIdentities.push({ type: "code", value: _bsCode });
        if (!_bsIdentities.length) {
          return getJsonCredential(req, res, 401, { ok: false, error: "not_authenticated" });
        }
        const _bsStatus = { url: _bsUrl, title: _bsTitle, ts: Date.now(), expiresAt: Date.now() + 300_000 };
        for (const _bsIdentity of _bsIdentities) {
          putItem(_bsStatus, getBrowserRegistryKey("status", _bsIdentity));
        }
        return getJsonCredential(req, res, 200, { ok: true });
      } catch (e) {
        return getJsonCredential(req, res, 500, { ok: false, error: "browser_status_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method !== "POST" || req.url !== apiPath) {
      return getJson(res, 404, { error: "not_found", botName: getBotName(undefined, baseCore) });
    }

    const runCore = createRunCore();
    const workingObject = (runCore.workingObject ||= {});

    workingObject.flow = "api";
    workingObject.turnId = getNewUlid();
    workingObject.aborted = false;
    req.socket?.on("close", () => { if (!res.writableEnded) workingObject.aborted = true; });

    let parsedBody;
    try {
      parsedBody = JSON.parse(await getReadBody(req));
    } catch {
      return getJson(res, 400, { error: "invalid_json", botName: getBotName(workingObject, baseCore) });
    }

    const requestChannelId = String(parsedBody?.channelId || "").trim();
    if (!requestChannelId || !parsedBody?.payload) {
      return getJson(res, 400, {
        error: "channelId_and_payload_required",
        botName: getBotName(workingObject, baseCore),
      });
    }

    const _apiSess = await getSessionUser(req).catch(() => null);
    if (_apiSess?.userId) {
      workingObject.webAuth = {
        userId:   String(_apiSess.userId),
        username: String(_apiSess.username || ""),
        role:     String(_apiSess.role || "member")
      };
    }

    workingObject.channelId = requestChannelId;
    workingObject.userId = workingObject.webAuth?.userId || (parsedBody.userId ? String(parsedBody.userId) : "");
    workingObject.payload = String(parsedBody.payload);
    workingObject.channelType = "API";
    workingObject.isDM = false;
    workingObject.guildId = parsedBody.guildId ? String(parsedBody.guildId) : "";
    workingObject.timestamp = new Date().toISOString();
    workingObject.httpAuthorization = String(req.headers?.authorization || "");

    const _apiSubchannel = String(parsedBody.subchannel || "").trim();
    if (_apiSubchannel) workingObject.subchannel = _apiSubchannel;

    if (parsedBody.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;
    if (parsedBody.contextChannelId) workingObject.contextChannelId = String(parsedBody.contextChannelId);
    if (parsedBody.systemPromptAddition) workingObject.systemPromptAddition = String(parsedBody.systemPromptAddition);
    if (parsedBody.workingObjectPatch && typeof parsedBody.workingObjectPatch === "object") {
      applyWorkingObjectPatch(workingObject, parsedBody.workingObjectPatch);
    }

    if (parsedBody.callerChannelId) workingObject.callerChannelId = String(parsedBody.callerChannelId);
    if (workingObject.callerChannelId) {
      workingObject.channelIds = getMergeChannelIds(workingObject.channelIds, [workingObject.callerChannelId]);
    }
    if (Array.isArray(parsedBody.callerChannelIds)) {
      workingObject.callerChannelIds = parsedBody.callerChannelIds.map(c => String(c)).filter(Boolean);
      workingObject.channelIds = getMergeChannelIds(workingObject.channelIds, workingObject.callerChannelIds);
    }
    if (parsedBody.callerTurnId) workingObject.callerTurnId = String(parsedBody.callerTurnId);
    if (parsedBody.agentDepth !== undefined) workingObject.agentDepth = Math.max(0, Number(parsedBody.agentDepth) || 0);
    if (parsedBody.agentType)   workingObject.agentType   = String(parsedBody.agentType);
    if (parsedBody.callerFlow)  workingObject.callerFlow  = String(parsedBody.callerFlow);
    if (parsedBody.toolcallScope) workingObject.toolcallScope = String(parsedBody.toolcallScope);
    if (parsedBody.toolStatusScope) workingObject.toolStatusScope = String(parsedBody.toolStatusScope);
    if (parsedBody.statusScope) workingObject.statusScope = String(parsedBody.statusScope);
    if (parsedBody.toolStatusChannelOverride) workingObject.toolStatusChannelOverride = String(parsedBody.toolStatusChannelOverride);

    try {
      await runFlow("api", runCore);
    } catch {
      if (!res.writableEnded) {
        return getJson(res, 500, { error: "flow_failed", botName: getBotName(workingObject, baseCore) });
      }
      return;
    }

    if (res.writableEnded) return;

    if (workingObject.apiGated === true) {
      return getJson(res, 401, { ok: false, error: "unauthorized", botName: getBotName(workingObject, baseCore) });
    }

    const silenceToken = String(workingObject.modSilence || "[silence]");
    const text = String(workingObject.response || "").trim();

    const _subchannel = String(workingObject.subchannel || "").trim();

    return getJson(res, 200, {
      ok: true,
      flow: "api",
      channelId: workingObject.channelId,
      ..._subchannel && { subchannel: _subchannel },
      turnId: workingObject.turnId,
      channelAllowed: workingObject.channelAllowed,
      response: text && text !== silenceToken ? text : "",
      toolCallLog:       Array.isArray(workingObject.toolCallLog)  ? workingObject.toolCallLog  : undefined,
      primaryImageUrl:   typeof workingObject.primaryImageUrl === "string" && workingObject.primaryImageUrl ? workingObject.primaryImageUrl : undefined,
      botName: getBotName(workingObject, baseCore),
    });
  });

  server.requestTimeout = 0;
  server.headersTimeout  = 0;
  server.listen(port, host);
}
