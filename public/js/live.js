// Online tab: bot live spectate + Lichess international broadcasts.
import { Chess } from '/vendor/chess.js';
import { h, icon, haptic, api, fail, avatar } from './ui.js';
import { t } from './i18n.js';
import { Board } from './board.js';
import { openGame } from './game.js';

/** @typedef {'bot'|'intl'} LiveSection */
/** @type {LiveSection} */
let section = 'bot';
/** Navigation inside Halqaro: list → tour → round → game */
let nav = { view: 'list' };
let pollTimer = null;
let gameBoards = []; // mini boards to destroy on remount

const UZ_FEDS = new Set(['UZB', 'UZ']);

function clearPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function destroyBoards() {
  for (const b of gameBoards) try { b.destroy(); } catch { /* ignore */ }
  gameBoards = [];
}

function setSection(s) {
  section = s;
  if (s === 'bot') nav = { view: 'list' };
  haptic('select');
}

function backIntl() {
  haptic('light');
  if (nav.view === 'game') nav = { view: 'round', tourId: nav.tourId, roundId: nav.roundId, roundName: nav.roundName, tourName: nav.tourName, filter: nav.filter };
  else if (nav.view === 'round') nav = { view: 'tour', tourId: nav.tourId, tourName: nav.tourName };
  else nav = { view: 'list' };
}

function fmtClockMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
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
  return h('div.rank-tabs.live-tabs',
    h('button.rank-tab' + (section === 'bot' ? '.on' : ''), {
      onclick: () => { setSection('bot'); onRefresh(); },
    }, t('live_tab_bot')),
    h('button.rank-tab' + (section === 'intl' ? '.on' : ''), {
      onclick: () => { setSection('intl'); onRefresh(); },
    }, t('live_tab_intl')),
  );
}

function empty(text, ic) {
  return h('div.empty', ic ? h('div.empty-ic', ic) : null, text);
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
  let data;
  try { data = await api('GET', '/live/games'); }
  catch (e) { fail(e); return mount([tabsEl(onRefresh), empty(t('live_load_fail'), '🛰️')]); }
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
        h('div.avwrap', avatar(w.name || '?', w.id || 0), h('i.dot.on')),
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
  return h('button.row.live-tour', { onclick: () => onOpen(item) },
    thumb,
    h('div.grow',
      badge,
      h('div.t', tourTitle(item)),
      h('div.s', tourSubtitle(item)),
      detail ? h('div.s', detail) : null,
      info.players ? h('div.s.live-players', icon('rankings', 14), ' ', info.players) : null),
    icon('arrow', 18));
}

async function renderIntlList(mount, onRefresh) {
  let data;
  try { data = await api('GET', '/lichess/broadcasts'); }
  catch (e) { fail(e); return mount([
    h('div.top', h('h1', t('live_title'))),
    tabsEl(onRefresh),
    empty(t('live_load_fail'), '🌐'),
  ]); }
  const active = data.active || [];
  const upcoming = data.upcoming || [];
  const all = [...active, ...upcoming];
  mount([
    h('div.top', h('h1', t('live_title')), h('div.livepill', h('i.dot'), t('jonli'))),
    tabsEl(onRefresh),
    h('div.h2', t('tournaments'), h('span.count-pill', t('count_ta', { n: all.length }))),
    all.length ? h('div.list', all.map((item) => broadcastRow(item, (it) => {
      haptic('light');
      nav = { view: 'tour', tourId: it.tour.id, tourName: tourTitle(it), preferRound: it.round && it.round.id };
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
  mount([
    h('div.top',
      h('button.mini.back', { 'aria-label': t('back'), onclick: () => { backIntl(); onRefresh(); } }, icon('back', 18)),
      h('h1', nav.tourName || tour.name || t('live_tab_intl'))),
    tabsEl(onRefresh),
    h('div.card.live-tour-head',
      h('b', tour.name || nav.tourName),
      tour.info && tour.info.location ? h('div.muted', tour.info.location) : null,
      tour.info && tour.info.players ? h('div.muted', tour.info.players) : null),
    h('div.h2', t('rounds')),
    rounds.length ? h('div.list', rounds.slice().reverse().map((r) => h('button.row', {
      onclick: () => {
        haptic('light');
        nav = { view: 'round', tourId: nav.tourId, tourName: nav.tourName || tour.name, roundId: r.id, roundName: r.name, filter: 'all' };
        onRefresh();
      },
    },
      h('div.grow',
        h('div.t', r.name),
        h('div.s', r.ongoing ? t('jonli') : r.finished ? t('finished') : startsLabel(r.startsAt))),
      icon('arrow', 18)))) : empty(t('live_no_rounds'), '📅'),
    pick ? h('button.btn', {
      onclick: () => {
        haptic('medium');
        nav = { view: 'round', tourId: nav.tourId, tourName: nav.tourName || tour.name, roundId: pick.id, roundName: pick.name, filter: 'all' };
        onRefresh();
      },
    }, pick.ongoing ? t('open_live_round', { n: pick.name }) : t('open_round', { n: pick.name })) : null,
  ]);
}

function miniBoard(fen, lastMove) {
  const host = h('div.live-mini-board', { 'data-noswipe': '' });
  const chess = new Chess();
  try { chess.load(fen); } catch { /* keep start */ }
  const board = new Board(host, {});
  board.set(chess, { lastMove: lastMoveObj(lastMove), mine: null, orientation: 'w', animate: false });
  gameBoards.push(board);
  return host;
}

function gameCard(g, onOpen) {
  const white = (g.players && g.players[0]) || {};
  const black = (g.players && g.players[1]) || {};
  const done = g.status && g.status !== '*';
  const status = done ? String(g.status) : t('moves_n', { n: fenPly(g.fen) });
  return h('button.live-game-card', { onclick: () => onOpen(g) },
    h('div.live-gc-player',
      h('span.fed', white.fed || ''),
      h('span.name', playerLabel(white)),
      h('span.clk', fmtClockMs(white.clock))),
    miniBoard(g.fen || 'start', g.lastMove),
    h('div.live-gc-player',
      h('span.fed', black.fed || ''),
      h('span.name', playerLabel(black)),
      h('span.clk', fmtClockMs(black.clock))),
    h('div.live-gc-status' + (done ? '.done' : ''), status));
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
  destroyBoards();
  let data;
  try { data = await api('GET', `/lichess/rounds/${nav.roundId}`); }
  catch (e) { fail(e); nav = { view: 'tour', tourId: nav.tourId, tourName: nav.tourName }; return onRefresh(); }
  const games = data.games || [];
  const round = data.round || {};
  const tour = data.tour || {};
  const filter = nav.filter || 'all';
  const uzGames = games.filter(hasUz);
  const shown = filter === 'uz' ? uzGames : games;
  const live = !!round.ongoing;

  // Soft-poll while round page is open
  clearPoll();
  if (live) {
    pollTimer = setInterval(() => {
      if (section !== 'intl' || nav.view !== 'round') return clearPoll();
      onRefresh();
    }, 6000);
  }

  mount([
    h('div.top',
      h('button.mini.back', { 'aria-label': t('back'), onclick: () => { clearPoll(); backIntl(); onRefresh(); } }, icon('back', 18)),
      h('h1', tour.name || nav.tourName || t('live_tab_intl'))),
    tabsEl(() => { clearPoll(); onRefresh(); }),
    h('div.card.live-tour-head',
      h('b', tour.name || nav.tourName),
      h('div.muted', [
        tourSubtitle({ tour }),
        round.name ? ` · ${round.name}` : '',
        live ? ` · ${t('jonli')}` : '',
      ].filter(Boolean).join(''))),
    h('div.live-filters',
      h('button.live-filter' + (filter === 'all' ? '.on' : ''), {
        onclick: () => { nav = { ...nav, filter: 'all' }; haptic('select'); onRefresh(); },
      }, t('filter_all', { n: games.length })),
      h('button.live-filter' + (filter === 'uz' ? '.on' : ''), {
        onclick: () => { nav = { ...nav, filter: 'uz' }; haptic('select'); onRefresh(); },
      }, t('filter_uz', { n: uzGames.length }))),
    shown.length
      ? h('div.live-game-grid', shown.map((g) => gameCard(g, (game) => {
        haptic('light');
        clearPoll();
        nav = {
          view: 'game', tourId: nav.tourId, tourName: nav.tourName || tour.name,
          roundId: nav.roundId, roundName: round.name || nav.roundName,
          gameId: game.id, filter, snap: game,
        };
        onRefresh();
      })))
      : empty(filter === 'uz' ? t('live_no_uz') : t('live_no_games'), '♟'),
  ]);
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
  destroyBoards();
  clearPoll();
  let snap = nav.snap;
  // refresh snap from round
  try {
    const round = await api('GET', `/lichess/rounds/${nav.roundId}`);
    snap = (round.games || []).find((g) => g.id === nav.gameId) || snap;
    nav.snap = snap;
  } catch { /* keep snap */ }

  let moves = [];
  try {
    const p = await api('GET', `/lichess/rounds/${nav.roundId}/pgn?game=${encodeURIComponent(nav.gameId)}`);
    if (p.game && p.game.pgn) moves = parsePgnMoves(p.game.pgn);
  } catch { /* fen-only fallback */ }

  const white = (snap && snap.players && snap.players[0]) || {};
  const black = (snap && snap.players && snap.players[1]) || {};
  const cursor = { i: moves.length }; // at live position
  const host = h('div.board-host.live-full-board', { 'data-noswipe': '' });
  const status = h('div.pz-status', '');
  const moveStrip = h('div.moves');
  const chess = new Chess();
  if (moves.length) {
    for (const m of moves) chess.move(m);
  } else if (snap && snap.fen) {
    try { chess.load(snap.fen); } catch { /* start */ }
  }
  const board = new Board(host, {});
  gameBoards.push(board);

  const showAt = (i, animate = true) => {
    cursor.i = Math.max(0, Math.min(i, moves.length));
    const c = new Chess();
    let last = null;
    for (let k = 0; k < cursor.i; k++) { last = c.move(moves[k]); }
    if (!moves.length && snap && snap.fen) {
      try { c.load(snap.fen); } catch { /* ignore */ }
      last = lastMoveObj(snap.lastMove);
      last = last ? { from: last.from, to: last.to } : null;
    } else if (last) last = { from: last.from, to: last.to };
    board.set(c, { lastMove: last, mine: null, orientation: board.orientation, animate });
    const san = c.history();
    moveStrip.replaceChildren(...san.map((m, idx) => h('span' + (idx === san.length - 1 ? '.cur' : ''), idx % 2 === 0 ? `${idx / 2 + 1}. ${m}` : m)));
    moveStrip.scrollLeft = moveStrip.scrollWidth;
    const done = snap && snap.status && snap.status !== '*';
    status.textContent = done ? t('result_label', { r: snap.status }) : t('watching');
  };
  showAt(moves.length, false);

  const topBar = h('div.pbar.top',
    h('div.pinfo', h('b', playerLabel(black)), h('small', [black.fed, fmtClockMs(black.clock)].filter(Boolean).join(' · '))));
  const botBar = h('div.pbar.bot',
    h('div.pinfo', h('b', playerLabel(white)), h('small', [white.fed, fmtClockMs(white.clock)].filter(Boolean).join(' · '))));

  const navBtns = h('div.pz-actions.live-move-nav',
    h('button.mini', { onclick: () => { haptic('select'); showAt(0); } }, '⏮'),
    h('button.mini', { onclick: () => { haptic('select'); showAt(cursor.i - 1); } }, '◀'),
    h('button.mini', { onclick: () => { haptic('select'); showAt(cursor.i + 1); } }, '▶'),
    h('button.mini', { onclick: () => { haptic('select'); showAt(moves.length); } }, '⏭'),
    h('button.mini', {
      onclick: () => {
        board.orientation = board.orientation === 'w' ? 'b' : 'w';
        haptic('light');
        showAt(cursor.i, false);
      },
    }, t('flip')));

  // poll live fen/clocks
  pollTimer = setInterval(async () => {
    if (section !== 'intl' || nav.view !== 'game') return clearPoll();
    try {
      const round = await api('GET', `/lichess/rounds/${nav.roundId}`);
      const g = (round.games || []).find((x) => x.id === nav.gameId);
      if (!g) return;
      nav.snap = g;
      topBar.querySelector('b').textContent = playerLabel(g.players[1]);
      topBar.querySelector('small').textContent = [g.players[1].fed, fmtClockMs(g.players[1].clock)].filter(Boolean).join(' · ');
      botBar.querySelector('b').textContent = playerLabel(g.players[0]);
      botBar.querySelector('small').textContent = [g.players[0].fed, fmtClockMs(g.players[0].clock)].filter(Boolean).join(' · ');
      if (cursor.i >= moves.length) {
        // stay on live tip — reload pgn occasionally when at end
        try {
          const p = await api('GET', `/lichess/rounds/${nav.roundId}/pgn?game=${encodeURIComponent(nav.gameId)}`);
          if (p.game && p.game.pgn) {
            const next = parsePgnMoves(p.game.pgn);
            if (next.length >= moves.length) { moves = next; showAt(moves.length); return; }
          }
        } catch { /* ignore */ }
        if (g.fen) {
          const c = new Chess();
          try { c.load(g.fen); } catch { return; }
          board.set(c, { lastMove: lastMoveObj(g.lastMove), mine: null, orientation: board.orientation, animate: true });
        }
      }
      if (g.status && g.status !== '*') status.textContent = t('result_label', { r: g.status });
    } catch { /* ignore */ }
  }, 4000);

  mount([
    h('div.top',
      h('button.mini.back', { 'aria-label': t('back'), onclick: () => { clearPoll(); destroyBoards(); backIntl(); onRefresh(); } }, icon('back', 18)),
      h('h1', `${(white.name || '').split(',')[0] || '…'} – ${(black.name || '').split(',')[0] || '…'}`),
      nav.roundName ? h('span.count-pill', nav.roundName) : null),
    status, topBar, host, botBar, moveStrip, navBtns,
  ]);
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

/** Round/game pages poll themselves — skip the global 8s remount. */
export function liveBlocksAutoRefresh() {
  return section === 'intl' && (nav.view === 'round' || nav.view === 'game');
}
