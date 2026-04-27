/**************************************************************/
/* filename: "getLocation.js"                                       */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import { saveFile } from "../core/file.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";
import { getStr, getNum } from "../core/utils.js";

const MODULE_NAME = "getLocation";


function getClamp(n, min, max) {
  const x = Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}


function getPickExtFromContentType(ct) {
  const s = String(ct || "").toLowerCase();
  if (s.includes("image/png")) return ".png";
  if (s.includes("image/jpeg") || s.includes("image/jpg")) return ".jpg";
  if (s.includes("image/webp")) return ".webp";
  if (s.includes("image/gif")) return ".gif";
  return ".png";
}


async function setSaveBufferAsPicture(buffer, nameHint, ct = "image/png", cfg, wo) {
  const ext = getPickExtFromContentType(ct);
  const publicBaseUrl = getStr(cfg?.publicBaseUrl, getStr(cfg?.baseUrl, ""));
  const saved = await saveFile(wo, buffer, { prefix: "streetview", ext, publicBaseUrl });
  return { filename: saved.filename, filePath: saved.absPath, publicUrl: saved.url };
}


function getIsLatLon(input) {
  return /^\s*-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(String(input || ""));
}


function getNormalize(s) {
  return String(s || "").trim().replace(/^[,;]+|[,;]+$/g, "").replace(/\s{2,}/g, " ");
}


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


async function getHttpJson(url, params, timeoutMs = 20000) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  });
  const res = await fetchWithTimeout(u.toString(), {}, timeoutMs);
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error_message || res.statusText || "HTTP error";
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  if (data === null) throw new Error("Invalid JSON response");
  return data;
}


async function getHttpBuffer(url, timeoutMs = 30000) {
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return { buffer: buf, contentType: ct };
}


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


function getBuildStreetViewPanoURLFromLatLon(latLon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLon)}`;
}


function getBuildStreetViewImageURL({ latLon, address, size = "640x400", fov = 90, heading, pitch, apiKey }) {
  const params = new URLSearchParams({ size, fov: String(fov), key: apiKey });
  if (latLon) params.set("location", latLon);
  else if (address) params.set("location", address);
  if (heading !== undefined) params.set("heading", String(heading));
  if (pitch !== undefined) params.set("pitch", String(pitch));
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}


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


async function setDownloadStreetViewToLocal(imageUrl, nameHint, cfg, timeoutMs, wo) {
  const { buffer, contentType } = await getHttpBuffer(imageUrl, timeoutMs);
  if (!String(contentType).toLowerCase().startsWith("image/")) throw new Error("STREETVIEW_NON_IMAGE");
  const saved = await setSaveBufferAsPicture(buffer, nameHint, contentType || "image/png", cfg, wo);
  return { url: saved.publicUrl, filePath: saved.filePath };
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  try {
    const wo = coreData?.workingObject || {};
    const toolCfg = wo?.toolsconfig?.getLocation || {};
    const apiKey = await getSecret(wo, getStr(toolCfg.googleApiKey, ""));
    const timeoutMs = getNum(toolCfg.timeoutMs, 20000);

    if (!apiKey) {
      return "[ERROR]: MAPS_CONFIG — Missing Google API key (toolsconfig.getLocation.googleApiKey in secret storage).";
    }

    const isRouteRequested = !!args?.route;
    const inputLocations = Array.isArray(args?.locations) ? args.locations : [];
    const streetSize = getStr(args?.streetSize, getStr(args?.street_size, getStr(toolCfg.streetSize, "640x400")));
    const streetFov = getClamp(getNum(args?.streetFov, getNum(args?.street_fov, getNum(toolCfg.streetFov, 90))), 1, 120);
    const streetHeading = Number.isFinite(args?.streetHeading)
      ? Number(args.streetHeading)
      : (Number.isFinite(args?.street_heading)
        ? Number(args.street_heading)
        : (Number.isFinite(toolCfg.streetHeading) ? Number(toolCfg.streetHeading) : undefined));
    const streetPitch = Number.isFinite(args?.streetPitch)
      ? Number(args.streetPitch)
      : (Number.isFinite(args?.street_pitch)
        ? Number(args.street_pitch)
        : (Number.isFinite(toolCfg.streetPitch) ? Number(toolCfg.streetPitch) : undefined));

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
        const saved = await setDownloadStreetViewToLocal(imageSrc, nameHint, toolCfg, Math.max(timeoutMs, 30000), wo);
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
  invoke: getInvoke
};
