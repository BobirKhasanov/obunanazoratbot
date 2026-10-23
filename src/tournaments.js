// Swiss tournaments: created by Premium users / admins, anyone can join, rounds are paired
// automatically and every game is a normal rated game (mode 'tour') on the server clock.
const crypto = require('crypto');
const db = require('./db');
const { standings, pairRound, defaultRounds } = require('./swiss');
const { presetOf, normalizeTimeControl, categoryOf } = require('./time');
const { parseMoves, turnOf } = require('./game');

const TC_ALLOWED = ['3+0', '3+2', '5+0', '10+0', '15+10'];
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 64;
const BREAK_MS = Number(process.env.TOUR_BREAK_MS || 30_000);
const NOSHOW_MS = Number(process.env.TOUR_NOSHOW_MS || 90_000);
const START_MINUTES = [5, 10, 15, 30, 60, 180, 1440];

/**
 * @param {object} d  hooks from server.js
 *   getGame, finish, claimFlagIfNeeded, pushGame, person, realtime, notify, isPremiumActive, isAdmin, gameId, HttpError, bad, wrap, cleanText
 */
function create(d) {
  const { getGame, finish, claimFlagIfNeeded, pushGame, person, realtime, notify, getShopSettings, ledgerDiamonds, invalidateUserCache } = d;

  const getT = (id) => db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  const playersOf = (id) => db.prepare(`
    SELECT tp.user_id AS id, tp.withdrawn, tp.joined_at, u.elo
    FROM tournament_players tp JOIN users u ON u.id = tp.user_id
    WHERE tp.tournament_id = ? ORDER BY tp.joined_at ASC`).all(id);
  const gamesOf = (id) => db.prepare('SELECT * FROM tournament_games WHERE tournament_id = ? ORDER BY round ASC, id ASC').all(id);

  const toSwissGames = (rows) => rows.map((g) => ({ round: g.round, white: Number(g.white_id), black: g.black_id == null ? null : Number(g.black_id), result: g.result }));
  const toSwissPlayers = (rows) => rows.map((p) => ({ id: Number(p.id), rating: Number(p.elo || 1200) }));

  const tell = (uid, text, gameId) => {
    try { realtime.send(uid, { t: 'tour', text }); } catch { /* offline */ }
    return notify.toUser(uid, () => text, gameId ? { gameId } : {});
  };

  async function startRound(t) {
    const prow = await playersOf(t.id);
    const active = prow.filter((p) => !p.withdrawn).map((p) => Number(p.id));
    const allGames = await gamesOf(t.id);
    const round = t.round + 1;
    if (active.length < 2) return finishTournament(t.id);
    const { pairs, bye } = pairRound(active, toSwissPlayers(prow), toSwissGames(allGames));
    const spec = presetOf(t.time_control);
    const tc = normalizeTimeControl(t.time_control);
    if (bye) {
      await db.prepare("INSERT INTO tournament_games (tournament_id, round, white_id, black_id, game_id, result) VALUES (?, ?, ?, NULL, NULL, 'bye')").run(t.id, round, bye);
    }
    const made = [];
    for (const [w, b] of pairs) {
      const gid = crypto.randomBytes(6).toString('base64url');
      await db.prepare(`INSERT INTO games (id, creator_id, white_id, black_id, invited_id, status, mode, time_control, white_ms, black_ms, turn_started_at)
        VALUES (?, ?, ?, ?, ?, 'active', 'tour', ?, ?, ?, now())`).run(gid, w, w, b, b, tc, spec.baseMs, spec.baseMs);
      await db.prepare('INSERT INTO tournament_games (tournament_id, round, white_id, black_id, game_id) VALUES (?, ?, ?, ?, ?)').run(t.id, round, w, b, gid);
      // leave any matchmaking search so the player is not in two places
      await db.prepare("UPDATE games SET status = 'cancelled', updated_at = now() WHERE creator_id IN (?, ?) AND status = 'open' AND mode = 'online'").run(w, b);
      made.push({ gid, w, b });
    }
    await db.prepare("UPDATE tournaments SET round = ?, round_state = 'playing', next_at = NULL WHERE id = ?").run(round, t.id);
    for (const m of made) {
      const row = await getGame.get(m.gid);
      for (const uid of [m.w, m.b]) {
        realtime.send(uid, { t: 'tour_game', tournamentId: t.id, round, game: null, gameId: m.gid });
        tell(uid, `♟ ${t.name} — ${round}/${t.rounds}`, m.gid);
      }
      await pushGame(row);
    }
    if (bye) tell(bye, `♟ ${t.name} — ${round}/${t.rounds}: bye (+1)`);
  }

  async function pay(uid, amount, kind, meta) {
    const n = Math.floor(Number(amount) || 0);
    if (n <= 0) return;
    await db.prepare('UPDATE users SET diamonds = diamonds + ? WHERE id = ?').run(n, uid);
    await ledgerDiamonds(uid, n, kind, meta);
    invalidateUserCache(uid);
  }

  async function finishTournament(id) {
    // atomic: only one caller gets to finish (and pay) a tournament
    const upd = await db.prepare("UPDATE tournaments SET status = 'finished', round_state = NULL, next_at = NULL, finished_at = now() WHERE id = ? AND status = 'running'").run(id);
    if (!upd.changes) return;
    const t = await getT(id);
    const prow = await playersOf(id);
    const rows = standings(toSwissPlayers(prow), toSwissGames(await gamesOf(id)));
    const out = new Set(prow.filter((p) => p.withdrawn).map((p) => Number(p.id)));
    const cfg = t.prize_cfg || {};
    const prizes = [cfg.prize1, cfg.prize2, cfg.prize3].map((x) => Number(x) || 0);
    const medals = ['🥇', '🥈', '🥉'];
    const eligible = rows.filter((r) => !out.has(r.id));
    for (const r of rows) {
      const k = eligible.indexOf(r);
      const prize = k >= 0 && k < 3 ? prizes[k] : 0;
      if (prize > 0) await pay(r.id, prize, 'tour_prize', { tournamentId: id, place: k + 1 });
      tell(r.id, `🏁 ${t.name}: #${r.rank} ${medals[k] || ''} · ${r.points}${prize > 0 ? ` · +${prize} 💎` : ''}`);
    }
    const big = prow.length > (Number(cfg.bigThreshold) || 16);
    const orgPay = big ? Number(cfg.organizerBig) || 0 : Number(cfg.organizer) || 0;
    if (orgPay > 0) {
      await pay(Number(t.creator_id), orgPay, 'tour_organizer', { tournamentId: id, players: prow.length });
      tell(Number(t.creator_id), `🎖 ${t.name}: +${orgPay} 💎`);
    }
    await db.prepare('UPDATE tournaments SET prize_cfg = ?::jsonb WHERE id = ?').run(JSON.stringify({ ...cfg, paidOrganizer: orgPay }), id);
  }

  async function startTournament(t) {
    const prow = await playersOf(t.id);
    if (prow.length < MIN_PLAYERS) {
      await db.prepare("UPDATE tournaments SET status = 'cancelled', finished_at = now() WHERE id = ?").run(t.id);
      for (const p of prow) tell(p.id, `❌ ${t.name}: ${MIN_PLAYERS}+ players needed`);
      return;
    }
    const rounds = Math.max(1, Math.min(t.rounds, prow.length - 1));
    await db.prepare("UPDATE tournaments SET status = 'running', rounds = ?, round = 0 WHERE id = ?").run(rounds, t.id);
    await startRound({ ...t, rounds, round: 0, status: 'running' });
  }

  /** Move a tournament forward: settle finished games, flag no-shows, pair the next round. */
  async function progress(t) {
    if (t.round_state === 'break') {
      if (t.next_at && new Date(t.next_at).getTime() <= Date.now()) await startRound(t);
      return;
    }
    const open = (await gamesOf(t.id)).filter((g) => g.round === t.round && g.result == null);
    let pending = 0;
    for (const tg of open) {
      let row = tg.game_id ? await getGame.get(tg.game_id) : null;
      if (!row) { await db.prepare("UPDATE tournament_games SET result = '0-0' WHERE id = ?").run(tg.id); continue; }
      if (row.status === 'active') {
        row = await claimFlagIfNeeded(row);
        if (row.status === 'active') {
          const moves = parseMoves(row.moves);
          const idleMs = Date.now() - new Date(row.last_move_at).getTime();
          if (moves.length < 2 && idleMs > NOSHOW_MS) {
            const loserWhite = turnOf(moves) === 'w';
            row = await finish(row, loserWhite ? '0-1' : '1-0', 'noshow');
            const loser = loserWhite ? row.white_id : row.black_id;
            await db.prepare('UPDATE tournament_players SET withdrawn = TRUE WHERE tournament_id = ? AND user_id = ?').run(t.id, loser);
            tell(loser, `⚠️ ${t.name}: no move — you were removed`);
          }
        }
      }
      if (row.status === 'finished' && row.result) {
        await db.prepare('UPDATE tournament_games SET result = ? WHERE id = ?').run(row.result, tg.id);
      } else if (row.status === 'cancelled') {
        await db.prepare("UPDATE tournament_games SET result = '0-0' WHERE id = ?").run(tg.id);
      } else pending += 1;
    }
    if (pending) return;
    if (t.round >= t.rounds) return finishTournament(t.id);
    await db.prepare("UPDATE tournaments SET round_state = 'break', next_at = now() + (? * interval '1 millisecond') WHERE id = ?").run(BREAK_MS, t.id);
  }

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const t of await db.prepare("SELECT * FROM tournaments WHERE status = 'registration' AND starts_at <= now()").all()) await startTournament(t);
      for (const t of await db.prepare("SELECT * FROM tournaments WHERE status = 'running'").all()) await progress(t);
    } catch (e) { console.error('[tournaments]', e.message || e); } finally { busy = false; }
  }

  // ---------- API ----------
  const brief = async (t, uid) => {
    const n = Number((await db.prepare('SELECT COUNT(*)::int AS n FROM tournament_players WHERE tournament_id = ? AND withdrawn = FALSE').get(t.id)).n);
    const mine = await db.prepare('SELECT withdrawn FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(t.id, uid);
    return {
      id: t.id, name: t.name, format: t.format, timeControl: normalizeTimeControl(t.time_control), category: categoryOf(t.time_control),
      rounds: t.rounds, round: t.round, roundState: t.round_state, status: t.status, maxPlayers: t.max_players,
      startsAt: new Date(t.starts_at).toISOString(), nextAt: t.next_at ? new Date(t.next_at).toISOString() : null,
      players: n, joined: !!mine && !mine.withdrawn, withdrawn: !!(mine && mine.withdrawn),
      creator: await person(t.creator_id), mine: Number(t.creator_id) === Number(uid),
      prizes: t.prize_cfg ? [t.prize_cfg.prize1, t.prize_cfg.prize2, t.prize_cfg.prize3].map((x) => Number(x) || 0) : [0, 0, 0],
      organizerReward: t.prize_cfg ? (t.prize_cfg.paidOrganizer != null ? t.prize_cfg.paidOrganizer : (n > (t.prize_cfg.bigThreshold || 16) ? t.prize_cfg.organizerBig : t.prize_cfg.organizer)) : 0,
    };
  };

  /** Tournaments (not cancelled) the user joined today (Tashkent), other than `exceptId`. */
  const joinedToday = async (uid, exceptId = 0) => Number((await db.prepare(`
    SELECT COUNT(*)::int AS n FROM tournament_players tp JOIN tournaments t ON t.id = tp.tournament_id
    WHERE tp.user_id = ? AND t.status <> 'cancelled' AND t.id <> ?
      AND (tp.joined_at AT TIME ZONE 'Asia/Tashkent')::date = (now() AT TIME ZONE 'Asia/Tashkent')::date`).get(uid, exceptId)).n);

  function register(api) {
    const { HttpError, bad, wrap, cleanText, isPremiumActive, isAdmin } = d;
    const canCreate = (req) => !!(req.isAdmin || isPremiumActive(req.user));

    api.get('/tournaments', wrap(async (req, res) => {
      const rows = await db.prepare(`
        SELECT * FROM tournaments
        WHERE status IN ('registration', 'running') OR (status = 'finished' AND finished_at > now() - interval '3 days')
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, starts_at ASC LIMIT 40`).all();
      const list = [];
      for (const t of rows) list.push(await brief(t, req.user.id));
      const cfg = (await getShopSettings()).tour;
      res.json({ tournaments: list, canCreate: canCreate(req), rules: cfg, options: { timeControls: TC_ALLOWED, startMinutes: START_MINUTES, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS } });
    }));

    api.post('/tournaments', wrap(async (req, res) => {
      if (!canCreate(req)) throw new HttpError(403, 'Premium required', 'premium_required');
      const b = req.body || {};
      const name = cleanText(b.name, 40, 'bad_request', true);
      const tc = TC_ALLOWED.includes(b.timeControl) ? b.timeControl : '5+0';
      const maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(Number(b.maxPlayers) || 32)));
      const rounds = Math.max(3, Math.min(9, Math.floor(Number(b.rounds) || defaultRounds(maxPlayers))));
      // Start by clock time (Tashkent, UTC+5) — "YYYY-MM-DD HH:mm"; the old "in N minutes" still works
      let mins = START_MINUTES.includes(Number(b.startsInMin)) ? Number(b.startsInMin) : 15;
      let startAtMs = null;
      if (b.startsAtTashkent != null && b.startsAtTashkent !== '') {
        const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(b.startsAtTashkent).trim());
        const at = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:00`) : null;
        if (!at || Number.isNaN(at.getTime())) throw bad('Start time must be YYYY-MM-DD HH:mm (Tashkent)', 'bad_request');
        const diff = Math.round((at.getTime() - Date.now()) / 60000);
        if (diff < 2) throw bad('Start time must be in the future', 'bad_request');
        if (diff > 14 * 1440) throw bad('Start time is too far ahead (max 14 days)', 'bad_request');
        mins = diff;
        startAtMs = at.getTime();
      }
      const cfg = (await getShopSettings()).tour;
      if (!req.isAdmin) {
        const mineOpen = await db.prepare("SELECT 1 AS x FROM tournaments WHERE creator_id = ? AND status IN ('registration', 'running')").get(req.user.id);
        if (mineOpen) throw bad('You already have an active tournament', 'tour_limit');
        const weekly = Number((await db.prepare("SELECT COUNT(*)::int AS n FROM tournaments WHERE creator_id = ? AND status <> 'cancelled' AND created_at > now() - interval '7 days'").get(req.user.id)).n);
        if (weekly >= cfg.weeklyLimit) throw bad('Weekly tournament limit reached', 'tour_weekly');
        if (await joinedToday(req.user.id) >= cfg.dailyJoinLimit) throw bad('Daily tournament limit reached', 'tour_daily');
      }
      const row = await db.prepare(`INSERT INTO tournaments (name, creator_id, time_control, rounds, max_players, starts_at, prize_cfg)
        VALUES (?, ?, ?, ?, ?, ${startAtMs ? '?::timestamptz' : "now() + (? * interval '1 minute')"}, ?::jsonb) RETURNING id`).get(name, req.user.id, tc, rounds, maxPlayers, startAtMs ? new Date(startAtMs).toISOString() : mins, JSON.stringify(cfg));
      await db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(row.id, req.user.id);
      res.status(201).json({ tournament: await brief(await getT(row.id), req.user.id) });
    }));

    api.get('/tournaments/:id', wrap(async (req, res) => {
      const t = await getT(Number(req.params.id));
      if (!t) throw new HttpError(404, 'Tournament not found', 'notfound');
      const prow = await playersOf(t.id);
      const games = await gamesOf(t.id);
      const st = standings(toSwissPlayers(prow), toSwissGames(games));
      const wd = new Map(prow.map((p) => [Number(p.id), !!p.withdrawn]));
      const standing = [];
      for (const r of st) {
        const p = await person(r.id);
        standing.push({ ...p, rank: r.rank, points: r.points, buchholz: r.buchholz, wins: r.wins, played: r.played, withdrawn: !!wd.get(r.id) });
      }
      const pairings = [];
      for (const g of games.filter((x) => x.round === (t.status === 'finished' ? t.rounds : Math.max(1, t.round)))) {
        let live = null;
        if (g.game_id && g.result == null) {
          const row = await getGame.get(g.game_id);
          live = row ? { status: row.status, ply: parseMoves(row.moves).length } : null;
        }
        pairings.push({ white: await person(g.white_id), black: g.black_id ? await person(g.black_id) : null, gameId: g.game_id, result: g.result, live });
      }
      const myPair = games.find((g) => g.round === t.round && g.result == null && g.game_id && (Number(g.white_id) === req.user.id || Number(g.black_id) === req.user.id));
      res.json({ tournament: await brief(t, req.user.id), standing, pairings, myGameId: myPair ? myPair.game_id : null });
    }));

    api.post('/tournaments/:id/join', wrap(async (req, res) => {
      const t = await getT(Number(req.params.id));
      if (!t) throw new HttpError(404, 'Tournament not found', 'notfound');
      if (t.status !== 'registration') throw bad('Registration is closed', 'tour_closed');
      const n = Number((await db.prepare('SELECT COUNT(*)::int AS n FROM tournament_players WHERE tournament_id = ?').get(t.id)).n);
      const has = await db.prepare('SELECT 1 AS x FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(t.id, req.user.id);
      if (!has && n >= t.max_players) throw bad('Tournament is full', 'tour_full');
      if (!has && !req.isAdmin && await joinedToday(req.user.id, t.id) >= (await getShopSettings()).tour.dailyJoinLimit) throw bad('You can join one tournament per day', 'tour_daily');
      await db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(t.id, req.user.id);
      res.json({ tournament: await brief(t, req.user.id) });
    }));

    api.post('/tournaments/:id/leave', wrap(async (req, res) => {
      const t = await getT(Number(req.params.id));
      if (!t) throw new HttpError(404, 'Tournament not found', 'notfound');
      if (t.status === 'registration') {
        if (Number(t.creator_id) === req.user.id) throw bad('The organizer cannot leave', 'tour_creator');
        await db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(t.id, req.user.id);
      } else if (t.status === 'running') {
        await db.prepare('UPDATE tournament_players SET withdrawn = TRUE WHERE tournament_id = ? AND user_id = ?').run(t.id, req.user.id);
        // an unfinished game of the current round is lost
        const tg = (await gamesOf(t.id)).find((g) => g.round === t.round && g.result == null && g.game_id && (Number(g.white_id) === req.user.id || Number(g.black_id) === req.user.id));
        if (tg) {
          const row = await getGame.get(tg.game_id);
          if (row && row.status === 'active') await finish(row, Number(row.white_id) === req.user.id ? '0-1' : '1-0', 'resign');
        }
      }
      res.json({ tournament: await brief(await getT(t.id), req.user.id) });
    }));

    api.post('/tournaments/:id/start', wrap(async (req, res) => {
      const t = await getT(Number(req.params.id));
      if (!t) throw new HttpError(404, 'Tournament not found', 'notfound');
      if (!(req.isAdmin || Number(t.creator_id) === req.user.id)) throw new HttpError(403, 'Only the organizer can start', 'forbidden');
      if (t.status !== 'registration') throw bad('Already started', 'tour_closed');
      await db.prepare('UPDATE tournaments SET starts_at = now() WHERE id = ?').run(t.id);
      await startTournament(await getT(t.id));
      res.json({ tournament: await brief(await getT(t.id), req.user.id) });
    }));

    api.post('/tournaments/:id/cancel', wrap(async (req, res) => {
      const t = await getT(Number(req.params.id));
      if (!t) throw new HttpError(404, 'Tournament not found', 'notfound');
      if (!(req.isAdmin || Number(t.creator_id) === req.user.id)) throw new HttpError(403, 'Only the organizer can cancel', 'forbidden');
      if (t.status !== 'registration' && !req.isAdmin) throw bad('Already started', 'tour_closed');
      if (!['registration', 'running'].includes(t.status)) throw bad('Already finished', 'tour_closed');
      await db.prepare("UPDATE tournaments SET status = 'cancelled', finished_at = now() WHERE id = ?").run(t.id);
      for (const g of await gamesOf(t.id)) {
        if (g.game_id && g.result == null) {
          const row = await getGame.get(g.game_id);
          if (row && row.status === 'active') {
            await db.prepare("UPDATE games SET status = 'cancelled', reason = 'aborted', updated_at = now() WHERE id = ?").run(row.id);
            await pushGame(await getGame.get(row.id));
          }
        }
      }
      for (const p of await playersOf(t.id)) if (Number(p.id) !== req.user.id) tell(p.id, `❌ ${t.name}`);
      res.json({ ok: true });
    }));
  }

  return { register, tick, startTournament, progress, finishTournament, TC_ALLOWED, MIN_PLAYERS };
}

module.exports = { create, TC_ALLOWED, MIN_PLAYERS, MAX_PLAYERS };
