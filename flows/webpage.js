/***************************************************************
/* filename: "webpage.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Serve /documents/* from ./pub with correct         *
/*          MIME types + HTTP Range (206) for media.           *
/*          Return JSON 404 for /api/*                         *
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
/* getContentType (filePath)                                   *
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

    // --- video ---
    case ".mp4":
    case ".m4v":  return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov":  return "video/quicktime";
    case ".mkv":  return "video/x-matroska";
    case ".mpg":
    case ".mpeg": return "video/mpeg";

    // --- audio ---
    case ".mp3":  return "audio/mpeg";
    case ".m4a":  return "audio/mp4";
    case ".aac":  return "audio/aac";
    case ".wav":  return "audio/wav";
    case ".ogg":  return "audio/ogg";
    default:      return "application/octet-stream";
  }
}

/***************************************************************
/* getSendResponse (res, status, body, hdr)                    *
/* Sends an HTTP response with minimal headers                 *
/***************************************************************/
function getSendResponse(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  if (body && res.req?.method !== "HEAD") res.end(body);
  else res.end();
}

/***************************************************************
/* getSafeJoin (root, reqPath)                                 *
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
/* serveFileWithRange (req, res, absPath, stat)                *
/* Sends file with proper headers and Range (206) support      *
/***************************************************************/
function serveFileWithRange(req, res, absPath, stat) {
  const total = stat.size;
  const ctype = getContentType(absPath);
  const filename = path.basename(absPath);

  // HEAD without Range -> only headers
  if (req.method === "HEAD" && !req.headers.range) {
    res.writeHead(200, {
      "Content-Type": ctype,
      "Content-Length": total,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return res.end();
  }

  const range = req.headers.range;
  if (!range) {
    // Full content
    res.writeHead(200, {
      "Content-Type": ctype,
      "Content-Length": total,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(absPath);
    stream.on("error", () => getSendResponse(res, 500, "Internal Server Error"));
    return stream.pipe(res);
  }

  // Parse Range header: bytes=start-end
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    // Malformed range
    res.writeHead(416, {
      "Content-Range": `bytes */${total}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return res.end();
  }

  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end   = m[2] ? parseInt(m[2], 10) : total - 1;

  if (isNaN(start) || isNaN(end) || start > end || start >= total) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    return res.end();
  }
  end = Math.min(end, total - 1);
  const chunkSize = (end - start) + 1;

  res.writeHead(206, {
    "Content-Type": ctype,
    "Content-Length": chunkSize,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  if (req.method === "HEAD") return res.end();

  const stream = fs.createReadStream(absPath, { start, end });
  stream.on("error", () => getSendResponse(res, 500, "Internal Server Error"));
  stream.pipe(res);
}

/***************************************************************
/* getWebpageFlow (baseCore, runFlow, createRunCore)           *
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
      if (!["GET", "HEAD", "POST"].includes(req.method)) {
        return getSendResponse(res, 405, "Method Not Allowed", { "Allow": "GET, HEAD, POST" });
      }

      const urlPath = String(req.url.split("?")[0].split("#")[0] || "/");

      // Static media: /documents/*
      if (urlPath.startsWith("/documents/")) {
        if (urlPath === "/documents/" || urlPath === "/documents") {
          return getSendResponse(res, 404, "Not Found");
        }
        const target = getSafeJoin(documentsRoot, urlPath.replace("/documents", ""));
        if (!target) return getSendResponse(res, 400, "Bad Request");

        fs.stat(target, (err, stat) => {
          if (err) return getSendResponse(res, 404, "Not Found");
          if (!stat.isFile()) return getSendResponse(res, 404, "Not Found");

          // Serve with MIME + Range support
          return serveFileWithRange(req, res, target, stat);
        });
        return;
      }

      // Minimal /api/* placeholder
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
    } catch (e) {
      console.error(`[${MODULE_NAME}] Internal Server Error:`, e?.message || e);
      getSendResponse(res, 500, "Internal Server Error");
    }
  });

  server.listen(port, () => {
    console.log(`[${MODULE_NAME}] listening on http://localhost:${port}`);
  });
}
