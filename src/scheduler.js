// Background jobs. Both run on a timer inside the server process (single instance).
//  1. "Your move" reminders: a player who has not answered for a while gets a Telegram message
//     with an Open button (once per move).
//  2. Housekeeping: stale invitations are cancelled, abandoned games are closed, old media is deleted.
const fs = require('fs');
const db = require('./db');
const notify = require('./notify');
const realtime = require('./realtime');
const { turnOf } = require('./game');

const REMIND_AFTER_HOURS = Number(process.env.REMIND_AFTER_HOURS || 6); // env overrides are for tests
const ABANDON_AFTER_DAYS = 7;

const nameOf = db.prepare('SELECT first_name FROM users WHERE id = ?');
const name = (id) => (nameOf.get(id) || {}).first_name || 'Player';

async function remindMoves() {
  const rows = db.prepare(`
    SELECT * FROM games
    WHERE status = 'active' AND last_move_at < datetime('now', ?)
  `).all(`-${REMIND_AFTER_HOURS} hours`);

  for (const g of rows) {
    const ply = JSON.parse(g.moves).length;
    if (g.reminded_ply === ply) continue; // already reminded for this move
    const waiting = turnOf(JSON.parse(g.moves)) === 'w' ? g.white_id : g.black_id;
    const other = waiting === g.white_id ? g.black_id : g.white_id;
    db.prepare('UPDATE games SET reminded_ply = ? WHERE id = ?').run(ply, g.id);
    if (realtime.isOnline(waiting)) continue; // they are in the app right now
    await notify.toUser(waiting, (T) => T.reminder(name(other)), { gameId: g.id });
    await new Promise((r) => setTimeout(r, 50)); // far below Telegram's rate limit
  }
}

function housekeeping(onGameChanged) {
  // Invitations nobody answered within a day
  const stale = db.prepare(`
    SELECT id FROM games WHERE status IN ('open', 'invited') AND updated_at < datetime('now', '-1 day')
  `).all();
  for (const g of stale) db.prepare("UPDATE games SET status = 'cancelled' WHERE id = ?").run(g.id);

  // Games where nobody moved for a week: the player who was waiting wins
  const dead = db.prepare(`
    SELECT * FROM games WHERE status = 'active' AND last_move_at < datetime('now', ?)
  `).all(`-${ABANDON_AFTER_DAYS} days`);
  for (const g of dead) {
    const turn = turnOf(JSON.parse(g.moves));
    const result = turn === 'w' ? '0-1' : '1-0';
    db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'abandoned', updated_at = datetime('now') WHERE id = ?")
      .run(result, g.id);
    if (onGameChanged) onGameChanged(g.id);
  }

  // Uploaded post media is only needed for a few days
  const oldMedia = db.prepare("SELECT id, path FROM media WHERE created_at < datetime('now', '-7 days')").all();
  for (const m of oldMedia) {
    fs.rm(m.path, { force: true }, () => {});
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  }
}

function startScheduler(onGameChanged) {
  const tick = async () => {
    try {
      housekeeping(onGameChanged);
      await remindMoves();
    } catch (e) {
      console.error('[scheduler] error:', e);
    }
  };
  const timer = setInterval(tick, Number(process.env.SCHEDULER_MS || 10 * 60 * 1000));
  timer.unref();
  tick();
  return timer;
}

module.exports = { startScheduler, remindMoves, housekeeping };
