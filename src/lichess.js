// Public Lichess broadcast API proxy helpers (no OAuth needed for watching).
// Docs: https://lichess.org/api#tag/Broadcasts

const BASE = 'https://lichess.org';
const UA = 'ObunaNazoratBot/1.0 (Telegram Mini App; broadcast spectator)';

const cache = new Map(); // key -> { at, data }
const getCached = (key, maxAge) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > maxAge) { cache.delete(key); return null; }
  return hit.data;
};
const setCached = (key, data) => { cache.set(key, { at: Date.now(), data }); return data; };

async function lichessGet(path, { accept = 'application/json', maxAge = 8_000 } = {}) {
  const key = `${accept}:${path}`;
  const hit = getCached(key, maxAge);
  if (hit) return hit;
  const r = await fetch(`${BASE}${path}`, {
    headers: { Accept: accept, 'User-Agent': UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) {
    const err = new Error(`Lichess ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = accept.includes('json') ? await r.json() : await r.text();
  return setCached(key, data);
}

/** Top live / upcoming broadcasts. */
async function topBroadcasts() {
  return lichessGet('/api/broadcast/top', { maxAge: 15_000 });
}

/** Tournament with rounds list. */
async function broadcastTour(tourId) {
  const id = String(tourId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  if (!id) throw Object.assign(new Error('bad id'), { status: 400 });
  return lichessGet(`/api/broadcast/${id}`, { maxAge: 20_000 });
}

/** Round with live game snapshots (fen, clocks, lastMove). */
async function broadcastRound(roundId) {
  const id = String(roundId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  if (!id) throw Object.assign(new Error('bad id'), { status: 400 });
  return lichessGet(`/api/broadcast/-/-/${id}`, { maxAge: 5_000 });
}

/** Split a multi-game PGN into { id, pgn } entries using Site/GameURL tags. */
function parseMultiPgn(text) {
  const chunks = String(text || '').split(/\n(?=\[Event )/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const pgn of chunks) {
    const site = (pgn.match(/\[Site "([^"]+)"\]/) || [])[1] || '';
    const id = (site.match(/\/([a-zA-Z0-9]{8})(?:\?|$)/) || [])[1]
      || (pgn.match(/\[GameURL "[^"]*\/([a-zA-Z0-9]{8})"\]/) || [])[1]
      || null;
    if (id) out.push({ id, pgn });
  }
  return out;
}

/**
 * Grab the current PGN dump for a round (stream sends full games, then keeps open).
 * We abort after a short window once we have content.
 */
async function broadcastRoundPgn(roundId) {
  const id = String(roundId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  if (!id) throw Object.assign(new Error('bad id'), { status: 400 });
  const key = `pgn:${id}`;
  const hit = getCached(key, 8_000);
  if (hit) return hit;

  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), 4500);
  let buf = '';
  try {
    const r = await fetch(`${BASE}/api/stream/broadcast/round/${id}.pgn`, {
      headers: { Accept: 'application/x-chess-pgn', 'User-Agent': UA },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const err = new Error(`Lichess ${r.status}`);
      err.status = r.status;
      throw err;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const started = Date.now();
    let quietSince = Date.now();
    while (Date.now() - started < 4200) {
      const read = reader.read();
      const tick = new Promise((res) => setTimeout(() => res({ timeout: true }), 280));
      const chunk = await Promise.race([read, tick]);
      if (chunk.timeout) {
        if ((buf.match(/\[Event /g) || []).length >= 1 && Date.now() - quietSince > 400) break;
        continue;
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      quietSince = Date.now();
    }
    try { ctrl.abort(); } catch { /* ignore */ }
  } catch (e) {
    if (e.name !== 'AbortError' && !buf) throw e;
  } finally {
    clearTimeout(kill);
  }
  const games = parseMultiPgn(buf);
  return setCached(key, { roundId: id, games, raw: buf });
}

module.exports = { topBroadcasts, broadcastTour, broadcastRound, broadcastRoundPgn, parseMultiPgn };
