/**************************************************************/
/* filename: "00032-discord-add-files.js"                           */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/







import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-add-files";


function getToString(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try { return String(v); } catch { return ""; }
}


function getIsHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\//.test(s);
}


function getNormalizedFileUrls(wo) {
  const raw = Array.isArray(wo?.fileUrls) ? wo.fileUrls : [];
  const urls = [];
  for (const item of raw) {
    if (!item) continue;
    let candidate = "";
    if (typeof item === "string") {
      candidate = item;
    } else if (typeof item === "object") {
      candidate = item.url || item.href || item.attachment || item.proxy_url || "";
    } else {
      candidate = getToString(item);
    }
    candidate = candidate.trim();
    if (!candidate) continue;
    if (!getIsHttpUrl(candidate)) continue;
    urls.push(candidate);
  }
  const seen = new Set();
  const deduped = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    deduped.push(u);
  }
  return deduped;
}


function getFilesBlock(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  return urls
    .map(u => getToString(u).trim())
    .filter(Boolean)
    .join("\n");
}


function getBasePayload(wo) {
  const p = typeof wo?.payload === "string" ? wo.payload : "";
  const P = (!p && typeof wo?.Payload === "string") ? wo.Payload : "";
  return p || P || "";
}


function setPayload(wo, text) {
  wo.payload = text;
  if (Object.prototype.hasOwnProperty.call(wo, "Payload") || typeof wo.Payload === "string") {
    wo.Payload = text;
  }
}


function getShouldSkipForSource(wo) {
  const src = String(wo?.source ?? wo?.Source ?? "").trim().toLowerCase();
  if (!src) return false;
  if (src === "discord") return false;
  return true;
}


export default async function getCore(coreData) {
  const wo = coreData?.workingObject || coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  if (wo.__filesAppendedToPayload) {
    log("Files already appended to payload in this turn (__filesAppendedToPayload=true).");
    return coreData;
  }
  if (getShouldSkipForSource(wo)) {
    log(`Skipped: source="${String(wo?.source ?? wo?.Source ?? "")}" is not 'discord'.`);
    return coreData;
  }
  const urls = getNormalizedFileUrls(wo);
  if (!urls.length) {
    log("No http/https fileUrls to append; payload unchanged.");
    return coreData;
  }
  const base = getBasePayload(wo);
  const filesBlock = getFilesBlock(urls);
  const sep = base ? "\n\n" : "";
  const combined = base + sep + filesBlock;
  setPayload(wo, combined);
  wo.__filesAppendedToPayload = true;
  log(`Appended ${urls.length} file URL(s) to payload as plain lines.`, "info", {
    urls_preview: urls.slice(0, 5),
    payload_length: combined.length
  });
  return coreData;
}
