// End-to-end smoke test: boots the server with a throwaway DB and a fake token,
// signs Telegram initData the same way Telegram does, and exercises the API.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const TOKEN = '123456:TEST_TOKEN_NOT_REAL';
const PORT = 3999;
const ADMIN_ID = 1895441858;
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'obuna-')), 'test.db');

function sign(user, authDate = Math.floor(Date.now() / 1000), token = TOKEN) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const call = async (initData, method, p, body) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

(async () => {
  const srv = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BOT_TOKEN: TOKEN, DISABLE_BOT: '1', PORT: String(PORT), DB_PATH: dbPath, ADMIN_IDS: String(ADMIN_ID) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => srv.stdout.on('data', (d) => d.toString().includes('listening') && res()));

  try {
    const admin = sign({ id: ADMIN_ID, first_name: 'Boss', username: 'boss' });
    const alice = sign({ id: 111, first_name: 'Alice' });
    const bob = sign({ id: 222, first_name: 'Bob' });

    // --- auth
    assert.strictEqual((await call('', 'GET', '/me')).status, 401, 'missing initData rejected');
    assert.strictEqual((await call(sign({ id: 1 }, undefined, 'other:token'), 'GET', '/me')).status, 401, 'wrong token rejected');
    assert.strictEqual((await call(sign({ id: 1 }, 1000), 'GET', '/me')).status, 401, 'stale initData rejected');
    assert.strictEqual((await call(alice + 'x', 'GET', '/me')).status, 401, 'tampered hash rejected');

    // --- profile
    let me = await call(alice, 'GET', '/me');
    assert.strictEqual(me.data.user.isAdmin, false);
    assert.strictEqual((await call(admin, 'GET', '/me')).data.user.isAdmin, true);
    assert.strictEqual((await call(alice, 'PATCH', '/me', { currency: 'USD', notifyDays: 5 })).data.user.currency, 'USD');
    assert.strictEqual((await call(alice, 'PATCH', '/me', { currency: 'XXX' })).status, 400);
    assert.strictEqual((await call(alice, 'PATCH', '/me', { notifyDays: 99 })).status, 400);

    // --- expenses
    const today = new Date().toLocaleDateString('en-CA');
    assert.strictEqual((await call(alice, 'POST', '/expenses', { amount: -5 })).status, 400);
    assert.strictEqual((await call(alice, 'POST', '/expenses', { amount: 'abc' })).status, 400);
    const e1 = await call(alice, 'POST', '/expenses', { amount: '12,50', category: 'food', note: '<b>lunch</b>', date: today });
    assert.strictEqual(e1.status, 201);
    await call(alice, 'POST', '/expenses', { amount: 30, category: 'bogus' });
    let list = await call(alice, 'GET', `/expenses?month=${today.slice(0, 7)}`);
    assert.strictEqual(list.data.expenses.length, 2);
    assert.strictEqual(list.data.expenses.find((e) => e.amount === 30).category, 'other', 'unknown category falls back');

    // isolation between users
    assert.strictEqual((await call(bob, 'GET', '/expenses')).data.expenses.length, 0);
    assert.strictEqual((await call(bob, 'DELETE', `/expenses/${e1.data.expense.id}`)).status, 404, 'cannot delete others data');

    // --- subscriptions (stale date rolls forward, month-end clamps)
    const past = new Date(Date.now() - 40 * 86400000).toLocaleDateString('en-CA');
    const s1 = await call(alice, 'POST', '/subscriptions', { name: 'Netflix', amount: 9.99, period: 'monthly', nextDate: past });
    assert.strictEqual(s1.status, 201);
    const subs = (await call(alice, 'GET', '/subscriptions')).data.subscriptions;
    assert.ok(subs[0].next_date >= today, `next_date rolled forward (${subs[0].next_date})`);
    assert.strictEqual((await call(alice, 'POST', '/subscriptions', { name: '', amount: 1, nextDate: today })).status, 400);
    assert.strictEqual((await call(alice, 'PATCH', `/subscriptions/${s1.data.id}`, { active: false })).status, 200);

    // --- calendar + summary
    const cal = await call(alice, 'GET', `/calendar?month=${today.slice(0, 7)}`);
    assert.strictEqual(cal.status, 200);
    assert.ok(cal.data.expenses.length === 2);
    const sum = await call(alice, 'GET', '/summary');
    assert.strictEqual(sum.data.month, 42.5);
    assert.strictEqual(sum.data.subsCount, 0, 'paused sub excluded');

    // --- admin gating
    assert.strictEqual((await call(alice, 'GET', '/admin/stats')).status, 404, 'non-admin cannot see admin');
    assert.strictEqual((await call(alice, 'POST', '/admin/broadcast', { text: 'hi' })).status, 404);
    const stats = await call(admin, 'GET', '/admin/stats');
    assert.strictEqual(stats.status, 200);
    assert.ok(stats.data.users >= 3);
    const users = await call(admin, 'GET', '/admin/users?q=ali');
    assert.strictEqual(users.data.users.length, 1);
    assert.strictEqual((await call(admin, 'POST', `/admin/users/${ADMIN_ID}/block`, { blocked: true })).status, 400, 'admin cannot be blocked');
    assert.strictEqual((await call(admin, 'POST', '/admin/users/222/block', { blocked: true })).status, 200);
    assert.strictEqual((await call(bob, 'GET', '/me')).status, 403, 'blocked user locked out');
    await call(admin, 'POST', '/admin/users/222/block', { blocked: false });
    assert.strictEqual((await call(bob, 'GET', '/me')).status, 200);

    // --- delete account cascades
    assert.strictEqual((await call(alice, 'DELETE', '/me')).status, 200);
    assert.strictEqual((await call(alice, 'GET', '/expenses')).data.expenses.length, 0);

    // --- static + headers
    const html = await fetch(`http://localhost:${PORT}/`);
    assert.strictEqual(html.status, 200);
    assert.ok(html.headers.get('content-security-policy').includes('frame-ancestors'));

    console.log('All smoke tests passed');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
  }
})();
