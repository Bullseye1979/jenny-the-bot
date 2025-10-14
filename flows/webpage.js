/***************************************************************
/* filename: "webpage.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Minimal HTTP flow serving /documents/* from ./pub  *
/*          and 404 JSON for /api/*                            *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "webpage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/***************************************************************
/* functionSignature: getContentType (filePath)                *
/* Returns a MIME type for a given file path                   *
/***************************************************************/
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".htm":  return "text/html; charset=utf-8";
    case ".css":  return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":  return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg":  return "image/svg+xml";
    case ".png":  return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif":  return "image/gif";
    case ".webp": return "image/webp";
    case ".ico":  return "image/x-icon";
    case ".txt":  return "text/plain; charset=utf-8";
    default:      return "application/octet-stream";
  }
}

/***************************************************************
/* functionSignature: getSendResponse (res, status, body, hdr) *
/* Sends an HTTP response with minimal headers                 *
/***************************************************************/
function getSendResponse(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  if (body && res.req.method !== "HEAD") res.end(body);
  else res.end();
}

/***************************************************************
/* functionSignature: getSafeJoin (root, reqPath)              *
/* Resolves a safe absolute path within a root directory       *
/***************************************************************/
function getSafeJoin(root, reqPath) {
  const clean = decodeURIComponent(String(reqPath || "/").split("?")[0].split("#")[0]);
  const normalized = path.normalize(clean.startsWith("/") ? clean : `/${clean}`);
  const resolved = path.normalize(path.join(root, normalized));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/***************************************************************
/* functionSignature: getWebpageFlow (baseCore, runFlow, make) *
/* Starts a minimal server for /documents/* and /api/* routes  *
/***************************************************************/
export default async function getWebpageFlow(baseCore, runFlow, createRunCore) {
  const cfg = baseCore?.config?.webpage || {};
  const port = Number(cfg.port) || 3000;

  const pubRoot = path.join(__dirname, "..", "pub");
  const documentsRoot = path.join(pubRoot, "documents");

  const server = http.createServer((req, res) => {
    try {
      if (!req?.url) return getSendResponse(res, 400, "Bad Request");
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
        return getSendResponse(res, 405, "Method Not Allowed", { "Allow": "GET, HEAD, POST" });
      }

      const urlPath = String(req.url.split("?")[0].split("#")[0] || "/");

      if (urlPath.startsWith("/documents/")) {
        if (urlPath === "/documents/" || urlPath === "/documents") {
          return getSendResponse(res, 404, "Not Found");
        }
        const target = getSafeJoin(documentsRoot, urlPath.replace("/documents", ""));
        if (!target) return getSendResponse(res, 400, "Bad Request");
        fs.stat(target, (err, stat) => {
          if (err) return getSendResponse(res, 404, "Not Found");
          if (!stat.isFile()) return getSendResponse(res, 404, "Not Found");
          const ctype = getContentType(target);
          res.writeHead(200, {
            "Content-Type": ctype,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          });
          if (req.method === "HEAD") return res.end();
          const stream = fs.createReadStream(target);
          stream.on("error", () => getSendResponse(res, 500, "Internal Server Error"));
          stream.pipe(res);
        });
        return;
      }

      if (urlPath.startsWith("/api/")) {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
          req.on("end", () => {
            getSendResponse(res, 404, JSON.stringify({ ok: false, error: "Endpoint not implemented" }), {
              "Content-Type": "application/json; charset=utf-8"
            });
          });
          return;
        }
        return getSendResponse(res, 404, JSON.stringify({ ok: false, error: "Not Found" }), {
          "Content-Type": "application/json; charset=utf-8"
        });
      }

      return getSendResponse(res, 404, "Not Found");
    } catch {
      console.error(`[${MODULE_NAME}] Internal Server Error`);
      getSendResponse(res, 500, "Internal Server Error");
    }
  });

  server.listen(port, () => {
    console.log(`[${MODULE_NAME}] listening on http://localhost:${port}`);
  });
}
