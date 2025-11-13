/***************************************************************************************
/* filename: "discord-add-files.js"                                                    *
/* Version 1.0                                                                         *
/* Purpose: Append Discord file URLs from workingObject.fileURLs into workingObject.   *
/*          payload / Payload as plain lines (one URL per line).                       *
/***************************************************************************************/
/***************************************************************************************
/*                                                                                     *
/***************************************************************************************/

const MODULE_NAME = "discord-add-files";

/***************************************************************************************
/* functionSignature: getToString (v)                                                  *
/* Safe string conversion.                                                             *
/***************************************************************************************/
function getToString(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try { return String(v); } catch { return ""; }
}

/***************************************************************************************
/* functionSignature: getIsHttpUrl (s)                                                 *
/* Checks if a string looks like a http(s) URL.                                        *
/***************************************************************************************/
function getIsHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim());
}

/***************************************************************************************
/* functionSignature: getNormalizedFileUrls (wo)                                       *
/* Extracts normalized http/https URLs from workingObject.fileURLs.                    *
/***************************************************************************************/
function getNormalizedFileUrls(wo) {
  const raw = Array.isArray(wo?.fileURLs) ? wo.fileURLs : [];
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

/***************************************************************************************
/* functionSignature: getFilesBlock (urls)                                             *
/* Builds a plain block from an array of URLs, one URL per line.                       *
/***************************************************************************************/
function getFilesBlock(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  return urls
    .map(u => getToString(u).trim())
    .filter(Boolean)
    .join("\n");
}

/***************************************************************************************
/* functionSignature: getBasePayload (wo)                                              *
/* Returns the current payload text, preferring `payload` over `Payload`.              *
/***************************************************************************************/
function getBasePayload(wo) {
  const p = typeof wo?.payload === "string" ? wo.payload : "";
  const P = (!p && typeof wo?.Payload === "string") ? wo.Payload : "";
  return p || P || "";
}

/***************************************************************************************
/* functionSignature: setPayload (wo, text)                                            *
/* Writes payload back to workingObject (syncs payload and Payload).                   *
/***************************************************************************************/
function setPayload(wo, text) {
  wo.payload = text;
  if (Object.prototype.hasOwnProperty.call(wo, "Payload") || typeof wo.Payload === "string") {
    wo.Payload = text;
  }
}

/***************************************************************************************
/* functionSignature: getShouldSkipForSource (wo)                                      *
/* Optional gate: only run for Discord if source is explicitly non-discord.            *
/***************************************************************************************/
function getShouldSkipForSource(wo) {
  const src = String(wo?.source ?? wo?.Source ?? "").trim().toLowerCase();
  if (!src) return false;
  if (src === "discord") return false;
  return true;
}

/***************************************************************************************
/* functionSignature: getCore (coreData)                                               *
/* Main entry: appends file URLs into payload as plain lines if available.             *
/***************************************************************************************/
export default async function getCore(coreData) {
  const wo = coreData?.workingObject || coreData?.working_object || {};
  if (!Array.isArray(wo.logging)) wo.logging = [];
  if (wo.__filesAppendedToPayload) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "Files already appended to payload in this turn (__filesAppendedToPayload=true)."
    });
    return coreData;
  }
  if (getShouldSkipForSource(wo)) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: `Skipped: source="${String(wo?.source ?? wo?.Source ?? "")}" is not 'discord'.`
    });
    return coreData;
  }
  const urls = getNormalizedFileUrls(wo);
  if (!urls.length) {
    wo.logging.push({
      timestamp: new Date().toISOString(),
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "No http/https fileURLs to append; payload unchanged."
    });
    return coreData;
  }
  const base = getBasePayload(wo);
  const filesBlock = getFilesBlock(urls);
  const sep = base ? "\n\n" : "";
  const combined = base + sep + filesBlock;
  setPayload(wo, combined);
  wo.__filesAppendedToPayload = true;
  wo.logging.push({
    timestamp: new Date().toISOString(),
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "success",
    message: `Appended ${urls.length} file URL(s) to payload as plain lines.`,
    details: {
      urls_preview: urls.slice(0, 5),
      payload_length: combined.length
    }
  });
  return coreData;
}
