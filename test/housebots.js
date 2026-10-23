// House players: four practice opponents that play through the normal API.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { freshDb } = require('./helpers/pg');
const fake = require('./helpers/fake-telegram');

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const PORT = 3992;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_ID = 1895441858;
const HOUSE = 9_000_000_000_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = { ADMIN: { id: ADMIN_ID, first_name: 'Boss' }, A: { id: 3001, first_name: 'Ann' } };
const init = (k) => fake.sign(U[k], TOKEN);
const call = async (who, method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Init-Data': init(who) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = async (who, method, p, body) => { const r = await call(who, method, p, body); assert.ok(r.status < 300, `${method} ${p} as ${who} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const waitFor = async (fn, ms = 25000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(250); } };
let passed = 0;
const step = async (n, f) => { await f(); passed++; console.log(`ok  ${n}`); };

(async () => {
  const tg = await fake.start();
  const pg = await freshDb();
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BOT_TOKEN: TOKEN, DISABLE_BOT: '1', HOUSEBOT_FAST: '1', PRESENCE_REST_MS: '1500', PORT: String(PORT), DATABASE_URL: pg.url, ADMIN_IDS: String(ADMIN_ID), TG_API_ROOT: tg.url,
      WEBAPP_URL: 'https://chess.example.test', SCHEDULER_MS: '60000', SWEEPER_MS: '2000', USER_MEMO_MS: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('listening') && res()));
  const finish = async (code) => { srv.kill(); try { await Promise.race([pg.drop(), sleep(3000)]); } catch { /* ignore */ } try { tg.close && tg.close(); } catch { /* ignore */ } process.exit(code); };
  try {
    for (const k of Object.keys(U)) await ok(k, 'GET', '/me');
    await sleep(600);
    let bots;
    await step('admin sees four bots, players cannot', async () => {
      const r = await ok('ADMIN', 'GET', '/admin/housebots');
      bots = r.bots;
      assert.strictEqual(bots.length, 4);
      assert.strictEqual(bots.filter((b) => b.gender === 'f').length, 2);
      assert.strictEqual(bots.filter((b) => b.tier === 'weak').length, 2);
      assert.ok(bots.every((b) => b.enabled && b.id >= HOUSE));
      assert.strictEqual((await call('A', 'GET', '/admin/housebots')).status, 404);
    });
    const mid = () => bots.find((b) => b.tier === 'mid');
    await step('bot profile looks like a player and is labelled', async () => {
      const u = (await ok('A', 'GET', `/users/${mid().id}`)).user;
      assert.ok(u.displayName.includes(' ') && u.isBot === true && u.country);
      assert.strictEqual((await ok('A', 'GET', `/users/${U.A.id}`)).user.isBot, false);
    });
    let gid;
    await step('a player challenges a bot: it accepts and answers moves', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: mid().id, timeControl: '10+0', preferredColor: 'w' })).game;
      gid = g.id;
      const act = await waitFor(async () => { const x = (await ok('A', 'GET', `/games/${gid}`)).game; return x.status === 'active' ? x : null; }, 20000, 'bot accepts');
      assert.ok(act.white && act.black);
      const meColour = act.you;
      const gm = async () => (await ok('A', 'GET', `/games/${gid}`)).game;
      if (meColour === 'w') await ok('A', 'POST', `/games/${gid}/move`, { from: 'e2', to: 'e4' });
      else {
        await waitFor(async () => (await gm()).moves.length >= 1, 20000, 'bot opens');
        await ok('A', 'POST', `/games/${gid}/move`, { from: 'e7', to: 'e5' });
      }
      const want = meColour === 'w' ? 2 : 3;
      const after = await waitFor(async () => { const x = await gm(); return x.moves.length >= want ? x : null; }, 20000, 'bot replies');
      assert.ok(after.moves.length >= want);
      await ok('A', 'POST', `/games/${gid}/resign`);
    });
    await step('player leaves the app mid-game: the game is ended for them', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: mid().id, timeControl: '10+0' })).game;
      const gm = async () => (await ok('A', 'GET', `/games/${g.id}`)).game;
      const act = await waitFor(async () => { const x = await gm(); return x.status === 'active' ? x : null; }, 20000, 'accepts');
      if (act.you === 'w') await ok('A', 'POST', `/games/${g.id}/move`, { from: 'd2', to: 'd4' });
      else { await waitFor(async () => (await gm()).moves.length >= 1, 20000, 'bot opens'); await ok('A', 'POST', `/games/${g.id}/move`, { from: 'd7', to: 'd5' }); }
      await waitFor(async () => (await gm()).moves.length >= 2, 20000, 'two plies');
      // A stops talking to the server (closed the Mini App) — wait out presence + grace
      await sleep(7000);
      const row = (await pg.q('SELECT status, result, reason FROM games WHERE id = $1', g.id))[0];
      assert.strictEqual(row.status, 'finished');
      assert.strictEqual(row.reason, 'resign');
      assert.strictEqual(row.result, act.you === 'w' ? '0-1' : '1-0', 'the bot wins');
    });
    await step('disabled bot is offline; re-enabled is back', async () => {
      const weak = bots.find((b) => b.tier === 'weak');
      await ok('ADMIN', 'PATCH', '/admin/housebots', { enabled: { [weak.id]: false } });
      const r = await call('A', 'POST', '/games', { opponentId: weak.id, timeControl: '10+0' });
      assert.strictEqual(r.status, 409);
      const view = await ok('ADMIN', 'GET', '/admin/housebots');
      assert.strictEqual(view.bots.find((b) => b.id === weak.id).enabled, false);
      await ok('ADMIN', 'PATCH', '/admin/housebots', { enabled: { [weak.id]: true } });
    });
    await step('finished game moves the bot rating; bots show in rankings', async () => {
      const rk = await ok('A', 'GET', '/rankings?board=elo&category=rapid');
      const row = rk.rankings.find((r) => r.id === mid().id);
      assert.ok(row && row.isBot === true, 'bot is ranked');
      assert.ok(row.elo !== 1330, 'rating changed after the game');
    });
    await step('bots play each other while people are around', async () => {
      const g = await waitFor(async () => {
        await ok('A', 'GET', '/me');
        const l = await ok('A', 'GET', '/live/games');
        return (l.games || []).find((x) => x.white && x.black && x.white.id >= HOUSE && x.black.id >= HOUSE);
      }, 30000, 'bot vs bot game');
      const full = await waitFor(async () => { const x = (await ok('A', 'GET', `/live/games/${g.id}`)).game; return x.moves.length >= 4 ? x : null; }, 30000, 'bots move');
      assert.ok(full.moves.length >= 4);
      await ok('ADMIN', 'PATCH', '/admin/housebots', { vsBots: false });
      assert.strictEqual((await ok('ADMIN', 'GET', '/admin/housebots')).vsBots, false);
    });
    console.log(`${passed} house-bot steps passed`);
    await finish(0);
  } catch (e) { console.error('FAILED:', e); await finish(1); }
})();
