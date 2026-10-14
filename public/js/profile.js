// Profile hub: sectioned menu + slide-in subpages (friends, premium, settings, …).
import { h, icon, haptic, toast, api, fail, avatar, shareUrl, confirmSheet, toggle, tg } from './ui.js';
import { t, setLang, getLang, LANGS, LANG_NAMES } from './i18n.js';
import { openScreen } from './screen.js';
import { openAdmin } from './admin.js';
import { stylePickerCard } from './style-ui.js';
import { PIECE_SETS, BOARD_THEMES } from './pieces.js';
import { restyleBoards } from './board.js';
import { restyleOpenGame } from './game.js';
import { PUZZLES } from './puzzles.js';

const APP_VERSION = '1.0.0';
const PZ_KEY = 'chess-puzzles-solved';

const solvedCount = () => {
  try { return (JSON.parse(localStorage.getItem(PZ_KEY)) || []).length; } catch { return 0; }
};

function sec(label) {
  return h('div.sec-label', label);
}

function menuCard(...rows) {
  return h('div.menu-card', rows.filter(Boolean));
}

function menuRow({ ic, title, sub, onClick, trailing, danger, tag }) {
  // Use div when trailing has its own control (e.g. switch) — nested <button> is invalid HTML.
  const el = tag === 'div' ? 'div' : 'button';
  return h(el + '.menu-row' + (danger ? '.danger' : ''), {
    type: el === 'button' ? 'button' : undefined,
    onclick: onClick && el === 'button' ? () => { haptic('select'); onClick(); } : undefined,
  },
    h('span.menu-ic' + (danger ? '.danger' : ''), icon(ic, 22)),
    h('div.grow', h('div.t', title), sub ? h('div.s', sub) : null),
    trailing || (onClick ? icon('chevron', 18) : null));
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

function subTop(title, close) {
  return [
    h('button.back', { type: 'button', onclick: () => close() }, icon('back', 20), t('back')),
    h('div.top', h('h1', title)),
  ];
}

/** @param {object} ctx { state, mount helpers via callbacks } */
export function renderProfilePage(ctx) {
  const { state, challengeAction, gameRow, goTab, rebuildAll, refresh } = ctx;
  const me = state.me;
  const st = state.stats;
  const friends = state.friends || [];
  const s = {
    w: (st?.online?.w || 0) + (st?.ai?.w || 0),
    d: (st?.online?.d || 0) + (st?.ai?.d || 0),
    l: (st?.online?.l || 0) + (st?.ai?.l || 0),
  };
  const save = async (patch) => {
    state.me = (await api('PATCH', '/me', patch)).user;
    return state.me;
  };

  const openStats = async () => {
    let recent = [];
    let stats = st;
    try {
      const l = await api('GET', '/lobby');
      recent = l.games?.recent || [];
      stats = l.stats || stats;
      state.stats = stats;
    } catch (e) { fail(e); }
    const tot = {
      w: (stats?.online?.w || 0) + (stats?.ai?.w || 0),
      d: (stats?.online?.d || 0) + (stats?.ai?.d || 0),
      l: (stats?.online?.l || 0) + (stats?.ai?.l || 0),
    };
    openScreen((close) => [
      ...subTop(t('stats'), close),
      h('div.card.stats',
        h('div.stat', h('b.g', String(tot.w)), h('small', t('wins'))),
        h('div.stat', h('b', String(tot.d)), h('small', t('draws'))),
        h('div.stat', h('b.r', String(tot.l)), h('small', t('losses')))),
      h('div.h2', t('vs_online')),
      h('div.card.stats',
        h('div.stat', h('b', String(stats?.online?.w || 0)), h('small', t('wins'))),
        h('div.stat', h('b', String(stats?.online?.d || 0)), h('small', t('draws'))),
        h('div.stat', h('b', String(stats?.online?.l || 0)), h('small', t('losses')))),
      h('div.h2', t('vs_pc')),
      h('div.card.stats',
        h('div.stat', h('b', String(stats?.ai?.w || 0)), h('small', t('wins'))),
        h('div.stat', h('b', String(stats?.ai?.d || 0)), h('small', t('draws'))),
        h('div.stat', h('b', String(stats?.ai?.l || 0)), h('small', t('losses')))),
      h('div.h2', t('recent')),
      recent.length && gameRow
        ? h('div.list', recent.map((g) => gameRow(g, 'recent')))
        : h('div.empty', h('div.empty-ic', '♞'), t('no_games')),
    ]);
  };

  // Deep-link from announcement carousel → profile subpages
  const onProfileOpen = (e) => {
    const page = e.detail;
    if (page === 'premium') openPremium();
    else if (page === 'diamonds' || page === 'gems') openDiamonds();
    else if (page === 'friends') openFriends();
    else if (page === 'settings') openSettings();
    else if (page === 'stats') openStats();
  };

  const formatSom = (n) => {
    const v = Math.floor(Number(n) || 0);
    if (v >= 1000 && v % 1000 === 0) return `${(v / 1000).toLocaleString('uz-UZ')} ming so'm`;
    return `${v.toLocaleString('uz-UZ')} so'm`;
  };

  const openPayContact = () => {
    const user = (state.meta.payUsername || 'hasanovbobur').replace(/^@/, '');
    const url = `https://t.me/${user}`;
    try {
      if (tg.openTelegramLink) tg.openTelegramLink(url);
      else if (tg.openLink) tg.openLink(url);
      else window.open(url, '_blank', 'noopener');
    } catch { window.open(url, '_blank', 'noopener'); }
  };

  const openDiamonds = () => openScreen((close) => {
    const packs = state.meta.diamondPacks || [];
    const payUser = state.meta.payUsername || 'hasanovbobur';
    const have = state.me.diamonds || 0;
    const orderPack = async (p) => {
      try {
        await api('POST', '/shop/order', { diamonds: p.diamonds, sum: p.sum });
        toast(t('shop_order_sent')); haptic('success');
        openPayContact();
      } catch (e) { fail(e); }
    };
    return [
      ...subTop(t('diamonds'), close),
      h('div.card.gems',
        h('div.gems-top', h('div.gems-num', '💎 ', h('b', String(have)))),
        h('small.muted', t('shop_sub'))),
      h('div.h2', t('shop_packs')),
      packs.length
        ? h('div.list.shop-packs', packs.map((p) => h('button.row.shop-pack', {
          type: 'button',
          onclick: () => { haptic('select'); orderPack(p); },
        },
          h('div.grow', h('div.t', `💎 ${p.diamonds}`), h('div.s', formatSom(p.sum))),
          h('span.pill', t('shop_buy')))))
        : h('div.empty', t('shop_empty')),
      h('p.muted.shop-hint', t('shop_pay_hint', { user: '@' + payUser })),
    ];
  });
  document.removeEventListener('profile-open', document._profileOpenHandler);
  document._profileOpenHandler = onProfileOpen;
  document.addEventListener('profile-open', onProfileOpen);

  const openFriends = () => openScreen((close) => {
    const link = `https://t.me/${state.meta.botUsername}?start=i${state.me.id}`;
    const list = state.friends || [];
    return [
      ...subTop(t('friends_title'), close),
      h('div.card.invite-card', h('div.emoji-big', '🤝'), h('b', t('invite_friends')), h('p.muted', t('invite_sub')),
        h('button.btn', { onclick: () => state.meta.botUsername ? shareUrl(link, t('share_text')) : toast(t('e_server'), true) }, icon('share', 20), t('invite_btn'))),
      h('div.h2', t('your_friends')),
      list.length ? h('div.list', list.map((f) => h('div.row', h('div.avwrap', avatar(f.name, f.id), f.online ? h('i.dot.on') : null),
        h('div.grow', h('div.t', f.name), h('div.s', f.inGame ? t('in_game') : f.online ? t('online') : t('offline'))),
        challengeAction({ ...f, online: f.online }),
        h('button.mini', { 'aria-label': t('remove_friend'), onclick: async () => {
          if (await confirmSheet(`${t('remove_friend')}: ${f.name}?`, t('remove_friend'), true)) {
            try { await api('DELETE', `/friends/${f.id}`); state.friends = (await api('GET', '/friends')).friends; openFriends(); } catch (e) { fail(e); }
          }
        } }, icon('x', 18))))) : h('div.empty', h('div.empty-ic', '👋'), t('no_friends')),
    ];
  });

  const openPremium = () => openScreen((close) => {
    const draw = () => {
      const u = state.me;
      const plans = state.meta.premiumPlans || [
        { months: 1, diamonds: state.meta.PREMIUM_PRICE || 200 },
      ];
      const inviterReward = state.meta.REFERRAL_REWARD || 20;
      const inviteeReward = state.meta.REFERRAL_INVITEE_REWARD || 10;
      const have = u.diamonds || 0;
      const untilLabel = u.premiumUntilTashkent
        ? u.premiumUntilTashkent.replace('T', ' ')
        : null;
      const planLabel = (months) => (months === 12 ? t('premium_plan_year') : t('premium_plan_months', { n: months }));
      const buy = async (months) => {
        try {
          const r = await api('POST', '/premium/buy', { months });
          state.me = r.user;
          toast(t('premium_bought')); haptic('success');
          openPremium();
        } catch (e) { fail(e); }
      };
      return [
        ...subTop(t('premium'), close),
        h('div.card.gems',
          h('div.gems-top', h('div.gems-num', '💎 ', h('b', String(have))), u.premium ? h('span.prem-badge', '★ ' + t('premium')) : null),
          h('small.muted', t('gems_sub', { n: inviterReward, m: inviteeReward })),
          u.premium && untilLabel ? h('div.gems-ok', t('premium_until', { d: untilLabel })) : null,
          u.premium && !untilLabel ? h('div.gems-ok', t('premium_have')) : null),
        h('div.h2', t('premium_plans')),
        h('div.list', plans.map((p) => {
          const can = have >= p.diamonds;
          return h('div.row',
            h('div.grow',
              h('div.t', planLabel(p.months)),
              h('div.s', `${p.diamonds} 💎`)),
            h('button.mini.ok', {
              disabled: !can,
              onclick: () => buy(p.months),
            }, can ? t('premium_buy_short') : t('premium_need_short', { n: p.diamonds - have })));
        })),
        h('button.btn.ghost', { type: 'button', onclick: () => openDiamonds() }, t('shop_get_diamonds')),
      ];
    };
    return draw();
  });

  const openLanguage = () => openScreen((close) => [
    ...subTop(t('language'), close),
    h('div.menu-card', LANGS.map((l) => menuRow({
      ic: 'globe',
      title: LANG_NAMES[l],
      trailing: getLang() === l ? icon('check', 18) : icon('chevron', 18),
      onClick: async () => {
        try {
          await save({ lang: l });
          setLang(l);
          rebuildAll();
          openLanguage();
        } catch (e) { fail(e); }
      },
    }))),
  ]);

  const openSettings = () => openScreen((close) => {
    const u = state.me;
    const locked = !canStyleChess(u);
    const pickPiece = async (v) => {
      if (locked) return toast(t('style_premium_only'), true);
      const prev = { pieceSet: u.pieceSet || 'outline', boardTheme: u.boardTheme || 'classic' };
      applyChessStyle(v, prev.boardTheme);
      try {
        state.me = await save({ pieceSet: v });
        applyChessStyle(state.me.pieceSet, state.me.boardTheme);
        openSettings();
      } catch (e) {
        applyChessStyle(prev.pieceSet, prev.boardTheme);
        fail(e);
      }
    };
    const pickBoard = async (v) => {
      if (locked) return toast(t('style_premium_only'), true);
      const prev = { pieceSet: u.pieceSet || 'outline', boardTheme: u.boardTheme || 'classic' };
      applyChessStyle(prev.pieceSet, v);
      try {
        state.me = await save({ boardTheme: v });
        applyChessStyle(state.me.pieceSet, state.me.boardTheme);
        openSettings();
      } catch (e) {
        applyChessStyle(prev.pieceSet, prev.boardTheme);
        fail(e);
      }
    };
    return [
      ...subTop(t('settings'), close),
      h('div.card.settings',
        h('div.setting', h('div', h('b', t('notifications')), h('small', t('notifications_sub'))),
          toggle(u.notifyEnabled, async (v) => { try { state.me = await save({ notifyEnabled: v }); } catch (e) { fail(e); openSettings(); } })),
        h('div.setting', h('div', h('b', t('discoverable')), h('small', t('discoverable_sub'))),
          toggle(u.discoverable, async (v) => { try { state.me = await save({ discoverable: v }); } catch (e) { fail(e); openSettings(); } }))),
      h('div.h2', t('admin_style'), locked ? h('span.count-pill', '★ Premium') : null),
      stylePickerCard({
        pieceSet: u.pieceSet,
        boardTheme: u.boardTheme,
        locked,
        onPiece: pickPiece,
        onBoard: pickBoard,
      }),
    ];
  });

  const openHelp = () => openScreen((close) => [
    ...subTop(t('help'), close),
    h('div.card.prose',
      h('b', t('help_title')),
      h('p', t('help_p1')),
      h('p', t('help_p2')),
      h('p', t('help_p3'))),
  ]);

  const openTerms = () => openScreen((close) => [
    ...subTop(t('terms'), close),
    h('div.card.prose',
      h('b', t('terms_title')),
      h('p', t('terms_p1')),
      h('p', t('terms_p2'))),
  ]);

  const pzDone = solvedCount();

  return [
    h('div.prof-head',
      h('div.prof-me',
        h('div.big', avatar(me.firstName, me.id, 'xl')),
        h('div.prof-meta',
          h('h2', me.firstName, me.premium ? h('span.prem-badge', ' ★') : null),
          me.username ? h('div.muted', '@' + me.username) : h('div.muted', t('profile_title'))),
        h('button.prof-gem', {
          type: 'button',
          onclick: () => { haptic('select'); openDiamonds(); },
        }, '💎 ', h('b', String(me.diamonds || 0))))),

    sec(t('sec_rating')),
    h('div.rating-row',
      h('button.card.rating-tile', { type: 'button', onclick: () => { haptic('select'); openStats(); } },
        h('span.rating-ic', '♟'),
        h('div', h('small.muted', t('stats')), h('b.rating-n', `${s.w}/${s.d}/${s.l}`)),
        h('div.s', t('wins') + ' · ' + t('draws') + ' · ' + t('losses'))),
      h('button.card.rating-tile', { type: 'button', onclick: () => { haptic('select'); goTab('puzzles'); } },
        h('span.rating-ic', '🧩'),
        h('div', h('small.muted', t('nav_puzzles')), h('b.rating-n', String(pzDone))),
        h('div.s', t('puzzle_solved_count', { a: pzDone, b: PUZZLES.length })))),

    sec(t('sec_game')),
    menuCard(
      menuRow({ ic: 'chart', title: t('stats'), sub: `${s.w}W · ${s.d}D · ${s.l}L`, onClick: openStats }),
      menuRow({ ic: 'rankings', title: t('nav_rankings'), onClick: () => goTab('rankings') }),
      menuRow({ ic: 'handshake', title: t('friends_title'), sub: friends.length ? String(friends.length) : t('no_friends').split('\n')[0], onClick: openFriends }),
      menuRow({ ic: 'gem', title: t('diamonds'), sub: String(me.diamonds || 0) + ' 💎', onClick: openDiamonds }),
      menuRow({
        ic: 'crown',
        title: t('premium'),
        sub: me.premium
          ? (me.premiumUntilTashkent ? t('premium_until', { d: me.premiumUntilTashkent.replace('T', ' ') }) : t('premium_have'))
          : t('premium_plans'),
        onClick: openPremium,
      }),
      me.isAdmin ? menuRow({ ic: 'shield', title: t('admin_panel'), onClick: () => openAdmin(rebuildAll) }) : null,
    ),

    sec(t('sec_settings')),
    menuCard(
      menuRow({ ic: 'globe', title: t('language'), sub: LANG_NAMES[getLang()], onClick: openLanguage }),
      menuRow({ ic: 'gear', title: t('settings'), onClick: openSettings }),
      menuRow({ ic: 'help', title: t('help'), onClick: openHelp }),
      menuRow({ ic: 'docs', title: t('terms'), onClick: openTerms }),
      menuRow({
        tag: 'div',
        ic: 'moon',
        title: t('dark_mode'),
        trailing: toggle(me.theme === 'dark', async (on) => {
          const v = on ? 'dark' : 'light';
          try {
            applyThemeLocal(v);
            state.me = await save({ theme: v });
            refresh();
          } catch (e) { fail(e); refresh(); }
        }),
      }),
    ),

    h('button.btn.logout', {
      type: 'button',
      onclick: async () => {
        if (me.isAdmin) { try { tg.close(); } catch { /* ignore */ } return; }
        if (await confirmSheet(t('delete_confirm'), t('delete_data'), true)) {
          try { await api('DELETE', '/me'); tg.close(); } catch (e) { fail(e); }
        }
      },
    }, icon('logout', 20), me.isAdmin ? t('close_app') : t('delete_data')),
    h('div.app-ver', t('app_version', { v: APP_VERSION })),
  ];
}

function applyThemeLocal(theme) {
  document.documentElement.dataset.theme = theme;
  const bg = theme === 'light' ? '#f3f5f9' : '#111827';
  try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); tg.setBottomBarColor && tg.setBottomBarColor(bg); } catch { /* old */ }
  const m = document.querySelector('meta[name=color-scheme]'); if (m) m.content = theme;
}
