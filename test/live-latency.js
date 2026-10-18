// Lichess live latency: short shared cache (offline, mocked fetch) + tight client polling.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ---- client polling intervals (perf.js) ----
const perf = read('public/js/perf.js');
const ms = (fn, branch) => {
  const body = new RegExp(`export function ${fn}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(perf)[1];
  const m = new RegExp(`${branch}[^\\n]*return (\\d+);`).exec(body) || new RegExp(`${branch}\\) return (\\d+);`).exec(body);
  return Number(m && m[1]);
};
assert.ok(/liveGamePollMs[\s\S]*?return 1000;/.test(perf), 'open live game polls every 1s on iOS/desktop');
assert.ok(ms('liveGamePollMs', 'p.isIOS') <= 1500, 'iOS eco live game poll <= 1.5s');
assert.ok(ms('liveGamePollMs', 'p.isAndroid') <= 2000, 'Android live game poll <= 2s');
assert.ok(ms('liveGamePollMs', 'p.lite') <= 3000, 'lite live game poll <= 3s');
assert.ok(/liveRoundPollMs[\s\S]*?return 2000;/.test(perf), 'round grid polls every 2s on iOS/desktop');
assert.ok(ms('liveRoundPollMs', 'p.isAndroid') <= 3000 && ms('liveRoundPollMs', 'p.lite') <= 5000, 'Android/lite round poll tightened');

// ---- polls never stack when a response is slower than the interval ----
const live = read('public/js/live.js');
assert.ok(live.includes('roundBusy') && live.includes('gameBusy'), 'live polls skip while a request is in flight');

// ---- server shared cache (mocked Lichess) ----
let calls = 0;
global.fetch = async () => {
  calls += 1;
  return { ok: true, status: 200, json: async () => ({ round: { id: 'abcd1234' }, games: [], n: calls }), text: async () => '' };
};
const lichess = require('../src/lichess');

(async () => {
  const [a, b, c] = await Promise.all([lichess.broadcastRound('abcd1234'), lichess.broadcastRound('abcd1234'), lichess.broadcastRound('abcd1234')]);
  assert.strictEqual(calls, 1, 'concurrent viewers share one upstream request');
  assert.strictEqual(a.n, b.n); assert.strictEqual(b.n, c.n);

  await lichess.broadcastRound('abcd1234');
  assert.strictEqual(calls, 1, 'second poll inside the cache window is served from cache');

  await new Promise((r) => setTimeout(r, 1150));
  const d = await lichess.broadcastRound('abcd1234');
  assert.strictEqual(calls, 2, 'snapshot is refetched after ~1s (was 2.5s) — max server-side staleness ~1s');
  assert.strictEqual(d.n, 2);

  console.log('ok  live-latency (cache <= ~1s, polls 1-2s, no stacked polls)');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- iOS eco: no always-on GPU work, pollers pause in background ----
const css = read('public/styles.css');
assert.ok(/html\[data-ios="1"\] #bg::before \{[^}]*animation:\s*none/.test(css), 'iOS: 3D background no longer animates');
assert.ok(/html\[data-ios="1"\] #dock,[\s\S]*?backdrop-filter:\s*none/.test(css), 'iOS: no backdrop blur layers');
assert.ok(/html\[data-hidden="1"\] \*[\s\S]*?animation-play-state:\s*paused/.test(css), 'animations pause when app is hidden');
assert.ok(/html\[data-ios="1"\] \.pc,[\s\S]*?filter:\s*none/.test(css), 'iOS: no per-piece filters');
assert.ok(/liveClockTickMs[\s\S]*?isIOS \? 500/.test(perf), 'iOS clock repaint halved');
const liveSrc = read('public/js/live.js');
assert.strictEqual((liveSrc.match(/if \(document\.hidden\) return;/g) || []).length >= 2, true, 'live pollers skip while hidden');
console.log('live-latency eco OK');
