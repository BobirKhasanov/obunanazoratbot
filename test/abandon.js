// Abandonment like chess.com: first move missing → aborted; a player who left while the opponent stays → loses.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { freshDb } = require('./helpers/pg');
const fake = require('./helpers/fake-telegram');

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const PORT = 3993;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = { A: { id: 3101, first_name: 'Ann' }, B: { id: 3102, first_name: 'Bek' }, C: { id: 3103, first_name: 'Cem' }, D: { id: 3104, first_name: 'Dil' } };
const init = (k) => fake.sign(U[k], TOKEN);
const call = async (who, method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Init-Data': init(who) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = async (who, method, p, body) => { const r = await call(who, method, p, body); assert.ok(r.status < 300, `${method} ${p} as ${who} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const waitFor = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(250); } };
let passed = 0;
const step = async (n, f) => { await f(); passed++; console.log(`ok  ${n}`); };

(async () => {
  const tg = await fake.start();
  const pg = await freshDb();
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BOT_TOKEN: TOKEN, DISABLE_BOT: '1', DISABLE_HOUSEBOTS: '1', PRESENCE_REST_MS: '2000', ABANDON_FIRST_MOVE_MS: '4000', ABANDON_GRACE_MS: '4000',
      PORT: String(PORT), DATABASE_URL: pg.url, ADMIN_IDS: '1895441858', TG_API_ROOT: tg.url,
      WEBAPP_URL: 'https://chess.example.test', SCHEDULER_MS: '1500', ABANDON_UNTIMED_HOURS: '0.001', SWEEPER_MS: '2000', USER_MEMO_MS: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('listening') && res()));
  const finish = async (code) => { srv.kill(); try { await Promise.race([pg.drop(), sleep(3000)]); } catch { /* ignore */ } try { tg.close && tg.close(); } catch { /* ignore */ } process.exit(code); };
  const start = async (a, b, tc) => {
    const first = (await ok(a, 'POST', '/games/quick', { timeControl: tc })).game;
    const second = (await ok(b, 'POST', '/games/quick', { timeControl: tc })).game;
    assert.strictEqual(second.id, first.id);
    return first.id;
  };
  try {
    for (const k of Object.keys(U)) await ok(k, 'GET', '/me');
    await step('no first move in time: the game is aborted, no rating change', async () => {
      const id = await start('A', 'B', '10+0');
      const g = await waitFor(async () => { const x = (await ok('A', 'GET', `/games/${id}`)).game; return x.status === 'cancelled' ? x : null; }, 20000, 'abort');
      assert.strictEqual(g.reason, 'aborted');
      assert.strictEqual((await ok('A', 'GET', '/me')).user.elo, 1200);
    });
    await step('a player who left mid-game loses to the opponent who stayed', async () => {
      const id = await start('C', 'D', '10+0');
      const view = async (w) => (await ok(w, 'GET', `/games/${id}`)).game;
      const g0 = await view('C');
      const [wk, bk] = g0.you === 'w' ? ['C', 'D'] : ['D', 'C'];
      await ok(wk, 'POST', `/games/${id}/move`, { from: 'e2', to: 'e4' });
      await ok(bk, 'POST', `/games/${id}/move`, { from: 'e7', to: 'e5' });
      // the black player closes the Mini App (silent); white keeps it open
      const t0 = Date.now();
      const done = await waitFor(async () => { await ok(wk, 'GET', '/me'); const x = await view(wk); return x.status === 'finished' ? x : null; }, 25000, 'abandon win');
      assert.strictEqual(done.reason, 'abandoned');
      assert.strictEqual(done.result, '1-0');
      assert.ok(Date.now() - t0 >= 2500, 'not instant: a grace period applies');
    });
    await step('untimed game: the player who does not move within the limit loses (rating applies); before 2 moves it is aborted', async () => {
      const id = await start('A', 'B', 'classic');
      const view = async (w) => (await ok(w, 'GET', `/games/${id}`)).game;
      const g0 = await view('A');
      const [wk, bk] = g0.you === 'w' ? ['A', 'B'] : ['B', 'A'];
      await ok(wk, 'POST', `/games/${id}/move`, { from: 'e2', to: 'e4' });
      await ok(bk, 'POST', `/games/${id}/move`, { from: 'e7', to: 'e5' });
      const done = await waitFor(async () => { const x = await view(wk); return x.status === 'finished' ? x : null; }, 30000, 'untimed forfeit');
      assert.strictEqual(done.reason, 'abandoned');
      assert.strictEqual(done.result, '0-1'); // white to move → white loses
      assert.ok((await ok(wk, 'GET', '/me')).user.elo < 1200, 'the player to move lost rating');
    });
    console.log(`${passed} abandonment steps passed`);
    await finish(0);
  } catch (e) { console.error('FAILED:', e); await finish(1); }
})();
