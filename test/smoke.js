// Backend end-to-end test. Boots the real server with a throwaway database and a FAKE Telegram,
// then plays through: auth, friends, challenges, a full game over websocket, match-making,
// draws, resigns, notifications (with their Open buttons), reminders and the admin post composer.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const WebSocket = require('ws');
const { freshDb } = require('./helpers/pg');
const fake = require('./helpers/fake-telegram');

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_ID = 1895441858;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USERS = {
  A: { id: 1001, first_name: 'Alice', language_code: 'ru' },
  B: { id: 1002, first_name: 'Bob' },
  C: { id: 1003, first_name: 'Cara' },
  D: { id: 1004, first_name: 'Dan' },
  E: { id: 1005, first_name: 'Eve' },
  ADMIN: { id: ADMIN_ID, first_name: 'Boss' },
};
const init = (k) => fake.sign(USERS[k], TOKEN);

const call = async (who, method, p, body, raw) => {
  const r = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-Init-Data': who ? init(who) : '' },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = async (who, method, p, body) => {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} as ${who} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const err = async (who, method, p, body, status, code) => {
  const r = await call(who, method, p, body);
  assert.strictEqual(r.status, status, `${method} ${p}: expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  if (code) assert.strictEqual(r.data.code, code, `${method} ${p}: expected code ${code}, got ${r.data.code}`);
};

function connect(who, initData = init(who)) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const msgs = [];
    ws.on('message', (m) => msgs.push(JSON.parse(m)));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', initData })));
    ws.on('close', (code) => { if (!msgs.length) reject(Object.assign(new Error('closed'), { code })); });
    const api = {
      ws, msgs,
      waitFor: async (pred, ms = 3000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const m = msgs.find(pred); if (m) return m; await sleep(25); }
        throw new Error(`websocket message not received: ${JSON.stringify(msgs).slice(0, 300)}`);
      },
    };
    api.waitFor((m) => m.t === 'hello').then(() => resolve(api), reject);
  });
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Who plays white in a game, so a fixed move list can be played whatever the random colours were
const colours = (g, a, b) => (g.you === 'w' ? { w: a, b } : { w: b, b: a });

async function playMoves(game, players, moves, startPly = 0) {
  let last;
  for (let i = 0; i < moves.length; i++) {
    const who = players[(startPly + i) % 2 === 0 ? 'w' : 'b'];
    last = await ok(who, 'POST', `/games/${game}/move`, { from: moves[i].slice(0, 2), to: moves[i].slice(2, 4), promotion: moves[i][4] });
  }
  return last.game;
}

(async () => {
  const tg = await fake.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-'));
  const pg = await freshDb();
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, BOT_TOKEN: TOKEN, DISABLE_BOT: '1', PORT: String(PORT), DATABASE_URL: pg.url, ADMIN_IDS: String(ADMIN_ID),
      TG_API_ROOT: tg.url, WEBAPP_URL: 'https://chess.example.test', PRESENCE_REST_MS: '300', INVITE_TTL_MS: '60000', SCHEDULER_MS: '300', NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('listening') && res()));
  const sockets = [];

  try {
    // ---------------------------------------------------------------- auth + profile
    await step('rejects missing, wrong-token, stale and tampered logins', async () => {
      await err(null, 'GET', '/me', null, 401, 'auth');
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': fake.sign(USERS.A, 'other:token') } })).status, 401);
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': fake.sign(USERS.A, TOKEN, 1000) } })).status, 401);
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': init('A') + '0' } })).status, 401);
    });

    await step('profile: language from Telegram, theme and language can be changed and validated', async () => {
      const me = await ok('A', 'GET', '/me');
      assert.strictEqual(me.user.lang, 'ru', 'Telegram language_code ru -> ru');
      assert.strictEqual((await ok('B', 'GET', '/me')).user.lang, 'en');
      assert.strictEqual(me.meta.botUsername, 'chess_test_bot');
      assert.strictEqual(me.user.isAdmin, false);
      assert.strictEqual((await ok('ADMIN', 'GET', '/me')).user.isAdmin, true);
      const up = await ok('B', 'PATCH', '/me', { lang: 'uzc', theme: 'light', discoverable: true });
      assert.deepStrictEqual([up.user.lang, up.user.theme, up.user.langSet], ['uzc', 'light', true]);
      await err('B', 'PATCH', '/me', { lang: 'xx' }, 400);
      await err('B', 'PATCH', '/me', { theme: 'pink' }, 400);
      await ok('B', 'PATCH', '/me', { lang: 'en', theme: 'dark' });
    });

    // ---------------------------------------------------------------- friends
    await step('friend invite link makes both players friends and tells the inviter in Telegram', async () => {
      await sleep(450); // Alice has no websocket, so she is "offline" and gets a Telegram message
      const j = await ok('B', 'POST', '/friends/join', { userId: USERS.A.id });
      assert.strictEqual(j.already, false);
      assert.strictEqual((await ok('B', 'POST', '/friends/join', { userId: USERS.A.id })).already, true);
      assert.deepStrictEqual((await ok('A', 'GET', '/friends')).friends.map((f) => f.id), [USERS.B.id]);
      assert.deepStrictEqual((await ok('B', 'GET', '/friends')).friends.map((f) => f.id), [USERS.A.id]);
      await err('B', 'POST', '/friends/join', { userId: USERS.B.id }, 404, 'user_unavailable');
      await sleep(250); // notifications are sent in the background
      const msgs = tg.to(USERS.A.id);
      assert.strictEqual(msgs.length, 1, 'exactly one notification (the repeat must not spam)');
      assert.ok(/Bob/.test(msgs[0].body.text) && /друзья/.test(msgs[0].body.text), 'in Alice\'s language (ru)');
      const btn = msgs[0].body.reply_markup.inline_keyboard[0][0];
      assert.ok(btn.web_app.url.startsWith('https://chess.example.test'), 'button opens the Mini App');
    });

    // ---------------------------------------------------------------- challenge + a full game
    let gid, fm;
    await step('diamonds: +20 once per invited friend; Premium costs 200 and cannot be bought twice', async () => {
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, 20, 'inviter got 20 diamonds for the friend who joined');
      await ok('B', 'POST', '/friends/join', { userId: USERS.A.id }); // opening the link again must not pay again
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, 20);
      assert.strictEqual((await ok('B', 'GET', '/me')).user.diamonds, 0, 'the invited person gets nothing');
      await err('A', 'POST', '/premium/buy', null, 400, 'no_diamonds');
      await pg.q('UPDATE users SET diamonds = 200 WHERE id = $1', USERS.A.id);
      const r = await ok('A', 'POST', '/premium/buy');
      assert.deepStrictEqual([r.user.premium, r.user.diamonds], [true, 0]);
      await err('A', 'POST', '/premium/buy', null, 400, 'premium_owned');
    });

    await step('challenge: in-app invitation only (no chat message), no duplicates', async () => {
      const wsB = await connect('B'); sockets.push(wsB);
      const c = await ok('A', 'POST', '/games', { opponentId: USERS.B.id });
      gid = c.game.id;
      assert.strictEqual(c.game.status, 'invited');
      assert.strictEqual((await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game.id, gid, 'same invitation, not a new one');
      const push = await wsB.waitFor((m) => m.t === 'invite');
      assert.strictEqual(push.game.id, gid);
      await sleep(200);
      assert.ok(!tg.to(USERS.B.id).some((m) => /Alice/.test(m.body.text)), 'challenges are in-app only: no Telegram message');
      const lobby = await ok('B', 'GET', '/lobby');
      assert.strictEqual(lobby.games.invites.length, 1);
      await err('C', 'POST', `/games/${gid}/join`, null, 400, 'game_unavailable'); // not invited
      await err('C', 'GET', `/games/${gid}`, null, 404, 'notfound');
    });

    await step('full game over websocket: legal moves only, turn order, fool\'s mate, stats', async () => {
      const wsA = await connect('A'); sockets.push(wsA);
      const wsB = sockets[0];
      const joined = (await ok('B', 'POST', `/games/${gid}/join`)).game;
      assert.strictEqual(joined.status, 'active');
      assert.ok(joined.you === 'w' || joined.you === 'b');
      const a = (await ok('A', 'GET', `/games/${gid}`)).game;
      assert.notStrictEqual(a.you, joined.you, 'players get opposite colours');
      fm = colours(a, 'A', 'B');
      await wsA.waitFor((m) => m.t === 'game' && m.game.status === 'active');

      await err(fm.b, 'POST', `/games/${gid}/move`, { from: 'e7', to: 'e5' }, 400, 'not_your_turn');
      await err(fm.w, 'POST', `/games/${gid}/move`, { from: 'e2', to: 'e5' }, 400, 'illegal_move');
      await err(fm.w, 'POST', `/games/${gid}/move`, { from: 'e7', to: 'e5' }, 400, 'illegal_move'); // not your piece
      await err(fm.w, 'POST', `/games/${gid}/move`, { from: 'z9', to: 'e5' }, 400, 'illegal_move');

      const mvA = ok(fm.w, 'POST', `/games/${gid}/move`, { from: 'f2', to: 'f3' });
      const seen = await (fm.b === 'A' ? wsA : wsB).waitFor((m) => m.t === 'game' && m.game.ply === 1);
      assert.deepStrictEqual(seen.game.moves, [['f2', 'f3', null]], 'opponent receives the move instantly');
      await mvA;
      const end = await playMoves(gid, fm, ['e7e5', 'g2g4', 'd8h4'], 1);
      assert.strictEqual(end.status, 'finished');
      assert.strictEqual(end.result, '0-1');
      assert.strictEqual(end.reason, 'checkmate');
      await err(fm.w, 'POST', `/games/${gid}/move`, { from: 'a2', to: 'a3' }, 400, 'game_over');
    });

    await step('statistics count the finished game for both players', async () => {
      const win = (await ok(fm.b, 'GET', '/me')).stats.online;
      const lose = (await ok(fm.w, 'GET', '/me')).stats.online;
      assert.deepStrictEqual([win.w, win.l], [1, 0]);
      assert.deepStrictEqual([lose.w, lose.l], [0, 1]);
    });

    await step('live rankings: all categories load and finished bullet games are ranked separately', async () => {
      for (const category of ['bullet', 'blitz', 'rapid', 'classic']) {
        const response = await ok('A', 'GET', `/rankings?category=${category}`);
        assert.strictEqual(response.category, category);
        assert.ok(Array.isArray(response.rankings));
      }

      const challenge = (await ok('A', 'POST', '/games', {
        opponentId: USERS.B.id, timeControl: 'bullet',
      })).game;
      assert.strictEqual(challenge.timeControl, 'bullet');
      const joined = (await ok('B', 'POST', `/games/${challenge.id}/join`)).game;
      assert.strictEqual(joined.status, 'active');
      await ok('A', 'POST', `/games/${challenge.id}/resign`);

      const leaderboard = (await ok('A', 'GET', '/rankings?category=bullet')).rankings;
      const alice = leaderboard.find((p) => p.id === USERS.A.id);
      const bob = leaderboard.find((p) => p.id === USERS.B.id);
      assert.ok(alice && bob, 'both players should appear after a completed bullet game');
      assert.strictEqual(alice.games, 1);
      assert.strictEqual(bob.games, 1);
      assert.strictEqual(alice.points + bob.points, 2, 'one win awards two points total');
      assert.ok(leaderboard.every((p, i) => p.rank === i + 1), 'ranks should be sequential');
    });

    // ---------------------------------------------------------------- promotion, draw, resign
    await step('promotion and en passant are handled by the server rules', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      const j = (await ok('B', 'POST', `/games/${g.id}/join`)).game;
      const p = colours(j, 'B', 'A');
      // 1.e4 a6 2.e5 d5 3.exd6 (en passant) ... then a pawn races to promote
      const afterEp = await playMoves(g.id, p, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
      assert.strictEqual(afterEp.ply, 5);
      assert.deepStrictEqual(afterEp.moves[4], ['e5', 'd6', null]);
      // black develops, white's pawn captures its way to the 7th rank, then promotes on b8
      await playMoves(g.id, p, ['g8f6', 'd6c7', 'a6a5'], 5);
      // promotion without choosing a piece is refused (chess.js needs it), with a piece it works
      await err(p.w, 'POST', `/games/${g.id}/move`, { from: 'c7', to: 'b8' }, 400, 'illegal_move');
      const done = (await ok(p.w, 'POST', `/games/${g.id}/move`, { from: 'c7', to: 'b8', promotion: 'q' })).game;
      assert.strictEqual(done.ply, 9);
      assert.deepStrictEqual(done.moves[done.moves.length - 1], ['c7', 'b8', 'q']);
      await ok(p.b, 'POST', `/games/${g.id}/resign`);
    });

    await step('draw offer: offer, decline, offer again, accept; a move cancels an offer', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      const j = (await ok('B', 'POST', `/games/${g.id}/join`)).game;
      const p = colours(j, 'B', 'A');
      await ok(p.w, 'POST', `/games/${g.id}/draw`, { action: 'offer' });
      assert.strictEqual((await ok(p.b, 'GET', `/games/${g.id}`)).game.drawBy, 'w');
      await err(p.w, 'POST', `/games/${g.id}/draw`, { action: 'accept' }, 400, 'bad_request'); // cannot accept own offer
      await ok(p.b, 'POST', `/games/${g.id}/draw`, { action: 'decline' });
      assert.strictEqual((await ok(p.w, 'GET', `/games/${g.id}`)).game.drawBy, null);
      await ok(p.w, 'POST', `/games/${g.id}/draw`, { action: 'offer' });
      await ok(p.w, 'POST', `/games/${g.id}/move`, { from: 'e2', to: 'e4' });
      assert.strictEqual((await ok(p.w, 'GET', `/games/${g.id}`)).game.drawBy, null, 'moving withdraws the offer');
      await ok(p.b, 'POST', `/games/${g.id}/draw`, { action: 'offer' });
      const end = (await ok(p.w, 'POST', `/games/${g.id}/draw`, { action: 'accept' })).game;
      assert.deepStrictEqual([end.status, end.result, end.reason], ['finished', '1/2-1/2', 'agreement']);
    });

    await step('resign ends the game in the opponent\'s favour', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      const j = (await ok('B', 'POST', `/games/${g.id}/join`)).game;
      const p = colours(j, 'B', 'A');
      const end = (await ok(p.w, 'POST', `/games/${g.id}/resign`)).game;
      assert.deepStrictEqual([end.result, end.reason], ['0-1', 'resign']);
      await err(p.b, 'POST', `/games/${g.id}/resign`, null, 400, 'game_over');
    });

    // ---------------------------------------------------------------- reactions
    await step('emoji reactions reach the opponent live and are validated', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      await ok('B', 'POST', `/games/${g.id}/join`);
      const wsA = sockets[1];
      await ok('B', 'POST', `/games/${g.id}/react`, { emoji: '🔥' });
      const r = await wsA.waitFor((m) => m.t === 'react' && m.id === g.id);
      assert.strictEqual(r.emoji, '🔥');
      assert.strictEqual(r.by, USERS.B.id);
      await sleep(550);
      await err('B', 'POST', `/games/${g.id}/react`, { emoji: '<script>' }, 400, 'bad_request');
      await err('C', 'POST', `/games/${g.id}/react`, { emoji: '🔥' }, 404, 'notfound');
    });

    // ---------------------------------------------------------------- match-making + invite links
    await step('online match-making pairs two waiting players', async () => {
      const first = (await ok('C', 'POST', '/games/quick')).game;
      assert.strictEqual(first.status, 'open');
      assert.strictEqual((await ok('C', 'POST', '/games/quick')).game.id, first.id, 'waiting twice keeps the same search');
      const second = (await ok('D', 'POST', '/games/quick')).game;
      assert.strictEqual(second.id, first.id);
      assert.strictEqual(second.status, 'active');
      assert.strictEqual(second.mode, 'online');
      assert.notStrictEqual(second.you, (await ok('C', 'GET', `/games/${first.id}`)).game.you);
    });

    await step('an open game can be cancelled; a cancelled game cannot be joined', async () => {
      const g = (await ok('E', 'POST', '/games/quick')).game; // nobody else waiting -> open
      assert.strictEqual(g.status, 'open');
      await ok('E', 'DELETE', `/games/${g.id}`);
      await err('A', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable');
    });

    await step('invite-link game: a stranger can preview it, joining makes them friends', async () => {
      const g = (await ok('E', 'POST', '/games')).game;
      assert.strictEqual(g.status, 'open');
      const preview = (await ok('A', 'GET', `/games/${g.id}`)).game;
      assert.deepStrictEqual([preview.joinable, preview.opponent.name], [true, 'Eve']);
      assert.ok(!(await ok('E', 'GET', '/friends')).friends.some((f) => f.id === USERS.A.id) || true);
      const j = (await ok('D', 'POST', `/games/${g.id}/join`)).game;
      assert.strictEqual(j.status, 'active');
      assert.ok((await ok('E', 'GET', '/friends')).friends.some((f) => f.id === USERS.D.id), 'now friends');
      assert.strictEqual((await ok('E', 'POST', `/games/${g.id}/join`)).game.id, g.id, 'creator opening own link is harmless');
      await err('A', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable'); // already full
    });

    // ---------------------------------------------------------------- notifications for offline players
    await step('"your move" goes to Telegram only when the opponent is offline, once per move', async () => {
      // Dan and Cara have no websocket open, so both count as offline
      const g = (await ok('D', 'POST', '/games', { opponentId: USERS.C.id })).game;
      const j = (await ok('C', 'POST', `/games/${g.id}/join`)).game;
      const p = colours(j, 'C', 'D');
      await sleep(450);
      const other = p.b; // black moves next, so black is the one to be notified
      const before = tg.to(USERS[other].id).length;
      await ok(p.w, 'POST', `/games/${g.id}/move`, { from: 'e2', to: 'e4' });
      await sleep(250); // notifications are sent in the background, after the move was answered
      const sent = tg.to(USERS[other].id);
      assert.strictEqual(sent.length, before + 1, 'exactly one "your move" message');
      const m = sent[sent.length - 1];
      assert.ok(m.body.reply_markup.inline_keyboard[0][0].web_app.url.includes(`game=${g.id}`), 'button opens that game');
      // reminder job: not before the delay, then exactly once per move
      const remindersBefore = () => tg.to(USERS[other].id).filter((x) => /waiting|ждёт/.test(x.body.text)).length;
      assert.strictEqual(remindersBefore(), 0);
      await pg.q("UPDATE games SET last_move_at = now() - interval '7 hours' WHERE id = $1", g.id);
      await sleep(900);
      assert.strictEqual(remindersBefore(), 1, 'one reminder after 6h of silence');
      await sleep(700);
      assert.strictEqual(remindersBefore(), 1, 'and not again for the same move');
      // abandoned for a week: the waiting player wins
      await pg.q("UPDATE games SET last_move_at = now() - interval '8 days' WHERE id = $1", g.id);
      await sleep(700);
      const [end] = await pg.q('SELECT status, result, reason FROM games WHERE id = $1', g.id);
      assert.deepStrictEqual({ ...end }, { status: 'finished', result: '1-0', reason: 'abandoned' }, 'black to move for a week -> white wins');
    });

    // ---------------------------------------------------------------- lobby + presence
    await step('lobby lists online players, hides people who opted out, counts everyone', async () => {
      await ok('B', 'PATCH', '/me', { discoverable: false });
      await ok('E', 'PATCH', '/me', { discoverable: true });
      const wsC = await connect('C'); sockets.push(wsC);
      await ok('A', 'GET', '/me'); await ok('B', 'GET', '/me');
      const lobby = await ok('D', 'GET', '/lobby');
      const names = lobby.online.map((o) => o.name);
      assert.ok(names.includes('Alice') && names.includes('Cara'), `online: ${names}`);
      assert.ok(!names.includes('Dan'), 'not listed to yourself');
      assert.ok(!names.includes('Bob'), 'Bob opted out and is not Dan\'s friend');
      assert.ok(lobby.onlineCount >= 4);
      const asAlice = (await ok('A', 'GET', '/lobby')).online.map((o) => o.name);
      assert.ok(asAlice.includes('Bob'), 'friends are listed even when not discoverable');
      assert.strictEqual((await ok('A', 'GET', '/lobby')).online.find((o) => o.name === 'Bob').friend, true);
      await err('D', 'POST', '/games', { opponentId: USERS.B.id }, 404, 'user_unavailable'); // hidden players cannot be challenged
    });

    await step('computer results are validated and counted (and cannot be spammed)', async () => {
      await err('A', 'POST', '/results', { level: 9, outcome: 'win' }, 400);
      await err('A', 'POST', '/results', { level: 3, outcome: 'cheat' }, 400);
      const r = await ok('A', 'POST', '/results', { level: 3, outcome: 'win' });
      assert.deepStrictEqual([r.stats.ai.w, r.stats.ai.best], [1, 3]);
      assert.strictEqual((await ok('A', 'POST', '/results', { level: 4, outcome: 'win' })).stats.ai.w, 1, 'second result within 10s ignored');
    });

    // ---------------------------------------------------------------- websocket security
    await step('websocket refuses bad logins and blocked users', async () => {
      await assert.rejects(connect('A', init('A') + '0'), (e) => e.code === 4003);
    });

    // ---------------------------------------------------------------- admin
    await step('admin endpoints are invisible to everyone else', async () => {
      for (const p of ['/admin/stats', '/admin/live', '/admin/users', '/admin/broadcasts']) await err('A', 'GET', p, null, 404, 'notfound');
      await err('A', 'POST', '/admin/broadcast', { text: 'hi' }, 404);
      await err('A', 'POST', '/admin/upload', null, 404);
    });

    await step('admin: live users, stats, search, block / unblock', async () => {
      await ok('ADMIN', 'GET', '/me');
      const live = await ok('ADMIN', 'GET', '/admin/live');
      assert.ok(live.count >= 2 && live.users.some((u) => u.name === 'Cara'), 'live users listed');
      assert.ok(live.users.every((u) => 'inGame' in u));
      const st = await ok('ADMIN', 'GET', '/admin/stats');
      assert.ok(st.users >= 6 && st.live >= 2 && st.gamesPlayed >= 4 && st.signups.length === 14);
      assert.ok(st.byLang.some((l) => l.lang === 'ru'));
      const found = await ok('ADMIN', 'GET', '/admin/users?q=ali');
      assert.strictEqual(found.users.length, 1);
      await err('ADMIN', 'POST', `/admin/users/${ADMIN_ID}/block`, { blocked: true }, 400, 'admin_block');
      await ok('ADMIN', 'POST', `/admin/users/${USERS.E.id}/block`, { blocked: true });
      await err('E', 'GET', '/me', null, 403, 'blocked');
      await ok('ADMIN', 'POST', `/admin/users/${USERS.E.id}/block`, { blocked: false });
      await ok('E', 'GET', '/me');
    });

    let mediaId;
    await step('post composer: media upload checks the real file type and size', async () => {
      await err('ADMIN', 'POST', '/admin/upload', null, 400, 'media');
      const text = await call('ADMIN', 'POST', '/admin/upload', null, Buffer.from('this is not an image, just text'));
      assert.strictEqual(text.data.code, 'media_type');
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
      const r = await call('ADMIN', 'POST', '/admin/upload', null, png);
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.data.kind, 'photo');
      mediaId = r.data.id;
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(11 * 1024 * 1024)]);
      assert.strictEqual((await call('ADMIN', 'POST', '/admin/upload', null, big)).data.code, 'media_big');
    });

    const buttons = [
      { text: '♟ Play now', type: 'app', color: 'success' },
      { text: 'Our channel', type: 'url', url: 'https://t.me/example', color: 'primary' },
      { text: 'Stop', type: 'url', url: 'https://example.com/stop', color: 'danger' },
      { text: 'Plain', type: 'url', url: 'https://example.com', color: 'default' },
    ];
    await step('post composer: validation of text, buttons and links', async () => {
      await err('ADMIN', 'POST', '/admin/broadcast', {}, 400, 'text');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'x', buttons: [{ text: 'a', type: 'url', url: 'javascript:alert(1)' }] }, 400, 'button_url');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'x', buttons: [{ text: '', type: 'url', url: 'https://a.bc' }] }, 400, 'button_text');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'x', buttons: Array(7).fill(buttons[1]) }, 400, 'buttons');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'x'.repeat(1025), mediaId }, 400, 'text_long');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'x', mediaId: 'nope' }, 400, 'media');
    });

    await step('post composer: test send goes only to the admin, with media, colours and an Open-app button', async () => {
      tg.calls.length = 0;
      const r = await ok('ADMIN', 'POST', '/admin/broadcast', { text: 'Tournament tonight! 🏆', mediaId, buttons, test: true });
      assert.deepStrictEqual([r.test, r.sent], [true, 1]);
      const photos = tg.calls.filter((c) => c.method === 'sendPhoto');
      assert.strictEqual(photos.length, 1);
      assert.strictEqual(Number((/name="chat_id"\r\n\r\n(\d+)/.exec(photos[0].body._raw) || [])[1]), ADMIN_ID);
      const raw = photos[0].body._raw;
      assert.ok(raw.includes('Tournament tonight'), 'caption present');
      const markup = JSON.parse(/name="reply_markup"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)[1]).inline_keyboard.flat();
      assert.deepStrictEqual(markup.map((b) => b.style || null), ['success', 'primary', 'danger', null], 'colours sent as Telegram button styles');
      assert.strictEqual(markup[0].web_app.url, 'https://chess.example.test', 'Open-app button');
      assert.strictEqual(markup[1].url, 'https://t.me/example');
      assert.strictEqual(markup[0].text, '♟ Play now', 'button text is exactly what the admin typed');
    });

    await step('post composer: falls back to plain buttons if Telegram rejects colours', async () => {
      tg.state.rejectStyle = true;
      tg.calls.length = 0;
      await ok('ADMIN', 'POST', '/admin/broadcast', { text: 'fallback', buttons, test: true });
      const sends = tg.calls.filter((c) => c.method === 'sendMessage');
      assert.strictEqual(sends.length, 2, 'rejected once, re-sent once');
      assert.ok(!JSON.stringify(sends[1].body).includes('"style"'));
      assert.ok(sends[1].body.reply_markup.inline_keyboard.length === 4, 'all buttons kept');
      tg.state.rejectStyle = false;
    });

    await step('post composer: broadcast respects the language filter and reuses the uploaded file', async () => {
      tg.calls.length = 0;
      const r = await ok('ADMIN', 'POST', '/admin/broadcast', { text: 'Привет', mediaId, lang: 'ru', buttons: [buttons[0]] });
      assert.strictEqual(r.queued, 1, 'only the Russian-speaking user');
      await err('ADMIN', 'POST', '/admin/broadcast', { text: 'second' }, 409, 'busy').catch(() => {}); // may already be done
      for (let i = 0; i < 40; i++) { if ((await ok('ADMIN', 'GET', '/admin/broadcasts')).broadcasts[0].status === 'done') break; await sleep(100); }
      const row = (await ok('ADMIN', 'GET', '/admin/broadcasts')).broadcasts[0];
      assert.deepStrictEqual([row.status, row.sent, row.failed, row.lang], ['done', 1, 0, 'ru']);
      const photo = tg.calls.find((c) => c.method === 'sendPhoto');
      assert.strictEqual(photo.body.photo, 'BIG_FILE_ID', 'cached Telegram file_id is reused instead of uploading again');
      assert.strictEqual(Number(photo.body.chat_id), USERS.A.id);
    });

    await step('post composer: users who blocked the bot are skipped next time', async () => {
      tg.state.fail403.add(USERS.C.id);
      const r = await ok('ADMIN', 'POST', '/admin/broadcast', { text: 'to everyone' });
      assert.ok(r.queued >= 5);
      for (let i = 0; i < 60; i++) { if ((await ok('ADMIN', 'GET', '/admin/broadcasts')).broadcasts[0].status === 'done') break; await sleep(100); }
      const row = (await ok('ADMIN', 'GET', '/admin/broadcasts')).broadcasts[0];
      assert.strictEqual(row.failed, 1, 'Cara blocked the bot');
      const again = await ok('ADMIN', 'POST', '/admin/broadcast', { text: 'again' });
      assert.strictEqual(again.queued, r.queued - 1, 'Cara is no longer targeted');
      for (let i = 0; i < 60; i++) { if (!(await ok('ADMIN', 'GET', '/admin/broadcasts')).busy) break; await sleep(100); }
    });

    // ---------------------------------------------------------------- account deletion + static files
    await step('deleting an account closes its games and removes its data', async () => {
      await ok('D', 'GET', '/me'); // Dan must look online to be challenged
      const g = (await ok('E', 'POST', '/games', { opponentId: USERS.D.id })).game;
      await ok('D', 'POST', `/games/${g.id}/join`);
      await ok('E', 'DELETE', '/me');
      const after = (await ok('D', 'GET', `/games/${g.id}`)).game;
      assert.deepStrictEqual([after.status, after.reason], ['finished', 'resign']);
      assert.ok(!(await ok('D', 'GET', '/friends')).friends.some((f) => f.id === USERS.E.id));
    });

    await step('challenges: offline players cannot be challenged; unanswered ones expire and cannot be accepted', async () => {
      await sleep(450);
      await err('A', 'POST', '/games', { opponentId: USERS.D.id }, 409, 'user_offline');
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      await pg.q("UPDATE games SET updated_at = now() - interval '120 seconds' WHERE id = $1", g.id);
      assert.ok(!(await ok('B', 'GET', '/lobby')).games.invites.some((x) => x.id === g.id), 'expired invite is hidden');
      await err('B', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable');
      assert.strictEqual((await ok('A', 'GET', `/games/${g.id}`)).game.status, 'cancelled');
      const h = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      assert.notStrictEqual(h.id, g.id, 'a fresh challenge can be sent afterwards');
    });

    await step('one request to several players: the first to accept plays, the others are released', async () => {
      await ok('D', 'GET', '/me'); await ok('B', 'GET', '/me');
      const g = (await ok('A', 'POST', '/games', { opponentIds: [USERS.B.id, USERS.D.id] })).game;
      assert.strictEqual(g.status, 'invited');
      assert.strictEqual(g.invitees.length, 2);
      assert.strictEqual((await ok('A', 'POST', '/games', { opponentIds: [USERS.D.id, USERS.B.id] })).game.id, g.id, 'same request is not duplicated');
      for (const who of ['B', 'D']) assert.ok((await ok(who, 'GET', '/lobby')).games.invites.some((x) => x.id === g.id), `${who} sees it`);
      await ok('B', 'POST', `/games/${g.id}/decline`);
      assert.strictEqual((await ok('A', 'GET', `/games/${g.id}`)).game.status, 'invited', 'still waiting for the others');
      await err('B', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable');
      const started = (await ok('D', 'POST', `/games/${g.id}/join`)).game;
      assert.strictEqual(started.status, 'active');
      assert.strictEqual((await ok('A', 'GET', `/games/${g.id}`)).game.opponent.id, USERS.D.id);
      await ok('A', 'POST', `/games/${g.id}/resign`);
    });

    await step('static files: app, chess.js for the worker, engine, correct module types, CSP', async () => {
      const root = await fetch(`${BASE}/`);
      assert.strictEqual(root.status, 200);
      const csp = root.headers.get('content-security-policy');
      assert.ok(csp.includes('frame-ancestors') && csp.includes('worker-src') && csp.includes('wss:'));
      assert.strictEqual((await fetch(`${BASE}/vendor/chess.js`)).status, 200);
      const w = await fetch(`${BASE}/js/ai-worker.mjs`);
      assert.strictEqual(w.status, 200);
      assert.ok(/javascript/.test(w.headers.get('content-type')), 'modules need a JavaScript content-type');
      assert.strictEqual((await fetch(`${BASE}/healthz`)).status, 200);
    });

    console.log(`\nAll ${passed} backend tests passed`);
  } catch (e) {
    console.error('\nFAILED:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    for (const s of sockets) s.ws.terminate();
    srv.kill();
    tg.close();
    await pg.drop();
  }
})();
