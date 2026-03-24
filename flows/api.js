/************************************************************************************/
/* filename: api.js                                                                  *
/* Version 1.0                                                                       *
/* Purpose: HTTP API flow starter (guaranteed JSON response) + polling endpoint for  *
/*          current toolcall registry. Adds GET context endpoint for UI usage.       *
/************************************************************************************/

import http from "node:http";
import path from "node:path";
import { getItem } from "../core/registry.js";
import { getContext } from "../core/context.js";
import { saveFile } from "../core/file.js";

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTimeMs = 0;
let lastRandomBytes = new Uint8Array(10).fill(0);


function getStr(value) {
  return value == null ? "" : String(value);
}


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

async function getContextSnapshot(baseCore, channelID, limit) {
  const n = Number(limit);
  const size = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 100;

  const woBase = baseCore?.workingObject || {};

  const wo = {
    ...woBase,
    channelID: String(channelID || ""),
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
        const _tcChannelID = String(_tcUrlObj.searchParams.get("channelID") || "").trim();
        const effectiveKey = _tcChannelID
          ? toolcallRegistryKey + ":" + _tcChannelID
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
        const _ctxChannelID = String(_ctxUrlObj.searchParams.get("channelID") || "").trim();
        const _ctxLimit = String(_ctxUrlObj.searchParams.get("limit") || "").trim();

        if (!_ctxChannelID) {
          return getJson(res, 400, { ok: false, error: "channelID_required", botname: getBotname(undefined, baseCore) });
        }

        const msgs = await getContextSnapshot(baseCore, _ctxChannelID, _ctxLimit);
        return getJson(res, 200, { ok: true, channelID: _ctxChannelID, count: msgs.length, messages: msgs, botname: getBotname(undefined, baseCore) });
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

    if (req.method !== "POST" || req.url !== apiPath) {
      return getJson(res, 404, { error: "not_found", botname: getBotname(undefined, baseCore) });
    }

    const runCore = createRunCore();
    const workingObject = (runCore.workingObject ||= {});

    workingObject.flow = "api";
    workingObject.turn_id = getUlid();

    let parsedBody;
    try {
      parsedBody = JSON.parse(await getReadBody(req));
    } catch {
      return getJson(res, 400, { error: "invalid_json", botname: getBotname(workingObject, baseCore) });
    }

    if (!parsedBody?.channelID || !parsedBody?.payload) {
      return getJson(res, 400, {
        error: "channelID_and_payload_required",
        botname: getBotname(workingObject, baseCore),
      });
    }

    workingObject.channelID = String(parsedBody.channelID);
    workingObject.userId = parsedBody.userId ? String(parsedBody.userId) : "";
    workingObject.payload = String(parsedBody.payload);
    workingObject.channelType = "API";
    workingObject.isDM = false;
    workingObject.guildId = "";
    workingObject.timestamp = new Date().toISOString();
    workingObject.httpAuthorization = String(req.headers?.authorization || "");

    const _apiSubchannel = String(parsedBody.subchannel || "").trim();
    if (_apiSubchannel) workingObject.subchannel = _apiSubchannel;

    if (parsedBody.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;

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
      channelID: workingObject.channelID,
      ..._subchannel && { subchannel: _subchannel },
      turn_id: workingObject.turn_id,
      channelallowed: workingObject.channelallowed,
      response: text && text !== silenceToken ? text : "",
      botname: getBotname(workingObject, baseCore),
    });
  });

  server.listen(port, host);
}