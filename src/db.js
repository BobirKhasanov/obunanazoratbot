const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                -- Telegram user id
  first_name TEXT,
  username TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  notify_days INTEGER NOT NULL DEFAULT 3, -- remind N days before a renewal
  blocked INTEGER NOT NULL DEFAULT 0,
  bot_blocked INTEGER NOT NULL DEFAULT 0, -- user blocked the bot (cannot DM)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly', -- weekly | monthly | yearly
  next_date TEXT NOT NULL,                -- YYYY-MM-DD next charge
  category TEXT NOT NULL DEFAULT 'other',
  active INTEGER NOT NULL DEFAULT 1,
  last_notified TEXT,                     -- next_date value we already reminded about
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`);

module.exports = db;
