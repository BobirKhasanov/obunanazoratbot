// Public Lichess broadcast API helpers (watching needs no OAuth).
// Docs: https://lichess.org/api#tag/Broadcasts
// Optional shared cache: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

const { cacheGet, cacheSet, cacheDel } = require('./cache');

const BASE = 'https://lichess.org';
const UA = 'ObunaNazoratBot/1.0 (Telegram Mini App; broadcast spectator)';

const inflight = new Map(); // path -> Promise

/** Lichess broadcast / game ids are exactly 8 URL-safe chars. */
function lichessId(raw, label = 'id') {
  const id = String(raw || '').trim();
  if (!/^[a-zA-Z0-9]{8}$/.test(id)) {
    const err = new Error(`Invalid Lichess ${label}`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  return id;
}

function slugify(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || '-';
}

/** Parse tour/round slugs from a Lichess broadcast URL when present. */
function slugsFromUrl(url) {
  const m = String(url || '').match(/\/broadcast\/([^/]+)\/([^/]+)\/([a-zA-Z0-9]{8})\b/);
  if (!m) return null;
  return { tourSlug: m[1], roundSlug: m[2], roundId: m[3] };
}

async function fetchOnce(path, accept) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Accept: accept, 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch { /* ignore */ }
    const err = new Error(detail || `Lichess ${r.status}`);
    err.status = r.status;
    throw err;
  }
  if (accept.includes('json')) return r.json();
  return r.text();
}

async function lichessGet(path, { accept = 'application/json', maxAge = 8_000, fresh = false } = {}) {
  const key = `lichess:${accept}:${path}`;
  if (!fresh && maxAge > 0) {
    const hit = await cacheGet(key, maxAge);
    if (hit != null) return hit;
  }
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await fetchOnce(path, accept);
        if (maxAge > 0) await cacheSet(key, data, maxAge);
        return data;
      } catch (e) {
        lastErr = e;
        // Never retry 429 — retries make Lichess throttle harder and surface as "Too many requests"
        if (e.status === 400 || e.status === 404 || e.status === 429) throw e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

/** Top live / upcoming broadcasts. */
async function topBroadcasts() {
  return lichessGet('/api/broadcast/top', { maxAge: 20_000 });
}

/** Tournament with rounds list. */
async function broadcastTour(tourId) {
  const id = lichessId(tourId, 'tour id');
  return lichessGet(`/api/broadcast/${id}`, { maxAge: 20_000 });
}

/**
 * Round with live game snapshots (fen, clocks, lastMove).
 * Tries slug path first when provided, then the official /-/-/{id} form.
 */
async function broadcastRound(roundId, { fresh = false, tourSlug, roundSlug, roundUrl } = {}) {
  const id = lichessId(roundId, 'round id');
  const fromUrl = slugsFromUrl(roundUrl);
  const tSlug = slugify(tourSlug || (fromUrl && fromUrl.tourSlug) || '-');
  const rSlug = slugify(roundSlug || (fromUrl && fromUrl.roundSlug) || '-');

  const paths = [];
  if (tSlug !== '-' && rSlug !== '-') paths.push(`/api/broadcast/${tSlug}/${rSlug}/${id}`);
  paths.push(`/api/broadcast/-/-/${id}`);

  let lastErr;
  for (const path of paths) {
    try {
      // Cache ~5s so the Mini App can poll without hammering Lichess
      return await lichessGet(path, { maxAge: fresh ? 0 : 5_000, fresh });
    } catch (e) {
      lastErr = e;
      if (e.status === 400 || e.status === 429) throw e;
      if (e.status !== 404) throw e;
    }
  }
  throw lastErr || Object.assign(new Error('Round not found'), { status: 404 });
}

async function bustPgn(roundId) {
  try {
    const id = lichessId(roundId, 'round id');
    await cacheDel(`lichess:application/x-chess-pgn:/api/broadcast/round/${id}.pgn`);
  } catch { /* ignore */ }
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
 * Current PGN for a round via the non-streaming export endpoint
 * (more reliable than the long-lived NDJSON/PGN stream).
 */
async function broadcastRoundPgn(roundId, { fresh = false } = {}) {
  const id = lichessId(roundId, 'round id');
  const text = await lichessGet(`/api/broadcast/round/${id}.pgn`, {
    accept: 'application/x-chess-pgn',
    maxAge: 5_000,
    fresh,
  });
  const games = parseMultiPgn(text);
  return { roundId: id, games, raw: text };
}

module.exports = {
  topBroadcasts, broadcastTour, broadcastRound, broadcastRoundPgn,
  parseMultiPgn, bustPgn, lichessId, slugsFromUrl,
};
