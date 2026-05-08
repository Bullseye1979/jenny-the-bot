/**************************************************************/
/* filename: "getSpotify.js"                                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import { getPrefixedLogger } from "../core/logging.js";
import { getStr, getNum, getObj } from "../core/utils.js";

const MODULE_NAME    = "getSpotify";
const SPOTIFY_BASE   = "https://api.spotify.com/v1";
const DEFAULT_LIMIT  = 20;
const DEFAULT_TIMEOUT_MS = 15000;

let _dbPool = null;


function getBool(v, f = false) {
  return typeof v === "boolean" ? v : f;
}

function getArr(v, f = []) {
  return Array.isArray(v) ? v : f;
}

function getSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getNormalizedDevice(d) {
  return {
    id:               d.id,
    name:             d.name,
    type:             d.type,
    isActive:         d.is_active,
    isPrivateSession: d.is_private_session,
    isRestricted:     d.is_restricted,
    volumePercent:    d.volume_percent,
    supportsVolume:   d.supports_volume,
  };
}

function getControllableDevices(devices) {
  return getArr(devices, []).filter((d) => getStr(d?.id, "") && !getBool(d?.isRestricted, false));
}

function getPreferredControllableDevice(devices, preferredDeviceId = "") {
  const controllable = getControllableDevices(devices);
  const preferredId = getStr(preferredDeviceId, "");
  if (preferredId) {
    const exact = controllable.find((d) => getStr(d.id, "") === preferredId);
    if (exact) return exact;
  }
  return controllable.find((d) => getBool(d.isActive, false)) || controllable[0] || null;
}

function getNoControllableDeviceError(devices) {
  const all = getArr(devices, []);
  if (!all.length) return "No Spotify devices available — open Spotify on a device first";
  const restricted = all.filter((d) => getBool(d.isRestricted, false));
  const missingId  = all.filter((d) => !getStr(d.id, ""));
  if (restricted.length || missingId.length) {
    return "No controllable Spotify devices available — listed devices are restricted or missing device IDs. Spotify's Web API cannot control such devices; this can happen with some Alexa or other speaker integrations.";
  }
  return "No controllable Spotify devices available";
}

function getShouldRetryPlaybackOnTarget(error, status) {
  const msg = String(error || "");
  return status === 404
    || /No active device found/i.test(msg)
    || /Device not found/i.test(msg);
}

function getImages(images) {
  return getArr(images, []).map((img) => ({
    url:    img?.url || "",
    width:  img?.width ?? null,
    height: img?.height ?? null,
  })).filter((img) => img.url);
}

function getPrimaryImageUrl(images) {
  return getImages(images)[0]?.url || "";
}

function getTrackSummary(t) {
  if (!t || typeof t !== "object") return null;
  return {
    uri:          t.uri,
    id:           t.id,
    name:         t.name,
    artists:      getArr(t.artists, []).map((a) => a?.name).filter(Boolean),
    album:        t.album?.name || "",
    albumUri:     t.album?.uri || "",
    durationMs:   t.duration_ms ?? t.durationMs ?? null,
    explicit:     t.explicit,
    popularity:   t.popularity ?? null,
    url:          t.external_urls?.spotify || "",
    spotifyUrl:   t.external_urls?.spotify || "",
    albumCover:   getPrimaryImageUrl(t.album?.images),
    coverUrl:     getPrimaryImageUrl(t.album?.images),
    imageUrl:     getPrimaryImageUrl(t.album?.images),
    albumImages:  getImages(t.album?.images),
  };
}

function getAlbumSummary(a) {
  if (!a || typeof a !== "object") return null;
  return {
    uri:         a.uri,
    id:          a.id,
    name:        a.name,
    artists:     getArr(a.artists, []).map((x) => x?.name).filter(Boolean),
    releaseDate: a.release_date || a.releaseDate || "",
    totalTracks: a.total_tracks ?? a.totalTracks ?? null,
    url:         a.external_urls?.spotify || "",
    spotifyUrl:  a.external_urls?.spotify || "",
    albumCover:  getPrimaryImageUrl(a.images),
    coverUrl:    getPrimaryImageUrl(a.images),
    imageUrl:    getPrimaryImageUrl(a.images),
    albumImages: getImages(a.images),
  };
}

function getPlaylistSummary(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id:          p.id,
    uri:         p.uri,
    name:        p.name,
    owner:       p.owner?.display_name || p.owner || "",
    public:      p.public,
    tracks:      p.tracks?.total ?? p.tracks ?? null,
    description: p.description || "",
    url:         p.external_urls?.spotify || "",
    spotifyUrl:  p.external_urls?.spotify || "",
    image:       getPrimaryImageUrl(p.images),
    imageUrl:    getPrimaryImageUrl(p.images),
    coverUrl:    getPrimaryImageUrl(p.images),
    images:      getImages(p.images),
  };
}


async function getDbPool(coreData) {
  if (_dbPool) return _dbPool;
  const mysql2 = await import("mysql2/promise");
  const db = coreData?.workingObject?.db || {};
  _dbPool = mysql2.default.createPool({
    host:               String(db.host     || "localhost"),
    port:               Number(db.port     || 3306),
    user:               String(db.user     || ""),
    password:           String(db.password || ""),
    database:           String(db.database || ""),
    charset:            String(db.charset  || "utf8mb4"),
    connectionLimit:    3,
    waitForConnections: true,
  });
  return _dbPool;
}


async function getDelegatedToken(coreData) {
  const wo        = getObj(coreData?.workingObject, {});
  const userId    = String(wo?.userId    || "").trim();
  const channelId = String(wo?.channelId || "").trim();
  const db = await getDbPool(coreData);
  if (userId) {
    const [rows] = await db.query(
      "SELECT access_token, expires_at FROM spotify_tokens WHERE user_id = ?",
      [userId]
    );
    const row = rows?.[0];
    if (row) {
      if (Date.now() > Number(row.expires_at)) throw new Error("Spotify token expired. Please re-authenticate at /spotify-auth");
      return String(row.access_token);
    }
  }
  if (channelId) {
    const [rows] = await db.query(
      "SELECT access_token, expires_at FROM spotify_tokens WHERE delegate_channels IS NOT NULL AND JSON_CONTAINS(delegate_channels, JSON_QUOTE(?)) LIMIT 1",
      [channelId]
    );
    const row = rows?.[0];
    if (row) {
      if (Date.now() > Number(row.expires_at)) throw new Error("Spotify delegated token expired. Token owner must re-authenticate at /spotify-auth");
      return String(row.access_token);
    }
  }
  throw new Error("No Spotify account connected for this user. Please authenticate at /spotify-auth");
}


async function makeRequest(token, { method = "GET", path, query = {}, body } = {}) {
  const { default: https } = await import("node:https");

  const url = new URL(`${SPOTIFY_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept:        "application/json",
  };

  let reqBody;
  if (body !== undefined) {
    reqBody = JSON.stringify(body);
    headers["Content-Type"]   = "application/json";
    headers["Content-Length"] = Buffer.byteLength(reqBody);
  }

  return new Promise((resolve) => {
    let settled = false;
    function settle(val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    }

    const timer = setTimeout(() => {
      req.destroy();
      settle({ ok: false, status: 0, data: null, error: "Request timeout" });
    }, DEFAULT_TIMEOUT_MS);

    const req = https.request(
      {
        hostname: url.hostname,
        port:     443,
        path:     url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status === 204) {
            settle({ ok: true, status, data: null, error: null });
            return;
          }
          let data = null;
          try { data = JSON.parse(buf); } catch {}
          if (status === 429) {
            const retryAfter = res.headers["retry-after"] || "unknown";
            settle({ ok: false, status, data, error: `Rate limited by Spotify. Retry after ${retryAfter}s` });
            return;
          }
          if (status >= 400) {
            const msg = data?.error?.message || `HTTP ${status}`;
            settle({ ok: false, status, data, error: msg });
            return;
          }
          settle({ ok: true, status, data, error: null });
        });
      }
    );

    req.on("error", (e) => { settle({ ok: false, status: 0, data: null, error: e?.message || String(e) }); });
    if (reqBody) req.write(reqBody);
    req.end();
  });
}


async function getOperationSearch(token, args) {
  const query  = getStr(args.query, "");
  if (!query) return { ok: false, error: "Missing required argument: query" };

  const types  = getArr(args.types, ["track"]).filter(t => ["track","album","artist","playlist"].includes(t));
  const limit  = Math.min(50, Math.max(1, getNum(args.limit, DEFAULT_LIMIT)));
  const offset = Math.max(0, getNum(args.offset, 0));
  const market = getStr(args.market, "");

  const q = { q: query, type: (types.length ? types : ["track"]).join(","), limit, offset };
  if (market) q.market = market;

  const res = await makeRequest(token, { method: "GET", path: "/search", query: q });
  if (!res.ok) return { ok: false, error: res.error };

  const out = { ok: true, operation: "search", query, types, results: {} };
  if (res.data?.tracks)    out.results.tracks    = res.data.tracks.items.map(getTrackSummary);
  if (res.data?.albums)    out.results.albums    = res.data.albums.items.map(getAlbumSummary);
  if (res.data?.artists)   out.results.artists   = res.data.artists.items.map(a => ({ uri: a.uri, name: a.name, genres: a.genres, popularity: a.popularity, followers: a.followers?.total }));
  if (res.data?.playlists) out.results.playlists = res.data.playlists.items.map(getPlaylistSummary);
  return out;
}


async function getOperationGetPlayback(token) {
  const res = await makeRequest(token, { method: "GET", path: "/me/player" });
  if (!res.ok) return { ok: false, error: res.error };
  if (res.status === 204 || !res.data) return { ok: true, operation: "getPlayback", isPlaying: false, item: null };
  const d = res.data;
  return {
    ok:        true,
    operation: "getPlayback",
    isPlaying: getBool(d.is_playing, false),
    progressMs: getNum(d.progress_ms, 0),
    device:    d.device ? { id: d.device.id, name: d.device.name, type: d.device.type, volumePercent: d.device.volume_percent } : null,
    item:      d.item   ? getTrackSummary(d.item) : null,
    primaryImageUrl: d.item ? (getTrackSummary(d.item)?.imageUrl || "") : "",
    shuffleState:  d.shuffle_state,
    repeatState:   d.repeat_state,
    context:   d.context ? { uri: d.context.uri, type: d.context.type } : null,
  };
}


async function getOperationPlay(token, args) {
  const requestedDeviceId = getStr(args.deviceId, "");
  const uris        = getArr(args.uris, []);
  const contextUri  = getStr(args.contextUri, "");
  const offsetIndex = args.offsetIndex !== undefined ? getNum(args.offsetIndex, 0) : undefined;
  const positionMs  = args.positionMs  !== undefined ? getNum(args.positionMs,  0) : undefined;

  const body = {};
  if (uris.length) {
    body.uris = uris;
  } else if (contextUri) {
    body.context_uri = contextUri;
    if (offsetIndex !== undefined) body.offset = { position: offsetIndex };
  }
  if (positionMs !== undefined) body.position_ms = positionMs;

  let targetDeviceId = requestedDeviceId;
  let activatedDevice = null;
  let transferred = false;

  if (!targetDeviceId && Object.keys(body).length) {
    const ensureRes = await getOperationEnsureActiveDevice(token, {});
    if (!ensureRes.ok) return { ok: false, error: ensureRes.error };
    targetDeviceId = getStr(ensureRes.device?.id, "");
    activatedDevice = ensureRes.device;
    transferred = !!ensureRes.transferred;
  }

  let query = targetDeviceId ? { device_id: targetDeviceId } : {};
  let res = await makeRequest(token, { method: "PUT", path: "/me/player/play", query, body: Object.keys(body).length ? body : undefined });

  if (!res.ok && targetDeviceId && getShouldRetryPlaybackOnTarget(res.error, res.status)) {
    const ensureRes = await getOperationEnsureActiveDevice(token, { deviceId: targetDeviceId });
    if (!ensureRes.ok) return { ok: false, error: ensureRes.error };
    activatedDevice = ensureRes.device;
    transferred = transferred || !!ensureRes.transferred;
    targetDeviceId = getStr(ensureRes.device?.id, targetDeviceId);
    query = targetDeviceId ? { device_id: targetDeviceId } : {};
    res = await makeRequest(token, { method: "PUT", path: "/me/player/play", query, body: Object.keys(body).length ? body : undefined });
  }

  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    operation: "play",
    ...(targetDeviceId ? { deviceId: targetDeviceId } : {}),
    ...(activatedDevice?.name ? { deviceName: activatedDevice.name } : {}),
    ...(transferred ? { activatedDevice: true } : {})
  };
}


async function getOperationPause(token, args) {
  const deviceId = getStr(args.deviceId, "");
  const query    = deviceId ? { device_id: deviceId } : {};
  const res = await makeRequest(token, { method: "PUT", path: "/me/player/pause", query });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "pause" };
}


async function getOperationListDevices(token) {
  const res = await makeRequest(token, { method: "GET", path: "/me/player/devices" });
  if (!res.ok) return { ok: false, error: res.error };
  const devices = getArr(res.data?.devices, []).map(getNormalizedDevice);
  return { ok: true, operation: "listDevices", devices };
}


async function getOperationEnsureActiveDevice(token, args = {}) {
  const preferredDeviceId = getStr(args.deviceId, "");
  const devRes = await getOperationListDevices(token);
  if (!devRes.ok) return { ok: false, error: `Could not list devices: ${devRes.error}` };

  const devices = getArr(devRes.devices, []);
  const target  = getPreferredControllableDevice(devices, preferredDeviceId);
  if (!target) return { ok: false, error: getNoControllableDeviceError(devices) };
  if (getBool(target.isActive, false)) return { ok: true, device: target, transferred: false };

  const transferRes = await getOperationTransferPlayback(token, { deviceId: target.id, play: true });
  if (!transferRes.ok) {
    return {
      ok: false,
      error: `Could not activate device "${target.name}": ${transferRes.error}`,
      device: target
    };
  }
  await getSleep(750);
  return { ok: true, device: target, transferred: true };
}


async function getOperationTransferPlayback(token, args) {
  const deviceId = getStr(args.deviceId, "");
  if (!deviceId) return { ok: false, error: "Missing required argument: deviceId" };
  const play = getBool(args.play, false);
  const res = await makeRequest(token, { method: "PUT", path: "/me/player", body: { device_ids: [deviceId], play } });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "transferPlayback", deviceId, play };
}


async function getOperationGetPlaylists(token, args) {
  const limit  = Math.min(50, Math.max(1, getNum(args.limit, DEFAULT_LIMIT)));
  const offset = Math.max(0, getNum(args.offset, 0));
  const res = await makeRequest(token, { method: "GET", path: "/me/playlists", query: { limit, offset } });
  if (!res.ok) return { ok: false, error: res.error };
  const playlists = getArr(res.data?.items, []).map(p => ({
    ...getPlaylistSummary(p),
  }));
  return { ok: true, operation: "getPlaylists", total: res.data?.total, playlists };
}


async function getOperationCreatePlaylist(token, coreData, args) {
  const name        = getStr(args.name, "");
  if (!name) return { ok: false, error: "Missing required argument: name" };
  const description = getStr(args.description, "");
  const isPublic    = getBool(args.public, false);

  const meRes = await makeRequest(token, { method: "GET", path: "/me" });
  if (!meRes.ok) return { ok: false, error: `Could not fetch user profile: ${meRes.error}` };
  const userId = getStr(meRes.data?.id, "");
  if (!userId) return { ok: false, error: "Could not determine Spotify user ID" };

  const body = { name, public: isPublic };
  if (description) body.description = description;

  const res = await makeRequest(token, { method: "POST", path: `/users/${encodeURIComponent(userId)}/playlists`, body });
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok:        true,
    operation: "createPlaylist",
    id:        res.data?.id,
    uri:       res.data?.uri,
    name:      res.data?.name,
    public:    res.data?.public,
    url:       res.data?.external_urls?.spotify,
    spotifyUrl: res.data?.external_urls?.spotify,
    image:     getPrimaryImageUrl(res.data?.images),
    imageUrl:  getPrimaryImageUrl(res.data?.images),
    coverUrl:  getPrimaryImageUrl(res.data?.images),
    images:    getImages(res.data?.images),
  };
}


async function getOperationAddToPlaylist(token, args) {
  const playlistId = getStr(args.playlistId, "");
  const uris       = getArr(args.uris, []);
  if (!playlistId) return { ok: false, error: "Missing required argument: playlistId" };
  if (!uris.length) return { ok: false, error: "Missing required argument: uris (must be non-empty array)" };

  const body = { uris };
  if (args.position !== undefined) body.position = getNum(args.position, 0);

  const res = await makeRequest(token, { method: "POST", path: `/playlists/${encodeURIComponent(playlistId)}/tracks`, body });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "addToPlaylist", playlistId, added: uris.length, snapshotId: res.data?.snapshot_id };
}


async function getOperationRemoveFromPlaylist(token, args) {
  const playlistId = getStr(args.playlistId, "");
  const uris       = getArr(args.uris, []);
  if (!playlistId) return { ok: false, error: "Missing required argument: playlistId" };
  if (!uris.length) return { ok: false, error: "Missing required argument: uris (must be non-empty array)" };

  const body = { tracks: uris.map(uri => ({ uri })) };
  const snapshotId = getStr(args.snapshotId, "");
  if (snapshotId) body.snapshot_id = snapshotId;

  const res = await makeRequest(token, { method: "DELETE", path: `/playlists/${encodeURIComponent(playlistId)}/tracks`, body });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "removeFromPlaylist", playlistId, removed: uris.length, snapshotId: res.data?.snapshot_id };
}


async function getOperationPlayByName(token, args) {
  const artist = getStr(args.artist, "").trim();
  const track  = getStr(args.track,  "").trim();
  const album  = getStr(args.album,  "").trim();

  if (!track && !album) return { ok: false, error: "Provide at least track or album name" };
  if (track && album)   return { ok: false, error: "Provide either track or album, not both" };

  const isAlbum = !!album;
  const term    = isAlbum ? album : track;
  const query   = artist ? `${term} ${artist}` : term;
  const types   = isAlbum ? ["album"] : ["track"];

  const searchRes = await getOperationSearch(token, { query, types, limit: 5 });
  if (!searchRes.ok) return { ok: false, error: `Search failed: ${searchRes.error}` };

  const items = isAlbum
    ? getArr(searchRes.results?.albums, [])
    : getArr(searchRes.results?.tracks, []);

  if (!items.length) return { ok: false, error: `Nothing found for: ${query}` };

  const best = items[0];
  const uri  = getStr(best.uri, "");
  if (!uri) return { ok: false, error: "Search returned a result without a URI" };

  const devRes = await getOperationListDevices(token);
  if (!devRes.ok) return { ok: false, error: `Could not list devices: ${devRes.error}` };

  const devices = getArr(devRes.devices, []);
  if (!devices.length) return { ok: false, error: "No Spotify devices available — open Spotify on a device first" };

  const activeDevice = getPreferredControllableDevice(devices);
  if (!activeDevice) return { ok: false, error: getNoControllableDeviceError(devices) };
  const deviceId     = getStr(activeDevice.id, "");

  const playArgs = isAlbum
    ? { contextUri: uri, deviceId }
    : { uris: [uri],    deviceId };

  const playRes = await getOperationPlay(token, playArgs);
  if (!playRes.ok) return { ok: false, error: `Playback failed: ${playRes.error}` };

  return {
    ok:         true,
    operation:  "playByName",
    played:     isAlbum ? "album" : "track",
    name:       best.name,
    artists:    best.artists,
    uri,
    url:        best.url || "",
    spotifyUrl: best.spotifyUrl || best.url || "",
    album:      best.album || best.name || "",
    albumUri:   best.albumUri || uri,
    albumCover: best.albumCover || "",
    coverUrl:   best.coverUrl || best.albumCover || "",
    imageUrl:   best.imageUrl || best.albumCover || "",
    primaryImageUrl: best.imageUrl || best.coverUrl || best.albumCover || "",
    albumImages: getArr(best.albumImages, []),
    deviceId,
    deviceName: activeDevice.name,
    result:     best
  };
}


async function getOperationSetVolume(token, args) {
  const volumePercent = Math.round(Math.min(100, Math.max(0, getNum(args.volumePercent, -1))));
  if (volumePercent < 0) return { ok: false, error: "Missing required argument: volumePercent (0–100)" };
  const deviceId = getStr(args.deviceId, "");
  const query = { volume_percent: volumePercent };
  if (deviceId) query.device_id = deviceId;
  const res = await makeRequest(token, { method: "PUT", path: "/me/player/volume", query });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "setVolume", volumePercent };
}


async function getInvokeInternal(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  try {
    const token     = await getDelegatedToken(coreData);
    const operation = getStr(args?.operation, "").trim();

    if (!operation) return { ok: false, error: "Missing operation" };

    switch (operation) {
      case "playByName":         return await getOperationPlayByName(token, args);
      case "search":             return await getOperationSearch(token, args);
      case "getPlayback":        return await getOperationGetPlayback(token);
      case "play":               return await getOperationPlay(token, args);
      case "pause":              return await getOperationPause(token, args);
      case "setVolume":          return await getOperationSetVolume(token, args);
      case "listDevices":        return await getOperationListDevices(token);
      case "transferPlayback":   return await getOperationTransferPlayback(token, args);
      case "getPlaylists":       return await getOperationGetPlaylists(token, args);
      case "createPlaylist":     return await getOperationCreatePlaylist(token, coreData, args);
      case "addToPlaylist":      return await getOperationAddToPlaylist(token, args);
      case "removeFromPlaylist": return await getOperationRemoveFromPlaylist(token, args);
      default:                   return { ok: false, error: `Unknown operation: ${operation}` };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function getInvoke(args, coreData) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ ok: false, error: "getSpotify timed out after 20s" }), 20000);
  });
  const result = await Promise.race([getInvokeInternal(args, coreData), timeout]);
  clearTimeout(timeoutId);
  return result;
}


export default { name: MODULE_NAME, invoke: getInvoke };
