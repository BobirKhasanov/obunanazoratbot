// Main app: boot, swipe pager, pages, deep links.
import { h, $, $$, icon, haptic, toast, sheet, seg, pillBar, api, fail, setInitData, connectWs, onWs, sendBye, tg, avatar, avBlock, premIc, sleep } from './ui.js';
import { t, setLang } from './i18n.js';

/** Lazy inbox — a missing/404 asset must never blank the whole Mini App. */
let inboxMod = null;
async function loadInbox() {
  if (inboxMod) return inboxMod;
  try { inboxMod = await import('./inbox.js?v=20261015b'); } catch (e) { console.warn('[inbox]', e); inboxMod = null; }
  return inboxMod;
}
async function openInbox(kind) {
  haptic('light');
  const m = await loadInbox();
    if (!m) { toast(t('msg_unavailable')); return; }
  try {
    if (kind === 'messages') m.openMessages();
    else m.openNotifications();
  } catch (e) { console.warn('[inbox]', e); fail(e); }
}
function headerInboxBtnsSafe() {
  const stop = (e) => { e.stopPropagation(); };
  const mail = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('messages'),
    'data-noswipe': '',
    onpointerdown: stop,
    onclick: (e) => { stop(e); openInbox('messages'); },
  }, icon('mail', 20), h('span.hdr-badge-slot'));
  const bell = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('xabarnoma'),
    'data-noswipe': '',
    onpointerdown: stop,
    onclick: (e) => { stop(e); openInbox('notifications'); },
  }, icon('bell', 20), h('span.hdr-badge-slot'));
  const wrap = h('div.hdr-inbox', { 'data-noswipe': '' }, mail, bell);
  refreshInboxBadgesSafe(wrap);
  return wrap;
}
function refreshInboxBadgesSafe(root) {
  loadInbox().then((m) => { try { m && m.refreshInboxBadges(root); } catch { /* ignore */ } });
}
import { openGame, savedAiGame, openGameId } from './game.js';
import { Chess } from '/vendor/chess.js';
import { Board, restyleBoards } from './board.js';
import { PUZZLES, goodMoves, mateIn } from './puzzles.js';
import { normalizeTimeControl, formatTashkentWhen } from './time.js';
import { renderLivePage, liveBlocksAutoRefresh } from './live.js';
import { PIECE_SETS, BOARD_THEMES } from './pieces.js';
import { restyleOpenGame } from './game.js';
import { renderProfilePage, openUserProfile } from './profile.js';
import { closeScreen } from './screen.js';
import { loadAnnouncements, mountAnnouncementsCarousel, stopAnnouncementsCarousel, CAROUSEL_STAGGER_MS } from './announcements.js';
import { createPlayFlow } from './playflow.js';

const state = { me: null, stats: null, meta: null, lobby: null, friends: null, index: 0, tab: 'play' };
let selectedTime = 'any';
const TABS = ['play', 'puzzles', 'rankings', 'live', 'profile'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const gameMeta = () => ({ me: { id: state.me.id, name: state.me.firstName }, botUsername: state.meta.botUsername, reactions: state.meta.REACTIONS });
/** Exact home-screen preset sent to the server (Any → untimed classic). */
const selectedPreset = () => normalizeTimeControl(selectedTime === 'any' ? 'classic' : selectedTime);

let playFlow;
function ensurePlayFlow() {
  if (playFlow) return playFlow;
  playFlow = createPlayFlow({
    getState: () => state,
    openOnline,
    startFriendGame,
    aiSheet,
    goTab: (name) => go(TABS.indexOf(name), true),
    setSelectedTime: (id) => { selectedTime = id; playSnap = ''; },
    getSelectedTime: () => selectedTime,
  });
  return playFlow;
}

function setPlaySticky(show) {
  const el = $('#play-sticky');
  if (!el) return;
  let btn = el.querySelector('.cta');
  if (!btn) {
    btn = h('button.cta', {
      type: 'button',
      onclick: () => { ensurePlayFlow().open(); },
    }, t('play_btn'));
    el.append(btn);
  } else {
    btn.textContent = t('play_btn');
  }
  el.classList.toggle('show', !!show);
  el.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function themeBg(theme) {
  return theme === 'light' ? '#f3f5f9' : '#111827';
}

function syncTgChrome(theme = document.documentElement.dataset.theme || 'dark') {
  const bg = themeBg(theme);
  try {
    tg.setHeaderColor(bg);
    tg.setBackgroundColor(bg);
    if (tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch { /* old client */ }
  // Keep DOM shells in sync — Telegram expand otherwise flashes native black
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
  const app = $('#app');
  if (app) app.style.background = bg;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncTgChrome(theme);
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
const rankingCategory = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classic: 'Classic', all: 'All' };
let selectedRankingBoard = 'elo';
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
  const blocked = !!u.inGame || u.online === false || u.discoverable === false;
  return h('button.mini.ok', { disabled: blocked, onclick: () => challenge(u.id) }, t('challenge'));
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

const playerRow = (u, close) => h('div.row',
  avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true }),
  h('div.grow',
    h('div.t', h('span.name', u.name), u.premium ? premIc() : null, u.friend ? h('span.star', ' ★') : null),
    h('div.s', u.inGame ? t('in_game') : t('online'))),
  u.invited && u.inviteGameId
    ? h('button.mini', { onclick: () => cancelChallenge(u.inviteGameId) }, t('cancel'))
    : h('button.mini.ok', {
      disabled: !!u.inGame || u.discoverable === false,
      onclick: () => { close(); challenge(u.id); },
    }, t('challenge')));

/** "Play online": choose any online player to challenge, or get a random opponent */
function onlineSheet() {
  let alive = true; let timer;
  sheet((close) => {
    const list = h('div.list');
    const load = async () => {
      try {
        const l = await api('GET', '/lobby');
        if (!alive) return;
        list.replaceChildren(...(l.online.length
          ? l.online.map((u) => h('div.row',
            h('button.plain', {
              type: 'button',
              onclick: () => { close(); openUserProfile(u.id, { onChallenge: (x) => challenge(x.id) }); },
            }, avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true })),
            h('button.grow.plain', {
              type: 'button',
              onclick: () => { close(); openUserProfile(u.id, { onChallenge: (x) => challenge(x.id) }); },
            },
              h('div.t', h('span.name', u.name), u.premium ? premIc() : null),
              h('div.s', u.inGame ? t('in_game') : t('online'))),
            challengeAction(u)))
          : [empty(t('nobody'), '🛰️')]));
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
  const when = formatTashkentWhen(g.updatedAt);
  return when ? `${r} · ${when}` : r;
};

let playSnap = '';
refreshers.play = async function renderPlay() {
  const [l, anns, puzzleAnns] = await Promise.all([
    loadLobby(),
    loadAnnouncements(api, 'home'),
    loadAnnouncements(api, 'puzzle'),
  ]);
  const saved = savedAiGame();
  // Full lobby list (free + in-game), same people as the Online sheet
  const onlinePlayers = l.online || [];
  // Skip full remount when nothing visible changed — stops home-page flicker every poll.
  const snap = JSON.stringify({
    t: selectedTime,
    d: state.me.diamonds || 0,
    o: l.onlineCount,
    inv: (l.games.invites || []).map((g) => g.id),
    act: (l.games.active || []).map((g) => [g.id, g.turn, g.you]),
    wait: (l.games.waiting || []).map((g) => g.id),
    on: onlinePlayers.map((u) => [u.id, !!u.invited, !!u.inGame, !!u.friend, !!u.premium]),
    sav: saved ? [saved.level, saved.fen] : null,
    ann: (anns || []).map((a) => [a.id, a.title, a.body, a.mediaId, a.linkType, a.endsAt]),
    pz: (puzzleAnns || []).map((a) => [a.id, a.title, a.body, a.mediaId, a.linkType, a.endsAt]),
  });
  const playEl = page('play');
  if (snap === playSnap && playEl && playEl.classList.contains('seen') && playEl.childElementCount) {
    const pill = playEl.querySelector('.online-heading .livepill');
    if (pill) pill.replaceChildren(h('i.dot'), t('online_now', { n: l.onlineCount }));
    const gem = playEl.querySelector('.gempill');
    if (gem) gem.textContent = '💎 ' + (state.me.diamonds || 0);
    refreshInboxBadgesSafe(playEl);
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
  const puzzleHost = h('div.ann-carousel.ann-puzzle', { hidden: true, 'data-noswipe': '' });
  const openProfile = (id) => openUserProfile(id, {
    onChallenge: (u) => challenge(u.id),
    refreshHome: () => { playSnap = ''; refresh('play'); },
  });
  const onlineBlock = [
    h('div.h2.online-heading', t('online_players'),
      h('div.livepill', h('i.dot'), t('online_now', { n: l.onlineCount }))),
    onlinePlayers.length
      ? h('div.list.home-online', ...onlinePlayers.map((u) => h('div.row',
        h('button.plain', { type: 'button', onclick: () => openProfile(u.id) },
          avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true })),
        h('button.grow.plain', { type: 'button', onclick: () => openProfile(u.id) },
          h('div.t', h('span.name', u.name), u.premium ? premIc() : null, u.friend ? h('span.star', ' ★') : null),
          h('div.s', u.invited ? t('challenge_sent') : (u.inGame ? t('in_game') : t('online')))),
        challengeAction(u))))
      : empty(t('nobody'), '🛰️'),
  ];
  const puzzleFallback = banner('violet', '🧩', t('home_puzzle'), t('puzzles_sub'), () => go(TABS.indexOf('puzzles'), true));
  const nodes = [
    h('div.top',
      h('h1', '♟ ' + t('app')),
      h('div.pills',
        h('button.gempill', { onclick: () => go(TABS.indexOf('profile'), true) }, '💎 ' + (state.me.diamonds || 0)),
        headerInboxBtnsSafe())),
    annHost,
    puzzleAnns && puzzleAnns.length ? puzzleHost : puzzleFallback,
    h('div.time-heading', t('choose_time')),
    modes,
    h('div.pcards',
      card('🌐', t('play_card_online'), onlineSheet),
      card('🤝', t('play_card_friend'), startFriendGame),
      card('🤖', t('play_card_ai'), aiSheet)),
    ...onlineBlock,
    l.games.invites.length ? [h('div.h2', t('invites')), h('div.list', l.games.invites.map((g) => h('div.row.invite',
      avatar(g.opponent.name, g.opponent.id), h('div.grow', h('div.t', g.opponent.name), h('div.s', t('challenge'))),
      h('button.mini.ok', { onclick: async () => { try { const r = await api('POST', '/games/' + g.id + '/join'); openOnline(r.game); } catch (e) { fail(e); refresh(); } } }, icon('check', 18)),
      h('button.mini', { onclick: async () => { try { await api('POST', '/games/' + g.id + '/decline'); } catch (e) { fail(e); } playSnap = ''; refresh(); } }, icon('x', 18)))))] : null,
    saved || l.games.active.length || l.games.waiting.length ? [h('div.h2', t('continue')), h('div.list',
      saved ? rowBtn({ onclick: resumeAi }, h('div.avatar.ai', icon('cpu', 22)), h('div.grow', h('div.t', t('computer') + ' · ' + t('lvl' + saved.level)), h('div.s', t('resume'))), icon('arrow', 18)) : null,
      l.games.active.map((g) => gameRow(g, 'active')), l.games.waiting.map((g) => gameRow(g, 'wait')))] : null,
  ];
  mount('play', nodes);
  setPlaySticky(state.tab === 'play');
  if (state.tab === 'play') {
    const onPage = (page) => {
      if (['play', 'puzzles', 'rankings', 'live', 'profile'].includes(page)) go(TABS.indexOf(page), true);
      else if (page === 'premium' || page === 'friends' || page === 'settings' || page === 'diamonds' || page === 'gems' || page === 'stats') {
        go(TABS.indexOf('profile'), true);
        setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail: page })), 520);
      }
    };
    const opts = { botUsername: state.meta?.botUsername, userId: state.me?.id, onPage };
    await mountAnnouncementsCarousel(annHost, anns, opts);
    if (puzzleAnns && puzzleAnns.length) {
      await mountAnnouncementsCarousel(puzzleHost, puzzleAnns, { ...opts, delayMs: CAROUSEL_STAGGER_MS });
    }
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

/** Keep ranking chrome mounted so pill thumbs can slide without remount flicker. */
let rankUi = null;
function paintRankBody(host, data, isElo) {
  const rows = data.rankings || [];
  const unit = isElo ? t('elo') : t('points');
  const hint = isElo ? t('rankings_elo_hint') : t('rankings_monthly_hint', { month: data.monthLabel || '' });
  const foot = isElo ? t('rankings_elo_scoring') : t('rankings_scoring');
  const openRankProfile = (id) => {
    haptic('select');
    openUserProfile(id, {
      onChallenge: (u) => challenge(u.id),
      refreshHome: () => refresh('rankings'),
    });
  };
  host.replaceChildren(
    h('div.card.rank-summary',
      h('div.rank-summary-title', rankingCategory[selectedRanking] + ' · ' + (isElo ? t('rank_board_elo') : t('rank_board_monthly'))),
      h('div.muted', hint),
      rows.length ? h('div.list.rank-list', rows.map((p) => {
        const prem = !!(p.premium || (state.me && p.id === state.me.id && state.me.premium));
        return h('button.row.rank-row', {
          type: 'button',
          onclick: () => openRankProfile(p.id),
        },
          h('div.rank-place' + (p.rank <= 3 ? '.podium-' + p.rank : ''), p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : String(p.rank)),
          avBlock(p.name, p.id, { premium: prem, round: true, avatarKey: p.avatarKey }),
          h('div.grow',
            h('div.t', h('span.name', p.name), prem ? premIc() : null, p.id === state.me.id ? h('span.star', ' · ' + t('you')) : null),
            h('div.s', isElo
              ? t('rank_games', { n: p.games || 0 })
              : t('rank_record', { w: p.wins || 0, d: p.draws || 0, l: p.losses || 0 }))),
          h('div.rank-points', h('b', String(isElo ? (p.elo ?? p.points) : p.points)), h('small', unit)));
      })) : h('div.empty.rank-empty', t('rankings_empty'))),
    h('div.rank-footnote', foot),
  );
}
refreshers.rankings = async function renderRankings() {
  const isElo = selectedRankingBoard === 'elo';
  const categories = isElo
    ? ['bullet', 'blitz', 'rapid', 'classic']
    : ['all', 'bullet', 'blitz', 'rapid', 'classic'];
  if (!categories.includes(selectedRanking)) selectedRanking = isElo ? 'bullet' : 'all';
  let data;
  try {
    data = await api('GET', `/rankings?board=${selectedRankingBoard}&category=${selectedRanking}`);
  } catch (e) { fail(e); return; }

  const p = page('rankings');
  const sameChrome = rankUi && rankUi.board === selectedRankingBoard && p.contains(rankUi.root);
  if (sameChrome) {
    rankUi.tabs.set(selectedRanking);
    rankUi.boardBar.set(selectedRankingBoard);
    paintRankBody(rankUi.body, data, isElo);
    return;
  }

  const body = h('div.rank-body');
  const boardBar = pillBar(
    [['elo', t('rank_board_elo')], ['monthly', t('rank_board_monthly')]],
    selectedRankingBoard,
    (id) => {
      if (id === selectedRankingBoard) return;
      selectedRankingBoard = id;
      selectedRanking = id === 'elo' ? 'bullet' : 'all';
      refresh('rankings');
    },
    { className: 'rank-board-bar' },
  );
  const tabs = pillBar(
    categories.map((c) => [c, rankingCategory[c]]),
    selectedRanking,
    (category) => {
      if (category === selectedRanking) return;
      selectedRanking = category;
      refresh('rankings');
    },
    { className: 'rank-tabs' + (isElo ? '' : ' five') },
  );
  const root = h('div.rank-root',
    h('div.top', h('h1', '♜ ' + t('rankings_title'))),
    boardBar,
    tabs,
    body,
  );
  paintRankBody(body, data, isElo);
  mount('rankings', root);
  rankUi = { root, body, boardBar, tabs, board: selectedRankingBoard };
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
    challenge,
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
    // Sticky Play fades with CSS; toggle after paint so opacity/transform transitions run
    track.classList.toggle('settle', !!animate); ind.classList.remove('drag');
    setX(-state.index * W);
    ind.style.transform = `translateX(${state.index * 100}%)`;
    btns.forEach((b, j) => b.classList.toggle('active', j === state.index));
    requestAnimationFrame(() => setPlaySticky(state.tab === 'play'));
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
      // Prefer vertical scroll; only take over once horizontal intent is clear
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.45) {
        drag.mode = 'h';
        try { pager.setPointerCapture(drag.id); } catch { /* ignore */ }
        track.classList.remove('settle'); ind.classList.add('drag');
      } else if (Math.abs(dy) > 8) { drag = null; return; } else return;
    }
    drag.dx = dx;
    const atEdge = (state.index === 0 && dx > 0) || (state.index === TABS.length - 1 && dx < 0);
    const eff = atEdge ? dx * 0.22 : dx; // softer rubber band at the ends
    setX(-state.index * W + eff);
    ind.style.transform = `translateX(${(state.index - eff / W) * 100}%)`;
  });
  const finish = () => {
    if (!drag) return; const d = drag; drag = null; if (d.mode !== 'h') return;
    const dt = Math.max(1, performance.now() - d.t);
    const v = d.dx / dt;
    let next = state.index;
    // Lower distance threshold + velocity so light flicks still settle cleanly
    if (Math.abs(d.dx) > W * 0.16 || Math.abs(v) > 0.35) next = state.index + (d.dx < 0 ? 1 : -1);
    if (next !== state.index) haptic('select');
    go(next, true);
  };
  pager.addEventListener('pointerup', finish); pager.addEventListener('pointercancel', finish);
  go(0, false);
}

function rebuildNav() {
  $('#nav').querySelectorAll('.nav-btn').forEach((b, i) => { b.querySelector('span:last-child').textContent = t('nav_' + TABS[i]); b.setAttribute('aria-label', t('nav_' + TABS[i])); });
}
async function rebuildAll() {
  try {
    const me = await api('GET', '/me');
    state.me = me.user; state.stats = me.stats; state.meta = me.meta;
  } catch { /* keep cached */ }
  if (pz && pz.board) pz.board.destroy(); pz = null;
  rebuildNav();
  $$('.page').forEach((p) => p.classList.remove('seen'));
  refresh();
}

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
function hideBoot() {
  const boot = $('#boot');
  if (boot) boot.hidden = true;
}
function showGate(msg) {
  hideBoot();
  const gate = $('#gate');
  const app = $('#app');
  if (app) app.hidden = true;
  if (gate) {
    gate.hidden = false;
    if (msg) {
      const h1 = gate.querySelector('h1');
      if (h1) h1.textContent = msg;
    }
  }
}
function showApp() {
  hideBoot();
  const gate = $('#gate');
  const app = $('#app');
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
}

async function boot() {
  // Paint Telegram chrome immediately so expand never flashes pure black
  try {
    if (tg) {
      tg.ready();
      try { tg.expand(); } catch { /* ignore */ }
      try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* old client */ }
      syncTgChrome('dark');
      try {
        tg.onEvent && tg.onEvent('viewportChanged', () => syncTgChrome());
        tg.onEvent && tg.onEvent('themeChanged', () => syncTgChrome());
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  if (!tg || !tg.initData) {
    showGate();
    return;
  }
  setInitData(tg.initData);

  let me;
  try {
    me = await api('GET', '/me');
  } catch (e) {
    const { errText } = await import('./i18n.js');
    showGate(errText(e));
    return;
  }

  state.me = me.user; state.stats = me.stats; state.meta = me.meta;
  setLang(me.user.lang); applyTheme(me.user.theme);
  if (canStyleChess(me.user)) applyChessStyle(me.user.pieceSet, me.user.boardTheme);
  else applyChessStyle('outline', 'classic');

  // Reveal shell BEFORE data refresh so the user never sits on a black void
  showApp();
  initPager();

  if (me.referralClaim && me.referralClaim.inviteeReward) {
    toast(t('invitee_reward', { n: me.referralClaim.inviteeReward, name: (me.referralClaim.friend && me.referralClaim.friend.name) || '…' }));
    haptic('success');
  }

  connectWs((up) => { if (up) refresh(); });
  onWs((m) => {
    if (m.t === 'invite') { showInvite(m.game, m.ttl || 10000); refresh('play'); }
    else if (m.t === 'friend') { haptic('success'); if (m.reward) { state.me.diamonds = (state.me.diamonds || 0) + m.reward; toast(t('friend_reward', { n: m.reward })); } refresh(); }
    else if (m.t === 'wallet' && m.user) {
      state.me = { ...state.me, ...m.user };
      const g = m.granted || {};
      const bits = [];
      if (g.diamonds > 0) bits.push(`+${g.diamonds} 💎`);
      if (g.premiumMonths > 0) bits.push(`★ +${g.premiumMonths}`);
      toast(bits.length ? bits.join(' · ') : t('wallet_updated'));
      haptic('success');
      if (canStyleChess(state.me)) applyChessStyle(state.me.pieceSet, state.me.boardTheme);
      refresh();
    }
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
  }, 6_000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sendBye();
    else refresh();
  });
  window.addEventListener('pagehide', () => sendBye());
  // Premium crown taps → Premium shop (works from Online list, profile, sheets)
  document.addEventListener('open-premium', () => {
    $$('#sheet-root .backdrop').forEach((el) => el.click());
    const idx = TABS.indexOf('profile');
    const already = state.index === idx;
    if (!already) go(idx, true);
    else closeScreen(true);
    setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail: 'premium' })), already ? 60 : 520);
  });

  try {
    await refresh();
    await handleDeepLink();
  } catch (e) {
    console.error('[boot] refresh', e);
    fail(e);
  }
  // Warm inbox module in the background (non-blocking)
  loadInbox();
}
boot().catch((e) => {
  console.error('[boot]', e);
  try {
    showGate((e && e.message) || 'Something went wrong');
  } catch {
    hideBoot();
  }
});
