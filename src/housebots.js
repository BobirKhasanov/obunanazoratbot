// "House players": four always-available practice opponents (two weaker, two medium) so a quiet app is
// never empty. They are real rows in `users` (id >= HOUSE_MIN) with ordinary profiles and ratings, and they
// play through the very same HTTP API as everybody else (loopback, with signed Mini App init data) — so clocks,
// rules, ratings and live spectating behave exactly like for human games. Everything is switchable in the admin
// panel and meant to be removed once there are enough real players.
const crypto = require('crypto');
const { Chess } = require('chess.js');
const db = require('./db');
const { parseMoves, turnOf } = require('./game');
const { categoryOf } = require('./time');
const { eloColumn, expandingEloDelta } = require('./elo');

const HOUSE_MIN = 9_000_000_000_000;
const isHouseId = (id) => Number(id) >= HOUSE_MIN;

// tier: weak = beginner-ish (level 2 + random slips), mid = club level (level 3, short think budget)
const BOTS = [
  { id: HOUSE_MIN + 1, first: 'Madina', last: 'Yusupova', gender: 'f', tier: 'weak', avatar: 'maya', region: 'Samarqand', elo: 860 },
  { id: HOUSE_MIN + 2, first: 'Nilufar', last: 'Qodirova', gender: 'f', tier: 'mid', avatar: 'aria', region: 'Toshkent', elo: 1330 },
  { id: HOUSE_MIN + 3, first: 'Jasur', last: 'Ergashev', gender: 'm', tier: 'weak', avatar: 'leo', region: "Farg'ona", elo: 900 },
  { id: HOUSE_MIN + 4, first: 'Sardor', last: 'Nazarov', gender: 'm', tier: 'mid', avatar: 'kai', region: 'Buxoro', elo: 1380 },
];
const TIER = {
  weak: { level: 2, timeMs: 150, slip: 0.14, think: [1500, 5000] },
  mid: { level: 3, timeMs: 350, slip: 0.0, think: [2000, 7000] },
};
const BOT_GAME_TCS = ['3+2', '5+0', '10+0'];
const SETTINGS_KEY = 'housebots';
const TICK_MS = 1500;
const MAX_PLY = 240;

const FAST = process.env.HOUSEBOT_FAST === '1'; // tests: no human-like waiting
const K = FAST ? 0.03 : 1;
const rnd = (a, b) => (a + Math.random() * (b - a)) * K;
const OPEN_WAIT_S = FAST ? 1 : 10;

function create(d) {
  const { getSetting, setSetting, realtime, port, botToken } = d;
  let engine = null;
  let timer = null;
  let busyTick = false;
  const moveDue = new Map();   // gameId -> { ply, at }
  const acceptDue = new Map(); // gameId -> at
  let nextPairAt = 0;
  let lastPresence = 0;
  let lastFriends = 0;
  let cfgCache = { at: 0, v: null };

  const defaults = () => ({ vsBots: true, enabled: Object.fromEntries(BOTS.map((b) => [String(b.id), true])) });
  async function getConfig(force = false) {
    if (!force && cfgCache.v && Date.now() - cfgCache.at < 4000) return cfgCache.v;
    let v = defaults();
    try {
      const raw = JSON.parse(await getSetting(SETTINGS_KEY, ''));
      if (raw && typeof raw === 'object') {
        v.vsBots = raw.vsBots !== false;
        for (const b of BOTS) if (raw.enabled && raw.enabled[String(b.id)] === false) v.enabled[String(b.id)] = false;
      }
    } catch { /* defaults */ }
    cfgCache = { at: Date.now(), v };
    return v;
  }
  async function saveConfig(patch) {
    const cur = await getConfig(true);
    const next = { vsBots: cur.vsBots, enabled: { ...cur.enabled } };
    if (patch && typeof patch.vsBots === 'boolean') next.vsBots = patch.vsBots;
    if (patch && patch.enabled && typeof patch.enabled === 'object') {
      for (const b of BOTS) if (typeof patch.enabled[String(b.id)] === 'boolean') next.enabled[String(b.id)] = patch.enabled[String(b.id)];
    }
    await setSetting(SETTINGS_KEY, JSON.stringify(next));
    cfgCache = { at: Date.now(), v: next };
    applyPins(next);
    return next;
  }

  function applyPins(cfg) {
    for (const b of BOTS) {
      if (cfg.enabled[String(b.id)]) realtime.pin(b.id); else realtime.unpin(b.id);
    }
  }

  async function seed() {
    for (const b of BOTS) {
      await db.prepare(`
        INSERT INTO users (id, first_name, last_name, username, lang, lang_set, discoverable, avatar_key, country, region,
                           elo, elo_bullet, elo_blitz, elo_rapid, elo_classic)
        VALUES (?, ?, ?, '', 'uz', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
          avatar_key = excluded.avatar_key, discoverable = 1, blocked = 0
      `).run(b.id, b.first, b.last, `char:${b.avatar}`, "O'zbekiston", b.region, b.elo, b.elo, b.elo, b.elo, b.elo);
    }
  }

  // ---- loopback API as a bot ----
  function initDataFor(b) {
    const user = JSON.stringify({ id: b.id, first_name: b.first, last_name: b.last, language_code: 'uz' });
    const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
    const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
    return new URLSearchParams({ ...params, hash }).toString();
  }
  const initCache = new Map();
  function initFor(b) {
    const hit = initCache.get(b.id);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.v;
    const v = initDataFor(b);
    initCache.set(b.id, { at: Date.now(), v });
    return v;
  }
  async function call(b, method, path, body) {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Init-Data': initFor(b) },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) { const e = new Error((json && json.error) || `HTTP ${res.status}`); e.status = res.status; e.code = json && json.code; throw e; }
    return json;
  }

  // ---- engine ----
  async function getEngine() {
    if (engine) return engine;
    const mod = await import('../public/js/ai.mjs');
    engine = mod.makeEngine(Chess);
    return engine;
  }

  async function chooseMove(b, row) {
    const eng = await getEngine();
    const tier = TIER[b.tier];
    const moves = parseMoves(row.moves);
    const chess = new Chess();
    const seen = [];
    for (const [from, to, promotion] of moves) { chess.move({ from, to, promotion: promotion || undefined }); seen.push(chess.fen()); }
    const legal = chess.moves({ verbose: true });
    if (!legal.length) return null;
    if (tier.slip && Math.random() < tier.slip) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      return { from: m.from, to: m.to, promotion: m.promotion };
    }
    const r = eng.bestMove(chess.fen(), tier.level, { timeMs: tier.timeMs, seen });
    if (!r) return null;
    return { from: r.from, to: r.to, promotion: r.promotion || (legal.find((m) => m.from === r.from && m.to === r.to && m.promotion) ? 'q' : undefined) };
  }

  function remainingMs(row, turn) {
    const base = Number(turn === 'w' ? row.white_ms : row.black_ms);
    if (!Number.isFinite(base) || row.white_ms == null) return null;
    const started = row.turn_started_at ? new Date(row.turn_started_at).getTime() : Date.now();
    return Math.max(0, base - (Date.now() - started));
  }

  const idsSql = BOTS.map((b) => b.id).join(',');
  const botOf = (id) => BOTS.find((b) => b.id === Number(id));

  async function tick() {
    if (busyTick) return;
    busyTick = true;
    try {
      const cfg = await getConfig();
      const on = (b) => !!cfg.enabled[String(b.id)];
      const now = Date.now();

      // keep the enabled bots "present" (appear in the online list)
      if (now - lastPresence > 10_000) {
        lastPresence = now;
        const enabledIds = BOTS.filter(on).map((b) => b.id);
        if (enabledIds.length) {
          await db.prepare(`UPDATE users SET last_seen = now(), present_until = now() + interval '45 seconds' WHERE id IN (${enabledIds.join(',')})`).run();
        }
        await db.prepare(`UPDATE users SET present_until = NULL WHERE id IN (${BOTS.filter((b) => !on(b)).map((b) => b.id).join(',') || '0'})`).run();
      }

      // all games any bot is part of
      const rows = await db.prepare(`
        SELECT * FROM games WHERE status = 'active' AND (white_id IN (${idsSql}) OR black_id IN (${idsSql}))
      `).all();
      const busy = new Set();
      for (const r of rows) { busy.add(Number(r.white_id)); busy.add(Number(r.black_id)); }
      const pending = await db.prepare(`
        SELECT * FROM games WHERE status = 'invited' AND (creator_id IN (${idsSql}) OR invited_id IN (${idsSql}))
      `).all();
      for (const r of pending) { busy.add(Number(r.creator_id)); if (r.invited_id) busy.add(Number(r.invited_id)); }

      // 1) moves
      for (const row of rows) {
        const moves = parseMoves(row.moves);
        const turn = turnOf(moves);
        const mover = Number(turn === 'w' ? row.white_id : row.black_id);
        const b = botOf(mover);
        if (!b) continue;
        const ply = moves.length;
        let due = moveDue.get(row.id);
        if (!due || due.ply !== ply) {
          const left = remainingMs(row, turn);
          const [lo, hi] = TIER[b.tier].think;
          let wait = ply < 2 ? rnd(900, 2200) : rnd(lo, hi);
          if (left != null) wait = Math.min(wait, Math.max(350, left * 0.06));
          due = { ply, at: now + wait };
          moveDue.set(row.id, due);
        }
        if (now < due.at) continue;
        const botVsBot = isHouseId(row.white_id) && isHouseId(row.black_id);
        if (botVsBot && ply >= MAX_PLY) {
          try { await call(b, 'POST', `/games/${row.id}/resign`); } catch { /* ignore */ }
          moveDue.delete(row.id);
          continue;
        }
        try {
          const mv = await chooseMove(b, row);
          if (mv) await call(b, 'POST', `/games/${row.id}/move`, mv);
        } catch (e) {
          if (e.status !== 400 && e.status !== 404) console.error('[housebots] move', row.id, e.message || e);
        }
        moveDue.set(row.id, { ply: -1, at: 0 }); // re-evaluated next tick against the new ply
      }
      if (moveDue.size > 200) for (const k of [...moveDue.keys()].slice(0, 100)) moveDue.delete(k);

      // 2) invitations addressed to a bot
      const invites = await db.prepare(`
        SELECT g.*, i.user_id AS bot_id FROM games g JOIN game_invites i ON i.game_id = g.id
        WHERE g.status = 'invited' AND i.user_id IN (${idsSql})
      `).all();
      for (const g of invites) {
        const b = botOf(g.bot_id);
        if (!b) continue;
        let at = acceptDue.get(g.id);
        if (!at) { at = now + rnd(2500, 7000); acceptDue.set(g.id, at); }
        if (now < at) continue;
        acceptDue.delete(g.id);
        try {
          if (on(b) && !rows.some((r) => Number(r.white_id) === b.id || Number(r.black_id) === b.id)) {
            await call(b, 'POST', `/games/${g.id}/join`, {});
            busy.add(b.id);
          } else {
            await call(b, 'POST', `/games/${g.id}/decline`);
          }
        } catch (e) { if (e.status !== 400 && e.status !== 404) console.error('[housebots] accept', e.message || e); }
      }
      if (acceptDue.size > 100) acceptDue.clear();

      // 3) a human searching for a quick match for a while → an idle bot of similar strength joins
      const open = await db.prepare(`
        SELECT * FROM games WHERE status = 'open' AND mode = 'online' AND creator_id < ${HOUSE_MIN}
          AND created_at < now() - interval '${OPEN_WAIT_S} seconds' ORDER BY created_at ASC LIMIT 5
      `).all();
      for (const g of open) {
        const creator = await db.prepare('SELECT * FROM users WHERE id = ?').get(g.creator_id);
        if (!creator) continue;
        const col = eloColumn(categoryOf(g.time_control));
        const delta = expandingEloDelta(new Date(g.created_at).getTime()) + 60;
        const cands = BOTS.filter((b) => on(b) && !busy.has(b.id)).map((b) => ({ b, d: Math.abs(b.elo - Number(creator[col] || creator.elo || 1200)) }))
          .filter((x) => x.d <= delta).sort((x, y) => x.d - y.d);
        if (!cands.length) continue;
        const pick = cands[0].b;
        try { await call(pick, 'POST', `/games/${g.id}/join`, {}); busy.add(pick.id); } catch { /* somebody else was faster */ }
      }

      // 4) bots play each other so there is always something to watch (only while real people are online)
      if (cfg.vsBots && now >= nextPairAt) {
        const humans = realtime.onlineIds().some((id) => !isHouseId(id));
        const botGames = rows.filter((r) => isHouseId(r.white_id) && isHouseId(r.black_id)).length;
        const free = BOTS.filter((b) => on(b) && !busy.has(b.id));
        if (humans && botGames < 1 && free.length >= 2) {
          const a = free.splice(Math.floor(Math.random() * free.length), 1)[0];
          const c = free[Math.floor(Math.random() * free.length)];
          try {
            await call(a, 'POST', '/games', { opponentId: c.id, timeControl: BOT_GAME_TCS[Math.floor(Math.random() * BOT_GAME_TCS.length)] });
          } catch (e) { if (e.status !== 409) console.error('[housebots] pair', e.message || e); }
          nextPairAt = now + rnd(8_000, 30_000);
        } else if (!humans) nextPairAt = now + 5_000;
      }

      // 5) friend requests to a bot are accepted
      if (now - lastFriends > 6_000) {
        lastFriends = now;
        const reqs = await db.prepare(`SELECT id, to_id FROM friend_requests WHERE status = 'pending' AND to_id IN (${idsSql}) LIMIT 10`).all();
        for (const r of reqs) {
          const b = botOf(r.to_id);
          if (!b || !on(b)) continue;
          try { await call(b, 'POST', `/friends/request/${r.id}/respond`, { accept: true }); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error('[housebots] tick', e.message || e);
    } finally { busyTick = false; }
  }

  async function start() {
    try {
      if (process.env.DISABLE_HOUSEBOTS === '1') return;
      await seed();
      applyPins(await getConfig(true));
      timer = setInterval(tick, TICK_MS);
      if (timer.unref) timer.unref();
    } catch (e) { console.error('[housebots] start', e.message || e); }
  }
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  async function adminView() {
    const cfg = await getConfig(true);
    const ids = BOTS.map((b) => b.id);
    const rows = await db.prepare(`SELECT id, elo, elo_blitz FROM users WHERE id IN (${ids.join(',')})`).all();
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const active = await db.prepare(`SELECT white_id, black_id FROM games WHERE status = 'active' AND (white_id IN (${idsSql}) OR black_id IN (${idsSql}))`).all();
    const playing = new Set(active.flatMap((g) => [Number(g.white_id), Number(g.black_id)]));
    return {
      vsBots: cfg.vsBots,
      bots: BOTS.map((b) => ({
        id: b.id, name: `${b.first} ${b.last}`, gender: b.gender, tier: b.tier, avatar: `char:${b.avatar}`,
        elo: Number((byId.get(b.id) || {}).elo || b.elo), enabled: !!cfg.enabled[String(b.id)], playing: playing.has(b.id),
      })),
    };
  }

  function register(admin, { wrap }) {
    admin.get('/housebots', wrap(async (_req, res) => res.json(await adminView())));
    admin.patch('/housebots', wrap(async (req, res) => {
      await saveConfig(req.body || {});
      res.json(await adminView());
    }));
  }

  return { start, stop, register, tick, isHouseId, BOTS };
}

module.exports = { create, isHouseId, HOUSE_MIN, BOTS };
