// Postgres (Neon pooler recommended) access. Every call is async.
//
// db.prepare(sql) keeps the shape the rest of the code already used, but the methods return promises:
//   await db.prepare('SELECT * FROM users WHERE id = ?').get(id)     -> row | undefined
//   await db.prepare('SELECT ...').all(a, b)                         -> rows
//   await db.prepare('UPDATE ...').run(a, b)                         -> { changes, rows }
// "?" are positional parameters. ":name" parameters take a single object: .get({ name: value }).
const { Pool, types } = require('pg');

// bigint (Telegram ids, COUNT) and numeric (SUM) come back as numbers instead of strings
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Use the Neon pooled connection string (-pooler).');
  process.exit(1);
}
try { // never prints the password itself, only what is needed to spot a bad value
  const u = new URL(url.trim());
  const pw = decodeURIComponent(u.password);
  console.log(`[db] connecting as "${decodeURIComponent(u.username)}" to ${u.hostname}:${u.port || 5432}${u.pathname}; password length ${pw.length}`
    + `${/[\s\[\]]/.test(pw) ? ' (contains a space or bracket!)' : ''}${url !== url.trim() ? ' (URL has leading/trailing whitespace!)' : ''}`);
} catch { console.error('[db] DATABASE_URL is not a valid URL (special characters in the password must be %-encoded)'); }
const local = /@(localhost|127\.0\.0\.1)|host=\/|%2F/.test(url);
const neonHost = (() => {
  try { return new URL(url.trim()).hostname || ''; } catch { return ''; }
})();
const isNeon = /\.neon\.tech$/i.test(neonHost);
const isPooler = /-pooler\./i.test(neonHost);
// ~2.5k concurrent Mini App users: Neon pooled (-pooler) URL + this pool size.
if (isNeon && !isPooler && !local) {
  console.warn('[db] DATABASE_URL host has no "-pooler" — use the Neon pooled connection string for the app (direct URL is for migrations/dumps only).');
}
const pool = new Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX || 20),
  ssl: local ? false : { rejectUnauthorized: false }, // Neon / managed PG TLS
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
  allowExitOnIdle: false,
});
pool.on('error', (e) => console.error('[db] idle client error:', e.message));
console.log(`[db] pool max=${pool.options.max}${isNeon ? (isPooler ? ' (Neon pooler)' : ' (Neon direct)') : ''}`);

/** "?" and ":name" -> "$1, $2 ..."; returns the SQL and the ordered parameter list */
function compile(sql, args) {
  let i = 0;
  const values = [];
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Date) && !Buffer.isBuffer(args[0])) {
    const named = args[0]; const slots = new Map();
    const text = sql.replace(/(?<![:\w]):([a-z_][a-z0-9_]*)/gi, (_, n) => {
      if (!slots.has(n)) { values.push(named[n]); slots.set(n, values.length); }
      return `$${slots.get(n)}`;
    });
    return { text, values };
  }
  const text = sql.replace(/\?/g, () => { values.push(args[i++]); return `$${values.length}`; });
  return { text, values };
}

async function exec(client, sql, args) {
  const { text, values } = compile(sql, args);
  return client.query(text, values);
}

const db = {
  pool,
  prepare(sql) {
    return {
      async get(...args) { return (await exec(pool, sql, args)).rows[0]; },
      async all(...args) { return (await exec(pool, sql, args)).rows; },
      async run(...args) { const r = await exec(pool, sql, args); return { changes: r.rowCount, rows: r.rows }; },
    };
  },
  get: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
  async close() { await pool.end(); },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,                    -- Telegram user id
  first_name TEXT,
  username TEXT,
  lang TEXT NOT NULL DEFAULT 'en',          -- en | ru | uz | uzc
  lang_set INTEGER NOT NULL DEFAULT 0,      -- 1 once the user picked a language themselves
  theme TEXT NOT NULL DEFAULT 'dark',       -- dark | light
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  discoverable INTEGER NOT NULL DEFAULT 1,  -- appears in the "online now" list
  blocked INTEGER NOT NULL DEFAULT 0,
  bot_blocked INTEGER NOT NULL DEFAULT 0,   -- user blocked the bot (cannot DM)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friends (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

-- One row per game between two people. Moves are a JSON list of [from, to, promotion] replayed with
-- chess.js whenever the game is loaded, so the server never trusts a client.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  creator_id BIGINT NOT NULL,
  white_id BIGINT,
  black_id BIGINT,
  invited_id BIGINT,
  status TEXT NOT NULL,                     -- open | invited | active | finished | cancelled
  mode TEXT NOT NULL DEFAULT 'friend',      -- friend | online
  time_control TEXT NOT NULL DEFAULT 'classic', -- 1+0 | 3+2 | 5+0 | 10+0 | 15+10 | classic
  result TEXT,                              -- 1-0 | 0-1 | 1/2-1/2
  reason TEXT,                              -- checkmate, resign, stalemate, agreement, timeout, ...
  moves JSONB NOT NULL DEFAULT '[]'::jsonb,
  draw_by TEXT,                             -- colour that currently offers a draw
  white_ms BIGINT,                          -- remaining clock (null = untimed / classic)
  black_ms BIGINT,
  turn_started_at TIMESTAMPTZ,              -- when the side-to-move clock started
  notified_ply INTEGER NOT NULL DEFAULT -1,
  reminded_ply INTEGER NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_move_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_status_updated ON games(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_matchmaking ON games(status, mode, time_control, created_at);

-- Everyone who was asked to play a challenge game (the first to accept starts it)
CREATE TABLE IF NOT EXISTS game_invites (
  game_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_invites_user ON game_invites(user_id);

-- Finished games against the computer (played in the browser, reported by the client)
CREATE TABLE IF NOT EXISTS results (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  outcome TEXT NOT NULL,                    -- win | draw | loss
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id);

-- Media for admin posts / avatars (BYTEA on Neon).
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                       -- photo | video | animation
  mime TEXT NOT NULL,
  data BYTEA,                               -- file bytes
  size INTEGER NOT NULL,
  file_id TEXT,
  admin_id BIGINT NOT NULL,
  path TEXT DEFAULT '',                     -- legacy Supabase column (was NOT NULL)
  storage_path TEXT,                        -- legacy external object key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  media_id TEXT,
  lang TEXT NOT NULL DEFAULT 'all',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Home-page announcement banners (expire by ends_at, Tashkent-wall-clock stored as timestamptz)
CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  title_color TEXT NOT NULL DEFAULT '#ffffff',
  body_color TEXT NOT NULL DEFAULT '#fbbf24',
  bg_from TEXT NOT NULL DEFAULT '#3b82f6',
  bg_to TEXT NOT NULL DEFAULT '#6366f1',
  font_family TEXT NOT NULL DEFAULT 'system',  -- system | rounded | serif | mono
  font_size INTEGER NOT NULL DEFAULT 18,
  media_id TEXT,
  link_type TEXT NOT NULL DEFAULT 'none',     -- none | url | page
  link_url TEXT,
  link_page TEXT,                             -- play | puzzles | rankings | live | profile | premium | friends | settings
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_ends ON announcements(ends_at);

-- The API is served only by this server (service connection); do not expose tables via a public REST API
ALTER TABLE users ADD COLUMN IF NOT EXISTS diamonds BIGINT NOT NULL DEFAULT 0;   -- in-app currency
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium INTEGER NOT NULL DEFAULT 0;   -- 1 while premium_until is in the future (or legacy)
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;            -- monthly Premium expiry (UTC); null + premium=1 = legacy permanent
ALTER TABLE users ADD COLUMN IF NOT EXISTS piece_set TEXT NOT NULL DEFAULT 'cartoon';   -- cartoon | outline | classic | neo | staunton | studio (default cartoon until Premium changes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_theme TEXT NOT NULL DEFAULT 'green'; -- classic | green | wood | blue | brown | studio (default green until Premium changes)
-- One-shot switch of the old default to cartoon: runs only while the column default is still 'neo'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'piece_set' AND column_default LIKE '''neo''%') THEN
    UPDATE users SET piece_set = 'cartoon' WHERE piece_set = 'neo';
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN piece_set SET DEFAULT 'cartoon';
ALTER TABLE users ALTER COLUMN board_theme SET DEFAULT 'green';
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_ms BIGINT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_ms BIGINT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ;
ALTER TABLE media ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS data BYTEA;
ALTER TABLE media ADD COLUMN IF NOT EXISTS mime TEXT;
ALTER TABLE media ALTER COLUMN data DROP NOT NULL;
-- Restored Supabase dumps keep path NOT NULL; BYTEA-only inserts must not require Storage keys
DO $$ BEGIN
  ALTER TABLE media ALTER COLUMN path DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
ALTER TABLE media ALTER COLUMN path SET DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_bullet INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_blitz INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_rapid INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_classic INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS present_until TIMESTAMPTZ; -- live in Mini App; cleared on close
CREATE INDEX IF NOT EXISTS idx_users_present_until ON users(present_until) WHERE present_until IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT ''; -- Premium profile quote
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT; -- null = Telegram photo / letter; char:<id> = cartoon (Premium); medal:<id> = monthly medal (Premium); img:<uuid> = uploaded photo
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_photo TEXT;            -- version hash of the cached Telegram profile photo (tg_photos); null = none
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_photo_at TIMESTAMPTZ;  -- last Telegram photo check
-- Cached Telegram profile photos (small JPEG/PNG), served from /api/tg-avatars/<user id>
CREATE TABLE IF NOT EXISTS tg_photos (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  src TEXT NOT NULL DEFAULT '',             -- Bot API file_unique_id or initData photo_url (skip re-download when unchanged)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tg_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_inviter_id BIGINT REFERENCES users(id) ON DELETE SET NULL; -- set on /start i<id>; claimed in Mini App
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS board TEXT NOT NULL DEFAULT 'home'; -- home | puzzle
CREATE INDEX IF NOT EXISTS idx_announcements_board_ends ON announcements(board, ends_at);
CREATE TABLE IF NOT EXISTS profile_likes (
  from_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_likes_to ON profile_likes(to_id);
CREATE TABLE IF NOT EXISTS user_blocks (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'admin', -- admin | feedback | system
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  meta JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ; -- null = permanent
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS campaign_id UUID; -- groups broadcast copies for admin edit/delete
CREATE INDEX IF NOT EXISTS idx_notifications_campaign ON notifications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS notification_campaigns (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_id TEXT,
  expires_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created ON notification_campaigns(created_at DESC);
CREATE TABLE IF NOT EXISTS dm_threads (
  id BIGSERIAL PRIMARY KEY,
  user_a BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS idx_dm_threads_updated ON dm_threads(updated_at DESC);
CREATE TABLE IF NOT EXISTS dm_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id, created_at);
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_id BIGINT REFERENCES dm_messages(id) ON DELETE SET NULL;
-- Global lobby chat was removed; drop its leftovers.
DROP TABLE IF EXISTS global_chat_reads;
DROP TABLE IF EXISTS global_chat_messages;
-- DMs are deleted after 60 days (sweeper) — index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_dm_messages_created ON dm_messages(created_at);
-- Pending friend requests (accept / decline in notifications)
CREATE TABLE IF NOT EXISTS friend_requests (
  id BIGSERIAL PRIMARY KEY,
  from_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE (from_id, to_id),
  CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status, created_at DESC);
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
-- Daily free game-analysis claims (premium bypasses)
CREATE TABLE IF NOT EXISTS game_analysis_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  day_key TEXT NOT NULL, -- Asia/Tashkent YYYY-MM-DD
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_claims_user_day ON game_analysis_claims(user_id, day_key);
ALTER TABLE game_analysis_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ADD COLUMN IF NOT EXISTS takeback_by TEXT; -- colour that asked to take back its last move
ALTER TABLE games ADD COLUMN IF NOT EXISTS elo_w_before INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS elo_w_after INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS elo_b_before INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS elo_b_after INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS preferred_color TEXT; -- w | b | null (random) — creator preference while waiting
CREATE INDEX IF NOT EXISTS idx_games_matchmaking ON games(status, mode, time_control, created_at);
-- Allow home-screen presets (and keep legacy category values already stored)
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_time_control_check;
CREATE TABLE IF NOT EXISTS monthly_scores (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_scores_month_pts ON monthly_scores(month, points DESC);
CREATE TABLE IF NOT EXISTS medals (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  place INTEGER NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  svg TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, place)
);
CREATE INDEX IF NOT EXISTS idx_medals_user ON medals(user_id);
-- one reward payout per invited person, ever (inviter + invitee; PK blocks farming)
CREATE TABLE IF NOT EXISTS referrals (
  invitee_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Key/value shop config (Premium price, diamond packs, pay username)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE medals ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS puzzle_daily_claims (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE puzzle_daily_claims ENABLE ROW LEVEL SECURITY;
-- Diamond wallet history (purchases, referral bonuses, admin grants, spends)
CREATE TABLE IF NOT EXISTS diamond_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  kind TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diamond_ledger_user_created ON diamond_ledger(user_id, created_at DESC);
ALTER TABLE diamond_ledger ENABLE ROW LEVEL SECURITY;

-- Promo codes: diamonds or Premium (days/months); ends_at = code validity (Tashkent wall clock stored as timestamptz)
CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL,                 -- diamonds | premium_days | premium_months
  reward_amount INTEGER NOT NULL,
  max_uses INTEGER,                          -- null = unlimited
  used_count INTEGER NOT NULL DEFAULT 0,
  ends_at TIMESTAMPTZ NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_ends ON promo_codes(ends_at);
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGSERIAL PRIMARY KEY,
  promo_id BIGINT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(user_id, created_at DESC);
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
`;

const DEFAULT_DIAMOND_PACKS = JSON.stringify([
  { diamonds: 100, sum: 100000 },
  { diamonds: 200, sum: 200000 },
  { diamonds: 300, sum: 300000 },
  { diamonds: 400, sum: 400000 },
  { diamonds: 500, sum: 500000 },
  { diamonds: 1000, sum: 1000000 },
]);

const DEFAULT_PREMIUM_PLANS = JSON.stringify([
  { months: 1, diamonds: 200 },
  { months: 3, diamonds: 500 },
  { months: 6, diamonds: 900 },
  { months: 12, diamonds: 1600 },
]);

/** Creates the tables on first start and marks interrupted broadcasts. Await this before serving. */
db.ready = (async () => {
  const c = await pool.connect();
  try {
    // Transaction-scoped lock is safe on Neon pooler (PgBouncer transaction mode);
    // session pg_advisory_lock is not reliable across pooled backends.
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7301)');
    await c.query(SCHEMA);
    await c.query("UPDATE broadcasts SET status = 'interrupted' WHERE status = 'sending'");
    await c.query(
      `INSERT INTO app_settings (key, value) VALUES
         ('premium_price_diamonds', '200'),
         ('premium_plans', $1),
         ('diamond_packs', $2),
         ('pay_username', 'hasanovbobur'),
         ('medal_gen_config', $3),
         ('analysis_daily_free', '3')
       ON CONFLICT (key) DO NOTHING`,
      [DEFAULT_PREMIUM_PLANS, DEFAULT_DIAMOND_PACKS, JSON.stringify({
        botHandle: '@Chess_uz_bot',
        titleTemplate: 'Top {place} Chess player of {month}',
        primary: '#f5c542',
        secondary: '#0f172a',
        accent: '#38bdf8',
        text: '#ffffff',
        muted: '#94a3b8',
      })],
    );
    // One-time: the old default daily-puzzle reward (1) becomes 2; the marker row keeps a later admin choice of 1.
    await c.query(
      `WITH m AS (
         INSERT INTO app_settings (key, value) VALUES ('migr_puzzle_daily_reward_2', '1')
         ON CONFLICT (key) DO NOTHING RETURNING 1
       )
       UPDATE app_settings SET value = '2'
       WHERE key = 'puzzle_daily_reward' AND trim(value) = '1' AND EXISTS (SELECT 1 FROM m)`,
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
})();

module.exports = db;
