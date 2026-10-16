// Play hub (O'ynash): Online · Reyting · Tarix — neon design.
import { h, icon, haptic, api, fail, avBlock, premIc, pillBar } from './ui.js';
import { t } from './i18n.js';
import { openGameAnalysis } from './analyze.js';
import {
  appHeader, sectionHead, playerPlayRow, filterChip, historyRow, modeCard,
} from './neonui.js';

function goLiveTournaments(ctx) {
  try {
    document.dispatchEvent(new CustomEvent('app-open', { detail: { page: 'live', tourneys: true } }));
  } catch { /* ignore */ }
  ctx.goTab('live');
}

/** @type {'online'|'rating'|'history'} */
let hubTab = 'online';
/** @type {'online'|'friend'|'ai'} */
let modePick = 'online';
let histFilter = 'all';
let ratingBoard = 'elo';
let ratingCat = 'all';

export async function renderPlayHub(mount, deps) {
  const ctx = {
    ...deps,
    remount: () => renderPlayHub(mount, deps),
  };

  const [lobby, friends] = await Promise.all([
    deps.loadLobby(),
    deps.loadFriends().catch(() => []),
  ]);
  const online = lobby.online || [];
  const recent = (lobby.games && lobby.games.recent) || [];
  const elo = (lobby.stats && lobby.stats.elo) || deps.me.elo || 1200;

  const tabs = pillBar(
    [
      ['online', t('hub_tab_online')],
      ['rating', t('hub_tab_rating')],
      ['history', t('hub_tab_history')],
    ],
    hubTab,
    (v) => { hubTab = v; ctx.remount(); },
    { className: 'pill-bar neon-hub-tabs' },
  );

  const hdr = appHeader({
    me: deps.me,
    elo,
    inboxBtns: deps.headerInboxBtns(),
    onProfile: () => deps.goTab('profile'),
    onGems: () => deps.openGems && deps.openGems(),
  });

  let body = [];
  if (hubTab === 'rating') body = await paintRating(ctx);
  else if (hubTab === 'history') body = paintHistory(recent, ctx);
  else body = paintOnline(online, friends, ctx, lobby);

  const sub = hubTab === 'rating' ? t('hub_sub_rating')
    : hubTab === 'history' ? t('hub_sub_history')
      : t('hub_sub_online');

  mount([
    hdr,
    h('div.neon-hub-title', h('h1', t('hub_title')), h('p.muted', sub)),
    tabs,
    ...body,
  ].flat().filter(Boolean));
}

function paintOnline(online, friends, ctx, lobby) {
  const onlineFriends = (friends || []).filter((f) => f.online);
  const nOnline = (lobby && lobby.onlineCount != null) ? lobby.onlineCount : online.length;
  return [
    h('div.neon-mode-row',
      modeCard({
        title: t('hub_mode_online'),
        sub: t('mode_online_sub'),
        tone: 'blue',
        emoji: '🌐',
        selected: modePick === 'online',
        onClick: () => {
          modePick = 'online';
          ctx.ensurePlayFlow().open();
        },
      }),
      modeCard({
        title: t('hub_mode_friend'),
        sub: t('mode_friend_sub'),
        tone: 'gold',
        emoji: '🤝',
        selected: modePick === 'friend',
        onClick: () => {
          modePick = 'friend';
          ctx.startFriendGame();
        },
      }),
      modeCard({
        title: t('hub_mode_ai'),
        sub: t('mode_ai_sub'),
        tone: 'violet',
        emoji: '🤖',
        selected: modePick === 'ai',
        onClick: () => {
          modePick = 'ai';
          ctx.aiSheet();
        },
      })),
    sectionHead(t('hub_now_playing'), () => ctx.goTab('live'), t('see_all')),
    h('p.muted.neon-sec-sub', t('online_now', { n: nOnline })),
    online.length
      ? h('div.neon-list', ...online.slice(0, 40).map((u) => playerPlayRow(u, {
        onProfile: (id) => ctx.openProfile(id),
        onPlay: (x) => ctx.challenge(x.id),
      })))
      : h('div.empty', t('nobody')),
    sectionHead(t('live_tourneys_sec'), () => goLiveTournaments(ctx), t('see_all')),
    h('div.neon-tourney-list',
      h('button.neon-tourney-line', {
        type: 'button',
        onclick: () => { haptic('light'); goLiveTournaments(ctx); },
      },
        h('span.neon-tourney-ic', '🏆'),
        h('div.grow',
          h('div.t', t('live_tab_intl')),
          h('div.s', t('live_tourneys_sec'))),
        icon('chevron', 16))),
    onlineFriends.length
      ? [
        sectionHead(t('online_friends_sec')),
        h('div.neon-list', ...onlineFriends.map((f) => playerPlayRow(
          { ...f, online: true },
          {
            onProfile: (id) => ctx.openProfile(id),
            onPlay: (x) => ctx.challenge(x.id),
            actionLabel: t('invite_short'),
          },
        ))),
      ]
      : null,
  ].flat().filter(Boolean);
}

async function paintRating(ctx) {
  let data = { rankings: [] };
  try {
    data = await api('GET', `/rankings?board=${ratingBoard}&category=${ratingCat}`);
  } catch (e) { fail(e); }
  const rows = data.rankings || [];
  const boardBar = pillBar(
    [['elo', t('rank_board_elo')], ['monthly', t('rank_board_monthly')]],
    ratingBoard,
    (v) => { ratingBoard = v; ctx.remount(); },
    { className: 'pill-bar neon-subtabs' },
  );
  const cats = [
    ['all', t('rank_all') || t('all_users')],
    ['bullet', t('tc_bullet')],
    ['blitz', t('tc_blitz')],
    ['rapid', t('tc_rapid')],
  ];
  return [
    boardBar,
    h('div.neon-chips', ...cats.map(([id, lab]) => filterChip(id, lab, ratingCat === id, () => {
      ratingCat = id; ctx.remount();
    }))),
    h('div.neon-rank-table',
      h('div.neon-rank-cols', h('span', '#'), h('span', t('hub_user_col')), h('span', t('elo'))),
      rows.length
        ? h('div.neon-list', ...rows.map((p, i) => {
          const place = p.rank || (i + 1);
          const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : String(place);
          return h('button.neon-rank-row', {
            type: 'button',
            onclick: () => { haptic('select'); ctx.openProfile(p.id); },
          },
            h('span.neon-rank-n', medal),
            avBlock(p.name, p.id, { premium: !!p.premium, round: true, avatarKey: p.avatarKey }),
            h('div.grow', h('div.t', p.name, p.premium ? premIc() : null)),
            h('b.neon-rank-elo', String(p.score != null ? p.score : p.elo || '—')));
        }))
        : h('div.empty', t('rankings_empty'))),
    ctx.me
      ? h('div.neon-rank-you',
        h('span.neon-rank-n', '·'),
        avBlock(ctx.me.displayName || ctx.me.firstName, ctx.me.id, {
          premium: !!ctx.me.premium, round: true, avatarKey: ctx.me.avatarKey,
        }),
        h('div.grow', h('div.t', t('you'))),
        h('b.neon-rank-elo', String(ctx.me.elo || 1200)))
      : null,
  ].filter(Boolean);
}

function paintHistory(recent, ctx) {
  const filtered = recent.filter((g) => {
    if (histFilter === 'all') return true;
    if (g.result === '1/2-1/2') return histFilter === 'draw';
    const win = (g.result === '1-0') === (g.you === 'w');
    return histFilter === 'win' ? win : !win;
  });
  return [
    h('div.h2', t('hub_history_title')),
    h('div.neon-chips',
      ...[['all', t('hist_all')], ['win', t('hist_win')], ['loss', t('hist_loss')], ['draw', t('hist_draw')]]
        .map(([id, lab]) => filterChip(id, lab, histFilter === id, () => {
          histFilter = id; ctx.remount();
        }))),
    filtered.length
      ? h('div.neon-list', ...filtered.map((g) => historyRow(g, () => {
        openGameAnalysis({
          id: g.id, moves: g.moves, white: g.white, black: g.black, you: g.you, result: g.result,
        });
      })))
      : h('div.empty', t('analyze_empty')),
  ];
}
