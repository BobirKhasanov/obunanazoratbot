// Swiss tournament end-to-end: boots the real server on a throwaway Postgres.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { freshDb } = require('./helpers/pg');
const fake = require('./helpers/fake-telegram');

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_ID = 1895441858;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = {
  ADMIN: { id: ADMIN_ID, first_name: 'Boss' },
  P: { id: 2001, first_name: 'Prem' },
  A: { id: 2002, first_name: 'Ann' }, B: { id: 2003, first_name: 'Ben' },
  C: { id: 2004, first_name: 'Cat' }, D: { id: 2005, first_name: 'Dov' }, E: { id: 2006, first_name: 'Eli' },
};
const init = (k) => fake.sign(U[k], TOKEN);
const call = async (who, method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Init-Data': init(who) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = async (who, method, p, body) => { const r = await call(who, method, p, body); assert.ok(r.status < 300, `${method} ${p} as ${who} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const err = async (who, method, p, body, status, code) => {
  const r = await call(who, method, p, body);
  assert.strictEqual(r.status, status, `${method} ${p}: expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  if (code) assert.strictEqual(r.data.code, code);
};
let passed = 0;
const step = async (n, f) => { await f(); passed++; console.log(`ok  ${n}`); };
const waitFor = async (fn, ms = 20000, what = 'condition') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(200); } };

(async () => {
  const tg = await fake.start();
  const pg = await freshDb();
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BOT_TOKEN: TOKEN, DISABLE_BOT: '1', PORT: String(PORT), DATABASE_URL: pg.url, ADMIN_IDS: String(ADMIN_ID), TG_API_ROOT: tg.url,
      WEBAPP_URL: 'https://chess.example.test', SCHEDULER_MS: '60000', SWEEPER_MS: '2000', TOUR_BREAK_MS: '300', TOUR_NOSHOW_MS: '2500', USER_MEMO_MS: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('listening') && res()));
  try {
    for (const k of Object.keys(U)) await ok(k, 'GET', '/me');
    await pg.q("UPDATE users SET premium = 1, premium_until = now() + interval '30 days' WHERE id = ?".replace('?', U.P.id));
    await sleep(800); // the server memoises users for 0.5s

    await step('only Premium / admin can create', async () => {
      await err('A', 'POST', '/tournaments', { name: 'Nope' }, 403, 'premium_required');
      const list = await ok('A', 'GET', '/tournaments');
      assert.strictEqual(list.canCreate, false);
      assert.strictEqual((await ok('P', 'GET', '/tournaments')).canCreate, true);
    });

    let id;
    await step('create, one active per Premium user, join/leave rules', async () => {
      const r = await ok('P', 'POST', '/tournaments', { name: 'Friday Blitz', timeControl: '3+0', rounds: 3, maxPlayers: 5, startsInMin: 60 });
      id = r.tournament.id;
      assert.strictEqual(r.tournament.status, 'registration');
      assert.strictEqual(r.tournament.players, 1);
      await err('P', 'POST', '/tournaments', { name: 'Second' }, 400, 'tour_limit');
      await err('A', 'POST', `/tournaments/${id}/start`, null, 403, 'forbidden');
      await err('P', 'POST', `/tournaments/${id}/leave`, null, 400, 'tour_creator');
      await ok('A', 'POST', `/tournaments/${id}/join`);
      await ok('A', 'POST', `/tournaments/${id}/join`); // idempotent
      await ok('A', 'POST', `/tournaments/${id}/leave`);
      for (const k of ['A', 'B', 'C', 'D']) await ok(k, 'POST', `/tournaments/${id}/join`);
      await err('E', 'POST', `/tournaments/${id}/join`, null, 400, 'tour_full');
      assert.strictEqual((await ok('E', 'GET', `/tournaments/${id}`)).standing.length, 5);
    });

    const players = ['P', 'A', 'B', 'C', 'D'];
    await step('plays 3 Swiss rounds with an odd field (byes, no rematches)', async () => {
      await ok('P', 'POST', `/tournaments/${id}/start`);
      const seen = new Set();
      const byeSeen = new Set();
      for (let round = 1; round <= 3; round += 1) {
        const view = await waitFor(async () => {
          const d = await ok('P', 'GET', `/tournaments/${id}`);
          return d.tournament.round === round && d.pairings.length ? d : null;
        }, 20000, `round ${round}`);
        assert.strictEqual(view.tournament.status, 'running');
        const games = view.pairings.filter((p) => p.black);
        const byes = view.pairings.filter((p) => !p.black);
        assert.strictEqual(games.length, 2); assert.strictEqual(byes.length, 1);
        for (const b of byes) { assert.ok(!byeSeen.has(b.white.id), 'bye must rotate'); byeSeen.add(b.white.id); }
        for (const g of games) {
          const key = [g.white.id, g.black.id].sort().join('-');
          assert.ok(!seen.has(key), `rematch ${key}`); seen.add(key);
          // tournament games cannot be aborted or taken back
          const whiteKey = players.find((k) => U[k].id === g.white.id);
          const blackKey = players.find((k) => U[k].id === g.black.id);
          if (round === 1) {
            await err(whiteKey, 'POST', `/games/${g.gameId}/abort`, null, 400);
            await ok(whiteKey, 'POST', `/games/${g.gameId}/move`, { from: 'e2', to: 'e4' });
            await err(whiteKey, 'POST', `/games/${g.gameId}/takeback`, { action: 'offer' }, 400);
          }
          // Black always resigns except one draw by agreement in round 2
          await ok(blackKey, 'POST', `/games/${g.gameId}/resign`);
        }
      }
      const done = await waitFor(async () => { const d = await ok('P', 'GET', `/tournaments/${id}`); return d.tournament.status === 'finished' ? d : null; }, 20000, 'finish');
      const total = done.standing.reduce((s, r) => s + r.points, 0);
      assert.strictEqual(total, 3 * 3, '2 decisive games + 1 bye per round = 3 points/round');
      assert.strictEqual(done.standing[0].rank, 1);
      assert.ok(done.standing[0].points >= done.standing[1].points);
      assert.strictEqual(byeSeen.size, 3);
    });

    await step('tournament games appear in history and are rated', async () => {
      const h = await ok('P', 'GET', '/games/history');
      assert.ok(h.games.some((g) => g.mode === 'tour'), 'tour game in history');
    });

    await step('no-show forfeits and removes the player; empty field ends the tournament', async () => {
      const r = await ok('P', 'POST', '/tournaments', { name: 'Sleepers', timeControl: '3+0', rounds: 3, startsInMin: 5 });
      const t2 = r.tournament.id;
      for (const k of ['A', 'B', 'C']) await ok(k, 'POST', `/tournaments/${t2}/join`);
      await ok('P', 'POST', `/tournaments/${t2}/start`);
      const d = await waitFor(async () => { const x = await ok('P', 'GET', `/tournaments/${t2}`); return x.tournament.status === 'finished' ? x : null; }, 40000, 'no-show finish');
      assert.ok(d.standing.some((s) => s.withdrawn), 'someone was removed');
      assert.strictEqual(d.tournament.status, 'finished');
    });

    await step('cancel and too-few-players behave', async () => {
      const r = await ok('P', 'POST', '/tournaments', { name: 'Tiny', startsInMin: 5 });
      const t3 = r.tournament.id;
      await ok('A', 'POST', `/tournaments/${t3}/join`);
      await ok('P', 'POST', `/tournaments/${t3}/start`); // only 2 players -> cancelled
      assert.strictEqual((await ok('P', 'GET', `/tournaments/${t3}`)).tournament.status, 'cancelled');
      const r2 = await ok('ADMIN', 'POST', '/tournaments', { name: 'Admin cup' });
      await err('A', 'POST', `/tournaments/${r2.tournament.id}/cancel`, null, 403, 'forbidden');
      await ok('ADMIN', 'POST', `/tournaments/${r2.tournament.id}/cancel`);
      await err('A', 'POST', `/tournaments/${r2.tournament.id}/join`, null, 400, 'tour_closed');
    });
    console.log(`\n${passed} tournament steps passed`);
  } finally {
    srv.kill(); tg.close(); await Promise.race([pg.drop(), sleep(4000)]);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
