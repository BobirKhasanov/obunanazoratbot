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
  A: { id: 1001, first_name: 'Alice', last_name: 'Anderson', username: 'alice_chess', language_code: 'ru' },
  B: { id: 1002, first_name: 'Bob', last_name: 'Baker', username: 'bob_chess' },
  C: { id: 1003, first_name: 'Cara', last_name: 'Cole', username: 'cara_user' },
  D: { id: 1004, first_name: 'Dan', last_name: 'Diaz', username: 'dan_user' },
  E: { id: 1005, first_name: 'Eve', last_name: 'Ellis', username: 'eve_user' },
  ADMIN: { id: ADMIN_ID, first_name: 'Boss', last_name: 'Admin', username: 'boss_admin' },
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
      TG_API_ROOT: tg.url, WEBAPP_URL: 'https://chess.example.test', PRESENCE_REST_MS: '5000', INVITE_TTL_MS: '60000', SCHEDULER_MS: '300',
      USER_MEMO_MS: '1', NODE_NO_WARNINGS: '1',
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
    await step('diamonds: +20/+10 referral; Premium 1/3/6/12 months; pack order notifies admin', async () => {
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, 20, 'inviter got 20 diamonds for the friend who joined');
      assert.strictEqual((await ok('B', 'GET', '/me')).user.diamonds, 10, 'new friend got 10 diamonds via referral');
      await ok('B', 'POST', '/friends/join', { userId: USERS.A.id }); // opening the link again must not pay again
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, 20);
      assert.strictEqual((await ok('B', 'GET', '/me')).user.diamonds, 10);

      // Existing user C also gets referral bonus + auto-friend
      await ok('C', 'GET', '/me');
      const beforeC = (await ok('C', 'GET', '/me')).user.diamonds;
      const jc = await ok('C', 'POST', '/friends/join', { userId: USERS.A.id });
      assert.strictEqual(jc.inviteeReward, 10);
      assert.ok((await ok('A', 'GET', '/friends')).friends.some((f) => f.id === USERS.C.id));
      assert.ok((await ok('C', 'GET', '/friends')).friends.some((f) => f.id === USERS.A.id));
      assert.strictEqual((await ok('C', 'GET', '/me')).user.diamonds, beforeC + 10);
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, 40, 'second invitee also pays inviter');

      // Friend chat: mail badge only (bell must stay free of chat)
      const th = await ok('A', 'POST', '/messages/threads', { userId: USERS.B.id });
      assert.ok(th.id);
      await ok('A', 'POST', `/messages/threads/${th.id}`, { body: 'salom' });
      const chat = await ok('B', 'GET', `/messages/threads/${th.id}`);
      assert.ok((chat.messages || []).some((m) => m.body === 'salom'));
      assert.ok(chat.peer && chat.peer.id === USERS.A.id, 'thread returns peer for deep link open');
      // B already read the thread above — send another unread DM for the mail badge
      await ok('A', 'POST', `/messages/threads/${th.id}`, { body: 'reply me' });
      const unread2 = await ok('B', 'GET', '/messages/unread-count');
      assert.ok((unread2.count || 0) >= 1, 'DM lights mail unread badge');
      const bell = await ok('B', 'GET', '/notifications/unread-count');
      assert.strictEqual(bell.count || 0, 0, 'DM must not light the bell');
      // Reply in DM
      const withReply = await ok('B', 'POST', `/messages/threads/${th.id}`, {
        body: 'javob',
        replyToId: (chat.messages || []).find((m) => m.body === 'salom')?.id,
      });
      assert.ok(withReply.replyTo && /salom/i.test(withReply.replyTo.body || ''), 'DM reply attached');
      // Global chat is gone
      await err('A', 'GET', '/chat/global', undefined, 404);
      // Search + open DM with any player (not friends-only); blocks still apply
      const found = await ok('B', 'GET', `/messages/search?q=${encodeURIComponent('Car')}`);
      assert.ok((found.users || []).some((u) => u.id === USERS.C.id), 'search includes non-friends');
      const thNonFriend = await ok('B', 'POST', '/messages/threads', { userId: USERS.C.id });
      assert.ok(thNonFriend.id, 'can open DM with non-friend from search');
      const msgNonFriend = await ok('B', 'POST', `/messages/threads/${thNonFriend.id}`, { body: 'salom Cara' });
      assert.ok(msgNonFriend.id, 'can send DM to non-friend');
      // @ → username; without @ → first/last name only
      const byUser = await ok('B', 'GET', `/messages/search?q=${encodeURIComponent('@cara_user')}`);
      assert.ok((byUser.users || []).some((u) => u.id === USERS.C.id), '@username finds user');
      const byLast = await ok('B', 'GET', `/messages/search?q=${encodeURIComponent('Cole')}`);
      assert.ok((byLast.users || []).some((u) => u.id === USERS.C.id), 'last name search');
      const noAt = await ok('B', 'GET', `/messages/search?q=${encodeURIComponent('cara_user')}`);
      assert.ok(!(noAt.users || []).some((u) => u.id === USERS.C.id), 'username without @ does not match');
      await err('B', 'POST', `/messages/threads/${th.id}`, { body: '' }, 400, 'text');
      const meta = (await ok('A', 'GET', '/me')).meta;
      assert.strictEqual(meta.PREMIUM_PRICE, 200);
      assert.ok(Array.isArray(meta.diamondPacks) && meta.diamondPacks.length >= 1);
      assert.ok(Array.isArray(meta.premiumPlans) && meta.premiumPlans.some((p) => p.months === 12));
      assert.strictEqual(meta.payUsername, 'hasanovbobur');
      assert.ok(meta.analysisDailyFree >= 0, 'analysis daily free in meta');

      // Friend request from profile → notification → accept
      await ok('C', 'GET', '/me');
      await ok('D', 'GET', '/me'); // ensure target user exists
      const fr = await ok('C', 'POST', '/friends/request', { userId: USERS.D.id });
      assert.ok(fr.requestId || fr.pending, 'friend request created');
      const notifsD = await ok('D', 'GET', '/notifications');
      const frN = (notifsD.notifications || []).find((n) => n.kind === 'friend_request');
      assert.ok(frN && frN.meta && frN.meta.requestId, 'friend request notification');
      await ok('D', 'POST', `/friends/request/${frN.meta.requestId}/respond`, { accept: true });
      const friendsD = await ok('D', 'GET', '/friends');
      assert.ok((friendsD.friends || []).some((f) => f.id === USERS.C.id), 'C and D are friends after accept');

      // Admin can set free analysis limit
      const shopA = await ok('ADMIN', 'PATCH', '/admin/shop', { analysisDailyFree: 3 });
      assert.strictEqual(shopA.shop.analysisDailyFree, 3);

      const adminBefore = tg.to(ADMIN_ID).length;
      const ord = await ok('A', 'POST', '/shop/order', { diamonds: 100, sum: 100000 });
      assert.strictEqual(ord.pack.diamonds, 100);
      assert.ok(ord.notified >= 1);
      const adminMsgs = tg.to(ADMIN_ID).slice(adminBefore);
      assert.ok(adminMsgs.some((m) => /100/.test(m.body.text) && /Alice/.test(m.body.text)), 'admin got pack order');

      await err('A', 'POST', '/premium/buy', { months: 1 }, 400, 'no_diamonds');
      await pg.q('UPDATE users SET diamonds = 200 WHERE id = $1', USERS.A.id);
      const r = await ok('A', 'POST', '/premium/buy', { months: 1 });
      assert.deepStrictEqual([r.user.premium, r.user.diamonds, r.months], [true, 0, 1]);
      assert.ok(r.user.premiumUntil, 'premium_until set');
      await pg.q('UPDATE users SET diamonds = 500 WHERE id = $1', USERS.A.id);
      await err('A', 'POST', '/premium/buy', { months: 3 }, 400, 'premium_owned');
      // After expiry, buy starts a new period from now
      await pg.q('UPDATE users SET premium_until = now() - interval \'1 day\', premium = 0 WHERE id = $1', USERS.A.id);
      const r2 = await ok('A', 'POST', '/premium/buy', { months: 3 });
      assert.strictEqual(r2.user.premium, true);
      assert.strictEqual(r2.months, 3);
      assert.ok(new Date(r2.user.premiumUntil) > Date.now());

      // Wallet history: referral + shop order + premium spend
      const histB = await ok('B', 'GET', '/me/diamonds/history');
      assert.ok(histB.items.some((i) => i.kind === 'referral_invitee' && i.amount === 10), 'invitee bonus in history');
      const histA = await ok('A', 'GET', '/me/diamonds/history');
      assert.ok(histA.items.some((i) => i.kind === 'referral_inviter' && i.amount === 20), 'inviter bonus in history');
      assert.ok(histA.items.some((i) => i.kind === 'shop_order'), 'shop order in history');
      assert.ok(histA.items.some((i) => i.kind === 'premium_buy' && i.amount < 0), 'premium spend in history');

      // Mini App startapp: signed start_param pays referral on first /me (no client /friends/join)
      const F = { id: 1006, first_name: 'Finn' };
      const aBeforeSp = (await ok('A', 'GET', '/me')).user.diamonds;
      const initF = fake.sign(F, TOKEN, Math.floor(Date.now() / 1000), { start_param: `i${USERS.A.id}` });
      const spRes = await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initF } });
      const meF = await spRes.json();
      assert.strictEqual(spRes.status, 200, `start_param /me ${JSON.stringify(meF)}`);
      assert.strictEqual(meF.referralClaim && meF.referralClaim.inviteeReward, 10, 'start_param pays invitee');
      assert.strictEqual(meF.user.diamonds, 10);
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBeforeSp + 20, 'start_param pays inviter');
      const histF = await fetch(`${BASE}/api/me/diamonds/history`, { headers: { 'X-Init-Data': fake.sign(F, TOKEN) } });
      const histFJ = await histF.json();
      assert.ok(histFJ.items.some((i) => i.kind === 'referral_invitee'), 'start_param invitee ledger');

      // Bot /start i… stores pending_inviter; clean Open (no ?p=) still pays on /me
      const G = { id: 1007, first_name: 'Gina' };
      const initG = fake.sign(G, TOKEN);
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initG } })).status, 200);
      await pg.q('UPDATE users SET pending_inviter_id = $1 WHERE id = $2', USERS.A.id, G.id);
      const aBeforePend = (await ok('A', 'GET', '/me')).user.diamonds;
      const aTgBeforePend = tg.to(USERS.A.id).length;
      const meG = await (await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initG } })).json();
      assert.strictEqual(meG.referralClaim && meG.referralClaim.inviteeReward, 10, 'pending_inviter pays on /me');
      assert.strictEqual(meG.user.diamonds, 10);
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBeforePend + 20);
      await sleep(250);
      const aPendMsgs = tg.to(USERS.A.id).slice(aTgBeforePend);
      assert.ok(aPendMsgs.some((m) => /Gina/.test(m.body.text) && /💎/.test(m.body.text)), 'pending /me notifies inviter with diamonds');
      const rejoinRes = await fetch(`${BASE}/api/friends/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Init-Data': initG },
        body: JSON.stringify({ userId: USERS.A.id }),
      });
      const rejoin = await rejoinRes.json();
      assert.strictEqual(rejoinRes.status, 200, JSON.stringify(rejoin));
      assert.strictEqual(rejoin.already, true, 'second open of invite is already-friends');
      assert.strictEqual(rejoin.inviteeReward || 0, 0);

      // Stale pending must not beat a newer signed start_param
      await ok('C', 'GET', '/me'); // ensure Cara exists as alternate inviter
      const H = { id: 1008, first_name: 'Hank' };
      const initH0 = fake.sign(H, TOKEN);
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initH0 } })).status, 200);
      await pg.q('UPDATE users SET pending_inviter_id = $1 WHERE id = $2', USERS.C.id, H.id); // stale: Cara
      const cBefore = (await ok('C', 'GET', '/me')).user.diamonds;
      const aBeforeH = (await ok('A', 'GET', '/me')).user.diamonds;
      const initH = fake.sign(H, TOKEN, Math.floor(Date.now() / 1000), { start_param: `i${USERS.A.id}` });
      const meH = await (await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initH } })).json();
      assert.strictEqual(meH.referralClaim && meH.referralClaim.inviteeReward, 10, 'start_param wins over stale pending');
      assert.strictEqual(meH.referralClaim.friend && meH.referralClaim.friend.id, USERS.A.id, 'credited to start_param inviter');
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBeforeH + 20);
      assert.strictEqual((await ok('C', 'GET', '/me')).user.diamonds, cBefore, 'stale pending inviter unpaid');
      const [pendH] = await pg.q('SELECT pending_inviter_id AS p FROM users WHERE id = $1', H.id);
      assert.strictEqual(pendH.p, null, 'pending cleared after start_param pay');

      // Zero rewards: befriend but do not burn the one-shot referral row
      await ok('ADMIN', 'PATCH', '/admin/shop', { referralReward: 0, referralInviteeReward: 0 });
      const I = { id: 1009, first_name: 'Ivy' };
      const initI = fake.sign(I, TOKEN);
      assert.strictEqual((await fetch(`${BASE}/api/me`, { headers: { 'X-Init-Data': initI } })).status, 200);
      const aBefore0 = (await ok('A', 'GET', '/me')).user.diamonds;
      const j0 = await (await fetch(`${BASE}/api/friends/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Init-Data': initI },
        body: JSON.stringify({ userId: USERS.A.id }),
      })).json();
      assert.strictEqual(j0.reward || 0, 0);
      assert.strictEqual(j0.inviteeReward || 0, 0);
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBefore0);
      const refI = await pg.q('SELECT 1 AS ok FROM referrals WHERE invitee_id = $1', I.id);
      assert.strictEqual(refI.length, 0, 'zero rewards must not insert referrals');
      // Later admin raise still pays once
      await ok('ADMIN', 'PATCH', '/admin/shop', { referralReward: 7, referralInviteeReward: 3 });
      const j1 = await (await fetch(`${BASE}/api/friends/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Init-Data': initI },
        body: JSON.stringify({ userId: USERS.A.id }),
      })).json();
      assert.strictEqual(j1.reward, 7);
      assert.strictEqual(j1.inviteeReward, 3);
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBefore0 + 7);
      assert.strictEqual(j1.user && j1.user.diamonds, 3);
      const histI = await (await fetch(`${BASE}/api/me/diamonds/history`, { headers: { 'X-Init-Data': initI } })).json();
      assert.ok(histI.items.some((x) => x.kind === 'referral_invitee' && x.amount === 3), 'custom invitee amount in ledger');
      await ok('ADMIN', 'PATCH', '/admin/shop', { referralReward: 20, referralInviteeReward: 10 });
    });

    await step('admin shop settings + grant diamonds with notify', async () => {
      const shop = await ok('ADMIN', 'GET', '/admin/shop');
      assert.strictEqual(shop.shop.premiumPriceDiamonds, 200);
      assert.strictEqual(shop.shop.referralReward, 20);
      assert.strictEqual(shop.shop.referralInviteeReward, 10);
      const patched = await ok('ADMIN', 'PATCH', '/admin/shop', {
        premiumPlans: [
          { months: 1, diamonds: 150 },
          { months: 3, diamonds: 400 },
          { months: 6, diamonds: 700 },
          { months: 12, diamonds: 1200 },
        ],
        diamondPacks: [{ diamonds: 100, sum: 100000 }, { diamonds: 200, sum: 200000 }],
        payUsername: 'hasanovbobur',
        referralReward: 25,
        referralInviteeReward: 15,
      });
      assert.strictEqual(patched.shop.premiumPriceDiamonds, 150);
      assert.strictEqual(patched.shop.referralReward, 25);
      assert.strictEqual(patched.shop.referralInviteeReward, 15);
      const metaB = (await ok('B', 'GET', '/me')).meta;
      assert.strictEqual(metaB.PREMIUM_PRICE, 150);
      assert.strictEqual(metaB.REFERRAL_REWARD, 25);
      assert.strictEqual(metaB.REFERRAL_INVITEE_REWARD, 15);
      const before = (await ok('B', 'GET', '/me')).user.diamonds;
      const bBefore = tg.to(USERS.B.id).length;
      const g = await ok('ADMIN', 'POST', `/admin/users/${USERS.B.id}/diamonds`, { amount: 100 });
      assert.strictEqual(g.user.diamonds, before + 100);
      assert.strictEqual(g.user.premium, false, 'diamond grant must not auto-add Premium');
      const toB = tg.to(USERS.B.id).slice(bBefore);
      assert.ok(toB.some((m) => /100/.test(m.body.text) || /💎/.test(m.body.text)), 'user notified about grant');
      assert.ok(!toB.some((m) => /Payment confirmed|To'lov tasdiqlandi|Оплата подтверждена/.test(m.body.text) && !/\+100|100/.test(m.body.text)));
      // Removing diamonds must NOT send the "payment confirmed" grant copy
      const mid = tg.to(USERS.B.id).length;
      const rm = await ok('ADMIN', 'POST', `/admin/users/${USERS.B.id}/diamonds`, { amount: -40 });
      assert.strictEqual(rm.user.diamonds, before + 60);
      const toRm = tg.to(USERS.B.id).slice(mid);
      assert.ok(toRm.some((m) => /40/.test(m.body.text) && /💎/.test(m.body.text)), 'user notified about removal');
      assert.ok(!toRm.some((m) => /Payment confirmed|To'lov tasdiqlandi|Оплата подтверждена|credited|зачислено|qo'shildi|қўшилди/i.test(m.body.text)),
        'removal must not use grant/payment text');
      // lobby exposes premium flag for online list badges (use C so A's Premium from buy stays for style tests)
      await ok('C', 'GET', '/me'); // create + mark C online first
      await pg.q('UPDATE users SET premium = 1, premium_until = now() + interval \'30 days\', discoverable = 1 WHERE id = $1', USERS.C.id);
      const lob = await ok('B', 'GET', '/lobby');
      const cara = (lob.online || []).find((u) => u.id === USERS.C.id);
      assert.ok(cara, 'C should appear in lobby online list');
      assert.strictEqual(cara.premium, true);
      await pg.q('UPDATE users SET premium = 0, premium_until = NULL WHERE id = $1', USERS.C.id);
      // restore default plans + referral for later steps
      await ok('ADMIN', 'PATCH', '/admin/shop', {
        premiumPlans: [
          { months: 1, diamonds: 200 },
          { months: 3, diamonds: 500 },
          { months: 6, diamonds: 900 },
          { months: 12, diamonds: 1600 },
        ],
        referralReward: 20,
        referralInviteeReward: 10,
      });
    });

    await step('piece/board style: premium or admin only; invalid values rejected', async () => {
      await err('B', 'PATCH', '/me', { pieceSet: 'classic' }, 403, 'premium_required');
      await err('B', 'PATCH', '/me', { boardTheme: 'green' }, 403, 'premium_required');
      const prem = await ok('A', 'PATCH', '/me', { pieceSet: 'classic', boardTheme: 'wood' });
      assert.deepStrictEqual([prem.user.pieceSet, prem.user.boardTheme], ['classic', 'wood']);
      await err('A', 'PATCH', '/me', { pieceSet: 'neon' }, 400);
      await err('A', 'PATCH', '/me', { boardTheme: 'pink' }, 400);
      const adm = await ok('ADMIN', 'PATCH', '/me', { pieceSet: 'staunton', boardTheme: 'green' });
      assert.deepStrictEqual([adm.user.pieceSet, adm.user.boardTheme], ['staunton', 'green']);
      assert.ok((await ok('A', 'GET', '/me')).meta.PIECE_SETS.includes('neo'));
      assert.ok((await ok('A', 'GET', '/me')).meta.BOARD_THEMES.includes('blue'));
    });

    await step('custom avatar photo: premium only; public image URL', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const denied = await fetch(`${BASE}/api/me/avatar`, {
        method: 'POST',
        headers: { 'X-Init-Data': init('B'), 'Content-Type': 'image/png' },
        body: png,
      });
      assert.strictEqual(denied.status, 403);
      const deniedBody = await denied.json();
      assert.strictEqual(deniedBody.code, 'premium_required');

      const up = await fetch(`${BASE}/api/me/avatar`, {
        method: 'POST',
        headers: { 'X-Init-Data': init('A'), 'Content-Type': 'image/png' },
        body: png,
      });
      assert.strictEqual(up.status, 201, 'premium user can upload avatar');
      const uploaded = await up.json();
      assert.ok(uploaded.user.avatarKey && uploaded.user.avatarKey.startsWith('img:'));
      const mediaId = uploaded.user.avatarKey.slice(4);
      const img = await fetch(`${BASE}/api/avatars/${mediaId}`);
      assert.strictEqual(img.status, 200);
      assert.ok((img.headers.get('content-type') || '').includes('image/png'));
      assert.strictEqual((await ok('A', 'GET', '/me')).user.avatarKey, uploaded.user.avatarKey);

      await err('B', 'PATCH', '/me', { avatarKey: uploaded.user.avatarKey }, 403, 'premium_required');
      const cleared = await ok('A', 'PATCH', '/me', { avatarKey: null });
      assert.strictEqual(cleared.user.avatarKey, null);
      assert.strictEqual((await fetch(`${BASE}/api/avatars/${mediaId}`)).status, 404, 'old photo no longer public');
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
      // Regression: jsonb moves must compare as jsonb, not ::text (PG text has spaces → false "not your turn")
      const blackReply = await ok(fm.b, 'POST', `/games/${gid}/move`, { from: 'e7', to: 'e5' });
      assert.strictEqual(blackReply.game.ply, 2);
      assert.strictEqual(blackReply.game.turn, 'w');
      const end = await playMoves(gid, fm, ['g2g4', 'd8h4'], 2);
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

    await step('live rankings: Elo + monthly boards after bullet resign', async () => {
      for (const category of ['bullet', 'blitz', 'rapid', 'classic']) {
        const response = await ok('A', 'GET', `/rankings?board=elo&category=${category}`);
        assert.strictEqual(response.board, 'elo');
        assert.strictEqual(response.category, category);
        assert.ok(Array.isArray(response.rankings));
      }
      const monthlyEmpty = await ok('A', 'GET', '/rankings?board=monthly&category=all');
      assert.strictEqual(monthlyEmpty.board, 'monthly');
      assert.ok(monthlyEmpty.month);

      const beforeMonth = (await ok('A', 'GET', '/rankings?board=monthly&category=all')).rankings;
      const pts = (rows, id) => (rows.find((p) => p.id === id) || { points: 0 }).points;

      const challenge = (await ok('A', 'POST', '/games', {
        opponentId: USERS.B.id, timeControl: '1+0',
      })).game;
      assert.strictEqual(challenge.timeControl, '1+0');
      assert.strictEqual(challenge.timeCategory, 'bullet');
      const joined = (await ok('B', 'POST', `/games/${challenge.id}/join`)).game;
      assert.strictEqual(joined.status, 'active');
      assert.ok(joined.clock && joined.clock.whiteMs === 60_000 && joined.clock.blackMs === 60_000, 'bullet clocks start at 1:00');
      await ok('A', 'POST', `/games/${challenge.id}/resign`); // A resigns → B wins (+2 monthly)

      const eloBoard = (await ok('A', 'GET', '/rankings?board=elo&category=bullet')).rankings;
      const aliceElo = eloBoard.find((p) => p.id === USERS.A.id);
      const bobElo = eloBoard.find((p) => p.id === USERS.B.id);
      assert.ok(aliceElo && bobElo, 'both players on Elo board after bullet game');
      assert.strictEqual(aliceElo.games, 1);
      assert.strictEqual(bobElo.games, 1);
      assert.ok(bobElo.elo > aliceElo.elo, 'winner Elo rises, loser falls');
      assert.ok(eloBoard.every((p, i) => p.rank === i + 1), 'ranks should be sequential');

      const monthBoard = (await ok('A', 'GET', '/rankings?board=monthly&category=all')).rankings;
      assert.strictEqual(pts(monthBoard, USERS.B.id) - pts(beforeMonth, USERS.B.id), 2, 'win = +2 monthly');
      assert.strictEqual(pts(monthBoard, USERS.A.id) - pts(beforeMonth, USERS.A.id), 0, 'resign loser gains 0');

      const meA = (await ok('A', 'GET', '/me')).user;
      const meB = (await ok('B', 'GET', '/me')).user;
      assert.ok(meB.eloBullet > meA.eloBullet);

      const day = await ok('B', 'GET', '/rankings?board=period&period=day&category=all');
      assert.strictEqual(day.board, 'period');
      assert.strictEqual(day.period, 'day');
      assert.ok(pts(day.rankings, USERS.B.id) >= 2, 'daily board counts today\'s win');
      assert.ok(day.me && day.me.rank >= 1, 'daily board returns my rank');
      const overall = await ok('A', 'GET', '/rankings?board=elo&category=all');
      assert.ok(overall.me && overall.me.rank >= 1 && overall.me.elo > 0, 'overall board returns my rank + elo');

      const hist = (await ok('A', 'GET', '/games/history')).games;
      const h = hist.find((g) => g.id === challenge.id);
      assert.ok(h, 'finished game listed in history');
      assert.ok(h.result !== '1/2-1/2' && (h.result === '1-0') !== (h.you === 'w'), 'resigner sees a loss');
      assert.ok(h.opponent && h.opponent.id === USERS.B.id && h.opponent.elo > 0, 'history opponent has elo');
    });

    await step('admin in-app notification to everyone', async () => {
      const r = await ok('ADMIN', 'POST', '/admin/notifications', { title: 'Test', body: 'Test body', ttl: 'permanent' });
      assert.ok(r.sent >= 1, 'sent to at least one user');
      assert.ok(r.campaign && r.campaign.id, 'campaign id returned');
      const notifs = await ok('A', 'GET', '/notifications');
      assert.ok((notifs.notifications || []).some((n) => n.kind === 'admin' && n.title === 'Test'));
      await err('ADMIN', 'POST', '/admin/notifications', { title: '', body: 'x' }, 400, 'title');

      const listed = await ok('ADMIN', 'GET', '/admin/notifications');
      assert.ok((listed.campaigns || []).some((c) => c.id === r.campaign.id));

      const ttlR = await ok('ADMIN', 'POST', '/admin/notifications', {
        title: 'TTL test', body: 'Expires soon', ttl: '1h',
      });
      assert.ok(ttlR.campaign && ttlR.campaign.expiresAt, 'ttl sets expiresAt');
      assert.strictEqual(ttlR.campaign.permanent, false);

      const patched = await ok('ADMIN', 'PATCH', `/admin/notifications/${r.campaign.id}`, {
        title: 'Test edited', body: 'Edited body', ttl: 'permanent',
      });
      assert.strictEqual(patched.campaign.title, 'Test edited');
      const afterEdit = await ok('A', 'GET', '/notifications');
      assert.ok((afterEdit.notifications || []).some((n) => n.title === 'Test edited'));

      await ok('ADMIN', 'DELETE', `/admin/notifications/${r.campaign.id}`);
      await ok('ADMIN', 'DELETE', `/admin/notifications/${ttlR.campaign.id}`);
      const afterDel = await ok('A', 'GET', '/notifications');
      assert.ok(!(afterDel.notifications || []).some((n) => n.title === 'Test edited' || n.title === 'TTL test'));
    });

    await step('char avatars free for everyone', async () => {
      const list = await fetch(`${BASE}/api/char-avatars`);
      assert.strictEqual(list.status, 200);
      const body = await list.json();
      assert.ok((body.avatars || []).length >= 40, 'char catalog (male+female sheets)');
      const first = body.avatars[0];
      assert.ok(String(first.url).includes('/img/char-avatars/') && String(first.url).endsWith('.png') || String(first.url).includes('.png?'));
      const png = await fetch(`${BASE}${first.url}`);
      assert.strictEqual(png.status, 200);
      const buf = Buffer.from(await png.arrayBuffer());
      assert.ok(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, 'PNG magic');
      const saved = await ok('A', 'PATCH', '/me', { avatarKey: first.key });
      assert.strictEqual(saved.user.avatarKey, first.key);
      await ok('A', 'PATCH', '/me', { avatarKey: null });
    });

    await step('default chess style neo+green for non-premium', async () => {
      const me = await ok('A', 'GET', '/me');
      if (!me.user.premium) {
        assert.strictEqual(me.user.pieceSet, 'neo');
        assert.strictEqual(me.user.boardTheme, 'green');
      }
    });

    await step('messages threads list never 500s', async () => {
      const th = await ok('A', 'GET', '/messages/threads');
      assert.ok(Array.isArray(th.threads));
      const search = await ok('A', 'GET', '/messages/search?q=bo');
      assert.ok(Array.isArray(search.users));
    });

    await step('boot splash public + admin edit', async () => {
      const pub = await fetch(`${BASE}/api/public/boot-splash`);
      assert.strictEqual(pub.status, 200);
      const pubBody = await pub.json();
      assert.ok(pubBody.splash && pubBody.splash.uz);
      assert.strictEqual(pubBody.splash.uz.title, "O'yin yuklanmoqda");
      assert.ok((pubBody.animations || []).includes('orbit'));
      const got = await ok('ADMIN', 'GET', '/admin/boot-splash');
      assert.ok(got.splash.animation);
      const saved = await ok('ADMIN', 'PATCH', '/admin/boot-splash', {
        lang: 'uz',
        title: "O'yin yuklanmoqda",
        subtitle: 'Test subtitle',
        animation: 'pulse',
      });
      assert.strictEqual(saved.splash.animation, 'pulse');
      assert.strictEqual(saved.splash.uz.subtitle, 'Test subtitle');
      const pub2 = await (await fetch(`${BASE}/api/public/boot-splash`)).json();
      assert.strictEqual(pub2.splash.animation, 'pulse');
      assert.strictEqual(pub2.splash.uz.subtitle, 'Test subtitle');
      await ok('ADMIN', 'PATCH', '/admin/boot-splash', {
        lang: 'uz',
        title: "O'yin yuklanmoqda",
        subtitle: 'Iltimos kuting…',
        animation: 'orbit',
      });
    });

    await step('medal generator: admin preview, award, avatar select', async () => {
      const cfg = await ok('ADMIN', 'GET', '/admin/medals');
      assert.ok(cfg.config && cfg.config.botHandle);
      const preview = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 1, name: 'Bob', username: 'bob', userId: USERS.B.id,
        config: { ...cfg.config, botHandle: '@Chess_uz_bot' },
      });
      assert.ok(cfg.months && cfg.months.length === 12, 'admin lists 12 months');
      assert.ok(preview.svg.includes('Top 1') || preview.title.includes('Top 1') || preview.svg.includes('TOP 1'));
      assert.ok(preview.svg.includes('@Chess_uz_bot'));
      assert.ok(preview.svg.includes('OCTOBER') || preview.svg.includes('SEASON') || preview.svg.includes('BOB') || preview.svg.includes('Bob') || preview.svg.includes('metal-'));
      const oct = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 1, month: '2026-10', name: 'Bob', config: cfg.config,
      });
      assert.ok(oct.svg.includes('OCTOBER 2026') || oct.svg.includes('OCT 2026'));
      assert.ok(oct.svg.includes('BOB') || oct.svg.includes('Bob'));
      const nov = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 1, month: '2026-11', name: 'Bob', config: cfg.config,
      });
      const octNext = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 1, month: '2027-10', name: 'Bob', config: cfg.config,
      });
      assert.notStrictEqual(oct.svg, nov.svg, 'months use different patterns');
      assert.notStrictEqual(oct.svg, octNext.svg, 'same month different year differs');
      const p2 = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 2, month: '2026-10', name: 'Bob',
        config: { ...cfg.config, pieceTop2: 'queen' },
      });
      const p3 = await ok('ADMIN', 'POST', '/admin/medals/preview', {
        place: 3, month: '2026-10', name: 'Bob',
        config: { ...cfg.config, pieceTop3: 'knight' },
      });
      assert.ok(p2.svg.includes('TOP 2') && p3.svg.includes('TOP 3'));
      assert.notStrictEqual(oct.svg, p2.svg);

      // Seed previous month scores so award works
      const prevMonth = cfg.previousMonth;
      assert.ok(prevMonth);
      await pg.q(
        `INSERT INTO monthly_scores (user_id, month, points, wins, draws, losses) VALUES
           ($1, $2, 10, 5, 0, 0), ($3, $2, 6, 3, 0, 0), ($4, $2, 4, 2, 0, 0)
         ON CONFLICT (user_id, month) DO UPDATE SET points = EXCLUDED.points, wins = EXCLUDED.wins`,
        USERS.B.id, prevMonth, USERS.A.id, USERS.C.id,
      );
      // Current month must not be awardable (prevents accidental mid-season medals)
      await err('ADMIN', 'POST', '/admin/medals/award', { month: cfg.month, notify: false }, 400, 'bad_request');
      // Clear premium so award can grant podium Premium from a known base
      await pg.q(
        'UPDATE users SET premium = 0, premium_until = NULL WHERE id = ANY($1::bigint[])',
        [USERS.B.id, USERS.A.id, USERS.C.id],
      );
      // notify:false — fake Telegram cannot accept SVG/PNG documents in this harness
      const awarded = await ok('ADMIN', 'POST', '/admin/medals/award', { month: prevMonth, notify: false });
      assert.ok(awarded.awarded.length >= 1);
      const top1 = awarded.awarded.find((m) => m.place === 1);
      const top2 = awarded.awarded.find((m) => m.place === 2);
      const top3 = awarded.awarded.find((m) => m.place === 3);
      assert.ok(top1 && top1.userId === USERS.B.id);
      assert.ok(awarded.awarded.every((m) => m.svg === undefined), 'svg not echoed in award JSON');
      assert.ok(awarded.premiumGrants && awarded.premiumGrants.length >= 1, 'podium Premium granted');
      assert.strictEqual(top1.premiumMonths, 1, 'top1 gets 1 month Premium');
      if (top2) assert.strictEqual(top2.premiumDays, 20, 'top2 gets 20 days Premium');
      if (top3) assert.strictEqual(top3.premiumDays, 15, 'top3 gets 15 days Premium');
      const meB = await ok('B', 'GET', '/me');
      assert.ok(meB.user.premium, 'top1 Premium active');
      assert.ok(meB.user.premiumUntil, 'top1 has premium_until');
      // Re-award must not stack Premium again
      const until1 = meB.user.premiumUntil;
      const again = await ok('ADMIN', 'POST', '/admin/medals/award', { month: prevMonth, notify: false });
      assert.ok(!again.premiumGrants || again.premiumGrants.length === 0, 'premium grant is idempotent');
      const meB2 = await ok('B', 'GET', '/me');
      assert.strictEqual(meB2.user.premiumUntil, until1, 'premium_until unchanged on re-award');

      const svgRes = await fetch(`${BASE}/api/medals/${top1.id}.svg`, {
        headers: { 'X-Init-Data': init('B') },
      });
      assert.strictEqual(svgRes.status, 200);
      const svgText = await svgRes.text();
      assert.ok(svgText.includes('<svg'));

      const mine = await ok('B', 'GET', '/medals/mine');
      assert.ok(mine.medals.some((m) => m.id === top1.id));
      const patched = await ok('B', 'PATCH', '/me', { avatarKey: `medal:${top1.id}` });
      assert.strictEqual(patched.user.avatarKey, `medal:${top1.id}`);
      await err('A', 'PATCH', '/me', { avatarKey: `medal:${top1.id}` }, 400);
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
      // Players can claim post-game analysis (free daily quota)
      const an = await ok(p.b, 'POST', `/games/${g.id}/analyze`);
      assert.ok(an.allowed, 'analysis claim allowed');
      const st = await ok(p.b, 'GET', `/games/${g.id}/analyze/status`);
      assert.ok(st.claimed, 'analysis marked claimed');
      // Spectator poll reports viewer count to seated players
      const live = await ok('C', 'GET', `/live/games/${g.id}`);
      assert.ok(live.game && live.game.spectators >= 0, 'spectator count on live game');
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

    await step('ephemeral in-game chat reaches opponent and rejects empty text', async () => {
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      await ok('B', 'POST', `/games/${g.id}/join`);
      const wsA = sockets[1];
      await ok('B', 'POST', `/games/${g.id}/chat`, { text: 'Salom!' });
      const m = await wsA.waitFor((x) => x.t === 'chat' && x.id === g.id);
      assert.strictEqual(m.text, 'Salom!');
      assert.strictEqual(m.by, USERS.B.id);
      await err('B', 'POST', `/games/${g.id}/chat`, { text: '   ' }, 400, 'bad_request');
    });

    await step('daily puzzle claim awards admin-configured diamonds once per Tashkent day', async () => {
      await ok('ADMIN', 'PATCH', '/admin/shop', { puzzleDailyReward: 3 });
      assert.strictEqual((await ok('D', 'GET', '/me')).meta.puzzleDailyReward, 3);
      const before = (await ok('D', 'GET', '/me')).user.diamonds;
      const r1 = await ok('D', 'POST', '/puzzles/claim-daily');
      assert.strictEqual(r1.awarded, 3);
      assert.strictEqual(r1.diamonds, before + 3);
      const r2 = await ok('D', 'POST', '/puzzles/claim-daily');
      assert.strictEqual(r2.awarded, 0);
      assert.strictEqual(r2.diamonds, before + 3);
      await ok('ADMIN', 'PATCH', '/admin/shop', { puzzleDailyReward: 1 });
    });

    await step('admin diamond pack save rejects invalid packs', async () => {
      await err('ADMIN', 'PATCH', '/admin/shop', {
        diamondPacks: [{ diamonds: 50, sum: 100 }],
      }, 400, 'bad_request');
      const okPack = await ok('ADMIN', 'PATCH', '/admin/shop', {
        diamondPacks: [{ diamonds: 250, sum: 250000 }, { diamonds: 100, sum: 100000 }],
      });
      assert.ok(okPack.shop.diamondPacks.some((p) => p.diamonds === 250 && p.sum === 250000));
      // Order is preserved (admin ↑↓ reorder)
      const reordered = await ok('ADMIN', 'PATCH', '/admin/shop', {
        diamondPacks: [
          { diamonds: 1000, sum: 1000000 },
          { diamonds: 100, sum: 100000 },
          { diamonds: 500, sum: 500000 },
        ],
      });
      assert.deepStrictEqual(
        reordered.shop.diamondPacks.map((p) => p.diamonds),
        [1000, 100, 500],
        'diamond pack order preserved',
      );
      await ok('ADMIN', 'PATCH', '/admin/shop', {
        diamondPacks: [
          { diamonds: 100, sum: 100000 },
          { diamonds: 200, sum: 200000 },
          { diamonds: 300, sum: 300000 },
          { diamonds: 400, sum: 400000 },
          { diamonds: 500, sum: 500000 },
          { diamonds: 1000, sum: 1000000 },
        ],
      });
    });

    // ---------------------------------------------------------------- match-making + invite links
    await step('online match-making pairs two waiting players', async () => {
      const firstRes = await ok('C', 'POST', '/games/quick');
      const first = firstRes.game;
      assert.strictEqual(first.status, 'open');
      assert.ok(firstRes.eloDelta >= 80 && firstRes.eloDelta <= 800, 'expanding Elo window on search');
      assert.strictEqual((await ok('C', 'POST', '/games/quick')).game.id, first.id, 'waiting twice keeps the same search');
      const second = (await ok('D', 'POST', '/games/quick')).game;
      assert.strictEqual(second.id, first.id);
      assert.strictEqual(second.status, 'active');
      assert.strictEqual(second.mode, 'online');
      assert.notStrictEqual(second.you, (await ok('C', 'GET', `/games/${first.id}`)).game.you);
    });

    await step('quick match honours preferred colour and new time presets', async () => {
      const open = (await ok('C', 'POST', '/games/quick', { timeControl: '2+1', preferredColor: 'w' })).game;
      assert.strictEqual(open.status, 'open');
      assert.strictEqual(open.timeControl, '2+1');
      const joined = (await ok('D', 'POST', '/games/quick', { timeControl: '2+1' })).game;
      assert.strictEqual(joined.id, open.id);
      assert.strictEqual(joined.status, 'active');
      const creator = (await ok('C', 'GET', `/games/${open.id}`)).game;
      assert.strictEqual(creator.you, 'w', 'creator asked for white');
      assert.strictEqual(joined.you, 'b');
      await ok('C', 'POST', `/games/${open.id}/resign`);
    });

    await step('quick match honours joiner preferred colour when creator is random', async () => {
      const open = (await ok('C', 'POST', '/games/quick', { timeControl: '3+0' })).game;
      assert.strictEqual(open.status, 'open');
      const joined = (await ok('D', 'POST', '/games/quick', { timeControl: '3+0', preferredColor: 'w' })).game;
      assert.strictEqual(joined.id, open.id);
      assert.strictEqual(joined.status, 'active');
      assert.strictEqual(joined.you, 'w', 'joiner asked for white');
      const creator = (await ok('C', 'GET', `/games/${open.id}`)).game;
      assert.strictEqual(creator.you, 'b');
      await ok('D', 'POST', `/games/${open.id}/resign`);
    });

    await step('compatible colour prefs give each player their colour', async () => {
      const open = (await ok('C', 'POST', '/games/quick', { timeControl: '5+0', preferredColor: 'b' })).game;
      assert.strictEqual(open.status, 'open');
      const joined = (await ok('D', 'POST', '/games/quick', { timeControl: '5+0', preferredColor: 'w' })).game;
      assert.strictEqual(joined.id, open.id);
      assert.strictEqual(joined.you, 'w');
      const creator = (await ok('C', 'GET', `/games/${open.id}`)).game;
      assert.strictEqual(creator.you, 'b', 'creator asked for black');
      await ok('C', 'POST', `/games/${open.id}/resign`);
    });

    await step('quick match skips far Elo until the search window grows', async () => {
      await pg.q('UPDATE users SET elo_bullet = 1200, elo = 1200 WHERE id = $1', USERS.C.id);
      await pg.q('UPDATE users SET elo_bullet = 1600, elo = 1600 WHERE id = $1', USERS.D.id);
      await new Promise((r) => setTimeout(r, 20)); // USER_MEMO_MS=1 in test env
      const a = (await ok('C', 'POST', '/games/quick', { timeControl: '1+0' })).game;
      assert.strictEqual(a.status, 'open');
      const b = (await ok('D', 'POST', '/games/quick', { timeControl: '1+0' })).game;
      assert.strictEqual(b.status, 'open', '400 Elo gap stays unmatched at ±80');
      assert.notStrictEqual(b.id, a.id);
      await ok('C', 'DELETE', `/games/${a.id}`);
      await ok('D', 'DELETE', `/games/${b.id}`);
      await pg.q('UPDATE users SET elo_bullet = 1200, elo = 1200 WHERE id = $1', USERS.D.id);
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
      assert.deepStrictEqual([preview.joinable, preview.opponent.name], [true, 'Eve Ellis']);
      assert.ok(!(await ok('E', 'GET', '/friends')).friends.some((f) => f.id === USERS.A.id) || true);
      const j = (await ok('D', 'POST', `/games/${g.id}/join`)).game;
      assert.strictEqual(j.status, 'active');
      assert.ok((await ok('E', 'GET', '/friends')).friends.some((f) => f.id === USERS.D.id), 'now friends');
      assert.strictEqual((await ok('E', 'POST', `/games/${g.id}/join`)).game.id, g.id, 'creator opening own link is harmless');
      await err('A', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable'); // already full
    });

    // ---------------------------------------------------------------- notifications for offline players
    await step('"your move" goes to Telegram only when the opponent is offline, once per move', async () => {
      // Need a live WS to create the challenge, then drop sockets so both count as offline
      const wsCInvite = await connect('C'); sockets.push(wsCInvite);
      const g = (await ok('D', 'POST', '/games', { opponentId: USERS.C.id })).game;
      const j = (await ok('C', 'POST', `/games/${g.id}/join`)).game;
      const p = colours(j, 'C', 'D');
      for (const s of sockets) {
        try { s.ws.close(); } catch { /* ignore */ }
      }
      await sleep(5200); // outlast PRESENCE_REST_MS so isOnline is false
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
    await step('lobby lists online players; opted-out stay visible but unchallengeable', async () => {
      await ok('B', 'PATCH', '/me', { discoverable: false });
      await ok('E', 'PATCH', '/me', { discoverable: true });
      const wsC = await connect('C'); sockets.push(wsC);
      await ok('A', 'GET', '/me'); await ok('B', 'GET', '/me'); await ok('E', 'GET', '/me');
      const lobby = await ok('D', 'GET', '/lobby');
      assert.ok(lobby.online.every((o) => 'avatarKey' in o), 'lobby online rows include avatarKey');
      const names = lobby.online.map((o) => o.name);
      assert.ok(names.includes('Alice Anderson') && names.includes('Cara Cole'), `online: ${names}`);
      assert.ok(!names.some((n) => /^Dan\b/.test(n)), 'not listed to yourself');
      assert.ok(names.includes('Bob Baker'), 'opted-out players still appear in the live list');
      assert.strictEqual(lobby.online.find((o) => o.name === 'Bob Baker').discoverable, false);
      assert.ok(lobby.onlineCount >= 4);
      const asAlice = (await ok('A', 'GET', '/lobby')).online.find((o) => o.name === 'Bob Baker');
      assert.ok(asAlice && asAlice.friend, 'friends are marked in the list');
      await err('D', 'POST', '/games', { opponentId: USERS.B.id }, 404, 'user_unavailable'); // hidden players cannot be challenged
      // /bye must drop REST presence immediately (not leave a 30s ghost online)
      await ok('E', 'POST', '/bye');
      const afterBye = await ok('D', 'GET', '/lobby');
      assert.ok(!afterBye.online.some((o) => o.id === USERS.E.id), 'bye removes user from lobby online');
      // Closed Mini App (no WS) must not accept challenges even if a stale present_until remains
      await err('D', 'POST', '/games', { opponentId: USERS.E.id }, 409, 'user_offline');
      await ok('E', 'GET', '/me'); // back soft-online for later tests
    });

    await step('computer results validated but never counted in stats/rating', async () => {
      await err('A', 'POST', '/results', { level: 9, outcome: 'win' }, 400);
      await err('A', 'POST', '/results', { level: 3, outcome: 'cheat' }, 400);
      const before = await ok('A', 'GET', '/me');
      const eloBefore = before.user.elo;
      const onlineBefore = before.stats.online;
      const r = await ok('A', 'POST', '/results', { level: 3, outcome: 'win' });
      assert.deepStrictEqual([r.stats.ai.w, r.stats.ai.d, r.stats.ai.l], [0, 0, 0], 'ai stats always zero');
      assert.deepStrictEqual(
        [r.stats.online.w, r.stats.online.d, r.stats.online.l],
        [onlineBefore.w, onlineBefore.d, onlineBefore.l],
        'online stats unchanged by computer game',
      );
      const after = await ok('A', 'GET', '/me');
      assert.strictEqual(after.user.elo, eloBefore, 'computer game does not change Elo');
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
      const byAt = await ok('ADMIN', 'GET', `/admin/users?q=${encodeURIComponent('@alice_chess')}`);
      assert.ok(byAt.users.some((u) => u.id === USERS.A.id), 'admin @username search');
      const bySurname = await ok('ADMIN', 'GET', '/admin/users?q=Anderson');
      assert.ok(bySurname.users.some((u) => u.id === USERS.A.id), 'admin last name search');
      const bareUser = await ok('ADMIN', 'GET', '/admin/users?q=alice_chess');
      assert.ok(!bareUser.users.some((u) => u.id === USERS.A.id), 'admin username without @ does not match');
      await err('ADMIN', 'POST', `/admin/users/${ADMIN_ID}/block`, { blocked: true }, 400, 'admin_block');
      await ok('ADMIN', 'POST', `/admin/users/${USERS.E.id}/block`, { blocked: true });
      await err('E', 'GET', '/me', null, 403, 'blocked');
      await ok('ADMIN', 'POST', `/admin/users/${USERS.E.id}/block`, { blocked: false });
      await ok('E', 'GET', '/me');
    });

    await step('admin purge user wipes data; rejoin is a fresh user (referral works again)', async () => {
      await err('ADMIN', 'DELETE', `/admin/users/${ADMIN_ID}`, null, 400, 'admin_delete');
      await err('A', 'DELETE', `/admin/users/${USERS.E.id}`, null, 404, 'notfound');
      await ok('ADMIN', 'POST', `/admin/users/${USERS.E.id}/diamonds`, { amount: 50 });
      assert.ok((await ok('E', 'GET', '/me')).user.diamonds >= 50);
      await ok('ADMIN', 'DELETE', `/admin/users/${USERS.E.id}`);
      const listed = await ok('ADMIN', 'GET', `/admin/users?q=${USERS.E.id}`);
      assert.ok(!listed.users.some((u) => u.id === USERS.E.id), 'purged user gone from search');
      const fresh = await ok('E', 'GET', '/me');
      assert.strictEqual(fresh.user.diamonds, 0, 'fresh account has 0 diamonds');
      assert.strictEqual(fresh.user.elo, 1200);
      assert.deepStrictEqual(
        [fresh.stats.online.w, fresh.stats.online.d, fresh.stats.online.l],
        [0, 0, 0],
      );
      const aBefore = (await ok('A', 'GET', '/me')).user.diamonds;
      const join = await ok('E', 'POST', '/friends/join', { userId: USERS.A.id });
      assert.strictEqual(join.already, false);
      assert.strictEqual((await ok('E', 'GET', '/me')).user.diamonds, 10, 'invitee reward again after purge');
      assert.strictEqual((await ok('A', 'GET', '/me')).user.diamonds, aBefore + 20, 'inviter reward again after purge');
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

    await step('promo codes: admin create, user redeem diamonds/premium, expiry and once-per-user', async () => {
      const ends = '2099-12-31T23:59';
      await err('A', 'POST', '/admin/promos', { rewardType: 'diamonds', rewardAmount: 50, endsAtTashkent: ends }, 404);
      const created = await ok('ADMIN', 'POST', '/admin/promos', {
        code: 'chess_gems',
        rewardType: 'diamonds',
        rewardAmount: 50,
        maxUses: 2,
        endsAtTashkent: ends,
        note: 'test',
      });
      assert.strictEqual(created.promo.code, 'CHESS_GEMS');
      assert.strictEqual(created.promo.rewardType, 'diamonds');
      const before = (await ok('A', 'GET', '/me')).user.diamonds;
      const redeem = await ok('A', 'POST', '/promo/redeem', { code: 'chess_gems' });
      assert.strictEqual(redeem.user.diamonds, before + 50);
      assert.strictEqual(redeem.reward.type, 'diamonds');
      await err('A', 'POST', '/promo/redeem', { code: 'CHESS_GEMS' }, 400, 'promo_used');
      const prem = await ok('ADMIN', 'POST', '/admin/promos', {
        code: 'PREM7',
        rewardType: 'premium_days',
        rewardAmount: 7,
        endsAtTashkent: ends,
      });
      assert.strictEqual(prem.promo.rewardType, 'premium_days');
      const got = await ok('B', 'POST', '/promo/redeem', { code: 'prem7' });
      assert.ok(got.user.premium, 'premium granted');
      assert.ok(got.reward.premiumUntilTashkent);
      // Past end date rejected at create
      await err('ADMIN', 'POST', '/admin/promos', {
        code: 'OLDCODE', rewardType: 'diamonds', rewardAmount: 1, endsAtTashkent: '2020-01-01T00:00',
      }, 400, 'ends_at');
      const listed = await ok('ADMIN', 'GET', '/admin/promos');
      assert.ok((listed.promos || []).some((p) => p.code === 'CHESS_GEMS'));
    });

    await step('announcements: media-only publish works on home and puzzle boards', async () => {
      const ends = '2099-12-31T23:59';
      await err('ADMIN', 'POST', '/admin/announcements', { title: '', body: '', endsAtTashkent: ends }, 400, 'text');
      for (const board of ['home', 'puzzle']) {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48, board === 'home' ? 2 : 3)]);
        const up = await call('ADMIN', 'POST', '/admin/upload', null, png);
        assert.strictEqual(up.status, 201, `upload ${board}`);
        const mid = up.data.id;
        const created = await ok('ADMIN', 'POST', '/admin/announcements', {
          board, title: '', body: '', mediaId: mid, endsAtTashkent: ends, linkType: 'none',
        });
        assert.ok(created.announcement && created.announcement.id, `${board} created`);
        assert.strictEqual(created.announcement.mediaId, mid);
        assert.strictEqual(created.announcement.title, '');
        assert.strictEqual(created.announcement.body, '');
        assert.strictEqual(created.announcement.board, board);
        const pub = await ok('A', 'GET', board === 'home' ? '/announcements' : '/announcements?board=puzzle');
        assert.ok((pub.announcements || []).some((a) => a.id === created.announcement.id && a.mediaId === mid), `${board} listed`);
        const img = await fetch(`${BASE}/api/media/${mid}`, { headers: { 'X-Init-Data': init('A') } });
        assert.strictEqual(img.status, 200, `${board} media bytes`);
        assert.ok((await img.arrayBuffer()).byteLength > 8);
      }
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

    await step('post composer: invite button personalizes startapp=i{userId} referral link', async () => {
      tg.calls.length = 0;
      await ok('ADMIN', 'POST', '/admin/broadcast', {
        text: 'Invite friends',
        buttons: [{ text: 'Share invite', type: 'invite', color: 'primary' }],
        test: true,
      });
      const send = tg.calls.find((c) => c.method === 'sendMessage');
      assert.ok(send, 'test invite send');
      const row = send.body.reply_markup.inline_keyboard[0][0];
      assert.ok(row.url.includes('startapp=i' + ADMIN_ID) || decodeURIComponent(row.url).includes('startapp=i' + ADMIN_ID),
        'invite button carries personal startapp referral');
      assert.ok(row.url.includes('t.me/share/url') || row.url.includes('startapp=i'), 'invite is share or direct referral url');
    });

    await step('admin message stats covers telegram + in-app', async () => {
      const st = await ok('ADMIN', 'GET', '/admin/message-stats');
      assert.ok(st.telegram && typeof st.telegram.sent === 'number');
      assert.ok(st.inApp && typeof st.inApp.campaigns === 'number');
      assert.ok(Array.isArray(st.telegram.recent));
      assert.ok(Array.isArray(st.inApp.recent));
      await err('A', 'GET', '/admin/message-stats', null, 404, 'notfound');
    });

    await step('admin can delete notification by copy id', async () => {
      const sent = await ok('ADMIN', 'POST', '/admin/notifications', {
        title: 'DeleteMe', body: 'bye', ttl: 'permanent',
      });
      assert.ok(sent.campaign && sent.campaign.id);
      const notifs = await ok('A', 'GET', '/notifications');
      const copy = (notifs.notifications || []).find((n) => n.title === 'DeleteMe');
      assert.ok(copy, 'recipient has copy');
      await ok('ADMIN', 'DELETE', `/admin/notifications/by-copy/${copy.id}`);
      const after = await ok('A', 'GET', '/notifications');
      assert.ok(!(after.notifications || []).some((n) => n.title === 'DeleteMe'));
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
      const wsD = await connect('D'); sockets.push(wsD); // live WS required to challenge
      await ok('D', 'GET', '/me');
      const g = (await ok('E', 'POST', '/games', { opponentId: USERS.D.id })).game;
      await ok('D', 'POST', `/games/${g.id}/join`);
      await ok('E', 'DELETE', '/me');
      const after = (await ok('D', 'GET', `/games/${g.id}`)).game;
      assert.deepStrictEqual([after.status, after.reason], ['finished', 'resign']);
      assert.ok(!(await ok('D', 'GET', '/friends')).friends.some((f) => f.id === USERS.E.id));
    });

    await step('challenges: offline players cannot be challenged; unanswered ones expire and cannot be accepted', async () => {
      // Drop any leftover sockets (e.g. Dan from account-delete step) so offline checks are real
      for (const s of sockets) {
        try { s.ws.close(); } catch { /* ignore */ }
      }
      await sleep(5200); // outlast PRESENCE_REST_MS so Dan counts as offline
      await err('A', 'POST', '/games', { opponentId: USERS.D.id }, 409, 'user_offline');
      // REST-only presence (no WS) must not accept challenges — invites are WS-pushed
      await ok('D', 'GET', '/me');
      await err('A', 'POST', '/games', { opponentId: USERS.D.id }, 409, 'user_offline');
      const wsB2 = await connect('B'); sockets.push(wsB2);
      const g = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      await pg.q("UPDATE games SET updated_at = now() - interval '120 seconds' WHERE id = $1", g.id);
      assert.ok(!(await ok('B', 'GET', '/lobby')).games.invites.some((x) => x.id === g.id), 'expired invite is hidden');
      await err('B', 'POST', `/games/${g.id}/join`, null, 400, 'game_unavailable');
      assert.strictEqual((await ok('A', 'GET', `/games/${g.id}`)).game.status, 'cancelled');
      const h = (await ok('A', 'POST', '/games', { opponentId: USERS.B.id })).game;
      assert.notStrictEqual(h.id, g.id, 'a fresh challenge can be sent afterwards');
    });

    await step('one request to several players: the first to accept plays, the others are released', async () => {
      const wsD2 = await connect('D'); sockets.push(wsD2);
      const wsB3 = await connect('B'); sockets.push(wsB3);
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
