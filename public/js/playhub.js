// O'ynash body (Online · Tarix) and the separate Reyting page (neon screenshot design).
import { h, icon, haptic, api, fail } from './ui.js';
import { t } from './i18n.js';
import { openGameAnalysis } from './analyze.js';
import {
  appHeader, pageTitle, segTabs, modeCard, sectionHead, playerRow, filterChip,
  rankRow, historyRow, analysisCard, gameOutcome, levelRow, emptyNote,
} from './neonui.js';

let hubTab = 'online'; // online | history
let mode = 'online'; // online | friend | ai
let ratingPeriod = 'all'; // all | month
let histFilter = 'all';
let friendQuery = '';

const AI_COLOUR_KEY = 'chess-ai-colour';
let aiColour = (() => {
  try { const v = localStorage.getItem(AI_COLOUR_KEY); return v === 'w' || v === 'b' || v === 'r' ? v : 'w'; } catch { return 'w'; }
})();
function setAiColour(v) {
  aiColour = v;
  try { localStorage.setItem(AI_COLOUR_KEY, v); } catch { /* storage blocked */ }
}

const TIMES = ['1+0', '3+2', '5+0', '10+0', '15+10'];

export function openPlayHubTab(tab) {
  if (['online', 'history'].includes(tab)) hubTab = tab;
}

/** Home mode card → O'ynash › Online with that mode preselected. */
export function openPlayHubMode(m) {
  if (['online', 'friend', 'ai'].includes(m)) { hubTab = 'online'; mode = m; }
}

/** O'ynash page body: mode picker + (online | history). The page itself (carousel, daily task…) is built in app.js. */
export async function paintPlayBody(ctx, lobby) {
  const body = hubTab === 'history' ? await paintHistory(ctx) : await paintOnline(ctx, lobby);
  return [
    segTabs([
      ['online', t('hub_tab_online'), 'users'],
      ['history', t('hub_tab_history'), 'history'],
    ], hubTab, (v) => { hubTab = v; ctx.remount(); }, 'hub'),
    ...body,
  ];
}

/** Reyting: its own page in the bottom bar. */
export async function renderRatingPage(mount, deps) {
  const remount = () => renderRatingPage(mount, deps);
  const ctx = { ...deps, remount };
  const lobby = await deps.loadLobby();
  const elo = (lobby.stats && lobby.stats.elo) || deps.me.elo || 1200;
  const body = await paintRating(ctx);
  mount([
    appHeader({
      me: deps.me, elo, inboxBtns: deps.headerInboxBtns(),
      onProfile: () => deps.goTab('profile'), onGems: () => deps.openGems(),
    }),
    pageTitle(t('nav_rankings'), t('hub_sub_rating')),
    ...body,
  ]);
}

async function paintOnline(ctx, lobby) {
  const modes = h('div.nx-mode-row.compact',
    modeCard({
      compact: true, tone: 'blue', glyph: '🌐', selected: mode === 'online',
      title: t('hub_mode_online'), sub: t('mode_online_sub'),
      onClick: () => { mode = 'online'; ctx.remount(); },
    }),
    modeCard({
      compact: true, tone: 'gold', glyph: '👥', selected: mode === 'friend',
      title: t('hub_mode_friend'), sub: t('mode_friend_sub'),
      onClick: () => { mode = 'friend'; ctx.remount(); },
    }),
    modeCard({
      compact: true, tone: 'violet', glyph: '🤖', selected: mode === 'ai',
      title: t('hub_mode_ai'), sub: t('mode_ai_sub'),
      onClick: () => { mode = 'ai'; ctx.remount(); },
    }));
  if (mode === 'friend') return [modes, ...(await paintFriends(ctx))];
  if (mode === 'ai') return [modes, ...paintAi(ctx)];
  return [modes, ...(await paintOnlinePlayers(ctx, lobby))];
}

function timeChips(ctx) {
  const cur = ctx.getSelectedTime();
  return h('div.nx-chips', { 'data-noswipe': '' },
    ...['any', ...TIMES].map((id) => filterChip(id, id === 'any' ? t('any_time') : id, cur === id, () => { ctx.setSelectedTime(id); ctx.remount(); })));
}

async function paintOnlinePlayers(ctx, lobby) {
  const cur = ctx.getSelectedTime();
  const tc = cur === 'any' ? t('any_time') : cur;
  const quick = h('button.nx-cta', {
    type: 'button',
    onclick: () => { haptic('medium'); ctx.ensurePlayFlow().quick(); },
  }, icon('bolt', 18), t('quick_match_btn'));
  const online = lobby.online || [];
  return [
    timeChips(ctx),
    quick,
    sectionHead(t('hub_now_playing'), null, null, { dot: 'green', sub: t('online_people', { n: lobby.onlineCount || online.length }) }),
    online.length
      ? h('div.nx-list', ...online.map((u) => playerRow(u, {
        tc, onProfile: ctx.openProfile, onPlay: (x) => ctx.challenge(x.id),
      })))
      : emptyNote(t('nobody'))];
}

async function paintFriends(ctx) {
  let friends = [];
  try { friends = await ctx.loadFriends(); } catch (e) { fail(e); }
  const q = friendQuery.trim().toLowerCase();
  const list = friends.filter((f) => !q || String(f.name || '').toLowerCase().includes(q));
  const onlineN = friends.filter((f) => f.online).length;
  const listHost = h('div.nx-list');
  const paint = (rows) => listHost.replaceChildren(...(rows.length
    ? rows.map((f) => playerRow({ ...f, online: !!f.online }, {
      onProfile: ctx.openProfile,
      onPlay: (x) => ctx.challenge(x.id),
      actionLabel: f.online ? t('invite_full') : t('offline'),
      actionIcon: 'gamepad',
    }))
    : [emptyNote(t('no_friends'))]));
  paint(list);
  const input = h('input.nx-search-in', {
    type: 'search', placeholder: t('friend_search_ph'), value: friendQuery,
    oninput: (e) => {
      friendQuery = e.target.value;
      const qq = friendQuery.trim().toLowerCase();
      paint(friends.filter((f) => !qq || String(f.name || '').toLowerCase().includes(qq)));
    },
  });
  return [
    h('div.nx-search',
      h('label.nx-search-box', icon('search', 18), input),
      h('button.nx-round', {
        type: 'button', 'aria-label': t('invite_btn'),
        onclick: () => { haptic('light'); ctx.openFriends(); },
      }, icon('userPlus', 20))),
    timeChips(ctx),
    h('button.nx-cta.ghost', {
      type: 'button', onclick: () => { haptic('medium'); ctx.startFriendGame(); },
    }, icon('link', 18), t('friend_link_game')),
    sectionHead(t('online_friends_sec'), null, null, { sub: null }),
    h('div.nx-sec-count', h('i.nx-dot.green'), t('count_ta', { n: onlineN })),
    listHost,
  ];
}

function paintAi(ctx) {
  const levels = [
    [1, 'ai_l1', '400 – 800'],
    [2, 'ai_l2', '800 – 1200'],
    [3, 'ai_l3', '1200 – 1600'],
    [4, 'ai_l4', '1600 – 2000'],
    [5, 'ai_l5', '2000+'],
  ];
  return [
    sectionHead(t('play_as')),
    segTabs([
      ['w', '♔ ' + t('white')],
      ['r', '🎲 ' + t('random')],
      ['b', '♚ ' + t('black')],
    ], aiColour, (v) => { setAiColour(v); ctx.remount(); }, 'sub'),
    timeChips(ctx),
    sectionHead(t('ai_pick_level')),
    h('div.nx-list', ...levels.map(([n, key, range]) => levelRow({
      n, title: t(key), range, desc: t(key + '_d'),
      onClick: () => ctx.startAi(n, aiColour, { allowUndo: true }),
    }))),
  ];
}

async function paintRating(ctx) {
  if (!['all', 'month'].includes(ratingPeriod)) ratingPeriod = 'all';
  const q = ratingPeriod === 'all'
    ? 'board=elo&category=all'
    : `board=period&period=${ratingPeriod}&category=all`;
  let data = { rankings: [], me: null };
  try { data = await api('GET', `/rankings?${q}`); } catch (e) { fail(e); }
  const isElo = ratingPeriod === 'all';
  const rows = (data.rankings || []).map((p) => ({ ...p, score: isElo ? (p.elo ?? p.points) : p.points }));
  const meId = ctx.me.id;
  const mine = data.me || {};
  const myRow = {
    id: meId, rank: mine.rank, name: ctx.me.displayName || ctx.me.firstName, premium: !!ctx.me.premium,
    avatarKey: ctx.me.avatarKey, score: isElo ? (mine.elo || ctx.me.elo || 1200) : (mine.points || 0),
  };
  const subTabs = segTabs([
    ['all', t('rank_all_time')], ['month', t('rank_month')],
  ], ratingPeriod, (v) => { ratingPeriod = v; ctx.remount(); }, 'sub');
  return [
    subTabs,
    h('div.nx-rank-cols', h('span', '#'), h('span', t('hub_user_col')), h('span', isElo ? t('rating_col') : t('points_col'))),
    rows.length
      ? h('div.nx-list.rank', ...rows.map((p) => (String(p.id) === String(meId)
        ? rankRow(p, { you: true, onOpen: () => ctx.goTab('profile') })
        : rankRow(p, { onOpen: ctx.openProfile }))))
      : emptyNote(t('rankings_empty')),
    rows.some((p) => String(p.id) === String(meId))
      ? null
      : h('div.nx-rank-pin', rankRow(myRow, { you: true, onOpen: () => ctx.goTab('profile') })),
  ];
}

async function paintHistory(ctx) {
  let games = [];
  try { games = (await api('GET', '/games/history')).games || []; } catch (e) { fail(e); }
  const filtered = games.filter((g) => histFilter === 'all' || gameOutcome(g) === histFilter);
  return [
    analysisCard(),
    sectionHead(t('hub_history_title')),
    h('div.nx-chips.fit', { 'data-noswipe': '' },
      ...[['all', t('hist_all')], ['win', t('hist_win')], ['loss', t('hist_loss')], ['draw', t('hist_draw')]]
        .map(([id, lab]) => filterChip(id, lab, histFilter === id, () => { histFilter = id; ctx.remount(); }))),
    filtered.length
      ? h('div.nx-list', ...filtered.map((g) => historyRow(g, () => openGameAnalysis({
        id: g.id, moves: g.moves, white: g.white, black: g.black, you: g.you, result: g.result,
      }))))
      : emptyNote(t('analyze_empty')),
  ];
}
