// Main app: boot, swipe pager, pages, deep links.
import { h, $, $$, icon, haptic, toast, sheet, pillBar, api, fail, connectWs, onWs, sendBye, wsConnected, tg, avBlock, premIc, setMedalHolders, sleep, unlockAudio, playMoveSound, smoothScrollTo, scrollToTopSmooth, shareUrl, copyText, syncTgSafeArea } from './ui.js';
import { homeTabRefreshMs, softPollMs, isLite, isAndroid } from './perf.js';
import { openDmThread, refreshInboxBadges, headerInboxBtns, isViewingDmThread } from './inbox.js';
import { t, setLang } from './i18n.js';
import { openGame, savedAiGame, openGameId } from './game.js';
import { Chess } from '/vendor/chess.js';
import { Board, restyleBoards } from './board.js';
import { goodMoves, mateIn } from './puzzles.js';
import { normalizeTimeControl, formatTashkentWhen } from './time.js';
import { renderLivePage, liveBlocksAutoRefresh, openLiveTournaments, spectateGame, openBroadcast } from './live.js';
import { PIECE_SETS, BOARD_THEMES, DEFAULT_PIECE_SET, preloadPieceSet } from './pieces.js';
import { restyleOpenGame } from './game.js';
import { renderProfilePage, openUserProfile } from './profile.js';
import { openScreen, closeScreen, screenOpen } from './screen.js';
import {
  loadAnnouncements,
  prepareAnnouncements,
  paintAnnouncementsCarousel,
  pauseAnnouncementsCarousel,
  resumeAnnouncementsCarousel,
  resumeAnnouncementsHost,
  stopAnnouncementsHost,
  isAnnouncementsHostLive,
  announcementsKey,
} from './announcements.js';
import { createPlayFlow } from './playflow.js';
import { dailyPuzzles, tashkentDayKey } from './puzzles.js';
import { paintPlayBody, renderRatingPage, openPlayHubMode, openPlayHubTab } from './playhub.js';
import { appHeader, sectionHead, heroBanner, dailyCard, championsCard, inviteRow } from './neonui.js';

const state = { me: null, stats: null, meta: null, lobby: null, friends: null, index: 2, tab: 'play' };
let selectedTime = 'any';
// Bottom bar, left → right. O'ynash (centre) is the page the app opens on.
const TABS = ['puzzles', 'rankings', 'play', 'live', 'profile'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const gameMeta = () => ({
  me: {
    id: state.me.id,
    name: state.me.firstName,
    premium: !!state.me.premium,
    isAdmin: !!state.me.isAdmin,
    avatarKey: state.me.avatarKey || null,
    diamonds: state.me.isAdmin ? null : (state.me.diamonds || 0),
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
    openAiHub: () => {
      openPlayHubMode('ai');
      if (state.tab === 'play') { playSnap = ''; refresh('play'); }
      else go(TABS.indexOf('play'), true);
    },
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
  document.documentElement.classList.toggle('play-sticky-on', !!show);
  try { syncScrollTopBtn(); } catch { /* not ready yet */ }
}

/** Active scroll container: open screen stack, else current tab page. */
function scrollTarget() {
  const screen = $('#screen');
  if (screen && screen.classList.contains('show') && screen.getAttribute('aria-hidden') !== 'true') {
    return screen;
  }
  return page(state.tab);
}

let scrollTopBtn = null;
function syncScrollTopBtn() {
  if (!scrollTopBtn) return;
  const el = scrollTarget();
  const show = !!(el && el.scrollTop > 200);
  scrollTopBtn.classList.toggle('show', show);
  scrollTopBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
  scrollTopBtn.tabIndex = show ? 0 : -1;
}

function initScrollTop() {
  const app = $('#app');
  if (!app || scrollTopBtn) return;
  scrollTopBtn = h('button.scroll-top', {
    type: 'button',
    'aria-label': t('scroll_top'),
    'aria-hidden': 'true',
    tabIndex: -1,
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = scrollTarget();
      if (!el) return;
      haptic('select');
      // Slow glide up (iOS: native smooth; others: JS tween — no WebView freeze)
      scrollToTopSmooth(el);
      // Hide FAB once near top; sync again after the glide settles
      const hideWhenNearTop = () => {
        if (!el || el.scrollTop <= 200) {
          scrollTopBtn.classList.remove('show');
          scrollTopBtn.setAttribute('aria-hidden', 'true');
          scrollTopBtn.tabIndex = -1;
        }
      };
      hideWhenNearTop();
      setTimeout(() => { hideWhenNearTop(); syncScrollTopBtn(); }, 1000);
    },
  }, icon('chevronUp', 22));
  app.append(scrollTopBtn);
  const onScroll = () => syncScrollTopBtn();
  $$('.page').forEach((p) => p.addEventListener('scroll', onScroll, { passive: true }));
  const screen = $('#screen');
  if (screen) screen.addEventListener('scroll', onScroll, { passive: true });
  // Mutation/visibility: tab change & screen open also need a sync
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncScrollTopBtn(); });
  syncScrollTopBtn();
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
  syncTgSafeArea();
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
  root.dataset.pieces = DEFAULT_PIECE_SET; // one piece art for every board (see pieces.js currentPieceSet)
  preloadPieceSet(root.dataset.pieces);
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
  // Small bottom sheet (not a full page): the board list stays visible behind it
  sheet((close) => {
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
      h('div.friend-wait.in-sheet',
        h('div.empty-ic', '🤝'),
        h('h2', t('wait_friend')),
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
    timeControl: opts.timeControl || selectedPreset(),
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
    const list = h('div.list.player-list');
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
refreshers.play = async function renderPlay() {
  const playElEarly = page('play');
  // First home paint (under splash): skip friends wait — biggest Android open win
  const firstPaint = !(playElEarly && playElEarly.classList.contains('seen') && playElEarly.childElementCount);
  const [l, , anns, champs] = await Promise.all([
    loadLobby(),
    firstPaint
      ? Promise.resolve(state.friends || [])
      : loadFriends().catch(() => { state.friends = state.friends || []; }),
    loadAnnouncements(api, 'home'),
    api('GET', '/medals/champions').catch(() => null),
  ]);
  if (firstPaint) {
    // Hydrate friends after splash dismisses (does not block "O'yin yuklanmoqda")
    loadFriends()
      .then(() => { if (state.tab === 'play') { playSnap = ''; refresh('play'); } })
      .catch(() => {});
  }
  const saved = savedAiGame();
  // Full lobby list (free + in-game), same people as the Online sheet
  const onlinePlayers = l.online || [];
  const friends = state.friends || [];
  // Skip full remount when nothing visible changed — stops home-page flicker every poll.
  const snap = JSON.stringify({
    d: state.me.diamonds || 0,
    o: l.onlineCount,
    elo: (l.stats && l.stats.elo) || state.me.elo || 1200,
    inv: (l.games.invites || []).map((g) => g.id),
    act: (l.games.active || []).map((g) => [g.id, g.turn, g.you]),
    wait: (l.games.waiting || []).map((g) => g.id),
    on: onlinePlayers.map((u) => [u.id, !!u.invited, !!u.inGame, !!u.friend, !!u.premium, u.avatarKey || '']),
    fr: friends.map((f) => [f.id, !!f.online, !!f.inGame, !!f.invited, !!f.premium, f.avatarKey || '']),
    sav: saved ? [saved.level, saved.fen] : null,
    ann: (anns || []).map((a) => [a.id, a.title, a.body, a.mediaId, a.linkType, a.endsAt]),
    ch: champs && champs.champions ? champs.champions.map((c) => [c.id, c.place, c.medalId]) : null,
  });
  const playEl = playElEarly || page('play');
  if (snap === playSnap && playEl && playEl.classList.contains('seen') && playEl.childElementCount) {
    const gem = playEl.querySelector('.nx-gem b');
    if (gem) gem.textContent = String(state.me.diamonds || 0);
    const eloEl = playEl.querySelector('.nx-elo-v');
    if (eloEl) eloEl.textContent = String((l.stats && l.stats.elo) || state.me.elo || 1200);
    try { refreshInboxBadges(playEl); } catch { /* ignore */ }
    // Tab return / soft poll: keep media carousels and restart auto-advance if paused
    if (state.tab === 'play') resumeAnnouncementsCarousel(playEl);
    return;
  }
  playSnap = snap;

  // Reuse live carousel when announcement content is unchanged — avoids media flash on soft refresh / taps
  const annKey = announcementsKey(anns);
  const prevAnn = playEl?.querySelector('.ann-carousel[data-ann-board="home"]');
  // Must still be "live" (blobs + timers state). Dead hosts after hard-stop must remount.
  const reuseAnn = !!(prevAnn && prevAnn.dataset.annKey === annKey && isAnnouncementsHostLive(prevAnn));
  if (reuseAnn) prevAnn.remove();
  else if (prevAnn) stopAnnouncementsHost(prevAnn);

  // Prefetch carousel media BEFORE building home DOM — page + boards open together
  const onPage = (pageName) => {
    if (['play', 'puzzles', 'rankings', 'live', 'profile'].includes(pageName)) go(TABS.indexOf(pageName), true);
    else if (pageName === 'premium' || pageName === 'friends' || pageName === 'settings' || pageName === 'diamonds' || pageName === 'gems' || pageName === 'stats' || pageName === 'promo') {
      const idx = TABS.indexOf('profile');
      const already = state.index === idx;
      go(idx, true);
      if (already) closeScreen(true);
      setTimeout(
        () => document.dispatchEvent(new CustomEvent('profile-open', { detail: pageName })),
        already ? 60 : (isAndroid() || isLite() ? 400 : 520),
      );
    }
  };
  const annOpts = { botUsername: state.meta?.botUsername, userId: state.me?.id, onPage };
  const prepAnn = (!reuseAnn && anns && anns.length)
    ? await prepareAnnouncements(anns)
    : null;

  // Build carousel fully (media already fetched) so it mounts with the rest of home
  const annHost = reuseAnn
    ? prevAnn
    : h('div.ann-carousel', {
      ...(prepAnn && prepAnn.items.length ? {} : { hidden: true }),
      'data-noswipe': '',
      'data-ann-board': 'home',
    });
  if (!reuseAnn) {
    annHost.dataset.annBoard = 'home';
    if (prepAnn && prepAnn.items.length) {
      annHost.dataset.annKey = annKey;
      paintAnnouncementsCarousel(annHost, prepAnn, annOpts);
    }
  }
  const openProfile = (id) => openUserProfile(id, {
    onChallenge: (u) => challenge(u.id),
    refreshHome: () => { playSnap = ''; refresh('play'); },
  });
  const pzReward = puzzleRewardN();
  const hasAnn = !!(reuseAnn || (prepAnn && prepAnn.items.length));
  const hubCtx = {
    me: state.me,
    remount: () => { playSnap = ''; refresh('play'); },
    loadFriends,
    ensurePlayFlow,
    startFriendGame,
    startAi,
    challenge,
    getSelectedTime: () => selectedTime,
    setSelectedTime: (id) => { selectedTime = id; playSnap = ''; },
    openFriends: () => openProfilePage('friends'),
    openProfile,
  };
  const nodes = [
    appHeader({
      me: state.me,
      elo: (l.stats && l.stats.elo) || state.me.elo || 1200,
      inboxBtns: headerInboxBtns(),
      onProfile: () => go(TABS.indexOf('profile'), true),
      onGems: openGemsPage,
    }),
    championsCard(champs, openProfile),
    annHost,
    hasAnn ? null : heroBanner(),
    dailyCard({ reward: pzReward, onClick: () => go(TABS.indexOf('puzzles'), true) }),
    l.games.invites.length ? [sectionHead(t('invites'), null, null, { dot: 'amber' }), h('div.nx-list', l.games.invites.map((g) => inviteRow(g, {
      onProfile: openProfile,
      onAccept: async () => { try { const r = await api('POST', '/games/' + g.id + '/join'); closeScreen(true); openOnline(r.game); } catch (e) { fail(e); refresh(); } },
      onDecline: async () => { try { await api('POST', '/games/' + g.id + '/decline'); } catch (e) { fail(e); } playSnap = ''; refresh(); },
    })))] : null,
    saved || l.games.active.length || l.games.waiting.length ? [sectionHead(t('continue')), h('div.list.nx-continue',
      saved ? rowBtn({ onclick: resumeAi }, h('div.avatar.ai', icon('ai', 22)), h('div.grow', h('div.t', t('ai') + ' · ' + t('lvl' + saved.level)), h('div.s', t('resume'))), icon('arrow', 18)) : null,
      l.games.active.map((g) => gameRow(g, 'active')), l.games.waiting.map((g) => gameRow(g, 'wait')))] : null,
    ...(await paintPlayBody(hubCtx, l)),
  ];
  mount('play', nodes);
  setPlaySticky(false);
  if (state.tab === 'play' && reuseAnn) resumeAnnouncementsHost(annHost);
};
function openProfilePage(detail) {
  go(TABS.indexOf('profile'), true);
  setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail })), 200);
}
/** Diamonds screen overlays the current tab (no tab switch) — back returns to where the user was. */
let gemsOpening = false;
async function openGemsPage() {
  if (gemsOpening) return;
  gemsOpening = true;
  try {
    // The diamonds screen lives in the profile page closure; build it once in the background if needed.
    if (!document._profileOpenHandler) await refreshers.profile();
    document.dispatchEvent(new CustomEvent('profile-open', { detail: 'diamonds' }));
  } catch (e) { if (e.code !== 'net') fail(e); } finally { gemsOpening = false; }
}

refreshers.live = async function renderLive() {
  await renderLivePage(
    (nodes) => mount('live', nodes),
    gameMeta(),
    () => refresh('live'),
    () => refresh('live'),
    { challenge },
  );
};

refreshers.rankings = async function renderRankings() {
  await renderRatingPage((nodes) => mount('rankings', nodes), {
    me: state.me,
    loadLobby,
    headerInboxBtns,
    goTab: (name) => go(TABS.indexOf(name), true),
    openGems: openGemsPage,
    openProfile: (id) => openUserProfile(id, {
      onChallenge: (u) => challenge(u.id),
      refreshHome: () => refresh('rankings'),
    }),
  });
};

// ---------- puzzles (daily 1–10 easy→hard; meta.puzzleDailyReward 💎 for all 10) ----------
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
  return n >= 0 ? n : 2;
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
  const buttons = (solved) => actions.replaceChildren(...[
    h('button.btn.ghost.sm', { onclick: () => openPuzzle(i) }, t('puzzle_retry')),
    solved
      ? (i + 1 < list.length
        ? h('button.btn.sm', { onclick: () => openPuzzle(i + 1) }, t('puzzle_next'))
        : h('button.btn.sm', { onclick: closePuzzle }, t('puzzle_back')))
      : null,
  ].filter(Boolean));
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
  const [st, , rankMe] = await Promise.all([
    state.stats ? Promise.resolve(state.stats) : api('GET', '/me').then((r) => r.stats),
    loadFriends(),
    api('GET', '/rankings?board=elo&category=all').then((r) => r.me || null).catch(() => null),
  ]);
  state.stats = st;
  mount('profile', ...renderProfilePage({
    state,
    challengeAction,
    challenge,
    gameRow,
    elo: (rankMe && rankMe.elo) || (st && st.elo) || state.me.elo || 1200,
    rank: rankMe ? rankMe.rank : null,
    goTab: (name) => { closeScreen(true); go(TABS.indexOf(name), true); },
    openHub: (tab) => {
      closeScreen(true);
      if (tab === 'rating') { go(TABS.indexOf('rankings'), true); return; }
      openPlayHubTab(tab); playSnap = ''; go(TABS.indexOf('play'), true);
    },
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
  const NAV_ICONS = { puzzles: 'puzzles', rankings: 'rankings', play: 'gamepad', live: 'trophy', profile: 'profile' };
  const btns = TABS.map((k, i) => {
    const b = h('button.nav-btn', {
      'aria-label': t('nav_' + k),
      'data-tab': k,
      onclick: () => { haptic('select'); go(i, true); },
    }, icon(NAV_ICONS[k] || k, 22), h('span', t('nav_' + k)));
    nav.append(b); return b;
  });
  let W = pager.clientWidth;
  const setX = (px) => { track.style.transform = `translate3d(${px}px,0,0)`; };
  let refreshAfterSlideT = null;
  let stickyAfterSlideT = null;
  go = (i, animate) => {
    const prev = state.index;
    state.index = clamp(i, 0, TABS.length - 1); state.tab = TABS[state.index];
    const changed = state.index !== prev;
    const android = isAndroid();
    if (changed) {
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
      // Instant scroll reset BEFORE slide — animated scroll during transform shakes Android WebView
      const nextPage = page(state.tab);
      const prevPage = page(TABS[prev]);
      if (nextPage) {
        const prevBeh = nextPage.style.scrollBehavior;
        nextPage.style.scrollBehavior = 'auto';
        nextPage.scrollTop = 0;
        nextPage.style.scrollBehavior = prevBeh;
      }
      if (prevPage && prevPage !== nextPage) {
        const prevBeh = prevPage.style.scrollBehavior;
        prevPage.style.scrollBehavior = 'auto';
        prevPage.scrollTop = 0;
        prevPage.style.scrollBehavior = prevBeh;
      }
    }
    // Sticky Play fades with CSS; toggle after paint so opacity/transform transitions run
    track.classList.toggle('settle', !!animate); ind.classList.remove('drag');
    setX(-state.index * W);
    ind.style.transform = `translateX(${state.index * 100}%)`;
    btns.forEach((b, j) => b.classList.toggle('active', j === state.index));
    // Android: defer dock/sticky + refresh until slide finishes (avoids layout thrash / jitter)
    clearTimeout(stickyAfterSlideT);
    clearTimeout(refreshAfterSlideT);
    const afterMs = animate && android ? 360 : 0;
    // Play CTA is inline on Home — dock sticky stays off (no jump on tab/remount)
    setPlaySticky(false);
    if (changed) {
      if (afterMs) {
        refreshAfterSlideT = setTimeout(() => refresh(), afterMs);
      } else {
        // iOS: keep soft scroll-to-top on tab change; Android already jumped above
        if (animate && !android) {
          const p = page(state.tab);
          if (p) smoothScrollTo(p, 0, 560);
        }
        refresh();
      }
    }
    requestAnimationFrame(() => syncScrollTopBtn());
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
  go(TABS.indexOf('play'), false);
  try { initScrollTop(); } catch (e) { console.error('[boot] scroll-top', e); }
}

function rebuildNav() {
  $('#nav').querySelectorAll('.nav-btn').forEach((b, i) => { b.querySelector('span:last-child').textContent = t('nav_' + TABS[i]); b.setAttribute('aria-label', t('nav_' + TABS[i])); });
  if (scrollTopBtn) scrollTopBtn.setAttribute('aria-label', t('scroll_top'));
}
async function rebuildAll() {
  try {
    const me = await api('GET', '/me');
    state.me = me.user; state.stats = me.stats; state.meta = me.meta; setMedalHolders(me.meta && me.meta.MEDAL_HOLDERS);
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

// ---------- start (entry keeps #boot until first home paint finishes) ----------
function dismissBootRevealApp() {
  try {
    const gate = document.getElementById('gate');
    const app = document.getElementById('app');
    if (gate) gate.hidden = true;
    if (app) { app.hidden = false; app.removeAttribute('hidden'); }
    const boot = document.getElementById('boot');
    if (boot && typeof window.__bootLeave === 'function') {
      window.__bootLeave();
    } else if (boot) {
      boot.hidden = true;
      boot.setAttribute('hidden', '');
      boot.style.setProperty('display', 'none', 'important');
      try { boot.remove(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * Wire the Mini App after /me. Keeps splash until play page (+ carousels) is painted.
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
        tg.onEvent && tg.onEvent('safeAreaChanged', syncTgSafeArea);
        tg.onEvent && tg.onEvent('contentSafeAreaChanged', syncTgSafeArea);
        tg.onEvent && tg.onEvent('fullscreenChanged', syncTgSafeArea);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try {
    state.me = me.user; state.stats = me.stats; state.meta = me.meta; setMedalHolders(me.meta && me.meta.MEDAL_HOLDERS);
    setLang(me.user.lang); applyTheme(me.user.theme);
    if (canStyleChess(me.user)) applyChessStyle(me.user.pieceSet, me.user.boardTheme);
    else applyChessStyle(DEFAULT_PIECE_SET, 'green');
  } catch (e) {
    console.error('[boot] theme', e);
  }

  // Paint home under the splash (boot z-index stays on top) so first reveal is complete
  try {
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
    else if (m.t === 'friend_request') {
      haptic('light');
      toast(t('friend_req_toast', { name: (m.from && m.from.name) || '…' }));
      refreshInboxBadges();
    }
    else if (m.t === 'dm') {
      try { refreshInboxBadges(); } catch { /* ignore */ }
      if (isViewingDmThread(m.threadId)) return;
      haptic('success');
      toast(t('msg_new_from', { name: (m.from && m.from.name) || '…' }));
    }
    else if (m.t === 'wallet' && m.user) {
      state.me = { ...state.me, ...m.user };
      const g = m.granted || {};
      const bits = [];
      if (g.diamonds > 0) bits.push(`+${g.diamonds} 💎`);
      if (g.premiumMonths > 0) bits.push(`★ +${g.premiumMonths}`);
      if (g.premiumDays > 0) bits.push(`★ +${g.premiumDays}d`);
      toast(bits.length ? bits.join(' · ') : t('wallet_updated'));
      haptic('success');
      if (canStyleChess(state.me)) applyChessStyle(state.me.pieceSet, state.me.boardTheme);
      refresh();
    }
    else if (m.t === 'tour') { toast(m.text); haptic('light'); refresh(); }
    else if (m.t === 'tour_game') {
      toast(t('swiss_game_ready')); haptic('success');
      if (!openGameId() && m.gameId) {
        api('GET', `/games/${m.gameId}`).then((r) => { if (!openGameId()) openOnline(r.game); }).catch(() => refresh());
      } else refresh();
    }
    else if (m.t === 'game') {
      if (m.game.status === 'active' && m.game.id !== openGameId()) {
        // "Waiting for a friend" / "searching" panels are bottom sheets now, not screens
        const waitSheet = !!$('#sheet-root .friend-wait, #sheet-root .pf-search');
        const waiting = screenOpen() || waitSheet || !!$('.invite-pop');
        clearInvitePop();
        if (waiting) {
          window.dispatchEvent(new CustomEvent('chess-game-active', { detail: m.game }));
          closeScreen(true);
          // Their onClose handlers see joined/cancelled (set by the event above), so nothing is deleted
          if (waitSheet) $$('#sheet-root .backdrop').forEach((el) => el.click());
          openOnline(m.game);
        } else {
          refresh();
        }
      } else if (m.game.id !== openGameId()) refresh();
    } else if (m.t === 'invite_gone') { clearInvitePop(); refresh(); }
  });
  setInterval(() => {
    if (document.hidden || openGameId()) return;
    if (state.tab === 'live' && liveBlocksAutoRefresh()) return;
    if (state.tab === 'profile') return;
    if (['live', 'play'].includes(state.tab)) refresh();
  }, homeTabRefreshMs());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sendBye();
    else {
      if (!wsConnected()) connectWs();
      refresh();
    }
  });
  window.addEventListener('pagehide', () => sendBye());
  document.addEventListener('open-premium', () => {
    $$('#sheet-root .backdrop').forEach((el) => el.click());
    const idx = TABS.indexOf('profile');
    const already = state.index === idx;
    if (!already) go(idx, true);
    else closeScreen(true);
    setTimeout(() => document.dispatchEvent(new CustomEvent('profile-open', { detail: 'premium' })), already ? 60 : 520);
  });
  document.addEventListener('app-open', (ev) => {
    const pageName = ev && ev.detail && ev.detail.page;
    if (!pageName) return;
    if (['play', 'puzzles', 'rankings', 'live', 'profile'].includes(pageName)) {
      go(TABS.indexOf(pageName), true);
      return;
    }
    if (['premium', 'friends', 'settings', 'diamonds', 'gems', 'stats', 'promo'].includes(pageName)) {
      const idx = TABS.indexOf('profile');
      const already = state.index === idx;
      go(idx, true);
      if (already) closeScreen(true);
      setTimeout(
        () => document.dispatchEvent(new CustomEvent('profile-open', { detail: pageName })),
        already ? 60 : (isAndroid() || isLite() ? 400 : 520),
      );
    }
  });

  // Defer referral toast until after splash dismiss (avoids toast under boot)
  const referralToast = me.referralClaim && me.referralClaim.inviteeReward
    ? {
      n: me.referralClaim.inviteeReward,
      name: (me.referralClaim.friend && me.referralClaim.friend.name) || '…',
    }
    : null;

  try { await refresh(); } catch (e) {
    console.error('[boot] refresh', e);
    fail(e);
  }
  try { await handleDeepLink(); } catch (e) {
    console.error('[boot] deep link', e);
    fail(e);
  }

  // Home (+ carousels) painted — dismiss splash in one step
  dismissBootRevealApp();
  if (referralToast) {
    toast(t('invitee_reward', referralToast));
    haptic('success');
  }
}
