















const _connections = new Map();








export function registerSseConnection(channelID, res) {
  if (!channelID || !res) return;
  if (!_connections.has(channelID)) _connections.set(channelID, new Set());
  _connections.get(channelID).add(res);
}







export function unregisterSseConnection(channelID, res) {
  const set = _connections.get(channelID);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) _connections.delete(channelID);
}









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







export function getSseConnectionCount(channelID) {
  return _connections.get(channelID)?.size ?? 0;
}
