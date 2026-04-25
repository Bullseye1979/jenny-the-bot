/************************************************************************************/
/* filename: api.js                                                                  *
/* Version 1.0                                                                       *
/* Purpose: HTTP API flow starter (guaranteed JSON response) + polling endpoint for  *
/*          current toolcall registry. Adds GET context endpoint for UI usage.       *
/************************************************************************************/

import http from "node:http";
import path from "node:path";
import { setGlobalDispatcher, Agent } from "undici";
import { getItem } from "../core/registry.js";
import { getContext } from "../core/context.js";
import { saveFile } from "../core/file.js";
import { getStr } from "../core/utils.js";

// undici defaults headersTimeout and bodyTimeout to 300 s — raise to unlimited
// so long-running orchestrator/specialist HTTP calls are not killed mid-flight.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTimeMs = 0;
let lastRandomBytes = new Uint8Array(10).fill(0);


function getBotname(workingObject, baseCore) {
  const fromWO = getStr(workingObject?.botName).trim();
  if (fromWO) return fromWO;

  const fromBase = getStr(baseCore?.workingObject?.botName).trim();
  if (fromBase) return fromBase;

  const fromCfg = getStr(baseCore?.config?.botname).trim();
  if (fromCfg) return fromCfg;

  return "Bot";
}

function getToolcallRegistryKey(baseCore, apiCfg) {
  const toolcallCfg = baseCore?.config?.toolcall || baseCore?.config?.toolCall || baseCore?.config?.["toolcall"] || {};
  const fromToolcall = getStr(toolcallCfg.registryKey).trim();
  if (fromToolcall) return fromToolcall;

  const fromApi = getStr(apiCfg?.toolcallRegistryKey).trim();
  if (fromApi) return fromApi;

  return "status:tool";
}

function getUlid() {
  const nowMs = Date.now();

  let randomBytes = new Uint8Array(10).map(() => Math.floor(Math.random() * 256));

  if (nowMs === lastTimeMs) {
    for (let i = 9; i >= 0; i--) {
      if (lastRandomBytes[i] === 255) {
        lastRandomBytes[i] = 0;
        continue;
      }
      lastRandomBytes[i]++;
      break;
    }
    randomBytes = lastRandomBytes;
  } else {
    lastTimeMs = nowMs;
    lastRandomBytes = randomBytes;
  }

  let timeBig = BigInt(nowMs);
  let out = "";

  for (let i = 0; i < 10; i++) {
    out = CROCK[Number(timeBig % 32n)] + out;
    timeBig /= 32n;
  }

  let acc = 0;
  let bits = 0;

  for (const b of randomBytes) {
    acc = (acc << 8) | b;
    bits += 8;

    while (bits >= 5) {
      out += CROCK[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  return out.slice(0, 26);
}

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
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

function isBearerValid(req, baseCore) {
  const secret = getApiSecret(baseCore);
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

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      setCorsHeaders(res);
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === "GET" && req.url === "/health") {
      return getJson(res, 200, { ok: true, botname: getBotname(undefined, baseCore) });
    }

    if (req.method === "GET" && (req.url === toolcallPath || req.url.startsWith(toolcallPath + "?"))) {
      if (!isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized", botname: getBotname(undefined, baseCore) });
      }

      try {
        const _tcUrlObj = new URL(req.url, `http://localhost:${port}`);
        const _tcChannelId = String(_tcUrlObj.searchParams.get("channelID") || _tcUrlObj.searchParams.get("channelId") || "").trim();
        const effectiveKey = _tcChannelId
          ? toolcallRegistryKey + ":" + _tcChannelId
          : toolcallRegistryKey;
        const snapshot = await getToolcallSnapshot(effectiveKey);
        return getJson(res, 200, { ...snapshot, botname: getBotname(undefined, baseCore) });
      } catch (e) {
        return getJson(res, 500, {
          ok: false,
          error: "registry_failed",
          reason: e?.message || String(e),
          timestamp: new Date().toISOString(),
          botname: getBotname(undefined, baseCore),
        });
      }
    }

    if (req.method === "GET" && (req.url === contextPath || req.url.startsWith(contextPath + "?"))) {
      if (!isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized", botname: getBotname(undefined, baseCore) });
      }

      try {
        const _ctxUrlObj = new URL(req.url, `http://localhost:${port}`);
        const _ctxChannelId = String(_ctxUrlObj.searchParams.get("channelID") || _ctxUrlObj.searchParams.get("channelId") || "").trim();
        const _ctxLimit = String(_ctxUrlObj.searchParams.get("limit") || "").trim();

        if (!_ctxChannelId) {
          return getJson(res, 400, { ok: false, error: "channelId_required", botname: getBotname(undefined, baseCore) });
        }

        const msgs = await getContextSnapshot(baseCore, _ctxChannelId, _ctxLimit);
        return getJson(res, 200, { ok: true, channelId: _ctxChannelId, count: msgs.length, messages: msgs, botname: getBotname(undefined, baseCore) });
      } catch (e) {
        return getJson(res, 500, {
          ok: false,
          error: "context_failed",
          reason: e?.message || String(e),
          timestamp: new Date().toISOString(),
          botname: getBotname(undefined, baseCore),
        });
      }
    }

    const uploadPath = String(cfg.uploadPath || "/upload");

    if (req.method === "POST" && (req.url === uploadPath || req.url.startsWith(uploadPath + "?"))) {
      if (!isBearerValid(req, baseCore)) {
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
      if (!isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }
      try {
        const _laUrl = new URL(req.url, `http://localhost:${port}`);
        const _laChannelId = String(_laUrl.searchParams.get("channelID") || _laUrl.searchParams.get("channelId") || "").trim();
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
          botname:   getBotname(undefined, baseCore),
        });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "last_assistant_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method !== "POST" || req.url !== apiPath) {
      return getJson(res, 404, { error: "not_found", botname: getBotname(undefined, baseCore) });
    }

    const runCore = createRunCore();
    const workingObject = (runCore.workingObject ||= {});

    workingObject.flow = "api";
    workingObject.turnId = getUlid();
    workingObject.aborted = false;
    req.socket?.on("close", () => { if (!res.writableEnded) workingObject.aborted = true; });

    let parsedBody;
    try {
      parsedBody = JSON.parse(await getReadBody(req));
    } catch {
      return getJson(res, 400, { error: "invalid_json", botname: getBotname(workingObject, baseCore) });
    }

    const requestChannelId = String(parsedBody?.channelId || parsedBody?.channelID || "").trim();
    if (!requestChannelId || !parsedBody?.payload) {
      return getJson(res, 400, {
        error: "channelId_and_payload_required",
        botname: getBotname(workingObject, baseCore),
      });
    }

    workingObject.channelId = requestChannelId;
    workingObject.userId = parsedBody.userId ? String(parsedBody.userId) : "";
    workingObject.payload = String(parsedBody.payload);
    workingObject.channelType = "API";
    workingObject.isDM = false;
    workingObject.guildId = parsedBody.guildId ? String(parsedBody.guildId) : "";
    workingObject.timestamp = new Date().toISOString();
    workingObject.httpAuthorization = String(req.headers?.authorization || "");

    const _apiSubchannel = String(parsedBody.subchannel || "").trim();
    if (_apiSubchannel) workingObject.subchannel = _apiSubchannel;

    if (parsedBody.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;
    if (parsedBody.contextChannelId || parsedBody.contextChannelID) {
      workingObject.contextChannelId = String(parsedBody.contextChannelId || parsedBody.contextChannelID);
    }
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

    try {
      await runFlow("api", runCore);
    } catch {
      if (!res.writableEnded) {
        return getJson(res, 500, { error: "flow_failed", botname: getBotname(workingObject, baseCore) });
      }
      return;
    }

    if (res.writableEnded) return;

    if (workingObject.apiGated === true) {
      return getJson(res, 401, { ok: false, error: "unauthorized", botname: getBotname(workingObject, baseCore) });
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
      botname: getBotname(workingObject, baseCore),
    });
  });

  server.requestTimeout = 0;
  server.headersTimeout  = 0;
  server.listen(port, host);
}
