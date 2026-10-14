const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const db = require('./db');
const { validateInitData, isAdmin, ADMIN_IDS } = require('./auth');
const { HttpError, bad } = require('./errors');
const { LANGS, fromTelegram } = require('./i18n');
const realtime = require('./realtime');
const notify = require('./notify');
const { applyMove, turnOf, parseMoves, movesJson, replay } = require('./game');
const { sendPost, COLORS } = require('./posts');
const { createBot, setupMenu } = require('./bot');
const { startScheduler } = require('./scheduler');
const {
  normalizeTimeControl, presetOf, categoryOf, isTimed,
  settleClocks, afterMoveClocks,
} = require('./time');
const lichess = require('./lichess');
const { cacheGet, cacheSet, cacheDel, cacheEnabled, incr } = require('./cache');
const { saveMedia, loadMediaBytes, storageEnabled } = require('./storage');
const { DEFAULT_ELO, pairUpdate, scoresForResult, eloColumn } = require('./elo');
const {
  monthKey, monthLabelEn, previousMonthKey, normalizeConfig, generateMedalSvg, titleFor, DEFAULT_CONFIG, FONT_KEYS, PIECE_KEYS,
} = require('./medals');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const THEMES = ['dark', 'light'];
const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton'];
const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown'];
const PREMIUM_PRICE_FALLBACK = Number(process.env.PREMIUM_PRICE || 200); // diamonds / month (DB may override)
const REFERRAL_REWARD = Number(process.env.REFERRAL_REWARD || 20); // diamonds for the inviter
const REFERRAL_INVITEE_REWARD = Number(process.env.REFERRAL_INVITEE_REWARD || 10); // diamonds for the invited friend
const DEFAULT_DIAMOND_PACKS = [
  { diamonds: 100, sum: 100000 },
  { diamonds: 200, sum: 200000 },
  { diamonds: 300, sum: 300000 },
  { diamonds: 400, sum: 400000 },
  { diamonds: 500, sum: 500000 },
  { diamonds: 1000, sum: 1000000 },
];
const DEFAULT_PREMIUM_PLANS = [
  { months: 1, diamonds: 200 },
  { months: 3, diamonds: 500 },
  { months: 6, diamonds: 900 },
  { months: 12, diamonds: 1600 },
];
const PREMIUM_MONTH_OPTIONS = [1, 3, 6, 12];
const DEFAULT_PAY_USERNAME = 'hasanovbobur';
const REACTIONS = ['👍', '😀', '😮', '😢', '🔥', '👏', '🤔', '😎', '🎉', '🙈'];
const MAX_OPEN_GAMES = 10;
// A challenge is only shown inside the app (no chat message). It stays valid this long; the popup itself shows for 10 s
const POPUP_MS = 10_000;
const INVITE_TTL_MS = Number(process.env.INVITE_TTL_MS || 30_000);
const SQUARE = /^[a-h][1-8]$/;
const URL_RE = /^(https?:\/\/[^\s]{3,500}|tg:\/\/[^\s]{3,200})$/i;

const app = express();
const server = http.createServer(app);
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

// Security headers. Telegram must be allowed to frame the page; websockets go to our own origin.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https://image.lichess1.org https://lichess1.org; media-src 'self' blob:; " +
      "connect-src 'self' ws: wss:; worker-src 'self'; " +
      'frame-ancestors https://web.telegram.org https://*.telegram.org',
  });
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  // Always revalidate (cheap 304s) so a new deploy reaches players immediately
  setHeaders(res, file) {
    res.set('Cache-Control', 'no-cache');
    if (file.endsWith('.mjs')) res.set('Content-Type', 'text/javascript; charset=utf-8');
  },
}));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => {
  try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); }
};

// Medal SVGs are public so <img> / download / Telegram share work without initData headers
app.get('/api/medals/:id.svg', wrap(async (req, res) => {
  const id = String(req.params.id || '').replace(/\.svg$/i, '');
  const row = await db.prepare('SELECT svg FROM medals WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Not found', 'notfound');
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(row.svg);
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const intParam = (v) => { const n = Number(v); if (!Number.isSafeInteger(n)) throw bad('Invalid id', 'bad_request'); return n; };
const cleanText = (v, max, code, required = false) => {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) throw bad('Required', code);
  return s;
};
const gameId = () => crypto.randomBytes(6).toString('base64url'); // 8 chars, safe inside a deep link

// ---------- users ----------
const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
const upsertUser = db.prepare(`
  INSERT INTO users (id, first_name, username, lang) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
    last_seen = now()
`);
const touchUser = db.prepare('UPDATE users SET last_seen = now() WHERE id = ?');
const nameOf = db.prepare('SELECT first_name, username FROM users WHERE id = ?');

async function person(id) {
  if (!id) return null;
  const u = (await nameOf.get(id)) || {};
  return { id, name: u.first_name || 'Player', username: u.username || '', online: realtime.isOnline(id) };
}

/** Active Premium: unexpired premium_until, or legacy premium=1 with no expiry. */
function isPremiumActive(u) {
  if (!u) return false;
  if (u.premium_until) return new Date(u.premium_until).getTime() > Date.now();
  return !!u.premium;
}

const publicUser = (u, admin) => {
  const premium = isPremiumActive(u);
  const until = u.premium_until ? new Date(u.premium_until) : null;
  return {
    id: u.id, firstName: u.first_name, username: u.username, lang: u.lang, theme: u.theme,
    langSet: !!u.lang_set, notifyEnabled: !!u.notify_enabled, discoverable: !!u.discoverable, isAdmin: admin,
    diamonds: Number(u.diamonds || 0), premium,
    premiumUntil: until && !Number.isNaN(until.getTime()) ? until.toISOString() : null,
    premiumUntilTashkent: until && !Number.isNaN(until.getTime()) ? formatTashkent(until) : null,
    pieceSet: PIECE_SETS.includes(u.piece_set) ? u.piece_set : 'outline',
    boardTheme: BOARD_THEMES.includes(u.board_theme) ? u.board_theme : 'classic',
    elo: Number(u.elo || DEFAULT_ELO),
    eloBullet: Number(u.elo_bullet || DEFAULT_ELO),
    eloBlitz: Number(u.elo_blitz || DEFAULT_ELO),
    eloRapid: Number(u.elo_rapid || DEFAULT_ELO),
    eloClassic: Number(u.elo_classic || DEFAULT_ELO),
    avatarKey: u.avatar_key || null,
  };
};

const ELO_COLS = new Set(['elo', 'elo_bullet', 'elo_blitz', 'elo_rapid', 'elo_classic']);

async function applyRatingFinish(row, result) {
  if (!row.white_id || !row.black_id) return;
  if (!['1-0', '0-1', '1/2-1/2'].includes(result)) return;
  const cat = categoryOf(row.time_control || 'classic');
  const col = eloColumn(cat);
  if (!ELO_COLS.has(col)) return;
  const white = await getUser.get(row.white_id);
  const black = await getUser.get(row.black_id);
  if (!white || !black) return;
  const scores = scoresForResult(result);
  const wCat = Number(white[col] || DEFAULT_ELO);
  const bCat = Number(black[col] || DEFAULT_ELO);
  const updCat = pairUpdate(wCat, bCat, scores.white);
  const updAll = pairUpdate(Number(white.elo || DEFAULT_ELO), Number(black.elo || DEFAULT_ELO), scores.white);
  await db.prepare(`UPDATE users SET ${col} = ?, elo = ? WHERE id = ?`).run(updCat.a, updAll.a, white.id);
  await db.prepare(`UPDATE users SET ${col} = ?, elo = ? WHERE id = ?`).run(updCat.b, updAll.b, black.id);

  const month = monthKey();
  const bump = async (uid, pts, w, d, l) => {
    await db.prepare(`
      INSERT INTO monthly_scores (user_id, month, points, wins, draws, losses)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, month) DO UPDATE SET
        points = monthly_scores.points + EXCLUDED.points,
        wins = monthly_scores.wins + EXCLUDED.wins,
        draws = monthly_scores.draws + EXCLUDED.draws,
        losses = monthly_scores.losses + EXCLUDED.losses
    `).run(uid, month, pts, w, d, l);
  };
  if (result === '1-0') {
    await bump(white.id, 2, 1, 0, 0);
    await bump(black.id, 0, 0, 0, 1);
  } else if (result === '0-1') {
    await bump(black.id, 2, 1, 0, 0);
    await bump(white.id, 0, 0, 0, 1);
  } else {
    await bump(white.id, 1, 0, 1, 0);
    await bump(black.id, 1, 0, 1, 0);
  }
  const mk = monthKey();
  await Promise.all([
    ...['bullet', 'blitz', 'rapid', 'classic', 'all'].flatMap((c) => [
      cacheDel(`rankings:elo:${c}:${mk}`),
      cacheDel(`rankings:monthly:${c}:${mk}`),
    ]),
  ]);
}

async function getMedalConfig() {
  return normalizeConfig(await getSetting('medal_gen_config', JSON.stringify(DEFAULT_CONFIG)));
}

async function awardMonthMedals(month) {
  const m = month || previousMonthKey();
  const cfg = await getMedalConfig();
  const top = await db.prepare(`
    SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, m.points
    FROM monthly_scores m JOIN users u ON u.id = m.user_id
    WHERE m.month = ? AND u.blocked = 0 AND m.points > 0
    ORDER BY m.points DESC, m.wins DESC, lower(COALESCE(u.first_name, '')) ASC
    LIMIT 3
  `).all(m);
  const awarded = [];
  for (let i = 0; i < top.length; i++) {
    const place = i + 1;
    const u = top[i];
    const id = `m-${m}-p${place}`;
    const title = titleFor(cfg, place, m);
    const svg = generateMedalSvg({
      place, month: m, name: u.name, username: u.username, userId: u.id, config: cfg,
    });
    await db.prepare(`
      INSERT INTO medals (id, month, place, user_id, title, svg)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (month, place) DO UPDATE SET
        user_id = EXCLUDED.user_id, title = EXCLUDED.title, svg = EXCLUDED.svg
    `).run(id, m, place, u.id, title, svg);
    const saved = await db.prepare('SELECT id FROM medals WHERE month = ? AND place = ?').get(m, place);
    const mid = saved?.id || id;
    awarded.push({ id: mid, place, userId: u.id, name: u.name, title, month: m });
  }
  return { month: m, monthLabel: monthLabelEn(m), awarded };
}

/** Lazy: if previous month has scores but no medals yet, mint them. */
async function ensurePreviousMonthMedals() {
  const prev = previousMonthKey();
  const hasScores = await db.prepare(
    'SELECT 1 AS ok FROM monthly_scores WHERE month = ? AND points > 0 LIMIT 1',
  ).get(prev);
  if (!hasScores) return null;
  const hasMedals = await db.prepare('SELECT 1 AS ok FROM medals WHERE month = ? LIMIT 1').get(prev);
  if (hasMedals) return null;
  try { return await awardMonthMedals(prev); } catch (e) {
    console.error('[medals]', e.message || e);
    return null;
  }
}

async function getSetting(key, fallback) {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(key, String(value));
}

function normalizeDiamondPacks(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return DEFAULT_DIAMOND_PACKS.slice(); }
  }
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_DIAMOND_PACKS.slice();
  const out = [];
  for (const p of arr) {
    const diamonds = Math.floor(Number(p && p.diamonds));
    const sum = Math.floor(Number(p && p.sum));
    if (!(diamonds >= 1 && diamonds <= 1_000_000 && sum >= 1000 && sum <= 1_000_000_000)) continue;
    out.push({ diamonds, sum });
  }
  return out.length ? out : DEFAULT_DIAMOND_PACKS.slice();
}

function normalizePremiumPlans(raw, fallbackMonthPrice) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { arr = null; }
  }
  const out = [];
  if (Array.isArray(arr)) {
    for (const p of arr) {
      const months = Math.floor(Number(p && p.months));
      const diamonds = Math.floor(Number(p && p.diamonds));
      if (!PREMIUM_MONTH_OPTIONS.includes(months)) continue;
      if (!(diamonds >= 1 && diamonds <= 1_000_000)) continue;
      if (out.some((x) => x.months === months)) continue;
      out.push({ months, diamonds });
    }
  }
  out.sort((a, b) => a.months - b.months);
  if (out.length) return out;
  const base = Math.floor(Number(fallbackMonthPrice)) || PREMIUM_PRICE_FALLBACK;
  return DEFAULT_PREMIUM_PLANS.map((p) => (
    p.months === 1 ? { months: 1, diamonds: base } : { ...p }
  ));
}

async function getShopSettings() {
  const [priceRaw, plansRaw, packsRaw, payRaw] = await Promise.all([
    getSetting('premium_price_diamonds', String(PREMIUM_PRICE_FALLBACK)),
    getSetting('premium_plans', JSON.stringify(DEFAULT_PREMIUM_PLANS)),
    getSetting('diamond_packs', JSON.stringify(DEFAULT_DIAMOND_PACKS)),
    getSetting('pay_username', DEFAULT_PAY_USERNAME),
  ]);
  let premiumPriceDiamonds = Math.floor(Number(priceRaw));
  if (!(premiumPriceDiamonds >= 1 && premiumPriceDiamonds <= 1_000_000)) {
    premiumPriceDiamonds = PREMIUM_PRICE_FALLBACK;
  }
  const premiumPlans = normalizePremiumPlans(plansRaw, premiumPriceDiamonds);
  // Keep legacy single-month field in sync with the 1-month plan
  const one = premiumPlans.find((p) => p.months === 1);
  if (one) premiumPriceDiamonds = one.diamonds;
  let payUsername = String(payRaw || DEFAULT_PAY_USERNAME).replace(/^@/, '').trim().slice(0, 64);
  if (!/^[A-Za-z0-9_]{5,64}$/.test(payUsername)) payUsername = DEFAULT_PAY_USERNAME;
  return {
    premiumPriceDiamonds,
    premiumPlans,
    diamondPacks: normalizeDiamondPacks(packsRaw),
    payUsername,
  };
}

/** Add N calendar months in Asia/Tashkent wall clock. */
function addMonthsTashkent(from, months) {
  const n = Math.floor(Number(months));
  if (!(n >= 1 && n <= 120)) throw bad('Invalid premium duration', 'bad_request');
  let d = from instanceof Date ? new Date(from.getTime()) : new Date(from);
  for (let i = 0; i < n; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d);
    const g = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
    let y = g('year'); let m = g('month'); let day = g('day');
    const h = g('hour'); const mi = g('minute'); const s = g('second');
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    day = Math.min(day, last);
    const pad = (x) => String(x).padStart(2, '0');
    d = new Date(`${y}-${pad(m)}-${pad(day)}T${pad(h)}:${pad(mi)}:${pad(s)}+05:00`);
  }
  return d;
}

function addOneMonthTashkent(from) {
  return addMonthsTashkent(from, 1);
}

/** Soft-expire Premium flag when premium_until has passed. */
async function syncPremiumExpiry(u) {
  if (!u || !u.premium_until) return u;
  if (new Date(u.premium_until).getTime() > Date.now()) return u;
  if (u.premium) {
    await db.prepare('UPDATE users SET premium = 0 WHERE id = ? AND premium_until IS NOT NULL AND premium_until <= now()').run(u.id);
    u.premium = 0;
  }
  return u;
}

// ---------- bot ----------
const bot = createBot(BOT_TOKEN, WEBAPP_URL || 'https://example.com');
notify.init(bot, WEBAPP_URL);

let botUsername = process.env.BOT_USERNAME || null;
async function getBotUsername() {
  if (botUsername) return botUsername;
  try {
    botUsername = (await bot.api.getMe()).username;
  } catch (e) {
    console.error('[bot] getMe failed:', e.description || e.message);
  }
  return botUsername;
}

// ---------- auth + light rate limit (Redis when configured, else in-memory) ----------
const hits = new Map(); // userId -> requests in the current minute (memory fallback)
setInterval(() => hits.clear(), 60_000).unref();

async function auth(req, res, next) {
  try {
  const tg = validateInitData(req.get('X-Init-Data'), BOT_TOKEN);
  if (!tg) return res.status(401).json({ error: 'Open this app from Telegram', code: 'auth' });

  let n;
  if (cacheEnabled()) {
    n = await incr(`rl:${tg.id}:${Math.floor(Date.now() / 60_000)}`, 70);
  } else {
    n = (hits.get(tg.id) || 0) + 1;
    hits.set(tg.id, n);
  }
  // Live spectate polls a few endpoints; keep headroom above normal play traffic
  if (n > 600) return res.status(429).json({ error: 'Too many requests', code: 'limit' });

  await upsertUser.run(tg.id, tg.first_name || '', tg.username || '', fromTelegram(tg.language_code));
  let user = await getUser.get(tg.id);
  if (user.blocked) return res.status(403).json({ error: 'Your access has been disabled', code: 'blocked' });
  user = await syncPremiumExpiry(user);

  realtime.markRest(user.id);
  req.user = user;
  req.isAdmin = isAdmin(user.id);
  next();
  } catch (e) { next(e); }
}

const api = express.Router();
api.use(auth);

// ---------- stats ----------
const onlineStats = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN (white_id = :u AND result = '1-0') OR (black_id = :u AND result = '0-1') THEN 1 ELSE 0 END), 0) w,
    COALESCE(SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END), 0) d,
    COALESCE(SUM(CASE WHEN (white_id = :u AND result = '0-1') OR (black_id = :u AND result = '1-0') THEN 1 ELSE 0 END), 0) l
  FROM games WHERE status = 'finished' AND result IS NOT NULL AND (white_id = :u OR black_id = :u)
`);
const aiStats = db.prepare(`
  SELECT
    COUNT(*) FILTER (WHERE outcome = 'win') w, COUNT(*) FILTER (WHERE outcome = 'draw') d, COUNT(*) FILTER (WHERE outcome = 'loss') l,
    COALESCE(MAX(CASE WHEN outcome = 'win' THEN level END), 0) best
  FROM results WHERE user_id = ?
`);
const friendCount = db.prepare('SELECT COUNT(*) n FROM friends WHERE user_id = ?');

const statsFor = async (uid) => ({
  online: await onlineStats.get({ u: uid }),
  ai: await aiStats.get(uid),
  friends: (await friendCount.get(uid)).n,
});

// ---------- profile ----------
api.get('/me', wrap(async (req, res) => {
  const shop = await getShopSettings();
  res.json({
    user: publicUser(req.user, req.isAdmin),
    stats: await statsFor(req.user.id),
    meta: {
      LANGS, THEMES, PIECE_SETS, BOARD_THEMES, COLORS, REACTIONS,
      PREMIUM_PRICE: shop.premiumPriceDiamonds,
      REFERRAL_REWARD, REFERRAL_INVITEE_REWARD,
      premiumPlans: shop.premiumPlans,
      diamondPacks: shop.diamondPacks,
      payUsername: shop.payUsername,
      botUsername: await getBotUsername(),
    },
  });
}));

api.patch('/me', wrap(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const lang = b.lang === undefined ? u.lang : b.lang;
  if (!LANGS.includes(lang)) throw bad('Unsupported language', 'bad_request');
  const theme = b.theme === undefined ? u.theme : b.theme;
  if (!THEMES.includes(theme)) throw bad('Unsupported theme', 'bad_request');
  const notifyEnabled = b.notifyEnabled === undefined ? u.notify_enabled : b.notifyEnabled ? 1 : 0;
  const discoverable = b.discoverable === undefined ? u.discoverable : b.discoverable ? 1 : 0;

  let pieceSet = u.piece_set || 'outline';
  let boardTheme = u.board_theme || 'classic';
  const wantsStyle = b.pieceSet !== undefined || b.boardTheme !== undefined;
  if (wantsStyle) {
    if (!isPremiumActive(u) && !req.isAdmin) throw new HttpError(403, 'Premium required', 'premium_required');
    if (b.pieceSet !== undefined) {
      if (!PIECE_SETS.includes(b.pieceSet)) throw bad('Unsupported piece set', 'bad_request');
      pieceSet = b.pieceSet;
    }
    if (b.boardTheme !== undefined) {
      if (!BOARD_THEMES.includes(b.boardTheme)) throw bad('Unsupported board theme', 'bad_request');
      boardTheme = b.boardTheme;
    }
  }

  let avatarKey = u.avatar_key || null;
  if (b.avatarKey !== undefined) {
    if (b.avatarKey === null || b.avatarKey === '' || b.avatarKey === 'default') {
      avatarKey = null;
    } else {
      const key = String(b.avatarKey);
      const m = /^medal:(.+)$/.exec(key);
      if (!m) throw bad('Invalid avatar', 'bad_request');
      const medal = await db.prepare('SELECT id FROM medals WHERE id = ? AND user_id = ?').get(m[1], u.id);
      if (!medal) throw bad('Medal not owned', 'forbidden');
      avatarKey = `medal:${medal.id}`;
    }
  }

  await db.prepare(`UPDATE users SET lang = ?, theme = ?, notify_enabled = ?, discoverable = ?, lang_set = ?,
    piece_set = ?, board_theme = ?, avatar_key = ? WHERE id = ?`)
    .run(lang, theme, notifyEnabled, discoverable, b.lang !== undefined ? 1 : u.lang_set, pieceSet, boardTheme, avatarKey, u.id);
  res.json({ user: publicUser(await getUser.get(u.id), req.isAdmin) });
}));

api.delete('/me', wrap(async (req, res) => {
  if (req.isAdmin) throw bad('Admins cannot delete their account here', 'admin_delete');
  const uid = req.user.id;
  // Close the games this user is part of so nobody is left waiting for them
  for (const g of await db.prepare("SELECT * FROM games WHERE status = 'active' AND (white_id = ? OR black_id = ?)").all(uid, uid)) {
    const result = g.white_id === uid ? '0-1' : '1-0';
    await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'resign', updated_at = now() WHERE id = ?").run(result, g.id);
    await Promise.all(['bullet', 'blitz', 'rapid', 'classic'].map((c) => cacheDel(`rankings:${c}`)));
    await cacheDel('lobby:busy');
    await pushGame(await getGame.get(g.id));
  }
  await db.prepare("UPDATE games SET status = 'cancelled' WHERE status IN ('open', 'invited') AND (creator_id = ? OR invited_id = ?)").run(uid, uid);
  await db.prepare('DELETE FROM game_invites WHERE user_id = ?').run(uid);
  await db.prepare('DELETE FROM users WHERE id = ?').run(uid); // friends and results cascade
  res.json({ ok: true });
}));

// Fallback heartbeat for clients without a working websocket (auth already marks the user online)
api.post('/ping', wrap(async (req, res) => res.json({ ok: true })));

// ---------- games ----------
const getGame = db.prepare('SELECT * FROM games WHERE id = ?');

function clockPayload(row, now = Date.now()) {
  const tc = normalizeTimeControl(row.time_control);
  const spec = presetOf(tc);
  if (!isTimed(tc) || row.white_ms == null || row.black_ms == null) return null;
  // Stored remaining at last move; clients drain the active side using turnStartedAt
  return {
    whiteMs: Number(row.white_ms),
    blackMs: Number(row.black_ms),
    turnStartedAt: row.status === 'active' && row.turn_started_at
      ? (row.turn_started_at instanceof Date ? row.turn_started_at.toISOString() : row.turn_started_at)
      : null,
    serverNow: new Date(now).toISOString(),
    initialMs: spec.baseMs,
    incrementMs: spec.incMs,
  };
}

const sameId = (a, b) => a != null && b != null && Number(a) === Number(b);

async function gameFor(row, uid, full = true) {
  const moves = parseMoves(row.moves);
  const you = sameId(row.white_id, uid) ? 'w' : sameId(row.black_id, uid) ? 'b' : null;
  const opponentId = [row.creator_id, row.invited_id, row.white_id, row.black_id].find((x) => x && !sameId(x, uid)) || null;
  const tc = normalizeTimeControl(row.time_control);
  const g = {
    id: row.id, status: row.status, mode: row.mode, timeControl: tc, timeCategory: categoryOf(tc),
    you, creator: row.creator_id, invitedId: row.invited_id,
    white: await person(row.white_id), black: await person(row.black_id), opponent: await person(opponentId),
    ply: moves.length, turn: turnOf(moves), result: row.result, reason: row.reason,
    drawBy: row.draw_by, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    clock: clockPayload(row),
  };
  if (row.status === 'invited' && row.creator_id === uid) g.invitees = await Promise.all((await invitesOf(row.id)).map(person));
  if (full) g.moves = moves;
  return g;
}

/** Timeout: loser flagged. Only a bare king for the winner → draw. */
async function finishTimeout(row, flaggedColour) {
  const chess = replay(parseMoves(row.moves));
  const winner = flaggedColour === 'w' ? 'b' : 'w';
  let mating = false;
  for (const rank of chess.board()) {
    for (const p of rank) if (p && p.color === winner && p.type !== 'k') { mating = true; break; }
    if (mating) break;
  }
  const result = mating ? (flaggedColour === 'w' ? '0-1' : '1-0') : '1/2-1/2';
  return finish(row, result, mating ? 'timeout' : 'timeout_draw');
}

async function claimFlagIfNeeded(row) {
  if (row.status !== 'active' || !isTimed(row.time_control) || row.white_ms == null) return row;
  const settled = settleClocks(row);
  if (!settled.flagged) return row;
  return finishTimeout(row, settled.flagged);
}

const inviteExpired = (row) => row.status === 'invited' && Date.now() - new Date(row.updated_at).getTime() > INVITE_TTL_MS;
const invitesOf = async (id) => (await db.prepare('SELECT user_id FROM game_invites WHERE game_id = ?').all(id)).map((r) => r.user_id);
const isInvitee = async (row, uid) => row.status === 'invited' && (await invitesOf(row.id)).includes(uid);
const participants = async (row) => [...new Set([row.creator_id, row.white_id, row.black_id,
  ...(row.status === 'invited' ? await invitesOf(row.id) : [row.invited_id])].filter(Boolean))];
/** Tell everyone who was asked that the request is gone (accepted by someone else, cancelled or expired) */
async function dropInvites(row, exceptId) {
  for (const id of await invitesOf(row.id)) if (id !== exceptId) realtime.send(id, { t: 'invite_gone', id: row.id });
  await db.prepare('DELETE FROM game_invites WHERE game_id = ?').run(row.id);
}
const isParticipant = async (row, uid) => (await participants(row)).includes(uid);

/** Push the current state of a game to everyone in it (over their websocket). */
async function pushGame(row) {
  if (!row) return;
  for (const id of await participants(row)) realtime.send(id, { t: 'game', game: await gameFor(row, id) });
}

async function loadGame(id, uid) {
  const row = await getGame.get(String(id));
  if (!row || !(await isParticipant(row, uid))) throw new HttpError(404, 'Game not found', 'notfound');
  return row;
}

const countOpen = db.prepare(`
  SELECT COUNT(*) n FROM games
  WHERE status IN ('open', 'invited', 'active') AND (creator_id = :u OR white_id = :u OR black_id = :u)
`);
const ensureRoom = async (uid) => { if ((await countOpen.get({ u: uid })).n >= MAX_OPEN_GAMES) throw bad('Too many games', 'too_many_games'); };

const makeFriends = db.prepare('INSERT INTO friends (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
const befriend = async (a, b) => { await makeFriends.run(a, b); await makeFriends.run(b, a); };
const areFriends = async (a, b) => !!(await db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b));

/** Seat the joiner next to the creator (random colours) and start the game. Only one joiner can win the race. */
async function startGame(row, joinerId) {
  const creatorWhite = Math.random() < 0.5;
  const tc = normalizeTimeControl(row.time_control);
  const spec = presetOf(tc);
  const whiteId = creatorWhite ? row.creator_id : joinerId;
  const blackId = creatorWhite ? joinerId : row.creator_id;
  const r = await db.prepare(`UPDATE games SET status = 'active', white_id = ?, black_id = ?, invited_id = ?,
    time_control = ?, white_ms = ?, black_ms = ?, turn_started_at = CASE WHEN ?::bigint IS NULL THEN NULL ELSE now() END,
    updated_at = now(), last_move_at = now() WHERE id = ? AND status IN ('open', 'invited')`)
    .run(whiteId, blackId, joinerId, tc, spec.baseMs, spec.baseMs, spec.baseMs, row.id);
  if (!r.changes) throw bad('This game is no longer available', 'game_unavailable'); // somebody else was faster
  if (row.mode === 'friend') await befriend(row.creator_id, joinerId); // playing through an invite makes you friends
  await dropInvites(row, joinerId); // the others are told that someone was faster
  const next = await getGame.get(row.id);
  await pushGame(next);
  if (!realtime.isOnline(row.creator_id)) {
    const joiner = (await person(joinerId)).name;
    notify.toUser(row.creator_id, (T) => T.accepted(joiner), { gameId: row.id });
  }
  return next;
}

const parseTimeControl = (raw) => normalizeTimeControl(raw);

// Online match-making: pair with someone who is waiting right now, otherwise wait
api.post('/games/quick', wrap(async (req, res) => {
  const uid = req.user.id;
  const timeControl = parseTimeControl(req.body && req.body.timeControl);
  const waiting = (await db.prepare("SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND time_control = ? AND creator_id != ? ORDER BY created_at LIMIT 20").all(timeControl, uid))
    .find((g) => realtime.isOnline(g.creator_id));
  if (waiting) return res.json({ game: await gameFor(await startGame(waiting, uid), uid) });

  const mine = await db.prepare("SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND time_control = ? AND creator_id = ? LIMIT 1").get(timeControl, uid);
  if (mine) return res.json({ game: await gameFor(mine, uid) });

  await ensureRoom(uid);
  const id = gameId();
  await db.prepare("INSERT INTO games (id, creator_id, status, mode, time_control) VALUES (?, ?, 'open', 'online', ?)").run(id, uid, timeControl);
  res.status(201).json({ game: await gameFor(await getGame.get(id), uid) });
}));

// Create a game: with opponentIds = challenge sent to several online players (first to accept plays),
// without = open game anyone with the link can join
api.post('/games', wrap(async (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  const timeControl = parseTimeControl(b.timeControl);
  const wanted = [...new Set((Array.isArray(b.opponentIds) ? b.opponentIds : b.opponentId != null ? [b.opponentId] : []).map(intParam))].slice(0, 10);
  await ensureRoom(uid);

  if (!wanted.length) {
    const id = gameId();
    await db.prepare("INSERT INTO games (id, creator_id, status, mode, time_control) VALUES (?, ?, 'open', 'friend', ?)").run(id, uid, timeControl);
    return res.status(201).json({ game: await gameFor(await getGame.get(id), uid) });
  }

  let failure = null; const targets = [];
  for (const opp of wanted) {
    const other = await getUser.get(opp);
    if (opp === uid || !other || other.blocked) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    if (!realtime.isOnline(opp)) { failure = new HttpError(409, 'Player is offline', 'user_offline'); continue; }
    if (!await areFriends(uid, opp) && !other.discoverable) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    targets.push(opp);
  }
  if (!targets.length) throw failure;

  // Sending the same request twice must not spam anyone: return the one that is already waiting
  const existing = await db.prepare("SELECT * FROM games WHERE status = 'invited' AND creator_id = ?").get(uid);
  if (existing) {
    const same = !inviteExpired(existing) && (await invitesOf(existing.id)).sort().join() === [...targets].sort().join();
    if (same) return res.json({ game: await gameFor(existing, uid) });
    await dropInvites(existing);
    await db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(existing.id);
  }

  const id = gameId();
  const friend = targets.length === 1 && await areFriends(uid, targets[0]);
  await db.prepare("INSERT INTO games (id, creator_id, invited_id, status, mode, time_control) VALUES (?, ?, ?, 'invited', ?, ?)")
    .run(id, uid, targets[0], friend ? 'friend' : 'online', timeControl);
  for (const t of targets) await db.prepare('INSERT INTO game_invites (game_id, user_id) VALUES (?, ?)').run(id, t);
  const row = await getGame.get(id);
  for (const t of targets) realtime.send(t, { t: 'invite', game: await gameFor(row, t), ttl: POPUP_MS }); // in-app only
  res.status(201).json({ game: await gameFor(row, uid) });
}));

api.get('/games/:id', wrap(async (req, res) => {
  const row = await getGame.get(String(req.params.id));
  if (!row) throw new HttpError(404, 'Game not found', 'notfound');
  const uid = req.user.id;
  if (!await isParticipant(row, uid)) {
    // A stranger holding the link may look at an open game in order to join it
    if (row.status !== 'open') throw new HttpError(404, 'Game not found', 'notfound');
    return res.json({ game: { id: row.id, status: 'open', joinable: true, opponent: await person(row.creator_id) } });
  }
  res.json({ game: await gameFor(row, uid) });
}));

api.post('/games/:id/join', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await getGame.get(String(req.params.id));
  if (!row) throw new HttpError(404, 'Game not found', 'notfound');
  if (await isParticipant(row, uid) && row.status !== 'open' && row.status !== 'invited') return res.json({ game: await gameFor(row, uid) });
  if (row.creator_id === uid) return res.json({ game: await gameFor(row, uid) }); // opening your own link
  if (inviteExpired(row)) { await dropInvites(row); await db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(row.id); await pushGame(await getGame.get(row.id)); throw bad('This game is no longer available', 'game_unavailable'); }
  const allowed = row.status === 'open' || await isInvitee(row, uid);
  if (!allowed) throw bad('This game is no longer available', 'game_unavailable');
  await ensureRoom(uid);
  res.json({ game: await gameFor(await startGame(row, uid), uid) });
}));

api.post('/games/:id/decline', wrap(async (req, res) => {
  const row = await loadGame(req.params.id, req.user.id);
  if (!await isInvitee(row, req.user.id)) throw bad('Nothing to decline', 'game_unavailable');
  await db.prepare('DELETE FROM game_invites WHERE game_id = ? AND user_id = ?').run(row.id, req.user.id);
  if (!(await invitesOf(row.id)).length) { // everybody said no
    await db.prepare("UPDATE games SET status = 'cancelled', updated_at = now() WHERE id = ?").run(row.id);
    await pushGame(await getGame.get(row.id));
  }
  res.json({ ok: true });
}));

// Leave a game that has not started yet (cancel an invitation or stop searching)
api.delete('/games/:id', wrap(async (req, res) => {
  const row = await loadGame(req.params.id, req.user.id);
  if (row.creator_id !== req.user.id || !['open', 'invited'].includes(row.status)) throw bad('Cannot cancel', 'game_unavailable');
  await dropInvites(row);
  await db.prepare("UPDATE games SET status = 'cancelled', updated_at = now() WHERE id = ?").run(row.id);
  await pushGame(await getGame.get(row.id));
  res.json({ ok: true });
}));

async function finish(row, result, reason) {
  await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = ?, draw_by = NULL, updated_at = now() WHERE id = ?")
    .run(result, reason, row.id);
  try { await applyRatingFinish(row, result); } catch (e) { console.error('[rating]', e.message || e); }
  // Rankings / busy-set caches must not serve pre-finish data
  await Promise.all(['bullet', 'blitz', 'rapid', 'classic'].map((c) => cacheDel(`rankings:${c}`)));
  await cacheDel('lobby:busy');
  const next = await getGame.get(row.id);
  await pushGame(next);

  // Players who are not looking at the app get the result in Telegram
  const w = row.white_id, b = row.black_id;
  const wName = (await person(w)).name, bName = (await person(b)).name;
  const tell = (id, other, won) => {
    if (realtime.isOnline(id)) return;
    notify.toUser(id, (T) => (result === '1/2-1/2' ? T.draw(other) : won ? T.win(other) : T.loss(other)), { gameId: row.id, effect: won ? 'party' : undefined });
  };
  tell(w, bName, result === '1-0');
  tell(b, wName, result === '0-1');
  return next;
}

async function activeGame(id, uid) {
  let row = await loadGame(id, uid);
  if (row.status === 'active') row = await claimFlagIfNeeded(row);
  if (row.status !== 'active') throw bad('The game is over', 'game_over');
  const colour = sameId(row.white_id, uid) ? 'w' : sameId(row.black_id, uid) ? 'b' : null;
  if (!colour) throw new HttpError(404, 'Game not found', 'notfound');
  return { row, colour };
}

/** Persist a move. Compare moves as jsonb (NOT ::text) — PG text form has spaces and breaks turn checks. */
async function saveMove(row, nextMovesJson, clocks) {
  if (clocks) {
    return db.prepare(`UPDATE games SET moves = ?::jsonb, draw_by = NULL, white_ms = ?, black_ms = ?, turn_started_at = now(),
        updated_at = now(), last_move_at = now()
      WHERE id = ? AND status = 'active' AND moves = ?::jsonb`)
      .run(nextMovesJson, clocks.whiteMs, clocks.blackMs, row.id, movesJson(row.moves));
  }
  return db.prepare(`UPDATE games SET moves = ?::jsonb, draw_by = NULL, updated_at = now(), last_move_at = now()
    WHERE id = ? AND status = 'active' AND moves = ?::jsonb`)
    .run(nextMovesJson, row.id, movesJson(row.moves));
}

api.post('/games/:id/move', wrap(async (req, res) => {
  const uid = req.user.id;
  const { row, colour } = await activeGame(req.params.id, uid);
  const { from, to, promotion } = req.body || {};
  if (!SQUARE.test(from) || !SQUARE.test(to)) throw bad('Illegal move', 'illegal_move');
  const moves = parseMoves(row.moves);
  if (turnOf(moves) !== colour) throw bad('Not your turn', 'not_your_turn');

  const now = Date.now();
  const clocks = afterMoveClocks(row, colour, now);
  if (clocks && clocks.flagged) {
    const next = await finishTimeout(row, clocks.flagged);
    return res.json({ game: await gameFor(next, uid) });
  }

  const r = applyMove(moves, from, to, promotion);
  const ply = r.moves.length;
  const upd = await saveMove(row, movesJson(r.moves), clocks);
  if (!upd.changes) throw bad('Not your turn', 'not_your_turn'); // another move got in first

  let next;
  if (r.over) {
    next = await finish(row, r.result, r.reason);
  } else {
    next = await getGame.get(row.id);
    await pushGame(next);
    const other = colour === 'w' ? row.black_id : row.white_id;
    // Timed games rely on the clock; only ping Telegram for untimed / classic
    if (!clocks && !realtime.isOnline(other) && row.notified_ply < ply) {
      await db.prepare('UPDATE games SET notified_ply = ? WHERE id = ?').run(ply, row.id);
      const me = (await person(uid)).name;
      notify.toUser(other, (T) => T.yourMove(me), { gameId: row.id });
    }
  }
  res.json({ game: await gameFor(next, uid) });
}));

/** Either player may claim a flag when a live clock has hit zero. */
api.post('/games/:id/flag', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await loadGame(req.params.id, uid);
  if (row.status !== 'active') return res.json({ game: await gameFor(row, uid) });
  const next = await claimFlagIfNeeded(row);
  res.json({ game: await gameFor(next, uid) });
}));

api.post('/games/:id/resign', wrap(async (req, res) => {
  const { row, colour } = await activeGame(req.params.id, req.user.id);
  res.json({ game: await gameFor(await finish(row, colour === 'w' ? '0-1' : '1-0', 'resign'), req.user.id) });
}));

api.post('/games/:id/draw', wrap(async (req, res) => {
  const uid = req.user.id;
  const { row, colour } = await activeGame(req.params.id, uid);
  const action = req.body && req.body.action;
  const other = colour === 'w' ? row.black_id : row.white_id;

  if (action === 'offer') {
    if (row.draw_by === colour) return res.json({ game: await gameFor(row, uid) });
    await db.prepare("UPDATE games SET draw_by = ?, updated_at = now() WHERE id = ?").run(colour, row.id);
    await pushGame(await getGame.get(row.id));
    if (!realtime.isOnline(other)) { const me = (await person(uid)).name; notify.toUser(other, (T) => T.drawOffer(me), { gameId: row.id }); }
  } else if (action === 'accept') {
    if (row.draw_by && row.draw_by !== colour) return res.json({ game: await gameFor(await finish(row, '1/2-1/2', 'agreement'), uid) });
    throw bad('No draw offer', 'bad_request');
  } else if (action === 'decline') {
    await db.prepare("UPDATE games SET draw_by = NULL, updated_at = now() WHERE id = ?").run(row.id);
    await pushGame(await getGame.get(row.id));
  } else throw bad('Unknown action', 'bad_request');
  res.json({ game: await gameFor(await getGame.get(row.id), uid) });
}));

// Emoji reactions travel straight to the opponent's screen and are not stored
const lastReact = new Map();
api.post('/games/:id/react', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await loadGame(req.params.id, uid);
  const emoji = req.body && req.body.emoji;
  if (!REACTIONS.includes(emoji)) throw bad('Unknown reaction', 'bad_request');
  const now = Date.now();
  if (now - (lastReact.get(uid) || 0) < 500) return res.json({ ok: true }); // flood guard
  lastReact.set(uid, now);
  for (const id of await participants(row)) if (id !== uid) realtime.send(id, { t: 'react', id: row.id, emoji, by: uid });
  res.json({ ok: true });
}));

// ---------- computer games (played in the browser, only the result is reported) ----------
const lastResult = new Map();
api.post('/results', wrap(async (req, res) => {
  const { level, outcome } = req.body || {};
  if (![1, 2, 3, 4].includes(level) || !['win', 'draw', 'loss'].includes(outcome)) throw bad('Bad result', 'bad_request');
  const now = Date.now();
  if (now - (lastResult.get(req.user.id) || 0) > 10_000) { // a real game takes longer than 10 seconds
    lastResult.set(req.user.id, now);
    await db.prepare('INSERT INTO results (user_id, level, outcome) VALUES (?, ?, ?)').run(req.user.id, level, outcome);
  }
  res.json({ stats: await statsFor(req.user.id) });
}));

const TC_CASE = `CASE COALESCE(g.time_control, 'classic')
  WHEN '1+0' THEN 'bullet' WHEN 'bullet' THEN 'bullet'
  WHEN '3+2' THEN 'blitz' WHEN '5+0' THEN 'blitz' WHEN 'blitz' THEN 'blitz'
  WHEN '10+0' THEN 'rapid' WHEN '15+10' THEN 'rapid' WHEN 'rapid' THEN 'rapid'
  ELSE 'classic' END`;

// ---------- live competitive rankings (Elo lifetime + monthly points) ----------
api.get('/rankings', wrap(async (req, res) => {
  ensurePreviousMonthMedals().catch(() => {});
  const board = req.query.board === 'monthly' ? 'monthly' : 'elo';
  const category = ['bullet', 'blitz', 'rapid', 'classic', 'all'].includes(req.query.category)
    ? req.query.category
    : (board === 'monthly' ? 'all' : 'bullet');
  const month = monthKey();
  const cacheKey = `rankings:${board}:${category}:${month}`;
  const cached = await cacheGet(cacheKey, 5_000);
  if (cached) return res.json(cached);

  let rows;
  if (board === 'elo') {
    const col = category === 'all' ? 'elo' : eloColumn(category);
    if (!ELO_COLS.has(col)) throw bad('Bad category', 'bad_request');
    const catClause = category === 'all' ? '' : ` AND (${TC_CASE}) = ?`;
    const params = category === 'all' ? [] : [category];
    rows = (await db.prepare(`
      SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
        u.${col} AS elo,
        COALESCE((
          SELECT COUNT(*) FROM games g
          WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online','friend')
            AND (g.white_id = u.id OR g.black_id = u.id)${catClause}
        ), 0) AS games
      FROM users u
      WHERE u.blocked = 0
        AND EXISTS (
          SELECT 1 FROM games g
          WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online','friend')
            AND (g.white_id = u.id OR g.black_id = u.id)${catClause}
        )
      ORDER BY u.${col} DESC, lower(COALESCE(u.first_name, '')) ASC
      LIMIT 100
    `).all(...params, ...params)).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      elo: Number(r.elo), games: Number(r.games), points: Number(r.elo),
      avatarKey: r.avatar_key || null,
    }));
  } else if (category === 'all') {
    rows = (await db.prepare(`
      SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
        m.points, m.wins, m.draws, m.losses,
        (m.wins + m.draws + m.losses) AS games
      FROM monthly_scores m
      JOIN users u ON u.id = m.user_id
      WHERE m.month = ? AND u.blocked = 0 AND m.points > 0
      ORDER BY m.points DESC, m.wins DESC, lower(COALESCE(u.first_name, '')) ASC
      LIMIT 100
    `).all(month)).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      points: Number(r.points), wins: Number(r.wins), draws: Number(r.draws), losses: Number(r.losses),
      games: Number(r.games), avatarKey: r.avatar_key || null,
    }));
  } else {
    rows = (await db.prepare(`
      SELECT * FROM (
        SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
          COUNT(*) AS games,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '1-0') OR (g.black_id = u.id AND g.result = '0-1') THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '0-1') OR (g.black_id = u.id AND g.result = '1-0') THEN 1 ELSE 0 END) AS losses
        FROM games g JOIN users u ON u.id = g.white_id OR u.id = g.black_id
        WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online', 'friend')
          AND (timezone('Asia/Tashkent', g.updated_at))::text LIKE ?
          AND (${TC_CASE}) = ?
          AND u.blocked = 0
        GROUP BY u.id, u.first_name, u.username, u.avatar_key
      ) r
      ORDER BY (wins * 2 + draws) DESC, wins DESC, games DESC, lower(name) ASC
      LIMIT 100
    `).all(`${month}%`, category)).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      wins: Number(r.wins), draws: Number(r.draws), losses: Number(r.losses),
      games: Number(r.games), points: Number(r.wins) * 2 + Number(r.draws),
      avatarKey: r.avatar_key || null,
    }));
  }

  const payload = {
    board, category, month, monthLabel: monthLabelEn(month),
    rankings: rows, updatedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, payload, 5_000);
  res.json(payload);
}));

// ---------- medals / avatar ----------
api.get('/medals/mine', wrap(async (req, res) => {
  ensurePreviousMonthMedals().catch(() => {});
  const rows = await db.prepare(`
    SELECT id, month, place, title, created_at FROM medals WHERE user_id = ? ORDER BY month DESC, place ASC
  `).all(req.user.id);
  res.json({
    avatarKey: req.user.avatar_key || null,
    medals: rows.map((r) => ({
      id: r.id, month: r.month, monthLabel: monthLabelEn(r.month), place: r.place,
      title: r.title, url: `/api/medals/${r.id}.svg`, key: `medal:${r.id}`,
    })),
  });
}));

// ---------- lobby: who is online and what games do I have ----------
api.get('/lobby', wrap(async (req, res) => {
  const uid = req.user.id;
  const ids = realtime.onlineIds();
  const many = (list) => Promise.all(list.map((g) => gameFor(g, uid, false)));
  const friendIds = new Set((await db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(uid)).map((r) => r.friend_id));

  const mine = await db.prepare(`
    SELECT * FROM games WHERE status IN ('open', 'invited', 'active')
      AND (creator_id = :u OR white_id = :u OR black_id = :u OR invited_id = :u
        OR id IN (SELECT game_id FROM game_invites WHERE user_id = :u)) ORDER BY updated_at DESC LIMIT 30
  `).all({ u: uid });
  // Shared busy-set cache (not per-user) — safe across lobby polls
  let busy;
  const busyCached = await cacheGet('lobby:busy', 2_000);
  if (busyCached) busy = new Set(busyCached);
  else {
    const pairs = (await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]);
    busy = new Set(pairs);
    await cacheSet('lobby:busy', pairs, 2_000);
  }

  const pendingInvites = await db.prepare(
    "SELECT i.user_id, i.game_id FROM game_invites i JOIN games g ON g.id = i.game_id WHERE g.status = 'invited' AND g.creator_id = ?"
  ).all(uid);
  const inviteGameByUser = new Map(pendingInvites.map((r) => [r.user_id, r.game_id]));

  let online = [];
  if (ids.length) {
    const cap = ids.slice(0, 500);
    const rows = await db.prepare(`SELECT id, first_name, discoverable, premium, premium_until FROM users WHERE blocked = 0 AND id != ? AND id IN (${cap.map(() => '?').join(',')})`).all(uid, ...cap);
    online = rows
      .filter((r) => r.discoverable || friendIds.has(r.id))
      .map((r) => ({
        id: r.id, name: r.first_name || 'Player', inGame: busy.has(r.id), friend: friendIds.has(r.id),
        premium: isPremiumActive(r),
        invited: inviteGameByUser.has(r.id), inviteGameId: inviteGameByUser.get(r.id) || null,
      }))
      .sort((a, b) => (b.friend - a.friend) || a.name.localeCompare(b.name))
      .slice(0, 40);
  }

  const recent = await db.prepare(`
    SELECT * FROM games WHERE status = 'finished' AND (white_id = :u OR black_id = :u) ORDER BY updated_at DESC LIMIT 8
  `).all({ u: uid });

  res.json({
    onlineCount: ids.length,
    online,
    games: {
      active: await many(mine.filter((g) => g.status === 'active')),
      invites: await many(mine.filter((g) => g.status === 'invited' && g.creator_id !== uid && !inviteExpired(g))),
      waiting: await many(mine.filter((g) => ['open', 'invited'].includes(g.status) && g.creator_id === uid)),
      recent: await many(recent),
    },
    stats: await statsFor(uid),
  });
}));

// ---------- live spectate (bot 2-player games) + Lichess broadcasts ----------
api.get('/live/games', wrap(async (req, res) => {
  const uid = req.user.id;
  const rows = await db.prepare(`
    SELECT * FROM games
    WHERE status = 'active' AND white_id IS NOT NULL AND black_id IS NOT NULL
    ORDER BY updated_at DESC LIMIT 40
  `).all();
  const games = await Promise.all(rows.map(async (row) => {
    const g = await gameFor(row, uid, false);
    g.spectating = !g.you;
    return g;
  }));
  res.json({ games, updatedAt: new Date().toISOString() });
}));

api.get('/live/games/:id', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await getGame.get(String(req.params.id));
  if (!row || !row.white_id || !row.black_id) throw new HttpError(404, 'Game not found', 'notfound');
  if (row.status !== 'active' && row.status !== 'finished') throw new HttpError(404, 'Game not found', 'notfound');
  const g = await gameFor(row, uid, true);
  g.spectating = !g.you;
  res.json({ game: g });
}));

const lichessFail = (e, notFoundMsg) => {
  if (e.status === 400 || e.code === 'bad_request') throw bad(e.message || 'Invalid id', 'bad_request');
  if (e.status === 404) throw new HttpError(404, notFoundMsg, 'notfound');
  if (e.status === 429) throw new HttpError(429, 'Too many requests', 'limit');
  throw new HttpError(502, 'Lichess is unavailable', 'upstream');
};

api.get('/lichess/broadcasts', wrap(async (req, res) => {
  try {
    const data = await lichess.topBroadcasts();
    res.json({
      active: data.active || [],
      upcoming: data.upcoming || [],
      updatedAt: new Date().toISOString(),
    });
  } catch (e) { lichessFail(e, 'Broadcast not found'); }
}));

api.get('/lichess/broadcasts/:id', wrap(async (req, res) => {
  try {
    const data = await lichess.broadcastTour(req.params.id);
    res.json({ ...data, updatedAt: new Date().toISOString() });
  } catch (e) { lichessFail(e, 'Broadcast not found'); }
}));

api.get('/lichess/rounds/:id', wrap(async (req, res) => {
  try {
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const data = await lichess.broadcastRound(req.params.id, {
      fresh,
      tourSlug: req.query.tourSlug,
      roundSlug: req.query.roundSlug,
      roundUrl: req.query.url,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ ...data, updatedAt: new Date().toISOString() });
  } catch (e) { lichessFail(e, 'Round not found'); }
}));

api.get('/lichess/rounds/:id/pgn', wrap(async (req, res) => {
  try {
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    if (fresh) await lichess.bustPgn(req.params.id);
    const data = await lichess.broadcastRoundPgn(req.params.id, { fresh });
    let gameId = '';
    try { gameId = req.query.game ? lichess.lichessId(req.query.game, 'game id') : ''; }
    catch { gameId = ''; }
    res.set('Cache-Control', 'no-store');
    if (gameId) {
      const one = (data.games || []).find((g) => g.id === gameId);
      if (!one) throw new HttpError(404, 'Game not found', 'notfound');
      return res.json({ roundId: data.roundId, game: one, updatedAt: new Date().toISOString() });
    }
    res.json({ roundId: data.roundId, games: data.games || [], updatedAt: new Date().toISOString() });
  } catch (e) {
    if (e.code === 'notfound') throw e;
    lichessFail(e, 'Round not found');
  }
}));

// ---------- friends ----------
api.get('/friends', wrap(async (req, res) => {
  const uid = req.user.id;
  const rows = await db.prepare(`
    SELECT u.id, u.first_name, u.premium, u.premium_until FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.first_name
  `).all(uid);
  const busy = new Set((await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]));
  const pending = await db.prepare(
    "SELECT i.user_id, i.game_id FROM game_invites i JOIN games g ON g.id = i.game_id WHERE g.status = 'invited' AND g.creator_id = ?"
  ).all(uid);
  const inviteGameByUser = new Map(pending.map((r) => [r.user_id, r.game_id]));
  res.json({
    friends: rows.map((r) => ({
      id: r.id, name: r.first_name || 'Player', online: realtime.isOnline(r.id), inGame: busy.has(r.id),
      premium: isPremiumActive(r),
      invited: inviteGameByUser.has(r.id), inviteGameId: inviteGameByUser.get(r.id) || null,
    })).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)),
  });
}));

// Called when someone opens a friend-invite link (t.me/<bot>?start=i<inviterId>)
api.post('/friends/join', wrap(async (req, res) => {
  const uid = req.user.id;
  const other = intParam(req.body && req.body.userId);
  const u = await getUser.get(other);
  if (other === uid || !u || u.blocked) throw new HttpError(404, 'Player not found', 'user_unavailable');
  const already = await areFriends(uid, other);
  await befriend(uid, other);
  let reward = 0;
  let inviteeReward = 0;
  if (!already) {
    // Referral URL join: inviter +20, invitee +10, once per invitee forever (referrals PK)
    const paid = await db.prepare(`
      WITH r AS (
        INSERT INTO referrals (invitee_id, inviter_id) VALUES (?, ?)
        ON CONFLICT DO NOTHING RETURNING invitee_id, inviter_id
      ),
      pay_inviter AS (
        UPDATE users SET diamonds = diamonds + ? WHERE id IN (SELECT inviter_id FROM r) RETURNING id
      ),
      pay_invitee AS (
        UPDATE users SET diamonds = diamonds + ? WHERE id IN (SELECT invitee_id FROM r) RETURNING id
      )
      SELECT
        (SELECT COUNT(*)::int FROM pay_inviter) AS inviter_paid,
        (SELECT COUNT(*)::int FROM pay_invitee) AS invitee_paid
    `).get(uid, other, REFERRAL_REWARD, REFERRAL_INVITEE_REWARD);
    if (paid && paid.inviter_paid) reward = REFERRAL_REWARD;
    if (paid && paid.invitee_paid) inviteeReward = REFERRAL_INVITEE_REWARD;
    const me = (await person(uid)).name;
    realtime.send(other, { t: 'friend', id: uid, reward });
    notify.toUser(other, (T) => T.friendJoined(me) + (reward ? ` 💎 +${reward}` : ''));
  }
  const meRow = inviteeReward ? await getUser.get(uid) : null;
  res.json({
    friend: await person(other),
    already,
    inviteeReward,
    user: meRow ? publicUser(meRow, req.isAdmin) : undefined,
  });
}));

// Spend diamonds on Premium (1 / 3 / 6 / 12 Tashkent months); renewals extend from current expiry
api.post('/premium/buy', wrap(async (req, res) => {
  const shop = await getShopSettings();
  const months = Math.floor(Number((req.body && req.body.months) ?? 1));
  const plan = shop.premiumPlans.find((p) => p.months === months);
  if (!plan) throw bad('Choose 1, 3, 6 or 12 months', 'bad_request');
  const price = plan.diamonds;
  const u = await getUser.get(req.user.id);
  if (Number(u.diamonds || 0) < price) throw bad('Not enough diamonds', 'no_diamonds');
  const base = (u.premium_until && new Date(u.premium_until).getTime() > Date.now())
    ? new Date(u.premium_until)
    : new Date();
  const until = addMonthsTashkent(base, months);
  const r = await db.prepare(`
    UPDATE users SET diamonds = diamonds - ?, premium = 1, premium_until = ?
    WHERE id = ? AND diamonds >= ?
  `).run(price, until.toISOString(), req.user.id, price);
  if (!r.changes) throw bad('Not enough diamonds', 'no_diamonds');
  const next = publicUser(await getUser.get(req.user.id), req.isAdmin);
  res.json({ user: next, months, price });
}));

/** User taps a diamond pack → notify admins so they can confirm payment and grant diamonds. */
api.post('/shop/order', wrap(async (req, res) => {
  const shop = await getShopSettings();
  const diamonds = Math.floor(Number(req.body && req.body.diamonds));
  const sum = Math.floor(Number(req.body && req.body.sum));
  const pack = shop.diamondPacks.find((p) => p.diamonds === diamonds && p.sum === sum);
  if (!pack) throw bad('Unknown diamond pack', 'bad_request');
  const u = req.user;
  const uname = u.username ? `@${u.username}` : '—';
  const som = pack.sum >= 1000 && pack.sum % 1000 === 0
    ? `${pack.sum / 1000} ming so'm`
    : `${pack.sum} so'm`;
  const text = [
    '💎 Olmos buyurtmasi',
    `User: ${u.first_name || 'Player'} (${uname})`,
    `ID: ${u.id}`,
    `Paket: ${pack.diamonds} 💎 — ${som}`,
    '',
    'To\'lovni tekshirib, Admin → Users orqali olmos bering.',
  ].join('\n');
  let notified = 0;
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.api.sendMessage(adminId, text);
      notified++;
    } catch (e) {
      console.error('[shop/order] admin notify failed:', adminId, e.description || e.message);
    }
  }
  res.json({ ok: true, pack, notified, payUsername: shop.payUsername });
}));

api.delete('/friends/:id', wrap(async (req, res) => {
  const other = intParam(req.params.id);
  await db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, other, other, req.user.id);
  res.json({ ok: true });
}));

// ---------- announcements (home carousel) ----------
const ANN_FONTS = ['system', 'rounded', 'serif', 'mono'];
const ANN_PAGES = ['play', 'puzzles', 'rankings', 'live', 'profile', 'premium', 'friends', 'settings', 'diamonds'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Tashkent is UTC+5 year-round. Accept "YYYY-MM-DDTHH:mm" wall clock → ISO UTC. */
function parseTashkentEnd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) throw bad('End date must be YYYY-MM-DD HH:mm (Tashkent)', 'ends_at');
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+05:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw bad('Invalid end date', 'ends_at');
  return d;
}

function formatTashkent(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

function publicAnnouncement(row) {
  return {
    id: Number(row.id),
    title: row.title || '',
    body: row.body || '',
    titleColor: row.title_color,
    bodyColor: row.body_color,
    bgFrom: row.bg_from,
    bgTo: row.bg_to,
    fontFamily: ANN_FONTS.includes(row.font_family) ? row.font_family : 'system',
    fontSize: Math.min(28, Math.max(14, Number(row.font_size) || 18)),
    mediaId: row.media_id || null,
    mediaUrl: row.media_id ? `/api/media/${row.media_id}` : null,
    linkType: row.link_type || 'none',
    linkUrl: row.link_url || null,
    linkPage: row.link_page || null,
    endsAt: row.ends_at,
    endsAtTashkent: formatTashkent(row.ends_at),
  };
}

async function purgeExpiredAnnouncements() {
  await db.prepare('DELETE FROM announcements WHERE ends_at <= now()').run();
}

function parseAnnouncementBody(b, { requireFuture = true } = {}) {
  const title = cleanText(b.title, 80, 'title', false);
  const body = cleanText(b.body, 160, 'body', false);
  if (!title && !body && !b.mediaId) throw bad('Add text or media', 'text');
  const titleColor = HEX.test(b.titleColor) ? b.titleColor : '#ffffff';
  const bodyColor = HEX.test(b.bodyColor) ? b.bodyColor : '#fbbf24';
  const bgFrom = HEX.test(b.bgFrom) ? b.bgFrom : '#3b82f6';
  const bgTo = HEX.test(b.bgTo) ? b.bgTo : '#6366f1';
  const fontFamily = ANN_FONTS.includes(b.fontFamily) ? b.fontFamily : 'system';
  const fontSize = Math.min(28, Math.max(14, Number(b.fontSize) || 18));
  let mediaId = null;
  if (b.mediaId) mediaId = String(b.mediaId);
  let linkType = 'none';
  let linkUrl = null;
  let linkPage = null;
  if (b.linkType === 'url') {
    const url = String(b.linkUrl || '').trim();
    if (!URL_RE.test(url)) throw bad('Link must start with https:// or tg://', 'link_url');
    linkType = 'url';
    linkUrl = url;
  } else if (b.linkType === 'page') {
    if (!ANN_PAGES.includes(b.linkPage)) throw bad('Unknown in-app page', 'link_page');
    linkType = 'page';
    linkPage = b.linkPage;
  } else if (b.linkType === 'invite') {
    // Tap → share the viewing user's personal referral link (t.me/<bot>?start=i<userId>)
    linkType = 'invite';
  }
  const ends = parseTashkentEnd(b.endsAtTashkent || b.endsAt);
  if (requireFuture && ends.getTime() <= Date.now()) throw bad('End date must be in the future (Tashkent)', 'ends_at');
  return {
    title, body, titleColor, bodyColor, bgFrom, bgTo, fontFamily, fontSize,
    mediaId, linkType, linkUrl, linkPage, endsAt: ends.toISOString(),
  };
}

api.get('/media/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Not found', 'notfound');
  const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) throw bad('Not found', 'notfound');
  const buf = await loadMediaBytes(row);
  if (!buf) throw bad('Not found', 'notfound');
  res.set({
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': buf.length,
  });
  res.end(buf);
}));

api.get('/announcements', wrap(async (req, res) => {
  await purgeExpiredAnnouncements();
  const rows = await db.prepare(`
    SELECT * FROM announcements WHERE ends_at > now() ORDER BY id DESC LIMIT 20
  `).all();
  res.json({ announcements: rows.map(publicAnnouncement), nowTashkent: formatTashkent(new Date()) });
}));

// ---------- admin ----------
const admin = express.Router();
admin.use((req, res, next) => (req.isAdmin ? next() : res.status(404).json({ error: 'Not found', code: 'notfound' }))); // do not reveal the panel

const one = async (sql, ...p) => (await db.prepare(sql).get(...p)).n;

admin.get('/stats', wrap(async (req, res) => {
  const signups = await db.prepare("SELECT to_char(created_at::date, 'YYYY-MM-DD') d, COUNT(*) c FROM users WHERE created_at::date >= current_date - 13 GROUP BY 1").all();
  const map = Object.fromEntries(signups.map((r) => [r.d, r.c]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: map[d] || 0 };
  });
  res.json({
    users: await one('SELECT COUNT(*) n FROM users'),
    live: realtime.onlineIds().length,
    newToday: await one("SELECT COUNT(*) n FROM users WHERE created_at::date = current_date"),
    active7d: await one("SELECT COUNT(*) n FROM users WHERE last_seen >= now() - interval '7 days'"),
    blocked: await one('SELECT COUNT(*) n FROM users WHERE blocked = 1'),
    unreachable: await one('SELECT COUNT(*) n FROM users WHERE bot_blocked = 1'),
    gamesLive: await one("SELECT COUNT(*) n FROM games WHERE status = 'active'"),
    gamesPlayed: await one("SELECT COUNT(*) n FROM games WHERE status = 'finished'"),
    byLang: await db.prepare('SELECT lang, COUNT(*) c FROM users GROUP BY lang').all(),
    signups: days,
  });
}));

// Everyone who has the app open right now
admin.get('/live', wrap(async (req, res) => {
  const ids = realtime.onlineIds().slice(0, 500);
  if (!ids.length) return res.json({ count: 0, users: [] });
  const rows = await db.prepare(`SELECT id, first_name, username, lang FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const busy = new Set((await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]));
  res.json({
    count: ids.length,
    users: rows.map((u) => ({ id: u.id, name: u.first_name || 'Player', username: u.username, lang: u.lang, inGame: busy.has(u.id), isAdmin: isAdmin(u.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

admin.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await db.prepare(`
    SELECT u.id, u.first_name, u.username, u.lang, u.blocked, u.bot_blocked, u.created_at, u.last_seen,
      u.diamonds, u.premium, u.premium_until,
      (SELECT COUNT(*) FROM games g WHERE g.status = 'finished' AND (g.white_id = u.id OR g.black_id = u.id)) games
    FROM users u
    WHERE ? = '' OR u.first_name ILIKE ? OR u.username ILIKE ? OR CAST(u.id AS TEXT) LIKE ?
    ORDER BY u.last_seen DESC LIMIT 100
  `).all(q, like, like, like);
  res.json({
    users: rows.map((u) => ({
      ...u,
      diamonds: Number(u.diamonds || 0),
      premium: isPremiumActive(u),
      premiumUntilTashkent: u.premium_until ? formatTashkent(u.premium_until) : null,
      online: realtime.isOnline(u.id),
      isAdmin: isAdmin(u.id),
    })),
  });
}));

admin.post('/users/:id/block', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  if (isAdmin(id)) throw bad('Admins cannot be blocked', 'admin_block');
  const blocked = req.body && req.body.blocked ? 1 : 0;
  if (!(await db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id)).changes) throw new HttpError(404, 'User not found', 'notfound');
  res.json({ ok: true, blocked: !!blocked });
}));

/**
 * Grant diamonds and/or Premium months after payment.
 * Body: { amount?: number, premiumMonths?: 1|3|6|12 }
 */
admin.post('/users/:id/diamonds', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const amount = Math.floor(Number(req.body && req.body.amount)) || 0;
  const premiumMonths = Math.floor(Number(req.body && req.body.premiumMonths)) || 0;
  if (!amount && !premiumMonths) {
    throw bad('Provide diamonds amount and/or premium months', 'bad_request');
  }
  if (amount && (Math.abs(amount) > 1_000_000)) {
    throw bad('Amount must be ±1…1000000', 'bad_request');
  }
  if (premiumMonths && !PREMIUM_MONTH_OPTIONS.includes(premiumMonths)) {
    throw bad('Premium months must be 1, 3, 6 or 12', 'bad_request');
  }
  const u = await getUser.get(id);
  if (!u) throw new HttpError(404, 'User not found', 'notfound');
  if (amount < 0 && Number(u.diamonds || 0) + amount < 0) {
    throw bad('Not enough diamonds to remove', 'no_diamonds');
  }

  let untilIso = u.premium_until || null;
  if (premiumMonths > 0) {
    const base = (u.premium_until && new Date(u.premium_until).getTime() > Date.now())
      ? new Date(u.premium_until)
      : new Date();
    untilIso = addMonthsTashkent(base, premiumMonths).toISOString();
  }

  if (amount && premiumMonths > 0) {
    await db.prepare('UPDATE users SET diamonds = diamonds + ?, premium = 1, premium_until = ? WHERE id = ?')
      .run(amount, untilIso, id);
  } else if (amount) {
    await db.prepare('UPDATE users SET diamonds = diamonds + ? WHERE id = ?').run(amount, id);
  } else {
    await db.prepare('UPDATE users SET premium = 1, premium_until = ? WHERE id = ?').run(untilIso, id);
  }

  const nextRow = await getUser.get(id);
  const next = publicUser(nextRow, isAdmin(nextRow.id));
  realtime.send(id, {
    t: 'wallet',
    user: next,
    granted: { diamonds: amount || 0, premiumMonths: premiumMonths || 0 },
  });
  const untilLabel = next.premiumUntilTashkent
    ? next.premiumUntilTashkent.replace('T', ' ')
    : null;
  await notify.toUser(id, (T) => T.walletGranted({
    diamonds: amount > 0 ? amount : 0,
    months: premiumMonths || 0,
    until: untilLabel,
  }), { force: true, effect: 'party' });
  res.json({ ok: true, user: next });
}));

admin.get('/shop', wrap(async (req, res) => {
  res.json({ shop: await getShopSettings() });
}));

admin.patch('/shop', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.premiumPlans !== undefined) {
    const plans = normalizePremiumPlans(b.premiumPlans, PREMIUM_PRICE_FALLBACK);
    if (plans.length < 1) throw bad('Need at least one premium plan', 'bad_request');
    await setSetting('premium_plans', JSON.stringify(plans));
    const one = plans.find((p) => p.months === 1);
    if (one) await setSetting('premium_price_diamonds', String(one.diamonds));
  } else if (b.premiumPriceDiamonds !== undefined) {
    const n = Math.floor(Number(b.premiumPriceDiamonds));
    if (!(n >= 1 && n <= 1_000_000)) throw bad('Premium price must be 1…1000000 diamonds', 'bad_request');
    await setSetting('premium_price_diamonds', String(n));
    const shop = await getShopSettings();
    const plans = shop.premiumPlans.map((p) => (p.months === 1 ? { ...p, diamonds: n } : p));
    if (!plans.some((p) => p.months === 1)) plans.unshift({ months: 1, diamonds: n });
    await setSetting('premium_plans', JSON.stringify(plans));
  }
  if (b.diamondPacks !== undefined) {
    const packs = normalizeDiamondPacks(b.diamondPacks);
    if (!packs.length) throw bad('Need at least one diamond pack', 'bad_request');
    await setSetting('diamond_packs', JSON.stringify(packs));
  }
  if (b.payUsername !== undefined) {
    const name = String(b.payUsername || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{5,64}$/.test(name)) throw bad('Invalid Telegram username', 'bad_request');
    await setSetting('pay_username', name);
  }
  res.json({ shop: await getShopSettings() });
}));

admin.get('/medals', wrap(async (req, res) => {
  const cfg = await getMedalConfig();
  const month = String(req.query.month || monthKey());
  const medals = await db.prepare(`
    SELECT m.id, m.month, m.place, m.user_id, m.title, u.first_name, u.username
    FROM medals m LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.month DESC, m.place ASC LIMIT 60
  `).all();
  const top = await db.prepare(`
    SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, s.points
    FROM monthly_scores s JOIN users u ON u.id = s.user_id
    WHERE s.month = ? AND u.blocked = 0 AND s.points > 0
    ORDER BY s.points DESC, s.wins DESC LIMIT 3
  `).all(month);
  res.json({
    config: cfg,
    fonts: FONT_KEYS,
    pieces: PIECE_KEYS,
    month,
    monthLabel: monthLabelEn(month),
    previousMonth: previousMonthKey(month),
    top,
    medals: medals.map((r) => ({
      id: r.id, month: r.month, place: r.place, userId: r.user_id,
      title: r.title, name: r.first_name || '', username: r.username || '',
      url: `/api/medals/${r.id}.svg`,
    })),
  });
}));

admin.patch('/medals/config', wrap(async (req, res) => {
  const cfg = normalizeConfig({ ...(await getMedalConfig()), ...(req.body || {}) });
  await setSetting('medal_gen_config', JSON.stringify(cfg));
  res.json({ config: cfg });
}));

admin.post('/medals/preview', wrap(async (req, res) => {
  const b = req.body || {};
  const cfg = normalizeConfig(b.config || await getMedalConfig());
  const place = Math.min(3, Math.max(1, Math.floor(Number(b.place) || 1)));
  const month = String(b.month || monthKey());
  const svg = generateMedalSvg({
    place, month,
    name: b.name || 'Player',
    username: b.username || '',
    userId: b.userId || 0,
    config: cfg,
  });
  res.json({
    svg,
    title: titleFor(cfg, place, month),
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  });
}));

admin.post('/medals/award', wrap(async (req, res) => {
  const month = String((req.body && req.body.month) || previousMonthKey());
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM', 'bad_request');
  const result = await awardMonthMedals(month);
  res.json(result);
}));

// ----- post composer: media upload -----
const KIND = { 'image/jpeg': 'photo', 'image/png': 'photo', 'image/gif': 'animation', 'video/mp4': 'video' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4' };
const MAX_PHOTO = 10 * 1024 * 1024; // Telegram's photo limit
const MAX_VIDEO = 25 * 1024 * 1024;

function sniff(buf) { // trust the bytes, not the Content-Type header
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  return null;
}

admin.post('/upload', express.raw({ type: () => true, limit: '26mb' }), wrap(async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No file received', 'media');
  const mime = sniff(buf);
  if (!mime) throw bad('Use JPG, PNG, GIF or MP4', 'media_type');
  const kind = KIND[mime];
  if (buf.length > (kind === 'photo' ? MAX_PHOTO : MAX_VIDEO)) throw bad('File is too large', 'media_big');
  const id = crypto.randomUUID();
  try {
    await saveMedia({ id, kind, mime, buf, adminId: req.user.id });
  } catch (e) {
    throw bad(e.message || 'Upload failed', 'media');
  }
  res.status(201).json({ id, kind, size: buf.length, storage: storageEnabled() });
}));

// ----- post composer: validate + send -----
function parseButtons(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 6) throw bad('Up to 6 buttons', 'buttons');
  return raw.map((b) => {
    const text = cleanText(b && b.text, 64, 'button_text', true);
    const type = b && b.type === 'app' ? 'app' : 'url';
    const color = COLORS.includes(b && b.color) ? b.color : 'default';
    if (type === 'app') {
      if (!(WEBAPP_URL || '').startsWith('https://')) throw bad('WEBAPP_URL is not configured', 'no_app_url');
      return { text, type, color };
    }
    const url = String((b && b.url) || '').trim();
    if (!URL_RE.test(url)) throw bad('Button link must start with https://', 'button_url');
    return { text, type, color, url };
  });
}

async function deliver(chatId, post) {
  try {
    await sendPost(bot, chatId, post);
  } catch (e) {
    if (e.error_code === 429 && e.parameters && e.parameters.retry_after) { // Telegram asked us to slow down
      await sleep((e.parameters.retry_after + 1) * 1000);
      await sendPost(bot, chatId, post);
    } else throw e;
  }
}

let broadcasting = false;
admin.post('/broadcast', wrap(async (req, res) => {
  const b = req.body || {};
  const text = String(b.text ?? '').trim();
  const buttons = parseButtons(b.buttons);

  let media = null;
  if (b.mediaId) {
    const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(String(b.mediaId));
    if (!row) throw bad('Media not found, upload it again', 'media');
    const data = await loadMediaBytes(row);
    if (!data && !row.file_id) throw bad('Media not found, upload it again', 'media');
    media = {
      id: row.id, kind: row.kind, data,
      filename: `${row.id}.${EXT[row.mime] || 'bin'}`,
      fileId: row.file_id || null,
    };
  }
  if (!text && !media) throw bad('Write a message or add media', 'text');
  if (text.length > (media ? 1024 : 4096)) throw bad('Text is too long', 'text_long');
  const lang = b.lang === 'all' || LANGS.includes(b.lang) ? b.lang : 'all';

  const post = {
    text, buttons, media, webAppUrl: WEBAPP_URL,
    onFileId: (id) => media && db.prepare('UPDATE media SET file_id = ? WHERE id = ?').run(id, media.id),
  };

  // Test: send only to the admin who pressed the button and report Telegram's answer
  if (b.test) {
    try { await deliver(req.user.id, post); } catch (e) { throw bad(`Telegram refused the post: ${e.description || e.message}`, 'tg_error'); }
    return res.json({ test: true, sent: 1 });
  }

  if (broadcasting) throw new HttpError(409, 'A broadcast is already running', 'busy');
  const targets = lang === 'all'
    ? await db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0').all()
    : await db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0 AND lang = ?').all(lang);
  const info = await db.prepare('INSERT INTO broadcasts (admin_id, text, media_id, lang, total) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .run(req.user.id, text, media ? media.id : null, lang, targets.length);
  const bid = Number(info.rows[0].id);
  broadcasting = true;
  res.json({ id: bid, queued: targets.length });

  // Send in the background at ~20 messages/second (Telegram allows ~30)
  (async () => {
    let sent = 0, failed = 0;
    const save = () => db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, bid);
    for (const t of targets) {
      try { await deliver(t.id, post); sent++; } catch (e) {
        failed++;
        if (e.error_code === 403) await db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?').run(t.id);
      }
      if ((sent + failed) % 10 === 0) save();
      await sleep(50);
    }
    save();
    await db.prepare("UPDATE broadcasts SET status = 'done' WHERE id = ?").run(bid);
    broadcasting = false;
    console.log(`[broadcast ${bid}] sent=${sent} failed=${failed}`);
    for (const a of ADMIN_IDS) bot.api.sendMessage(a, `✅ Broadcast #${bid}: ${sent} delivered, ${failed} failed.`).catch(() => {});
  })().catch((e) => { broadcasting = false; console.error('[broadcast] crashed:', e); });
}));

admin.get('/broadcasts', wrap(async (req, res) => {
  res.json({
    busy: broadcasting,
    broadcasts: await db.prepare('SELECT id, text, media_id, lang, total, sent, failed, status, created_at FROM broadcasts ORDER BY id DESC LIMIT 8').all(),
  });
}));

admin.get('/announcements', wrap(async (req, res) => {
  await purgeExpiredAnnouncements();
  const rows = await db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 40').all();
  res.json({
    announcements: rows.map(publicAnnouncement),
    fonts: ANN_FONTS,
    pages: ANN_PAGES,
    nowTashkent: formatTashkent(new Date()),
  });
}));

admin.post('/announcements', wrap(async (req, res) => {
  const p = parseAnnouncementBody(req.body || {});
  if (p.mediaId) {
    const m = await db.prepare('SELECT id FROM media WHERE id = ?').get(p.mediaId);
    if (!m) throw bad('Media not found, upload it again', 'media');
  }
  const info = await db.prepare(`
    INSERT INTO announcements (
      admin_id, title, body, title_color, body_color, bg_from, bg_to,
      font_family, font_size, media_id, link_type, link_url, link_page, ends_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).run(
    req.user.id, p.title, p.body, p.titleColor, p.bodyColor, p.bgFrom, p.bgTo,
    p.fontFamily, p.fontSize, p.mediaId, p.linkType, p.linkUrl, p.linkPage, p.endsAt,
  );
  res.status(201).json({ announcement: publicAnnouncement(info.rows[0]) });
}));

admin.patch('/announcements/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const cur = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!cur) throw bad('Not found', 'notfound');
  const b = req.body || {};
  const merged = {
    title: b.title !== undefined ? b.title : cur.title,
    body: b.body !== undefined ? b.body : cur.body,
    titleColor: b.titleColor !== undefined ? b.titleColor : cur.title_color,
    bodyColor: b.bodyColor !== undefined ? b.bodyColor : cur.body_color,
    bgFrom: b.bgFrom !== undefined ? b.bgFrom : cur.bg_from,
    bgTo: b.bgTo !== undefined ? b.bgTo : cur.bg_to,
    fontFamily: b.fontFamily !== undefined ? b.fontFamily : cur.font_family,
    fontSize: b.fontSize !== undefined ? b.fontSize : cur.font_size,
    mediaId: b.mediaId !== undefined ? b.mediaId : cur.media_id,
    linkType: b.linkType !== undefined ? b.linkType : cur.link_type,
    linkUrl: b.linkUrl !== undefined ? b.linkUrl : cur.link_url,
    linkPage: b.linkPage !== undefined ? b.linkPage : cur.link_page,
    endsAtTashkent: b.endsAtTashkent !== undefined ? b.endsAtTashkent : formatTashkent(cur.ends_at),
  };
  const p = parseAnnouncementBody(merged, { requireFuture: false });
  if (p.mediaId) {
    const m = await db.prepare('SELECT id FROM media WHERE id = ?').get(p.mediaId);
    if (!m) throw bad('Media not found, upload it again', 'media');
  }
  await db.prepare(`
    UPDATE announcements SET
      title = ?, body = ?, title_color = ?, body_color = ?, bg_from = ?, bg_to = ?,
      font_family = ?, font_size = ?, media_id = ?, link_type = ?, link_url = ?, link_page = ?, ends_at = ?
    WHERE id = ?
  `).run(
    p.title, p.body, p.titleColor, p.bodyColor, p.bgFrom, p.bgTo,
    p.fontFamily, p.fontSize, p.mediaId, p.linkType, p.linkUrl, p.linkPage, p.endsAt, id,
  );
  res.json({ announcement: publicAnnouncement(await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)) });
}));

admin.delete('/announcements/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const r = await db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  if (!r.changes) throw bad('Not found', 'notfound');
  res.json({ ok: true });
}));

api.use('/admin', admin);
app.use('/api', api);

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'notfound' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'bad_request' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large', code: 'media_big' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('[server] unexpected:', err);
  res.status(500).json({ error: 'Something went wrong', code: 'server' });
});

// ---------- boot ----------
realtime.attach(server, BOT_TOKEN, { getUser: (id) => getUser.get(id), touch: (id) => touchUser.run(id) });

async function boot() {
  await db.ready; // tables exist before anybody connects
  server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

  if (process.env.DISABLE_BOT !== '1') {
    if (!(WEBAPP_URL || '').startsWith('https://')) console.warn('[bot] WEBAPP_URL must be an https:// URL for the Open button to work.');
    bot.start({
      onStart: async (me) => {
        botUsername = botUsername || me.username;
        console.log(`[bot] @${me.username} started`);
        await setupMenu(bot, WEBAPP_URL);
      },
    }).catch((e) => console.error('[bot] failed to start:', e.message));
  }
  startScheduler(async (id) => pushGame(await getGame.get(id)));

  // Expire unanswered challenges and claim live-clock flags
  let sweeping = false;
  setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const g of await db.prepare("SELECT * FROM games WHERE status = 'invited'").all()) {
        if (!inviteExpired(g)) continue;
        await dropInvites(g);
        await db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ? AND status = 'invited'").run(g.id);
        await pushGame(await getGame.get(g.id));
      }
      for (const g of await db.prepare('SELECT * FROM games WHERE status = \'active\' AND white_ms IS NOT NULL').all()) {
        const next = await claimFlagIfNeeded(g);
        if (next.status !== 'active') await pushGame(next);
      }
    } catch (e) { console.error('[sweeper]', e.message); } finally { sweeping = false; }
  }, 2000).unref();
}
boot().catch((e) => { console.error('[boot] cannot start:', e.message); process.exit(1); });

process.on('SIGTERM', () => { bot.stop().catch(() => {}); server.close(); db.close().catch(() => {}); process.exit(0); });
