/**************************************************************
/* filename: "webpage.js"                                    *
/* Version 1.0                                               *
/* Purpose: HTTP server trigger that captures requests into  *
/*          workingObject.http and starts the configured     *
/*          'webpage' flow without sending a direct response *
/*          (response handled elsewhere).                    *
/**************************************************************/

/**************************************************************
/*                                                          *
/**************************************************************/

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);

/**************************************************************
/* functionSignature: getUlidEncodeTime (ms)                 *
/* Encode a millisecond timestamp to a 10-char base32        *
/**************************************************************/
function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCK[Number(x % 32n)];
    x = x / 32n;
  }
  return out.join("");
}

/**************************************************************
/* functionSignature: getUlidEncodeRandom80ToBase32 (rand)   *
/* Encode 80 random bits into 16 base32 characters           *
/**************************************************************/
function getUlidEncodeRandom80ToBase32(rand) {
  const out = [];
  let acc = 0;
  let bits = 0;
  let i = 0;
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) {
      acc = (acc << 8) | rand[i++];
      bits += 8;
    } else {
      const v = (acc >> (bits - 5)) & 31;
      bits -= 5;
      out.push(CROCK[v]);
    }
  }
  return out.slice(0, 16).join("");
}

/**************************************************************
/* functionSignature: getUlidRandom80 ()                     *
/* Generate 80 bits of randomness as Uint8Array(10)          *
/**************************************************************/
function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

/**************************************************************
/* functionSignature: getNewUlid ()                          *
/* Generate a monotonic 26-character ULID                    *
/**************************************************************/
function getNewUlid() {
  const now = Date.now();
  let rand = getUlidRandom80();
  if (now === __ulid_lastTime) {
    for (let i = 9; i >= 0; i--) {
      if (__ulid_lastRand[i] === 255) {
        __ulid_lastRand[i] = 0;
        continue;
      }
      __ulid_lastRand[i]++;
      break;
    }
    rand = __ulid_lastRand;
  } else {
    __ulid_lastTime = now;
    __ulid_lastRand = rand;
  }
  return getUlidEncodeTime(now) + getUlidEncodeRandom80ToBase32(rand);
}

/**************************************************************
/* functionSignature: setSendResponse (res, status, body,    *
/*                                    headers)               *
/* Send a fallback HTTP response if nothing else responded   *
/**************************************************************/
function setSendResponse(res, status, body = "", headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  if (body && res.req?.method !== "HEAD") res.end(body);
  else res.end();
}

/**************************************************************
/* functionSignature: getReadBody (req, maxBytes)            *
/* Read and return the request body as a UTF-8 string        *
/**************************************************************/
function getReadBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let done = false;
    let size = 0;
    const chunks = [];
    function fail(err) {
      if (done) return;
      done = true;
      reject(err);
      try { req.destroy(); } catch {}
    }
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) return fail(new Error("BODY_TOO_LARGE"));
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (!chunks.length) return resolve("");
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => fail(err));
    req.on("close", () => {
      if (!done && !chunks.length) {
        done = true;
        resolve("");
      }
    });
  });
}

/**************************************************************
/* functionSignature: getNewRequestKey ()                    *
/* Create a unique registry key for storing req/res          *
/**************************************************************/
function getNewRequestKey() {
  return `web:${getNewUlid()}`;
}

/**************************************************************
/* functionSignature: getConfigFlowName (baseCore)           *
/* Read flowName from config["webpage"] with fallback        *
/**************************************************************/
function getConfigFlowName(baseCore) {
  const name = baseCore?.config?.[MODULE_NAME]?.flowName;
  const s = typeof name === "string" ? name.trim() : "";
  return s || MODULE_NAME;
}

/**************************************************************
/* functionSignature: getWebpageFlow (baseCore, runFlow,     *
/*                                    createRunCore)         *
/* Start HTTP server and trigger the configured flow per req *
/**************************************************************/
export default async function getWebpageFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.[MODULE_NAME] || {};
  const flowName = getConfigFlowName(baseCore);
  const port = Number(cfg.port) || 3000;

  const pubRoot = path.join(__dirname, "..", "pub");
  const documentsRoot = path.join(pubRoot, "documents");

  const server = http.createServer(async (req, res) => {
    try {
      if (!req?.url) return setSendResponse(res, 400, "Bad Request");

      const method = String(req.method || "GET").toUpperCase();
      const urlPath = String(req.url.split("?")[0].split("#")[0] || "/");

      const runCore = createRunCore();
      const wo = runCore.workingObject;
      const log = getPrefixedLogger(wo, import.meta.url);

      const requestKey = getNewRequestKey();
      putItem({ req, res }, requestKey);

      const nowIso = new Date().toISOString();

      wo.flow = flowName;
      wo.turn_id = getNewUlid();
      wo.source = "http";
      wo.timestamp = nowIso;

      wo.http = wo.http || {};
      wo.http.requestKey = requestKey;
      wo.http.method = method;
      wo.http.url = req.url;
      wo.http.path = urlPath;
      wo.http.headers = req.headers || {};
      wo.http.remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || null;
      wo.http.host = req.headers?.host || null;
      wo.http.receivedAt = nowIso;

      if (urlPath.startsWith("/api/")) {
        wo.http.kind = "api";
      } else if (urlPath.startsWith("/documents/")) {
        wo.http.kind = "document";
      } else {
        wo.http.kind = "other";
      }

      wo.http.pubRoot = pubRoot;
      wo.http.documentsRoot = documentsRoot;

      try {
        const urlObj = new URL(req.url, `http://localhost:${port}`);
        wo.http.query = Object.fromEntries(urlObj.searchParams.entries());
      } catch {
        wo.http.query = {};
      }

      if (["POST", "PUT", "PATCH"].includes(method)) {
        try {
          const raw = await getReadBody(req, 1e6);
          wo.http.rawBody = raw;
          try {
            const json = raw ? JSON.parse(raw) : null;
            if (json && typeof json === "object") wo.http.json = json;
          } catch {}
        } catch (err) {
          const reason = err?.message || String(err);
          const log2 = getPrefixedLogger(wo, import.meta.url);
          log2("Request body error", "error", { moduleName: MODULE_NAME, reason, path: urlPath });
          if (reason === "BODY_TOO_LARGE") {
            return setSendResponse(
              res,
              413,
              JSON.stringify({ ok: false, error: "Payload Too Large" }),
              { "Content-Type": "application/json; charset=utf-8" }
            );
          }
          return setSendResponse(
            res,
            400,
            JSON.stringify({ ok: false, error: "Invalid request body" }),
            { "Content-Type": "application/json; charset=utf-8" }
          );
        }
      }

      wo.http.response =
        wo.http.response ||
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ ok: false, error: "Not Found" })
        };

      const log3 = getPrefixedLogger(wo, import.meta.url);
      log3("webpage flow trigger", "info", {
        moduleName: MODULE_NAME,
        path: urlPath,
        method,
        kind: wo.http.kind,
        requestKey
      });

      try {
        await runFlow(flowName, runCore);
      } catch (e) {
        const reason = e?.message || String(e);
        const log4 = getPrefixedLogger(wo, import.meta.url);
        log4("webpage flow execution failed", "error", {
          moduleName: MODULE_NAME,
          path: urlPath,
          reason
        });
        if (!res.writableEnded) {
          return setSendResponse(
            res,
            500,
            JSON.stringify({ ok: false, error: "Internal Server Error" }),
            { "Content-Type": "application/json; charset=utf-8" }
          );
        }
      }
    } catch {
      setSendResponse(res, 500, "Internal Server Error");
    }
  });

  server.listen(port, () => {});
}
