// Online tab: bot live spectate + Lichess international broadcasts.
import { Chess } from '/vendor/chess.js';
import { h, icon, haptic, api, fail, avatar, tg, pillBar } from './ui.js';
import { t } from './i18n.js';
import { Board } from './board.js';
import { openGame } from './game.js';
import { liveRoundPollMs, liveGamePollMs, liveClockTickMs, liveMiniBoardBudget, isLite } from './perf.js';

/** In-app circular back only (do not also show Telegram.BackButton — that doubles the control). */
function backBtn(onClick) {
  return h('button.round.back', { type: 'button', 'aria-label': t('back'), onclick: onClick }, icon('back', 22));
}

function hideTgBack() {
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch { /* ignore */ }
}

/** @typedef {'bot'|'intl'} LiveSection */
/** @type {LiveSection} */
let section = 'bot';
/** Navigation inside Halqaro: list → tour → round → game */
let nav = { view: 'list' };
let pollTimer = null;
let clockTimer = null;
let gameBoards = []; // mini boards to destroy on remount
let boardById = new Map(); // gameId → Board (in-place FEN updates)
let renderGen = 0; // abort stale async remounts after a tap opens another view

const UZ_FEDS = new Set(['UZB', 'UZ']);

function clearPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}
function destroyBoards() {
  for (const b of gameBoards) try { b.destroy(); } catch { /* ignore */ }
  gameBoards = [];
  boardById.clear();
}

/** Reliable single-tap that ignores page swipe / scroll jitter (inbox pattern). */
function bindTap(el, fn) {
  let last = 0;
  let sx = 0;
  let sy = 0;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    sx = e.clientX;
    sy = e.clientY;
  }, { passive: true });
  const fire = (e) => {
    if (Math.hypot((e.clientX || 0) - sx, (e.clientY || 0) - sy) > 14) return;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - last < 400) return;
    last = now;
    fn();
  };
  el.addEventListener('pointerup', fire);
  el.addEventListener('click', fire);
}

function setSection(s) {
  section = s;
  if (s === 'bot') nav = { view: 'list' };
}

function backIntl() {
  haptic('light');
  if (nav.view === 'game') {
    openRoundNav({
      tourId: nav.tourId, tourName: nav.tourName, tourSlug: nav.tourSlug,
      roundId: nav.roundId, roundName: nav.roundName, roundSlug: nav.roundSlug, roundUrl: nav.roundUrl,
      filter: nav.filter,
    });
  } else if (nav.view === 'round') {
    nav = { view: 'tour', tourId: nav.tourId, tourName: nav.tourName, tourSlug: nav.tourSlug };
  } else nav = { view: 'list' };
}

/** Lichess broadcast player.clock is centiseconds. */
function clockMsFromPlayer(p, thinkingSec = 0) {
  const cs = Number(p && p.clock);
  if (!Number.isFinite(cs)) return null;
  const think = Number(thinkingSec) || 0;
  return Math.max(0, cs * 10 - think * 1000);
}

function fmtClockMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fenTurn(fen) {
  const t = String(fen || '').split(/\s+/)[1];
  return t === 'b' ? 'b' : 'w';
}

function makeClockState(g) {
  const turn = fenTurn(g && g.fen);
  const think = g && g.status === '*' ? g.thinkTime : 0;
  return {
    whiteMs: clockMsFromPlayer(g && g.players && g.players[0], turn === 'w' ? think : 0),
    blackMs: clockMsFromPlayer(g && g.players && g.players[1], turn === 'b' ? think : 0),
    turn,
    at: Date.now(),
    active: !!(g && (!g.status || g.status === '*')),
  };
}

function liveSideMs(state, side) {
  if (!state) return null;
  let ms = side === 'w' ? state.whiteMs : state.blackMs;
  if (ms == null) return null;
  if (state.active && state.turn === side) ms -= Date.now() - state.at;
  return Math.max(0, ms);
}

function lastMoveObj(uci) {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function playerLabel(p) {
  if (!p) return '…';
  const title = p.title ? `${p.title} ` : '';
  const rating = p.rating != null ? ` (${p.rating})` : '';
  return `${title}${p.name || '…'}${rating}`;
}

function tourTitle(item) {
  return (item.group || (item.tour && item.tour.name) || '').replace(/\s*\|\s*.+$/, '') || (item.tour && item.tour.name) || 'Tournament';
}

function tourSubtitle(item) {
  const tour = item.tour || {};
  const name = tour.name || '';
  const pipe = name.indexOf('|');
  if (pipe >= 0) return name.slice(pipe + 1).trim();
  return (tour.info && tour.info.format) || '';
}

function startsLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return t('starts_at', { t: `${hh}:${mm}` });
}

function tabsEl(onRefresh) {
  return pillBar(
    [['bot', t('live_tab_bot')], ['intl', t('live_tab_intl')]],
    section,
    (s) => { setSection(s); onRefresh(); },
    { className: 'rank-tabs live-tabs' },
  );
}

function empty(text, ic) {
  return h('div.empty', ic ? h('div.empty-ic', ic) : null, text);
}

/** Build /lichess/rounds/:id URL with optional slug hints for Lichess. */
function roundApi(pathExtra = '', { fresh = false, game } = {}) {
  const id = nav.roundId;
  if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) {
    const err = new Error('Round not found');
    err.code = 'notfound';
    err.status = 404;
    throw err;
  }
  const q = new URLSearchParams();
  if (fresh) q.set('fresh', '1');
  if (nav.tourSlug) q.set('tourSlug', nav.tourSlug);
  if (nav.roundSlug) q.set('roundSlug', nav.roundSlug);
  if (nav.roundUrl) q.set('url', nav.roundUrl);
  if (game) q.set('game', game);
  const qs = q.toString();
  return `/lichess/rounds/${id}${pathExtra}${qs ? `?${qs}` : ''}`;
}

function openRoundNav(partial) {
  nav = {
    view: 'round',
    tourId: partial.tourId || nav.tourId,
    tourName: partial.tourName || nav.tourName,
    tourSlug: partial.tourSlug || nav.tourSlug,
    roundId: partial.roundId,
    roundName: partial.roundName || nav.roundName,
    roundSlug: partial.roundSlug || nav.roundSlug,
    roundUrl: partial.roundUrl || nav.roundUrl,
    filter: partial.filter || nav.filter || 'all',
  };
}

// ---------- Bot live games ----------
async function openSpectate(game, meta, onClose) {
  if (game.you) {
    openGame({ kind: 'online', game: (await api('GET', `/games/${game.id}`)).game, meta }, onClose);
    return;
  }
  const full = (await api('GET', `/live/games/${game.id}`)).game;
  if (full.you) {
    openGame({ kind: 'online', game: full, meta }, onClose);
    return;
  }
  openGame({ kind: 'spectate', game: full, meta }, onClose);
}

async function renderBot(mount, meta, onClose, onRefresh) {
  hideTgBack();
  let data;
  try { data = await api('GET', '/live/games'); }
  catch (e) {
    fail(e);
    return mount([
      tabsEl(onRefresh),
      empty(t('live_load_fail'), '🛰️'),
      h('button.btn', { onclick: () => onRefresh() }, t('retry_live')),
    ]);
  }
  const games = data.games || [];
  const nodes = [
    h('div.top', h('h1', t('live_title')), h('div.livepill', h('i.dot'), t('live_games_count', { n: games.length }))),
    tabsEl(onRefresh),
    h('div.h2', t('live_tab_bot'), h('span.count-pill', String(games.length))),
    games.length ? h('div.list', games.map((g) => {
      const w = g.white || {}, b = g.black || {};
      const mine = !!g.you;
      return h('button.row', {
        onclick: async () => {
          haptic('light');
          try { await openSpectate(g, meta, onClose); } catch (e) { fail(e); }
        },
      },
        h('div.avwrap', avatar(w.name || '?', w.id || 0, '', w.avatarKey || null), h('i.dot.on')),
        h('div.grow',
          h('div.t', `${w.name || '?'} – ${b.name || '?'}`),
          h('div.s', [
            t('watching_live'),
            g.timeControl && g.timeControl !== 'classic' ? ` · ${g.timeControl}` : '',
            mine ? ` · ${t('you')}` : '',
            ` · ${t('ply_n', { n: g.ply || 0 })}`,
          ].join(''))),
        icon('arrow', 18));
    })) : empty(t('live_no_bot_games'), '♟'),
  ];
  mount(nodes);
}

// ---------- Lichess tournaments ----------
function broadcastRow(item, onOpen) {
  const tour = item.tour || {};
  const round = item.round || {};
  const info = tour.info || {};
  const live = !!round.ongoing;
  const thumb = tour.image
    ? h('img.live-thumb', { src: tour.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
    : h('div.live-thumb.ph', '♟');
  const badge = live
    ? h('span.live-badge', h('i.dot'), t('jonli'))
    : h('span.live-badge.soon', startsLabel(round.startsAt));
  const detail = [
    round.name || '',
    info.location || '',
    info.tc ? String(info.tc).split('+')[0].trim() : '',
  ].filter(Boolean).join(' · ');
  const row = h('button.row.live-tour', { type: 'button', 'data-noswipe': '' },
    thumb,
    h('div.grow',
      badge,
      h('div.t', tourTitle(item)),
      h('div.s', tourSubtitle(item)),
      detail ? h('div.s', detail) : null,
      info.players ? h('div.s.live-players', icon('rankings', 14), ' ', info.players) : null),
    icon('arrow', 18));
  bindTap(row, () => onOpen(item));
  return row;
}

async function renderIntlList(mount, onRefresh) {
  hideTgBack();
  let data;
  try { data = await api('GET', '/lichess/broadcasts'); }
  catch (e) {
    fail(e);
    return mount([
      h('div.top', h('h1', t('live_title'))),
      tabsEl(onRefresh),
      empty(t('live_load_fail'), '🌐'),
      h('button.btn', { onclick: () => onRefresh() }, t('retry_live')),
    ]);
  }
  const active = data.active || [];
  const upcoming = data.upcoming || [];
  const all = [...active, ...upcoming];
  mount([
    h('div.top', h('h1', t('live_title')), h('div.livepill', h('i.dot'), t('jonli'))),
    tabsEl(onRefresh),
    h('div.h2', t('tournaments'), h('span.count-pill', t('count_ta', { n: all.length }))),
    all.length ? h('div.list', all.map((item) => broadcastRow(item, (it) => {
      haptic('light');
      const round = it.round || {};
      const tour = it.tour || {};
      if (!tour.id) { fail({ code: 'notfound' }); return; }
      const m = String(round.url || '').match(/\/broadcast\/([^/]+)\/([^/]+)\/([a-zA-Z0-9]{8})\b/);
      // Prefer opening the live round directly; fall back to tour page if id missing
      if (round.id && /^[a-zA-Z0-9]{8}$/.test(round.id)) {
        openRoundNav({
          tourId: tour.id,
          tourName: tourTitle(it),
          tourSlug: (m && m[1]) || tour.slug,
          roundId: round.id,
          roundName: round.name,
          roundSlug: (m && m[2]) || round.slug,
          roundUrl: round.url,
          filter: 'all',
        });
      } else {
        nav = {
          view: 'tour', tourId: tour.id, tourName: tourTitle(it),
          tourSlug: tour.slug, preferRound: round.id,
        };
      }
      onRefresh();
    }))) : empty(t('live_no_tours'), '🌐'),
  ]);
}

async function renderTour(mount, onRefresh) {
  let data;
  try { data = await api('GET', `/lichess/broadcasts/${nav.tourId}`); }
  catch (e) { fail(e); nav = { view: 'list' }; return onRefresh(); }
  const tour = data.tour || {};
  const rounds = data.rounds || [];
  const ongoing = rounds.find((r) => r.ongoing) || rounds.filter((r) => !r.finished).slice(-1)[0] || rounds[rounds.length - 1];
  const prefer = nav.preferRound && rounds.find((r) => r.id === nav.preferRound);
  const pick = prefer || ongoing;
  const goBack = () => { backIntl(); onRefresh(); };
  const openRound = (r) => {
    haptic('light');
    if (!r || !r.id || !/^[a-zA-Z0-9]{8}$/.test(r.id)) { fail({ code: 'notfound' }); return; }
    const m = String(r.url || '').match(/\/broadcast\/([^/]+)\/([^/]+)\/([a-zA-Z0-9]{8})\b/);
    openRoundNav({
      tourId: nav.tourId,
      tourName: nav.tourName || tour.name,
      tourSlug: (m && m[1]) || tour.slug || nav.tourSlug,
      roundId: r.id,
      roundName: r.name,
      roundSlug: (m && m[2]) || r.slug,
      roundUrl: r.url,
      filter: 'all',
    });
    onRefresh();
  };
  mount([
    h('div.top',
      backBtn(goBack),
      h('h1', nav.tourName || tour.name || t('live_tab_intl'))),
    tabsEl(onRefresh),
    h('div.card.live-tour-head',
      h('b', tour.name || nav.tourName),
      tour.info && tour.info.location ? h('div.muted', tour.info.location) : null,
      tour.info && tour.info.players ? h('div.muted', tour.info.players) : null),
    h('div.h2', t('rounds')),
    rounds.length ? h('div.list', rounds.slice().reverse().map((r) => h('button.row', {
      type: 'button',
      onclick: () => openRound(r),
    },
      h('div.grow',
        h('div.t', h('span.name', r.name)),
        h('div.s', r.ongoing ? t('jonli') : r.finished ? t('finished') : startsLabel(r.startsAt))),
      icon('arrow', 18)))) : empty(t('live_no_rounds'), '📅'),
    pick ? h('button.btn', {
      type: 'button',
      onclick: () => { haptic('medium'); openRound(pick); },
    }, pick.ongoing ? t('open_live_round', { n: pick.name }) : t('open_round', { n: pick.name })) : null,
  ]);
}

function miniBoard(fen, lastMove, gameId) {
  // Mini-board itself ignores pointers so the card can scroll/tap; card has data-noswipe for pager
  const host = h('div.live-mini-board');
  const chess = new Chess();
  try { chess.load(fen); } catch { /* keep start */ }
  const board = new Board(host, {});
  board.set(chess, { lastMove: lastMoveObj(lastMove), mine: null, orientation: 'w', animate: false });
  gameBoards.push(board);
  if (gameId) boardById.set(gameId, board);
  return host;
}

/** Lightweight stand-in when lite mode skips mounting many Board instances. */
function miniBoardPlaceholder() {
  return h('div.live-mini-board.live-mini-ph', { 'aria-hidden': 'true' });
}

function paintMiniFen(gameId, fen, lastMove) {
  const board = boardById.get(gameId);
  if (!board || !fen) return;
  const chess = new Chess();
  try { chess.load(fen); } catch { return; }
  board.set(chess, {
    lastMove: lastMoveObj(lastMove),
    mine: null,
    orientation: 'w',
    animate: !isLite(),
  });
}

function gameCard(g, onOpen, useMiniBoard) {
  const white = (g.players && g.players[0]) || {};
  const black = (g.players && g.players[1]) || {};
  const done = g.status && g.status !== '*';
  const ck = makeClockState(g);
  const status = done ? String(g.status) : t('moves_n', { n: fenPly(g.fen) });
  // div (not <button>) so iOS can scroll; data-noswipe stops horizontal pager stealing the tap
  const card = h('div.live-game-card', {
    role: 'button',
    tabindex: '0',
    'data-gid': g.id,
    'data-noswipe': '',
  },
    h('div.live-gc-player',
      h('span.fed', white.fed || ''),
      h('span.name', playerLabel(white)),
      h('span.clk.w', fmtClockMs(liveSideMs(ck, 'w')))),
    useMiniBoard ? miniBoard(g.fen || 'start', g.lastMove, g.id) : miniBoardPlaceholder(),
    h('div.live-gc-player',
      h('span.fed', black.fed || ''),
      h('span.name', playerLabel(black)),
      h('span.clk.b', fmtClockMs(liveSideMs(ck, 'b')))),
    h('div.live-gc-status' + (done ? '.done' : ''), status));
  bindTap(card, () => onOpen(g));
  return card;
}

function fenPly(fen) {
  const parts = String(fen || '').split(/\s+/);
  const n = Number(parts[5]);
  return Number.isFinite(n) ? Math.max(0, (n - 1) * 2 + (parts[1] === 'b' ? 1 : 0)) : 0;
}

function hasUz(g) {
  return (g.players || []).some((p) => UZ_FEDS.has(String(p.fed || '').toUpperCase()));
}

async function renderRound(mount, onRefresh) {
  const gen = ++renderGen;
  destroyBoards();
  clearPoll();
  let data;
  // Prefer cache — only force-fresh on explicit retry (nav._freshRound)
  const wantFresh = !!nav._freshRound;
  nav._freshRound = false;
  const goBack = () => { clearPoll(); backIntl(); onRefresh(); };
  try { data = await api('GET', roundApi('', { fresh: wantFresh })); }
  catch (e) {
    if (gen !== renderGen || nav.view !== 'round') return;
    fail(e);
    // Stay on this screen with retry — don't silently bounce to list
    return mount([
      h('div.top',
        backBtn(goBack),
        h('h1', nav.tourName || t('live_tab_intl'))),
      empty(t('live_load_fail'), '🌐'),
      h('button.btn', {
        type: 'button',
        onclick: () => { nav._freshRound = true; onRefresh(); },
      }, t('retry_live')),
    ]);
  }
  // User already opened a game (or left) while we were fetching — do not wipe that view
  if (gen !== renderGen || section !== 'intl' || nav.view !== 'round') return;

  // Keep slugs in sync from the payload for subsequent polls
  if (data.round) {
    nav.roundName = data.round.name || nav.roundName;
    nav.roundSlug = data.round.slug || nav.roundSlug;
    nav.roundUrl = data.round.url || nav.roundUrl;
  }
  if (data.tour) {
    nav.tourId = data.tour.id || nav.tourId;
    nav.tourName = data.tour.name || nav.tourName;
    nav.tourSlug = data.tour.slug || nav.tourSlug;
  }
  const games = data.games || [];
  const round = data.round || {};
  const tour = data.tour || {};
  const filter = nav.filter || 'all';
  const uzGames = games.filter(hasUz);
  const shown = filter === 'uz' ? uzGames : games;
  const live = !!round.ongoing;
  const clockMap = new Map(shown.map((g) => [g.id, makeClockState(g)]));
  const fenKey = new Map(shown.map((g) => [g.id, `${g.fen}|${g.lastMove}`]));

  const openGameCard = (game) => {
    haptic('light');
    clearPoll();
    renderGen += 1; // cancel any in-flight round remount
    nav = {
      view: 'game',
      tourId: nav.tourId, tourName: nav.tourName || tour.name, tourSlug: nav.tourSlug,
      roundId: nav.roundId, roundName: round.name || nav.roundName,
      roundSlug: nav.roundSlug, roundUrl: nav.roundUrl,
      gameId: game.id, filter, snap: game,
    };
    onRefresh();
  };

  let miniLeft = liveMiniBoardBudget();
  const grid = shown.length
    ? h('div.live-game-grid', shown.map((g) => {
      const useMini = miniLeft > 0;
      if (useMini) miniLeft -= 1;
      return gameCard(g, openGameCard, useMini);
    }))
    : empty(filter === 'uz' ? t('live_no_uz') : t('live_no_games'), '♟');

  mount([
    h('div.top',
      backBtn(goBack),
      h('h1', tour.name || nav.tourName || t('live_tab_intl'))),
    tabsEl(() => { clearPoll(); onRefresh(); }),
    h('div.card.live-tour-head',
      h('b', tour.name || nav.tourName),
      h('div.muted', [
        tourSubtitle({ tour }),
        round.name ? ` · ${round.name}` : '',
        live ? ` · ${t('jonli')}` : '',
      ].filter(Boolean).join(''))),
    pillBar(
      [['all', t('filter_all', { n: games.length })], ['uz', t('filter_uz', { n: uzGames.length })]],
      filter,
      (f) => { nav = { ...nav, filter: f }; onRefresh(); },
      { className: 'live-filters' },
    ),
    grid,
  ]);

  if (!live) return;

  // Tick card clocks locally between polls
  clockTimer = setInterval(() => {
    if (section !== 'intl' || nav.view !== 'round') return clearPoll();
    for (const [id, st] of clockMap) {
      const card = grid.querySelector && grid.querySelector(`[data-gid="${id}"]`);
      if (!card) continue;
      const w = card.querySelector('.clk.w');
      const b = card.querySelector('.clk.b');
      if (w) w.textContent = fmtClockMs(liveSideMs(st, 'w'));
      if (b) b.textContent = fmtClockMs(liveSideMs(st, 'b'));
    }
  }, liveClockTickMs());

  // Soft poll: clocks + mini-board FEN in place (slower on Android / lite)
  pollTimer = setInterval(async () => {
    if (section !== 'intl' || nav.view !== 'round') return clearPoll();
    try {
      const next = await api('GET', roundApi('', { fresh: false }));
      for (const g of next.games || []) {
        const st = makeClockState(g);
        clockMap.set(g.id, st);
        const card = grid.querySelector && grid.querySelector(`[data-gid="${g.id}"]`);
        if (!card) continue;
        const w = card.querySelector('.clk.w');
        const b = card.querySelector('.clk.b');
        if (w) w.textContent = fmtClockMs(liveSideMs(st, 'w'));
        if (b) b.textContent = fmtClockMs(liveSideMs(st, 'b'));
        const statusEl = card.querySelector('.live-gc-status');
        if (statusEl) {
          const done = g.status && g.status !== '*';
          statusEl.textContent = done ? String(g.status) : t('moves_n', { n: fenPly(g.fen) });
          statusEl.classList.toggle('done', !!done);
        }
        const key = `${g.fen}|${g.lastMove}`;
        if (fenKey.get(g.id) !== key) {
          fenKey.set(g.id, key);
          paintMiniFen(g.id, g.fen, g.lastMove);
        }
      }
    } catch { /* ignore transient poll errors — keep last good UI */ }
  }, liveRoundPollMs());
}

function parsePgnMoves(pgn) {
  const chess = new Chess();
  try {
    // strip tags / comments / clock NAGs roughly
    const body = String(pgn || '').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\d+\.(\.\.)?/g, ' ');
    for (const tok of body.split(/\s+/)) {
      if (!tok || tok === '*' || tok === '1-0' || tok === '0-1' || tok === '1/2-1/2') continue;
      try { chess.move(tok); } catch { break; }
    }
  } catch { /* ignore */ }
  return chess.history({ verbose: true });
}

async function renderGame(mount, onRefresh) {
  const gen = ++renderGen;
  destroyBoards();
  clearPoll();
  let snap = nav.snap;
  try {
    const round = await api('GET', roundApi('', { fresh: false }));
    if (gen !== renderGen || nav.view !== 'game') return;
    snap = (round.games || []).find((g) => g.id === nav.gameId) || snap;
    nav.snap = snap;
    if (round.round) {
      nav.roundName = round.round.name || nav.roundName;
      nav.roundSlug = round.round.slug || nav.roundSlug;
      nav.roundUrl = round.round.url || nav.roundUrl;
    }
  } catch { /* keep snap */ }
  if (gen !== renderGen || nav.view !== 'game') return;
  if (!snap) {
    fail({ code: 'notfound' });
    openRoundNav({
      tourId: nav.tourId, tourName: nav.tourName, tourSlug: nav.tourSlug,
      roundId: nav.roundId, roundName: nav.roundName, roundSlug: nav.roundSlug, roundUrl: nav.roundUrl,
      filter: nav.filter,
    });
    return onRefresh();
  }

  let moves = [];
  try {
    const p = await api('GET', roundApi('/pgn', { fresh: false, game: nav.gameId }));
    if (gen !== renderGen || nav.view !== 'game') return;
    if (p.game && p.game.pgn) moves = parsePgnMoves(p.game.pgn);
  } catch { /* fen-only fallback — board still works from FEN */ }
  if (gen !== renderGen || nav.view !== 'game') return;

  const cursor = { i: moves.length }; // at live tip when i === moves.length
  let clockState = makeClockState(snap);
  let lastKey = `${snap.fen}|${snap.lastMove}|${snap.status}`;
  let pgnBusy = false;
  const ongoing = !(snap.status && snap.status !== '*');

  const host = h('div.board-host.live-full-board');
  const status = h('div.pz-status.live-turn', '');
  const moveStrip = h('div.moves');
  const topName = h('b', playerLabel(snap.players[1]));
  const botName = h('b', playerLabel(snap.players[0]));
  const topFed = h('span.live-fed', snap.players[1].fed || '');
  const botFed = h('span.live-fed', snap.players[0].fed || '');
  const nameHue = (n) => [...String(n || '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const topAv = avatar(snap.players[1].name || '?', nameHue(snap.players[1].name), '');
  const botAv = avatar(snap.players[0].name || '?', nameHue(snap.players[0].name), '');
  topAv.classList.add('pav');
  botAv.classList.add('pav');
  const topClk = h('span.live-clk', fmtClockMs(liveSideMs(clockState, 'b')));
  const botClk = h('span.live-clk', fmtClockMs(liveSideMs(clockState, 'w')));
  const board = new Board(host, {});
  gameBoards.push(board);

  const atLiveTip = () => cursor.i >= moves.length;

  const paintStatus = () => {
    if (snap.status && snap.status !== '*') {
      status.textContent = t('result_label', { r: snap.status });
      status.classList.remove('turn-w', 'turn-b');
      return;
    }
    const side = fenTurn(snap.fen);
    status.textContent = side === 'w' ? t('turn_white') : t('turn_black');
    status.classList.toggle('turn-w', side === 'w');
    status.classList.toggle('turn-b', side === 'b');
  };

  const paintClocks = () => {
    topClk.textContent = fmtClockMs(liveSideMs(clockState, 'b'));
    botClk.textContent = fmtClockMs(liveSideMs(clockState, 'w'));
    topClk.classList.toggle('low', (liveSideMs(clockState, 'b') || 0) <= 20000);
    botClk.classList.toggle('low', (liveSideMs(clockState, 'w') || 0) <= 20000);
    topClk.classList.toggle('on', clockState.active && clockState.turn === 'b');
    botClk.classList.toggle('on', clockState.active && clockState.turn === 'w');
  };

  const showAt = (i, animate = true) => {
    cursor.i = Math.max(0, Math.min(i, moves.length));
    const c = new Chess();
    let last = null;
    if (moves.length) {
      for (let k = 0; k < cursor.i; k++) last = c.move(moves[k]);
      last = last ? { from: last.from, to: last.to } : null;
    } else if (snap.fen) {
      try { c.load(snap.fen); } catch { /* ignore */ }
      last = lastMoveObj(snap.lastMove);
    }
    board.set(c, { lastMove: last, mine: null, orientation: board.orientation, animate });
    const san = c.history();
    moveStrip.replaceChildren(...san.map((m, idx) => h('span' + (idx === san.length - 1 ? '.cur' : ''), idx % 2 === 0 ? `${idx / 2 + 1}. ${m}` : m)));
    moveStrip.scrollLeft = moveStrip.scrollWidth;
    paintStatus();
  };

  const applySnap = (g, { animate = true } = {}) => {
    if (!g) return;
    const key = `${g.fen}|${g.lastMove}|${g.status}`;
    const changed = key !== lastKey;
    snap = g;
    nav.snap = g;
    clockState = makeClockState(g);
    lastKey = key;
    topName.textContent = playerLabel(g.players[1]);
    botName.textContent = playerLabel(g.players[0]);
    topFed.textContent = g.players[1].fed || '';
    botFed.textContent = g.players[0].fed || '';
    paintClocks();
    paintStatus();
    if (!changed) return;
    if (atLiveTip()) {
      // Jump board to live FEN immediately, then refresh PGN for the move list (cached)
      const c = new Chess();
      try { c.load(g.fen); } catch { return; }
      board.set(c, { lastMove: lastMoveObj(g.lastMove), mine: null, orientation: board.orientation, animate });
      refreshPgn(false);
    }
  };

  const refreshPgn = async (force) => {
    if (pgnBusy) return;
    pgnBusy = true;
    try {
      const p = await api('GET', roundApi('/pgn', { fresh: !!force, game: nav.gameId }));
      if (p.game && p.game.pgn) {
        const next = parsePgnMoves(p.game.pgn);
        if (next.length !== moves.length || force) {
          const follow = atLiveTip();
          moves = next;
          if (follow) showAt(moves.length, true);
        }
      }
    } catch { /* ignore */ }
    finally { pgnBusy = false; }
  };

  showAt(moves.length, false);
  paintClocks();
  paintStatus();

  const topBar = h('div.pbar.top.live-pbar',
    topAv,
    h('div.pinfo', topName, h('small', topFed)),
    topClk);
  const botBar = h('div.pbar.bot.live-pbar',
    botAv,
    h('div.pinfo', botName, h('small', botFed)),
    botClk);

  const navBtns = h('div.pz-actions.live-move-nav',
    h('button.mini', { type: 'button', onclick: () => { haptic('select'); showAt(0); } }, '⏮'),
    h('button.mini', { type: 'button', onclick: () => { haptic('select'); showAt(cursor.i - 1); } }, '◀'),
    h('button.mini', { type: 'button', onclick: () => { haptic('select'); showAt(cursor.i + 1); } }, '▶'),
    h('button.mini', { type: 'button', onclick: () => { haptic('select'); showAt(moves.length); } }, '⏭'));
  const flipBtn = h('button.btn.ghost.sm.live-flip', {
    type: 'button',
    onclick: () => {
      board.orientation = board.orientation === 'w' ? 'b' : 'w';
      haptic('light');
      showAt(cursor.i, false);
    },
  }, icon('flip', 18), t('flip'));

  const goBack = () => {
    clearPoll(); destroyBoards(); renderGen += 1; backIntl(); onRefresh();
  };

  const whiteShort = (snap.players[0].name || '').split(',')[0] || '…';
  const blackShort = (snap.players[1].name || '').split(',')[0] || '…';
  mount([
    h('div.live-watch',
      h('div.top',
        backBtn(goBack),
        h('h1', `${whiteShort} – ${blackShort}`),
        ongoing
          ? h('span.live-badge', h('i.dot'), t('jonli'))
          : (nav.roundName ? h('span.count-pill', nav.roundName) : null)),
      topBar, host, botBar, status, moveStrip, navBtns, flipBtn),
  ]);

  // Smooth local clock drain (like Lichess / reference app)
  clockTimer = setInterval(() => {
    if (section !== 'intl' || nav.view !== 'game' || gen !== renderGen) return clearPoll();
    paintClocks();
  }, liveClockTickMs());

  // Board/clock snapshots (Android / lite poll slower; iOS stays ~2s)
  let polls = 0;
  const gamePoll = liveGamePollMs();
  pollTimer = setInterval(async () => {
    if (section !== 'intl' || nav.view !== 'game' || gen !== renderGen) return clearPoll();
    polls += 1;
    try {
      const round = await api('GET', roundApi('', { fresh: false }));
      const g = (round.games || []).find((x) => x.id === nav.gameId);
      if (g) applySnap(g);
      // PGN less often on slow devices
      if (polls % (isLite() ? 4 : 3) === 0) refreshPgn(false);
    } catch { /* ignore transient errors */ }
  }, gamePoll);
}

/**
 * Main entry for the Online tab.
 * @param {(nodes: any[]) => void} mount
 * @param {{ me: any, botUsername: string, reactions: string[] }} meta
 * @param {() => void} onCloseGame
 * @param {() => void} onRefresh
 */
export async function renderLivePage(mount, meta, onCloseGame, onRefresh) {
  destroyBoards();
  if (section === 'bot') {
    clearPoll();
    return renderBot(mount, meta, onCloseGame, onRefresh);
  }
  if (nav.view === 'tour') return renderTour(mount, onRefresh);
  if (nav.view === 'round') return renderRound(mount, onRefresh);
  if (nav.view === 'game') return renderGame(mount, onRefresh);
  return renderIntlList(mount, onRefresh);
}

export function resetLiveNav() {
  clearPoll();
  destroyBoards();
  section = 'bot';
  nav = { view: 'list' };
}

/** Intl pages poll/refresh themselves — skip the global 8s remount (avoids request storms). */
export function liveBlocksAutoRefresh() {
  return section === 'intl';
}

/** Play hub → Tournaments: open Halqaro (Lichess) section, not bot spectate. */
export function openLiveTournaments() {
  setSection('intl');
  nav = { view: 'list' };
}
