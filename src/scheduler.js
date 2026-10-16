// Background jobs. Both run on a timer inside the server process (single instance).
//  1. "Your move" reminders: a player who has not answered for a while gets a Telegram message
//     with an Open button (once per move).
//  2. Housekeeping: stale invitations are cancelled, abandoned games are closed, old media is deleted.
const db = require('./db');
const notify = require('./notify');
const realtime = require('./realtime');
const { turnOf, parseMoves } = require('./game');
const REMIND_AFTER_HOURS = Number(process.env.REMIND_AFTER_HOURS || 6); // env overrides are for tests
const ABANDON_AFTER_DAYS = 7;
/** Waiting open/invited games auto-cancel if nobody joins. */
const JOIN_TIMEOUT_MINUTES = Math.max(1, Number(process.env.JOIN_TIMEOUT_MINUTES || 30));
/** Active game ends as draw if neither player opened the Mini App for this long. */
const IDLE_APP_MINUTES = Math.max(1, Number(process.env.IDLE_APP_MINUTES || 30));

const nameOf = db.prepare('SELECT first_name FROM users WHERE id = ?');
const name = async (id) => ((await nameOf.get(id)) || {}).first_name || 'Player';

async function remindMoves() {
  // Live-clock games (bullet/blitz/rapid) do not need "your move" DMs — the clock is the reminder
  const rows = await db.prepare(`
    SELECT * FROM games
    WHERE status = 'active' AND white_ms IS NULL
      AND last_move_at < now() - (? * interval '1 hour')
  `).all(REMIND_AFTER_HOURS);

  for (const g of rows) {
    const moves = parseMoves(g.moves);
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
  // Open / invited games nobody joined within JOIN_TIMEOUT_MINUTES
  await db.prepare(`
    UPDATE games SET status = 'cancelled', updated_at = now()
    WHERE status IN ('open', 'invited')
      AND created_at < now() - (? * interval '1 minute')
  `).run(JOIN_TIMEOUT_MINUTES);

  // Both players left the Mini App for IDLE_APP_MINUTES → draw (applies to timed + untimed)
  const idleRows = await db.prepare(`
    SELECT g.id, g.white_id, g.black_id
    FROM games g
    JOIN users w ON w.id = g.white_id
    JOIN users b ON b.id = g.black_id
    WHERE g.status = 'active'
      AND w.last_seen < now() - (? * interval '1 minute')
      AND b.last_seen < now() - (? * interval '1 minute')
    ORDER BY g.updated_at ASC
    LIMIT 80
  `).all(IDLE_APP_MINUTES, IDLE_APP_MINUTES);
  for (const g of idleRows) {
    if (realtime.isOnline(g.white_id) || realtime.isOnline(g.black_id)) continue;
    const r = await db.prepare(`
      UPDATE games SET status = 'finished', result = '1/2-1/2', reason = 'idle', draw_by = NULL, updated_at = now()
      WHERE id = ? AND status = 'active'
    `).run(g.id);
    if (r.changes > 0 && onGameChanged) await onGameChanged(g.id);
  }

  // Untimed games where nobody moved for a week: the player who was waiting wins
  const dead = await db.prepare(`
    SELECT * FROM games WHERE status = 'active' AND white_ms IS NULL
      AND last_move_at < now() - (? * interval '1 day')
  `).all(ABANDON_AFTER_DAYS);
  for (const g of dead) {
    const result = turnOf(parseMoves(g.moves)) === 'w' ? '0-1' : '1-0';
    await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'abandoned', updated_at = now() WHERE id = ? AND status = 'active'").run(result, g.id);
    if (onGameChanged) await onGameChanged(g.id);
  }

  // Uploaded post media is only needed for a few days (keep custom avatars + profile banner)
  const old = await db.prepare(`
    SELECT id FROM media
    WHERE created_at < now() - interval '7 days'
      AND id NOT IN (
        SELECT substring(avatar_key FROM 5)
        FROM users
        WHERE avatar_key LIKE 'img:%'
      )
      AND id IS DISTINCT FROM (
        SELECT NULLIF(trim(value), '') FROM app_settings WHERE key = 'profile_banner_media_id'
      )
  `).all();
  if (old.length) {
    await db.prepare(`
      DELETE FROM media
      WHERE created_at < now() - interval '7 days'
        AND id NOT IN (
          SELECT substring(avatar_key FROM 5)
          FROM users
          WHERE avatar_key LIKE 'img:%'
        )
        AND id IS DISTINCT FROM (
          SELECT NULLIF(trim(value), '') FROM app_settings WHERE key = 'profile_banner_media_id'
        )
    `).run();
  }
}

/**
 * @param {(id: string) => Promise<void>} onGameChanged
 * @param {() => Promise<unknown>} [onMonthlyMedals]  run on 1st of month (Tashkent)
 */
function startScheduler(onGameChanged, onMonthlyMedals) {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    try {
      await housekeeping(onGameChanged);
      await remindMoves();
      if (typeof onMonthlyMedals === 'function') await onMonthlyMedals();
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
