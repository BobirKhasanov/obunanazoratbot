const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                 -- Telegram user id
  first_name TEXT,
  username TEXT,
  lang TEXT NOT NULL DEFAULT 'en',        -- en | ru | uz | uzc
  lang_set INTEGER NOT NULL DEFAULT 0,    -- 1 once the user picked a language themselves
  theme TEXT NOT NULL DEFAULT 'dark',     -- dark | light
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  discoverable INTEGER NOT NULL DEFAULT 1, -- appears in the "online now" list
  blocked INTEGER NOT NULL DEFAULT 0,
  bot_blocked INTEGER NOT NULL DEFAULT 0,  -- user blocked the bot (cannot DM)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id)
);

-- One row per game between two people. Moves are stored as a JSON list of [from, to, promotion]
-- and replayed with chess.js whenever the game is loaded, so the server never trusts a client.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL,
  white_id INTEGER,
  black_id INTEGER,
  invited_id INTEGER,
  status TEXT NOT NULL,                   -- open | invited | active | finished | cancelled
  mode TEXT NOT NULL DEFAULT 'friend',    -- friend | online
  result TEXT,                            -- 1-0 | 0-1 | 1/2-1/2
  reason TEXT,                            -- checkmate, resign, stalemate, agreement, ...
  moves TEXT NOT NULL DEFAULT '[]',
  draw_by TEXT,                           -- colour that currently offers a draw
  notified_ply INTEGER NOT NULL DEFAULT -1,
  reminded_ply INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_move_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

-- Finished games against the computer (played in the browser, reported by the client)
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  outcome TEXT NOT NULL,                  -- win | draw | loss
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id);

-- Media uploaded for admin posts (kept 7 days; Telegram's file_id is cached after the first send)
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- photo | video | animation
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_id TEXT,
  admin_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'all',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- additive migrations: this database may already hold users from the earlier version of the bot ----
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'lang', "TEXT NOT NULL DEFAULT 'en'");
addColumn('users', 'lang_set', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'dark'");
addColumn('users', 'notify_enabled', 'INTEGER NOT NULL DEFAULT 1');
addColumn('users', 'discoverable', 'INTEGER NOT NULL DEFAULT 1');
addColumn('users', 'bot_blocked', 'INTEGER NOT NULL DEFAULT 0');
addColumn('broadcasts', 'media_id', 'TEXT');

// A restart mid-broadcast leaves a row stuck on "sending"
db.prepare("UPDATE broadcasts SET status = 'interrupted' WHERE status = 'sending'").run();

module.exports = db;
