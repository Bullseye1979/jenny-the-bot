/****************************************************************************************************************
* filename: api.js                                                                                               *
* Version 1.0                                                                                                    *
* Purpose: HTTP API flow starter (guaranteed JSON response) + polling endpoint for current toolcall registry.    *
*          Toolcall endpoint reads the SAME registry key that toolcall.js watches (config.toolcall.registryKey   *
*          or default "status:tool"). Always returns workingObject.botName (or fallback).                        *
****************************************************************************************************************/
/****************************************************************************************************************
*                                                                                                               *
****************************************************************************************************************/

import http from "node:http";
import { getItem } from "../core/registry.js";

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTimeMs = 0;
let lastRandomBytes = new Uint8Array(10).fill(0);

/****************************************************************************************************************
* functionSignature: getStr(value)                                                                               *
* Purpose: Returns a string; empty string for nullish.                                                           *
****************************************************************************************************************/
function getStr(value) {
  return value == null ? "" : String(value);
}

/****************************************************************************************************************
* functionSignature: getBotname(workingObject, baseCore)                                                         *
* Purpose: Resolves the bot name from workingObject.botName (preferred) with stable fallbacks.                   *
****************************************************************************************************************/
function getBotname(workingObject, baseCore) {
  const fromWO = getStr(workingObject?.botName).trim();
  if (fromWO) return fromWO;

  const fromBase = getStr(baseCore?.workingObject?.botName).trim();
  if (fromBase) return fromBase;

  const fromCfg = getStr(baseCore?.config?.botname).trim();
  if (fromCfg) return fromCfg;

  return "Bot";
}

/****************************************************************************************************************
* functionSignature: getToolcallRegistryKey(baseCore, apiCfg)                                                     *
* Purpose: Uses the SAME registryKey resolution as toolcall.js (config["toolcall"] or config.toolcall).          *
****************************************************************************************************************/
function getToolcallRegistryKey(baseCore, apiCfg) {
  const toolcallCfg = baseCore?.config?.toolcall || baseCore?.config?.toolCall || baseCore?.config?.["toolcall"] || {};
  const fromToolcall = getStr(toolcallCfg.registryKey).trim();
  if (fromToolcall) return fromToolcall;

  const fromApi = getStr(apiCfg?.toolcallRegistryKey).trim();
  if (fromApi) return fromApi;

  return "status:tool";
}

/****************************************************************************************************************
* functionSignature: getUlid()                                                                                   *
* Purpose: Creates a monotonic ULID compatible with Discord-style timestamp-first IDs.                           *
****************************************************************************************************************/
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

/****************************************************************************************************************
* functionSignature: getJson(res, status, body)                                                                  *
* Purpose: Sends a JSON response with standard headers and prevents caching.                                     *
****************************************************************************************************************/
function getJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/****************************************************************************************************************
* functionSignature: getReadBody(req, max)                                                                       *
* Purpose: Reads the request body as UTF-8 up to a maximum size (bytes) and returns a string.                    *
****************************************************************************************************************/
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

/****************************************************************************************************************
* functionSignature: getHasToolValue(val)                                                                        *
* Purpose: True if a registry value effectively contains a tool.                                                 *
****************************************************************************************************************/
function getHasToolValue(val) {
  if (!val) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (typeof val === "object") {
    if (typeof val.name === "string" && val.name.trim()) return true;
    if (typeof val.tool === "string" && val.tool.trim()) return true;
  }
  return false;
}

/****************************************************************************************************************
* functionSignature: getToolIdentity(val)                                                                        *
* Purpose: Returns a stable identity string for the tool value.                                                  *
****************************************************************************************************************/
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

/****************************************************************************************************************
* functionSignature: getToolcallSnapshot(registryKey)                                                            *
* Purpose: Reads the registry and returns a snapshot describing the current toolcall.                            *
****************************************************************************************************************/
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

/****************************************************************************************************************
* functionSignature: getApiFlow(baseCore, runFlow, createRunCore)                                                *
* Purpose: Starts the HTTP API endpoint, executes the flow per request, and guarantees JSON response.            *
****************************************************************************************************************/
export default async function getApiFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.api || {};
  const host = String(cfg.host || "0.0.0.0");
  const port = Number(cfg.port || 3400);
  const apiPath = String(cfg.path || "/api");

  const toolcallPath = String(cfg.toolcallPath || "/toolcall");
  const toolcallRegistryKey = getToolcallRegistryKey(baseCore, cfg);

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return getJson(res, 200, { ok: true, botname: getBotname(undefined, baseCore) });
    }

    if (req.method === "GET" && req.url === toolcallPath) {
      try {
        const snapshot = await getToolcallSnapshot(toolcallRegistryKey);
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

    if (!parsedBody?.id || !parsedBody?.payload) {
      return getJson(res, 400, {
        error: "id_and_payload_required",
        botname: getBotname(workingObject, baseCore),
      });
    }

    workingObject.id = String(parsedBody.id);
    workingObject.userId = parsedBody.userId ? String(parsedBody.userId) : "";
    workingObject.payload = String(parsedBody.payload);
    workingObject.channelType = "API";
    workingObject.isDM = false;
    workingObject.guildId = "";
    workingObject.timestamp = new Date().toISOString();
    workingObject.httpAuthorization = String(req.headers?.authorization || "");

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

    return getJson(res, 200, {
      ok: true,
      flow: "api",
      id: workingObject.id,
      turn_id: workingObject.turn_id,
      channelallowed: workingObject.channelallowed,
      response: text && text !== silenceToken ? text : "",
      botname: getBotname(workingObject, baseCore),
    });
  });

  server.listen(port, host);
}
