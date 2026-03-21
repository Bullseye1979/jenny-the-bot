/****************************************************************************************************************
 * filename: core-add-id.js
 * version: 1.0
 * purpose: Runs before output and appends `id=<wo.channelID>` to all image links that point to servers defined in
 *          config["core-add-id"].servers.
 ****************************************************************************************************************/

const MODULE_NAME = "core-add-id";


function getNowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}


function getStr(v) {
  return v == null ? "" : String(v);
}


function setLog(wo, severity, exitStatus, message, details = {}) {
  try {
    if (!Array.isArray(wo.logging)) wo.logging = [];
    wo.logging.push({
      timestamp: getNowIso(),
      severity: severity || "info",
      module: MODULE_NAME,
      exitStatus: exitStatus || "success",
      message: getStr(message),
      ...(details && typeof details === "object" && Object.keys(details).length
        ? { details }
        : {}),
    });
  } catch {}
}


function getIsLikelyImageUrl(url) {
  const u = getStr(url).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || /\/documents\//.test(u);
}


function getNormalizeHost(input) {
  const raw = getStr(input).trim();
  if (!raw) return null;

  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    const host = getStr(u.hostname).toLowerCase().trim();
    return host || null;
  } catch {
    const noProto = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const hostPart = noProto.split("/")[0].trim().toLowerCase();
    const hostOnly = hostPart.split(":")[0].trim();
    return hostOnly || null;
  }
}


function getAllowedHosts(config) {
  const c = config || {};
  const block = c[MODULE_NAME] || null;
  const v = block?.servers ?? block?.Servers ?? block?.server ?? block?.Server;

  let list = [];
  if (Array.isArray(v)) list = v;
  else if (v && typeof v === "object") list = Object.values(v);

  const hosts = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const h = getNormalizeHost(entry);
      if (h) hosts.push(h);
      continue;
    }

    if (entry && typeof entry === "object") {
      const h = getNormalizeHost(
        entry.host || entry.hostname || entry.baseURL || entry.url
      );
      if (h) hosts.push(h);
    }
  }

  return [...new Set(hosts)];
}


function getWithAddedIdParam(url, idValue, allowedHosts) {
  const original = getStr(url);
  if (!original) return original;
  if (!getIsLikelyImageUrl(original)) return original;

  let u;
  try {
    u = new URL(original);
  } catch {
    return original;
  }

  const host = getStr(u.hostname).toLowerCase();
  if (!host || !Array.isArray(allowedHosts) || !allowedHosts.includes(host)) return original;

  if (u.searchParams.has("id")) return original;
  u.searchParams.set("id", getStr(idValue));

  return u.toString();
}


function getRewriteAllImageLinks(text, idValue, allowedHosts) {
  const s = getStr(text);
  if (!s) return { text: s, changed: 0 };

  let changed = 0;
  let out = s;

  const mdImg = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
  out = out.replace(mdImg, (full, url) => {
    const next = getWithAddedIdParam(url, idValue, allowedHosts);
    if (next !== url) changed++;
    return full.replace(url, next);
  });

  const urlRegex = /(https?:\/\/[^\s<>"'()]+)(?=[\s<>"')]|$)/gi;
  out = out.replace(urlRegex, (url) => {
    const next = getWithAddedIdParam(url, idValue, allowedHosts);
    if (next !== url) changed++;
    return next;
  });

  return { text: out, changed };
}


export default async function getCoreAddId(coreData) {
  const wo = coreData?.workingObject || {};
  const config = coreData?.config || {};

  if (!Array.isArray(wo.logging)) wo.logging = [];

  const response = typeof wo.response === "string" ? wo.response : "";
  if (!response.trim()) return coreData;

  const idValue = getStr(wo?.channelID).trim();
  if (!idValue) {
    setLog(wo, "warn", "skipped", "Missing wo.channelID → cannot append id param.");
    return coreData;
  }

  const allowedHosts = getAllowedHosts(config);
  if (!allowedHosts.length) {
    setLog(wo, "warn", "skipped", `No servers found in config["${MODULE_NAME}"].servers.`);
    return coreData;
  }

  const { text: nextText, changed } = getRewriteAllImageLinks(response, idValue, allowedHosts);
  if (!changed) {
    setLog(wo, "info", "success", "No eligible image links found to patch.", {
      allowedHostsCount: allowedHosts.length,
    });
    return coreData;
  }

  wo.response = nextText;
  wo._imageLinkIdPatched = true;
  wo._imageLinkIdPatchedCount = changed;

  setLog(wo, "info", "success", `Patched ${changed} image link(s) with id param.`, {
    id: idValue,
    allowedHosts,
  });

  return coreData;
}
