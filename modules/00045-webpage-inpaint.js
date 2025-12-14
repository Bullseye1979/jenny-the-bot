/****************************************************************************************************************
/* filename: "webpage-inpaint.js"                                                                               *
/* Version 1.1                                                                                                  *
/* Purpose: Redirects eligible image GET requests under /documents to a configurable inpainting host, sends     *
/*          the response immediately, and sets jump so normal modules are skipped while jump-modules run.       *
/****************************************************************************************************************/
import path from "node:path";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "webpage-inpaint";
const LOG_PREFIX = `[${MODULE_NAME}]`;

console.log(LOG_PREFIX, "module loaded");

/****************************************************************************************************************
/* functionSignature: getShouldBypassRedirect (wo, inpaintingHost)                                              *
/* Determines whether redirect should be bypassed based on headers (Accept/Sec-Fetch-Dest), user agent and      *
/* referer including the inpaintingHost.                                                                       *
/****************************************************************************************************************/
function getShouldBypassRedirect(wo, inpaintingHost) {
  const headers = wo?.http?.headers || {};

  const userAgent = String(headers["user-agent"] || headers["User-Agent"] || "").toLowerCase();
  const referer = String(headers["referer"] || headers["Referer"] || "").toLowerCase();
  const accept = String(headers["accept"] || headers["Accept"] || "").toLowerCase();
  const fetchDest = String(headers["sec-fetch-dest"] || headers["Sec-Fetch-Dest"] || "").toLowerCase();

  const isDiscord =
    userAgent.includes("discord") ||
    referer.includes("discord.com") ||
    referer.includes("discordapp") ||
    referer.includes("discordcdn") ||
    referer.includes("discord media proxy");

  const isFromInpainting = inpaintingHost ? referer.includes(String(inpaintingHost).toLowerCase()) : false;

  const acceptsHtml = accept.includes("text/html");
  const acceptsImage = accept.includes("image/");
  const acceptsAny = accept.includes("*/*") || accept.trim() === "";

  const likelyWantsBinaryImage = (acceptsImage || acceptsAny) && !acceptsHtml;

  const browserExplicitImageFetch = fetchDest === "image";

  return isDiscord || isFromInpainting || likelyWantsBinaryImage || browserExplicitImageFetch;
}

/****************************************************************************************************************
/* functionSignature: setSendNow (wo)                                                                           *
/* Sends the prepared HTTP response immediately if available                                                    *
/****************************************************************************************************************/
async function setSendNow(wo) {
  try {
    const requestKey = wo?.http?.requestKey;
    if (!requestKey) return;

    const stored = await getItem(requestKey);
    const res = stored?.res;
    if (!res || res.writableEnded) return;

    const resp = wo.http.response || {};
    const status = resp.status || 200;
    const headers = resp.headers || {};
    const body = resp.body ?? "";

    res.writeHead(status, headers);
    return res.end(body);
  } catch (err) {
    console.error(LOG_PREFIX, "sendNow failed", err);
  }
}

/****************************************************************************************************************
/* functionSignature: getWebpageInpaint (coreData)                                                               *
/* Applies redirect logic for image documents, writes response, and sets jump                                   *
/****************************************************************************************************************/
export default async function getWebpageInpaint(coreData) {
  const wo = coreData?.workingObject || {};

  const cfg = coreData?.config?.["webpage-inpaint"] || {};
  const enabled = cfg.enabled !== false;
  if (!enabled) {
    console.log(LOG_PREFIX, "disabled via config");
    return coreData;
  }

  const inpaintingHost = cfg.inpaintHost;
  if (!inpaintingHost) {
    console.log(LOG_PREFIX, "no inpaintHost configured");
    return coreData;
  }

  if (wo.flow !== "webpage") return coreData;
  if (wo.source && wo.source !== "http") return coreData;
  if (wo.stop) return coreData;

  const http = wo.http || {};
  const method = String(http.method).toUpperCase();
  const urlPath = String(http.path || "/");
  const query = http.query || {};

  if (method !== "GET") return coreData;
  if (!urlPath.startsWith("/documents/")) return coreData;

  const extension = path.extname(urlPath).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension);

  const wantRaw = query.raw === "1";
  const bypass = getShouldBypassRedirect(wo, inpaintingHost);

  if (!isImage || wantRaw || bypass) return coreData;

  const host = http.host || "xbullseyegaming.de";
  const absoluteUrl = `https://${host}${urlPath}`;
  const target = `https://${inpaintingHost}/?src=${encodeURIComponent(absoluteUrl)}`;

  console.log(LOG_PREFIX, "redirecting to", target);

  wo.http.response = {
    status: 303,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: ""
  };

  wo.jump = true;
  if (wo.stop) delete wo.stop;

  await setSendNow(wo);

  return coreData;
}
