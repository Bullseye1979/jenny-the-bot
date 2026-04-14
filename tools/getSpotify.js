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
  const wo     = getObj(coreData?.workingObject, {});
  const userId = String(wo?.userId || "").trim();
  if (!userId) throw new Error("No userId in working object — cannot resolve Spotify token");
  const db = await getDbPool(coreData);
  const [rows] = await db.query(
    "SELECT access_token, expires_at FROM spotify_tokens WHERE user_id = ?",
    [userId]
  );
  const row = rows?.[0];
  if (!row) throw new Error("No Spotify account connected for this user. Please authenticate at /spotify-auth");
  if (Date.now() > Number(row.expires_at)) throw new Error("Spotify token expired. Please re-authenticate at /spotify-auth");
  return String(row.access_token);
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
  if (res.data?.tracks)    out.results.tracks    = res.data.tracks.items.map(t => ({ uri: t.uri, name: t.name, artists: t.artists?.map(a => a.name), album: t.album?.name, durationMs: t.durationMs, explicit: t.explicit, popularity: t.popularity }));
  if (res.data?.albums)    out.results.albums    = res.data.albums.items.map(a => ({ uri: a.uri, name: a.name, artists: a.artists?.map(x => x.name), releaseDate: a.release_date, totalTracks: a.total_tracks }));
  if (res.data?.artists)   out.results.artists   = res.data.artists.items.map(a => ({ uri: a.uri, name: a.name, genres: a.genres, popularity: a.popularity, followers: a.followers?.total }));
  if (res.data?.playlists) out.results.playlists = res.data.playlists.items.map(p => ({ uri: p.uri, name: p.name, owner: p.owner?.display_name, tracks: p.tracks?.total, public: p.public }));
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
    item:      d.item   ? { uri: d.item.uri, name: d.item.name, artists: d.item.artists?.map(a => a.name), album: d.item.album?.name, durationMs: d.item.durationMs } : null,
    shuffleState:  d.shuffle_state,
    repeatState:   d.repeat_state,
    context:   d.context ? { uri: d.context.uri, type: d.context.type } : null,
  };
}












async function getOperationPlay(token, args) {
  const deviceId    = getStr(args.deviceId, "");
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

  const query = deviceId ? { device_id: deviceId } : {};
  const res = await makeRequest(token, { method: "PUT", path: "/me/player/play", query, body: Object.keys(body).length ? body : undefined });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "play" };
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
  const devices = getArr(res.data?.devices, []).map(d => ({
    id:            d.id,
    name:          d.name,
    type:          d.type,
    isActive:      d.is_active,
    isPrivateSession: d.is_private_session,
    isRestricted:  d.is_restricted,
    volumePercent: d.volume_percent,
  }));
  return { ok: true, operation: "listDevices", devices };
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
    id:     p.id,
    uri:    p.uri,
    name:   p.name,
    owner:  p.owner?.display_name,
    public: p.public,
    tracks: p.tracks?.total,
    description: p.description,
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

  const activeDevice = devices.find(d => d.isActive) || devices[0];
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
    deviceId,
    deviceName: activeDevice.name
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
