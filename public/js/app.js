// Main app: boot, swipe pager, pages, deep links.
import { h, $, $$, icon, haptic, toast, sheet, seg, pillBar, toggle, api, fail, connectWs, onWs, sendBye, wsConnected, tg, avBlock, premIc, sleep, unlockAudio, playMoveSound, smoothScrollTo, shareUrl, copyText } from './ui.js';
import { homeTabRefreshMs, softPollMs } from './perf.js';
import { openDmThread, refreshInboxBadges, headerInboxBtns, isViewingDmThread, isViewingGlobalChat } from './inbox.js';
import { t, setLang } from './i18n.js';
import { openGame, savedAiGame, openGameId } from './game.js';
import { Chess } from '/vendor/chess.js';
import { Board, restyleBoards } from './board.js';
import { goodMoves, mateIn } from './puzzles.js';
import { normalizeTimeControl, formatTashkentWhen } from './time.js';
import { renderLivePage, liveBlocksAutoRefresh, openLiveTournaments } from './live.js';
import { PIECE_SETS, BOARD_THEMES } from './pieces.js';
import { restyleOpenGame } from './game.js';
import { renderProfilePage, openUserProfile } from './profile.js';
import { openScreen, closeScreen, screenOpen } from './screen.js';
import {
  loadAnnouncements,
  mountAnnouncementsCarousel,
  pauseAnnouncementsCarousel,
  resumeAnnouncementsCarousel,
  resumeAnnouncementsHost,
  stopAnnouncementsHost,
  isAnnouncementsHostLive,
  announcementsKey,
  CAROUSEL_STAGGER_MS,
} from './announcements.js';
import { createPlayFlow } from './playflow.js';
import { dailyPuzzles, tashkentDayKey } from './puzzles.js';

const state = { me: null, stats: null, meta: null, lobby: null, friends: null, index: 0, tab: 'play' };
let selectedTime = 'any';
const TABS = ['play', 'puzzles', 'rankings', 'live', 'profile'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const gameMeta = () => ({
  me: {
    id: state.me.id,
    name: state.me.firstName,
    premium: !!state.me.premium,
    avatarKey: state.me.avatarKey || null,
  },
  botUsername: state.meta.botUsername,
  reactions: state.meta.REACTIONS,
});
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
    openLiveTournaments: () => {
      openLiveTournaments();
      go(TABS.indexOf('live'), true);
    },
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

/** Boot-style radial shell (Telegram chrome stays flat themeBg). */
function themeShellBg(theme) {
  return theme === 'light'
    ? 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #f3f5f9 55%, #e8edf5 100%)'
    : 'radial-gradient(ellipse at 50% 42%, #1a2740 0%, #111827 62%, #0b1220 100%)';
}

function syncTgChrome(theme = document.documentElement.dataset.theme || 'dark') {
  const bg = themeBg(theme);
  const shell = themeShellBg(theme);
  try {
    tg.setHeaderColor(bg);
    tg.setBackgroundColor(bg);
    if (tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch { /* old client */ }
  // Radial shell like boot splash; Telegram bars use flat bg
  document.documentElement.style.background = shell;
  document.body.style.background = shell;
  const app = $('#app');
  if (app) app.style.background = shell;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncTgChrome(theme);
  const m = $('meta[name=color-scheme]'); if (m) m.content = theme;
}

function applyChessStyle(pieceSet, boardTheme) {
  const root = document.documentElement;
  root.dataset.pieces = PIECE_SETS.includes(pieceSet) ? pieceSet : 'neo';
  root.dataset.board = BOARD_THEMES.includes(boardTheme) ? boardTheme : 'green';
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
  // Instant restore — CSS scroll-behavior:smooth would animate from 0 after replaceChildren
  const prevBeh = p.style.scrollBehavior;
  p.style.scrollBehavior = 'auto';
  p.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  p.scrollTop = top;
  requestAnimationFrame(() => {
    p.scrollTop = top;
    p.style.scrollBehavior = prevBeh;
  });
  p.classList.add('seen');
}
const empty = (text, ic) => h('div.empty', ic ? h('div.empty-ic', ic) : null, text);
const rowBtn = (...kids) => h('button.row', ...kids);

const stat = (n, label, color) => h('div.stat', h('b' + (color ? '.' + color : ''), String(n)), h('small', label));
/** Online PvP only — computer games never count toward stats/ratings. */
const sumStats = (s) => ({ w: s.online.w || 0, d: s.online.d || 0, l: s.online.l || 0 });

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
/** Friend link games: invite UI first; board only after the friend joins (status=active). */
const openOnline = (g) => {
  if (!g) return;
  if (g.mode === 'friend' && g.status === 'open') {
    openFriendWait(g);
    return;
  }
  // Avoid double open when both global WS and search/friend screens race
  if (g.status === 'active' && openGameId() === g.id) return;
  openGame({ kind: 'online', game: g, meta: gameMeta() }, () => refresh());
};

/** Invite-first wait screen — no chessboard until the opponent joins via the link. */
function openFriendWait(game) {
  let joined = false;
  let poll = null;
  let off = () => {};
  const gameId = game.id;
  const markJoined = () => { joined = true; };
  const onGameActive = (e) => {
    if (e && e.detail && e.detail.id === gameId && e.detail.status === 'active') markJoined();
  };
  window.addEventListener('chess-game-active', onGameActive);
  const friendLink = () => {
    const bot = state.meta && state.meta.botUsername;
    const meId = state.me && state.me.id;
    if (!bot || !meId) return '';
    // Referral startapp=i… pays diamonds; friend can then join your open board from the lobby
    return `https://t.me/${bot}?startapp=i${meId}`;
  };
  openScreen((close) => {
    const finish = (nextGame) => {
      if (joined) return;
      joined = true;
      try { clearInterval(poll); } catch { /* ignore */ }
      try { off(); } catch { /* ignore */ }
      window.removeEventListener('chess-game-active', onGameActive);
      close(true);
      if (nextGame && nextGame.status === 'active') openOnline(nextGame);
      else refresh();
    };
    off = onWs((m) => {
      if (m.t !== 'game' || !m.game || m.game.id !== gameId) return;
      if (m.game.status === 'active') finish(m.game);
      else if (m.game.status === 'cancelled' || m.game.status === 'finished') finish(null);
    });
    poll = setInterval(async () => {
      try {
        const r = await api('GET', `/games/${gameId}`);
        if (r.game.status === 'active') finish(r.game);
        else if (r.game.status === 'cancelled' || r.game.status === 'finished') finish(null);
      } catch { /* ignore */ }
    }, softPollMs());
    const cancel = async () => {
      if (joined) return;
      joined = true;
      try { clearInterval(poll); } catch { /* ignore */ }
      try { off(); } catch { /* ignore */ }
      window.removeEventListener('chess-game-active', onGameActive);
      try { await api('DELETE', `/games/${gameId}`); } catch { /* ignore */ }
      close();
      refresh();
    };
    const tc = game.timeControl && game.timeControl !== 'classic' ? game.timeControl : '';
    return [
      h('div.top',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); cancel(); },
        }, icon('back', 22)),
        h('h1', t('wait_friend'))),
      h('div.card.friend-wait',
        h('div.empty-ic', '🤝'),
        h('b', t('wait_friend')),
        h('p.muted', t('wait_friend_sub') + (tc ? ` · ${tc}` : '')),
        h('button.btn', {
          type: 'button',
          onclick: () => {
            const link = friendLink();
            if (!link) return toast(t('e_server'), true);
            haptic('medium');
            shareUrl(link, t('share_text'));
          },
        }, icon('share', 18), t('share_link')),
        h('button.btn.ghost', {
          type: 'button',
          onclick: async () => {
            const link = friendLink();
            if (!link) return toast(t('e_server'), true);
            if (await copyText(link)) { toast(t('link_copied')); haptic('success'); }
          },
        }, icon('link', 18), t('copy_link')),
        h('button.btn.ghost', { type: 'button', onclick: () => cancel() }, t('cancel')),
      ),
    ];
  }, {
    onClose: () => {
      try { clearInterval(poll); } catch { /* ignore */ }
      try { off(); } catch { /* ignore */ }
      window.removeEventListener('chess-game-active', onGameActive);
      if (joined) return;
      joined = true;
      // Never cancel if the friend already joined (WS race with global openOnline)
      api('GET', `/games/${gameId}`).then((r) => {
        if (r.game && r.game.status === 'active') return null;
        return api('DELETE', `/games/${gameId}`);
      }).catch(() => {}).finally(() => refresh());
    },
  });
}

const rankingCategory = () => ({
  bullet: t('tc_bullet'), blitz: t('tc_blitz'), rapid: t('tc_rapid'),
  classic: t('tc_classic'), all: t('rank_all') || 'All',
});
let selectedRankingBoard = 'elo';
let selectedRanking = 'bullet';
async function startQuick() {
  // Same path as Play CTA: time/color setup → expanding-Elo quick match
  ensurePlayFlow().openTimeSetup();
}
async function startFriendGame(opts = {}) {
  try {
    const timeControl = opts.timeControl || selectedPreset();
    const preferredColor = opts.preferredColor === 'w' || opts.preferredColor === 'b' ? opts.preferredColor : null;
    const r = await api('POST', '/games', { timeControl, preferredColor });
    openFriendWait(r.game);
  } catch (e) { fail(e); }
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
  // Friends can always be challenged when online; strangers need discoverable.
  const blocked = !!u.inGame || u.online === false
    || (!u.friend && u.discoverable === false);
  return h('button.mini.ok', { disabled: blocked, onclick: () => challenge(u.id) }, t('challenge'));
}
async function openById(id) {
  try {
    const r = await api('GET', `/games/${id}`);
    // Stale Telegram Open buttons (welcome / your-move) must not reopen finished boards
    if (r.game.status === 'finished' || r.game.status === 'cancelled') {
      toast(t('game_ended'), true);
      return;
    }
    if (r.game.joinable) return joinGame(id);
    // Invitee (primary invited_id or game_invites): open board with Accept, not dead-end wait
    if (r.game.status === 'invited' && r.game.creator !== state.me.id) {
      openOnline(r.game);
      return;
    }
    openOnline(r.game);
  } catch (e) { fail(e); }
}
async function joinGame(id) {
  try {
    const r = await api('POST', `/games/${id}/join`);
    if (r.game && (r.game.status === 'finished' || r.game.status === 'cancelled')) {
      toast(t('game_ended'), true);
      return;
    }
    openOnline(r.game);
  } catch (e) { toast(t('join_failed'), true); }
}
function startAi(level, colour, opts = {}) {
  const col = colour === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colour;
  const S = openGame({
    kind: 'ai', level, colour: col, allowUndo: opts.allowUndo !== false, meta: gameMeta(),
  }, () => refresh());
  S.onStats = (s) => { state.stats = s; };
}
function resumeAi() {
  const s = savedAiGame(); if (!s) return;
  const S = openGame({
    kind: 'ai', level: s.level, colour: s.colour, resume: s,
    allowUndo: s.allowUndo !== false, meta: gameMeta(),
  }, () => refresh());
  S.onStats = (st) => { state.stats = st; };
}

function aiSheet() {
  let level = 2, colour = 'w', allowUndo = true;
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
      h('div.setting.ai-undo-row',
        h('div', h('b', t('ai_undo')), h('small', t('ai_undo_sub'))),
        toggle(allowUndo, (v) => { allowUndo = v; })),
      h('button.btn', { onclick: () => { close(); setTimeout(() => startAi(level, colour, { allowUndo }), 120); } }, t('start')),
    ];
  });
}

const playerRow = (u, close) => h('div.row',
  avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true, avatarKey: u.avatarKey || null }),
  h('div.grow',
    h('div.t', h('span.name', u.name), u.premium ? premIc() : null),
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
            }, avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true, avatarKey: u.avatarKey || null })),
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
    load(); timer = setInterval(load, softPollMs());
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
  return rowBtn({ onclick: () => openOnline(g) },
    avBlock(o.name || '?', o.id || 0, { premium: !!o.premium, round: true, avatarKey: o.avatarKey || null }),
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
let homePeopleTab = 'live'; // 'live' | 'friends'
refreshers.play = async function renderPlay() {
  const [l, , anns, puzzleAnns] = await Promise.all([
    loadLobby(),
    loadFriends().catch(() => { state.friends = state.friends || []; }),
    loadAnnouncements(api, 'home'),
    loadAnnouncements(api, 'puzzle'),
  ]);
  const saved = savedAiGame();
  // Full lobby list (free + in-game), same people as the Online sheet
  const onlinePlayers = l.online || [];
  const friends = state.friends || [];
  // Skip full remount when nothing visible changed — stops home-page flicker every poll.
  const snap = JSON.stringify({
    t: selectedTime,
    tab: homePeopleTab,
    d: state.me.diamonds || 0,
    o: l.onlineCount,
    inv: (l.games.invites || []).map((g) => g.id),
    act: (l.games.active || []).map((g) => [g.id, g.turn, g.you]),
    wait: (l.games.waiting || []).map((g) => g.id),
    on: onlinePlayers.map((u) => [u.id, !!u.invited, !!u.inGame, !!u.friend, !!u.premium, u.avatarKey || '']),
    fr: friends.map((f) => [f.id, !!f.online, !!f.inGame, !!f.invited, !!f.premium, f.avatarKey || '']),
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
    try { refreshInboxBadges(playEl); } catch { /* ignore */ }
    // Tab return / soft poll: keep media carousels and restart auto-advance if paused
    if (state.tab === 'play') resumeAnnouncementsCarousel(playEl);
    return;
  }
  playSnap = snap;

  // Reuse live carousels when announcement content is unchanged — avoids media flash on soft refresh / taps
  const annKey = announcementsKey(anns);
  const pzKey = announcementsKey(puzzleAnns);
  const prevAnn = playEl?.querySelector('.ann-carousel[data-ann-board="home"]');
  const prevPz = playEl?.querySelector('.ann-carousel[data-ann-board="puzzle"]');
  // Must still be "live" (blobs + timers state). Dead hosts after hard-stop must remount.
  const reuseAnn = !!(prevAnn && prevAnn.dataset.annKey === annKey && isAnnouncementsHostLive(prevAnn));
  const reusePz = !!(prevPz && prevPz.dataset.annKey === pzKey && isAnnouncementsHostLive(prevPz));
  if (reuseAnn) prevAnn.remove();
  else if (prevAnn) stopAnnouncementsHost(prevAnn);
  if (reusePz) prevPz.remove();
  else if (prevPz) stopAnnouncementsHost(prevPz);

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
      type: 'button',
      onclick: () => {
        if (selectedTime === id) return;
        selectedTime = id;
        haptic('select');
        // In-place select — do not remount home (keeps media carousel stable)
        modes.querySelectorAll('.time-option').forEach((btn, i) => {
          btn.classList.toggle('selected', controls[i][0] === id);
        });
        try {
          if (playSnap) {
            const o = JSON.parse(playSnap);
            o.t = id;
            playSnap = JSON.stringify(o);
          }
        } catch { /* next poll remounts */ }
      },
    }, h('b', label), h('small', sub))
  ));
  const banner = (cls, emoji, title, sub, fn) => h('button.home-banner.' + cls, { onclick: () => { haptic('light'); fn(); } },
    h('div.home-banner-text', h('b', title), h('small', sub)), h('span.home-banner-art', emoji));
  const card = (emoji, label, fn) => h('button.pcard', { onclick: () => { haptic('light'); fn(); } }, h('span.pcard-art', emoji), h('b', label));
  // Reserve carousel height on first paint when content exists (avoids entry→home layout jump).
  const annHost = reuseAnn
    ? prevAnn
    : h('div.ann-carousel' + (anns && anns.length ? '.ann-loading' : ''), {
      ...(anns && anns.length ? {} : { hidden: true }),
      'data-noswipe': '',
      'data-ann-board': 'home',
    });
  if (!reuseAnn) {
    annHost.dataset.annBoard = 'home';
    if (anns && anns.length && !annHost.querySelector('.ann-track')) annHost.replaceChildren(h('div.ann-skel'));
  }
  const puzzleHost = reusePz
    ? prevPz
    : h('div.ann-carousel.ann-puzzle' + (puzzleAnns && puzzleAnns.length ? '.ann-loading' : ''), {
      ...(puzzleAnns && puzzleAnns.length ? {} : { hidden: true }),
      'data-noswipe': '',
      'data-ann-board': 'puzzle',
    });
  if (!reusePz) {
    puzzleHost.dataset.annBoard = 'puzzle';
    if (puzzleAnns && puzzleAnns.length && !puzzleHost.querySelector('.ann-track')) {
      puzzleHost.replaceChildren(h('div.ann-skel'));
    }
  }
  const openProfile = (id) => openUserProfile(id, {
    onChallenge: (u) => challenge(u.id),
    refreshHome: () => { playSnap = ''; refresh('play'); },
  });
  // Stable list host so Live/Friends pills swap content without remounting the page (keeps scroll).
  const peopleListHost = h('div.home-people-list');
  const paintPeopleList = (tab) => {
    if (tab === 'friends') {
      peopleListHost.replaceChildren(friends.length
        ? h('div.list.home-online', ...friends.map((f) => {
          const row = { ...f, friend: true, online: !!f.online, discoverable: true };
          return h('div.row',
            h('button.plain', { type: 'button', onclick: () => openProfile(f.id) },
              avBlock(f.name, f.id, { premium: !!f.premium, online: !!f.online, round: true, avatarKey: f.avatarKey || null })),
            h('button.grow.plain', { type: 'button', onclick: () => openProfile(f.id) },
              h('div.t', h('span.name', f.name), f.premium ? premIc() : null),
              h('div.s', f.invited ? t('challenge_sent') : (f.inGame ? t('in_game') : (f.online ? t('online') : t('offline'))))),
            challengeAction(row));
        }))
        : empty(t('no_friends'), '👋'));
    } else {
      peopleListHost.replaceChildren(onlinePlayers.length
        ? h('div.list.home-online', ...onlinePlayers.map((u) => h('div.row',
          h('button.plain', { type: 'button', onclick: () => openProfile(u.id) },
            avBlock(u.name, u.id, { premium: !!u.premium, online: true, round: true, avatarKey: u.avatarKey || null })),
          h('button.grow.plain', { type: 'button', onclick: () => openProfile(u.id) },
            h('div.t', h('span.name', u.name), u.premium ? premIc() : null),
            h('div.s', u.invited ? t('challenge_sent') : (u.inGame ? t('in_game') : t('online')))),
          challengeAction(u))))
        : empty(t('nobody'), '🛰️'));
    }
  };
  const syncPeopleSnap = (tab) => {
    if (!playSnap) return;
    try {
      const o = JSON.parse(playSnap);
      o.tab = tab;
      playSnap = JSON.stringify(o);
    } catch { /* next poll remounts */ }
  };
  const peopleBar = pillBar(
    [['live', t('home_tab_live')], ['friends', t('home_tab_friends')]],
    homePeopleTab,
    (v) => {
      if (v === homePeopleTab) return;
      homePeopleTab = v;
      paintPeopleList(v);
      syncPeopleSnap(v);
    },
    { className: 'pill-bar home-people-bar' },
  );
  paintPeopleList(homePeopleTab);
  const onlineBlock = [
    h('div.h2.online-heading', t('online_players'),
      h('div.livepill', h('i.dot'), t('online_now', { n: l.onlineCount }))),
    peopleBar,
    peopleListHost,
  ];
  const puzzleFallback = banner('violet', '🧩', t('home_puzzle'), t('puzzles_sub'), () => go(TABS.indexOf('puzzles'), true));
  const nodes = [
    h('div.top',
      h('h1', '♟ ' + t('app')),
      h('div.pills',
        headerInboxBtns(),
        h('button.gempill', { onclick: () => go(TABS.indexOf('profile'), true) }, '💎 ' + (state.me.diamonds || 0)))),
    annHost,
    h('div.time-heading', t('choose_time')),
    modes,
    h('div.pcards',
      card('🌐', t('play_card_online'), onlineSheet),
      card('🤝', t('play_card_friend'), startFriendGame),
      card('🤖', t('play_card_ai'), aiSheet)),
    // 2nd announcement board sits between play modes and online players
    puzzleAnns && puzzleAnns.length ? puzzleHost : puzzleFallback,
    ...onlineBlock,
    l.games.invites.length ? [h('div.h2', t('invites')), h('div.list', l.games.invites.map((g) => h('div.row.invite',
      avBlock(g.opponent.name, g.opponent.id, { premium: !!g.opponent.premium, round: true, avatarKey: g.opponent.avatarKey || null }),
      h('div.grow', h('div.t', g.opponent.name), h('div.s', t('challenge'))),
      h('button.mini.ok', { onclick: async () => { try { const r = await api('POST', '/games/' + g.id + '/join'); closeScreen(true); openOnline(r.game); } catch (e) { fail(e); refresh(); } } }, icon('check', 18)),
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
      else if (page === 'premium' || page === 'friends' || page === 'settings' || page === 'diamonds' || page === 'gems' || page === 'stats' || page === 'promo') {
        const idx = TABS.indexOf('profile');
        const already = state.index === idx;
        go(idx, true);
        // go() only closeScreens on tab change — clear stack when already on profile
        if (already) closeScreen(true);
        setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail: page })), already ? 60 : 520);
      }
    };
    const opts = { botUsername: state.meta?.botUsername, userId: state.me?.id, onPage };
    // Mount both boards in parallel so entry→home does not reveal them one-after-another
    await Promise.all([
      reuseAnn
        ? Promise.resolve(resumeAnnouncementsHost(annHost))
        : (annHost.dataset.annKey = annKey, mountAnnouncementsCarousel(annHost, anns, opts)),
      puzzleAnns && puzzleAnns.length
        ? (reusePz
          ? Promise.resolve(resumeAnnouncementsHost(puzzleHost))
          : (puzzleHost.dataset.annKey = pzKey,
            mountAnnouncementsCarousel(puzzleHost, puzzleAnns, { ...opts, delayMs: CAROUSEL_STAGGER_MS })))
        : Promise.resolve(),
    ]);
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
      h('div.rank-summary-title', rankingCategory()[selectedRanking] + ' · ' + (isElo ? t('rank_board_elo') : t('rank_board_monthly'))),
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
            h('div.t', h('span.name', p.name), prem ? premIc() : null, p.id === state.me.id ? h('span.star', ' · ' + t('you_short')) : null),
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
    categories.map((c) => [c, rankingCategory()[c]]),
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

// ---------- puzzles (daily 1–10 easy→hard; +1 💎 for all 10) ----------
const PZ_KEY = 'chess-puzzles-daily';
function puzzleDayState() {
  const day = tashkentDayKey();
  try {
    const raw = JSON.parse(localStorage.getItem(PZ_KEY) || 'null');
    if (raw && raw.day === day && Array.isArray(raw.ids)) return { day, ids: new Set(raw.ids), claimed: !!raw.claimed };
  } catch { /* ignore */ }
  return { day, ids: new Set(), claimed: false };
}
function persistPuzzleDay(st) {
  try { localStorage.setItem(PZ_KEY, JSON.stringify({ day: st.day, ids: [...st.ids], claimed: !!st.claimed })); } catch { /* storage blocked */ }
}
const solvedSet = () => puzzleDayState().ids;
const markSolved = (id) => {
  const st = puzzleDayState();
  st.ids.add(id);
  persistPuzzleDay(st);
  return st;
};
const puzzleRewardN = () => {
  const n = Math.floor(Number(state.meta && state.meta.puzzleDailyReward));
  return n >= 0 ? n : 1;
};
async function maybeClaimDailyReward() {
  const st = puzzleDayState();
  const list = dailyPuzzles(st.day);
  if (st.claimed || st.ids.size < list.length) return;
  try {
    const r = await api('POST', '/puzzles/claim-daily');
    st.claimed = true;
    persistPuzzleDay(st);
    if (r.awarded > 0) {
      if (state.me) state.me.diamonds = r.diamonds;
      toast(t('puzzle_daily_reward', { n: r.awarded }));
      haptic('success');
    }
  } catch (e) { fail(e); }
}
let pz = null; // the puzzle on screen, or null for the list

function puzzleList() {
  const day = tashkentDayKey();
  const list = dailyPuzzles(day);
  const done = solvedSet();
  const nDone = list.filter((p) => done.has(p.id)).length;
  const reward = puzzleRewardN();
  mount('puzzles',
    h('div.top', h('h1', '🧩 ' + t('puzzles_title')), h('div.livepill', t('puzzle_solved_count', { a: nDone, b: list.length }))),
    h('div.muted.pz-sub', t('puzzles_daily_sub', { n: reward })),
    h('div.list', list.map((p, i) => rowBtn({ onclick: () => { haptic('light'); openPuzzle(i); } },
      h('div.pz-num' + (done.has(p.id) ? '.done' : ''), done.has(p.id) ? icon('check', 18) : String(i + 1)),
      h('div.grow',
        h('div.t', t('puzzle_n', { n: i + 1 })),
        h('div.s', t('puzzle_diff', { n: p.diff }) + ' · ' + t('mate_in', { n: p.n }) + ' · ' + (new Chess(p.fen).turn() === 'w' ? t('puzzle_white') : t('puzzle_black')))),
      icon('arrow', 18)))),
    nDone >= list.length ? h('div.card.pz-reward', '💎 ' + t('puzzle_daily_done', { n: reward })) : null);
}

function openPuzzle(i) {
  if (pz && pz.board) pz.board.destroy();
  const list = dailyPuzzles();
  const puzzle = list[i];
  if (!puzzle) return puzzleList();
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
    solved
      ? (i + 1 < list.length
        ? h('button.btn.sm', { onclick: () => openPuzzle(i + 1) }, t('puzzle_next'))
        : h('button.btn.sm', { onclick: closePuzzle }, t('puzzle_back')))
      : null);
  const onMove = async (from, to, promotion) => {
    if (state2.locked) return;
    unlockAudio();
    const good = goodMoves(chess, state2.left);
    const mv = good.find((m) => m.from === from && m.to === to && (m.promotion || undefined) === (promotion || undefined));
    if (!mv) { say(t('puzzle_wrong'), 'bad'); haptic('error'); draw(); return; }
    chess.move({ from, to, promotion });
    playMoveSound();
    state2.locked = true; draw({ from, to });
    if (chess.isCheckmate()) {
      markSolved(puzzle.id);
      say(t('puzzle_done'), 'ok');
      haptic('success');
      buttons(true);
      maybeClaimDailyReward();
      return;
    }
    say(t('puzzle_continue'), 'ok'); haptic('light');
    await sleep(550);
    const replies = chess.moves({ verbose: true });
    // Keep a forced mate line (random defense can soft-lock mate-in-2+)
    let r = replies[0];
    for (const cand of replies) {
      chess.move(cand);
      const ok = state2.left <= 1 ? chess.isCheckmate() : mateIn(chess, state2.left - 1);
      chess.undo();
      if (ok) { r = cand; break; }
    }
    if (!r) { say(t('puzzle_wrong'), 'bad'); state2.locked = false; draw(); return; }
    chess.move(r); state2.left -= 1; state2.locked = false; draw({ from: r.from, to: r.to });
    playMoveSound();
    say(t(colour === 'w' ? 'puzzle_white' : 'puzzle_black'));
  };
  pz = state2;
  mount('puzzles',
    h('div.top',
      h('button.round.back', { type: 'button', 'aria-label': t('back'), onclick: closePuzzle }, icon('back', 22)),
      h('h1', t('puzzle_n', { n: i + 1 })),
      h('div.livepill', t('puzzle_diff', { n: puzzle.diff }) + ' · ' + t('mate_in', { n: puzzle.n }))),
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
  const pop = h('div.invite-pop',
    avBlock(o.name || '?', o.id || 0, { premium: !!o.premium, round: true, avatarKey: o.avatarKey || null }),
    h('div.grow', h('b', t('challenge_from', { name: o.name || '' }))),
    h('button.mini.ok', { 'aria-label': t('accept'), onclick: async () => { done(); try { const r = await api('POST', `/games/${g.id}/join`); closeScreen(true); openOnline(r.game); } catch (e) { fail(e); refresh(); } } }, icon('check', 20)),
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
  const pop = h('div.invite-pop',
    avBlock(o.name || '?', o.id || 0, { premium: !!o.premium, round: true, avatarKey: o.avatarKey || null }),
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
      // Pause auto-advance only — keep blob URLs so media carousels don't flash on return
      if (prev === TABS.indexOf('play')) {
        pauseAnnouncementsCarousel(page('play'));
        playSnap = '';
      }
      if (prev === TABS.indexOf('puzzles') && pz) {
        try { if (pz.board) pz.board.destroy(); } catch { /* ignore */ }
        pz = null;
      }
      // Returning to play: refresh lobby data, but reuse live carousels (see renderPlay)
      if (state.tab === 'play') playSnap = '';
    }
    // Sticky Play fades with CSS; toggle after paint so opacity/transform transitions run
    track.classList.toggle('settle', !!animate); ind.classList.remove('drag');
    setX(-state.index * W);
    ind.style.transform = `translateX(${state.index * 100}%)`;
    btns.forEach((b, j) => b.classList.toggle('active', j === state.index));
    requestAnimationFrame(() => setPlaySticky(state.tab === 'play'));
    // high-smooth scroll pages to top when switching tabs
    if (state.index !== prev) {
      const p = page(state.tab);
      if (p) {
        if (animate) smoothScrollTo(p, 0, 560);
        else p.scrollTop = 0;
      }
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
function readStartParam() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('p')) return q.get('p');
  } catch { /* ignore */ }
  try {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) return String(tg.initDataUnsafe.start_param);
  } catch { /* ignore */ }
  try {
    if (tg && tg.initData) {
      const sp = new URLSearchParams(tg.initData).get('start_param');
      if (sp) return sp;
    }
  } catch { /* ignore */ }
  return '';
}

async function handleDeepLink() {
  let gid = null;
  let dmId = null;
  try {
    const q = new URLSearchParams(location.search);
    gid = q.get('game');
    dmId = q.get('dm');
  } catch { /* ignore */ }
  const p = readStartParam();
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  if (/^i\d{1,15}$/.test(p)) {
    try {
      const r = await api('POST', '/friends/join', { userId: Number(p.slice(1)) });
      if (r.user) state.me = r.user;
      if (r.openGameId) {
        await joinGame(r.openGameId);
        if (r.inviteeReward) {
          toast(t('invitee_reward', { n: r.inviteeReward, name: (r.friend && r.friend.name) || '…' }));
          haptic('success');
        }
        return;
      }
      // Stale welcome buttons still carry ?p=i… — ignore once already friends / already paid
      if (r.already) return;
      if (r.inviteeReward) {
        toast(t('invitee_reward', { n: r.inviteeReward, name: (r.friend && r.friend.name) || '…' }));
        haptic('success');
      } else if (r.friend) toast(t('friend_added', { name: r.friend.name }));
      if (r.inviteeReward || r.reward) go(TABS.indexOf('profile'), true);
    } catch (e) { fail(e); }
  } else if (/^g[\w-]{4,20}$/.test(p)) await joinGame(p.slice(1));
  else if (gid && /^[\w-]{4,20}$/.test(gid)) await openById(gid);
  else if (dmId && /^\d{1,18}$/.test(dmId)) {
    try { await openDmThread(Number(dmId)); } catch (e) { fail(e); }
  }
}

// ---------- start (called from entry.js AFTER splash is already dismissed) ----------
/**
 * Wire the full Mini App after entry.js hid #boot and fetched /me.
 * @param {{ user: object, stats: object, meta: object, referralClaim?: object }} me
 */
export async function start(me) {
  try {
    if (tg) {
      try { tg.ready(); } catch { /* ignore */ }
      try { tg.expand(); } catch { /* ignore */ }
      try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* old client */ }
      try {
        tg.onEvent && tg.onEvent('viewportChanged', () => syncTgChrome());
        tg.onEvent && tg.onEvent('themeChanged', () => syncTgChrome());
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try {
    state.me = me.user; state.stats = me.stats; state.meta = me.meta;
    setLang(me.user.lang); applyTheme(me.user.theme);
    if (canStyleChess(me.user)) applyChessStyle(me.user.pieceSet, me.user.boardTheme);
    else applyChessStyle('neo', 'green');
  } catch (e) {
    console.error('[boot] theme', e);
  }

  // Ensure shell visible (entry.js usually already did this)
  try {
    const boot = document.getElementById('boot');
    if (boot) {
      boot.hidden = true;
      boot.style.setProperty('display', 'none', 'important');
      try { boot.remove(); } catch { /* ignore */ }
    }
    const gate = document.getElementById('gate');
    const app = document.getElementById('app');
    if (gate) gate.hidden = true;
    if (app) { app.hidden = false; app.removeAttribute('hidden'); }
  } catch { /* ignore */ }

  try { initPager(); } catch (e) { console.error('[boot] pager', e); }

  connectWs((up) => { if (up) refresh(); });
  onWs((m) => {
    if (m.t === 'invite') { showInvite(m.game, m.ttl || 10000); refresh('play'); }
    else if (m.t === 'friend') { haptic('success'); if (m.reward) { state.me.diamonds = (state.me.diamonds || 0) + m.reward; toast(t('friend_reward', { n: m.reward })); } refresh(); }
    else if (m.t === 'dm') {
      try { refreshInboxBadges(); } catch { /* ignore */ }
      // Already in that chat — inbox.js appends live; no toast spam
      if (isViewingDmThread(m.threadId)) return;
      haptic('success');
      toast(t('msg_new_from', { name: (m.from && m.from.name) || '…' }));
    }
    else if (m.t === 'gchat') {
      try { refreshInboxBadges(); } catch { /* ignore */ }
      if (isViewingGlobalChat()) return;
      const msg = m.message || {};
      // Inbox red dot is for replies to you — toast only then
      if (msg.replyTo && msg.replyTo.mine) {
        haptic('success');
        toast(t('gchat_reply_from', { name: (msg.from && msg.from.name) || '…' }));
      }
    }
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
      // Enter board only when waiting (friend/search/invite) — not on every move pushGame
      if (m.game.status === 'active' && m.game.id !== openGameId()) {
        const waiting = screenOpen() || !!$('.invite-pop');
        clearInvitePop();
        if (waiting) {
          window.dispatchEvent(new CustomEvent('chess-game-active', { detail: m.game }));
          closeScreen(true);
          openOnline(m.game);
        } else {
          refresh();
        }
      } else if (m.game.id !== openGameId()) refresh();
    } else if (m.t === 'invite_gone') { clearInvitePop(); refresh(); }
  });
  // Background soft refresh — WS pushes game/invite events; poll only for presence/lists
  setInterval(() => {
    if (document.hidden || openGameId()) return;
    if (state.tab === 'live' && liveBlocksAutoRefresh()) return;
    // Profile is mostly static; rankings are cached server-side — skip to cut free-tier load
    if (state.tab === 'profile') return;
    if (['live', 'play', 'rankings'].includes(state.tab)) refresh();
  }, homeTabRefreshMs());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sendBye();
    else {
      // WS skips reconnect while hidden — resume live pushes on foreground
      if (!wsConnected()) connectWs();
      refresh();
    }
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

  // Referral toast from /me (pending_inviter or signed start_param) — before deep-link join
  if (me.referralClaim && me.referralClaim.inviteeReward) {
    toast(t('invitee_reward', {
      n: me.referralClaim.inviteeReward,
      name: (me.referralClaim.friend && me.referralClaim.friend.name) || '…',
    }));
    haptic('success');
  }

  try { await refresh(); } catch (e) {
    console.error('[boot] refresh', e);
    fail(e);
  }
  // Always try deep links even if refresh failed (referral/startapp must not be skipped)
  try { await handleDeepLink(); } catch (e) {
    console.error('[boot] deep link', e);
    fail(e);
  }
}
