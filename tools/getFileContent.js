









import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME  = "getFileContent";
const MAX_BYTES    = 512 * 1024;
const TIMEOUT_MS   = 30000;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".woff", ".woff2", ".ttf", ".eot",
  ".exe", ".bin", ".dll", ".so"
]);


function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf(".");
    return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
  } catch {
    const dot = String(url).lastIndexOf(".");
    return dot >= 0 ? String(url).slice(dot).toLowerCase() : "";
  }
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const url = String(args?.url || "").trim();

  if (!url) return { ok: false, error: "url is required" };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, error: "url must be an absolute http/https URL" };
  }
  if (/^https?:\/\/(www\.)?(example\.com|placeholder\.com|example\.org|example\.net)(\/|$)/i.test(url)) {
    return { ok: false, error: `Placeholder URL detected ('${url}'). Use the actual file URL from the previous tool result — do not construct or guess URLs.` };
  }

  const ext = getExtension(url);
  if (BINARY_EXTENSIONS.has(ext)) {
    return { ok: false, error: `Binary file type '${ext}' cannot be read as text` };
  }

  try {
    const res = await fetchWithTimeout(url, {}, TIMEOUT_MS);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType.includes("image/") ||
      contentType.includes("video/") ||
      contentType.includes("audio/") ||
      contentType.includes("application/pdf") ||
      contentType.includes("application/zip") ||
      contentType.includes("application/octet-stream")
    ) {
      return { ok: false, error: `Binary content-type '${contentType}' cannot be read as text` };
    }

    const buf = Buffer.from(await res.arrayBuffer());

    if (buf.length > MAX_BYTES) {
      return {
        ok: false,
        error: `File too large (${buf.length} bytes, max ${MAX_BYTES}). Use getLargeFile for large files.`
      };
    }

    const content = buf.toString("utf8");
    return { ok: true, url, bytes: buf.length, content };

  } catch (e) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? `Timed out after ${TIMEOUT_MS}ms` : (e?.message || String(e))
    };
  }
}


export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
