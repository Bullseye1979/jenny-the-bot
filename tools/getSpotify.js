/**********************************************************************************/
/* filename: getSpotify.js                                                        */
/* Version 1.0                                                                    */
/* Purpose: Spotify API tool — search catalog, control playback, manage playlists */
/*          Uses delegated OAuth2 tokens stored per Discord user in spotify_tokens*/
/*          Token is resolved via wo.userId + wo.db at runtime.                  */
/*          Requires Spotify Premium for playback control operations.             */
/*          All operations return { ok, error } instead of throwing.             */
/**********************************************************************************/

const MODULE_NAME    = "getSpotify";
const SPOTIFY_BASE   = "https://api.spotify.com/v1";
const DEFAULT_LIMIT  = 20;
const DEFAULT_TIMEOUT_MS = 15000;

let _dbPool = null;


/**********************************************************************************/
/* Scalar helpers                                                                  */
/**********************************************************************************/
function getStr(v, f = "") {
  return typeof v === "string" && v.length ? v : f;
}

function getNum(v, f = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : f;
}

function getBool(v, f = false) {
  return typeof v === "boolean" ? v : f;
}

function getArr(v, f = []) {
  return Array.isArray(v) ? v : f;
}

function getObj(v, f = {}) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : f;
}


/**********************************************************************************/
/* getDbPool                                                                      */
/* Creates or returns a cached mysql2 connection pool from wo.db config.          */
/**********************************************************************************/
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


/**********************************************************************************/
/* getDelegatedToken                                                               */
/* Reads the Spotify access token for the current Discord user from spotify_tokens*/
/**********************************************************************************/
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


/**********************************************************************************/
/* makeRequest                                                                     */
/* Performs an authenticated HTTP request to the Spotify Web API.                 */
/* Returns { ok, status, data, error }.                                           */
/**********************************************************************************/
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
    const timer = setTimeout(() => resolve({ ok: false, status: 0, data: null, error: "Request timeout" }), DEFAULT_TIMEOUT_MS);

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
          clearTimeout(timer);
          const status = res.statusCode || 0;
          if (status === 204) {
            resolve({ ok: true, status, data: null, error: null });
            return;
          }
          let data = null;
          try { data = JSON.parse(buf); } catch {}
          if (status === 429) {
            const retryAfter = res.headers["retry-after"] || "unknown";
            resolve({ ok: false, status, data, error: `Rate limited by Spotify. Retry after ${retryAfter}s` });
            return;
          }
          if (status >= 400) {
            const msg = data?.error?.message || `HTTP ${status}`;
            resolve({ ok: false, status, data, error: msg });
            return;
          }
          resolve({ ok: true, status, data, error: null });
        });
      }
    );

    req.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, status: 0, data: null, error: e?.message || String(e) }); });
    if (reqBody) req.write(reqBody);
    req.end();
  });
}


/**********************************************************************************/
/* getOperationSearch                                                              */
/* Searches the Spotify catalog for tracks, albums, artists, or playlists.       */
/* args.query    — search string (required)                                       */
/* args.types    — array of types: track, album, artist, playlist (default: track)*/
/* args.limit    — max results per type (1–50, default: 20)                      */
/* args.offset   — pagination offset (default: 0)                                */
/* args.market   — ISO 3166-1 alpha-2 market code (optional)                     */
/**********************************************************************************/
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
  if (res.data?.tracks)    out.results.tracks    = res.data.tracks.items.map(t => ({ uri: t.uri, name: t.name, artists: t.artists?.map(a => a.name), album: t.album?.name, durationMs: t.duration_ms, explicit: t.explicit, popularity: t.popularity }));
  if (res.data?.albums)    out.results.albums    = res.data.albums.items.map(a => ({ uri: a.uri, name: a.name, artists: a.artists?.map(x => x.name), releaseDate: a.release_date, totalTracks: a.total_tracks }));
  if (res.data?.artists)   out.results.artists   = res.data.artists.items.map(a => ({ uri: a.uri, name: a.name, genres: a.genres, popularity: a.popularity, followers: a.followers?.total }));
  if (res.data?.playlists) out.results.playlists = res.data.playlists.items.map(p => ({ uri: p.uri, name: p.name, owner: p.owner?.display_name, tracks: p.tracks?.total, public: p.public }));
  return out;
}


/**********************************************************************************/
/* getOperationGetPlayback                                                         */
/* Returns the current playback state for the user.                               */
/**********************************************************************************/
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
    item:      d.item   ? { uri: d.item.uri, name: d.item.name, artists: d.item.artists?.map(a => a.name), album: d.item.album?.name, durationMs: d.item.duration_ms } : null,
    shuffleState:  d.shuffle_state,
    repeatState:   d.repeat_state,
    context:   d.context ? { uri: d.context.uri, type: d.context.type } : null,
  };
}


/**********************************************************************************/
/* getOperationPlay                                                                */
/* Starts or resumes playback.                                                    */
/* args.uris        — array of Spotify track URIs to play (optional)             */
/* args.contextUri  — album/playlist/artist URI to play (optional)               */
/* args.deviceId    — device ID to start playback on (optional)                  */
/* args.offsetIndex — track index within context to start at (optional)          */
/* args.positionMs  — seek position in ms (optional)                             */
/* If neither uris nor contextUri is provided, resumes current playback.          */
/**********************************************************************************/
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


/**********************************************************************************/
/* getOperationPause                                                               */
/* Pauses playback.                                                               */
/* args.deviceId — device ID to pause (optional, defaults to active device)      */
/**********************************************************************************/
async function getOperationPause(token, args) {
  const deviceId = getStr(args.deviceId, "");
  const query    = deviceId ? { device_id: deviceId } : {};
  const res = await makeRequest(token, { method: "PUT", path: "/me/player/pause", query });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "pause" };
}


/**********************************************************************************/
/* getOperationListDevices                                                         */
/* Returns all available Spotify devices for the current user.                   */
/**********************************************************************************/
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


/**********************************************************************************/
/* getOperationTransferPlayback                                                    */
/* Transfers playback to the specified device.                                    */
/* args.deviceId — target device ID (required)                                   */
/* args.play     — whether to start playing immediately (default: false)         */
/**********************************************************************************/
async function getOperationTransferPlayback(token, args) {
  const deviceId = getStr(args.deviceId, "");
  if (!deviceId) return { ok: false, error: "Missing required argument: deviceId" };
  const play = getBool(args.play, false);
  const res = await makeRequest(token, { method: "PUT", path: "/me/player", body: { device_ids: [deviceId], play } });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, operation: "transferPlayback", deviceId, play };
}


/**********************************************************************************/
/* getOperationGetPlaylists                                                        */
/* Returns the current user's playlists.                                          */
/* args.limit  — max results (1–50, default: 20)                                 */
/* args.offset — pagination offset (default: 0)                                  */
/**********************************************************************************/
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


/**********************************************************************************/
/* getOperationCreatePlaylist                                                      */
/* Creates a new playlist for the current user.                                  */
/* args.name        — playlist name (required)                                   */
/* args.description — playlist description (optional)                            */
/* args.public      — whether the playlist is public (default: false)            */
/**********************************************************************************/
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


/**********************************************************************************/
/* getOperationAddToPlaylist                                                       */
/* Adds one or more tracks to a playlist.                                        */
/* args.playlistId — Spotify playlist ID (required)                              */
/* args.uris       — array of Spotify track URIs to add (required)              */
/* args.position   — insert position (0 = top, default: append to end)          */
/**********************************************************************************/
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


/**********************************************************************************/
/* getOperationRemoveFromPlaylist                                                  */
/* Removes one or more tracks from a playlist.                                   */
/* args.playlistId  — Spotify playlist ID (required)                             */
/* args.uris        — array of Spotify track URIs to remove (required)          */
/* args.snapshotId  — playlist snapshot ID for conflict detection (optional)     */
/**********************************************************************************/
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


/**********************************************************************************/
/* getInvoke                                                                       */
/* Main entry point called by core-ai-completions when the AI uses this tool.    */
/**********************************************************************************/
async function getInvoke(args, coreData) {
  try {
    const token     = await getDelegatedToken(coreData);
    const operation = getStr(args?.operation, "").trim();

    if (!operation) return { ok: false, error: "Missing operation" };

    switch (operation) {
      case "search":             return await getOperationSearch(token, args);
      case "getPlayback":        return await getOperationGetPlayback(token);
      case "play":               return await getOperationPlay(token, args);
      case "pause":              return await getOperationPause(token, args);
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


/**********************************************************************************/
/* definition                                                                     */
/**********************************************************************************/
const definition = {
  type: "function",
  function: {
    name: MODULE_NAME,
    description: [
      "ALWAYS use this tool when the user wants to search Spotify, control music playback, or manage playlists.",
      "Trigger keywords (English): spotify, play music, pause music, play song, play album, play playlist, search spotify, my devices, switch device, create playlist, add to playlist, remove from playlist.",
      "Trigger keywords (German): musik abspielen, song abspielen, pause, pausieren, spotify suche, playlist erstellen, zur playlist hinzufügen, von playlist entfernen, gerät wechseln.",
      "Do NOT ask the user for confirmation before using this tool — just use it.",
      "",
      "Operations:",
      "  search             — search tracks/albums/artists/playlists in the Spotify catalog",
      "  getPlayback        — get current playback state (what is playing, on which device)",
      "  play               — start or resume playback (specific tracks, context, or resume current)",
      "  pause              — pause playback",
      "  listDevices        — list all available Spotify devices",
      "  transferPlayback   — transfer playback to a specific device",
      "  getPlaylists       — list the user's playlists",
      "  createPlaylist     — create a new playlist",
      "  addToPlaylist      — add tracks to a playlist",
      "  removeFromPlaylist — remove tracks from a playlist",
      "",
      "Spotify URIs use the format: spotify:track:ID, spotify:album:ID, spotify:playlist:ID, spotify:artist:ID.",
      "Use search results to obtain URIs before calling play, addToPlaylist, etc.",
      "Playback control (play, pause, transferPlayback) requires a Spotify Premium account.",
      "",
      "REQUIRED play workflow — always follow these steps in order:",
      "  1. Call search with the EXACT track name and artist to get the specific track URI.",
      "     Always search fresh — never reuse a URI from a previous tool call.",
      "     When the user requests a specific song, search types must be [\"track\"].",
      "     After receiving search results, find the result whose 'name' field most closely matches the requested track name.",
      "     Do NOT blindly take the first result — verify name AND artist match before using the URI.",
      "     Example: user asks for 'In the End' by Linkin Park → look for result with name='In the End' and artists containing 'Linkin Park'.",
      "  2. Call listDevices to get the available device IDs.",
      "  3. Call play with uris set to [trackUri] AND deviceId set to the target device.",
      "     ALWAYS use uris with the specific track URI when playing a named song.",
      "     NEVER use contextUri (artist/album/playlist URI) when the user requests a specific track — contextUri lets Spotify decide what plays and will ignore the requested song.",
      "     Never call play without a deviceId — it will fail if no device is currently active.",
      "     Pick the most appropriate device automatically (prefer the active one, otherwise the first available).",
      "  4. If play returns ok: true, report SUCCESS to the user immediately.",
      "     Do NOT call getPlayback before or after play — not to check what is currently playing, not to verify success.",
      "     getPlayback is only for when the user explicitly asks 'what is playing right now'.",
      "     A track appearing in getPlayback does NOT mean the user's request is fulfilled — always call play.",
      "",
      "IMPORTANT: This tool uses delegated OAuth2. The user must have connected their Spotify account at /spotify-auth.",
      "If the tool returns an error about missing token or authentication, tell the user to visit /spotify-auth to connect their Spotify account."
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "Operation to perform.",
          enum: ["search", "getPlayback", "play", "pause", "listDevices", "transferPlayback", "getPlaylists", "createPlaylist", "addToPlaylist", "removeFromPlaylist"],
        },
        query: {
          type: "string",
          description: "Search query string. Required for search.",
        },
        types: {
          type: "array",
          items: { type: "string", enum: ["track", "album", "artist", "playlist"] },
          description: "Entity types to search for. Default: [\"track\"].",
        },
        uris: {
          type: "array",
          items: { type: "string" },
          description: "Array of Spotify URIs (spotify:track:ID). Required for addToPlaylist and removeFromPlaylist. Optional for play.",
        },
        contextUri: {
          type: "string",
          description: "Spotify URI of an album, playlist, or artist to play as context. Used with play operation.",
        },
        deviceId: {
          type: "string",
          description: "Spotify device ID. Optional for play and pause. Required for transferPlayback.",
        },
        playlistId: {
          type: "string",
          description: "Spotify playlist ID (not URI). Required for addToPlaylist and removeFromPlaylist.",
        },
        name: {
          type: "string",
          description: "Playlist name. Required for createPlaylist.",
        },
        description: {
          type: "string",
          description: "Playlist description. Optional for createPlaylist.",
        },
        public: {
          type: "boolean",
          description: "Whether the playlist is public. Default: false. Used with createPlaylist.",
        },
        play: {
          type: "boolean",
          description: "Whether to start playing after transferring playback. Default: false. Used with transferPlayback.",
        },
        position: {
          type: "number",
          description: "Insert position (0 = top). Used with addToPlaylist. Default: append.",
        },
        offsetIndex: {
          type: "number",
          description: "Track index within context to start at. Used with play when contextUri is set.",
        },
        positionMs: {
          type: "number",
          description: "Seek position in milliseconds. Used with play.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Default: 20, max: 50.",
        },
        offset: {
          type: "number",
          description: "Pagination offset. Default: 0.",
        },
        market: {
          type: "string",
          description: "ISO 3166-1 alpha-2 market code to filter results (e.g. DE, US). Optional for search.",
        },
        snapshotId: {
          type: "string",
          description: "Playlist snapshot ID for conflict detection. Optional for removeFromPlaylist.",
        },
      },
      required: ["operation"],
    },
  },
};


export default { name: MODULE_NAME, definition, invoke: getInvoke };
