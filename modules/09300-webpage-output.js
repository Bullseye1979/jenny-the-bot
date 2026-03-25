/**************************************************************
/* filename: 09300-webpage-output.js                              *
/* Version 1.0                                                *
/* Purpose:                                                   *
/*  Output jump for flow "webpage": retrieves req/res from    *
/*  registry by requestKey, serves /documents/* with          *
/*  range support, otherwise sends wo.http.response.          *
/*  Treats client disconnect / write-after-end as SOFT.       *
/**************************************************************/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPrefixedLogger } from "../core/logging.js";
/* sharp is optional — if not installed, thumbnail generation is skipped gracefully */
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* sharp not available */ }

const MODULE_NAME = "webpage-output";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


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


function getSafeJoin(root, reqPath) {
  const clean = decodeURIComponent(String(reqPath || "/").split("?")[0].split("#")[0]);
  const normalized = path.normalize(clean.startsWith("/") ? clean : `/${clean}`);
  const resolved = path.normalize(path.join(root, normalized));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}


function getServeFileWithRange(req, res, absPath, stat, cacheControl = "no-store") {
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
        "Cache-Control": cacheControl,
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
        "Cache-Control": cacheControl,
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
        "Cache-Control": cacheControl,
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
      "Cache-Control": cacheControl,
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


const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/* Resolve or generate a thumbnail for srcPath at the given pixel width.
 * Thumbnails are cached to thumbsDir/{filename}.jpg.
 * Regenerates automatically when the source file is newer than the cached thumbnail.
 * Returns { buf: Buffer, mime: string } or null on failure. */
async function getThumb(srcPath, thumbsDir, filename, width) {
  if (!sharp) return null;
  const thumbPath = path.join(thumbsDir, filename + ".jpg");
  try {
    const [srcStat, thumbStat] = await Promise.all([
      fs.promises.stat(srcPath),
      fs.promises.stat(thumbPath).catch(() => null)
    ]);
    if (thumbStat && thumbStat.mtimeMs >= srcStat.mtimeMs) {
      return { buf: await fs.promises.readFile(thumbPath), mime: "image/jpeg" };
    }
  } catch { /* srcPath missing — let sharp fail gracefully below */ }
  try {
    await fs.promises.mkdir(thumbsDir, { recursive: true });
    const buf = await sharp(srcPath)
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    await fs.promises.writeFile(thumbPath, buf);
    return { buf, mime: "image/jpeg" };
  } catch { return null; }
}

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

  const thumbW = parseInt(wo?.http?.query?.w || "0", 10) || 0;

  fs.stat(target, async (err, stat) => {
    if (res.writableEnded) return;
    if (err || !stat.isFile()) {
      return setSendResponse(res, 404, "Not Found");
    }

    try {
      const ctype = getContentType(target);
      const isImage = IMAGE_MIMES.has(ctype);
      const cacheControl = isImage ? "public, max-age=604800, immutable" : "no-store";

      /* Serve thumbnail when ?w=N is requested and file is an image */
      if (thumbW > 0 && isImage) {
        const thumbsDir = path.join(path.dirname(target), "thumbnails", String(thumbW));
        const filename  = path.basename(target);
        const thumb = await getThumb(target, thumbsDir, filename, thumbW);
        if (thumb && !res.writableEnded) {
          res.writeHead(200, {
            "Content-Type": thumb.mime,
            "Content-Length": thumb.buf.length,
            "Cache-Control": cacheControl,
            "X-Content-Type-Options": "nosniff"
          });
          res.end(thumb.buf);
        } else if (!res.writableEnded) {
          setSendResponse(res, 500, "Thumbnail generation failed");
        }
        return;
      }

      wo.http.response = {
        status: 200,
        headers: { "Content-Type": ctype },
        body: null
      };
      return getServeFileWithRange(req, res, target, stat, cacheControl);
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
    /* If the AI pipeline produced a response, forward it as JSON */
    if (typeof wo.response === "string" && wo.response) {
      body = JSON.stringify({ response: wo.response });
    } else {
      body = JSON.stringify({ ok: false, error: "Empty response" });
    }
  }

  log("webpage-output send response", "info", {
    moduleName: MODULE_NAME,
    status,
    hasBody: body != null
  });

  return setSendResponse(res, status, body, headers);
}


export default async function getWebpageOutput(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;
  // Voice requests are handled exclusively by 09320-webpage-voice-output
  if (wo?.isWebpageVoice) return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);

  const req = wo?.http?.req;
  const res = wo?.http?.res;

  if (!req || !res) {
    log("Missing http.req/res on workingObject", "error", { moduleName: MODULE_NAME });
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