/****************************************************************************************************************
* filename: "api.js"                                                                                           *
* Version 1.0                                                                                                  *
* Purpose: HTTP API flow starter (guaranteed JSON response).                                                   *
****************************************************************************************************************/

/****************************************************************************************************************
*                                                                                                               *
*****************************************************************************************************************/

import http from "node:http";
import { getPrefixedLogger } from "../core/logging.js";

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTimeMs = 0;
let lastRandomBytes = new Uint8Array(10).fill(0);

/****************************************************************************************************************
* functionSignature: getUlid()                                                                                 *
* Purpose: Creates a monotonic ULID compatible with Discord-style timestamp-first IDs.                         *
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
* functionSignature: getJson(res, status, body)                                                                *
* Purpose: Sends a JSON response with standard headers and prevents caching.                                   *
****************************************************************************************************************/
function getJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/****************************************************************************************************************
* functionSignature: getReadBody(req, max)                                                                     *
* Purpose: Reads the request body as UTF-8 up to a maximum size (bytes) and returns a string.                  *
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
* functionSignature: getApiFlow(baseCore, runFlow, createRunCore)                                              *
* Purpose: Starts the HTTP API endpoint, executes the flow per request, and guarantees JSON response.          *
****************************************************************************************************************/
export default async function getApiFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.api || {};
  const host = String(cfg.host || "0.0.0.0");
  const port = Number(cfg.port || 3400);
  const apiPath = String(cfg.path || "/api");

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return getJson(res, 200, { ok: true });
    }

    if (req.method !== "POST" || req.url !== apiPath) {
      return getJson(res, 404, { error: "not_found" });
    }

    const runCore = createRunCore();
    const workingObject = (runCore.workingObject ||= {});
    const log = getPrefixedLogger(workingObject, import.meta.url);
    void log;

    workingObject.flow = "api";
    workingObject.turn_id = getUlid();

    let parsedBody;
    try {
      parsedBody = JSON.parse(await getReadBody(req));
    } catch {
      return getJson(res, 400, { error: "invalid_json" });
    }

    if (!parsedBody?.id || !parsedBody?.payload) {
      return getJson(res, 400, { error: "id_and_payload_required" });
    }

    workingObject.id = String(parsedBody.id);
    workingObject.userId = parsedBody.userId ? String(parsedBody.userId) : "";
    workingObject.payload = String(parsedBody.payload);
    workingObject.channelType = "API";
    workingObject.isDM = false;
    workingObject.guildId = "";
    workingObject.timestamp = new Date().toISOString();

    try {
      await runFlow("api", runCore);
    } catch {
      if (!res.writableEnded) {
        return getJson(res, 500, { error: "flow_failed" });
      }
      return;
    }

    if (res.writableEnded) return;

    const silenceToken = String(workingObject.ModSilence || "[silence]");
    const text = String(workingObject.Response || "").trim();

    return getJson(res, 200, {
      ok: true,
      flow: "api",
      id: workingObject.id,
      turn_id: workingObject.turn_id,
      channelallowed: workingObject.channelallowed,
      response: text && text !== silenceToken ? text : "",
    });
  });

  server.listen(port, host, () => {
    const c = createRunCore();
    const startupLog = getPrefixedLogger(c.workingObject, import.meta.url);
    void startupLog;
  });
}
