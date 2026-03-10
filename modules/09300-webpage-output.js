/**************************************************************
/* filename: "webpage-output.js"                              *
/* Version 1.0                                                *
/* Purpose:                                                   *
/*  Output jump for flow "webpage": retrieves req/res from    *
/*  registry by requestKey, serves /documents/* with          *
/*  range support, otherwise sends wo.http.response.          *
/*  Treats client disconnect / write-after-end as SOFT.       *
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

/**************************************************************/
/* functionSignature: getIsSoftHttpWriteError (e)             */
/* Returns true for expected HTTP write errors (client abort) */
/**************************************************************/
function getIsSoftHttpWriteError(e) {
  const code = String(e?.code || "");
  const msg = String(e?.message || "").toLowerCase();

  if (code === "ECONNRESET") return true;
  if (code === "EPIPE") return true;

  if (msg.includes("write after end")) return true;
  if (msg.includes("headers after they are sent")) return true;
  if (msg.includes("cannot set headers after they are sent")) return true;

  return false;
}

/**************************************************************/
/* functionSignature: getContentType (filePath)              */
/* Return an appropriate Content-Type header for a file.     */
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

/**************************************************************/
/* functionSignature: setSendResponse (res, status, body, headers) */
/* Send an HTTP response with safe defaults and length.       */
/**************************************************************/
function setSendResponse(res, status, body = "", headers = {}) {
  if (!res) return;
  if (res.writableEnded) return;
  if (res.headersSent) return;

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

  try {
    res.writeHead(status, finalHeaders);
    if (res.req?.method === "HEAD") return res.end();
    if (body == null) return res.end();
    if (typeof body === "string" || Buffer.isBuffer(body)) return res.end(body);
    return res.end(String(body));
  } catch (e) {
    if (getIsSoftHttpWriteError(e)) return;
    throw e;
  }
}

/**************************************************************/
/* functionSignature: getSafeJoin (root, reqPath)            */
/* Safely resolve a path within a root directory.            */
/**************************************************************/
function getSafeJoin(root, reqPath) {
  const clean = decodeURIComponent(String(reqPath || "/").split("?")[0].split("#")[0]);
  const normalized = path.normalize(clean.startsWith("/") ? clean : `/${clean}`);
  const resolved = path.normalize(path.join(root, normalized));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/**************************************************************/
/* functionSignature: getServeFileWithRange (req, res, absPath, stat) *
/* Serve a file with HEAD and Range support.                  */
/**************************************************************/
function getServeFileWithRange(req, res, absPath, stat) {
  const total = stat.size;
  const ctype = getContentType(absPath);
  const filename = path.basename(absPath);

  const setDestroyOnClose = (stream) => {
    const onClose = () => {
      try { stream?.destroy(); } catch {}
    };
    const onAborted = () => {
      try { stream?.destroy(); } catch {}
    };
    res.once("close", onClose);
    req.once("aborted", onAborted);
  };

  if (req.method === "HEAD" && !req.headers.range) {
    if (!res || res.writableEnded || res.headersSent) return;
    try {
      res.writeHead(200, {
        "Content-Type": ctype,
        "Content-Length": total,
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end();
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      throw e;
    }
  }

  const range = req.headers.range;
  if (!range) {
    if (!res || res.writableEnded || res.headersSent) return;
    try {
      res.writeHead(200, {
        "Content-Type": ctype,
        "Content-Length": total,
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      if (req.method === "HEAD") return res.end();
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      throw e;
    }

    const stream = fs.createReadStream(absPath);
    setDestroyOnClose(stream);

    stream.on("error", (e) => {
      if (getIsSoftHttpWriteError(e)) return;
      setSendResponse(res, 500, "Internal Server Error");
    });

    try {
      return stream.pipe(res);
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      throw e;
    }
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    if (!res || res.writableEnded || res.headersSent) return;
    try {
      res.writeHead(416, {
        "Content-Range": `bytes */${total}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end();
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      throw e;
    }
  }

  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end   = m[2] ? parseInt(m[2], 10) : total - 1;

  if (isNaN(start) || isNaN(end) || start > end || start >= total) {
    if (!res || res.writableEnded || res.headersSent) return;
    try {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      return res.end();
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      throw e;
    }
  }

  end = Math.min(end, total - 1);
  const chunkSize = (end - start) + 1;

  if (!res || res.writableEnded || res.headersSent) return;

  try {
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
  } catch (e) {
    if (getIsSoftHttpWriteError(e)) return;
    throw e;
  }

  const stream = fs.createReadStream(absPath, { start, end });
  setDestroyOnClose(stream);

  stream.on("error", (e) => {
    if (getIsSoftHttpWriteError(e)) return;
    setSendResponse(res, 500, "Internal Server Error");
  });

  try {
    stream.pipe(res);
  } catch (e) {
    if (getIsSoftHttpWriteError(e)) return;
    throw e;
  }
}

/**************************************************************/
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
    if (res.writableEnded) return;
    if (err || !stat.isFile()) {
      return setSendResponse(res, 404, "Not Found");
    }

    try {
      wo.http.response = {
        status: 200,
        headers: { "Content-Type": getContentType(target) },
        body: null
      };
      return getServeFileWithRange(req, res, target, stat);
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
      log("documents serve failed", "error", {
        moduleName: MODULE_NAME,
        error: e?.message || String(e)
      });
      return setSendResponse(res, 500, "Internal Server Error");
    }
  });
}

/**************************************************************/
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
    } catch (e) {
      if (getIsSoftHttpWriteError(e)) return;
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

/**************************************************************/
/* functionSignature: getWebpageOutput (coreData)            */
/* Main output handler for the "webpage" flow.               */
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

  if (req.aborted) {
    log("request aborted; skip webpage-output", "warn", { moduleName: MODULE_NAME });
    return coreData;
  }

  if (res.writableEnded) {
    log("response already ended; skip webpage-output", "warn", { moduleName: MODULE_NAME });
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
    if (getIsSoftHttpWriteError(e)) {
      log("webpage-output soft error (client disconnected)", "warn", {
        moduleName: MODULE_NAME,
        error: e?.message || String(e)
      });
      return coreData;
    }

    log("webpage-output failed", "error", {
      moduleName: MODULE_NAME,
      error: e?.message || String(e)
    });

    if (!res.writableEnded && !res.headersSent) {
      try {
        setSendResponse(res, 500, "Internal Server Error");
      } catch {}
    }
  }

  return coreData;
}