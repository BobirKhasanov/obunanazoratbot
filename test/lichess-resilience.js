// Offline: Lichess 429 -> cooldown (no hammering) + stale copy served; 5xx -> stale copy; 404 stays 404.
const assert = require('assert');
const lichess = require('../src/lichess');

let calls = 0;
let mode = 'ok';
global.fetch = async () => {
  calls++;
  if (mode === 'ok') return { ok: true, status: 200, json: async () => ({ games: [{ id: 'aaaaaaaa' }] }), headers: new Map() };
  if (mode === '429') return { ok: false, status: 429, json: async () => ({ error: 'Too many requests' }), headers: new Map([['retry-after', '60']]) };
  if (mode === '500') return { ok: false, status: 500, json: async () => ({}), headers: new Map() };
  return { ok: false, status: 404, json: async () => ({ error: 'Not found' }), headers: new Map() };
};

(async () => {
  const ID = 'abcd1234';
  // 1. healthy fetch fills the last-good copy
  let r = await lichess.broadcastRound(ID, { fresh: true });
  assert.strictEqual(r.games[0].id, 'aaaaaaaa');

  // 2. Lichess throttles us: user still gets the last snapshot, and we stop calling upstream
  mode = '429';
  r = await lichess.broadcastRound(ID, { fresh: true });
  assert.strictEqual(r.games[0].id, 'aaaaaaaa', 'stale snapshot served on 429');
  const after429 = calls;
  await lichess.broadcastRound(ID, { fresh: true });
  await lichess.broadcastRound(ID, { fresh: true });
  assert.strictEqual(calls, after429, 'no upstream calls during cooldown');

  // 3. Something never fetched during cooldown -> clear 429 with retryAfter (not a crash)
  let err;
  try { await lichess.broadcastTour('zzzzzzzz'); } catch (e) { err = e; }
  assert.ok(err && err.status === 429 && err.retryAfter > 0, 'uncached request during cooldown -> 429 + retryAfter');

  // 4. outage: stale copy instead of an error
  lichess._resetForTests();
  mode = 'ok';
  await lichess.broadcastRound(ID, { fresh: true });
  mode = '500';
  r = await lichess.broadcastRound(ID, { fresh: true });
  assert.strictEqual(r.games[0].id, 'aaaaaaaa', 'stale snapshot served on 5xx');

  // 5. 404 is a real answer, never masked by stale data
  lichess._resetForTests();
  mode = '404';
  err = null;
  try { await lichess.broadcastRound('eGDNBzOF', { fresh: true }); } catch (e) { err = e; }
  assert.ok(err && err.status === 404, '404 propagates');
  console.log('lichess-resilience OK');
})().catch((e) => { console.error(e); process.exit(1); });
