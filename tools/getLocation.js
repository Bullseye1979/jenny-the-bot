/********************************************************************************
/* filename: "getLocation.js"                                                   *
/* Version 1.0                                                                  *
/* Purpose: Generate Street View image/link, interactive pano, and Google Maps  *
/*          URL (+optional directions text).                                    *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "getLocation";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT_DIR   = path.join(__dirname, "..");
const DOC_DIR    = path.join(ROOT_DIR, "pub", "documents");

/********************************************************************************
/* functionSignature: getStr (value, fallback)                                  *
/* Returns a non-empty string or the provided default                           *
/********************************************************************************/
function getStr(value, fallback) {
  return typeof value === "string" && value.length ? value : fallback;
}

/********************************************************************************
/* functionSignature: getNum (value, fallback)                                  *
/* Returns a finite number or the provided default                              *
/********************************************************************************/
function getNum(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

/********************************************************************************
/* functionSignature: getClamp (n, min, max)                                    *
/* Clamps a number into [min, max]                                              *
/********************************************************************************/
function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}

/********************************************************************************
/* functionSignature: getEnsureAbsoluteUrl (urlPath, cfg)                       *
/* Resolves relative path against PUBLIC_BASE_URL / baseUrl                     *
/********************************************************************************/
function getEnsureAbsoluteUrl(urlPath, cfg) {
  const baseCfg = getStr(cfg?.publicBaseUrl, getStr(cfg?.baseUrl, ""));
  const base = (baseCfg || "").replace(/\/$/, "");
  const normalized = String(urlPath || "").replace(/\\/g, "/");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (base) return `${base}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
  return normalized;
}

/********************************************************************************
/* functionSignature: getPickExtFromContentType (ct)                            *
/* Picks a file extension from a content-type                                   *
/********************************************************************************/
function getPickExtFromContentType(ct) {
  const s = String(ct || "").toLowerCase();
  if (s.includes("image/png")) return ".png";
  if (s.includes("image/jpeg") || s.includes("image/jpg")) return ".jpg";
  if (s.includes("image/webp")) return ".webp";
  if (s.includes("image/gif")) return ".gif";
  return ".png";
}

/********************************************************************************
/* functionSignature: getSafeBaseFromHint (hint)                                *
/* Creates a safe filename base slug                                            *
/********************************************************************************/
function getSafeBaseFromHint(hint) {
  const s = String(hint || "streetview")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return s || "streetview";
}

/********************************************************************************
/* functionSignature: setSaveBufferAsPicture (buffer, nameHint, ct, cfg)        *
/* Saves buffer under /pub/documents and returns public URL                     *
/********************************************************************************/
async function setSaveBufferAsPicture(buffer, nameHint, ct = "image/png", cfg) {
  await fs.mkdir(DOC_DIR, { recursive: true });
  const ext = getPickExtFromContentType(ct);
  const slug = getSafeBaseFromHint(nameHint);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  const filename = `${slug}-${ts}-${rand}${ext}`;
  const filePath = path.join(DOC_DIR, filename);
  await fs.writeFile(filePath, buffer);
  const publicRel = `/documents/${filename}`.replace(/\\/g, "/");
  const publicUrl = getEnsureAbsoluteUrl(publicRel, cfg);
  return { filename, filePath, publicUrl };
}

/********************************************************************************
/* functionSignature: getIsLatLon (input)                                       *
/* Checks if input is a "lat,lng" pair                                          *
/********************************************************************************/
function getIsLatLon(input) {
  return /^\s*-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(String(input || ""));
}

/********************************************************************************
/* functionSignature: getNormalize (s)                                          *
/* Normalizes whitespace and commas                                             *
/********************************************************************************/
function getNormalize(s) {
  return String(s || "").trim().replace(/^[,;]+|[,;]+$/g, "").replace(/\s{2,}/g, " ");
}

/********************************************************************************
/* functionSignature: getTrimLatLng (lat, lng, decimals)                        *
/* Trims lat/lng to fixed decimals                                              *
/********************************************************************************/
function getTrimLatLng(lat, lng, decimals = 5) {
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const la = toNum(lat);
  const ln = toNum(lng);
  if (la === null || ln === null) return null;
  return `${la.toFixed(decimals)},${ln.toFixed(decimals)}`;
}

/********************************************************************************
/* functionSignature: getHttpJson (url, params, timeoutMs)                      *
/* GET with query params and JSON parsing                                       *
/********************************************************************************/
async function getHttpJson(url, params, timeoutMs = 20000) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let res, raw, data;
  try {
    res = await fetch(u.toString(), { signal: controller.signal });
    raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = null; }
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = data?.error_message || res.statusText || "HTTP error";
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  if (data === null) throw new Error("Invalid JSON response");
  return data;
}

/********************************************************************************
/* functionSignature: getHttpBuffer (url, timeoutMs)                            *
/* GET binary buffer with timeout                                               *
/********************************************************************************/
async function getHttpBuffer(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, { signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return { buffer: buf, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}

/********************************************************************************
/* functionSignature: getGeocodeOne (query, apiKey, timeoutMs)                  *
/* Geocodes one query; supports "lat,lng" passthrough                           *
/********************************************************************************/
async function getGeocodeOne(query, apiKey, timeoutMs) {
  const q = getNormalize(query);
  if (!q) return null;
  if (getIsLatLon(q)) {
    const [lat, lng] = q.split(",").map((x) => x.trim());
    const trimmed = getTrimLatLng(lat, lng) || `${lat},${lng}`;
    return { coord: trimmed, address: q, plusCode: null };
  }
  try {
    const data = await getHttpJson("https://maps.googleapis.com/maps/api/geocode/json", { address: q, key: apiKey }, timeoutMs);
    const { status, results } = data || {};
    if (status !== "OK" || !Array.isArray(results) || !results.length) return null;
    const r0 = results[0];
    const lat = r0?.geometry?.location?.lat;
    const lng = r0?.geometry?.location?.lng;
    const trimmed = getTrimLatLng(lat, lng);
    if (!trimmed) return null;
    const plusCode = r0?.plus_code?.global_code || r0?.plus_code?.compound_code || null;
    return { coord: trimmed, address: r0?.formatted_address || q, plusCode };
  } catch {
    return null;
  }
}

/********************************************************************************
/* functionSignature: getBuildMapsURLApi1 ({ points, isRoute })                 *
/* Builds Google Maps URL for route or search                                   *
/********************************************************************************/
function getBuildMapsURLApi1({ points, isRoute }) {
  if (isRoute && Array.isArray(points) && points.length >= 2) {
    const origin = encodeURIComponent(points[0]);
    const destination = encodeURIComponent(points[points.length - 1]);
    const waypoints = points.slice(1, -1);
    const wp = waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : "";
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}&travelmode=driving`;
  }
  const query = encodeURIComponent(points[points.length - 1]);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/********************************************************************************
/* functionSignature: getBuildStreetViewPanoURLFromLatLon (latLon)              *
/* Builds interactive pano URL from coordinates                                 *
/********************************************************************************/
function getBuildStreetViewPanoURLFromLatLon(latLon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLon)}`;
}

/********************************************************************************
/* functionSignature: getBuildStreetViewImageURL (opts)                         *
/* Builds Google Static Street View image URL                                   *
/********************************************************************************/
function getBuildStreetViewImageURL({ latLon, address, size = "640x400", fov = 90, heading, pitch, apiKey }) {
  const params = new URLSearchParams({ size, fov: String(fov), key: apiKey });
  if (latLon) params.set("location", latLon);
  else if (address) params.set("location", address);
  if (heading !== undefined) params.set("heading", String(heading));
  if (pitch !== undefined) params.set("pitch", String(pitch));
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

/********************************************************************************
/* functionSignature: getDirectionsDetail (origin, destination, waypoints, apiKey, timeoutMs) *
/* Fetches driving directions and returns text + end coord                      *
/********************************************************************************/
async function getDirectionsDetail(origin, destination, waypoints = [], apiKey, timeoutMs) {
  try {
    const params = { origin, destination, mode: "driving", key: apiKey };
    if (waypoints.length) params.waypoints = waypoints.join("|");
    const data = await getHttpJson("https://maps.googleapis.com/maps/api/directions/json", params, timeoutMs);
    const { status, routes } = data || {};
    if (status !== "OK" || !routes?.length) return { text: `No directions found. (${status || "UNKNOWN"})`, endCoord: null };
    const r0 = routes[0];
    const steps = r0.legs.flatMap((leg) => leg.steps.map((s) => s.html_instructions));
    const text = steps.map((s, i) => `${i + 1}. ${String(s || "").replace(/<[^>]+>/g, "")}`).join("\n");
    const lastLeg = r0.legs[r0.legs.length - 1];
    const el = lastLeg?.end_location;
    const endCoord = (el && typeof el.lat === "number" && typeof el.lng === "number") ? getTrimLatLng(el.lat, el.lng) : null;
    return { text, endCoord };
  } catch {
    return { text: "No directions found. (Unexpected error)", endCoord: null };
  }
}

/********************************************************************************
/* functionSignature: setDownloadStreetViewToLocal (imageUrl, nameHint, cfg, timeoutMs) *
/* Downloads image and saves to /pub/documents                                  *
/********************************************************************************/
async function setDownloadStreetViewToLocal(imageUrl, nameHint, cfg, timeoutMs) {
  const { buffer, contentType } = await getHttpBuffer(imageUrl, timeoutMs);
  if (!String(contentType).toLowerCase().startsWith("image/")) throw new Error("STREETVIEW_NON_IMAGE");
  const saved = await setSaveBufferAsPicture(buffer, nameHint, contentType || "image/png", cfg);
  return { url: saved.publicUrl, filePath: saved.filePath };
}

/********************************************************************************
/* functionSignature: getInvoke (args, coreData)                                *
/* Tool entrypoint compatible with core tool loader                             *
/********************************************************************************/
async function getInvoke(args, coreData) {
  try {
    const wo = coreData?.workingObject || {};
    const toolCfg = wo?.toolsconfig?.getLocation || {};
    const apiKey = getStr(toolCfg.googleApiKey, null);
    const timeoutMs = getNum(toolCfg.timeoutMs, 20000);

    if (!apiKey) {
      return "[ERROR]: MAPS_CONFIG — Missing GOOGLE_API_KEY (toolsconfig.getLocation.googleApiKey).";
    }

    const isRouteRequested = !!args?.route;
    const inputLocations = Array.isArray(args?.locations) ? args.locations : [];
    const streetSize = getStr(args?.street_size, getStr(toolCfg.street_size, "640x400"));
    const streetFov = getClamp(getNum(args?.street_fov, getNum(toolCfg.street_fov, 90)), 1, 120);
    const streetHeading = Number.isFinite(args?.street_heading) ? Number(args.street_heading) : (Number.isFinite(toolCfg.street_heading) ? Number(toolCfg.street_heading) : undefined);
    const streetPitch = Number.isFinite(args?.street_pitch) ? Number(args.street_pitch) : (Number.isFinite(toolCfg.street_pitch) ? Number(toolCfg.street_pitch) : undefined);

    if (!inputLocations.length) return "[ERROR]: MAPS_INPUT — No locations provided.";

    const normalized = inputLocations.map(getNormalize).filter(Boolean);
    if (!normalized.length) return "[ERROR]: MAPS_INPUT — Locations empty after normalization.";

    const geo = await Promise.all(normalized.map((s) => getGeocodeOne(s, apiKey, timeoutMs)));
    const points = normalized.map((txt, i) => geo[i]?.coord || txt);

    const isRoute = isRouteRequested && points.length >= 2;
    const mapsUrl = getBuildMapsURLApi1({ points, isRoute });

    let directionsText = "";
    let endCoordFromDirections = null;
    if (isRoute) {
      const origin = points[0];
      const destination = points[points.length - 1];
      const waypoints = points.slice(1, -1);
      const dir = await getDirectionsDetail(origin, destination, waypoints, apiKey, timeoutMs);
      directionsText = dir.text;
      endCoordFromDirections = dir.endCoord;
    }

    const destIdx = normalized.length - 1;
    const coordFromGeocode = geo[destIdx]?.coord || null;
    const destAddress = normalized[destIdx];
    const svCoord = coordFromGeocode || endCoordFromDirections || null;

    let interactive = "";
    let imageSrc = "";

    if (svCoord) {
      interactive = getBuildStreetViewPanoURLFromLatLon(svCoord);
      imageSrc = getBuildStreetViewImageURL({ latLon: svCoord, size: streetSize, fov: streetFov, heading: streetHeading, pitch: streetPitch, apiKey });
    } else {
      interactive = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destAddress)}`;
      imageSrc = getBuildStreetViewImageURL({ address: destAddress, size: streetSize, fov: streetFov, heading: streetPitch, pitch: streetPitch, apiKey });
    }

    let imageUrl = "";
    if (imageSrc) {
      try {
        const nameHint = svCoord ? `streetview-${svCoord}` : `streetview-${destAddress}`;
        const saved = await setDownloadStreetViewToLocal(imageSrc, nameHint, toolCfg, Math.max(timeoutMs, 30000));
        imageUrl = saved.url;
      } catch {
        imageUrl = imageSrc;
      }
    }

    const lines = [
      "Streetview Image: " + imageUrl,
      "Interactive Streetview: " + interactive,
      "Google Maps: " + mapsUrl
    ].filter(Boolean);
    let out = lines.join(" \n ");
    if (directionsText) out += `\n\n${directionsText}`;
    return out;
  } catch {
    return "[ERROR]: MAPS_UNEXPECTED — Unexpected error while generating map links.";
  }
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Generate Street View image URL, interactive Street View, and Google Maps URL; optionally driving directions text. No nearest-panorama probing.",
      parameters: {
        type: "object",
        properties: {
          locations: { type: "array", items: { type: "string" }, description: "List of locations or 'lat,lng' pairs. Last entry is destination." },
          route:     { type: "boolean", description: "If true, treat locations as route (origin, optional waypoints, destination)." },
          street_size:    { type: "string",  description: "Static Street View size, e.g., 640x400 (optional)." },
          street_fov:     { type: "integer", minimum: 1, maximum: 120, description: "Field of view in degrees (optional)." },
          street_heading: { type: "number",  description: "Camera heading in degrees (optional)." },
          street_pitch:   { type: "number",  description: "Camera pitch in degrees (optional)." }
        },
        required: ["locations"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
