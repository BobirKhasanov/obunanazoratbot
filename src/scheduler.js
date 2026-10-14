// Background jobs. Both run on a timer inside the server process (single instance).
//  1. "Your move" reminders: a player who has not answered for a while gets a Telegram message
//     with an Open button (once per move).
//  2. Housekeeping: stale invitations are cancelled, abandoned games are closed, old media is deleted.
const db = require('./db');
const notify = require('./notify');
const realtime = require('./realtime');
const { turnOf } = require('./game');

const REMIND_AFTER_HOURS = Number(process.env.REMIND_AFTER_HOURS || 6); // env overrides are for tests
const ABANDON_AFTER_DAYS = 7;

const nameOf = db.prepare('SELECT first_name FROM users WHERE id = ?');
const name = async (id) => ((await nameOf.get(id)) || {}).first_name || 'Player';

async function remindMoves() {
  const rows = await db.prepare(`
    SELECT * FROM games
    WHERE status = 'active' AND last_move_at < now() - (? * interval '1 hour')
  `).all(REMIND_AFTER_HOURS);

  for (const g of rows) {
    const moves = JSON.parse(g.moves);
    const ply = moves.length;
    if (g.reminded_ply === ply) continue; // already reminded for this move
    const waiting = turnOf(moves) === 'w' ? g.white_id : g.black_id;
    const other = waiting === g.white_id ? g.black_id : g.white_id;
    await db.prepare('UPDATE games SET reminded_ply = ? WHERE id = ?').run(ply, g.id);
    if (realtime.isOnline(waiting)) continue; // they are in the app right now
    const otherName = await name(other);
    await notify.toUser(waiting, (T) => T.reminder(otherName), { gameId: g.id });
    await new Promise((r) => setTimeout(r, 50)); // far below Telegram's rate limit
  }
}

async function housekeeping(onGameChanged) {
  // Invitations nobody answered within a day
  await db.prepare("UPDATE games SET status = 'cancelled' WHERE status IN ('open', 'invited') AND updated_at < now() - interval '1 day'").run();

  // Games where nobody moved for a week: the player who was waiting wins
  const dead = await db.prepare(`
    SELECT * FROM games WHERE status = 'active' AND last_move_at < now() - (? * interval '1 day')
  `).all(ABANDON_AFTER_DAYS);
  for (const g of dead) {
    const result = turnOf(JSON.parse(g.moves)) === 'w' ? '0-1' : '1-0';
    await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'abandoned', updated_at = now() WHERE id = ?").run(result, g.id);
    if (onGameChanged) await onGameChanged(g.id);
  }

  // Uploaded post media is only needed for a few days
  await db.prepare("DELETE FROM media WHERE created_at < now() - interval '7 days'").run();
}

function startScheduler(onGameChanged) {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    try {
      await housekeeping(onGameChanged);
      await remindMoves();
    } catch (e) {
      console.error('[scheduler] error:', e);
    } finally { running = false; }
  };
  const timer = setInterval(tick, Number(process.env.SCHEDULER_MS || 10 * 60 * 1000));
  timer.unref();
  tick();
  return timer;
}

module.exports = { startScheduler, remindMoves, housekeeping };
