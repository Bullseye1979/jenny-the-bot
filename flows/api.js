/************************************************************************************/
/* filename: api.js                                                                  *
/* Version 1.0                                                                       *
/* Purpose: HTTP API flow starter (guaranteed JSON response) + polling endpoint for  *
/*          current toolcall registry. Adds GET context endpoint for UI usage.       *
/************************************************************************************/

import http from "node:http";
import path from "node:path";
import { getItem, putItem, listKeys, deleteItem } from "../core/registry.js";
import { getContext } from "../core/context.js";
import { saveFile } from "../core/file.js";
import { logSubagent } from "../core/subagent-logger.js";
import { registerSseConnection, unregisterSseConnection } from "../core/async-sse.js";

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
  const spawnPath   = String(cfg.spawnPath     || "/api/spawn");
  const jobsPath    = String(cfg.jobsPath      || "/api/jobs");
  const sseAsyncPath = String(cfg.sseAsyncPath || "/api/async-results/stream");

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

    if (req.method === "POST" && req.url === spawnPath) {
      let parsedSpawnBody;
      try {
        parsedSpawnBody = JSON.parse(await getReadBody(req));
      } catch {
        return getJson(res, 400, { ok: false, error: "invalid_json" });
      }

      if (!parsedSpawnBody?.channelID || !parsedSpawnBody?.payload) {
        return getJson(res, 400, { ok: false, error: "channelID_and_payload_required" });
      }

      const jobId = getUlid();
      const projectId = parsedSpawnBody.projectId ? String(parsedSpawnBody.projectId) : getUlid();
      const _isResume = !!parsedSpawnBody.projectId;
      const _spawnCallerChannelId = parsedSpawnBody.callerChannelId ? String(parsedSpawnBody.callerChannelId) : String(parsedSpawnBody.channelID);
      const _spawnCallerContextChannelID = parsedSpawnBody.callerContextChannelID ? String(parsedSpawnBody.callerContextChannelID) : "";
      const _spawnCallerFlow = parsedSpawnBody.callerFlow ? String(parsedSpawnBody.callerFlow) : "";
      const _spawnCallerPersona = parsedSpawnBody.callerPersona ? String(parsedSpawnBody.callerPersona) : "";
      const _spawnCallerInstructions = parsedSpawnBody.callerInstructions ? String(parsedSpawnBody.callerInstructions) : "";
      const _spawnToolcallScope = parsedSpawnBody.toolcallScope ? String(parsedSpawnBody.toolcallScope) : "";
      const _spawnCallerTurnId = parsedSpawnBody.callerTurnId ? String(parsedSpawnBody.callerTurnId) : "";
      const _spawnUserId = parsedSpawnBody.userId ? String(parsedSpawnBody.userId) : "";
      const _spawnGuildId = parsedSpawnBody.guildId ? String(parsedSpawnBody.guildId) : "";
      const _spawnAuthorDisplayname = parsedSpawnBody.authorDisplayname ? String(parsedSpawnBody.authorDisplayname) : "";
      const _spawnAgentDepth = Math.max(0, Number(parsedSpawnBody.agentDepth) || 0);
      const _spawnAgentType = parsedSpawnBody.agentType ? String(parsedSpawnBody.agentType) : "";

      logSubagent("info", "spawn", "spawn_received", {
        jobId,
        projectId,
        resume: _isResume,
        agentType:              _spawnAgentType,
        agentDepth:             _spawnAgentDepth,
        subagentChannelID:      String(parsedSpawnBody.channelID),
        callerChannelId:        _spawnCallerChannelId,
        callerContextChannelID: _spawnCallerContextChannelID || null,
        callerFlow:             _spawnCallerFlow || null,
        callerTurnId:           _spawnCallerTurnId || null,
        userId:                 _spawnUserId || null,
        guildId:                _spawnGuildId || null,
        payloadLen:             String(parsedSpawnBody.payload || "").length,
      });

      const _spawnPayload = String(parsedSpawnBody.payload || "").trim();
      const _spawnCallerPayload = parsedSpawnBody.callerPayload ? String(parsedSpawnBody.callerPayload) : null;
      const _spawnJobEntry = {
        status: "running",
        jobId,
        projectId,
        callerChannelId: _spawnCallerChannelId,
        callerContextChannelID: _spawnCallerContextChannelID || null,
        callerFlow: _spawnCallerFlow,
        callerTurnId: _spawnCallerTurnId,
        userId: _spawnUserId,
        guildId: _spawnGuildId,
        agentDepth: _spawnAgentDepth,
        agentType: _spawnAgentType,
        payload: _spawnPayload,
        callerPayload: _spawnCallerPayload,
        authorDisplayname: _spawnAuthorDisplayname,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      };

      await putItem(_spawnJobEntry, "job:" + jobId);
      logSubagent("info", "spawn", "job_registered", { jobId, projectId, agentType: _spawnAgentType });

      await putItem({
        projectId,
        agentType:              _spawnAgentType,
        channelId:              String(parsedSpawnBody.channelID),
        callerChannelId:        _spawnCallerChannelId,
        callerContextChannelID: _spawnCallerContextChannelID || null,
        callerFlow:             _spawnCallerFlow || "discord",
        userId:                 _spawnUserId,
        guildId:                _spawnGuildId,
        authorDisplayname:      _spawnAuthorDisplayname,
        agentDepth:             _spawnAgentDepth,
        createdAt:              new Date().toISOString(),
      }, "project:" + projectId);

      const _spawnCore = createRunCore();
      const _spawnWo = (_spawnCore.workingObject ||= {});

      _spawnWo.flow = "api";
      _spawnWo.turn_id = getUlid();
      _spawnWo.aborted = false;
      _spawnWo.channelID = String(parsedSpawnBody.channelID);
      _spawnWo.userId = _spawnUserId;
      _spawnWo.guildId = _spawnGuildId;
      _spawnWo.payload = String(parsedSpawnBody.payload);
      _spawnWo.channelType = "API";
      _spawnWo.isDM = false;
      _spawnWo.timestamp = new Date().toISOString();
      _spawnWo.httpAuthorization = String(req.headers?.authorization || "");
      _spawnWo.callerChannelId = _spawnCallerChannelId;
      _spawnWo.callerTurnId = _spawnCallerTurnId;
      _spawnWo.agentDepth = _spawnAgentDepth;
      _spawnWo.agentType = _spawnAgentType;
      _spawnWo.contextChannelID = "project-" + projectId;
      if (_spawnCallerFlow) _spawnWo.callerFlow = _spawnCallerFlow;
      if (_spawnCallerPersona) _spawnWo.callerPersona = _spawnCallerPersona;
      if (_spawnCallerInstructions) _spawnWo.callerInstructions = _spawnCallerInstructions;
      if (_spawnToolcallScope) _spawnWo.toolcallScope = _spawnToolcallScope;
      if (parsedSpawnBody.systemPromptAddition) _spawnWo.systemPromptAddition = String(parsedSpawnBody.systemPromptAddition);

      if (Array.isArray(parsedSpawnBody.callerChannelIds)) {
        _spawnWo.callerChannelIds = parsedSpawnBody.callerChannelIds.map(c => String(c)).filter(Boolean);
      }

      const _spawnSubchannel = String(parsedSpawnBody.subchannel || "").trim();
      if (_spawnSubchannel) _spawnWo.subchannel = _spawnSubchannel;

      logSubagent("info", "spawn", "iife_started", { jobId, projectId, agentType: _spawnAgentType, subagentChannelID: String(parsedSpawnBody.channelID) });

      (async () => {
        const _spawnStartMs = Date.now();
        try {
          await runFlow("api", _spawnCore);
          const _spawnResult = String(_spawnWo.response || "").trim();
          const _spawnDurationMs = Date.now() - _spawnStartMs;
          await putItem({ ..._spawnJobEntry, status: "done", result: _spawnResult, primaryImageUrl: _spawnWo.primaryImageUrl || null, finishedAt: new Date().toISOString() }, "job:" + jobId);
          logSubagent("info", "spawn", "job_done", {
            jobId,
            projectId,
            agentType:      _spawnAgentType,
            durationMs:     _spawnDurationMs,
            resultLen:      _spawnResult.length,
            hasPrimaryImage: !!_spawnWo.primaryImageUrl,
          });
        } catch (e) {
          const _spawnDurationMs = Date.now() - _spawnStartMs;
          await putItem({ ..._spawnJobEntry, status: "error", error: e?.message || String(e), finishedAt: new Date().toISOString() }, "job:" + jobId);
          logSubagent("error", "spawn", "job_failed", {
            jobId,
            projectId,
            agentType:  _spawnAgentType,
            durationMs: _spawnDurationMs,
            error:      e?.message || String(e),
          });
        }
      })();

      return getJson(res, 200, { ok: true, jobId, projectId });
    }

    if (req.method === "GET" && (req.url === jobsPath || req.url.startsWith(jobsPath + "?"))) {
      if (!isBearerValid(req, baseCore)) {
        return getJson(res, 401, { ok: false, error: "unauthorized" });
      }

      const _jobsUrlObj = new URL(req.url, `http://localhost:${port}`);
      const _jobsChannelID = String(_jobsUrlObj.searchParams.get("channelID") || "").trim();

      if (!_jobsChannelID) {
        return getJson(res, 400, { ok: false, error: "channelID_required" });
      }

      try {
        const _jobsConsume = _jobsUrlObj.searchParams.get("consume") === "true";
        const _jobKeys = listKeys("job:");
        const _jobList = [];
        const _toDelete = [];
        for (const _jk of _jobKeys) {
          const _job = getItem(_jk);
          if (!_job || _job.callerChannelId !== _jobsChannelID) continue;
          _jobList.push({
            jobId: _job.jobId,
            projectId: _job.projectId,
            status: _job.status,
            callerFlow: _job.callerFlow,
            agentType: _job.agentType,
            startedAt: _job.startedAt,
            finishedAt: _job.finishedAt,
            result: _job.personaResult || _job.result,
            primaryImageUrl: _job.primaryImageUrl || null,
            originalRequest: _job.payload || null,
            authorDisplayname: _job.authorDisplayname || null,
            userId: _job.userId || null,
            error: _job.error,
          });
          if (_jobsConsume && (_job.status === "done" || _job.status === "error")) {
            _toDelete.push(_jk);
          }
        }
        for (const _dk of _toDelete) { try { deleteItem(_dk); } catch {} }
        return getJson(res, 200, { ok: true, channelID: _jobsChannelID, jobs: _jobList });
      } catch (e) {
        return getJson(res, 500, { ok: false, error: "jobs_failed", reason: e?.message || String(e) });
      }
    }

    if (req.method === "GET" && (req.url === sseAsyncPath || req.url.startsWith(sseAsyncPath + "?"))) {
      const _sseUrl = new URL(req.url, `http://localhost:${port}`);
      const _sseChannelID = String(_sseUrl.searchParams.get("channelID") || "").trim();
      if (!_sseChannelID) {
        return getJson(res, 400, { ok: false, error: "channelID_required" });
      }
      setCorsHeaders(res);
      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(": connected\n\n");
      registerSseConnection(_sseChannelID, res);
      const _keepalive = setInterval(() => {
        try { res.write(": keepalive\n\n"); } catch { clearInterval(_keepalive); }
      }, 25000);
      res.on("close", () => {
        clearInterval(_keepalive);
        unregisterSseConnection(_sseChannelID, res);
      });
      return;
    }

    if (req.method !== "POST" || req.url !== apiPath) {
      return getJson(res, 404, { error: "not_found", botname: getBotname(undefined, baseCore) });
    }

    const runCore = createRunCore();
    const workingObject = (runCore.workingObject ||= {});

    workingObject.flow = "api";
    workingObject.turn_id = getUlid();
    workingObject.aborted = false;
    req.socket?.on("close", () => { if (!res.writableEnded) workingObject.aborted = true; });

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
    workingObject.guildId = parsedBody.guildId ? String(parsedBody.guildId) : "";
    workingObject.timestamp = new Date().toISOString();
    workingObject.httpAuthorization = String(req.headers?.authorization || "");

    const _apiSubchannel = String(parsedBody.subchannel || "").trim();
    if (_apiSubchannel) workingObject.subchannel = _apiSubchannel;

    if (parsedBody.doNotWriteToContext === true) workingObject.doNotWriteToContext = true;
    if (parsedBody.contextChannelID) workingObject.contextChannelID = String(parsedBody.contextChannelID);
    if (parsedBody.systemPromptAddition) workingObject.systemPromptAddition = String(parsedBody.systemPromptAddition);

    if (parsedBody.callerChannelId) workingObject.callerChannelId = String(parsedBody.callerChannelId);
    if (Array.isArray(parsedBody.callerChannelIds)) {
      workingObject.callerChannelIds = parsedBody.callerChannelIds.map(c => String(c)).filter(Boolean);
    }
    if (parsedBody.callerTurnId) workingObject.callerTurnId = String(parsedBody.callerTurnId);
    if (parsedBody.agentDepth !== undefined) workingObject.agentDepth = Math.max(0, Number(parsedBody.agentDepth) || 0);
    if (parsedBody.agentType)   workingObject.agentType   = String(parsedBody.agentType);
    if (parsedBody.callerFlow)  workingObject.callerFlow  = String(parsedBody.callerFlow);
    if (parsedBody.callerPersona) workingObject.callerPersona = String(parsedBody.callerPersona);
    if (parsedBody.callerInstructions) workingObject.callerInstructions = String(parsedBody.callerInstructions);
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
      channelID: workingObject.channelID,
      ..._subchannel && { subchannel: _subchannel },
      turn_id: workingObject.turn_id,
      channelallowed: workingObject.channelallowed,
      response: text && text !== silenceToken ? text : "",
      toolCallLog:       Array.isArray(workingObject.toolCallLog)  ? workingObject.toolCallLog  : undefined,
      subagentLog:       Array.isArray(workingObject.subagentLog)  ? workingObject.subagentLog  : undefined,
      primaryImageUrl:   typeof workingObject.primaryImageUrl === "string" && workingObject.primaryImageUrl ? workingObject.primaryImageUrl : undefined,
      botname: getBotname(workingObject, baseCore),
    });
  });

  server.listen(port, host);
}
