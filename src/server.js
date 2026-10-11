const path = require('path');
const express = require('express');
const db = require('./db');
const D = require('./dates');
const { validateInitData, isAdmin, ADMIN_IDS } = require('./auth');
const { createBot, setupMenu } = require('./bot');
const { startScheduler, rollAllSubscriptions } = require('./scheduler');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const CATEGORIES = ['food', 'transport', 'shopping', 'bills', 'health', 'fun', 'other'];
const PERIODS = ['weekly', 'monthly', 'yearly'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'RUB', 'UZS'];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

// Security headers (Telegram needs to embed the page, so framing is allowed only from Telegram)
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org",
  });
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

const wrap = (fn) => (req, res, next) => {
  try {
    Promise.resolve(fn(req, res)).catch(next);
  } catch (e) { next(e); }
};

function cleanAmount(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw bad('Enter a valid amount');
  return Math.round(n * 100) / 100;
}
const cleanText = (v, max, label, required = false) => {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) throw bad(`${label} is required`);
  return s;
};
const cleanCategory = (v) => (CATEGORIES.includes(v) ? v : 'other');
const cleanDate = (v) => { if (!D.isDate(v)) throw bad('Invalid date'); return v; };
const intParam = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw bad('Invalid id'); return n; };

// ---------- auth + light rate limit ----------
const hits = new Map(); // userId -> { count, resetAt }
setInterval(() => hits.clear(), 60_000).unref();

const upsertUser = db.prepare(`
  INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
    last_seen = datetime('now')
`);
const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

function auth(req, res, next) {
  const tgUser = validateInitData(req.get('X-Init-Data'), BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'Open this app from Telegram' });

  const count = (hits.get(tgUser.id) || 0) + 1;
  hits.set(tgUser.id, count);
  if (count > 240) return res.status(429).json({ error: 'Too many requests, slow down' });

  upsertUser.run(tgUser.id, tgUser.first_name || '', tgUser.username || '');
  const user = getUser.get(tgUser.id);
  if (user.blocked) return res.status(403).json({ error: 'Your access has been disabled' });

  req.user = user;
  req.isAdmin = isAdmin(user.id);
  next();
}

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(404).json({ error: 'Not found' }); // do not reveal the panel exists
  next();
}

const api = express.Router();
api.use(auth);

// ---------- profile ----------
const publicUser = (u, admin) => ({
  id: u.id, firstName: u.first_name, username: u.username, currency: u.currency,
  notifyEnabled: !!u.notify_enabled, notifyDays: u.notify_days, createdAt: u.created_at, isAdmin: admin,
});

api.get('/me', wrap((req, res) => {
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
  res.json({ user: publicUser(req.user, req.isAdmin), unread, meta: { CATEGORIES, PERIODS, CURRENCIES } });
}));

api.patch('/me', wrap((req, res) => {
  const { currency, notifyEnabled, notifyDays } = req.body || {};
  const u = req.user;
  const cur = currency === undefined ? u.currency : currency;
  if (!CURRENCIES.includes(cur)) throw bad('Unsupported currency');
  const days = notifyDays === undefined ? u.notify_days : Number(notifyDays);
  if (!Number.isInteger(days) || days < 0 || days > 14) throw bad('Reminder days must be 0-14');
  const en = notifyEnabled === undefined ? u.notify_enabled : notifyEnabled ? 1 : 0;
  db.prepare('UPDATE users SET currency = ?, notify_days = ?, notify_enabled = ? WHERE id = ?').run(cur, days, en, u.id);
  res.json({ user: publicUser(getUser.get(u.id), req.isAdmin) });
}));

api.delete('/me', wrap((req, res) => {
  if (req.isAdmin) throw new HttpError(400, 'Admins cannot delete their account here');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // cascades to all user data
  res.json({ ok: true });
}));

// ---------- expenses ----------
api.get('/expenses', wrap((req, res) => {
  const { month } = req.query; // YYYY-MM (optional)
  let rows;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const { from, to } = D.monthRange(month);
    rows = db.prepare('SELECT * FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC')
      .all(req.user.id, from, to);
  } else {
    rows = db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(req.user.id);
  }
  res.json({ expenses: rows });
}));

api.post('/expenses', wrap((req, res) => {
  const b = req.body || {};
  const row = {
    amount: cleanAmount(b.amount),
    category: cleanCategory(b.category),
    note: cleanText(b.note, 120, 'Note'),
    date: b.date ? cleanDate(b.date) : D.today(),
  };
  const info = db.prepare('INSERT INTO expenses (user_id, amount, category, note, date) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, row.amount, row.category, row.note, row.date);
  res.status(201).json({ expense: { id: Number(info.lastInsertRowid), ...row } });
}));

api.delete('/expenses/:id', wrap((req, res) => {
  const info = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(intParam(req.params.id), req.user.id);
  if (!info.changes) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

// ---------- subscriptions ----------
api.get('/subscriptions', wrap((req, res) => {
  rollAllSubscriptions();
  const rows = db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY active DESC, next_date ASC').all(req.user.id);
  res.json({ subscriptions: rows });
}));

function subPayload(b) {
  const period = PERIODS.includes(b.period) ? b.period : 'monthly';
  return {
    name: cleanText(b.name, 60, 'Name', true),
    amount: cleanAmount(b.amount),
    period,
    next_date: cleanDate(b.nextDate),
    category: cleanCategory(b.category),
  };
}

api.post('/subscriptions', wrap((req, res) => {
  const s = subPayload(req.body || {});
  const info = db.prepare('INSERT INTO subscriptions (user_id, name, amount, period, next_date, category) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, s.name, s.amount, s.period, s.next_date, s.category);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

api.patch('/subscriptions/:id', wrap((req, res) => {
  const id = intParam(req.params.id);
  const cur = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!cur) throw new HttpError(404, 'Not found');
  const b = req.body || {};
  if ('active' in b && Object.keys(b).length === 1) {
    db.prepare('UPDATE subscriptions SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
    return res.json({ ok: true });
  }
  const s = subPayload({
    name: b.name ?? cur.name, amount: b.amount ?? cur.amount, period: b.period ?? cur.period,
    nextDate: b.nextDate ?? cur.next_date, category: b.category ?? cur.category,
  });
  db.prepare('UPDATE subscriptions SET name=?, amount=?, period=?, next_date=?, category=?, last_notified=NULL WHERE id=?')
    .run(s.name, s.amount, s.period, s.next_date, s.category, id);
  res.json({ ok: true });
}));

api.delete('/subscriptions/:id', wrap((req, res) => {
  const info = db.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?').run(intParam(req.params.id), req.user.id);
  if (!info.changes) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));

// ---------- calendar ----------
api.get('/calendar', wrap((req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : D.today().slice(0, 7);
  const { from, to } = D.monthRange(month);

  const expenses = db.prepare('SELECT id, amount, category, note, date FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY id DESC')
    .all(req.user.id, from, to);

  rollAllSubscriptions();
  const subs = db.prepare('SELECT id, name, amount, period, next_date, category FROM subscriptions WHERE user_id = ? AND active = 1')
    .all(req.user.id);
  const renewals = [];
  for (const s of subs) {
    for (const date of D.occurrencesBetween(s.next_date, s.period, from, to)) {
      renewals.push({ id: s.id, name: s.name, amount: s.amount, category: s.category, period: s.period, date });
    }
  }
  res.json({ month, expenses, renewals });
}));

// ---------- home summary ----------
const monthlyEquivalent = (amount, period) => (period === 'weekly' ? (amount * 52) / 12 : period === 'yearly' ? amount / 12 : amount);

api.get('/summary', wrap((req, res) => {
  const uid = req.user.id;
  const now = D.today();
  const thisMonth = now.slice(0, 7);
  const prev = D.addMonths(`${thisMonth}-01`, -1).slice(0, 7);

  const sum = (m) => {
    const { from, to } = D.monthRange(m);
    return db.prepare('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ?').get(uid, from, to).t;
  };

  const { from, to } = D.monthRange(thisMonth);
  const byCategory = db.prepare(
    'SELECT category, SUM(amount) total FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC'
  ).all(uid, from, to);

  const since = D.addDays(now, -6);
  const daily = db.prepare('SELECT date, SUM(amount) total FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date')
    .all(uid, since, now);
  const dailyMap = Object.fromEntries(daily.map((d) => [d.date, d.total]));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = D.addDays(since, i);
    return { date, total: dailyMap[date] || 0 };
  });

  rollAllSubscriptions();
  const subs = db.prepare('SELECT * FROM subscriptions WHERE user_id = ? AND active = 1 ORDER BY next_date ASC').all(uid);
  const subsMonthly = subs.reduce((a, s) => a + monthlyEquivalent(s.amount, s.period), 0);
  const upcoming = subs.slice(0, 4).map((s) => ({ id: s.id, name: s.name, amount: s.amount, date: s.next_date, days: D.diffDays(now, s.next_date) }));

  res.json({
    month: sum(thisMonth), prevMonth: sum(prev), subsMonthly: Math.round(subsMonthly * 100) / 100,
    subsCount: subs.length, byCategory, last7, upcoming,
  });
}));

// ---------- notifications ----------
api.get('/notifications', wrap((req, res) => {
  const rows = db.prepare('SELECT id, type, text, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: rows });
}));

api.post('/notifications/read', wrap((req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
}));

api.delete('/notifications', wrap((req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
}));

// ---------- admin ----------
const admin = express.Router();
admin.use(adminOnly);

admin.get('/stats', wrap((req, res) => {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  const signups = db.prepare(`
    SELECT date(created_at) d, COUNT(*) c FROM users WHERE date(created_at) >= date('now','-13 days') GROUP BY d
  `).all();
  const map = Object.fromEntries(signups.map((r) => [r.d, r.c]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = D.addDays(D.today(), i - 13);
    return { date: d, count: map[d] || 0 };
  });
  res.json({
    users: n('SELECT COUNT(*) n FROM users'),
    newToday: n("SELECT COUNT(*) n FROM users WHERE date(created_at) = date('now')"),
    active7d: n("SELECT COUNT(*) n FROM users WHERE last_seen >= datetime('now','-7 days')"),
    blockedUsers: n('SELECT COUNT(*) n FROM users WHERE blocked = 1'),
    unreachable: n('SELECT COUNT(*) n FROM users WHERE bot_blocked = 1'),
    subscriptions: n('SELECT COUNT(*) n FROM subscriptions WHERE active = 1'),
    expenses: n('SELECT COUNT(*) n FROM expenses'),
    signups: days,
  });
}));

admin.get('/users', wrap((req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db.prepare(`
    SELECT u.id, u.first_name, u.username, u.blocked, u.bot_blocked, u.created_at, u.last_seen,
      (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id) expenses,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id) subscriptions
    FROM users u
    WHERE ? = '' OR u.first_name LIKE ? OR u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?
    ORDER BY u.last_seen DESC LIMIT 100
  `).all(q, like, like, like);
  res.json({ users: rows.map((u) => ({ ...u, isAdmin: isAdmin(u.id) })) });
}));

admin.post('/users/:id/block', wrap((req, res) => {
  const id = intParam(req.params.id);
  if (isAdmin(id)) throw bad('Admins cannot be blocked');
  const blocked = req.body && req.body.blocked ? 1 : 0;
  const info = db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id);
  if (!info.changes) throw new HttpError(404, 'User not found');
  res.json({ ok: true, blocked: !!blocked });
}));

let broadcasting = false;
admin.post('/broadcast', wrap(async (req, res) => {
  const text = cleanText(req.body && req.body.text, 1000, 'Message', true);
  if (broadcasting) throw new HttpError(409, 'A broadcast is already running');
  const targets = db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0').all();
  const note = db.prepare('INSERT INTO notifications (user_id, type, text) VALUES (?, ?, ?)');
  for (const t of targets) note.run(t.id, 'announcement', text);

  broadcasting = true;
  res.json({ queued: targets.length });

  // Send in the background, ~20 msgs/sec (Telegram's limit is ~30/sec)
  (async () => {
    let sent = 0, failed = 0;
    for (const t of targets) {
      try {
        await bot.api.sendMessage(t.id, text);
        sent++;
      } catch (e) {
        failed++;
        if (e.error_code === 403) db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?').run(t.id);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    broadcasting = false;
    console.log(`[broadcast] sent=${sent} failed=${failed}`);
    for (const adminId of ADMIN_IDS) {
      bot.api.sendMessage(adminId, `Broadcast finished: ${sent} delivered, ${failed} failed.`).catch(() => {});
    }
  })();
}));

api.use('/admin', admin);
app.use('/api', api);

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error('[server] unexpected:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// ---------- boot ----------
const bot = createBot(BOT_TOKEN, WEBAPP_URL || 'https://example.com');

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

if (process.env.DISABLE_BOT !== '1') {
  if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://')) {
    console.warn('[bot] WEBAPP_URL must be an https:// URL for the Mini App button to work.');
  }
  bot.start({
    onStart: async (me) => {
      console.log(`[bot] @${me.username} started`);
      if (WEBAPP_URL) await setupMenu(bot, WEBAPP_URL).catch((e) => console.error('[bot] menu setup failed:', e.message));
    },
  }).catch((e) => console.error('[bot] failed to start:', e.message));
}
startScheduler(process.env.DISABLE_BOT === '1' ? null : bot);

process.on('SIGTERM', () => { bot.stop(); process.exit(0); });
