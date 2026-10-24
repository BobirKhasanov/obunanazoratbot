// Background jobs. Both run on a timer inside the server process (single instance).
//  1. "Your move" reminders: a player who has not answered for a while gets a Telegram message
//     with an Open button (once per move).
//  2. Housekeeping: stale invitations are cancelled, abandoned games are closed, old media is deleted.
const db = require('./db');
const notify = require('./notify');
const realtime = require('./realtime');
const { turnOf, parseMoves, replay } = require('./game');

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** Material balance in pawns: positive = white is ahead. */
function materialLead(moves) {
  let sum = 0;
  for (const rank of replay(moves).board()) {
    for (const sq of rank) if (sq) sum += (sq.color === 'w' ? 1 : -1) * (PIECE_VALUE[sq.type] || 0);
  }
  return sum;
}
const REMIND_AFTER_HOURS = Number(process.env.REMIND_AFTER_HOURS || 6); // env overrides are for tests
/** Untimed (no clock) game: the player to move loses after this many hours without a move (chess.com-style). */
const ABANDON_UNTIMED_HOURS = Math.max(0.001, Number(process.env.ABANDON_UNTIMED_HOURS || 30));
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

async function housekeeping(onGameChanged, onForfeit) {
  // Open / invited games nobody joined within JOIN_TIMEOUT_MINUTES
  await db.prepare(`
    UPDATE games SET status = 'cancelled', updated_at = now()
    WHERE status IN ('open', 'invited')
      AND created_at < now() - (? * interval '1 minute')
  `).run(JOIN_TIMEOUT_MINUTES);

  // The player whose turn it is has been out of the Mini App AND has not moved for IDLE_APP_MINUTES
  // (the opponent may be gone too): the game ends by itself — whoever is ahead on the board wins, level = draw.
  const idleRows = await db.prepare(`
    SELECT g.* FROM games g
    JOIN users w ON w.id = g.white_id
    JOIN users b ON b.id = g.black_id
    WHERE g.status = 'active'
      AND g.white_id < 9000000000000 AND g.black_id < 9000000000000
      AND g.last_move_at < now() - (? * interval '1 minute')
      AND CASE WHEN jsonb_array_length(g.moves) % 2 = 0
               THEN w.last_seen ELSE b.last_seen END < now() - (? * interval '1 minute')
    ORDER BY g.updated_at ASC
    LIMIT 80
  `).all(IDLE_APP_MINUTES, IDLE_APP_MINUTES);
  for (const g of idleRows) {
    const moves = parseMoves(g.moves);
    const mover = turnOf(moves) === 'w' ? g.white_id : g.black_id;
    if (realtime.isOnline(mover)) continue; // they are in the app right now
    if (moves.length < 2) {
      await db.prepare("UPDATE games SET status = 'cancelled', reason = 'aborted', draw_by = NULL, takeback_by = NULL, updated_at = now() WHERE id = ? AND status = 'active'").run(g.id);
      if (onGameChanged) await onGameChanged(g.id);
      continue;
    }
    const lead = materialLead(moves); // + white ahead, − black ahead
    const result = lead >= 1 ? '1-0' : lead <= -1 ? '0-1' : '1/2-1/2';
    if (onForfeit) await onForfeit(g, result, 'inactive');
    else {
      await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'inactive', draw_by = NULL, takeback_by = NULL, updated_at = now() WHERE id = ? AND status = 'active'").run(result, g.id);
      if (onGameChanged) await onGameChanged(g.id);
    }
  }

  // Untimed games: the player to move has not moved for ABANDON_UNTIMED_HOURS → they lose (aborted before 2 moves)
  const dead = await db.prepare(`
    SELECT * FROM games WHERE status = 'active' AND white_ms IS NULL
      AND last_move_at < now() - (? * interval '1 hour')
      AND white_id < 9000000000000 AND black_id < 9000000000000
    LIMIT 100
  `).all(ABANDON_UNTIMED_HOURS);
  for (const g of dead) {
    const moves = parseMoves(g.moves);
    if (moves.length < 2) {
      await db.prepare("UPDATE games SET status = 'cancelled', reason = 'aborted', draw_by = NULL, takeback_by = NULL, updated_at = now() WHERE id = ? AND status = 'active'").run(g.id);
      if (onGameChanged) await onGameChanged(g.id);
      continue;
    }
    const result = turnOf(moves) === 'w' ? '0-1' : '1-0';
    if (onForfeit) await onForfeit(g, result, 'abandoned');
    else {
      await db.prepare("UPDATE games SET status = 'finished', result = ?, reason = 'abandoned', updated_at = now() WHERE id = ? AND status = 'active'").run(result, g.id);
      if (onGameChanged) await onGameChanged(g.id);
    }
  }

  // Uploaded post media is only needed for a few days — but never while a live announcement
  // (carousel), a notification campaign or a kept avatar/banner still points at it.
  const goneMedia = await db.prepare(`
    DELETE FROM media
    WHERE created_at < now() - interval '7 days'
      AND id NOT IN (
        SELECT substring(avatar_key FROM 5) FROM users WHERE avatar_key LIKE 'img:%'
      )
      AND id NOT IN (SELECT media_id FROM announcements WHERE media_id IS NOT NULL)
      AND id NOT IN (
        SELECT media_id FROM notification_campaigns
        WHERE media_id IS NOT NULL AND (expires_at IS NULL OR expires_at > now())
      )
      AND id IS DISTINCT FROM (
        SELECT NULLIF(trim(value), '') FROM app_settings WHERE key = 'profile_banner_media_id'
      )
      RETURNING id
  `).all();
  await require('./storage').deleteR2Objects(goneMedia.map((m) => m.id));
  await require('./storage').migrateSomeToR2(10).catch(() => {});
}

/**
 * @param {(id: string) => Promise<void>} onGameChanged
 * @param {() => Promise<unknown>} [onMonthlyMedals]  run on 1st of month (Tashkent)
 */
function startScheduler(onGameChanged, onMonthlyMedals, onForfeit) {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    try {
      await housekeeping(onGameChanged, onForfeit);
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
