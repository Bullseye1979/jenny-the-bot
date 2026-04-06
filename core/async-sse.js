/************************************************************************************/
/* filename: async-sse.js                                                           *
/* Version 1.0                                                                      *
/* Purpose: In-memory SSE connection registry for async subagent results.           *
/*          Webpage clients open a persistent SSE connection to receive results     *
/*          from background jobs without polling. Connections are stored per        *
/*          channelID and automatically removed on client disconnect.               *
/*                                                                                  *
/* Usage:                                                                           *
/*   registerSseConnection(channelID, res)   — call from HTTP SSE route handler    *
/*   unregisterSseConnection(channelID, res) — call on response 'close'            *
/*   pushAsyncResult(channelID, payload)     — call from subagent poll flows       *
/*                                            payload: { type, response, ... }     *
/************************************************************************************/

/** @type {Map<string, Set<import("http").ServerResponse>>} */
const _connections = new Map();


/**
 * Register an SSE response object for a channelID.
 * Multiple connections per channelID are supported (e.g. multiple tabs).
 * @param {string} channelID
 * @param {import("http").ServerResponse} res
 */
export function registerSseConnection(channelID, res) {
  if (!channelID || !res) return;
  if (!_connections.has(channelID)) _connections.set(channelID, new Set());
  _connections.get(channelID).add(res);
}


/**
 * Remove an SSE response object (call on 'close' event).
 * @param {string} channelID
 * @param {import("http").ServerResponse} res
 */
export function unregisterSseConnection(channelID, res) {
  const set = _connections.get(channelID);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) _connections.delete(channelID);
}


/**
 * Push an async result event to all connected clients for a channelID.
 * Dead connections are pruned automatically.
 * @param {string} channelID
 * @param {object} payload — serialisable object; will be JSON-stringified
 * @returns {number} number of clients reached
 */
export function pushAsyncResult(channelID, payload) {
  const set = _connections.get(channelID);
  if (!set || set.size === 0) return 0;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const dead = [];
  let sent = 0;

  for (const res of set) {
    try {
      res.write(data);
      sent++;
    } catch {
      dead.push(res);
    }
  }

  for (const res of dead) set.delete(res);
  if (set.size === 0) _connections.delete(channelID);

  return sent;
}


/**
 * Returns the number of active SSE connections for a channelID.
 * @param {string} channelID
 * @returns {number}
 */
export function getSseConnectionCount(channelID) {
  return _connections.get(channelID)?.size ?? 0;
}
