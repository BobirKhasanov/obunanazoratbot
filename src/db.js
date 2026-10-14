// Postgres (Supabase) access. Every call is async.
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
  console.error('DATABASE_URL is not set. Use the Supabase "Session pooler" connection string.');
  process.exit(1);
}
try { // never prints the password itself, only what is needed to spot a bad value
  const u = new URL(url.trim());
  const pw = decodeURIComponent(u.password);
  console.log(`[db] connecting as "${decodeURIComponent(u.username)}" to ${u.hostname}:${u.port || 5432}${u.pathname}; password length ${pw.length}`
    + `${/[\s\[\]]/.test(pw) ? ' (contains a space or bracket!)' : ''}${url !== url.trim() ? ' (URL has leading/trailing whitespace!)' : ''}`);
} catch { console.error('[db] DATABASE_URL is not a valid URL (special characters in the password must be %-encoded)'); }
const local = /@(localhost|127\.0\.0\.1)|host=\/|%2F/.test(url);
const pool = new Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX || 8),
  ssl: local ? false : { rejectUnauthorized: false }, // Supabase terminates TLS with its own CA
  idleTimeoutMillis: 30_000,
});
pool.on('error', (e) => console.error('[db] idle client error:', e.message));

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
  time_control TEXT NOT NULL DEFAULT 'classic',
  result TEXT,                              -- 1-0 | 0-1 | 1/2-1/2
  reason TEXT,                              -- checkmate, resign, stalemate, agreement, ...
  moves TEXT NOT NULL DEFAULT '[]',
  draw_by TEXT,                             -- colour that currently offers a draw
  notified_ply INTEGER NOT NULL DEFAULT -1,
  reminded_ply INTEGER NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_move_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

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

-- Media for admin posts. The bytes live in the database (kept 7 days; Telegram's file_id is cached after the first send).
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                       -- photo | video | animation
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  size INTEGER NOT NULL,
  file_id TEXT,
  admin_id BIGINT NOT NULL,
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

-- The API is served only by this server (service connection); nobody should reach the tables through Supabase's public REST API
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
`;

/** Creates the tables on first start and marks interrupted broadcasts. Await this before serving. */
db.ready = (async () => {
  await pool.query('SELECT pg_advisory_lock(7301)'); // two instances starting together must not race on DDL
  try {
    await pool.query(SCHEMA);
    await pool.query("UPDATE broadcasts SET status = 'interrupted' WHERE status = 'sending'");
  } finally {
    await pool.query('SELECT pg_advisory_unlock(7301)').catch(() => {});
  }
})();

module.exports = db;
