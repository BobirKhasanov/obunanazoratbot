// Live connections (WebSocket) and "who is online right now".
//
// Why WebSocket: a chess game between two people must feel instant, so the server pushes every
// move to the other player. The actual actions (move, resign, ...) still go through normal HTTP
// requests, which keeps validation and authentication in exactly one place.
const { WebSocketServer } = require('ws');
const { validateInitData } = require('./auth');

const sockets = new Map();   // userId -> Set<ws>
const lastRest = new Map();  // userId -> ms of the last HTTP request (fallback when WebSocket is unavailable)
const REST_ONLINE_MS = Number(process.env.PRESENCE_REST_MS || 35_000); // env override is for tests

const add = (id, ws) => { if (!sockets.has(id)) sockets.set(id, new Set()); sockets.get(id).add(ws); };
function remove(id, ws) {
  const set = sockets.get(id);
  if (!set) return;
  set.delete(ws);
  if (!set.size) { sockets.delete(id); lastRest.delete(id); } // gone immediately, not after a timeout
}

/** Called for every authenticated HTTP request. */
const markRest = (id) => lastRest.set(id, Date.now());

const isOnline = (id) => sockets.has(id) || Date.now() - (lastRest.get(id) || 0) < REST_ONLINE_MS;

function onlineIds() {
  const ids = new Set(sockets.keys());
  const now = Date.now();
  for (const [id, t] of lastRest) if (now - t < REST_ONLINE_MS) ids.add(id);
  return [...ids];
}

function send(userId, payload) {
  const set = sockets.get(userId);
  if (!set) return false;
  const text = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === 1) ws.send(text);
  return true;
}

function attach(server, botToken, hooks) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws) => {
    let userId = null;
    ws.isAlive = true;
    const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 8000);
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.t === 'auth' && !userId) {
        const u = validateInitData(String(msg.initData || ''), botToken);
        const row = u && hooks.getUser(u.id);
        if (!row || row.blocked) return ws.close(4003, 'denied');
        userId = u.id;
        clearTimeout(authTimer);
        add(userId, ws);
        hooks.touch(userId);
        ws.send(JSON.stringify({ t: 'hello' }));
      } else if (msg.t === 'ping' && userId) {
        hooks.touch(userId);
        ws.send(JSON.stringify({ t: 'pong' }));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (userId) remove(userId, ws);
    });
    ws.on('error', () => {});
  });

  // Drop dead connections (phone went offline without closing the socket)
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already closing */ }
    }
    const now = Date.now();
    for (const [id, t] of lastRest) if (now - t > 5 * 60_000) lastRest.delete(id);
  }, 25_000);
  beat.unref();

  return wss;
}

module.exports = { attach, send, isOnline, onlineIds, markRest };
