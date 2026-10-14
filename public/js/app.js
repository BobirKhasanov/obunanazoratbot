// Main app: boot, swipe pager, pages, deep links.
import { h, $, $$, icon, haptic, toast, sheet, seg, api, fail, setInitData, connectWs, onWs, tg, avatar, sleep } from './ui.js';
import { t, setLang } from './i18n.js';
import { openGame, savedAiGame, openGameId } from './game.js';
import { Chess } from '/vendor/chess.js';
import { Board, restyleBoards } from './board.js';
import { PUZZLES, goodMoves, mateIn } from './puzzles.js';
import { normalizeTimeControl } from './time.js';
import { renderLivePage, liveBlocksAutoRefresh } from './live.js';
import { PIECE_SETS, BOARD_THEMES } from './pieces.js';
import { restyleOpenGame } from './game.js';
import { renderProfilePage } from './profile.js';
import { closeScreen } from './screen.js';
import { loadAnnouncements, mountAnnouncementsCarousel, stopAnnouncementsCarousel } from './announcements.js';

const state = { me: null, stats: null, meta: null, lobby: null, friends: null, index: 0, tab: 'play' };
let selectedTime = 'any';
const TABS = ['play', 'puzzles', 'rankings', 'live', 'profile'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const gameMeta = () => ({ me: { id: state.me.id, name: state.me.firstName }, botUsername: state.meta.botUsername, reactions: state.meta.REACTIONS });
/** Exact home-screen preset sent to the server (Any → untimed classic). */
const selectedPreset = () => normalizeTimeControl(selectedTime === 'any' ? 'classic' : selectedTime);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const bg = theme === 'light' ? '#f3f5f9' : '#111827';
  try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); tg.setBottomBarColor && tg.setBottomBarColor(bg); } catch { /* old client */ }
  const m = $('meta[name=color-scheme]'); if (m) m.content = theme;
}

function applyChessStyle(pieceSet, boardTheme) {
  const root = document.documentElement;
  root.dataset.pieces = PIECE_SETS.includes(pieceSet) ? pieceSet : 'outline';
  root.dataset.board = BOARD_THEMES.includes(boardTheme) ? boardTheme : 'classic';
  restyleBoards();
  try { restyleOpenGame(); } catch { /* no open game */ }
}

function canStyleChess(me) {
  return !!(me && (me.premium || me.isAdmin));
}

const page = (name) => $(`.page[data-page="${name}"]`);
function mount(name, ...nodes) {
  const p = page(name);
  const top = p.scrollTop;
  p.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  p.scrollTop = top;
  p.classList.add('seen');
}
const empty = (text, ic) => h('div.empty', ic ? h('div.empty-ic', ic) : null, text);
const rowBtn = (...kids) => h('button.row', ...kids);

const stat = (n, label, color) => h('div.stat', h('b' + (color ? '.' + color : ''), String(n)), h('small', label));
const sumStats = (s) => ({ w: s.online.w + s.ai.w, d: s.online.d + s.ai.d, l: s.online.l + s.ai.l });

// ---------- data ----------
async function loadLobby() { const l = await api('GET', '/lobby'); state.lobby = l; state.stats = l.stats; return l; }
async function loadFriends() { state.friends = (await api('GET', '/friends')).friends; return state.friends; }
const refreshers = {};
let busyRefresh = false, again = null;
async function refresh(which = state.tab) {
  if (busyRefresh) { again = which; return; } // run once more when the current load finishes
  busyRefresh = true;
  try { await refreshers[which](); } catch (e) { if (e.code !== 'net') fail(e); } finally {
    busyRefresh = false;
    if (again) { const w = again; again = null; refresh(state.tab === w ? w : state.tab); }
  }
}

// ---------- actions ----------
const openOnline = (g) => openGame({ kind: 'online', game: g, meta: gameMeta() }, () => refresh());
const rankingCategory = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classic: 'Classic' };
let selectedRanking = 'bullet';
async function startQuick() {
  try { const r = await api('POST', '/games/quick', { timeControl: selectedPreset() }); openOnline(r.game); } catch (e) { fail(e); }
}
async function startFriendGame() {
  try { const r = await api('POST', '/games', { timeControl: selectedPreset() }); openOnline(r.game); } catch (e) { fail(e); }
}
async function challenge(id) {
  try {
    const r = await api('POST', '/games', { opponentId: id, timeControl: selectedPreset() });
    haptic('success');
    showChallengeSent(r.game, 10000);
    refresh();
  } catch (e) { fail(e); }
}
async function cancelChallenge(gameId) {
  try { await api('DELETE', `/games/${gameId}`); toast(t('challenge_cancelled')); } catch (e) { fail(e); }
  refresh();
}
/** Challenge / Cancel button for an online (or friend) row */
function challengeAction(u) {
  if (u.invited && u.inviteGameId) {
    return h('button.mini', { onclick: () => cancelChallenge(u.inviteGameId) }, t('cancel'));
  }
  return h('button.mini.ok', { disabled: !!u.inGame || u.online === false, onclick: () => challenge(u.id) }, t('challenge'));
}
async function openById(id) {
  try {
    const r = await api('GET', `/games/${id}`);
    if (r.game.joinable) return joinGame(id);
    if (r.game.status === 'invited' && r.game.invitedId === state.me.id) { go(0, true); return refresh('play'); }
    if (r.game.status === 'cancelled') return toast(t('join_failed'), true);
    openOnline(r.game);
  } catch (e) { fail(e); }
}
async function joinGame(id) {
  try { const r = await api('POST', `/games/${id}/join`); openOnline(r.game); } catch (e) { toast(t('join_failed'), true); }
}
function startAi(level, colour) {
  const col = colour === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colour;
  const S = openGame({ kind: 'ai', level, colour: col, meta: gameMeta() }, () => refresh());
  S.onStats = (s) => { state.stats = s; };
}
function resumeAi() {
  const s = savedAiGame(); if (!s) return;
  const S = openGame({ kind: 'ai', level: s.level, colour: s.colour, resume: s, meta: gameMeta() }, () => refresh());
  S.onStats = (st) => { state.stats = st; };
}

function aiSheet() {
  let level = 2, colour = 'w';
  sheet((close) => {
    const levels = h('div.levels');
    const draw = () => levels.replaceChildren(...[1, 2, 3, 4].map((n) => h('button.lvl' + (n === level ? '.on' : ''), { onclick: () => { level = n; haptic('select'); draw(); } },
      h('div.lvl-bars', ...[1, 2, 3, 4].map((i) => h('i' + (i <= n ? '.f' : '')))),
      h('div', h('b', t('lvl' + n)), h('small', t('lvl' + n + '_d'))))));
    draw();
    return [
      h('h2', t('vs_computer')),
      h('div.label', t('level')), levels,
      h('div.label', t('play_as')),
      seg([['w', '♔ ' + t('white')], ['r', '🎲 ' + t('random')], ['b', '♚ ' + t('black')]], colour, (v) => { colour = v; }),
      h('button.btn', { onclick: () => { close(); setTimeout(() => startAi(level, colour), 120); } }, t('start')),
    ];
  });
}

const playerRow = (u, close) => h('div.row', h('div.avwrap', avatar(u.name, u.id), h('i.dot.on')),
  h('div.grow', h('div.t', u.name, u.friend ? h('span.star', ' ★') : null), h('div.s', u.inGame ? t('in_game') : t('online'))),
  u.invited && u.inviteGameId
    ? h('button.mini', { onclick: () => cancelChallenge(u.inviteGameId) }, t('cancel'))
    : h('button.mini.ok', { disabled: u.inGame, onclick: () => { close(); challenge(u.id); } }, t('challenge')));

/** "Play online": choose any online player to challenge, or get a random opponent */
function onlineSheet() {
  let alive = true; let timer;
  sheet((close) => {
    const list = h('div.list');
    const load = async () => {
      try {
        const l = await api('GET', '/lobby');
        if (!alive) return;
        list.replaceChildren(...(l.online.length ? l.online.map((u) => playerRow(u, close)) : [empty(t('nobody'), '🛰️')]));
      } catch (e) { /* keep the old list */ }
    };
    load(); timer = setInterval(load, 4000);
    return [
      h('h2', t('pick_player')),
      h('button.btn.sm.ghost.rand', { onclick: () => { close(); startQuick(); } }, icon('globe', 18), t('random_opp')),
      h('div.sheet-list', list),
    ];
  }, { onClose: () => { alive = false; clearInterval(timer); } });
}

function newGameSheet() {
  sheet((close) => [
    h('h2', t('new_game')),
    h('div.stack',
      tile(t('vs_computer'), t('vs_computer_sub'), 'cpu', () => { close(); setTimeout(aiSheet, 200); }, true),
      tile(t('play_online'), t('quick_sub'), 'globe', () => { close(); setTimeout(onlineSheet, 200); }),
      tile(t('with_friend'), t('friend_sub'), 'friends', () => { close(); startFriendGame(); })),
  ]);
}
const tile = (title, sub, ic, fn, hero) => h('button.tile' + (hero ? '.hero' : ''), { onclick: () => { haptic('light'); fn(); } },
  h('b', title), h('small', sub), icon(ic, 26));

// ---------- pages ----------
const gameRow = (g, kind) => {
  const o = g.opponent || {};
  const mine = g.you && g.turn === g.you;
  return rowBtn({ onclick: () => openOnline(g) }, avatar(o.name || '?', o.id || 0),
    h('div.grow', h('div.t', o.name || '…'), h('div.s', kind === 'recent' ? resultText(g) : g.status === 'active' ? (mine ? t('your_turn') : t('their_turn')) : t('waiting_opp'))),
    kind === 'active' && mine ? h('span.pill', '●') : icon('arrow', 18));
};
const resultText = (g) => {
  if (g.status !== 'finished') return '';
  const r = g.result === '1/2-1/2' ? t('draw_title') : (g.result === '1-0') === (g.you === 'w') ? t('you_won') : t('you_lost');
  return r;
};

let playSnap = '';
refreshers.play = async function renderPlay() {
  const [l, anns] = await Promise.all([loadLobby(), loadAnnouncements(api)]);
  const saved = savedAiGame();
  const onlinePlayers = l.online.filter((u) => !u.inGame);
  // Skip full remount when nothing visible changed — stops home-page flicker every poll.
  const snap = JSON.stringify({
    t: selectedTime,
    d: state.me.diamonds || 0,
    o: l.onlineCount,
    inv: (l.games.invites || []).map((g) => g.id),
    act: (l.games.active || []).map((g) => [g.id, g.turn, g.you]),
    wait: (l.games.waiting || []).map((g) => g.id),
    on: onlinePlayers.map((u) => [u.id, !!u.invited, !!u.inGame, !!u.friend]),
    sav: saved ? [saved.level, saved.fen] : null,
    ann: (anns || []).map((a) => [a.id, a.title, a.body, a.mediaId, a.linkType, a.endsAt]),
  });
  const playEl = page('play');
  if (snap === playSnap && playEl && playEl.classList.contains('seen') && playEl.childElementCount) {
    const pill = playEl.querySelector('.livepill');
    if (pill) pill.replaceChildren(h('i.dot'), t('online_now', { n: l.onlineCount }));
    const gem = playEl.querySelector('.gempill');
    if (gem) gem.textContent = '💎 ' + (state.me.diamonds || 0);
    return;
  }
  playSnap = snap;
  stopAnnouncementsCarousel();

  const controls = [
    ['1+0', '1+0', 'Bullet'],
    ['3+2', '3+2', 'Blitz'],
    ['5+0', '5+0', 'Blitz'],
    ['10+0', '10+0', 'Rapid'],
    ['15+10', '15+10', 'Rapid'],
    ['any', t('any_time'), t('any_time_sub')],
  ];
  const modes = h('div.time-grid', controls.map(([id, label, sub]) =>
    h('button.time-option' + (selectedTime === id ? '.selected' : ''), {
      onclick: () => { selectedTime = id; playSnap = ''; haptic('select'); refresh('play'); }
    }, h('b', label), h('small', sub))
  ));
  const banner = (cls, emoji, title, sub, fn) => h('button.home-banner.' + cls, { onclick: () => { haptic('light'); fn(); } },
    h('div.home-banner-text', h('b', title), h('small', sub)), h('span.home-banner-art', emoji));
  const card = (emoji, label, fn) => h('button.pcard', { onclick: () => { haptic('light'); fn(); } }, h('span.pcard-art', emoji), h('b', label));
  const annHost = h('div.ann-carousel', { hidden: true, 'data-noswipe': '' });
  const nodes = [
    h('div.top', h('h1', '♟ ' + t('app')), h('div.pills', h('button.gempill', { onclick: () => go(TABS.indexOf('profile'), true) }, '💎 ' + (state.me.diamonds || 0)), h('div.livepill', h('i.dot'), t('online_now', { n: l.onlineCount })))),
    annHost,
    banner('violet', '🧩', t('home_puzzle'), t('puzzles_sub'), () => go(TABS.indexOf('puzzles'), true)),
    h('div.time-heading', t('choose_time')),
    modes,
    banner('azure', '🏆', t('home_rank'), t('home_rank_sub'), () => go(TABS.indexOf('rankings'), true)),
    h('div.pcards',
      card('🌐', t('play_card_online'), onlineSheet),
      card('🤝', t('play_card_friend'), startFriendGame),
      card('🤖', t('play_card_ai'), aiSheet)),
    h('div.play-cta', h('button.cta', { onclick: () => { haptic('medium'); startQuick(); } }, t('play_btn'))),
    l.games.invites.length ? [h('div.h2', t('invites')), h('div.list', l.games.invites.map((g) => h('div.row.invite',
      avatar(g.opponent.name, g.opponent.id), h('div.grow', h('div.t', g.opponent.name), h('div.s', t('challenge'))),
      h('button.mini.ok', { onclick: async () => { try { const r = await api('POST', '/games/' + g.id + '/join'); openOnline(r.game); } catch (e) { fail(e); refresh(); } } }, icon('check', 18)),
      h('button.mini', { onclick: async () => { try { await api('POST', '/games/' + g.id + '/decline'); } catch (e) { fail(e); } playSnap = ''; refresh(); } }, icon('x', 18)))))] : null,
    onlinePlayers.length ? [h('div.h2.online-heading', t('online_players'), h('span.count-pill', String(onlinePlayers.length))),
      h('div.list', onlinePlayers.map((u) => h('div.row', h('div.avwrap', avatar(u.name, u.id), h('i.dot.on')),
        h('div.grow', h('div.t', u.name, u.friend ? h('span.star', ' ★') : null), h('div.s', u.invited ? t('challenge_sent') : t('online'))),
        challengeAction(u))))] : null,
    saved || l.games.active.length || l.games.waiting.length ? [h('div.h2', t('continue')), h('div.list',
      saved ? rowBtn({ onclick: resumeAi }, h('div.avatar.ai', icon('cpu', 22)), h('div.grow', h('div.t', t('computer') + ' · ' + t('lvl' + saved.level)), h('div.s', t('resume'))), icon('arrow', 18)) : null,
      l.games.active.map((g) => gameRow(g, 'active')), l.games.waiting.map((g) => gameRow(g, 'wait')))] : null,
  ];
  mount('play', nodes);
  if (state.tab === 'play') {
    await mountAnnouncementsCarousel(annHost, anns, {
      botUsername: state.meta?.botUsername,
      userId: state.me?.id,
      onPage: (page) => {
        if (['play', 'puzzles', 'rankings', 'live', 'profile'].includes(page)) go(TABS.indexOf(page), true);
        else if (page === 'premium' || page === 'friends' || page === 'settings') {
          go(TABS.indexOf('profile'), true);
          setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail: page })), 520);
        }
      },
    });
  }
};
refreshers.live = async function renderLive() {
  await renderLivePage(
    (nodes) => mount('live', nodes),
    gameMeta(),
    () => refresh('live'),
    () => refresh('live'),
  );
};

refreshers.rankings = async function renderRankings() {
  const categories = ['bullet', 'blitz', 'rapid', 'classic'];
  let data;
  try { data = await api('GET', '/rankings?category=' + selectedRanking); }
  catch (e) { fail(e); return; }
  const tabs = h('div.rank-tabs', categories.map((category) => h('button.rank-tab' + (category === selectedRanking ? '.on' : ''), {
    onclick: () => { selectedRanking = category; haptic('select'); refresh('rankings'); }
  }, rankingCategory[category])));
  const rows = data.rankings || [];
  mount('rankings',
    h('div.top', h('h1', '♜ ' + t('rankings_title')), h('div.livepill', h('i.dot'), t('rankings_live'))),
    tabs,
    h('div.card.rank-summary', h('div.rank-summary-title', rankingCategory[selectedRanking] + ' · ' + t('rankings_title')), h('div.muted', t('rankings_points_hint'))),
    rows.length ? h('div.list.rank-list', rows.map((p) => h('div.row.rank-row',
      h('div.rank-place' + (p.rank <= 3 ? '.podium-' + p.rank : ''), p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : String(p.rank)),
      h('div.grow', h('div.t', p.name, p.id === state.me.id ? h('span.star', ' · ' + t('you')) : null),
        h('div.s', t('rank_record', { w: p.wins, d: p.draws, l: p.losses }))),
      h('div.rank-points', h('b', String(p.points)), h('small', t('points')))))) : empty(t('rankings_empty'), '♟'),
    h('div.rank-footnote', t('rankings_scoring'))
  );
};

// ---------- puzzles (mate in 1-2, checked on the device) ----------
const PZ_KEY = 'chess-puzzles-solved';
const solvedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(PZ_KEY)) || []); } catch { return new Set(); } };
const markSolved = (id) => { try { const s = solvedSet(); s.add(id); localStorage.setItem(PZ_KEY, JSON.stringify([...s])); } catch { /* storage blocked */ } };
let pz = null; // the puzzle on screen, or null for the list

function puzzleList() {
  const done = solvedSet();
  mount('puzzles',
    h('div.top', h('h1', '🧩 ' + t('puzzles_title')), h('div.livepill', t('puzzle_solved_count', { a: PUZZLES.filter((p) => done.has(p.id)).length, b: PUZZLES.length }))),
    h('div.muted.pz-sub', t('puzzles_sub')),
    h('div.list', PUZZLES.map((p, i) => rowBtn({ onclick: () => { haptic('light'); openPuzzle(i); } },
      h('div.pz-num' + (done.has(p.id) ? '.done' : ''), done.has(p.id) ? icon('check', 18) : String(i + 1)),
      h('div.grow', h('div.t', t('puzzle_n', { n: i + 1 })), h('div.s', t('mate_in', { n: p.n }) + ' · ' + (new Chess(p.fen).turn() === 'w' ? t('puzzle_white') : t('puzzle_black')))),
      icon('arrow', 18)))));
}

function openPuzzle(i) {
  if (pz && pz.board) pz.board.destroy();
  const puzzle = PUZZLES[i];
  const chess = new Chess(puzzle.fen);
  const colour = chess.turn();
  const status = h('div.pz-status', t(colour === 'w' ? 'puzzle_white' : 'puzzle_black'));
  const host = h('div.board-host', { 'data-noswipe': '' });
  const actions = h('div.pz-actions');
  const state2 = { puzzle, i, chess, left: puzzle.n, locked: false };
  let board = null;
  const say = (text, cls) => { status.textContent = text; status.className = 'pz-status' + (cls ? ' ' + cls : ''); };
  const draw = (lastMove) => board.set(chess, { orientation: colour, mine: state2.locked ? null : colour, lastMove, animate: true });
  const buttons = (solved) => actions.replaceChildren(
    h('button.btn.ghost.sm', { onclick: () => openPuzzle(i) }, t('puzzle_retry')),
    solved ? (i + 1 < PUZZLES.length ? h('button.btn.sm', { onclick: () => openPuzzle(i + 1) }, t('puzzle_next')) : h('button.btn.sm', { onclick: closePuzzle }, t('puzzle_back')))
      : h('button.btn.ghost.sm', { onclick: () => { const g = goodMoves(chess, state2.left)[0]; if (g) board.showHint({ from: g.from, to: g.to }); } }, t('puzzle_hint')));
  const onMove = async (from, to, promotion) => {
    if (state2.locked) return;
    const good = goodMoves(chess, state2.left);
    const mv = good.find((m) => m.from === from && m.to === to && (m.promotion || undefined) === (promotion || undefined));
    if (!mv) { say(t('puzzle_wrong'), 'bad'); haptic('error'); draw(); return; }
    chess.move({ from, to, promotion });
    state2.locked = true; draw({ from, to });
    if (chess.isCheckmate()) { markSolved(puzzle.id); say(t('puzzle_done'), 'ok'); haptic('success'); buttons(true); return; }
    say(t('puzzle_continue'), 'ok'); haptic('light');
    await sleep(550);
    const replies = chess.moves({ verbose: true });
    const r = replies[Math.floor(Math.random() * replies.length)];
    chess.move(r); state2.left -= 1; state2.locked = false; draw({ from: r.from, to: r.to });
    say(t(colour === 'w' ? 'puzzle_white' : 'puzzle_black'));
  };
  pz = state2;
  mount('puzzles',
    h('div.top', h('button.mini.back', { 'aria-label': t('puzzle_back'), onclick: closePuzzle }, icon('arrow', 18)),
      h('h1', t('puzzle_n', { n: i + 1 })), h('div.livepill', t('mate_in', { n: puzzle.n }))),
    host, status, actions);
  board = state2.board = new Board(host, { onMove });
  draw(); buttons(false);
}
function closePuzzle() { if (pz && pz.board) pz.board.destroy(); pz = null; haptic('light'); puzzleList(); }
refreshers.puzzles = async function renderPuzzles() { if (!pz) puzzleList(); };

refreshers.profile = async function renderProfile() {
  const st = state.stats || (await api('GET', '/me')).stats; state.stats = st;
  await loadFriends();
  mount('profile', ...renderProfilePage({
    state,
    challengeAction,
    gameRow,
    goTab: (name) => { closeScreen(true); go(TABS.indexOf(name), true); },
    rebuildAll,
    refresh: () => refresh('profile'),
  }));
};

// Incoming / outgoing challenge banners (in-app only, ~10 s)
let popTimer = null;
function clearInvitePop() {
  const old = $('.invite-pop'); if (old) { old.classList.remove('show'); setTimeout(() => old.remove(), 400); }
  clearTimeout(popTimer);
}
function showInvite(g, ttl) {
  clearInvitePop();
  const o = g.opponent || {};
  const done = () => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 400); clearTimeout(popTimer); };
  const bar = h('i.pbar-fill'); bar.style.animationDuration = `${ttl}ms`;
  const pop = h('div.invite-pop', avatar(o.name || '?', o.id || 0),
    h('div.grow', h('b', t('challenge_from', { name: o.name || '' }))),
    h('button.mini.ok', { 'aria-label': t('accept'), onclick: async () => { done(); try { const r = await api('POST', `/games/${g.id}/join`); openOnline(r.game); } catch (e) { fail(e); refresh(); } } }, icon('check', 20)),
    h('button.mini', { 'aria-label': t('decline'), onclick: async () => { done(); try { await api('POST', `/games/${g.id}/decline`); } catch { /* expired */ } refresh(); } }, icon('x', 20)),
    h('div.pbar-track', bar));
  document.body.append(pop); haptic('success');
  requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('show')));
  popTimer = setTimeout(done, ttl);
}
/** Same style as the invitee banner: confirm the challenge was sent, allow cancel */
function showChallengeSent(g, ttl) {
  clearInvitePop();
  const o = g.opponent || {};
  const done = () => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 400); clearTimeout(popTimer); };
  const bar = h('i.pbar-fill'); bar.style.animationDuration = `${ttl}ms`;
  const pop = h('div.invite-pop', avatar(o.name || '?', o.id || 0),
    h('div.grow', h('b', t('challenge_to', { name: o.name || '' }))),
    h('button.mini', { 'aria-label': t('cancel'), onclick: async () => { done(); await cancelChallenge(g.id); } }, t('cancel')),
    h('div.pbar-track', bar));
  document.body.append(pop);
  requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('show')));
  popTimer = setTimeout(done, ttl);
}

// ---------- pager + nav ----------
let go = () => {};
function initPager() {
  const pager = $('#pager'), track = $('#track'), ind = $('#nav-ind'), nav = $('#nav');
  ind.style.width = `calc((100% - 12px) / ${TABS.length})`;
  const btns = TABS.map((k, i) => {
    const b = h('button.nav-btn', { 'aria-label': t('nav_' + k), onclick: () => { haptic('select'); go(i, true); } }, icon(k, 22), h('span', t('nav_' + k)));
    nav.append(b); return b;
  });
  let W = pager.clientWidth;
  const setX = (px) => { track.style.transform = `translate3d(${px}px,0,0)`; };
  go = (i, animate) => {
    const prev = state.index;
    state.index = clamp(i, 0, TABS.length - 1); state.tab = TABS[state.index];
    if (state.index !== prev) {
      closeScreen(true);
      if (prev === TABS.indexOf('play')) { stopAnnouncementsCarousel(); playSnap = ''; }
      if (state.tab === 'play') playSnap = '';
    }
    track.classList.toggle('settle', !!animate); ind.classList.remove('drag');
    setX(-state.index * W);
    ind.style.transform = `translateX(${state.index * 100}%)`;
    btns.forEach((b, j) => b.classList.toggle('active', j === state.index));
    // smooth scroll pages to top when switching tabs
    if (state.index !== prev) {
      const p = page(state.tab);
      if (p) p.scrollTo({ top: 0, behavior: animate ? 'smooth' : 'auto' });
      refresh();
    }
  };
  addEventListener('resize', () => { W = pager.clientWidth; go(state.index, false); });
  let drag = null;
  pager.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-noswipe], input, textarea, select')) return; drag = { x: e.clientX, y: e.clientY, t: performance.now(), mode: null, dx: 0, id: e.pointerId }; });
  pager.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) { drag.mode = 'h'; try { pager.setPointerCapture(drag.id); } catch { /* ignore */ } track.classList.remove('settle'); ind.classList.add('drag'); }
      else if (Math.abs(dy) > 8) { drag = null; return; } else return;
    }
    drag.dx = dx;
    const atEdge = (state.index === 0 && dx > 0) || (state.index === TABS.length - 1 && dx < 0);
    const eff = atEdge ? dx * 0.28 : dx; // rubber band at the ends
    setX(-state.index * W + eff);
    ind.style.transform = `translateX(${(state.index - eff / W) * 100}%)`;
  });
  const finish = () => {
    if (!drag) return; const d = drag; drag = null; if (d.mode !== 'h') return;
    const v = d.dx / Math.max(1, performance.now() - d.t);
    let next = state.index;
    if (Math.abs(d.dx) > W * 0.2 || Math.abs(v) > 0.45) next = state.index + (d.dx < 0 ? 1 : -1);
    if (next !== state.index) haptic('select');
    go(next, true);
  };
  pager.addEventListener('pointerup', finish); pager.addEventListener('pointercancel', finish);
  go(0, false);
}

function rebuildNav() {
  $('#nav').querySelectorAll('.nav-btn').forEach((b, i) => { b.querySelector('span:last-child').textContent = t('nav_' + TABS[i]); b.setAttribute('aria-label', t('nav_' + TABS[i])); });
}
function rebuildAll() { if (pz && pz.board) pz.board.destroy(); pz = null; rebuildNav(); $$('.page').forEach((p) => p.classList.remove('seen')); refresh(); }

// ---------- deep links ----------
async function handleDeepLink() {
  const q = new URLSearchParams(location.search);
  const p = q.get('p') || (tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
  const gid = q.get('game');
  history.replaceState(null, '', location.pathname);
  if (/^i\d{1,15}$/.test(p)) {
    try {
      const r = await api('POST', '/friends/join', { userId: Number(p.slice(1)) });
      if (r.user) state.me = r.user;
      if (r.inviteeReward) {
        toast(t('invitee_reward', { n: r.inviteeReward, name: r.friend.name }));
        haptic('success');
      } else toast(t('friend_added', { name: r.friend.name }));
      go(TABS.indexOf('profile'), true);
    } catch (e) { fail(e); }
  } else if (/^g[\w-]{4,20}$/.test(p)) await joinGame(p.slice(1));
  else if (gid && /^[\w-]{4,20}$/.test(gid)) await openById(gid);
}

// ---------- boot ----------
async function boot() {
  if (!tg || !tg.initData) { $('#gate').hidden = false; return; }
  setInitData(tg.initData);
  tg.ready(); tg.expand();
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* old client */ }
  let me;
  try { me = await api('GET', '/me'); } catch (e) { $('#gate').hidden = false; $('#gate h1').textContent = (await import('./i18n.js')).errText(e); return; }
  state.me = me.user; state.stats = me.stats; state.meta = me.meta;
  setLang(me.user.lang); applyTheme(me.user.theme);
  if (canStyleChess(me.user)) applyChessStyle(me.user.pieceSet, me.user.boardTheme);
  else applyChessStyle('outline', 'classic');
  $('#gate').hidden = true; $('#app').hidden = false;
  initPager();
  connectWs((up) => { if (up) refresh(); });
  onWs((m) => {
    if (m.t === 'invite') { showInvite(m.game, m.ttl || 10000); refresh('play'); }
    else if (m.t === 'friend') { haptic('success'); if (m.reward) { state.me.diamonds = (state.me.diamonds || 0) + m.reward; toast(t('friend_reward', { n: m.reward })); } refresh(); }
    else if (m.t === 'game') {
      // Opponent accepted while we stayed on the list — open the board only when the game starts
      if (m.game.status === 'active' && m.game.id !== openGameId()) { clearInvitePop(); openOnline(m.game); }
      else if (m.game.id !== openGameId()) refresh();
    } else if (m.t === 'invite_gone') { clearInvitePop(); refresh(); }
  });
  setInterval(() => {
    if (document.hidden || openGameId()) return;
    if (state.tab === 'live' && liveBlocksAutoRefresh()) return;
    if (['live', 'play', 'rankings', 'profile'].includes(state.tab)) refresh();
  }, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  await refresh();
  await handleDeepLink();
}
boot();
