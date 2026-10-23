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
const { BOT_HANDLE } = require('./medal-art');
const { cacheGet, cacheSet, cacheDel, cacheEnabled, incr } = require('./cache');
const { saveMedia, loadMediaBytes, storageEnabled } = require('./storage');
const { DEFAULT_ELO, INITIAL_RD, rdAfterIdle, pairUpdate, scoresForResult, eloColumn, expandingEloDelta } = require('./elo');
const {
  monthKey, monthLabelEn, seasonLabel, previousMonthKey, tashkentDay, tashkentParts,
  isLastDayOfMonthTashkent, monthsForYear,
  generateMedalSvg, titleFor,
} = require('./medals');
const { svgToPngBuffer } = require('./medal-png');
const { loadWelcomeConfig, saveWelcomeLang, sendWelcome, resolveButtons } = require('./welcome');
const {
  ANIMATIONS: BOOT_ANIMS,
  loadBootSplashConfig,
  saveBootSplashLang,
  saveBootSplashConfig,
} = require('./boot-splash');
const { listCharAvatars, isCharAvatarKey, charAvatarExists, ASSET_V } = require('./char-avatars');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const THEMES = ['dark', 'light'];
const PIECE_SETS = ['cartoon', 'outline', 'classic', 'neo', 'staunton', 'studio'];
const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];
const DEFAULT_PIECE_SET = 'cartoon';
const DEFAULT_BOARD_THEME = 'green';
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
  setHeaders(res, file) {
    // JS/CSS: always revalidate — Telegram WebView otherwise serves truncated/stale modules
    // (bare import './app.js' ignores the entry.js?v= query and was flashing SyntaxError toasts).
    if (/\.(?:js|mjs|css)$/i.test(file)) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.(?:woff2?|png|jpe?g|gif|svg|webp|wasm)$/i.test(file)) {
      res.set('Cache-Control', 'public, max-age=86400, must-revalidate');
    } else {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Explicit MIME so Telegram WebView accepts ES module scripts
    if (file.endsWith('.mjs') || file.endsWith('.js')) {
      res.set('Content-Type', 'text/javascript; charset=utf-8');
    }
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
  res.set('Cache-Control', 'public, max-age=300');
  res.send(row.svg);
}));

// Free character avatars (PNG set under public/img/char-avatars/) — public for <img>
app.get('/api/char-avatars', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ avatars: listCharAvatars(), v: ASSET_V });
});
// Legacy SVG URL → static PNG (old clients / cached markup)
app.get('/api/char-avatars/:id.svg', (req, res) => {
  const id = String(req.params.id || '').replace(/\.svg$/i, '').toLowerCase();
  if (!charAvatarExists(id)) return res.status(404).json({ error: 'notfound' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.redirect(302, `/img/char-avatars/${encodeURIComponent(id)}.png?v=${ASSET_V}`);
});
app.get('/api/char-avatars/:id.png', (req, res) => {
  const id = String(req.params.id || '').replace(/\.png$/i, '').toLowerCase();
  if (!charAvatarExists(id)) return res.status(404).json({ error: 'notfound' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.redirect(302, `/img/char-avatars/${encodeURIComponent(id)}.png?v=${ASSET_V}`);
});

// Premium custom avatars — public so <img> tags can load without initData
app.get('/api/avatars/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Not found', 'notfound');
  const used = await db.prepare('SELECT 1 AS ok FROM users WHERE avatar_key = ? LIMIT 1').get(`img:${id}`);
  if (!used) throw new HttpError(404, 'Not found', 'notfound');
  const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  const buf = row && await loadMediaBytes(row);
  if (!buf) throw new HttpError(404, 'Not found', 'notfound');
  res.set({
    'Content-Type': row.mime || 'image/jpeg',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': buf.length,
  });
  res.end(buf);
}));

const DEFAULT_PROFILE_BANNER = path.join(__dirname, '..', 'public', 'img', 'profile-banner.png');

async function profileBannerMeta() {
  const mediaId = String(await getSetting('profile_banner_media_id', '') || '').trim();
  const custom = /^[0-9a-f-]{36}$/i.test(mediaId) ? mediaId : '';
  return {
    mediaId: custom || null,
    url: custom
      ? `/api/public/profile-banner?v=${encodeURIComponent(custom)}`
      : '/img/profile-banner.png',
  };
}

// Boot splash copy (admin-editable). Public — splash paints before Telegram auth.
app.get('/api/public/boot-splash', wrap(async (req, res) => {
  const splash = await loadBootSplashConfig();
  res.set('Cache-Control', 'public, max-age=30, must-revalidate');
  res.json({ splash, langs: LANGS, animations: BOOT_ANIMS });
}));

// Profile header banner (admin-replaceable). No auth so <img> / CSS can load it.
app.get('/api/public/profile-banner', wrap(async (req, res) => {
  const { mediaId } = await profileBannerMeta();
  if (mediaId) {
    const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    const buf = row && await loadMediaBytes(row);
    if (buf) {
      res.set({
        'Content-Type': row.mime || 'image/jpeg',
        'Cache-Control': 'public, max-age=120, must-revalidate',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }
  }
  res.set('Cache-Control', 'public, max-age=3600');
  return res.sendFile(DEFAULT_PROFILE_BANNER);
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const intParam = (v) => { const n = Number(v); if (!Number.isSafeInteger(n)) throw bad('Invalid id', 'bad_request'); return n; };
const cleanText = (v, max, code, required = false) => {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) throw bad('Required', code);
  return s;
};
/** `@name` → username search; otherwise first/last name (and digits → Telegram id for admin). */
function parseUserSearchQuery(raw) {
  const s = String(raw ?? '').trim().slice(0, 40);
  if (!s) return { mode: 'empty', q: '' };
  if (s.includes('@')) {
    const q = s.replace(/@+/g, '').trim().toLowerCase();
    if (!q) return { mode: 'empty', q: '' };
    return { mode: 'username', q };
  }
  return { mode: 'name', q: s.toLowerCase() };
}
/** Escape `%` `_` `\` for LIKE … ESCAPE '\' so usernames like alice_chess match literally. */
function likePattern(q) {
  const s = String(q || '').replace(/[%_\\]/g, (ch) => `\\${ch}`);
  return `%${s}%`;
}
const gameId = () => crypto.randomBytes(6).toString('base64url'); // 8 chars, safe inside a deep link

// ---------- users ----------
const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
// Username always follows Telegram. first_name/last_name only seed on insert (editable in-app later).
const upsertUser = db.prepare(`
  INSERT INTO users (id, first_name, last_name, username, lang) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET username = excluded.username, last_seen = now()
`);
const touchUser = db.prepare('UPDATE users SET last_seen = now() WHERE id = ?');
const touchPresent = db.prepare(`
  UPDATE users SET last_seen = now(),
    present_until = now() + (? * interval '1 millisecond')
  WHERE id = ?
`);
const clearPresent = db.prepare('UPDATE users SET present_until = NULL WHERE id = ?');
const nameOf = db.prepare(`
  SELECT first_name, last_name, username, present_until, avatar_key, premium, premium_until, elo, diamonds
  FROM users WHERE id = ?
`);

function displayName(u) {
  if (!u) return 'Player';
  const full = [u.first_name || u.firstName, u.last_name || u.lastName].filter(Boolean).join(' ').trim();
  return full || 'Player';
}

function stillPresent(presentUntil) {
  if (!presentUntil) return false;
  const t = presentUntil instanceof Date ? presentUntil.getTime() : new Date(presentUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function isUserOnline(id, presentUntil) {
  return realtime.isOnline(id) || stillPresent(presentUntil);
}

async function userIsOnline(id) {
  if (realtime.isOnline(id)) return true;
  const u = await db.prepare('SELECT present_until FROM users WHERE id = ?').get(id);
  return stillPresent(u && u.present_until);
}

/** Challengeable only with a live Mini App WebSocket (invites are pushed in-app). */
function userIsChallengeable(id) {
  return realtime.hasSocket(id);
}

/** Throttle present_until writes — every HTTP used to UPDATE users (too heavy at ~2.5k live). */
const lastPresenceWrite = new Map();
const PRESENCE_WRITE_MIN_MS = Math.max(
  2_000,
  Number(process.env.PRESENCE_WRITE_MS || Math.floor(realtime.presenceMs / 2)),
);

async function refreshPresence(id) {
  const now = Date.now();
  const prev = lastPresenceWrite.get(id) || 0;
  if (now - prev < PRESENCE_WRITE_MIN_MS) return;
  lastPresenceWrite.set(id, now);
  await touchPresent.run(realtime.presenceMs, id);
  if (lastPresenceWrite.size > 20_000) {
    for (const [k, t] of lastPresenceWrite) {
      if (now - t > 10 * 60_000) lastPresenceWrite.delete(k);
    }
  }
}

/** Short TTL user row cache — cuts getUser/upsert storm under lobby polling. */
const userMemo = new Map(); // id -> { at, user }
const USER_MEMO_MS = Math.max(500, Number(process.env.USER_MEMO_MS || 2_000));
const lastProfileSync = new Map(); // id -> last upsertUser ms
const USER_SYNC_MS = Math.max(5_000, Number(process.env.USER_SYNC_MS || 60_000));

function memoUser(user) {
  if (!user) return;
  userMemo.set(user.id, { at: Date.now(), user });
}

function invalidateUserCache(id) {
  userMemo.delete(id);
}

async function ensureAuthedUser(tg) {
  const now = Date.now();
  const hit = userMemo.get(tg.id);
  if (hit && now - hit.at < USER_MEMO_MS) return hit.user;

  const lastSync = lastProfileSync.get(tg.id) || 0;
  if (now - lastSync >= USER_SYNC_MS) {
    await upsertUser.run(
      tg.id,
      tg.first_name || '',
      tg.last_name || '',
      tg.username || '',
      fromTelegram(tg.language_code),
    );
    lastProfileSync.set(tg.id, now);
  }

  let user = await getUser.get(tg.id);
  if (!user) {
    await upsertUser.run(
      tg.id,
      tg.first_name || '',
      tg.last_name || '',
      tg.username || '',
      fromTelegram(tg.language_code),
    );
    lastProfileSync.set(tg.id, now);
    user = await getUser.get(tg.id);
  }
  memoUser(user);
  return user;
}

async function person(id) {
  if (!id) return null;
  const u = (await nameOf.get(id)) || {};
  return {
    id,
    name: displayName(u),
    username: u.username || '',
    online: isUserOnline(id, u.present_until),
    premium: isPremiumActive(u),
    avatarKey: u.avatar_key || null,
    elo: Number(u.elo || DEFAULT_ELO),
    diamonds: isAdmin(id) ? null : Number(u.diamonds || 0), // admin balance is never shown to players
    isBot: Number(id) >= 9_000_000_000_000,
  };
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
    id: u.id,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    displayName: displayName(u),
    username: u.username || '',
    country: u.country || '',
    region: u.region || '',
    bio: u.bio || '',
    lang: u.lang, theme: u.theme,
    langSet: !!u.lang_set, notifyEnabled: !!u.notify_enabled, discoverable: !!u.discoverable, isAdmin: admin,
    diamonds: Number(u.diamonds || 0), premium,
    premiumUntil: until && !Number.isNaN(until.getTime()) ? until.toISOString() : null,
    premiumUntilTashkent: until && !Number.isNaN(until.getTime()) ? formatTashkent(until) : null,
    pieceSet: (premium || admin)
      ? (PIECE_SETS.includes(u.piece_set) ? u.piece_set : DEFAULT_PIECE_SET)
      : DEFAULT_PIECE_SET,
    boardTheme: (premium || admin)
      ? (BOARD_THEMES.includes(u.board_theme) ? u.board_theme : DEFAULT_BOARD_THEME)
      : DEFAULT_BOARD_THEME,
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
  const rdCol = col.replace(/^elo/, 'rd');
  const idle = (u) => (Date.now() - new Date(u.rd_at || Date.now()).getTime()) / 86400000;
  const rdOf = (u, c) => rdAfterIdle(Number(u[c]) || INITIAL_RD, idle(u));
  const updCat = pairUpdate(wCat, bCat, scores.white, rdOf(white, rdCol), rdOf(black, rdCol));
  const updAll = pairUpdate(Number(white.elo || DEFAULT_ELO), Number(black.elo || DEFAULT_ELO), scores.white, rdOf(white, 'rd'), rdOf(black, 'rd'));
  const save = (id, a, all) => db.prepare(`UPDATE users SET ${col} = ?, elo = ?, ${rdCol} = ?, rd = ?, rd_at = now() WHERE id = ?`)
    .run(a.v, all.v, a.rd, all.rd, id);
  await save(white.id, { v: updCat.a, rd: updCat.rdA }, { v: updAll.a, rd: updAll.rdA });
  await save(black.id, { v: updCat.b, rd: updCat.rdB }, { v: updAll.b, rd: updAll.rdB });
  invalidateUserCache(white.id);
  invalidateUserCache(black.id);
  await db.prepare('UPDATE games SET elo_w_before = ?, elo_w_after = ?, elo_b_before = ?, elo_b_after = ? WHERE id = ?')
    .run(wCat, updCat.a, bCat, updCat.b, row.id);

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
  await clearRankingCaches();
}

function clearRankingCaches() {
  const mk = monthKey();
  return Promise.all(['bullet', 'blitz', 'rapid', 'classic', 'all'].flatMap((c) => [
    cacheDel(`rankings:v3:elo:${c}:${mk}`),
    cacheDel(`rankings:v3:monthly:${c}:${mk}`),
    ...['day', 'week', 'month'].map((p) => cacheDel(`rankings:v3:period:${p}:${c}:${mk}`)),
  ]));
}

/** Latest medal of every holder: { [userId]: { id, place, month } } (cached; the table only grows by 3 rows a month). */
async function medalHolders() {
  const hit = await cacheGet('medal:holders', 60_000);
  if (hit) return hit;
  const rows = await db.prepare(`
    SELECT DISTINCT ON (user_id) user_id, id, place, month FROM medals ORDER BY user_id, month DESC, place ASC
  `).all();
  const map = {};
  for (const r of rows) map[String(r.user_id)] = { id: r.id, place: r.place, month: r.month };
  await cacheSet('medal:holders', map, 60_000);
  return map;
}

async function loadTopScores(month) {
  return db.prepare(`
    SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, m.points
    FROM monthly_scores m JOIN users u ON u.id = m.user_id
    WHERE m.month = ? AND u.blocked = 0 AND m.points > 0 AND u.id < 9000000000000
    ORDER BY m.points DESC, m.wins DESC, lower(COALESCE(u.first_name, '')) ASC
    LIMIT 3
  `).all(month);
}

/** Freeze top-3 at ~23:59 on the last Tashkent day of the month (for next-day award). */
async function snapshotMonthPodium(month) {
  const m = month || monthKey();
  const top = await loadTopScores(m);
  if (!top.length) return null;
  const payload = top.map((u, i) => ({
    place: i + 1, userId: u.id, name: u.name, username: u.username || '', points: u.points,
  }));
  await setSetting(`medal_snapshot_${m}`, JSON.stringify(payload));
  return payload;
}

async function loadPodiumForAward(month) {
  const raw = await getSetting(`medal_snapshot_${month}`, '');
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        return list.map((r, i) => ({
          id: Number(r.userId),
          name: r.name || 'Player',
          username: r.username || '',
          points: Number(r.points) || 0,
          place: Number(r.place) || (i + 1),
        })).filter((r) => r.id);
      }
    } catch { /* fall through */ }
  }
  const top = await loadTopScores(month);
  return top.map((u, i) => ({ id: u.id, name: u.name, username: u.username, points: u.points, place: i + 1 }));
}

/** Monthly ranking podium Premium: Top1 = 1 month, Top2 = 20 days, Top3 = 15 days. */
const PODIUM_PREMIUM = {
  1: { months: 1, days: 0 },
  2: { months: 0, days: 20 },
  3: { months: 0, days: 15 },
};

/** Extend Premium from now (or existing expiry). Returns { until, user } or null. */
async function grantPodiumPremium(userId, place, meta = {}) {
  const reward = PODIUM_PREMIUM[place];
  if (!reward) return null;
  const u = await getUser.get(userId);
  if (!u) return null;
  const base = (u.premium_until && new Date(u.premium_until).getTime() > Date.now())
    ? new Date(u.premium_until)
    : new Date();
  const until = reward.months > 0
    ? addMonthsTashkent(base, reward.months)
    : addDaysUtc(base, reward.days);
  await db.prepare('UPDATE users SET premium = 1, premium_until = ? WHERE id = ?')
    .run(until.toISOString(), userId);
  invalidateUserCache(userId);
  const nextRow = await getUser.get(userId);
  memoUser(nextRow);
  const next = publicUser(nextRow, isAdmin(nextRow.id));
  try {
    realtime.send(userId, {
      t: 'wallet',
      user: next,
      granted: {
        diamonds: 0,
        premiumMonths: reward.months || 0,
        premiumDays: reward.days || 0,
        reason: 'monthly_podium',
        ...meta,
      },
    });
  } catch { /* ignore */ }
  return { until, user: next, months: reward.months || 0, days: reward.days || 0 };
}

async function awardMonthMedals(month, { notifyWinners = false } = {}) {
  const m = month || previousMonthKey();
  if (!/^\d{4}-\d{2}$/.test(m)) throw bad('month must be YYYY-MM', 'bad_request');
  // Never award the in-progress month — only completed seasons
  if (m >= monthKey()) throw bad('Cannot award the current month yet', 'bad_request');
  const top = await loadPodiumForAward(m);
  const awarded = [];
  for (const u of top) {
    const place = u.place || (awarded.length + 1);
    if (place > 3) break;
    const id = `m-${m}-p${place}`;
    const title = titleFor(place, m);
    const svg = generateMedalSvg({
      place, month: m,
    });
    await db.prepare(`
      INSERT INTO medals (id, month, place, user_id, title, svg)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (month, place) DO UPDATE SET
        user_id = EXCLUDED.user_id, title = EXCLUDED.title, svg = EXCLUDED.svg
    `).run(id, m, place, u.id, title, svg);
    const saved = await db.prepare('SELECT id FROM medals WHERE month = ? AND place = ?').get(m, place);
    const mid = saved?.id || id;
    awarded.push({ id: mid, place, userId: u.id, name: u.name, title, month: m, svg });
  }

  // Idempotent Premium for podium (once per completed month)
  const premiumAlready = await getSetting(`medal_premium_${m}`, '');
  const premiumGrants = [];
  if (premiumAlready !== '1' && awarded.length) {
    for (const a of awarded) {
      try {
        const g = await grantPodiumPremium(a.userId, a.place, { month: m, place: a.place });
        if (g) {
          premiumGrants.push({
            place: a.place,
            userId: a.userId,
            months: g.months,
            days: g.days,
            until: g.until.toISOString(),
          });
          a.premiumMonths = g.months;
          a.premiumDays = g.days;
        }
      } catch (e) {
        console.error('[medals] premium', a.userId, e.message || e);
      }
    }
    if (premiumGrants.length) await setSetting(`medal_premium_${m}`, '1');
  } else {
    // Already granted — still expose intended amounts for API consumers
    for (const a of awarded) {
      const r = PODIUM_PREMIUM[a.place];
      if (r) { a.premiumMonths = r.months || 0; a.premiumDays = r.days || 0; }
    }
  }

  if (notifyWinners && awarded.length) {
    const season = seasonLabel(m);
    for (const a of awarded) {
      const u = await getUser.get(a.userId);
      const T = require('./i18n').tr(u?.lang || 'en');
      const caption = T.medalAward({
        place: a.place,
        season,
        bot: BOT_HANDLE,
        premiumMonths: a.premiumMonths || 0,
        premiumDays: a.premiumDays || 0,
      });
      try {
        const png = await svgToPngBuffer(a.svg);
        await notify.sendMedal(a.userId, {
          svg: a.svg,
          png,
          filename: `medal-${m}-top${a.place}`,
          caption,
        });
      } catch (e) {
        console.error('[medals] notify', a.userId, e.message || e);
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    await setSetting(`medals_notified_${m}`, '1');
  }
  await cacheDel('medal:holders');
  return {
    month: m,
    monthLabel: monthLabelEn(m),
    awarded: awarded.map(({ svg, ...rest }) => rest),
    premiumGrants,
  };
}

/** Lazy mint previous month medals (no DM) if scores exist and medals missing. */
async function ensurePreviousMonthMedals() {
  const prev = previousMonthKey();
  const hasScores = await db.prepare(
    'SELECT 1 AS ok FROM monthly_scores WHERE month = ? AND points > 0 LIMIT 1',
  ).get(prev);
  if (!hasScores) return null;
  const hasMedals = await db.prepare('SELECT 1 AS ok FROM medals WHERE month = ? LIMIT 1').get(prev);
  if (hasMedals) return null;
  try { return await awardMonthMedals(prev, { notifyWinners: false }); } catch (e) {
    console.error('[medals]', e.message || e);
    return null;
  }
}

/**
 * Last day 23:xx Tashkent → freeze podium.
 * 1st of month → mint medals + DM PNG to winners.
 */
async function runMonthlyMedalAwards() {
  try {
    const parts = tashkentParts();
    if (isLastDayOfMonthTashkent() && parts.hour === 23) {
      const cur = monthKey();
      const already = await getSetting(`medal_snapshot_${cur}`, '');
      if (!already) {
        const snap = await snapshotMonthPodium(cur);
        if (snap) console.log('[medals] snapshot', cur, snap.map((s) => s.userId).join(','));
      }
    }
  } catch (e) {
    console.error('[medals] snapshot', e.message || e);
  }

  if (tashkentDay() !== 1) return null;
  const prev = previousMonthKey();
  const already = await getSetting(`medals_notified_${prev}`, '');
  if (already === '1') return null;
  const podium = await loadPodiumForAward(prev);
  if (!podium.length) {
    await setSetting(`medals_notified_${prev}`, '1');
    return null;
  }
  try {
    return await awardMonthMedals(prev, { notifyWinners: true });
  } catch (e) {
    console.error('[medals] monthly award', e.message || e);
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

/** Strict parse for admin PATCH — never silently drop packs. */
function parseDiamondPacksStrict(raw) {
  if (!Array.isArray(raw)) throw bad('Invalid diamond packs', 'bad_request');
  if (!raw.length) throw bad('Need at least one diamond pack', 'bad_request');
  const out = [];
  for (const p of raw) {
    const diamonds = Math.floor(Number(p && p.diamonds));
    const sum = Math.floor(Number(p && p.sum));
    if (!(diamonds >= 1 && diamonds <= 1_000_000)) {
      throw bad('Pack diamonds must be 1…1000000', 'bad_request');
    }
    if (!(sum >= 1000 && sum <= 1_000_000_000)) {
      throw bad('Pack price must be at least 1000 so\'m', 'bad_request');
    }
    out.push({ diamonds, sum });
  }
  return out;
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

const PUZZLE_DAILY_REWARD_FALLBACK = 2;

function normalizePuzzleDailyReward(raw) {
  const n = Math.floor(Number(raw));
  if (!(n >= 0 && n <= 1_000_000)) return PUZZLE_DAILY_REWARD_FALLBACK;
  return n;
}

const ANALYSIS_DAILY_FREE_FALLBACK = 3;
function normalizeAnalysisDailyFree(raw) {
  const n = Math.floor(Number(raw));
  if (!(n >= 0 && n <= 100)) return ANALYSIS_DAILY_FREE_FALLBACK;
  return n;
}

/** In-memory spectators per game (single Render instance). */
const spectatorWatch = new Map(); // gameId -> Map(userId -> expiresAtMs)
function pruneSpectators(gameId) {
  const m = spectatorWatch.get(gameId);
  if (!m) return 0;
  const now = Date.now();
  for (const [uid, exp] of m) if (exp <= now) m.delete(uid);
  if (!m.size) spectatorWatch.delete(gameId);
  return m ? m.size : 0;
}
function touchSpectator(gameId, userId, ttlMs = 25_000) {
  if (!gameId || !userId) return 0;
  let m = spectatorWatch.get(gameId);
  if (!m) { m = new Map(); spectatorWatch.set(gameId, m); }
  m.set(Number(userId), Date.now() + ttlMs);
  return pruneSpectators(gameId);
}
function spectatorCount(gameId) {
  return pruneSpectators(gameId);
}
const lastSpecPushed = new Map();
// Viewers leave silently (their poll just stops): recompute every few seconds and push changes to the players
setInterval(() => {
  for (const [gameId] of spectatorWatch) lastSpecPushed.set(gameId, lastSpecPushed.get(gameId) ?? -1);
  for (const [gameId, prev] of lastSpecPushed) {
    const n = spectatorCount(gameId);
    if (n === prev) { if (!n) lastSpecPushed.delete(gameId); continue; }
    lastSpecPushed.set(gameId, n);
    getGame.get(gameId).then((row) => { if (row) pushSpectatorCount(gameId, row); }).catch(() => {});
  }
}, 5000).unref();
function pushSpectatorCount(gameId, row) {
  const n = spectatorCount(gameId);
  for (const id of [row.white_id, row.black_id].filter(Boolean)) {
    realtime.send(id, { t: 'spectators', id: gameId, count: n });
  }
}

const TOUR_CFG_DEFAULT = { prize1: 20, prize2: 15, prize3: 10, organizer: 10, organizerBig: 15, bigThreshold: 16, weeklyLimit: 1, dailyJoinLimit: 1 };
/** Tournament economy, editable in the admin shop (stored as one JSON setting). */
function normalizeTourCfg(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = {}; } }
  o = o && typeof o === 'object' ? o : {};
  const out = {};
  for (const [k, def] of Object.entries(TOUR_CFG_DEFAULT)) {
    const n = Math.floor(Number(o[k]));
    const max = k === 'weeklyLimit' || k === 'dailyJoinLimit' ? 50 : (k === 'bigThreshold' ? 64 : 1_000_000);
    const min = k === 'weeklyLimit' || k === 'dailyJoinLimit' || k === 'bigThreshold' ? 1 : 0;
    out[k] = Number.isFinite(n) && n >= min && n <= max ? n : def;
  }
  return out;
}

function normalizeReferralAmount(raw, fallback) {
  const n = Math.floor(Number(raw));
  if (!(n >= 0 && n <= 1_000_000)) return fallback;
  return n;
}

async function getShopSettings() {
  const cached = await cacheGet('shop:settings', 30_000);
  if (cached) {
    return {
      ...cached,
      referralReward: normalizeReferralAmount(cached.referralReward, REFERRAL_REWARD),
      referralInviteeReward: normalizeReferralAmount(cached.referralInviteeReward, REFERRAL_INVITEE_REWARD),
      puzzleDailyReward: normalizePuzzleDailyReward(cached.puzzleDailyReward),
      analysisDailyFree: normalizeAnalysisDailyFree(cached.analysisDailyFree),
      tour: normalizeTourCfg(cached.tour),
    };
  }
  const [priceRaw, plansRaw, packsRaw, payRaw, puzzleRewardRaw, referralRaw, inviteeRaw, analysisFreeRaw, tourRaw] = await Promise.all([
    getSetting('premium_price_diamonds', String(PREMIUM_PRICE_FALLBACK)),
    getSetting('premium_plans', JSON.stringify(DEFAULT_PREMIUM_PLANS)),
    getSetting('diamond_packs', JSON.stringify(DEFAULT_DIAMOND_PACKS)),
    getSetting('pay_username', DEFAULT_PAY_USERNAME),
    getSetting('puzzle_daily_reward', String(PUZZLE_DAILY_REWARD_FALLBACK)),
    getSetting('referral_reward', String(REFERRAL_REWARD)),
    getSetting('referral_invitee_reward', String(REFERRAL_INVITEE_REWARD)),
    getSetting('analysis_daily_free', String(ANALYSIS_DAILY_FREE_FALLBACK)),
    getSetting('tour_config', JSON.stringify(TOUR_CFG_DEFAULT)),
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
  const shop = {
    premiumPriceDiamonds,
    premiumPlans,
    diamondPacks: normalizeDiamondPacks(packsRaw),
    payUsername,
    puzzleDailyReward: normalizePuzzleDailyReward(puzzleRewardRaw),
    referralReward: normalizeReferralAmount(referralRaw, REFERRAL_REWARD),
    referralInviteeReward: normalizeReferralAmount(inviteeRaw, REFERRAL_INVITEE_REWARD),
    analysisDailyFree: normalizeAnalysisDailyFree(analysisFreeRaw),
    tour: normalizeTourCfg(tourRaw),
  };
  await cacheSet('shop:settings', shop, 30_000);
  return shop;
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

function addDaysUtc(from, days) {
  const n = Math.floor(Number(days));
  if (!(n >= 1 && n <= 3660)) throw bad('Invalid premium days', 'bad_request');
  const d = from instanceof Date ? new Date(from.getTime()) : new Date(from);
  d.setTime(d.getTime() + n * 86400000);
  return d;
}

function normalizePromoCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function publicPromo(row) {
  return {
    id: Number(row.id),
    code: row.code,
    rewardType: row.reward_type,
    rewardAmount: Number(row.reward_amount),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    usedCount: Number(row.used_count || 0),
    endsAt: row.ends_at,
    endsAtTashkent: formatTashkent(row.ends_at),
    active: !!row.active && new Date(row.ends_at).getTime() > Date.now(),
    note: row.note || '',
    createdAt: row.created_at,
  };
}

/** Soft-expire Premium flag when premium_until has passed. */
async function syncPremiumExpiry(u) {
  if (!u || !u.premium_until) return u;
  if (new Date(u.premium_until).getTime() > Date.now()) return u;
  if (u.premium) {
    await db.prepare('UPDATE users SET premium = 0 WHERE id = ? AND premium_until IS NOT NULL AND premium_until <= now()').run(u.id);
    u.premium = 0;
    memoUser(u);
  }
  return u;
}

// ---------- bot ----------
const bot = createBot(BOT_TOKEN, WEBAPP_URL || 'https://example.com');
notify.init(bot, WEBAPP_URL);

let botUsername = process.env.BOT_USERNAME || null;
/** Resolves quickly: cached, or getMe with a hard 2s cap so /me never stalls on Telegram. */
async function getBotUsername() {
  if (botUsername) return botUsername;
  try {
    const me = await Promise.race([
      bot.api.getMe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getMe timeout')), 2_000)),
    ]);
    botUsername = me && me.username ? me.username : null;
  } catch (e) {
    console.error('[bot] getMe failed:', e.description || e.message);
    bot.api.getMe().then((me) => { if (me && me.username) botUsername = me.username; }).catch(() => {});
  }
  return botUsername;
}

// ---------- auth + rate limit (Redis when configured, else in-memory) ----------
const hits = new Map(); // userId -> requests in the current minute (memory fallback)
setInterval(() => hits.clear(), 60_000).unref();
/** Per-user requests/minute. Sized for ~2.5k live (lobby + game); abuse still capped. */
const RATE_LIMIT_PER_MIN = Math.max(60, Number(process.env.RATE_LIMIT_PER_MIN || 240));

async function auth(req, res, next) {
  try {
  const tg = validateInitData(req.get('X-Init-Data'), BOT_TOKEN);
  if (!tg) return res.status(401).json({ error: 'Open this app from Telegram', code: 'auth' });

  // Live Lichess boards poll every 1-2s and are served from a shared server cache, so they get
  // their own bucket: watching a tournament must never use up the budget for normal actions.
  const liveRead = req.method === 'GET' && String(req.path || '').startsWith('/lichess/');
  const bucket = liveRead ? `l${tg.id}` : tg.id;
  const limit = liveRead ? RATE_LIMIT_PER_MIN * 3 : RATE_LIMIT_PER_MIN;
  let n;
  if (cacheEnabled()) {
    n = await incr(`rl:${bucket}:${Math.floor(Date.now() / 60_000)}`, 70);
  } else {
    n = (hits.get(bucket) || 0) + 1;
    hits.set(bucket, n);
  }
  if (n > limit) return res.status(429).json({ error: 'Too many requests', code: 'limit' });

  let user = await ensureAuthedUser(tg);
  if (user.blocked) return res.status(403).json({ error: 'Your access has been disabled', code: 'blocked' });
  user = await syncPremiumExpiry(user);
  memoUser(user);

  // /bye must not refresh REST presence (would keep the user "online" for REST_ONLINE_MS)
  const leaving = req.method === 'POST' && String(req.path || '').replace(/\/$/, '') === '/bye';
  if (leaving) realtime.clearRest(user.id);
  else {
    realtime.markRest(user.id);
    await refreshPresence(user.id);
  }
  req.user = user;
  req.isAdmin = isAdmin(user.id);
  req.startParam = tg.startParam || null;
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
const friendCount = db.prepare('SELECT COUNT(*) n FROM friends WHERE user_id = ?');

/** Online PvP only — vs-computer results never affect stats or Elo. */
const statsFor = async (uid) => ({
  online: await onlineStats.get({ u: uid }),
  ai: { w: 0, d: 0, l: 0, best: 0 },
  friends: (await friendCount.get(uid)).n,
});

// ---------- profile ----------
api.get('/me', wrap(async (req, res) => {
  const shop = await getShopSettings();
  const banner = await profileBannerMeta();
  // Prefer signed start_param (latest deep link) over a possibly stale pending_inviter from an older /start
  let claimed = { reward: 0, inviteeReward: 0, inviterId: null, befriended: false, inserted: false };
  if (req.startParam) {
    claimed = await claimStartParamReferral(req.user.id, req.startParam);
  }
  if (!claimed.inserted && !claimed.reward && !claimed.inviteeReward && !(await referralRowExists(req.user.id))) {
    claimed = await claimPendingReferral(req.user.id);
  }
  if (claimed.inviterId && (claimed.reward || claimed.inviteeReward || claimed.befriended)) {
    const meName = (await person(req.user.id)).name;
    realtime.send(claimed.inviterId, { t: 'friend', id: req.user.id, reward: claimed.reward || 0 });
    notify.toUser(claimed.inviterId, (T) => T.friendJoined(meName) + (claimed.reward ? ` 💎 +${claimed.reward}` : ''));
  }
  const userRow = claimed.inviteeReward || claimed.reward
    ? await getUser.get(req.user.id)
    : req.user;
  if (userRow && (claimed.inviteeReward || claimed.reward)) memoUser(userRow);
  let referralClaim;
  if (claimed.inviteeReward && claimed.inviterId) {
    const friend = await person(claimed.inviterId);
    referralClaim = { inviteeReward: claimed.inviteeReward, friend };
  }
  res.json({
    user: publicUser(userRow, req.isAdmin),
    stats: await statsFor(req.user.id),
    referralClaim,
    meta: {
      LANGS, THEMES, PIECE_SETS, BOARD_THEMES, COLORS, REACTIONS,
      MEDAL_HOLDERS: await medalHolders(),
      PREMIUM_PRICE: shop.premiumPriceDiamonds,
      REFERRAL_REWARD: shop.referralReward,
      REFERRAL_INVITEE_REWARD: shop.referralInviteeReward,
      premiumPlans: shop.premiumPlans,
      diamondPacks: shop.diamondPacks,
      payUsername: shop.payUsername,
      puzzleDailyReward: shop.puzzleDailyReward,
      analysisDailyFree: shop.analysisDailyFree,
      botUsername: await getBotUsername(),
      profileBannerUrl: banner.url,
      profileBannerMediaId: banner.mediaId,
    },
  });
}));

/** Wallet history: purchases, referral bonuses, admin grants, spends. */
api.get('/me/diamonds/history', wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, amount, kind, meta, created_at
    FROM diamond_ledger
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  `).all(req.user.id);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount || 0),
      kind: r.kind,
      meta: typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : (r.meta || {}),
      at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })),
  });
}));

api.patch('/me', wrap(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  // Username is Telegram-owned — never accept client edits
  if (b.username !== undefined) throw bad('Username comes from Telegram', 'username_readonly');

  const lang = b.lang === undefined ? u.lang : b.lang;
  if (!LANGS.includes(lang)) throw bad('Unsupported language', 'bad_request');
  const theme = b.theme === undefined ? u.theme : b.theme;
  if (!THEMES.includes(theme)) throw bad('Unsupported theme', 'bad_request');
  const notifyEnabled = b.notifyEnabled === undefined ? u.notify_enabled : b.notifyEnabled ? 1 : 0;
  const discoverable = b.discoverable === undefined ? u.discoverable : b.discoverable ? 1 : 0;

  const firstName = b.firstName === undefined ? u.first_name : cleanText(b.firstName, 64, 'bad_request');
  const lastName = b.lastName === undefined ? (u.last_name || '') : cleanText(b.lastName, 64, 'bad_request');
  const country = b.country === undefined ? (u.country || '') : cleanText(b.country, 64, 'bad_request');
  const region = b.region === undefined ? (u.region || '') : cleanText(b.region, 64, 'bad_request');
  if (b.firstName !== undefined && !firstName) throw bad('Name is required', 'bad_request');

  let bio = u.bio || '';
  if (b.bio !== undefined) {
    if (!isPremiumActive(u) && !req.isAdmin) throw new HttpError(403, 'Premium required', 'premium_required');
    bio = cleanText(b.bio, 160, 'bad_request');
  }

  let pieceSet = u.piece_set || DEFAULT_PIECE_SET;
  let boardTheme = u.board_theme || DEFAULT_BOARD_THEME;
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
  const prevAvatarKey = u.avatar_key || null;
  if (b.avatarKey !== undefined) {
    if (b.avatarKey === null || b.avatarKey === '' || b.avatarKey === 'default') {
      avatarKey = null;
    } else {
      const key = String(b.avatarKey);
      const charId = isCharAvatarKey(key);
      const medalM = /^medal:(.+)$/.exec(key);
      const imgM = /^img:([0-9a-f-]{36})$/i.exec(key);
      if (charId) {
        // Character avatars are a Premium perk (an already-chosen one stays usable)
        if (`char:${charId}` !== prevAvatarKey && !isPremiumActive(u) && !req.isAdmin) throw new HttpError(403, 'Premium required', 'premium_required');
        avatarKey = `char:${charId}`;
      } else if (medalM) {
        const medal = await db.prepare('SELECT id FROM medals WHERE id = ? AND user_id = ?').get(medalM[1], u.id);
        if (!medal) throw bad('Medal not owned', 'forbidden');
        avatarKey = `medal:${medal.id}`;
      } else if (imgM) {
        const media = await db.prepare('SELECT id, kind FROM media WHERE id = ? AND admin_id = ?').get(imgM[1], u.id);
        if (!media || media.kind === 'video') throw bad('Invalid avatar', 'bad_request');
        avatarKey = `img:${media.id}`;
      } else {
        throw bad('Invalid avatar', 'bad_request');
      }
    }
  }

  await db.prepare(`UPDATE users SET lang = ?, theme = ?, notify_enabled = ?, discoverable = ?, lang_set = ?,
    piece_set = ?, board_theme = ?, avatar_key = ?, first_name = ?, last_name = ?, country = ?, region = ?, bio = ?
    WHERE id = ?`)
    .run(
      lang, theme, notifyEnabled, discoverable, b.lang !== undefined ? 1 : u.lang_set,
      pieceSet, boardTheme, avatarKey, firstName, lastName, country, region, bio, u.id,
    );
  if (b.avatarKey !== undefined) await releaseAvatarMedia(prevAvatarKey, avatarKey);
  invalidateUserCache(u.id);
  const next = await getUser.get(u.id);
  memoUser(next);
  res.json({ user: publicUser(next, req.isAdmin) });
}));

const MAX_AVATAR = 5 * 1024 * 1024;
const AVATAR_MIME = {
  'image/jpeg': 'photo',
  'image/png': 'photo',
  'image/gif': 'animation',
};

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

/** Drop orphaned custom-avatar media when the user switches away from it. */
async function releaseAvatarMedia(prevKey, nextKey) {
  const prev = prevKey && /^img:([0-9a-f-]{36})$/i.exec(String(prevKey));
  if (!prev) return;
  const next = nextKey && /^img:([0-9a-f-]{36})$/i.exec(String(nextKey || ''));
  if (next && next[1] === prev[1]) return;
  const id = prev[1];
  await db.prepare('DELETE FROM media WHERE id = ?').run(id).catch(() => {});
}

/** Everyone: upload a custom avatar photo (JPG/PNG/GIF ≤ 5 MB). Picking a character avatar is the Premium perk. */
api.post('/me/avatar', express.raw({ type: () => true, limit: '6mb' }), wrap(async (req, res) => {
  const u = req.user;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No file received', 'media');
  const mime = sniffImage(buf);
  if (!mime) throw bad('Use JPG, PNG or GIF', 'media_type');
  if (buf.length > MAX_AVATAR) throw bad('File is too large', 'media_big');
  const kind = AVATAR_MIME[mime];
  const id = crypto.randomUUID();
  const prevKey = u.avatar_key || null;
  try {
    await saveMedia({ id, kind, mime, buf, adminId: u.id });
  } catch (e) {
    throw bad(e.message || 'Upload failed', 'media');
  }
  const avatarKey = `img:${id}`;
  await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').run(avatarKey, u.id);
  await releaseAvatarMedia(prevKey, avatarKey);
  invalidateUserCache(u.id);
  const next = await getUser.get(u.id);
  memoUser(next);
  res.status(201).json({ user: publicUser(next, req.isAdmin) });
}));

/**
 * Wipe a user from the DB.
 * @param {number} uid
 * @param {{ keepFinishedGames?: boolean }} [opts] self-delete keeps finished PvP games for opponents;
 *   admin purge removes every game so rejoin starts clean (stats/referrals/Elo).
 */
async function purgeUser(uid, { keepFinishedGames = false } = {}) {
  for (const g of await db.prepare("SELECT * FROM games WHERE status = 'active' AND (white_id = ? OR black_id = ?)").all(uid, uid)) {
    const result = g.white_id === uid ? '0-1' : '1-0';
    await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'resign', updated_at = now() WHERE id = ?").run(result, g.id);
    await pushGame(await getGame.get(g.id)).catch(() => {});
  }
  await db.prepare("UPDATE games SET status = 'cancelled' WHERE status IN ('open', 'invited') AND (creator_id = ? OR invited_id = ?)").run(uid, uid);
  await db.prepare('DELETE FROM game_invites WHERE user_id = ? OR game_id IN (SELECT id FROM games WHERE creator_id = ? OR white_id = ? OR black_id = ? OR invited_id = ?)').run(uid, uid, uid, uid, uid);
  if (keepFinishedGames) {
    await db.prepare(`DELETE FROM games WHERE (creator_id = ? OR white_id = ? OR black_id = ? OR invited_id = ?)
      AND status != 'finished'`).run(uid, uid, uid, uid);
  } else {
    await db.prepare('DELETE FROM games WHERE creator_id = ? OR white_id = ? OR black_id = ? OR invited_id = ?')
      .run(uid, uid, uid, uid);
  }
  await clearPresent.run(uid).catch(() => {});
  // friends, results, DMs, medals, referrals, likes, blocks, scores, puzzle claims cascade
  await db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  await Promise.all([cacheDel('lobby:busy'), clearRankingCaches()]);
  try { realtime.send(uid, { t: 'account_deleted' }); } catch { /* ignore */ }
}

api.delete('/me', wrap(async (req, res) => {
  if (req.isAdmin) throw bad('Admins cannot delete their account here', 'admin_delete');
  await purgeUser(req.user.id, { keepFinishedGames: true });
  res.json({ ok: true });
}));

// Fallback heartbeat for clients without a working websocket (auth already marks the user online)
api.post('/ping', wrap(async (req, res) => res.json({ ok: true })));

// Mini App closed / backgrounded — drop from the live list immediately
api.post('/bye', wrap(async (req, res) => {
  await clearPresent.run(req.user.id);
  res.json({ ok: true });
}));

// ---------- games ----------
const getGame = db.prepare('SELECT * FROM games WHERE id = ?');

function clockPayload(row, now = Date.now()) {
  const tc = normalizeTimeControl(row.time_control);
  const spec = presetOf(tc);
  if (!isTimed(tc)) return null;
  // Waiting games still expose the chosen time control so the UI can show clocks immediately
  if (row.white_ms == null || row.black_ms == null) {
    return {
      whiteMs: spec.baseMs,
      blackMs: spec.baseMs,
      turnStartedAt: null,
      serverNow: new Date(now).toISOString(),
      initialMs: spec.baseMs,
      incrementMs: spec.incMs,
    };
  }
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
    takebackBy: row.takeback_by || null,
  };
  if (row.status === 'finished' && row.elo_w_before != null && row.elo_b_before != null) {
    g.rating = { w: { before: row.elo_w_before, after: row.elo_w_after }, b: { before: row.elo_b_before, after: row.elo_b_after } };
  }
  if (row.status === 'invited' && row.creator_id === uid) g.invitees = await Promise.all((await invitesOf(row.id)).map(person));
  if (full) g.moves = moves;
  g.spectators = spectatorCount(row.id);
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
const isInvitee = async (row, uid) => ['invited', 'open'].includes(row.status) && (await invitesOf(row.id)).includes(uid);
const participants = async (row) => [...new Set([row.creator_id, row.white_id, row.black_id,
  ...((row.status === 'invited' || row.status === 'open') ? await invitesOf(row.id) : [row.invited_id])].filter(Boolean))];
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
/** @returns {Promise<boolean>} true if at least one friendship edge was newly inserted */
const befriend = async (a, b) => {
  const r1 = await makeFriends.run(a, b);
  const r2 = await makeFriends.run(b, a);
  return (r1.changes > 0) || (r2.changes > 0);
};
const areFriends = async (a, b) => !!(await db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b));

/** Append a wallet history row (amount may be negative for spends). */
async function ledgerDiamonds(userId, amount, kind, meta = {}) {
  const n = Math.floor(Number(amount) || 0);
  if (!userId || !kind || !n) return;
  try {
    await db.prepare(
      'INSERT INTO diamond_ledger (user_id, amount, kind, meta) VALUES (?, ?, ?, ?::jsonb)',
    ).run(userId, n, String(kind).slice(0, 40), JSON.stringify(meta || {}));
  } catch (e) {
    console.error('[ledger]', e.message || e);
  }
}

const emptyReferral = () => ({ reward: 0, inviteeReward: 0, inserted: false, befriended: false });

/** Pay referral diamonds once per invitee (referrals PK). Amounts from admin shop settings. */
async function applyReferralPay(inviteeId, inviterId) {
  if (!inviteeId || !inviterId || inviteeId === inviterId) return emptyReferral();
  const inviter = await getUser.get(inviterId);
  if (!inviter || inviter.blocked) return emptyReferral();
  const befriended = await befriend(inviteeId, inviterId);
  const shop = await getShopSettings();
  const inviterAmt = shop.referralReward;
  const inviteeAmt = shop.referralInviteeReward;
  // Both zero: still befriend, but do not insert referrals (would burn the one-shot forever)
  if (inviterAmt <= 0 && inviteeAmt <= 0) {
    return { reward: 0, inviteeReward: 0, inserted: false, befriended };
  }
  const metaInv = JSON.stringify({ inviteeId });
  const metaIee = JSON.stringify({ inviterId });
  // Balance + ledger in one statement so history cannot drift from the wallet
  const paid = await db.prepare(`
    WITH r AS (
      INSERT INTO referrals (invitee_id, inviter_id) VALUES (?, ?)
      ON CONFLICT DO NOTHING RETURNING invitee_id, inviter_id
    ),
    pay_inviter AS (
      UPDATE users SET diamonds = diamonds + ?
      WHERE ? > 0 AND id IN (SELECT inviter_id FROM r)
      RETURNING id
    ),
    pay_invitee AS (
      UPDATE users SET diamonds = diamonds + ?
      WHERE ? > 0 AND id IN (SELECT invitee_id FROM r)
      RETURNING id
    ),
    led_inviter AS (
      INSERT INTO diamond_ledger (user_id, amount, kind, meta)
      SELECT inviter_id, ?, 'referral_inviter', ?::jsonb FROM r WHERE ? > 0
      RETURNING id
    ),
    led_invitee AS (
      INSERT INTO diamond_ledger (user_id, amount, kind, meta)
      SELECT invitee_id, ?, 'referral_invitee', ?::jsonb FROM r WHERE ? > 0
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM r) AS inserted,
      (SELECT COUNT(*)::int FROM pay_inviter) AS inviter_paid,
      (SELECT COUNT(*)::int FROM pay_invitee) AS invitee_paid
  `).get(
    inviteeId, inviterId,
    inviterAmt, inviterAmt,
    inviteeAmt, inviteeAmt,
    inviterAmt, metaInv, inviterAmt,
    inviteeAmt, metaIee, inviteeAmt,
  );
  const inserted = !!(paid && paid.inserted);
  if (inserted) {
    invalidateUserCache(inviterId);
    invalidateUserCache(inviteeId);
  }
  return {
    reward: inserted ? inviterAmt : 0,
    inviteeReward: inserted ? inviteeAmt : 0,
    inserted,
    befriended,
  };
}

async function referralRowExists(inviteeId) {
  return !!(await db.prepare('SELECT 1 AS ok FROM referrals WHERE invitee_id = ?').get(inviteeId));
}

async function clearPendingInviter(inviteeId) {
  await db.prepare('UPDATE users SET pending_inviter_id = NULL WHERE id = ?').run(inviteeId);
}

/** Claim bot-stored pending inviter (Menu Button / welcome Open). */
async function claimPendingReferral(inviteeId) {
  const row = await db.prepare('SELECT pending_inviter_id FROM users WHERE id = ?').get(inviteeId);
  const inviterId = row && row.pending_inviter_id ? Number(row.pending_inviter_id) : 0;
  if (!inviterId) return { ...emptyReferral(), inviterId: null };
  const paid = await applyReferralPay(inviteeId, inviterId);
  // Clear only when paid or referral row exists — NOT merely because they became friends via a game
  if (paid.inserted || paid.reward || paid.inviteeReward || await referralRowExists(inviteeId)) {
    await clearPendingInviter(inviteeId);
  }
  return { ...paid, inviterId };
}

/** Claim referral from signed Telegram start_param (startapp=i<id>). */
async function claimStartParamReferral(inviteeId, startParam) {
  const m = /^i(\d{1,15})$/.exec(String(startParam || ''));
  if (!m) return { ...emptyReferral(), inviterId: null };
  const inviterId = Number(m[1]);
  if (!inviterId || inviterId === inviteeId) return { ...emptyReferral(), inviterId: null };
  const paid = await applyReferralPay(inviteeId, inviterId);
  if (paid.inserted || paid.reward || paid.inviteeReward || await referralRowExists(inviteeId)) {
    await clearPendingInviter(inviteeId);
  }
  return { ...paid, inviterId };
}

/**
 * Seat the joiner next to the creator and start the game.
 * Colour resolution matches Chess.com: honour both prefs when compatible;
 * if only one side chose a colour, give them that; if both want the same, coin-flip.
 * Only one joiner can win the race.
 */
async function startGame(row, joinerId, joinerPreferred = null) {
  const creatorPref = row.preferred_color === 'w' || row.preferred_color === 'b' ? row.preferred_color : null;
  const joinerPref = joinerPreferred === 'w' || joinerPreferred === 'b' ? joinerPreferred : null;
  let creatorWhite;
  if (creatorPref && joinerPref) {
    creatorWhite = creatorPref !== joinerPref ? creatorPref === 'w' : Math.random() < 0.5;
  } else if (creatorPref) {
    creatorWhite = creatorPref === 'w';
  } else if (joinerPref) {
    creatorWhite = joinerPref === 'b'; // joiner wants white → creator is black
  } else {
    creatorWhite = Math.random() < 0.5;
  }
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
  // Joiner leaves their own matchmaking queue so they are not stuck searching
  await db.prepare(`
    UPDATE games SET status = 'cancelled', updated_at = now()
    WHERE creator_id = ? AND status = 'open' AND mode = 'online' AND id != ?
  `).run(joinerId, row.id);
  const next = await getGame.get(row.id);
  await pushGame(next);
  if (!realtime.isOnline(row.creator_id)) {
    const joiner = (await person(joinerId)).name;
    notify.toUser(row.creator_id, (T) => T.accepted(joiner), { gameId: row.id });
  }
  return next;
}

const parseTimeControl = (raw) => normalizeTimeControl(raw);
const parsePreferredColor = (raw) => (raw === 'w' || raw === 'b' ? raw : null);

/** Online players near my Elo who can be challenged (discoverable or friends). */
async function nearbyOnlineOpponents(uid, eloCol, myElo, limit = 5, maxDelta = 400) {
  const busy = new Set((await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all())
    .flatMap((g) => [g.white_id, g.black_id]));
  const rows = await db.prepare(`
    SELECT u.id, u.${eloCol} AS elo, u.discoverable
    FROM users u
    WHERE u.blocked = 0 AND u.id != ?
      AND u.present_until > now()
      AND ABS(u.${eloCol} - ?) <= ?
      AND (
        u.discoverable = 1
        OR EXISTS (SELECT 1 FROM friends f WHERE f.user_id = ? AND f.friend_id = u.id)
      )
    ORDER BY ABS(u.${eloCol} - ?) ASC, RANDOM()
    LIMIT 40
  `).all(uid, myElo, maxDelta, uid, myElo);
  return rows.filter((r) => !busy.has(r.id) && realtime.hasSocket(r.id)).slice(0, limit);
}

/** Ping nearby online browsers with an in-app challenge (open games stay joinable by other searchers). */
async function nudgeNearbyForQuick(row, uid, eloCol, myElo) {
  const since = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const delta = expandingEloDelta(since);
  const targets = await nearbyOnlineOpponents(uid, eloCol, myElo, 3, delta);
  if (!targets.length) return;
  const payloadBase = await getGame.get(row.id);
  for (const t of targets) {
    try {
      await db.prepare('INSERT INTO game_invites (game_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, t.id);
      realtime.send(t.id, { t: 'invite', game: await gameFor(payloadBase, t.id), ttl: POPUP_MS });
    } catch { /* ignore per-target */ }
  }
  await db.prepare('UPDATE games SET updated_at = now() WHERE id = ?').run(row.id);
}

// Online match-making: pair with a waiting searcher (closest Elo within expanding window),
// else wait + challenge nearby online players (window grows while searching).
api.post('/games/quick', wrap(async (req, res) => {
  const uid = req.user.id;
  const body = req.body || {};
  const timeControl = parseTimeControl(body.timeControl);
  const preferredColor = parsePreferredColor(body.preferredColor);
  const eloCol = eloColumn(categoryOf(timeControl));
  if (!ELO_COLS.has(eloCol)) throw bad('Bad time control', 'bad_request');
  const myElo = Number(req.user[eloCol] || req.user.elo || DEFAULT_ELO);

  // Existing open search (if any) defines how wide our Elo window is
  let mine = await db.prepare(
    "SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND time_control = ? AND creator_id = ? LIMIT 1",
  ).get(timeControl, uid);
  const searchSince = mine && mine.created_at ? new Date(mine.created_at).getTime() : Date.now();
  const eloDelta = expandingEloDelta(searchSince);

  // 1) Join another searcher on the same time control, closest Elo within window
  const candidates = await db.prepare(`
    SELECT g.*, u.${eloCol} AS creator_elo, g.created_at AS wait_since
    FROM games g
    JOIN users u ON u.id = g.creator_id
    WHERE g.status = 'open' AND g.mode = 'online' AND g.time_control = ?
      AND g.creator_id != ?
      AND u.blocked = 0
      AND (u.present_until > now() OR EXISTS (
        SELECT 1 FROM games g2 WHERE g2.creator_id = u.id AND g2.status = 'open' AND g2.mode = 'online'
      ))
    ORDER BY ABS(u.${eloCol} - ?) ASC, g.created_at ASC
    LIMIT 40
  `).all(timeControl, uid, myElo);
  for (const g of candidates) {
    const theirElo = Number(g.creator_elo || DEFAULT_ELO);
    const theirSince = g.wait_since ? new Date(g.wait_since).getTime() : Date.now();
    // Allow match if either side has waited long enough for this Elo gap
    const allowed = Math.max(eloDelta, expandingEloDelta(theirSince));
    if (Math.abs(theirElo - myElo) > allowed) continue;
    try {
      return res.json({ game: await gameFor(await startGame(g, uid, preferredColor), uid) });
    } catch (e) {
      if (e && e.code === 'game_unavailable') continue;
      throw e;
    }
  }

  // 2) Keep or open my search slot
  let created = false;
  if (mine) {
    if (preferredColor && mine.preferred_color !== preferredColor) {
      await db.prepare('UPDATE games SET preferred_color = ?, updated_at = now() WHERE id = ?').run(preferredColor, mine.id);
      mine.preferred_color = preferredColor;
    }
  } else {
    await ensureRoom(uid);
    const id = gameId();
    await db.prepare("INSERT INTO games (id, creator_id, status, mode, time_control, preferred_color) VALUES (?, ?, 'open', 'online', ?, ?)").run(id, uid, timeControl, preferredColor);
    mine = await getGame.get(id);
    created = true;
  }

  // 3) Challenge nearby-Elo players in the app (window expands with search age)
  const lastNudge = mine.updated_at ? new Date(mine.updated_at).getTime() : 0;
  if (created || Date.now() - lastNudge > 4_000) {
    await nudgeNearbyForQuick(mine, uid, eloCol, myElo);
    mine = await getGame.get(mine.id);
  }

  res.status(created ? 201 : 200).json({ game: await gameFor(mine, uid), eloDelta: expandingEloDelta(mine.created_at ? new Date(mine.created_at).getTime() : Date.now()) });
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
    const preferredColor = parsePreferredColor(b.preferredColor);
    await db.prepare("INSERT INTO games (id, creator_id, status, mode, time_control, preferred_color) VALUES (?, ?, 'open', 'friend', ?, ?)").run(id, uid, timeControl, preferredColor);
    return res.status(201).json({ game: await gameFor(await getGame.get(id), uid) });
  }

  let failure = null; const targets = [];
  for (const opp of wanted) {
    const other = await getUser.get(opp);
    if (opp === uid || !other || other.blocked) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    if (!await areFriends(uid, opp) && !other.discoverable) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    // Soft-online (REST present_until) is not enough — left Mini Apps must not receive hanging invites.
    if (!userIsChallengeable(opp)) { failure = new HttpError(409, 'Player is offline', 'user_offline'); continue; }
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
  const delivered = [];
  for (const t of targets) {
    await db.prepare('INSERT INTO game_invites (game_id, user_id) VALUES (?, ?)').run(id, t);
    const payload = { t: 'invite', game: await gameFor(await getGame.get(id), t), ttl: POPUP_MS };
    if (realtime.send(t, payload)) delivered.push(t);
    else await db.prepare('DELETE FROM game_invites WHERE game_id = ? AND user_id = ?').run(id, t);
  }
  if (!delivered.length) {
    await db.prepare("UPDATE games SET status = 'cancelled', updated_at = now() WHERE id = ?").run(id);
    throw new HttpError(409, 'Player is offline', 'user_offline');
  }
  if (delivered[0] !== targets[0]) {
    await db.prepare('UPDATE games SET invited_id = ? WHERE id = ?').run(delivered[0], id);
  }
  const row = await getGame.get(id);
  res.status(201).json({ game: await gameFor(row, uid) });
}));

api.get('/games/history', wrap(async (req, res) => {
  const uid = req.user.id;
  const rows = await db.prepare(`
    SELECT * FROM games WHERE status = 'finished' AND (white_id = :u OR black_id = :u)
      AND mode IN ('online', 'friend', 'tour') AND result IS NOT NULL
    ORDER BY updated_at DESC LIMIT 50
  `).all({ u: uid });
  res.json({ games: await Promise.all(rows.map((g) => gameFor(g, uid, false))) });
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
  if (row.status === 'cancelled' && row.creator_id !== uid) throw bad('This game is no longer available', 'game_unavailable');
  if (await isParticipant(row, uid) && row.status !== 'open' && row.status !== 'invited') return res.json({ game: await gameFor(row, uid) });
  if (row.creator_id === uid) return res.json({ game: await gameFor(row, uid) }); // opening your own link
  if (inviteExpired(row)) { await dropInvites(row); await db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(row.id); await pushGame(await getGame.get(row.id)); throw bad('This game is no longer available', 'game_unavailable'); }
  const allowed = row.status === 'open' || await isInvitee(row, uid);
  if (!allowed) throw bad('This game is no longer available', 'game_unavailable');
  await ensureRoom(uid);
  const preferredColor = parsePreferredColor(req.body && req.body.preferredColor);
  res.json({ game: await gameFor(await startGame(row, uid, preferredColor), uid) });
}));

api.post('/games/:id/decline', wrap(async (req, res) => {
  const row = await loadGame(req.params.id, req.user.id);
  if (!await isInvitee(row, req.user.id)) throw bad('Nothing to decline', 'game_unavailable');
  await db.prepare('DELETE FROM game_invites WHERE game_id = ? AND user_id = ?').run(row.id, req.user.id);
  // Explicit challenges end when everyone declines; open matchmaking keeps searching.
  if (row.status === 'invited' && !(await invitesOf(row.id)).length) {
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
  await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = ?, draw_by = NULL, takeback_by = NULL, updated_at = now() WHERE id = ?")
    .run(result, reason, row.id);
  try { await applyRatingFinish(row, result); } catch (e) { console.error('[rating]', e.message || e); }
  // Rankings / busy-set caches must not serve pre-finish data
  await Promise.all([clearRankingCaches(), cacheDel('lobby:busy')]);
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
    return db.prepare(`UPDATE games SET moves = ?::jsonb, draw_by = NULL, takeback_by = NULL, white_ms = ?, black_ms = ?, turn_started_at = now(),
        updated_at = now(), last_move_at = now()
      WHERE id = ? AND status = 'active' AND moves = ?::jsonb`)
      .run(nextMovesJson, clocks.whiteMs, clocks.blackMs, row.id, movesJson(row.moves));
  }
  return db.prepare(`UPDATE games SET moves = ?::jsonb, draw_by = NULL, takeback_by = NULL, updated_at = now(), last_move_at = now()
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

/** Claim a game-analysis slot: free users get N/day (admin), premium unlimited. */
api.post('/games/:id/analyze', wrap(async (req, res) => {
  const uid = req.user.id;
  const gameId = String(req.params.id);
  const row = await getGame.get(gameId);
  if (!row || row.status !== 'finished') throw new HttpError(404, 'Game not found', 'notfound');
  const seated = sameId(row.white_id, uid) || sameId(row.black_id, uid);
  if (!seated) throw new HttpError(403, 'Only players can analyze', 'forbidden');
  const shop = await getShopSettings();
  const premium = isPremiumActive(req.user);
  const day = tashkentDateKey();
  const already = await db.prepare(
    'SELECT id FROM game_analysis_claims WHERE user_id = ? AND game_id = ?',
  ).get(uid, gameId);
  if (already) {
    return res.json({
      ok: true, allowed: true, premium, remaining: premium ? null : null, reused: true,
    });
  }
  if (!premium) {
    const used = Number((await db.prepare(
      'SELECT COUNT(*)::int AS n FROM game_analysis_claims WHERE user_id = ? AND day_key = ?',
    ).get(uid, day))?.n || 0);
    const limit = shop.analysisDailyFree;
    if (used >= limit) {
      throw bad('Daily analysis limit reached', 'analysis_limit');
    }
    await db.prepare(
      'INSERT INTO game_analysis_claims (user_id, game_id, day_key) VALUES (?, ?, ?)',
    ).run(uid, gameId, day);
    return res.json({
      ok: true, allowed: true, premium: false, remaining: Math.max(0, limit - used - 1), limit,
    });
  }
  await db.prepare(
    'INSERT INTO game_analysis_claims (user_id, game_id, day_key) VALUES (?, ?, ?)',
  ).run(uid, gameId, day);
  res.json({ ok: true, allowed: true, premium: true, remaining: null });
}));

api.get('/games/:id/analyze/status', wrap(async (req, res) => {
  const uid = req.user.id;
  const gameId = String(req.params.id);
  const shop = await getShopSettings();
  const premium = isPremiumActive(req.user);
  const day = tashkentDateKey();
  const claimed = !!(await db.prepare(
    'SELECT 1 FROM game_analysis_claims WHERE user_id = ? AND game_id = ?',
  ).get(uid, gameId));
  const used = Number((await db.prepare(
    'SELECT COUNT(*)::int AS n FROM game_analysis_claims WHERE user_id = ? AND day_key = ?',
  ).get(uid, day))?.n || 0);
  const limit = shop.analysisDailyFree;
  res.json({
    claimed,
    premium,
    used,
    limit,
    remaining: premium ? null : Math.max(0, limit - used),
    canAnalyze: premium || claimed || used < limit,
  });
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


/** Abort: allowed until both sides have moved. Nobody's rating changes. */
api.post('/games/:id/abort', wrap(async (req, res) => {
  const uid = req.user.id;
  const { row } = await activeGame(req.params.id, uid);
  if (row.mode === 'tour') throw bad('Not allowed in a tournament', 'bad_request');
  if (parseMoves(row.moves).length >= 2) throw bad('Too late to abort', 'bad_request');
  await db.prepare("UPDATE games SET status = 'cancelled', reason = 'aborted', draw_by = NULL, takeback_by = NULL, updated_at = now() WHERE id = ? AND status = 'active'").run(row.id);
  await cacheDel('lobby:busy');
  const next = await getGame.get(row.id);
  await pushGame(next);
  res.json({ game: await gameFor(next, uid) });
}));

/** Takeback: the player who just moved asks; the opponent accepts or declines. */
api.post('/games/:id/takeback', wrap(async (req, res) => {
  const uid = req.user.id;
  const { row, colour } = await activeGame(req.params.id, uid);
  const action = req.body && req.body.action;
  if (row.mode === 'tour') throw bad('Not allowed in a tournament', 'bad_request');
  const moves = parseMoves(row.moves);
  if (action === 'offer') {
    if (!moves.length || turnOf(moves) === colour) throw bad('Nothing to take back', 'bad_request');
    if (row.takeback_by === colour) return res.json({ game: await gameFor(row, uid) });
    await db.prepare('UPDATE games SET takeback_by = ?, updated_at = now() WHERE id = ?').run(colour, row.id);
    await pushGame(await getGame.get(row.id));
  } else if (action === 'accept') {
    if (!row.takeback_by || row.takeback_by === colour || turnOf(moves) === row.takeback_by) throw bad('No takeback request', 'bad_request');
    const settled = settleClocks(row);
    const timed = settled.timed;
    const nextMoves = moves.slice(0, -1);
    const upd = timed
      ? await db.prepare(`UPDATE games SET moves = ?::jsonb, takeback_by = NULL, draw_by = NULL, white_ms = ?, black_ms = ?, turn_started_at = now(), updated_at = now()
          WHERE id = ? AND status = 'active' AND moves = ?::jsonb`).run(movesJson(nextMoves), Math.max(1, settled.whiteMs), Math.max(1, settled.blackMs), row.id, movesJson(row.moves))
      : await db.prepare(`UPDATE games SET moves = ?::jsonb, takeback_by = NULL, draw_by = NULL, updated_at = now()
          WHERE id = ? AND status = 'active' AND moves = ?::jsonb`).run(movesJson(nextMoves), row.id, movesJson(row.moves));
    if (!upd.changes) throw bad('Position changed', 'not_your_turn');
    await pushGame(await getGame.get(row.id));
  } else if (action === 'decline') {
    await db.prepare('UPDATE games SET takeback_by = NULL, updated_at = now() WHERE id = ?').run(row.id);
    await pushGame(await getGame.get(row.id));
  } else throw bad('Unknown action', 'bad_request');
  res.json({ game: await gameFor(await getGame.get(row.id), uid) });
}));

// Emoji reactions travel straight to the opponent's screen and are not stored
const lastReact = new Map();
function touchRateMap(map, key, now, max = 4_000) {
  map.set(key, now);
  if (map.size <= max) return;
  // Drop oldest ~20% so flood maps cannot grow forever under free-tier memory
  const drop = Math.ceil(map.size * 0.2);
  let i = 0;
  for (const k of map.keys()) {
    map.delete(k);
    if (++i >= drop) break;
  }
}
api.post('/games/:id/react', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await loadGame(req.params.id, uid);
  const emoji = req.body && req.body.emoji;
  if (!REACTIONS.includes(emoji)) throw bad('Unknown reaction', 'bad_request');
  const now = Date.now();
  if (now - (lastReact.get(uid) || 0) < 500) return res.json({ ok: true }); // flood guard
  touchRateMap(lastReact, uid, now);
  for (const id of await participants(row)) if (id !== uid) realtime.send(id, { t: 'react', id: row.id, emoji, by: uid });
  res.json({ ok: true });
}));

// Ephemeral in-game chat (not stored; cleared when the client closes the game)
const lastChat = new Map();
api.post('/games/:id/chat', wrap(async (req, res) => {
  const uid = req.user.id;
  const row = await loadGame(req.params.id, uid);
  if (row.status !== 'active') throw bad('Game is not active', 'bad_request');
  if (!(sameId(row.white_id, uid) || sameId(row.black_id, uid))) throw bad('Not a player', 'forbidden');
  const text = String((req.body && req.body.text) || '').trim().slice(0, 120);
  if (!text) throw bad('Empty message', 'bad_request');
  const now = Date.now();
  if (now - (lastChat.get(uid) || 0) < 400) return res.json({ ok: true });
  touchRateMap(lastChat, uid, now);
  const name = (await person(uid)).name;
  for (const id of await participants(row)) {
    if (id !== uid) realtime.send(id, { t: 'chat', id: row.id, text, by: uid, name });
  }
  res.json({ ok: true });
}));

/** Award puzzle_daily_reward 💎 once per Tashkent day when the user finishes all 10 daily puzzles. */
function tashkentDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
api.post('/puzzles/claim-daily', wrap(async (req, res) => {
  const uid = req.user.id;
  const day = tashkentDateKey();
  const shop = await getShopSettings();
  const amount = shop.puzzleDailyReward;
  try {
    await db.prepare('INSERT INTO puzzle_daily_claims (user_id, day) VALUES (?, ?)').run(uid, day);
  } catch {
    const u = await getUser.get(uid);
    return res.json({ ok: true, awarded: 0, amount, diamonds: Number(u.diamonds || 0), day });
  }
  if (amount > 0) {
    await db.prepare('UPDATE users SET diamonds = diamonds + ? WHERE id = ?').run(amount, uid);
    await ledgerDiamonds(uid, amount, 'puzzle_daily', { day });
  }
  invalidateUserCache(uid);
  const u = await getUser.get(uid);
  memoUser(u);
  const diamonds = Number(u.diamonds || 0);
  realtime.send(uid, { t: 'wallet', diamonds });
  res.json({ ok: true, awarded: amount, amount, diamonds, day });
}));

// ---------- computer games (local only — never counted in stats / ratings) ----------
api.post('/results', wrap(async (req, res) => {
  const { level, outcome } = req.body || {};
  if (![1, 2, 3, 4, 5].includes(level) || !['win', 'draw', 'loss'].includes(outcome)) throw bad('Bad result', 'bad_request');
  // Accept the payload for older clients, but do not store or rate vs-computer games.
  res.json({ stats: await statsFor(req.user.id) });
}));

const TC_CASE = `CASE COALESCE(g.time_control, 'classic')
  WHEN '1+0' THEN 'bullet' WHEN '1+1' THEN 'bullet' WHEN '2+1' THEN 'bullet' WHEN 'bullet' THEN 'bullet'
  WHEN '3+0' THEN 'blitz' WHEN '3+2' THEN 'blitz' WHEN '5+0' THEN 'blitz' WHEN 'blitz' THEN 'blitz'
  WHEN '10+0' THEN 'rapid' WHEN '15+10' THEN 'rapid' WHEN '30+0' THEN 'rapid' WHEN 'rapid' THEN 'rapid'
  ELSE 'classic' END`;

// ---------- live competitive rankings (Elo lifetime + monthly points) ----------
api.get('/rankings', wrap(async (req, res) => {
  ensurePreviousMonthMedals().catch(() => {});
  const board = ['monthly', 'period'].includes(req.query.board) ? req.query.board : 'elo';
  const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
  const category = ['bullet', 'blitz', 'rapid', 'classic', 'all'].includes(req.query.category)
    ? req.query.category
    : (board === 'elo' ? 'bullet' : 'all');
  const month = monthKey();
  // v2: includes premium flag (old cache entries without it must not be reused)
  const cacheKey = board === 'period'
    ? `rankings:v3:period:${period}:${category}:${month}`
    : `rankings:v3:${board}:${category}:${month}`;
  const myRank = async (list) => {
    const uid = req.user.id;
    const inList = (list || []).find((r) => sameId(r.id, uid));
    const myElo = Number(req.user.elo || DEFAULT_ELO);
    if (inList) return { rank: inList.rank, elo: Number(inList.elo || myElo), points: inList.points };
    if (board !== 'elo' || category !== 'all') return { rank: null, elo: myElo, points: 0 };
    const row = await db.prepare('SELECT COUNT(*)::int AS n FROM users WHERE blocked = 0 AND elo > ?').get(myElo);
    return { rank: (row?.n || 0) + 1, elo: myElo, points: myElo };
  };
  const cached = await cacheGet(cacheKey, 15_000);
  if (cached) return res.json({ ...cached, me: await myRank(cached.rankings) });

  const mapPremium = (r) => isPremiumActive({
    premium: r.premium_flag ?? r.premium,
    premium_until: r.premium_until,
  });

  let rows;
  if (board === 'period') {
    const since = period === 'day'
      ? "date_trunc('day', timezone('Asia/Tashkent', now()))"
      : period === 'week'
        ? "date_trunc('week', timezone('Asia/Tashkent', now()))"
        : "date_trunc('month', timezone('Asia/Tashkent', now()))";
    const catClause = category === 'all' ? '' : ` AND (${TC_CASE}) = ?`;
    rows = (await db.prepare(`
      SELECT * FROM (
        SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
          u.premium AS premium_flag, u.premium_until, u.elo,
          COUNT(*) AS games,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '1-0') OR (g.black_id = u.id AND g.result = '0-1') THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '0-1') OR (g.black_id = u.id AND g.result = '1-0') THEN 1 ELSE 0 END) AS losses
        FROM games g JOIN users u ON u.id = g.white_id OR u.id = g.black_id
        WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online', 'friend', 'tour')
          AND timezone('Asia/Tashkent', g.updated_at) >= ${since}
          AND u.blocked = 0${catClause}
        GROUP BY u.id, u.first_name, u.username, u.avatar_key, u.premium, u.premium_until, u.elo
      ) r
      ORDER BY (wins * 2 + draws) DESC, wins DESC, games DESC, lower(name) ASC
      LIMIT 100
    `).all(...(category === 'all' ? [] : [category]))).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      wins: Number(r.wins), draws: Number(r.draws), losses: Number(r.losses),
      games: Number(r.games), points: Number(r.wins) * 2 + Number(r.draws), elo: Number(r.elo || DEFAULT_ELO),
      avatarKey: r.avatar_key || null, premium: mapPremium(r), isBot: Number(r.id) >= 9_000_000_000_000,
    }));
  } else if (board === 'elo') {
    const col = category === 'all' ? 'elo' : eloColumn(category);
    if (!ELO_COLS.has(col)) throw bad('Bad category', 'bad_request');
    const catClause = category === 'all' ? '' : ` AND (${TC_CASE}) = ?`;
    const params = category === 'all' ? [] : [category];
    rows = (await db.prepare(`
      SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
        u.premium AS premium_flag, u.premium_until,
        u.${col} AS elo,
        COALESCE((
          SELECT COUNT(*) FROM games g
          WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online', 'friend', 'tour')
            AND (g.white_id = u.id OR g.black_id = u.id)${catClause}
        ), 0) AS games
      FROM users u
      WHERE u.blocked = 0
        AND EXISTS (
          SELECT 1 FROM games g
          WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online', 'friend', 'tour')
            AND (g.white_id = u.id OR g.black_id = u.id)${catClause}
        )
      ORDER BY u.${col} DESC, lower(COALESCE(u.first_name, '')) ASC
      LIMIT 100
    `).all(...params, ...params)).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      elo: Number(r.elo), games: Number(r.games), points: Number(r.elo),
      avatarKey: r.avatar_key || null, premium: mapPremium(r), isBot: Number(r.id) >= 9_000_000_000_000,
    }));
  } else if (category === 'all') {
    rows = (await db.prepare(`
      SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
        u.premium AS premium_flag, u.premium_until,
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
      games: Number(r.games), avatarKey: r.avatar_key || null, premium: mapPremium(r), isBot: Number(r.id) >= 9_000_000_000_000,
    }));
  } else {
    rows = (await db.prepare(`
      SELECT * FROM (
        SELECT u.id, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.username, u.avatar_key,
          u.premium AS premium_flag, u.premium_until,
          COUNT(*) AS games,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '1-0') OR (g.black_id = u.id AND g.result = '0-1') THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END) AS draws,
          SUM(CASE WHEN (g.white_id = u.id AND g.result = '0-1') OR (g.black_id = u.id AND g.result = '1-0') THEN 1 ELSE 0 END) AS losses
        FROM games g JOIN users u ON u.id = g.white_id OR u.id = g.black_id
        WHERE g.status = 'finished' AND g.result IS NOT NULL AND g.mode IN ('online', 'friend', 'tour')
          AND (timezone('Asia/Tashkent', g.updated_at))::text LIKE ?
          AND (${TC_CASE}) = ?
          AND u.blocked = 0
        GROUP BY u.id, u.first_name, u.username, u.avatar_key, u.premium, u.premium_until
      ) r
      ORDER BY (wins * 2 + draws) DESC, wins DESC, games DESC, lower(name) ASC
      LIMIT 100
    `).all(`${month}%`, category)).map((r, i) => ({
      rank: i + 1, id: r.id, name: r.name, username: r.username || '',
      wins: Number(r.wins), draws: Number(r.draws), losses: Number(r.losses),
      games: Number(r.games), points: Number(r.wins) * 2 + Number(r.draws),
      avatarKey: r.avatar_key || null, premium: mapPremium(r), isBot: Number(r.id) >= 9_000_000_000_000,
    }));
  }

  if (rows.length) {
    const gem = await db.prepare(`SELECT id, diamonds FROM users WHERE id IN (${rows.map(() => '?').join(',')})`).all(...rows.map((r) => r.id));
    const byId = new Map(gem.map((g) => [String(g.id), Number(g.diamonds || 0)]));
    for (const r of rows) r.diamonds = isAdmin(r.id) ? null : (byId.get(String(r.id)) || 0);
  }
  const payload = {
    board, period: board === 'period' ? period : null, category, month, monthLabel: monthLabelEn(month),
    rankings: rows, updatedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, payload, 15_000);
  res.json({ ...payload, me: await myRank(rows) });
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
      title: r.title, url: `/api/medals/${r.id}.svg?v=4`, key: `medal:${r.id}`,
    })),
  });
}));

/** Previous month's podium, shown on the Play page during the first 10 days of a month (Tashkent). */
api.get('/medals/champions', wrap(async (req, res) => {
  if (tashkentDay() > 10) return res.json({ champions: [] });
  await ensurePreviousMonthMedals();
  const prev = previousMonthKey();
  const rows = await db.prepare(`
    SELECT m.id, m.place, u.id AS uid, COALESCE(NULLIF(u.first_name, ''), 'Player') AS name, u.avatar_key, u.premium, u.premium_until
    FROM medals m JOIN users u ON u.id = m.user_id WHERE m.month = ? ORDER BY m.place ASC
  `).all(prev);
  res.json({
    month: prev,
    label: monthLabelEn(prev),
    champions: rows.map((r) => ({
      place: r.place, id: r.uid, name: r.name, avatarKey: r.avatar_key || null,
      premium: isPremiumActive({ premium: r.premium, premium_until: r.premium_until }),
      medalId: r.id, url: `/api/medals/${r.id}.svg?v=4`,
    })),
  });
}));

// ---------- lobby: who is online and what games do I have ----------
api.get('/lobby', wrap(async (req, res) => {
  const uid = req.user.id;
  const many = (list) => Promise.all(list.map((g) => gameFor(g, uid, false)));
  const friendIds = new Set((await db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(uid)).map((r) => r.friend_id));

  const mine = await db.prepare(`
    SELECT * FROM games WHERE status IN ('open', 'invited', 'active')
      AND (creator_id = :u OR white_id = :u OR black_id = :u OR invited_id = :u
        OR id IN (SELECT game_id FROM game_invites WHERE user_id = :u)) ORDER BY updated_at DESC LIMIT 30
  `).all({ u: uid });
  // Shared busy-set cache (not per-user) — safe across lobby polls
  let busy;
  // Longer shared TTLs cut Render/Neon load; WS still pushes game events live
  const busyCached = await cacheGet('lobby:busy', 5_000);
  if (busyCached) busy = new Set(busyCached);
  else {
    const pairs = (await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]);
    busy = new Set(pairs);
    await cacheSet('lobby:busy', pairs, 5_000);
  }

  const pendingInvites = await db.prepare(
    "SELECT i.user_id, i.game_id FROM game_invites i JOIN games g ON g.id = i.game_id WHERE g.status = 'invited' AND g.creator_id = ?"
  ).all(uid);
  const inviteGameByUser = new Map(pendingInvites.map((r) => [r.user_id, r.game_id]));

  // Shared presence: present_until is refreshed on every API call and cleared on Mini App close / WS leave.
  const rows = await db.prepare(`
    SELECT id, first_name, last_name, discoverable, premium, premium_until, avatar_key, elo
    FROM users
    WHERE blocked = 0 AND id != ?
      AND present_until > now()
      AND id NOT IN (SELECT blocked_id FROM user_blocks WHERE user_id = ?)
      AND id NOT IN (SELECT user_id FROM user_blocks WHERE blocked_id = ?)
    ORDER BY present_until DESC
    LIMIT 200
  `).all(uid, uid, uid);
  // Drop ghost rows: present_until alone is not enough after a closed Mini App (WS/REST must still be live).
  // Players inside an active game stay listed while their socket reconnects (/bye clears present_until).
  const online = rows
    .filter((r) => realtime.isOnline(r.id) || busy.has(r.id))
    .map((r) => ({
      id: r.id, name: displayName(r), inGame: busy.has(r.id), friend: friendIds.has(r.id),
      premium: isPremiumActive(r), discoverable: !!r.discoverable || friendIds.has(r.id),
      invited: inviteGameByUser.has(r.id), inviteGameId: inviteGameByUser.get(r.id) || null,
      avatarKey: r.avatar_key || null,
      elo: Number(r.elo || DEFAULT_ELO),
    }))
    .sort((a, b) => (b.friend - a.friend) || (a.inGame - b.inGame) || a.name.localeCompare(b.name));

  // Same definition as the list (live socket/REST or in a game) so "N online" matches the rows shown
  let onlineCount = await cacheGet('lobby:onlineCount', 8_000);
  if (onlineCount == null) {
    onlineCount = realtime.onlineIds().length;
    await cacheSet('lobby:onlineCount', onlineCount, 8_000);
  }
  onlineCount = Math.max(Number(onlineCount) || 0, online.length + 1);

  const recent = await db.prepare(`
    SELECT * FROM games WHERE status = 'finished' AND (white_id = :u OR black_id = :u) ORDER BY updated_at DESC LIMIT 8
  `).all({ u: uid });

  let liveGames = await cacheGet('lobby:liveGames', 5_000);
  if (liveGames == null) {
    const liveGamesRow = await db.prepare("SELECT COUNT(*)::int AS n FROM games WHERE status = 'active'").get();
    liveGames = liveGamesRow?.n || 0;
    await cacheSet('lobby:liveGames', liveGames, 5_000);
  }
  res.json({
    onlineCount,
    online,
    liveGames: Number(liveGames) || 0,
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
  // Spectators (not seated players) keep the watch counter warm
  if (!g.you && row.status === 'active') {
    g.spectators = touchSpectator(row.id, uid);
    pushSpectatorCount(row.id, row);
  } else {
    g.spectators = spectatorCount(row.id);
  }
  res.json({ game: g });
}));

const lichessFail = (e, notFoundMsg) => {
  if (e.status === 400 || e.code === 'bad_request') throw bad(e.message || 'Invalid id', 'bad_request');
  if (e.status === 404) throw new HttpError(404, notFoundMsg, 'notfound');
  // Lichess (not this bot) is throttling us: different code so the app can say so and retry by itself.
  if (e.status === 429) throw new HttpError(429, 'Lichess is busy, try again shortly', 'lichess_busy');
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

// ---------- public profiles / likes / blocks ----------
async function isBlockedEither(a, b) {
  const row = await db.prepare(`
    SELECT 1 AS ok FROM user_blocks
    WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)
    LIMIT 1
  `).get(a, b, b, a);
  return !!row;
}

api.get('/users/:id', wrap(async (req, res) => {
  const uid = req.user.id;
  const id = intParam(req.params.id);
  const u = await getUser.get(id);
  if (!u || u.blocked) throw new HttpError(404, 'Player not found', 'notfound');
  if (id !== uid && await isBlockedEither(uid, id)) {
    const iBlocked = !!(await db.prepare('SELECT 1 AS ok FROM user_blocks WHERE user_id = ? AND blocked_id = ?').get(uid, id));
    if (!iBlocked) throw new HttpError(404, 'Player not found', 'notfound');
  }
  const likes = Number((await db.prepare('SELECT COUNT(*)::int AS n FROM profile_likes WHERE to_id = ?').get(id))?.n || 0);
  const likedByMe = id === uid
    ? false
    : !!(await db.prepare('SELECT 1 AS ok FROM profile_likes WHERE from_id = ? AND to_id = ?').get(uid, id));
  const blockedByMe = id === uid
    ? false
    : !!(await db.prepare('SELECT 1 AS ok FROM user_blocks WHERE user_id = ? AND blocked_id = ?').get(uid, id));
  const premium = isPremiumActive(u);
  const presence = stillPresent(u.present_until) || realtime.isOnline(id);
  const isFriend = id === uid ? false : await areFriends(uid, id);
  let friendRequest = null;
  if (id !== uid && !isFriend) {
    const pendingOut = await db.prepare(
      `SELECT id, status FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
    ).get(uid, id);
    const pendingIn = await db.prepare(
      `SELECT id, status FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
    ).get(id, uid);
    if (pendingOut) friendRequest = { id: pendingOut.id, direction: 'out', status: 'pending' };
    else if (pendingIn) friendRequest = { id: pendingIn.id, direction: 'in', status: 'pending' };
  }
  const medalRows = await db.prepare(`
    SELECT id, month, place, title FROM medals WHERE user_id = ? ORDER BY month DESC, place ASC LIMIT 24
  `).all(id);
  res.json({
    user: {
      id: u.id,
      firstName: u.first_name || '',
      lastName: u.last_name || '',
      displayName: displayName(u),
      username: u.username || '',
      country: u.country || '',
      region: u.region || '',
      bio: premium ? (u.bio || '') : '',
      premium,
      avatarKey: u.avatar_key || null,
      elo: Number(u.elo || DEFAULT_ELO),
      diamonds: isAdmin(id) && id !== uid ? null : Number(u.diamonds || 0),
      isBot: Number(id) >= 9_000_000_000_000,
      online: presence,
      you: id === uid,
    },
    stats: await statsFor(id),
    likes,
    likedByMe,
    blockedByMe,
    isFriend,
    friendRequest,
    medals: medalRows.map((r) => ({
      id: r.id, month: r.month, monthLabel: monthLabelEn(r.month), place: r.place,
      title: r.title, url: `/api/medals/${r.id}.svg?v=4`, key: `medal:${r.id}`,
    })),
  });
}));

api.post('/friends/request', wrap(async (req, res) => {
  const uid = req.user.id;
  const other = intParam(req.body && req.body.userId);
  if (other === uid) throw bad('Invalid user', 'bad_request');
  const u = await getUser.get(other);
  if (!u || u.blocked) throw new HttpError(404, 'Player not found', 'notfound');
  if (await blockedEither(uid, other)) throw bad('Blocked', 'blocked');
  if (await areFriends(uid, other)) throw bad('Already friends', 'already_friends');
  const reverse = await db.prepare(
    `SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
  ).get(other, uid);
  if (reverse) {
    // They already asked us — accept
    await db.prepare(
      `UPDATE friend_requests SET status = 'accepted', responded_at = now() WHERE id = ?`,
    ).run(reverse.id);
    await befriend(uid, other);
    const me = await person(uid);
    const them = await person(other);
    await db.prepare(`
      INSERT INTO notifications (user_id, kind, title, body, meta) VALUES (?, 'friend_accepted', ?, ?, ?::jsonb)
    `).run(other, '✅ Friend request accepted', `${me.name} accepted your friend request.`, JSON.stringify({ fromUserId: uid, fromName: me.name }));
    realtime.send(other, { t: 'friend', id: uid, reward: 0 });
    realtime.send(uid, { t: 'friend', id: other, reward: 0 });
    return res.status(201).json({ ok: true, friend: them, accepted: true });
  }
  const existing = await db.prepare(
    `SELECT id, status FROM friend_requests WHERE from_id = ? AND to_id = ?`,
  ).get(uid, other);
  if (existing && existing.status === 'pending') {
    return res.json({ ok: true, requestId: existing.id, pending: true });
  }
  const ins = existing
    ? await db.prepare(
      `UPDATE friend_requests SET status = 'pending', responded_at = NULL, created_at = now() WHERE id = ? RETURNING id`,
    ).run(existing.id)
    : await db.prepare(
      `INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?) RETURNING id`,
    ).run(uid, other);
  const requestId = ins.rows?.[0]?.id || existing?.id;
  const me = await person(uid);
  await db.prepare(`
    INSERT INTO notifications (user_id, kind, title, body, meta) VALUES (?, 'friend_request', ?, ?, ?::jsonb)
  `).run(
    other,
    '👋 Friend request',
    `${me.name} wants to be your friend.`,
    JSON.stringify({ requestId, fromUserId: uid, fromName: me.name }),
  );
  realtime.send(other, {
    t: 'friend_request',
    requestId,
    from: { id: uid, name: me.name },
  });
  res.status(201).json({ ok: true, requestId, pending: true });
}));

api.post('/friends/request/:id/respond', wrap(async (req, res) => {
  const uid = req.user.id;
  const rid = intParam(req.params.id);
  const accept = !(req.body && req.body.accept === false);
  const row = await db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(rid);
  if (!row || Number(row.to_id) !== uid || row.status !== 'pending') {
    throw new HttpError(404, 'Request not found', 'notfound');
  }
  await db.prepare(
    `UPDATE friend_requests SET status = ?, responded_at = now() WHERE id = ?`,
  ).run(accept ? 'accepted' : 'declined', rid);
  // Mark related notifications read
  await db.prepare(`
    UPDATE notifications SET read_at = now()
    WHERE user_id = ? AND kind = 'friend_request' AND read_at IS NULL
      AND (meta->>'requestId')::bigint = ?
  `).run(uid, rid);
  if (accept) {
    await befriend(uid, row.from_id);
    const me = await person(uid);
    await db.prepare(`
      INSERT INTO notifications (user_id, kind, title, body, meta) VALUES (?, 'friend_accepted', ?, ?, ?::jsonb)
    `).run(row.from_id, '✅ Friend request accepted', `${me.name} accepted your friend request.`, JSON.stringify({ fromUserId: uid, fromName: me.name }));
    realtime.send(row.from_id, { t: 'friend', id: uid, reward: 0 });
    realtime.send(uid, { t: 'friend', id: row.from_id, reward: 0 });
  }
  res.json({ ok: true, accepted: accept });
}));

api.post('/users/:id/like', wrap(async (req, res) => {
  const uid = req.user.id;
  const id = intParam(req.params.id);
  if (id === uid) throw bad('Cannot like yourself', 'bad_request');
  const u = await getUser.get(id);
  if (!u || u.blocked) throw new HttpError(404, 'Player not found', 'notfound');
  if (await isBlockedEither(uid, id)) throw bad('User unavailable', 'user_unavailable');
  const exists = await db.prepare('SELECT 1 AS ok FROM profile_likes WHERE from_id = ? AND to_id = ?').get(uid, id);
  if (exists) {
    await db.prepare('DELETE FROM profile_likes WHERE from_id = ? AND to_id = ?').run(uid, id);
  } else {
    await db.prepare('INSERT INTO profile_likes (from_id, to_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(uid, id);
  }
  const likes = Number((await db.prepare('SELECT COUNT(*)::int AS n FROM profile_likes WHERE to_id = ?').get(id))?.n || 0);
  const likedByMe = !exists;
  res.json({ likes, likedByMe });
}));

api.post('/users/:id/block', wrap(async (req, res) => {
  const uid = req.user.id;
  const id = intParam(req.params.id);
  if (id === uid) throw bad('Cannot block yourself', 'bad_request');
  if (isAdmin(id)) throw bad('Cannot block this user', 'admin_block');
  const u = await getUser.get(id);
  if (!u) throw new HttpError(404, 'Player not found', 'notfound');
  const want = !(req.body && req.body.blocked === false);
  if (want) {
    await db.prepare('INSERT INTO user_blocks (user_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(uid, id);
    await db.prepare('DELETE FROM profile_likes WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(uid, id, id, uid);
  } else {
    await db.prepare('DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?').run(uid, id);
  }
  res.json({ blockedByMe: want });
}));

api.post('/feedback', wrap(async (req, res) => {
  const body = cleanText(req.body && req.body.body, 1000, 'text', true);
  const uid = req.user.id;
  const info = await db.prepare('INSERT INTO feedback (user_id, body) VALUES (?, ?) RETURNING id').run(uid, body);
  const fid = info.rows?.[0]?.id || info.id;
  const u = req.user;
  const uname = u.username ? `@${u.username}` : '—';
  const title = `Shikoyat / taklif · ${displayName(u)}`;
  const meta = JSON.stringify({
    feedbackId: fid,
    fromUserId: uid,
    fromName: displayName(u),
    username: u.username || null,
  });
  for (const adminId of ADMIN_IDS) {
    await db.prepare(`
      INSERT INTO notifications (user_id, kind, title, body, meta) VALUES (?, 'feedback', ?, ?, ?::jsonb)
    `).run(adminId, title, body, meta);
  }
  const msg = [
    '📩 Feedback / complaint',
    `#${fid}`,
    `User: ${displayName(u)} (${uname})`,
    `ID: ${uid}`,
    '',
    body,
  ].join('\n');
  let sent = 0;
  for (const adminId of ADMIN_IDS) {
    if (await notify.toUser(adminId, () => msg, { force: true })) sent++;
  }
  res.status(201).json({ ok: true, id: fid, notified: sent });
}));

function mapNotif(r) {
  let meta = r.meta;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = null; }
  }
  meta = meta && typeof meta === 'object' ? meta : null;
  if (meta && meta.mediaId && !meta.mediaUrl) {
    meta = { ...meta, mediaUrl: `/api/media/${meta.mediaId}` };
  }
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body || '',
    meta,
    read: !!r.read_at,
    createdAt: r.created_at,
    expiresAt: r.expires_at || null,
    permanent: !r.expires_at,
  };
}

const NOTIF_ACTIVE = `(expires_at IS NULL OR expires_at > now())`;

api.get('/notifications', wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, kind, title, body, meta, read_at, created_at, expires_at
    FROM notifications
    WHERE user_id = ? AND ${NOTIF_ACTIVE}
    ORDER BY created_at DESC LIMIT 100
  `).all(req.user.id);
  res.json({ notifications: rows.map(mapNotif) });
}));

api.get('/notifications/unread-count', wrap(async (req, res) => {
  // Chat traffic (DM) must never light the bell — only admin / feedback / system.
  const row = await db.prepare(`
    SELECT COUNT(*)::int AS n FROM notifications
    WHERE user_id = ? AND read_at IS NULL AND ${NOTIF_ACTIVE}
      AND kind <> 'dm'
  `).get(req.user.id);
  res.json({ count: row?.n || 0 });
}));

api.post('/notifications/:id/read', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  await db.prepare(`
    UPDATE notifications SET read_at = now() WHERE id = ? AND user_id = ? AND read_at IS NULL
  `).run(id, req.user.id);
  res.json({ ok: true });
}));

function dmPair(a, b) {
  const x = Number(a); const y = Number(b);
  return x < y ? [x, y] : [y, x];
}

async function blockedEither(a, b) {
  const row = await db.prepare(`
    SELECT 1 FROM user_blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?) LIMIT 1
  `).get(a, b, b, a);
  return !!row;
}

api.get('/messages/unread-count', wrap(async (req, res) => {
  const uid = req.user.id;
  const dm = await db.prepare(`
    SELECT COUNT(*)::int AS n FROM dm_messages m
    JOIN dm_threads t ON t.id = m.thread_id
    WHERE (t.user_a = ? OR t.user_b = ?) AND m.sender_id <> ? AND m.read_at IS NULL
  `).get(uid, uid, uid);
  res.json({ count: dm?.n || 0, dm: dm?.n || 0 });
}));

api.get('/messages/search', wrap(async (req, res) => {
  const raw = cleanText(req.query && req.query.q, 40, 'bad_request', true);
  const { mode, q } = parseUserSearchQuery(raw);
  if (!q) throw bad('Enter a name or @username', 'bad_request');
  const uid = req.user.id;
  const like = likePattern(q);
  // @… → username only; otherwise first/last name (not username)
  const rows = mode === 'username'
    ? await db.prepare(`
        SELECT u.id, u.first_name, u.last_name, u.username, u.premium, u.premium_until, u.avatar_key
        FROM users u
        WHERE u.id <> ? AND u.blocked = 0
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user_id = ? AND b.blocked_id = u.id) OR (b.user_id = u.id AND b.blocked_id = ?))
          AND lower(coalesce(u.username,'')) LIKE ? ESCAPE '\\'
        ORDER BY u.first_name ASC
        LIMIT 20
      `).all(uid, uid, uid, like)
    : await db.prepare(`
        SELECT u.id, u.first_name, u.last_name, u.username, u.premium, u.premium_until, u.avatar_key
        FROM users u
        WHERE u.id <> ? AND u.blocked = 0
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user_id = ? AND b.blocked_id = u.id) OR (b.user_id = u.id AND b.blocked_id = ?))
          AND (
            lower(coalesce(u.first_name,'')) LIKE ? ESCAPE '\\'
            OR lower(coalesce(u.last_name,'')) LIKE ? ESCAPE '\\'
            OR lower(trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,''))) LIKE ? ESCAPE '\\'
          )
        ORDER BY u.first_name ASC
        LIMIT 20
      `).all(uid, uid, uid, like, like, like);
  res.json({
    users: rows.map((u) => ({
      id: u.id, name: displayName(u), username: u.username || null, premium: isPremiumActive(u),
      avatarKey: u.avatar_key || null,
    })),
  });
}));

api.get('/messages/threads', wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const rows = await db.prepare(`
    SELECT t.id, t.updated_at, t.user_a, t.user_b,
      ua.first_name AS a_first, ua.last_name AS a_last, ua.username AS a_user, ua.premium AS a_prem, ua.premium_until AS a_until, ua.avatar_key AS a_av,
      ub.first_name AS b_first, ub.last_name AS b_last, ub.username AS b_user, ub.premium AS b_prem, ub.premium_until AS b_until, ub.avatar_key AS b_av,
      (SELECT body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*)::int FROM dm_messages m WHERE m.thread_id = t.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread
    FROM dm_threads t
    JOIN users ua ON ua.id = t.user_a
    JOIN users ub ON ub.id = t.user_b
    WHERE t.user_a = ? OR t.user_b = ?
    ORDER BY t.updated_at DESC
    LIMIT 50
  `).all(uid, uid, uid);
  res.json({
    threads: rows.map((r) => {
      const peer = Number(r.user_a) === uid
        ? { id: r.user_b, name: displayName({ first_name: r.b_first, last_name: r.b_last }), username: r.b_user, premium: isPremiumActive({ premium: r.b_prem, premium_until: r.b_until }), avatarKey: r.b_av || null }
        : { id: r.user_a, name: displayName({ first_name: r.a_first, last_name: r.a_last }), username: r.a_user, premium: isPremiumActive({ premium: r.a_prem, premium_until: r.a_until }), avatarKey: r.a_av || null };
      return { id: r.id, peer, lastBody: r.last_body || '', unread: r.unread || 0, updatedAt: r.updated_at };
    }),
  });
}));

api.post('/messages/threads', wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const other = intParam(req.body && req.body.userId);
  if (other === uid) throw bad('Invalid user', 'bad_request');
  const u = await getUser.get(other);
  if (!u || u.blocked) throw new HttpError(404, 'Player not found', 'notfound');
  if (await blockedEither(uid, other)) throw bad('Blocked', 'blocked');
  const [a, b] = dmPair(uid, other);
  let row = await db.prepare('SELECT id FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!row) {
    const ins = await db.prepare('INSERT INTO dm_threads (user_a, user_b) VALUES (?, ?) RETURNING id').run(a, b);
    const id = ins.rows?.[0]?.id;
    if (!id) throw bad('Could not open chat', 'server');
    row = { id };
  }
  res.status(201).json({
    id: Number(row.id),
    peer: { id: u.id, name: displayName(u), username: u.username || null, premium: isPremiumActive(u), avatarKey: u.avatar_key || null },
  });
}));

api.get('/messages/threads/:id', wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const tid = intParam(req.params.id);
  const th = await db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(tid);
  if (!th || (Number(th.user_a) !== uid && Number(th.user_b) !== uid)) {
    throw new HttpError(404, 'Not found', 'notfound');
  }
  const otherId = Number(th.user_a) === uid ? Number(th.user_b) : Number(th.user_a);
  const other = await getUser.get(otherId);
  await db.prepare(`
    UPDATE dm_messages SET read_at = now()
    WHERE thread_id = ? AND sender_id <> ? AND read_at IS NULL
  `).run(tid, uid);
  const msgs = await db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, m.reply_to_id,
      r.body AS reply_body, r.sender_id AS reply_sender
    FROM dm_messages m
    LEFT JOIN dm_messages r ON r.id = m.reply_to_id
    WHERE m.thread_id = ? ORDER BY m.created_at ASC LIMIT 200
  `).all(tid);
  res.json({
    peer: other
      ? { id: other.id, name: displayName(other), username: other.username || null, premium: isPremiumActive(other), avatarKey: other.avatar_key || null }
      : { id: otherId, name: 'Player' },
    messages: msgs.map((m) => ({
      id: m.id, body: m.body, mine: Number(m.sender_id) === uid, createdAt: m.created_at,
      replyTo: m.reply_to_id ? {
        id: m.reply_to_id,
        body: m.reply_body || '',
        mine: Number(m.reply_sender) === uid,
      } : null,
    })),
  });
}));

api.post('/messages/threads/:id', wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const tid = intParam(req.params.id);
  const body = cleanText(req.body && req.body.body, 1000, 'text', true);
  const replyToId = req.body && req.body.replyToId != null ? intParam(req.body.replyToId) : null;
  const th = await db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(tid);
  if (!th || (Number(th.user_a) !== uid && Number(th.user_b) !== uid)) {
    throw new HttpError(404, 'Not found', 'notfound');
  }
  const other = Number(th.user_a) === uid ? Number(th.user_b) : Number(th.user_a);
  if (await blockedEither(uid, other)) throw bad('Blocked', 'blocked');
  let replyMeta = null;
  if (replyToId) {
    const parent = await db.prepare('SELECT id, body, sender_id FROM dm_messages WHERE id = ? AND thread_id = ?').get(replyToId, tid);
    if (!parent) throw bad('Reply target missing', 'bad_request');
    replyMeta = { id: parent.id, body: parent.body, mine: Number(parent.sender_id) === uid };
  }
  const ins = await db.prepare(`
    INSERT INTO dm_messages (thread_id, sender_id, body, reply_to_id) VALUES (?, ?, ?, ?) RETURNING id, created_at
  `).run(tid, uid, body, replyToId);
  const row = ins.rows?.[0];
  if (!row) throw bad('Could not send', 'server');
  await db.prepare('UPDATE dm_threads SET updated_at = now() WHERE id = ?').run(tid);

  const me = await person(uid);
  const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  // Inbox mail badge only — do not insert into notifications (bell stays chat-free).
  realtime.send(other, {
    t: 'dm',
    threadId: tid,
    id: row.id,
    from: { id: uid, name: me.name },
    body,
    preview,
    replyTo: replyMeta,
  });
  // Telegram push when recipient is not live in the Mini App
  if (!realtime.isOnline(other)) {
    notify.toUser(other, (T) => T.dmReceived(me.name, preview), { dmThreadId: tid });
  }

  res.status(201).json({
    id: row.id,
    body,
    mine: true,
    createdAt: row.created_at || new Date().toISOString(),
    replyTo: replyMeta,
  });
}));

// ---------- DM retention: messages live 60 days, then are deleted ----------
const DM_TTL_DAYS = 60;
let lastDmPurge = 0;
/** Delete DMs older than 60 days (oldest first, in batches) and threads left empty. Runs at most hourly. */
async function purgeOldDms({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastDmPurge < 60 * 60 * 1000) return 0;
  lastDmPurge = now;
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const del = await db.prepare(`
      DELETE FROM dm_messages
      WHERE id IN (
        SELECT id FROM dm_messages
        WHERE created_at < now() - (? * interval '1 day')
        ORDER BY created_at ASC, id ASC
        LIMIT 500
      )
      RETURNING id
    `).run(DM_TTL_DAYS);
    const n = del.changes || (del.rows && del.rows.length) || 0;
    removed += n;
    if (n < 500) break;
  }
  await db.prepare(`
    DELETE FROM dm_threads t
    WHERE t.updated_at < now() - (? * interval '1 day')
      AND NOT EXISTS (SELECT 1 FROM dm_messages m WHERE m.thread_id = t.id)
  `).run(DM_TTL_DAYS);
  return removed;
}

// ---------- friends ----------
api.get('/friends', wrap(async (req, res) => {
  const uid = req.user.id;
  const rows = await db.prepare(`
    SELECT u.id, u.first_name, u.premium, u.premium_until, u.present_until, u.avatar_key, u.elo
    FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.first_name
  `).all(uid);
  let busy;
  const busyCached = await cacheGet('lobby:busy', 5_000);
  if (busyCached) busy = new Set(busyCached);
  else {
    const pairs = (await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]);
    busy = new Set(pairs);
    await cacheSet('lobby:busy', pairs, 5_000);
  }
  const pending = await db.prepare(
    "SELECT i.user_id, i.game_id FROM game_invites i JOIN games g ON g.id = i.game_id WHERE g.status = 'invited' AND g.creator_id = ?"
  ).all(uid);
  const inviteGameByUser = new Map(pending.map((r) => [r.user_id, r.game_id]));
  res.json({
    friends: rows.map((r) => ({
      id: r.id, name: r.first_name || 'Player', online: isUserOnline(r.id, r.present_until), inGame: busy.has(r.id),
      premium: isPremiumActive(r),
      invited: inviteGameByUser.has(r.id), inviteGameId: inviteGameByUser.get(r.id) || null,
      avatarKey: r.avatar_key || null,
      elo: Number(r.elo || DEFAULT_ELO),
    })).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)),
  });
}));

// Called when someone opens a friend-invite link (t.me/<bot>?start=i<inviterId> or startapp).
// Any user (new or existing) gets referral diamonds once; inviter is always added as a friend.
api.post('/friends/join', wrap(async (req, res) => {
  const uid = req.user.id;
  const other = intParam(req.body && req.body.userId);
  const u = await getUser.get(other);
  if (other === uid || !u || u.blocked) throw new HttpError(404, 'Player not found', 'user_unavailable');
  const already = await areFriends(uid, other);
  const { reward, inviteeReward, befriended, inserted } = await applyReferralPay(uid, other);
  // Clear pending only once referral is recorded (not merely because a game made them friends)
  if (inserted || reward || inviteeReward || await referralRowExists(uid)) {
    await clearPendingInviter(uid);
  }
  // Notify only on real pay or a newly created friendship edge (avoids double-DM races)
  if (reward || inviteeReward || befriended) {
    const me = (await person(uid)).name;
    realtime.send(other, { t: 'friend', id: uid, reward: reward || 0 });
    notify.toUser(other, (T) => T.friendJoined(me) + (reward ? ` 💎 +${reward}` : ''));
  }
  const meRow = inviteeReward || reward ? await getUser.get(uid) : null;
  if (meRow) memoUser(meRow);
  // If inviter is waiting on a friend board, let the client join it after the referral claim
  const openWait = await db.prepare(`
    SELECT id FROM games
    WHERE creator_id = ? AND status = 'open' AND mode = 'friend'
    ORDER BY created_at DESC LIMIT 1
  `).get(other);
  res.json({
    friend: await person(other),
    already: already && !reward && !inviteeReward,
    inviteeReward,
    reward,
    openGameId: openWait?.id || null,
    user: meRow ? publicUser(meRow, req.isAdmin) : undefined,
  });
}));

// Spend diamonds on Premium (1 / 3 / 6 / 12 Tashkent months). Active Premium cannot be extended — buy again after it ends.
api.post('/premium/buy', wrap(async (req, res) => {
  const shop = await getShopSettings();
  const months = Math.floor(Number((req.body && req.body.months) ?? 1));
  const plan = shop.premiumPlans.find((p) => p.months === months);
  if (!plan) throw bad('Choose 1, 3, 6 or 12 months', 'bad_request');
  const price = plan.diamonds;
  const u = await getUser.get(req.user.id);
  if (isPremiumActive(u)) throw bad('You already have Premium', 'premium_owned');
  if (Number(u.diamonds || 0) < price) throw bad('Not enough diamonds', 'no_diamonds');
  const until = addMonthsTashkent(new Date(), months);
  const r = await db.prepare(`
    UPDATE users SET diamonds = diamonds - ?, premium = 1, premium_until = ?
    WHERE id = ? AND diamonds >= ?
  `).run(price, until.toISOString(), req.user.id, price);
  if (!r.changes) throw bad('Not enough diamonds', 'no_diamonds');
  await ledgerDiamonds(req.user.id, -price, 'premium_buy', { months });
  invalidateUserCache(req.user.id);
  const row = await getUser.get(req.user.id);
  memoUser(row);
  const next = publicUser(row, req.isAdmin);
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
  // History row (amount 0 until admin credits after payment)
  try {
    await db.prepare(
      'INSERT INTO diamond_ledger (user_id, amount, kind, meta) VALUES (?, 0, ?, ?::jsonb)',
    ).run(u.id, 'shop_order', JSON.stringify({ diamonds: pack.diamonds, sum: pack.sum, notified }));
  } catch (e) { console.error('[ledger] shop_order', e.message || e); }
  res.json({ ok: true, pack, notified, payUsername: shop.payUsername });
}));

api.delete('/friends/:id', wrap(async (req, res) => {
  const other = intParam(req.params.id);
  await db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, other, other, req.user.id);
  res.json({ ok: true });
}));

// ---------- promo codes ----------
api.post('/promo/redeem', wrap(async (req, res) => {
  const code = normalizePromoCode(req.body && req.body.code);
  if (!PROMO_CODE_RE.test(code)) throw bad('Invalid promo code', 'promo_invalid');
  const uid = req.user.id;
  const client = await db.pool.connect();
  let rewardType;
  let rewardAmount;
  let untilIso = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [code]);
    const p = rows[0];
    if (!p || !p.active) throw bad('Promo code not found', 'promo_notfound');
    if (new Date(p.ends_at).getTime() <= Date.now()) throw bad('Promo code expired', 'promo_expired');
    if (p.max_uses != null && Number(p.used_count) >= Number(p.max_uses)) {
      throw bad('Promo code fully used', 'promo_exhausted');
    }
    const used = await client.query(
      'SELECT 1 FROM promo_redemptions WHERE promo_id = $1 AND user_id = $2',
      [p.id, uid],
    );
    if (used.rows.length) throw bad('You already used this promo', 'promo_used');

    rewardType = p.reward_type;
    rewardAmount = Number(p.reward_amount);
    const uRow = await client.query('SELECT diamonds, premium, premium_until FROM users WHERE id = $1 FOR UPDATE', [uid]);
    const u = uRow.rows[0];
    if (!u) throw new HttpError(404, 'User not found', 'notfound');

    if (rewardType === 'diamonds') {
      await client.query('UPDATE users SET diamonds = diamonds + $1 WHERE id = $2', [rewardAmount, uid]);
    } else if (rewardType === 'premium_days' || rewardType === 'premium_months') {
      const base = (u.premium_until && new Date(u.premium_until).getTime() > Date.now())
        ? new Date(u.premium_until)
        : new Date();
      const until = rewardType === 'premium_months'
        ? addMonthsTashkent(base, rewardAmount)
        : addDaysUtc(base, rewardAmount);
      untilIso = until.toISOString();
      await client.query(
        'UPDATE users SET premium = 1, premium_until = $1 WHERE id = $2',
        [untilIso, uid],
      );
    } else {
      throw bad('Invalid promo reward', 'promo_invalid');
    }

    await client.query(
      `INSERT INTO promo_redemptions (promo_id, user_id, reward_type, reward_amount)
       VALUES ($1, $2, $3, $4)`,
      [p.id, uid, rewardType, rewardAmount],
    );
    await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1', [p.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (rewardType === 'diamonds') {
    await ledgerDiamonds(uid, rewardAmount, 'promo', { code });
  }
  invalidateUserCache(uid);
  const nextRow = await getUser.get(uid);
  memoUser(nextRow);
  const next = publicUser(nextRow, isAdmin(nextRow.id));
  realtime.send(uid, { t: 'wallet', user: next, promo: { code, rewardType, rewardAmount } });
  res.json({
    ok: true,
    user: next,
    reward: {
      type: rewardType,
      amount: rewardAmount,
      premiumUntil: untilIso,
      premiumUntilTashkent: untilIso ? formatTashkent(untilIso) : null,
    },
  });
}));

// ---------- announcements (home carousel) ----------
const ANN_FONTS = ['system', 'rounded', 'serif', 'mono'];
const ANN_PAGES = ['play', 'puzzles', 'rankings', 'live', 'profile', 'premium', 'friends', 'settings', 'diamonds', 'promo'];
const PROMO_REWARD_TYPES = ['diamonds', 'premium_days', 'premium_months'];
const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
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
    board: row.board === 'puzzle' ? 'puzzle' : 'home',
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

function parseAnnBoard(raw) {
  return raw === 'puzzle' ? 'puzzle' : 'home';
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

const mediaThumbs = new Map(); // `${id}:${w}` -> { buf, mime } (small LRU)
api.get('/media/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Not found', 'notfound');
  // Only columns needed to stream BYTEA from Neon (avoid SELECT * on large rows).
  const row = await db.prepare('SELECT id, mime, data, size FROM media WHERE id = ?').get(id);
  if (!row) throw bad('Not found', 'notfound');
  let buf = await loadMediaBytes(row);
  if (!buf) throw bad('Not found', 'notfound');
  let mime = row.mime || 'application/octet-stream';
  // Phones get a right-sized copy (originals can be several MB — they timed out and the carousel fell back to ♛)
  const w = Math.floor(Number(req.query.w) || 0);
  if (w >= 120 && w <= 1600 && /^image\/(jpeg|png|webp)$/.test(mime)) {
    const key = `${id}:${w}`;
    let hit = mediaThumbs.get(key);
    if (!hit) {
      try {
        const out = await require('sharp')(buf, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true })
          [mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg'](mime === 'image/png' ? { compressionLevel: 9, palette: true } : { quality: 82 })
          .toBuffer();
        hit = { buf: out.length < buf.length ? out : buf, mime };
        mediaThumbs.set(key, hit);
        if (mediaThumbs.size > 40) mediaThumbs.delete(mediaThumbs.keys().next().value);
      } catch { hit = null; }
    }
    if (hit) { buf = hit.buf; mime = hit.mime; }
  }
  res.set({
    'Content-Type': mime,
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': buf.length,
  });
  res.end(buf);
}));

api.get('/announcements', wrap(async (req, res) => {
  await purgeExpiredAnnouncements();
  const board = parseAnnBoard(req.query.board);
  const rows = await db.prepare(`
    SELECT * FROM announcements WHERE ends_at > now() AND board = ? ORDER BY id DESC LIMIT 20
  `).all(board);
  res.json({ announcements: rows.map(publicAnnouncement), board, nowTashkent: formatTashkent(new Date()) });
}));

// ---------- admin ----------
const admin = express.Router();
admin.use((req, res, next) => (req.isAdmin ? next() : res.status(404).json({ error: 'Not found', code: 'notfound' }))); // do not reveal the panel

const one = async (sql, ...p) => (await db.prepare(sql).get(...p)).n;

admin.get('/stats', wrap(async (req, res) => {
  const signups = await db.prepare("SELECT to_char(created_at::date, 'YYYY-MM-DD') d, COUNT(*) c FROM users WHERE id < 9000000000000 AND created_at::date >= current_date - 13 GROUP BY 1").all();
  const map = Object.fromEntries(signups.map((r) => [r.d, r.c]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: map[d] || 0 };
  });
  res.json({
    users: await one('SELECT COUNT(*) n FROM users WHERE id < 9000000000000'),
    live: (await db.prepare(`
      SELECT COUNT(*)::int AS n FROM users WHERE blocked = 0 AND id < 9000000000000 AND present_until > now()
    `).get())?.n || realtime.onlineIds().length,
    newToday: await one("SELECT COUNT(*) n FROM users WHERE id < 9000000000000 AND created_at::date = current_date"),
    active7d: await one("SELECT COUNT(*) n FROM users WHERE id < 9000000000000 AND last_seen >= now() - interval '7 days'"),
    blocked: await one('SELECT COUNT(*) n FROM users WHERE blocked = 1'),
    unreachable: await one('SELECT COUNT(*) n FROM users WHERE bot_blocked = 1'),
    gamesLive: await one("SELECT COUNT(*) n FROM games WHERE status = 'active'"),
    gamesPlayed: await one("SELECT COUNT(*) n FROM games WHERE status = 'finished'"),
    byLang: await db.prepare('SELECT lang, COUNT(*) c FROM users WHERE id < 9000000000000 GROUP BY lang').all(),
    signups: days,
  });
}));

// Everyone who has the app open right now
admin.get('/live', wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, first_name, username, lang FROM users
    WHERE blocked = 0 AND present_until > now()
    ORDER BY present_until DESC LIMIT 500
  `).all();
  if (!rows.length) return res.json({ count: 0, users: [] });
  const busy = new Set((await db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all()).flatMap((g) => [g.white_id, g.black_id]));
  res.json({
    count: rows.length,
    users: rows.map((u) => ({ id: u.id, name: u.first_name || 'Player', username: u.username, lang: u.lang, inGame: busy.has(u.id), isAdmin: isAdmin(u.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

admin.get('/users', wrap(async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 40);
  const { mode, q } = parseUserSearchQuery(raw);
  const like = q ? likePattern(q) : '';
  const baseSelect = `
    SELECT u.id, u.first_name, u.last_name, u.username, u.lang, u.blocked, u.bot_blocked, u.created_at, u.last_seen,
      u.present_until, u.diamonds, u.premium, u.premium_until,
      (SELECT COUNT(*) FROM games g WHERE g.status = 'finished' AND (g.white_id = u.id OR g.black_id = u.id)) games
    FROM users u`;
  let rows;
  if (!q) {
    rows = await db.prepare(`${baseSelect} ORDER BY u.last_seen DESC LIMIT 100`).all();
  } else if (mode === 'username') {
    rows = await db.prepare(`
      ${baseSelect}
      WHERE lower(coalesce(u.username,'')) LIKE ? ESCAPE '\\'
      ORDER BY u.last_seen DESC LIMIT 100
    `).all(like);
  } else if (/^\d+$/.test(q)) {
    // Digits without @: Telegram id (admin convenience)
    rows = await db.prepare(`
      ${baseSelect}
      WHERE CAST(u.id AS TEXT) LIKE ? ESCAPE '\\'
      ORDER BY u.last_seen DESC LIMIT 100
    `).all(like);
  } else {
    rows = await db.prepare(`
      ${baseSelect}
      WHERE u.first_name ILIKE ? ESCAPE '\\' OR u.last_name ILIKE ? ESCAPE '\\'
         OR trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) ILIKE ? ESCAPE '\\'
      ORDER BY u.last_seen DESC LIMIT 100
    `).all(like, like, like);
  }
  res.json({
    users: rows.map((u) => ({
      ...u,
      diamonds: Number(u.diamonds || 0),
      premium: isPremiumActive(u),
      premiumUntilTashkent: u.premium_until ? formatTashkent(u.premium_until) : null,
      online: isUserOnline(u.id, u.present_until),
      isAdmin: isAdmin(u.id),
    })),
  });
}));

admin.post('/users/:id/block', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  if (isAdmin(id)) throw bad('Admins cannot be blocked', 'admin_block');
  const blocked = req.body && req.body.blocked ? 1 : 0;
  if (!(await db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id)).changes) throw new HttpError(404, 'User not found', 'notfound');
  invalidateUserCache(id);
  res.json({ ok: true, blocked: !!blocked });
}));

/** Permanently wipe a user (admin search). Rejoin via bot/referral creates a fresh account. */
admin.delete('/users/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  if (isAdmin(id)) throw bad('Admins cannot be deleted', 'admin_delete');
  if (!(await getUser.get(id))) throw new HttpError(404, 'User not found', 'notfound');
  await purgeUser(id, { keepFinishedGames: false });
  invalidateUserCache(id);
  res.json({ ok: true });
}));

const NOTIF_TTL = {
  permanent: null,
  '1h': 1 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function parseNotifExpiry(body) {
  const b = body || {};
  if (b.expiresAt) {
    const d = new Date(b.expiresAt);
    if (Number.isNaN(d.getTime())) throw bad('Invalid expiry', 'bad_request');
    return d;
  }
  if (b.permanent === true) return null;
  const ttl = b.ttl == null || b.ttl === '' ? 'permanent' : String(b.ttl);
  if (!(ttl in NOTIF_TTL)) throw bad('Invalid TTL', 'bad_request');
  const ms = NOTIF_TTL[ttl];
  return ms == null ? null : new Date(Date.now() + ms);
}

function mapCampaign(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body || '',
    mediaId: r.media_id || null,
    mediaUrl: r.media_id ? `/api/media/${r.media_id}` : null,
    expiresAt: r.expires_at || null,
    permanent: !r.expires_at,
    sentCount: Number(r.sent_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

admin.get('/notifications', wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM notification_campaigns ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json({ campaigns: rows.map(mapCampaign), ttlOptions: Object.keys(NOTIF_TTL) });
}));

/** In-app notification: one user or everyone (except blocked). Optional mediaId + TTL/permanent. */
admin.post('/notifications', wrap(async (req, res) => {
  const title = cleanText(req.body && req.body.title, 80, 'title', true);
  const body = cleanText(req.body && req.body.body, 1000, 'text', true);
  const one = req.body && req.body.userId != null ? intParam(req.body.userId) : null;
  const expiresAt = parseNotifExpiry(req.body);
  let mediaId = null;
  if (req.body && req.body.mediaId) {
    mediaId = String(req.body.mediaId);
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw bad('Invalid media', 'media');
    const row = await db.prepare('SELECT id, kind FROM media WHERE id = ?').get(mediaId);
    if (!row) throw bad('Media not found, upload it again', 'media');
    if (row.kind === 'video') throw bad('Use JPG, PNG or GIF', 'media_type');
  }
  let targets;
  if (one) {
    const u = await getUser.get(one);
    if (!u || u.blocked) throw new HttpError(404, 'User not found', 'notfound');
    targets = [one];
  } else {
    targets = (await db.prepare('SELECT id FROM users WHERE blocked = 0').all()).map((r) => Number(r.id));
  }
  const campaignId = crypto.randomUUID();
  if (!targets.length) {
    await db.prepare(`
      INSERT INTO notification_campaigns (id, title, body, media_id, expires_at, created_by, sent_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(campaignId, title, body, mediaId, expiresAt, req.user.id);
    return res.status(201).json({ ok: true, sent: 0, campaign: mapCampaign(await db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(campaignId)) });
  }
  const meta = {
    fromAdmin: req.user.id,
    campaignId,
    ...(mediaId ? { mediaId } : {}),
  };
  await db.prepare(`
    INSERT INTO notification_campaigns (id, title, body, media_id, expires_at, created_by, sent_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(campaignId, title, body, mediaId, expiresAt, req.user.id, targets.length);
  const r = await db.prepare(`
    INSERT INTO notifications (user_id, kind, title, body, meta, expires_at, campaign_id)
    SELECT x.id, 'admin', ?, ?, ?::jsonb, ?, ?::uuid
    FROM unnest(?::bigint[]) AS x(id)
  `).run(title, body, JSON.stringify(meta), expiresAt, campaignId, targets);
  const campaign = await db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(campaignId);
  res.status(201).json({ ok: true, sent: r.changes || targets.length, campaign: mapCampaign(campaign) });
}));

admin.patch('/notifications/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Not found', 'notfound');
  const cur = await db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(id);
  if (!cur) throw bad('Not found', 'notfound');
  const b = req.body || {};
  const title = b.title !== undefined ? cleanText(b.title, 80, 'title', true) : cur.title;
  const body = b.body !== undefined ? cleanText(b.body, 1000, 'text', true) : cur.body;
  let mediaId = cur.media_id;
  if (b.mediaId !== undefined) {
    if (b.mediaId === null || b.mediaId === '') mediaId = null;
    else {
      mediaId = String(b.mediaId);
      if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw bad('Invalid media', 'media');
      const row = await db.prepare('SELECT id, kind FROM media WHERE id = ?').get(mediaId);
      if (!row) throw bad('Media not found, upload it again', 'media');
      if (row.kind === 'video') throw bad('Use JPG, PNG or GIF', 'media_type');
    }
  }
  let expiresAt = cur.expires_at;
  if (b.ttl !== undefined || b.permanent !== undefined || b.expiresAt !== undefined) {
    expiresAt = parseNotifExpiry(b);
  }
  await db.prepare(`
    UPDATE notification_campaigns
    SET title = ?, body = ?, media_id = ?, expires_at = ?, updated_at = now()
    WHERE id = ?
  `).run(title, body, mediaId, expiresAt, id);
  const meta = {
    fromAdmin: cur.created_by || req.user.id,
    campaignId: id,
    ...(mediaId ? { mediaId } : {}),
  };
  await db.prepare(`
    UPDATE notifications
    SET title = ?, body = ?, meta = ?::jsonb, expires_at = ?
    WHERE campaign_id = ?::uuid
  `).run(title, body, JSON.stringify(meta), expiresAt, id);
  res.json({ campaign: mapCampaign(await db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(id)) });
}));

/** Delete a broadcast by one recipient copy id (admin inbox → delete for everyone). */
admin.delete('/notifications/by-copy/:id', wrap(async (req, res) => {
  const copyId = intParam(req.params.id);
  const row = await db.prepare('SELECT id, kind, title, body, meta, campaign_id, created_at FROM notifications WHERE id = ?').get(copyId);
  if (!row || row.kind !== 'admin') throw bad('Not found', 'notfound');
  let meta = row.meta;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = null; }
  }
  const campaignId = row.campaign_id || (meta && meta.campaignId) || null;
  if (campaignId) {
    await db.prepare('DELETE FROM notifications WHERE campaign_id = ?::uuid').run(campaignId);
    await db.prepare(`DELETE FROM notifications WHERE kind = 'admin' AND meta->>'campaignId' = ?`).run(String(campaignId));
    await db.prepare('DELETE FROM notification_campaigns WHERE id = ?').run(campaignId);
  } else {
    // Orphan admin blast: same title/body around the same second
    await db.prepare(`
      DELETE FROM notifications
      WHERE kind = 'admin' AND title = ? AND body = ?
        AND created_at BETWEEN (?::timestamptz - interval '2 seconds') AND (?::timestamptz + interval '2 seconds')
    `).run(row.title, row.body || '', row.created_at, row.created_at);
  }
  res.json({ ok: true });
}));

admin.delete('/notifications/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Not found', 'notfound');
  await db.prepare('DELETE FROM notifications WHERE campaign_id = ?::uuid').run(id);
  // Also clear copies that only stored campaignId inside meta (legacy / partial writes)
  await db.prepare(`
    DELETE FROM notifications
    WHERE kind = 'admin' AND meta->>'campaignId' = ?
  `).run(id);
  const r = await db.prepare('DELETE FROM notification_campaigns WHERE id = ?').run(id);
  if (!r.changes) throw bad('Not found', 'notfound');
  res.json({ ok: true });
}));

/** Admin: add/remove rating points. Body: { amount: ±1…2000 } — applied to the overall and every time-control rating. */
admin.post('/users/:id/rating', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const amount = Math.floor(Number(req.body && req.body.amount)) || 0;
  if (!amount || Math.abs(amount) > 2000) throw bad('Amount must be ±1…2000', 'bad_request');
  const u = await getUser.get(id);
  if (!u) throw new HttpError(404, 'User not found', 'notfound');
  await db.prepare(`
    UPDATE users SET
      elo = LEAST(4000, GREATEST(100, elo + ?)),
      elo_bullet = LEAST(4000, GREATEST(100, elo_bullet + ?)),
      elo_blitz = LEAST(4000, GREATEST(100, elo_blitz + ?)),
      elo_rapid = LEAST(4000, GREATEST(100, elo_rapid + ?)),
      elo_classic = LEAST(4000, GREATEST(100, elo_classic + ?))
    WHERE id = ?
  `).run(amount, amount, amount, amount, amount, id);
  invalidateUserCache(id);
  await clearRankingCaches();
  const next = await getUser.get(id);
  res.json({ ok: true, elo: Number(next.elo) });
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
  if (amount) {
    await ledgerDiamonds(id, amount, amount > 0 ? 'admin_grant' : 'admin_remove', {
      premiumMonths: premiumMonths || 0,
    });
  }

  invalidateUserCache(id);
  const nextRow = await getUser.get(id);
  memoUser(nextRow);
  const next = publicUser(nextRow, isAdmin(nextRow.id));
  realtime.send(id, {
    t: 'wallet',
    user: next,
    granted: { diamonds: amount || 0, premiumMonths: premiumMonths || 0 },
  });
  const untilLabel = next.premiumUntilTashkent
    ? next.premiumUntilTashkent.replace('T', ' ')
    : null;
  if (amount < 0) {
    // Removal must not send the "payment confirmed" grant text
    await notify.toUser(id, (T) => T.walletRemoved({ diamonds: Math.abs(amount) }), { force: true });
  } else if (amount > 0 || premiumMonths > 0) {
    await notify.toUser(id, (T) => T.walletGranted({
      diamonds: amount > 0 ? amount : 0,
      months: premiumMonths || 0,
      until: untilLabel,
    }), { force: true, effect: 'party' });
  }
  res.json({ ok: true, user: next });
}));

admin.get('/promos', wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT 100
  `).all();
  res.json({
    promos: rows.map(publicPromo),
    rewardTypes: PROMO_REWARD_TYPES,
    nowTashkent: formatTashkent(new Date()),
  });
}));

admin.post('/promos', wrap(async (req, res) => {
  const b = req.body || {};
  let code = normalizePromoCode(b.code);
  if (!code) code = crypto.randomBytes(4).toString('hex').toUpperCase();
  if (!PROMO_CODE_RE.test(code)) throw bad('Code: 3–32 letters/digits/_/-', 'promo_invalid');
  const rewardType = String(b.rewardType || '');
  if (!PROMO_REWARD_TYPES.includes(rewardType)) throw bad('Choose diamonds or Premium', 'promo_reward');
  const rewardAmount = Math.floor(Number(b.rewardAmount));
  if (rewardType === 'diamonds') {
    if (!(rewardAmount >= 1 && rewardAmount <= 1_000_000)) throw bad('Diamonds: 1…1000000', 'promo_amount');
  } else if (rewardType === 'premium_days') {
    if (!(rewardAmount >= 1 && rewardAmount <= 3660)) throw bad('Premium days: 1…3660', 'promo_amount');
  } else if (!(rewardAmount >= 1 && rewardAmount <= 120)) {
    throw bad('Premium months: 1…120', 'promo_amount');
  }
  let maxUses = null;
  if (b.maxUses != null && b.maxUses !== '') {
    maxUses = Math.floor(Number(b.maxUses));
    if (!(maxUses >= 1 && maxUses <= 1_000_000)) throw bad('Max uses: 1…1000000', 'promo_max');
  }
  const ends = parseTashkentEnd(b.endsAtTashkent || b.endsAt);
  if (ends.getTime() <= Date.now()) throw bad('End date must be in the future (Tashkent)', 'ends_at');
  const note = cleanText(b.note, 120, 'bad_request', false);
  try {
    const info = await db.prepare(`
      INSERT INTO promo_codes (
        code, reward_type, reward_amount, max_uses, ends_at, note, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).run(code, rewardType, rewardAmount, maxUses, ends.toISOString(), note, req.user.id);
    res.status(201).json({ promo: publicPromo(info.rows[0]) });
  } catch (e) {
    if (String(e && e.message || e).includes('promo_codes_code_key') || e.code === '23505') {
      throw bad('Code already exists', 'promo_exists');
    }
    throw e;
  }
}));

admin.patch('/promos/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const cur = await db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
  if (!cur) throw bad('Not found', 'notfound');
  const b = req.body || {};
  let active = cur.active;
  if (b.active !== undefined) active = b.active ? 1 : 0;
  let endsAt = cur.ends_at;
  if (b.endsAtTashkent || b.endsAt) {
    endsAt = parseTashkentEnd(b.endsAtTashkent || b.endsAt).toISOString();
  }
  let maxUses = cur.max_uses;
  if (b.maxUses !== undefined) {
    if (b.maxUses === null || b.maxUses === '') maxUses = null;
    else {
      maxUses = Math.floor(Number(b.maxUses));
      if (!(maxUses >= 1 && maxUses <= 1_000_000)) throw bad('Max uses: 1…1000000', 'promo_max');
      if (maxUses < Number(cur.used_count || 0)) throw bad('Max uses below already used count', 'promo_max');
    }
  }
  const note = b.note !== undefined ? cleanText(b.note, 120, 'bad_request', false) : cur.note;
  await db.prepare(`
    UPDATE promo_codes SET active = ?, ends_at = ?, max_uses = ?, note = ? WHERE id = ?
  `).run(active ? 1 : 0, endsAt, maxUses, note, id);
  res.json({ promo: publicPromo(await db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id)) });
}));

admin.delete('/promos/:id', wrap(async (req, res) => {
  const id = intParam(req.params.id);
  const r = await db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
  if (!r.changes) throw bad('Not found', 'notfound');
  res.json({ ok: true });
}));

admin.get('/profile-banner', wrap(async (req, res) => {
  res.json(await profileBannerMeta());
}));

admin.patch('/profile-banner', wrap(async (req, res) => {
  const raw = req.body && req.body.mediaId;
  if (raw == null || raw === '' || raw === false) {
    await setSetting('profile_banner_media_id', '');
    return res.json(await profileBannerMeta());
  }
  const id = String(raw);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Invalid media', 'media');
  const row = await db.prepare('SELECT id, kind FROM media WHERE id = ?').get(id);
  if (!row) throw bad('Media not found, upload it again', 'media');
  if (row.kind === 'video') throw bad('Use JPG, PNG or GIF', 'media_type');
  await setSetting('profile_banner_media_id', id);
  res.json(await profileBannerMeta());
}));

admin.get('/boot-splash', wrap(async (req, res) => {
  const splash = await loadBootSplashConfig();
  res.json({ splash, langs: LANGS, animations: BOOT_ANIMS });
}));

admin.patch('/boot-splash', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.splash && typeof b.splash === 'object') {
    const splash = await saveBootSplashConfig(b.splash);
    return res.json({ splash });
  }
  const lang = LANGS.includes(b.lang) ? b.lang : null;
  if (!lang) throw bad('Pick a language', 'bad_request');
  const splash = await saveBootSplashLang(lang, {
    title: b.title,
    subtitle: b.subtitle,
    animation: b.animation,
  });
  res.json({ splash });
}));

admin.get('/welcome', wrap(async (req, res) => {
  const welcome = await loadWelcomeConfig();
  res.json({ welcome, langs: LANGS, colors: COLORS });
}));

admin.patch('/welcome', wrap(async (req, res) => {
  const b = req.body || {};
  const lang = LANGS.includes(b.lang) ? b.lang : null;
  if (!lang) throw bad('Pick a language', 'bad_request');
  if (b.mediaId) {
    const row = await db.prepare('SELECT id FROM media WHERE id = ?').get(String(b.mediaId));
    if (!row) throw bad('Media not found, upload it again', 'media');
  }
  const entry = await saveWelcomeLang(lang, {
    text: b.text,
    mediaId: b.mediaId === undefined ? undefined : b.mediaId,
    buttons: b.buttons,
  });
  res.json({ lang, entry });
}));

admin.post('/welcome/test', wrap(async (req, res) => {
  const b = req.body || {};
  const lang = LANGS.includes(b.lang) ? b.lang : req.user.lang || 'en';
  try {
    await sendWelcome(bot, req.user.id, lang, {
      webAppUrl: WEBAPP_URL,
      payload: '',
      botUsername: await getBotUsername(),
      userId: req.user.id,
    });
  } catch (e) {
    throw bad(`Telegram refused: ${e.description || e.message}`, 'tg_error');
  }
  res.json({ ok: true, lang });
}));

admin.get('/shop', wrap(async (req, res) => {
  res.json({ shop: await getShopSettings() });
}));

admin.patch('/shop', wrap(async (req, res) => {
  const b = req.body || {};
  await cacheDel('shop:settings');
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
    await cacheDel('shop:settings');
    const shop = await getShopSettings();
    const plans = shop.premiumPlans.map((p) => (p.months === 1 ? { ...p, diamonds: n } : p));
    if (!plans.some((p) => p.months === 1)) plans.unshift({ months: 1, diamonds: n });
    await setSetting('premium_plans', JSON.stringify(plans));
  }
  if (b.diamondPacks !== undefined) {
    const packs = parseDiamondPacksStrict(b.diamondPacks);
    await setSetting('diamond_packs', JSON.stringify(packs));
  }
  if (b.payUsername !== undefined) {
    const name = String(b.payUsername || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{5,64}$/.test(name)) throw bad('Invalid Telegram username', 'bad_request');
    await setSetting('pay_username', name);
  }
  if (b.puzzleDailyReward !== undefined) {
    const n = Math.floor(Number(b.puzzleDailyReward));
    if (!(n >= 0 && n <= 1_000_000)) throw bad('Puzzle reward must be 0…1000000 diamonds', 'bad_request');
    await setSetting('puzzle_daily_reward', String(n));
  }
  if (b.referralReward !== undefined) {
    const n = Math.floor(Number(b.referralReward));
    if (!(n >= 0 && n <= 1_000_000)) throw bad('Referral reward must be 0…1000000 diamonds', 'bad_request');
    await setSetting('referral_reward', String(n));
  }
  if (b.referralInviteeReward !== undefined) {
    const n = Math.floor(Number(b.referralInviteeReward));
    if (!(n >= 0 && n <= 1_000_000)) throw bad('Invitee reward must be 0…1000000 diamonds', 'bad_request');
    await setSetting('referral_invitee_reward', String(n));
  }
  if (b.analysisDailyFree !== undefined) {
    const n = Math.floor(Number(b.analysisDailyFree));
    if (!(n >= 0 && n <= 100)) throw bad('Analysis daily free must be 0…100', 'bad_request');
    await setSetting('analysis_daily_free', String(n));
  }
  if (b.tour !== undefined) {
    if (!b.tour || typeof b.tour !== 'object') throw bad('Invalid tournament settings', 'bad_request');
    const cur = (await getShopSettings()).tour;
    const next = { ...cur };
    for (const k of Object.keys(TOUR_CFG_DEFAULT)) {
      if (b.tour[k] === undefined) continue;
      const n = Math.floor(Number(b.tour[k]));
      const max = k === 'weeklyLimit' || k === 'dailyJoinLimit' ? 50 : (k === 'bigThreshold' ? 64 : 1_000_000);
      const min = k === 'weeklyLimit' || k === 'dailyJoinLimit' || k === 'bigThreshold' ? 1 : 0;
      if (!(n >= min && n <= max)) throw bad(`Tournament setting ${k} must be ${min}…${max}`, 'bad_request');
      next[k] = n;
    }
    await setSetting('tour_config', JSON.stringify(next));
  }
  await cacheDel('shop:settings');
  res.json({ shop: await getShopSettings() });
}));

admin.get('/medals', wrap(async (req, res) => {
  const month = String(req.query.month || monthKey());
  const year = Number(String(month).slice(0, 4)) || Number(monthKey().slice(0, 4));
  const medals = await db.prepare(`
    SELECT m.id, m.month, m.place, m.user_id, m.title, u.first_name, u.username
    FROM medals m LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.month DESC, m.place ASC LIMIT 60
  `).all();
  res.json({
    month, year, bot: BOT_HANDLE,
    months: monthsForYear(year).map((k) => ({ key: k, label: monthLabelEn(k), short: k.slice(5) })),
    monthLabel: monthLabelEn(month),
    previousMonth: previousMonthKey(month),
    medals: medals.map((r) => ({
      id: r.id, month: r.month, place: r.place, userId: r.user_id,
      title: r.title, name: r.first_name || '', username: r.username || '',
      url: `/api/medals/${r.id}.svg?v=4`,
    })),
  });
}));

/** Preview any month/place (admin gallery) — returns the SVG as a data URL. */
admin.post('/medals/preview', wrap(async (req, res) => {
  const b = req.body || {};
  const place = Math.min(3, Math.max(1, Math.floor(Number(b.place) || 1)));
  const month = /^\d{4}-\d{2}$/.test(String(b.month)) ? String(b.month) : monthKey();
  const svg = generateMedalSvg({ place, month });
  res.json({ svg, title: titleFor(place, month), dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
}));

/** Internal/test: mint a completed month. Current month is rejected. UI award button removed. */
admin.post('/medals/award', wrap(async (req, res) => {
  const month = String((req.body && req.body.month) || previousMonthKey());
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM', 'bad_request');
  if (month >= monthKey()) throw bad('Cannot award the current month yet', 'bad_request');
  const notifyWinners = !(req.body && req.body.notify === false);
  const result = await awardMonthMedals(month, { notifyWinners });
  res.json(result);
}));

/** Remove accidentally minted medals for a month (clears matching avatars). */
admin.delete('/medals/:month', wrap(async (req, res) => {
  const month = String(req.params.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM', 'bad_request');
  await db.prepare(`
    UPDATE users SET avatar_key = NULL
    WHERE avatar_key LIKE ?
  `).run(`medal:m-${month}-%`);
  const r = await db.prepare('DELETE FROM medals WHERE month = ?').run(month);
  await db.prepare('DELETE FROM app_settings WHERE key = ? OR key = ? OR key = ?').run(
    `medals_notified_${month}`, `medal_snapshot_${month}`, `medal_premium_${month}`,
  );
  res.json({ ok: true, deleted: r.changes || 0, month });
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
    console.error('[upload]', e && e.message ? e.message : e);
    throw bad(e.message || 'Upload failed', 'media');
  }
  // Confirm row is readable (BYTEA path) before the client attaches it to an announcement
  const stored = await db.prepare('SELECT id FROM media WHERE id = ?').get(id);
  if (!stored) throw bad('Media not found, upload it again', 'media');
  res.status(201).json({ id, kind, size: buf.length, storage: storageEnabled() });
}));

// ----- post composer: validate + send -----
function parseButtons(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 6) throw bad('Up to 6 buttons', 'buttons');
  return raw.map((b) => {
    const text = cleanText(b && b.text, 64, 'button_text', true);
    const type = b && b.type === 'invite' ? 'invite' : (b && b.type === 'app' ? 'app' : 'url');
    const color = COLORS.includes(b && b.color) ? b.color : 'default';
    if (type === 'app') {
      if (!(WEBAPP_URL || '').startsWith('https://')) throw bad('WEBAPP_URL is not configured', 'no_app_url');
      return { text, type, color };
    }
    if (type === 'invite') return { text, type, color };
    const url = String((b && b.url) || '').trim();
    if (!URL_RE.test(url)) throw bad('Button link must start with https://', 'button_url');
    return { text, type, color, url };
  });
}

async function personalizeBroadcastPost(basePost, userId) {
  const needsInvite = (basePost.buttons || []).some((b) => b.type === 'invite');
  if (!needsInvite) {
    // Keep app buttons pointing at WEBAPP_URL as-is (no URL normalization side effects)
    return {
      ...basePost,
      buttons: (basePost.buttons || []).map((b) => (
        b.type === 'app' ? { ...b, url: b.url || basePost.webAppUrl || WEBAPP_URL } : b
      )),
    };
  }
  const botUser = await getBotUsername();
  const buttons = resolveButtons(basePost.buttons, {
    webAppUrl: basePost.webAppUrl || WEBAPP_URL,
    botUsername: botUser,
    userId,
    shareText: '',
  });
  return { ...basePost, buttons };
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
    try {
      await deliver(req.user.id, await personalizeBroadcastPost(post, req.user.id));
    } catch (e) { throw bad(`Telegram refused the post: ${e.description || e.message}`, 'tg_error'); }
    return res.json({ test: true, sent: 1 });
  }

  if (broadcasting) throw new HttpError(409, 'A broadcast is already running', 'busy');
  const targets = lang === 'all'
    ? await db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0 AND id < 9000000000000').all()
    : await db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0 AND id < 9000000000000 AND lang = ?').all(lang);
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
      try {
        await deliver(t.id, await personalizeBroadcastPost(post, t.id));
        sent++;
      } catch (e) {
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
  const limit = Math.min(50, Math.max(8, Number(req.query.limit) || 8));
  res.json({
    busy: broadcasting,
    broadcasts: await db.prepare(`
      SELECT id, text, media_id, lang, total, sent, failed, status, created_at
      FROM broadcasts ORDER BY id DESC LIMIT ?
    `).all(limit),
  });
}));

/** Full stats: Telegram chat broadcasts + Mini App in-app notification campaigns. */
admin.get('/message-stats', wrap(async (req, res) => {
  const tgTotals = await db.prepare(`
    SELECT
      COUNT(*)::int AS campaigns,
      COALESCE(SUM(total), 0)::int AS targeted,
      COALESCE(SUM(sent), 0)::int AS sent,
      COALESCE(SUM(failed), 0)::int AS failed
    FROM broadcasts
  `).get();
  const tg7 = await db.prepare(`
    SELECT
      COUNT(*)::int AS campaigns,
      COALESCE(SUM(sent), 0)::int AS sent,
      COALESCE(SUM(failed), 0)::int AS failed
    FROM broadcasts WHERE created_at >= now() - interval '7 days'
  `).get();
  const tg30 = await db.prepare(`
    SELECT
      COUNT(*)::int AS campaigns,
      COALESCE(SUM(sent), 0)::int AS sent,
      COALESCE(SUM(failed), 0)::int AS failed
    FROM broadcasts WHERE created_at >= now() - interval '30 days'
  `).get();
  const tgRecent = await db.prepare(`
    SELECT id, text, lang, total, sent, failed, status, created_at
    FROM broadcasts ORDER BY id DESC LIMIT 40
  `).all();

  const appTotals = await db.prepare(`
    SELECT
      COUNT(*)::int AS campaigns,
      COALESCE(SUM(sent_count), 0)::int AS sent
    FROM notification_campaigns
  `).get();
  const app7 = await db.prepare(`
    SELECT COUNT(*)::int AS campaigns, COALESCE(SUM(sent_count), 0)::int AS sent
    FROM notification_campaigns WHERE created_at >= now() - interval '7 days'
  `).get();
  const app30 = await db.prepare(`
    SELECT COUNT(*)::int AS campaigns, COALESCE(SUM(sent_count), 0)::int AS sent
    FROM notification_campaigns WHERE created_at >= now() - interval '30 days'
  `).get();
  const appReads = await db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'admin')::int AS copies,
      COUNT(*) FILTER (WHERE kind = 'admin' AND read_at IS NOT NULL)::int AS read,
      COUNT(*) FILTER (WHERE kind = 'admin' AND read_at IS NULL AND (expires_at IS NULL OR expires_at > now()))::int AS unread_active
    FROM notifications
  `).get();
  const appRecent = await db.prepare(`
    SELECT c.id, c.title, c.body, c.expires_at, c.sent_count, c.created_at, c.updated_at,
      (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.read_at IS NOT NULL) AS read_count
    FROM notification_campaigns c
    ORDER BY c.created_at DESC LIMIT 40
  `).all();

  res.json({
    telegram: {
      campaigns: tgTotals?.campaigns || 0,
      targeted: tgTotals?.targeted || 0,
      sent: tgTotals?.sent || 0,
      failed: tgTotals?.failed || 0,
      last7d: { campaigns: tg7?.campaigns || 0, sent: tg7?.sent || 0, failed: tg7?.failed || 0 },
      last30d: { campaigns: tg30?.campaigns || 0, sent: tg30?.sent || 0, failed: tg30?.failed || 0 },
      recent: tgRecent.map((r) => ({
        id: r.id,
        text: r.text || '',
        lang: r.lang,
        total: Number(r.total || 0),
        sent: Number(r.sent || 0),
        failed: Number(r.failed || 0),
        status: r.status,
        createdAt: r.created_at,
      })),
    },
    inApp: {
      campaigns: appTotals?.campaigns || 0,
      sent: appTotals?.sent || 0,
      copies: appReads?.copies || 0,
      read: appReads?.read || 0,
      unreadActive: appReads?.unread_active || 0,
      last7d: { campaigns: app7?.campaigns || 0, sent: app7?.sent || 0 },
      last30d: { campaigns: app30?.campaigns || 0, sent: app30?.sent || 0 },
      recent: appRecent.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body || '',
        sentCount: Number(r.sent_count || 0),
        readCount: Number(r.read_count || 0),
        expiresAt: r.expires_at || null,
        permanent: !r.expires_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    },
  });
}));

admin.get('/announcements', wrap(async (req, res) => {
  await purgeExpiredAnnouncements();
  const board = parseAnnBoard(req.query.board);
  const rows = await db.prepare('SELECT * FROM announcements WHERE board = ? ORDER BY id DESC LIMIT 40').all(board);
  res.json({
    announcements: rows.map(publicAnnouncement),
    board,
    fonts: ANN_FONTS,
    pages: ANN_PAGES,
    nowTashkent: formatTashkent(new Date()),
  });
}));

admin.post('/announcements', wrap(async (req, res) => {
  const p = parseAnnouncementBody(req.body || {});
  const board = parseAnnBoard(req.body && req.body.board);
  if (p.mediaId) {
    const m = await db.prepare('SELECT id FROM media WHERE id = ?').get(p.mediaId);
    if (!m) throw bad('Media not found, upload it again', 'media');
  }
  const info = await db.prepare(`
    INSERT INTO announcements (
      admin_id, title, body, title_color, body_color, bg_from, bg_to,
      font_family, font_size, media_id, link_type, link_url, link_page, ends_at, board
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).run(
    req.user.id, p.title, p.body, p.titleColor, p.bodyColor, p.bgFrom, p.bgTo,
    p.fontFamily, p.fontSize, p.mediaId, p.linkType, p.linkUrl, p.linkPage, p.endsAt, board,
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
const tournaments = require('./tournaments').create({
  getGame, finish, claimFlagIfNeeded, pushGame, person, realtime, notify,
  getShopSettings, ledgerDiamonds, tashkentDateKey, invalidateUserCache,
  HttpError, bad, wrap, cleanText, isPremiumActive, isAdmin,
});
tournaments.register(api);
const housebots = require('./housebots').create({ getSetting, setSetting, realtime, port: PORT, botToken: BOT_TOKEN, finish, getGame, pushGame, cacheDel });
housebots.register(admin, { wrap });
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
realtime.attach(server, BOT_TOKEN, {
  getUser: (id) => getUser.get(id),
  touch: (id) => refreshPresence(id),
  leave: (id) => {
    realtime.clearRest(id);
    lastPresenceWrite.delete(id);
    clearPresent.run(id).catch(() => {});
  },
});

/** Keep Telegram long-polling alive across transient network / API errors. */
async function runBotForever() {
  if (process.env.DISABLE_BOT === '1') return;
  if (!(WEBAPP_URL || '').startsWith('https://')) {
    console.warn('[bot] WEBAPP_URL must be an https:// URL for the Open button to work.');
  }
  let delayMs = 1_000;
  for (;;) {
    try {
      await bot.start({
        onStart: async (me) => {
          botUsername = botUsername || me.username;
          console.log(`[bot] @${me.username} started`);
          delayMs = 1_000;
          try { await setupMenu(bot, WEBAPP_URL); } catch (e) {
            console.error('[bot] setupMenu:', e.message);
          }
        },
      });
      console.warn('[bot] polling stopped; restarting…');
    } catch (e) {
      console.error('[bot] failed:', e && e.message ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 2, 60_000);
  }
}

async function boot() {
  await db.ready; // tables exist before anybody connects
  // Bind all interfaces so Render's proxy can reach the process
  server.listen(PORT, '0.0.0.0', () => console.log(`[server] listening on 0.0.0.0:${PORT}`));

  // Old-design medals are redrawn with the approved artwork (month + year only differ)
  try {
    const old = await db.prepare("SELECT id, month, place FROM medals WHERE svg NOT LIKE '%data-medal=\"4\"%'").all();
    for (const r of old) await db.prepare('UPDATE medals SET svg = ? WHERE id = ?').run(generateMedalSvg({ place: r.place, month: r.month }), r.id);
    if (old.length) console.log(`[medals] redrawn: ${old.length}`);
  } catch (e) { console.error('[medals] redraw', e.message || e); }

  housebots.start();
  runBotForever().catch((e) => console.error('[bot] loop died:', e && e.message ? e.message : e));
  startScheduler(
    async (id) => pushGame(await getGame.get(id)),
    () => runMonthlyMedalAwards(),
  );

  // Expire unanswered challenges and claim live-clock flags (~2.5k: 4s tick, capped batches)
  let sweeping = false;
  const SWEEP_MS = Math.max(2_000, Number(process.env.SWEEPER_MS || 4_000));
  setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const g of await db.prepare("SELECT * FROM games WHERE status = 'invited' ORDER BY updated_at ASC LIMIT 80").all()) {
        if (!inviteExpired(g)) continue;
        await dropInvites(g);
        await db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ? AND status = 'invited'").run(g.id);
        await pushGame(await getGame.get(g.id));
      }
      for (const g of await db.prepare("SELECT * FROM games WHERE status = 'active' AND white_ms IS NOT NULL ORDER BY updated_at ASC LIMIT 120").all()) {
        const next = await claimFlagIfNeeded(g);
        if (next.status !== 'active') await pushGame(next);
      }
      // Direct messages are kept for 60 days only
      await purgeOldDms();
      await tournaments.tick();
    } catch (e) { console.error('[sweeper]', e.message); } finally { sweeping = false; }
  }, SWEEP_MS).unref();
}
boot().catch((e) => { console.error('[boot] cannot start:', e.message); process.exit(1); });

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  // Let Render restart a wedged process
  setTimeout(() => process.exit(1), 250).unref?.();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}, shutting down…`);
  bot.stop().catch(() => {});
  server.close(() => {
    db.close().catch(() => {}).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8_000).unref?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
