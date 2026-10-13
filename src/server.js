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
const { applyMove, turnOf } = require('./game');
const { sendPost, COLORS } = require('./posts');
const { createBot, setupMenu } = require('./bot');
const { startScheduler } = require('./scheduler');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'));
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const THEMES = ['dark', 'light'];
const REACTIONS = ['👍', '😀', '😮', '😢', '🔥', '👏', '🤔', '😎', '🎉', '🙈'];
const MAX_OPEN_GAMES = 10;
// A challenge is only shown inside the app (no chat message). It stays valid this long; the popup itself shows for 10 s
const POPUP_MS = 10_000;
const INVITE_TTL_MS = Number(process.env.INVITE_TTL_MS || 30_000);
const SQUARE = /^[a-h][1-8]$/;

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
      "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self'; " +
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
    last_seen = datetime('now')
`);
const touchUser = db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?");
const nameOf = db.prepare('SELECT first_name, username FROM users WHERE id = ?');

function person(id) {
  if (!id) return null;
  const u = nameOf.get(id) || {};
  return { id, name: u.first_name || 'Player', username: u.username || '', online: realtime.isOnline(id) };
}

const publicUser = (u, admin) => ({
  id: u.id, firstName: u.first_name, username: u.username, lang: u.lang, theme: u.theme,
  langSet: !!u.lang_set, notifyEnabled: !!u.notify_enabled, discoverable: !!u.discoverable, isAdmin: admin,
});

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

// ---------- auth + light rate limit ----------
const hits = new Map(); // userId -> requests in the current minute
setInterval(() => hits.clear(), 60_000).unref();

function auth(req, res, next) {
  const tg = validateInitData(req.get('X-Init-Data'), BOT_TOKEN);
  if (!tg) return res.status(401).json({ error: 'Open this app from Telegram', code: 'auth' });

  const n = (hits.get(tg.id) || 0) + 1;
  hits.set(tg.id, n);
  if (n > 300) return res.status(429).json({ error: 'Too many requests', code: 'limit' });

  upsertUser.run(tg.id, tg.first_name || '', tg.username || '', fromTelegram(tg.language_code));
  const user = getUser.get(tg.id);
  if (user.blocked) return res.status(403).json({ error: 'Your access has been disabled', code: 'blocked' });

  realtime.markRest(user.id);
  req.user = user;
  req.isAdmin = isAdmin(user.id);
  next();
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
    COALESCE(SUM(outcome = 'win'), 0) w, COALESCE(SUM(outcome = 'draw'), 0) d, COALESCE(SUM(outcome = 'loss'), 0) l,
    COALESCE(MAX(CASE WHEN outcome = 'win' THEN level END), 0) best
  FROM results WHERE user_id = ?
`);
const friendCount = db.prepare('SELECT COUNT(*) n FROM friends WHERE user_id = ?');

const statsFor = (uid) => ({
  online: onlineStats.get({ u: uid }),
  ai: aiStats.get(uid),
  friends: friendCount.get(uid).n,
});

// ---------- profile ----------
api.get('/me', wrap(async (req, res) => {
  res.json({
    user: publicUser(req.user, req.isAdmin),
    stats: statsFor(req.user.id),
    meta: { LANGS, THEMES, COLORS, REACTIONS, botUsername: await getBotUsername() },
  });
}));

api.patch('/me', wrap((req, res) => {
  const b = req.body || {};
  const u = req.user;
  const lang = b.lang === undefined ? u.lang : b.lang;
  if (!LANGS.includes(lang)) throw bad('Unsupported language', 'bad_request');
  const theme = b.theme === undefined ? u.theme : b.theme;
  if (!THEMES.includes(theme)) throw bad('Unsupported theme', 'bad_request');
  const notifyEnabled = b.notifyEnabled === undefined ? u.notify_enabled : b.notifyEnabled ? 1 : 0;
  const discoverable = b.discoverable === undefined ? u.discoverable : b.discoverable ? 1 : 0;
  db.prepare('UPDATE users SET lang = ?, theme = ?, notify_enabled = ?, discoverable = ?, lang_set = ? WHERE id = ?')
    .run(lang, theme, notifyEnabled, discoverable, b.lang !== undefined ? 1 : u.lang_set, u.id);
  res.json({ user: publicUser(getUser.get(u.id), req.isAdmin) });
}));

api.delete('/me', wrap((req, res) => {
  if (req.isAdmin) throw bad('Admins cannot delete their account here', 'admin_delete');
  const uid = req.user.id;
  // Close the games this user is part of so nobody is left waiting for them
  for (const g of db.prepare("SELECT * FROM games WHERE status = 'active' AND (white_id = ? OR black_id = ?)").all(uid, uid)) {
    const result = g.white_id === uid ? '0-1' : '1-0';
    db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'resign', updated_at = datetime('now') WHERE id = ?").run(result, g.id);
    pushGame(getGame.get(g.id));
  }
  db.prepare("UPDATE games SET status = 'cancelled' WHERE status IN ('open', 'invited') AND (creator_id = ? OR invited_id = ?)").run(uid, uid);
  db.prepare('DELETE FROM game_invites WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid); // friends and results cascade
  res.json({ ok: true });
}));

// Fallback heartbeat for clients without a working websocket (auth already marks the user online)
api.post('/ping', wrap((req, res) => res.json({ ok: true })));

// ---------- games ----------
const getGame = db.prepare('SELECT * FROM games WHERE id = ?');

function gameFor(row, uid, full = true) {
  const moves = JSON.parse(row.moves);
  const you = row.white_id === uid ? 'w' : row.black_id === uid ? 'b' : null;
  const opponentId = [row.creator_id, row.invited_id, row.white_id, row.black_id].find((x) => x && x !== uid) || null;
  const g = {
    id: row.id, status: row.status, mode: row.mode, you, creator: row.creator_id, invitedId: row.invited_id,
    white: person(row.white_id), black: person(row.black_id), opponent: person(opponentId),
    ply: moves.length, turn: turnOf(moves), result: row.result, reason: row.reason,
    drawBy: row.draw_by, updatedAt: row.updated_at,
  };
  if (row.status === 'invited' && row.creator_id === uid) g.invitees = invitesOf(row.id).map(person);
  if (full) g.moves = moves;
  return g;
}

const inviteExpired = (row) => row.status === 'invited'
  && Date.now() - Date.parse(`${row.updated_at.replace(' ', 'T')}Z`) > INVITE_TTL_MS;
const invitesOf = (id) => db.prepare('SELECT user_id FROM game_invites WHERE game_id = ?').all(id).map((r) => r.user_id);
const isInvitee = (row, uid) => row.status === 'invited' && invitesOf(row.id).includes(uid);
const participants = (row) => [...new Set([row.creator_id, row.white_id, row.black_id,
  ...(row.status === 'invited' ? invitesOf(row.id) : [row.invited_id])].filter(Boolean))];
/** Tell everyone who was asked that the request is gone (accepted by someone else, cancelled or expired) */
function dropInvites(row, exceptId) {
  for (const id of invitesOf(row.id)) if (id !== exceptId) realtime.send(id, { t: 'invite_gone', id: row.id });
  db.prepare('DELETE FROM game_invites WHERE game_id = ?').run(row.id);
}
const isParticipant = (row, uid) => participants(row).includes(uid);

/** Push the current state of a game to everyone in it (over their websocket). */
function pushGame(row) {
  if (!row) return;
  for (const id of participants(row)) realtime.send(id, { t: 'game', game: gameFor(row, id) });
}

function loadGame(id, uid) {
  const row = getGame.get(String(id));
  if (!row || !isParticipant(row, uid)) throw new HttpError(404, 'Game not found', 'notfound');
  return row;
}

const countOpen = db.prepare(`
  SELECT COUNT(*) n FROM games
  WHERE status IN ('open', 'invited', 'active') AND (creator_id = :u OR white_id = :u OR black_id = :u)
`);
const ensureRoom = (uid) => { if (countOpen.get({ u: uid }).n >= MAX_OPEN_GAMES) throw bad('Too many games', 'too_many_games'); };

const makeFriends = db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)');
const befriend = (a, b) => { makeFriends.run(a, b); makeFriends.run(b, a); };
const areFriends = (a, b) => !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);

/** Seat the joiner next to the creator (random colours) and start the game. */
function startGame(row, joinerId) {
  const creatorWhite = Math.random() < 0.5;
  db.prepare(`UPDATE games SET status = 'active', white_id = ?, black_id = ?, invited_id = ?,
    updated_at = datetime('now'), last_move_at = datetime('now') WHERE id = ?`)
    .run(creatorWhite ? row.creator_id : joinerId, creatorWhite ? joinerId : row.creator_id, joinerId, row.id);
  if (row.mode === 'friend') befriend(row.creator_id, joinerId); // playing through an invite makes you friends
  dropInvites(row, joinerId); // the others are told that someone was faster
  const next = getGame.get(row.id);
  pushGame(next);
  if (!realtime.isOnline(row.creator_id)) {
    const joiner = person(joinerId).name;
    notify.toUser(row.creator_id, (T) => T.accepted(joiner), { gameId: row.id });
  }
  return next;
}

// Online match-making: pair with someone who is waiting right now, otherwise wait
api.post('/games/quick', wrap((req, res) => {
  const uid = req.user.id;
  const waiting = db.prepare("SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND creator_id != ? ORDER BY created_at LIMIT 20").all(uid)
    .find((g) => realtime.isOnline(g.creator_id));
  if (waiting) return res.json({ game: gameFor(startGame(waiting, uid), uid) });

  const mine = db.prepare("SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND creator_id = ? LIMIT 1").get(uid);
  if (mine) return res.json({ game: gameFor(mine, uid) });

  ensureRoom(uid);
  const id = gameId();
  db.prepare("INSERT INTO games (id, creator_id, status, mode) VALUES (?, ?, 'open', 'online')").run(id, uid);
  res.status(201).json({ game: gameFor(getGame.get(id), uid) });
}));

// Create a game: with opponentIds = challenge sent to several online players (first to accept plays),
// without = open game anyone with the link can join
api.post('/games', wrap((req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  const wanted = [...new Set((Array.isArray(b.opponentIds) ? b.opponentIds : b.opponentId != null ? [b.opponentId] : []).map(intParam))].slice(0, 10);
  ensureRoom(uid);

  if (!wanted.length) {
    const id = gameId();
    db.prepare("INSERT INTO games (id, creator_id, status, mode) VALUES (?, ?, 'open', 'friend')").run(id, uid);
    return res.status(201).json({ game: gameFor(getGame.get(id), uid) });
  }

  let failure = null; const targets = [];
  for (const opp of wanted) {
    const other = getUser.get(opp);
    if (opp === uid || !other || other.blocked) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    if (!realtime.isOnline(opp)) { failure = new HttpError(409, 'Player is offline', 'user_offline'); continue; }
    if (!areFriends(uid, opp) && !other.discoverable) { failure = failure || new HttpError(404, 'Player not found', 'user_unavailable'); continue; }
    targets.push(opp);
  }
  if (!targets.length) throw failure;

  // Sending the same request twice must not spam anyone: return the one that is already waiting
  const existing = db.prepare("SELECT * FROM games WHERE status = 'invited' AND creator_id = ?").get(uid);
  if (existing) {
    const same = !inviteExpired(existing) && invitesOf(existing.id).sort().join() === [...targets].sort().join();
    if (same) return res.json({ game: gameFor(existing, uid) });
    dropInvites(existing);
    db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(existing.id);
  }

  const id = gameId();
  const friend = targets.length === 1 && areFriends(uid, targets[0]);
  db.prepare("INSERT INTO games (id, creator_id, invited_id, status, mode) VALUES (?, ?, ?, 'invited', ?)")
    .run(id, uid, targets[0], friend ? 'friend' : 'online');
  for (const t of targets) db.prepare('INSERT INTO game_invites (game_id, user_id) VALUES (?, ?)').run(id, t);
  const row = getGame.get(id);
  for (const t of targets) realtime.send(t, { t: 'invite', game: gameFor(row, t), ttl: POPUP_MS }); // in-app only
  res.status(201).json({ game: gameFor(row, uid) });
}));

api.get('/games/:id', wrap((req, res) => {
  const row = getGame.get(String(req.params.id));
  if (!row) throw new HttpError(404, 'Game not found', 'notfound');
  const uid = req.user.id;
  if (!isParticipant(row, uid)) {
    // A stranger holding the link may look at an open game in order to join it
    if (row.status !== 'open') throw new HttpError(404, 'Game not found', 'notfound');
    return res.json({ game: { id: row.id, status: 'open', joinable: true, opponent: person(row.creator_id) } });
  }
  res.json({ game: gameFor(row, uid) });
}));

api.post('/games/:id/join', wrap((req, res) => {
  const uid = req.user.id;
  const row = getGame.get(String(req.params.id));
  if (!row) throw new HttpError(404, 'Game not found', 'notfound');
  if (isParticipant(row, uid) && row.status !== 'open' && row.status !== 'invited') return res.json({ game: gameFor(row, uid) });
  if (row.creator_id === uid) return res.json({ game: gameFor(row, uid) }); // opening your own link
  if (inviteExpired(row)) { dropInvites(row); db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(row.id); pushGame(getGame.get(row.id)); throw bad('This game is no longer available', 'game_unavailable'); }
  const allowed = row.status === 'open' || isInvitee(row, uid);
  if (!allowed) throw bad('This game is no longer available', 'game_unavailable');
  ensureRoom(uid);
  res.json({ game: gameFor(startGame(row, uid), uid) });
}));

api.post('/games/:id/decline', wrap((req, res) => {
  const row = loadGame(req.params.id, req.user.id);
  if (!isInvitee(row, req.user.id)) throw bad('Nothing to decline', 'game_unavailable');
  db.prepare('DELETE FROM game_invites WHERE game_id = ? AND user_id = ?').run(row.id, req.user.id);
  if (!invitesOf(row.id).length) { // everybody said no
    db.prepare("UPDATE games SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(row.id);
    pushGame(getGame.get(row.id));
  }
  res.json({ ok: true });
}));

// Leave a game that has not started yet (cancel an invitation or stop searching)
api.delete('/games/:id', wrap((req, res) => {
  const row = loadGame(req.params.id, req.user.id);
  if (row.creator_id !== req.user.id || !['open', 'invited'].includes(row.status)) throw bad('Cannot cancel', 'game_unavailable');
  dropInvites(row);
  db.prepare("UPDATE games SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(row.id);
  pushGame(getGame.get(row.id));
  res.json({ ok: true });
}));

function finish(row, result, reason) {
  db.prepare("UPDATE games SET status = 'finished', result = ?, reason = ?, draw_by = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(result, reason, row.id);
  const next = getGame.get(row.id);
  pushGame(next);

  // Players who are not looking at the app get the result in Telegram
  const w = row.white_id, b = row.black_id;
  const wName = person(w).name, bName = person(b).name;
  const tell = (id, other, won) => {
    if (realtime.isOnline(id)) return;
    notify.toUser(id, (T) => (result === '1/2-1/2' ? T.draw(other) : won ? T.win(other) : T.loss(other)), { gameId: row.id, effect: won ? 'party' : undefined });
  };
  tell(w, bName, result === '1-0');
  tell(b, wName, result === '0-1');
  return next;
}

function activeGame(id, uid) {
  const row = loadGame(id, uid);
  if (row.status !== 'active') throw bad('The game is over', 'game_over');
  return { row, colour: row.white_id === uid ? 'w' : 'b' };
}

api.post('/games/:id/move', wrap((req, res) => {
  const uid = req.user.id;
  const { row, colour } = activeGame(req.params.id, uid);
  const { from, to, promotion } = req.body || {};
  if (!SQUARE.test(from) || !SQUARE.test(to)) throw bad('Illegal move', 'illegal_move');
  const moves = JSON.parse(row.moves);
  if (turnOf(moves) !== colour) throw bad('Not your turn', 'not_your_turn');

  const r = applyMove(moves, from, to, promotion);
  const ply = r.moves.length;
  db.prepare(`UPDATE games SET moves = ?, draw_by = NULL, updated_at = datetime('now'), last_move_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(r.moves), row.id);

  let next;
  if (r.over) {
    next = finish(row, r.result, r.reason);
  } else {
    next = getGame.get(row.id);
    pushGame(next);
    const other = colour === 'w' ? row.black_id : row.white_id;
    if (!realtime.isOnline(other) && row.notified_ply < ply) {
      db.prepare('UPDATE games SET notified_ply = ? WHERE id = ?').run(ply, row.id);
      const me = person(uid).name;
      notify.toUser(other, (T) => T.yourMove(me), { gameId: row.id });
    }
  }
  res.json({ game: gameFor(next, uid) });
}));

api.post('/games/:id/resign', wrap((req, res) => {
  const { row, colour } = activeGame(req.params.id, req.user.id);
  res.json({ game: gameFor(finish(row, colour === 'w' ? '0-1' : '1-0', 'resign'), req.user.id) });
}));

api.post('/games/:id/draw', wrap((req, res) => {
  const uid = req.user.id;
  const { row, colour } = activeGame(req.params.id, uid);
  const action = req.body && req.body.action;
  const other = colour === 'w' ? row.black_id : row.white_id;

  if (action === 'offer') {
    if (row.draw_by === colour) return res.json({ game: gameFor(row, uid) });
    db.prepare("UPDATE games SET draw_by = ?, updated_at = datetime('now') WHERE id = ?").run(colour, row.id);
    pushGame(getGame.get(row.id));
    if (!realtime.isOnline(other)) { const me = person(uid).name; notify.toUser(other, (T) => T.drawOffer(me), { gameId: row.id }); }
  } else if (action === 'accept') {
    if (row.draw_by && row.draw_by !== colour) return res.json({ game: gameFor(finish(row, '1/2-1/2', 'agreement'), uid) });
    throw bad('No draw offer', 'bad_request');
  } else if (action === 'decline') {
    db.prepare("UPDATE games SET draw_by = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
    pushGame(getGame.get(row.id));
  } else throw bad('Unknown action', 'bad_request');
  res.json({ game: gameFor(getGame.get(row.id), uid) });
}));

// Emoji reactions travel straight to the opponent's screen and are not stored
const lastReact = new Map();
api.post('/games/:id/react', wrap((req, res) => {
  const uid = req.user.id;
  const row = loadGame(req.params.id, uid);
  const emoji = req.body && req.body.emoji;
  if (!REACTIONS.includes(emoji)) throw bad('Unknown reaction', 'bad_request');
  const now = Date.now();
  if (now - (lastReact.get(uid) || 0) < 500) return res.json({ ok: true }); // flood guard
  lastReact.set(uid, now);
  for (const id of participants(row)) if (id !== uid) realtime.send(id, { t: 'react', id: row.id, emoji, by: uid });
  res.json({ ok: true });
}));

// ---------- computer games (played in the browser, only the result is reported) ----------
const lastResult = new Map();
api.post('/results', wrap((req, res) => {
  const { level, outcome } = req.body || {};
  if (![1, 2, 3, 4].includes(level) || !['win', 'draw', 'loss'].includes(outcome)) throw bad('Bad result', 'bad_request');
  const now = Date.now();
  if (now - (lastResult.get(req.user.id) || 0) > 10_000) { // a real game takes longer than 10 seconds
    lastResult.set(req.user.id, now);
    db.prepare('INSERT INTO results (user_id, level, outcome) VALUES (?, ?, ?)').run(req.user.id, level, outcome);
  }
  res.json({ stats: statsFor(req.user.id) });
}));

// ---------- lobby: who is online and what games do I have ----------
api.get('/lobby', wrap((req, res) => {
  const uid = req.user.id;
  const ids = realtime.onlineIds();
  const friendIds = new Set(db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(uid).map((r) => r.friend_id));

  const mine = db.prepare(`
    SELECT * FROM games WHERE status IN ('open', 'invited', 'active')
      AND (creator_id = :u OR white_id = :u OR black_id = :u OR invited_id = :u
        OR id IN (SELECT game_id FROM game_invites WHERE user_id = :u)) ORDER BY updated_at DESC LIMIT 30
  `).all({ u: uid });
  const busy = new Set(db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all().flatMap((g) => [g.white_id, g.black_id]));

  let online = [];
  if (ids.length) {
    const cap = ids.slice(0, 500);
    const rows = db.prepare(`SELECT id, first_name, discoverable FROM users WHERE blocked = 0 AND id != ? AND id IN (${cap.map(() => '?').join(',')})`).all(uid, ...cap);
    online = rows
      .filter((r) => r.discoverable || friendIds.has(r.id))
      .map((r) => ({ id: r.id, name: r.first_name || 'Player', inGame: busy.has(r.id), friend: friendIds.has(r.id) }))
      .sort((a, b) => (b.friend - a.friend) || a.name.localeCompare(b.name))
      .slice(0, 40);
  }

  const recent = db.prepare(`
    SELECT * FROM games WHERE status = 'finished' AND (white_id = :u OR black_id = :u) ORDER BY updated_at DESC LIMIT 8
  `).all({ u: uid });

  res.json({
    onlineCount: ids.length,
    online,
    games: {
      active: mine.filter((g) => g.status === 'active').map((g) => gameFor(g, uid, false)),
      invites: mine.filter((g) => g.status === 'invited' && g.creator_id !== uid && !inviteExpired(g)).map((g) => gameFor(g, uid, false)),
      waiting: mine.filter((g) => ['open', 'invited'].includes(g.status) && g.creator_id === uid).map((g) => gameFor(g, uid, false)),
      recent: recent.map((g) => gameFor(g, uid, false)),
    },
    stats: statsFor(uid),
  });
}));

// ---------- friends ----------
api.get('/friends', wrap((req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`
    SELECT u.id, u.first_name FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.first_name
  `).all(uid);
  const busy = new Set(db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all().flatMap((g) => [g.white_id, g.black_id]));
  const pending = new Set(db.prepare("SELECT i.user_id FROM game_invites i JOIN games g ON g.id = i.game_id WHERE g.status = 'invited' AND g.creator_id = ?").all(uid).map((r) => r.user_id));
  res.json({
    friends: rows.map((r) => ({
      id: r.id, name: r.first_name || 'Player', online: realtime.isOnline(r.id), inGame: busy.has(r.id), invited: pending.has(r.id),
    })).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)),
  });
}));

// Called when someone opens a friend-invite link (t.me/<bot>?start=i<inviterId>)
api.post('/friends/join', wrap((req, res) => {
  const uid = req.user.id;
  const other = intParam(req.body && req.body.userId);
  const u = getUser.get(other);
  if (other === uid || !u || u.blocked) throw new HttpError(404, 'Player not found', 'user_unavailable');
  const already = areFriends(uid, other);
  befriend(uid, other);
  if (!already) {
    const me = person(uid).name;
    realtime.send(other, { t: 'friend', id: uid });
    notify.toUser(other, (T) => T.friendJoined(me));
  }
  res.json({ friend: person(other), already });
}));

api.delete('/friends/:id', wrap((req, res) => {
  const other = intParam(req.params.id);
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(req.user.id, other, other, req.user.id);
  res.json({ ok: true });
}));

// ---------- admin ----------
const admin = express.Router();
admin.use((req, res, next) => (req.isAdmin ? next() : res.status(404).json({ error: 'Not found', code: 'notfound' }))); // do not reveal the panel

const one = (sql, ...p) => db.prepare(sql).get(...p).n;

admin.get('/stats', wrap((req, res) => {
  const signups = db.prepare("SELECT date(created_at) d, COUNT(*) c FROM users WHERE date(created_at) >= date('now', '-13 days') GROUP BY d").all();
  const map = Object.fromEntries(signups.map((r) => [r.d, r.c]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: map[d] || 0 };
  });
  res.json({
    users: one('SELECT COUNT(*) n FROM users'),
    live: realtime.onlineIds().length,
    newToday: one("SELECT COUNT(*) n FROM users WHERE date(created_at) = date('now')"),
    active7d: one("SELECT COUNT(*) n FROM users WHERE last_seen >= datetime('now', '-7 days')"),
    blocked: one('SELECT COUNT(*) n FROM users WHERE blocked = 1'),
    unreachable: one('SELECT COUNT(*) n FROM users WHERE bot_blocked = 1'),
    gamesLive: one("SELECT COUNT(*) n FROM games WHERE status = 'active'"),
    gamesPlayed: one("SELECT COUNT(*) n FROM games WHERE status = 'finished'"),
    byLang: db.prepare('SELECT lang, COUNT(*) c FROM users GROUP BY lang').all(),
    signups: days,
  });
}));

// Everyone who has the app open right now
admin.get('/live', wrap((req, res) => {
  const ids = realtime.onlineIds().slice(0, 500);
  if (!ids.length) return res.json({ count: 0, users: [] });
  const rows = db.prepare(`SELECT id, first_name, username, lang FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const busy = new Set(db.prepare("SELECT white_id, black_id FROM games WHERE status = 'active'").all().flatMap((g) => [g.white_id, g.black_id]));
  res.json({
    count: ids.length,
    users: rows.map((u) => ({ id: u.id, name: u.first_name || 'Player', username: u.username, lang: u.lang, inGame: busy.has(u.id), isAdmin: isAdmin(u.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

admin.get('/users', wrap((req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db.prepare(`
    SELECT u.id, u.first_name, u.username, u.lang, u.blocked, u.bot_blocked, u.created_at, u.last_seen,
      (SELECT COUNT(*) FROM games g WHERE g.status = 'finished' AND (g.white_id = u.id OR g.black_id = u.id)) games
    FROM users u
    WHERE ? = '' OR u.first_name LIKE ? OR u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?
    ORDER BY u.last_seen DESC LIMIT 100
  `).all(q, like, like, like);
  res.json({ users: rows.map((u) => ({ ...u, online: realtime.isOnline(u.id), isAdmin: isAdmin(u.id) })) });
}));

admin.post('/users/:id/block', wrap((req, res) => {
  const id = intParam(req.params.id);
  if (isAdmin(id)) throw bad('Admins cannot be blocked', 'admin_block');
  const blocked = req.body && req.body.blocked ? 1 : 0;
  if (!db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked, id).changes) throw new HttpError(404, 'User not found', 'notfound');
  res.json({ ok: true, blocked: !!blocked });
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

admin.post('/upload', express.raw({ type: () => true, limit: '26mb' }), wrap((req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No file received', 'media');
  const mime = sniff(buf);
  if (!mime) throw bad('Use JPG, PNG, GIF or MP4', 'media_type');
  const kind = KIND[mime];
  if (buf.length > (kind === 'photo' ? MAX_PHOTO : MAX_VIDEO)) throw bad('File is too large', 'media_big');
  const id = crypto.randomUUID();
  const file = path.join(MEDIA_DIR, `${id}.${EXT[mime]}`);
  fs.writeFileSync(file, buf);
  db.prepare('INSERT INTO media (id, kind, path, size, admin_id) VALUES (?, ?, ?, ?, ?)').run(id, kind, file, buf.length, req.user.id);
  res.status(201).json({ id, kind, size: buf.length });
}));

// ----- post composer: validate + send -----
const URL_RE = /^(https?:\/\/[^\s]{3,500}|tg:\/\/[^\s]{3,200})$/i;

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
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(String(b.mediaId));
    if (!row || !fs.existsSync(row.path)) throw bad('Media not found, upload it again', 'media');
    media = { id: row.id, kind: row.kind, path: row.path, fileId: row.file_id || null };
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
    ? db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0').all()
    : db.prepare('SELECT id FROM users WHERE blocked = 0 AND bot_blocked = 0 AND lang = ?').all(lang);
  const info = db.prepare('INSERT INTO broadcasts (admin_id, text, media_id, lang, total) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, text, media ? media.id : null, lang, targets.length);
  const bid = Number(info.lastInsertRowid);
  broadcasting = true;
  res.json({ id: bid, queued: targets.length });

  // Send in the background at ~20 messages/second (Telegram allows ~30)
  (async () => {
    let sent = 0, failed = 0;
    const save = () => db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, bid);
    for (const t of targets) {
      try { await deliver(t.id, post); sent++; } catch (e) {
        failed++;
        if (e.error_code === 403) db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?').run(t.id);
      }
      if ((sent + failed) % 10 === 0) save();
      await sleep(50);
    }
    save();
    db.prepare("UPDATE broadcasts SET status = 'done' WHERE id = ?").run(bid);
    broadcasting = false;
    console.log(`[broadcast ${bid}] sent=${sent} failed=${failed}`);
    for (const a of ADMIN_IDS) bot.api.sendMessage(a, `✅ Broadcast #${bid}: ${sent} delivered, ${failed} failed.`).catch(() => {});
  })().catch((e) => { broadcasting = false; console.error('[broadcast] crashed:', e); });
}));

admin.get('/broadcasts', wrap((req, res) => {
  res.json({
    busy: broadcasting,
    broadcasts: db.prepare('SELECT id, text, media_id, lang, total, sent, failed, status, created_at FROM broadcasts ORDER BY id DESC LIMIT 8').all(),
  });
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
startScheduler((id) => pushGame(getGame.get(id)));

// Expire unanswered challenges and tell the player who sent them
setInterval(() => {
  for (const g of db.prepare("SELECT * FROM games WHERE status = 'invited'").all()) {
    if (!inviteExpired(g)) continue;
    dropInvites(g);
    db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(g.id);
    pushGame(getGame.get(g.id));
  }
}, 2000).unref();

process.on('SIGTERM', () => { bot.stop().catch(() => {}); server.close(); process.exit(0); });
