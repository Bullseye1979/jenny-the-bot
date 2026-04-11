/**************************************************************/
/* filename: "async-sse.js"                                         */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper.                     */
/**************************************************************/
















const _connections = new Map();








export function registerSseConnection(channelId, res) {
  if (!channelId || !res) return;
  if (!_connections.has(channelId)) _connections.set(channelId, new Set());
  _connections.get(channelId).add(res);
}







export function unregisterSseConnection(channelId, res) {
  const set = _connections.get(channelId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) _connections.delete(channelId);
}









export function pushAsyncResult(channelId, payload) {
  const set = _connections.get(channelId);
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
  if (set.size === 0) _connections.delete(channelId);

  return sent;
}







export function getSseConnectionCount(channelId) {
  return _connections.get(channelId)?.size ?? 0;
}
