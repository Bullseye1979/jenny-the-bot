/**************************************************************
/* filename: "webpage-output.js"                              *
/* Version 1.0                                                *
/* Purpose:                                                   *
/*  Output jump for flow "webpage": retrieves req/res from    *
/*  registry by requestKey, serves /documents/* with          *
/*  range support, otherwise sends wo.http.response.          *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-output";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**************************************************************
/* functionSignature: getContentType (filePath)              *
/* Return an appropriate Content-Type header for a file.     *
/**************************************************************/
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".htm":  return "text/html; charset=utf-8";
    case ".css":  return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":  return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png":  return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif":  return "image/gif";
    case ".webp": return "image/webp";
    case ".svg":  return "image/svg+xml";
    case ".mp4":  return "video/mp4";
    case ".mp3":  return "audio/mpeg";
    case ".wav":  return "audio/wav";
    case ".ogg":  return "audio/ogg";
    case ".pdf":  return "application/pdf";
    default:      return "application/octet-stream";
  }
}

/**************************************************************
/* functionSignature: setSendResponse (res, status, body, headers) *
/* Send an HTTP response with safe defaults and length.       *
/**************************************************************/
function setSendResponse(res, status, body = "", headers = {}) {
  if (!res || res.writableEnded) return;
  const finalHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  };
  if (!("Content-Length" in finalHeaders) && body != null) {
    if (typeof body === "string") {
      finalHeaders["Content-Length"] = Buffer.byteLength(body, "utf8");
    } else if (Buffer.isBuffer(body)) {
      finalHeaders["Content-Length"] = body.length;
    }
  }
  res.writeHead(status, finalHeaders);
  if (res.req?.method === "HEAD") return res.end();
  if (body == null) return res.end();
  if (typeof body === "string" || Buffer.isBuffer(body)) return res.end(body);
  return res.end(String(body));
}

/**************************************************************
/* functionSignature: getSafeJoin (root, reqPath)            *
/* Safely resolve a path within a root directory.            *
/**************************************************************/
function getSafeJoin(root, reqPath) {
  const clean = decodeURIComponent(String(reqPath || "/").split("?")[0].split("#")[0]);
  const normalized = path.normalize(clean.startsWith("/") ? clean : `/${clean}`);
  const resolved = path.normalize(path.join(root, normalized));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/**************************************************************
/* functionSignature: getServeFileWithRange (req, res, absPath, stat) *
/* Serve a file with HEAD and Range support.                  *
/**************************************************************/
function getServeFileWithRange(req, res, absPath, stat) {
  const total = stat.size;
  const ctype = getContentType(absPath);
  const filename = path.basename(absPath);

  if (req.method === "HEAD" && !req.headers.range) {
    if (res.writableEnded) return;
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
    if (res.writableEnded) return;
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
    stream.on("error", () => setSendResponse(res, 500, "Internal Server Error"));
    return stream.pipe(res);
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    if (res.writableEnded) return;
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
    if (res.writableEnded) return;
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    return res.end();
  }

  end = Math.min(end, total - 1);
  const chunkSize = (end - start) + 1;

  if (res.writableEnded) return;
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
  stream.on("error", () => setSendResponse(res, 500, "Internal Server Error"));
  stream.pipe(res);
}

/**************************************************************
/* functionSignature: getHandleStaticDocument (wo, req, res, log) *
/* Serve a static file from documents root with range support. *
/**************************************************************/
function getHandleStaticDocument(wo, req, res, log) {
  const urlPath = String(wo?.http?.path || "/");
  if (urlPath === "/documents" || urlPath === "/documents/") {
    return setSendResponse(res, 404, "Not Found");
  }

  const documentsRoot =
    wo?.http?.documentsRoot ||
    path.join(__dirname, "..", "pub", "documents");

  const rel = urlPath.replace("/documents", "") || "/";
  const target = getSafeJoin(documentsRoot, rel);
  if (!target) {
    log("Invalid documents path (escape attempt?)", "warn", {
      moduleName: MODULE_NAME,
      urlPath
    });
    return setSendResponse(res, 400, "Bad Request");
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      return setSendResponse(res, 404, "Not Found");
    }
    wo.http.response = {
      status: 200,
      headers: { "Content-Type": getContentType(target) },
      body: null
    };
    return getServeFileWithRange(req, res, target, stat);
  });
}

/**************************************************************
/* functionSignature: getHandleHttpResponse (wo, req, res, log) *
/* Send an application response or stream a specified file.   *
/**************************************************************/
function getHandleHttpResponse(wo, req, res, log) {
  const resp = wo?.http?.response || {};
  const status = Number.isFinite(resp.status) ? Number(resp.status) : 200;
  const headers = { ...(resp.headers || {}) };
  let body = resp.body;

  if (resp.filePath) {
    let abs = resp.filePath;
    if (!path.isAbsolute(abs)) {
      abs = path.join(__dirname, "..", "pub", resp.filePath);
    }
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return setSendResponse(res, 404, "Not Found");
      wo.http.response.status = 200;
      return getServeFileWithRange(req, res, abs, stat);
    } catch {
      return setSendResponse(res, 404, "Not Found");
    }
  }

  if (body != null && !Buffer.isBuffer(body) && typeof body !== "string") {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }
    try {
      body = JSON.stringify(body);
    } catch {
      body = String(body);
    }
  } else if (body == null) {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }
    body = JSON.stringify({ ok: false, error: "Empty response" });
  }

  log("webpage-output send response", "info", {
    moduleName: MODULE_NAME,
    status,
    hasBody: body != null
  });

  return setSendResponse(res, status, body, headers);
}

/**************************************************************
/* functionSignature: getWebpageOutput (coreData)            *
/* Main output handler for the "webpage" flow.               *
/**************************************************************/
export default async function getWebpageOutput(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);

  const requestKey = wo?.http?.requestKey;
  if (!requestKey) {
    log("Missing http.requestKey on workingObject", "error", { moduleName: MODULE_NAME });
    return coreData;
  }

  let stored;
  try {
    stored = await getItem(requestKey);
  } catch (e) {
    log("Failed to get req/res from registry", "error", {
      moduleName: MODULE_NAME,
      requestKey,
      error: e?.message || String(e)
    });
    return coreData;
  }

  const req = stored?.req;
  const res = stored?.res;

  if (!req || !res) {
    log("No req/res in registry entry", "error", { moduleName: MODULE_NAME, requestKey });
    return coreData;
  }

  if (res.writableEnded) {
    log("Response already ended; skip webpage-output", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  const urlPath = String(wo?.http?.path || "/");

  try {
    if (urlPath.startsWith("/documents/")) {
      getHandleStaticDocument(wo, req, res, log);
    } else {
      getHandleHttpResponse(wo, req, res, log);
    }
  } catch (e) {
    log("webpage-output failed", "error", {
      moduleName: MODULE_NAME,
      error: e?.message || String(e)
    });
    if (!res.writableEnded) {
      setSendResponse(res, 500, "Internal Server Error");
    }
  }

  return coreData;
}
