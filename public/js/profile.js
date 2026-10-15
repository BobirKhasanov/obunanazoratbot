// Profile hub: sectioned menu + slide-in subpages (friends, premium, settings, …).
import { h, icon, haptic, toast, api, fail, avBlock, premIc, shareUrl, confirmSheet, toggle, tg, sheet, getInitData, ApiError } from './ui.js';
import { t, setLang, getLang, LANGS, LANG_NAMES } from './i18n.js';
import { openScreen } from './screen.js';
import { openAdmin } from './admin.js';
import { openUserProfile } from './userprofile.js';
import { openChatWithUser } from './inbox.js';
export { openUserProfile };
import { stylePickerCard } from './style-ui.js';
import { PIECE_SETS, BOARD_THEMES } from './pieces.js';
import { restyleBoards } from './board.js';
import { restyleOpenGame } from './game.js';
import { dailyPuzzles, tashkentDayKey } from './puzzles.js';

const APP_VERSION = '1.0.0';
const PZ_KEY = 'chess-puzzles-daily';

const solvedCount = () => {
  try {
    const day = tashkentDayKey();
    const raw = JSON.parse(localStorage.getItem(PZ_KEY) || 'null');
    if (!raw || raw.day !== day || !Array.isArray(raw.ids)) return 0;
    return raw.ids.length;
  } catch { return 0; }
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
  root.dataset.pieces = PIECE_SETS.includes(pieceSet) ? pieceSet : 'neo';
  root.dataset.board = BOARD_THEMES.includes(boardTheme) ? boardTheme : 'green';
  restyleBoards();
  try { restyleOpenGame(); } catch { /* no open game */ }
}

function canStyleChess(me) {
  return !!(me && (me.premium || me.isAdmin));
}

function subTop(title, close) {
  return [
    h('div.top.sub-top',
      h('button.round.back', {
        type: 'button', 'aria-label': t('back'),
        onclick: () => { haptic('light'); close(); },
      }, icon('back', 20)),
      h('h1', title),
      h('span.inbox-head-spacer', { 'aria-hidden': 'true' }),
    ),
  ];
}

/** @param {object} ctx { state, mount helpers via callbacks } */
export function renderProfilePage(ctx) {
  const { state, challengeAction, challenge, gameRow, goTab, rebuildAll, refresh } = ctx;
  const me = state.me;
  const st = state.stats;
  const friends = state.friends || [];
  // Online PvP only — vs-computer never counts in stats / ratings
  const s = {
    w: st?.online?.w || 0,
    d: st?.online?.d || 0,
    l: st?.online?.l || 0,
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
      w: stats?.online?.w || 0,
      d: stats?.online?.d || 0,
      l: stats?.online?.l || 0,
    };
    openScreen((close) => [
      ...subTop(t('stats'), close),
      h('div.card.stats',
        h('div.stat', h('b.g', String(tot.w)), h('small', t('wins'))),
        h('div.stat', h('b', String(tot.d)), h('small', t('draws'))),
        h('div.stat', h('b.r', String(tot.l)), h('small', t('losses')))),
      h('p.muted', t('stats_online_only')),
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
    let have = state.me.diamonds || 0;
    let selected = null;
    let history = null;
    let histLoading = true;
    const host = h('div.diamonds-host');
    const orderSelected = async () => {
      if (!selected) { toast(t('shop_pick_pack'), true); return; }
      try {
        await api('POST', '/shop/order', { diamonds: selected.diamonds, sum: selected.sum });
        toast(t('shop_order_sent')); haptic('success');
        openPayContact();
        loadHistory();
      } catch (e) { fail(e); }
    };
    const kindLabel = (item) => {
      const k = item.kind;
      const meta = item.meta || {};
      if (k === 'referral_inviter') return t('gem_hist_referral_out');
      if (k === 'referral_invitee') return t('gem_hist_referral_in');
      if (k === 'admin_grant') return t('gem_hist_admin_grant');
      if (k === 'admin_remove') return t('gem_hist_admin_remove');
      if (k === 'premium_buy') return t('gem_hist_premium', { n: meta.months || 1 });
      if (k === 'puzzle_daily') return t('gem_hist_puzzle');
      if (k === 'shop_order') return t('gem_hist_shop_order', { n: meta.diamonds || 0, sum: formatSom(meta.sum || 0) });
      return k;
    };
    const fmtWhen = (iso) => {
      try {
        return new Intl.DateTimeFormat(undefined, {
          timeZone: 'Asia/Tashkent',
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }).format(new Date(iso));
      } catch { return String(iso || '').slice(0, 16); }
    };
    const draw = () => {
      have = state.me.diamonds || 0;
      host.replaceChildren(
        h('div.card.gems',
          h('div.gems-top', h('div.gems-num', '💎 ', h('b', String(have)))),
          h('small.muted', t('shop_sub'))),
        h('div.h2', t('shop_packs')),
        packs.length
          ? h('div.list.shop-packs', packs.map((p) => {
            const on = selected && selected.diamonds === p.diamonds && selected.sum === p.sum;
            return h('button.row.shop-pack' + (on ? '.on' : ''), {
              type: 'button',
              onclick: () => { haptic('select'); selected = p; draw(); },
            },
              h('div.grow', h('div.t', `💎 ${p.diamonds}`), h('div.s', formatSom(p.sum))),
              h('span.pill', on ? t('shop_selected') : t('shop_buy')));
          }))
          : h('div.empty', t('shop_empty')),
        h('button.btn', {
          type: 'button',
          onclick: () => { haptic('medium'); orderSelected(); },
        }, icon('mail', 18), t('shop_write_admin')),
        h('p.muted.shop-hint', t('shop_pay_hint', { user: '@' + payUser })),
        h('div.h2', t('gem_hist_title')),
        histLoading
          ? h('div.muted', t('loading') || '…')
          : (!(history && history.length)
            ? h('div.empty', h('div.empty-ic', '💎'), t('gem_hist_empty'))
            : h('div.list.gem-hist', history.map((item) => {
              const amt = Number(item.amount || 0);
              const sign = amt > 0 ? '+' : '';
              const amtText = amt === 0 && item.kind === 'shop_order'
                ? `💎 ${item.meta && item.meta.diamonds ? item.meta.diamonds : '—'}`
                : `${sign}${amt} 💎`;
              return h('div.row.gem-hist-row',
                h('div.grow',
                  h('div.t', kindLabel(item)),
                  h('div.s', fmtWhen(item.at))),
                h('span.pill' + (amt > 0 ? '.ok' : amt < 0 ? '.bad' : ''), amtText));
            }))),
      );
    };
    const loadHistory = async () => {
      histLoading = true; draw();
      try {
        const r = await api('GET', '/me/diamonds/history');
        history = r.items || [];
      } catch { history = []; }
      histLoading = false; draw();
    };
    draw();
    loadHistory();
    return [...subTop(t('diamonds'), close), host];
  });
  document.removeEventListener('profile-open', document._profileOpenHandler);
  document._profileOpenHandler = onProfileOpen;
  document.addEventListener('profile-open', onProfileOpen);

  const openFriends = () => openScreen((close) => {
    // startapp opens Mini App with signed start_param → /me pays both sides once
    const link = `https://t.me/${state.meta.botUsername}?startapp=i${state.me.id}`;
    const list = state.friends || [];
    return [
      ...subTop(t('friends_title'), close),
      h('div.card.invite-card', h('div.emoji-big', '🤝'), h('b', t('invite_friends')), h('p.muted', t('invite_sub')),
        h('button.btn', { onclick: () => state.meta.botUsername ? shareUrl(link, t('share_text')) : toast(t('e_server'), true) }, icon('share', 20), t('invite_btn'))),
      h('div.h2', t('your_friends')),
      list.length ? h('div.list', list.map((f) => h('div.row',
        h('button.plain', {
          type: 'button',
          onclick: () => openUserProfile(f.id, {
            onChallenge: challenge ? (u) => challenge(u.id) : undefined,
            refreshHome: refresh,
          }),
        }, avBlock(f.name, f.id, { premium: !!f.premium, online: !!f.online, round: true })),
        h('button.grow.plain', {
          type: 'button',
          onclick: () => openUserProfile(f.id, {
            onChallenge: challenge ? (u) => challenge(u.id) : undefined,
            refreshHome: refresh,
          }),
        },
          h('div.t', h('span.name', f.name), f.premium ? premIc() : null),
          h('div.s', f.inGame ? t('in_game') : f.online ? t('online') : t('offline'))),
        h('button.mini', {
          type: 'button',
          'aria-label': t('msg_send'),
          title: t('msg_send'),
          onclick: () => { haptic('select'); openChatWithUser(f.id, { id: f.id, name: f.name, premium: !!f.premium }); },
        }, icon('chat', 18)),
        challengeAction({ ...f, friend: true, online: f.online, discoverable: true }),
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
      const feats = [
        t('premium_feat_avatar'),
        t('premium_feat_style'),
        t('premium_feat_bio'),
        t('premium_feat_badge'),
      ];
      return [
        ...subTop(t('premium'), close),
        h('div.card.gems',
          h('div.gems-top', h('div.gems-num', '💎 ', h('b', String(have))), u.premium ? h('span.prem-badge', premIc(), ' ', t('premium')) : null),
          h('small.muted', t('gems_sub', { n: inviterReward, m: inviteeReward })),
          u.premium && untilLabel ? h('div.gems-ok', t('premium_until', { d: untilLabel })) : null,
          u.premium && !untilLabel ? h('div.gems-ok', t('premium_have')) : null),
        h('div.h2', t('premium_unlocks')),
        h('ul.prem-feats', feats.map((line) => h('li', line))),
        h('div.h2', t('premium_plans')),
        u.premium
          ? h('p.muted', t('premium_wait_expiry'))
          : h('div.list', plans.map((p) => {
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
      const prev = { pieceSet: u.pieceSet || 'neo', boardTheme: u.boardTheme || 'green' };
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
      const prev = { pieceSet: u.pieceSet || 'neo', boardTheme: u.boardTheme || 'green' };
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

  const downloadMedal = (url, name) => {
    const a = h('a', { href: url, download: name || 'medal.svg', target: '_blank', rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  };

  const dash = (v) => (v && String(v).trim()) || '—';

  const editPersonalSheet = (onSaved) => {
    const u = state.me;
    const first = h('input.input', { value: u.firstName || '', maxlength: 64, placeholder: t('info_first') });
    const last = h('input.input', { value: u.lastName || '', maxlength: 64, placeholder: t('info_last') });
    sheet((close) => [
      h('h2', t('info_personal')),
      h('div.label', t('info_first')), first,
      h('div.label', t('info_last')), last,
      h('p.muted', t('info_username_locked', { u: u.username ? '@' + u.username : '—' })),
      h('button.cta', {
        type: 'button',
        onclick: async () => {
          try {
            state.me = await save({ firstName: first.value, lastName: last.value });
            toast(t('info_saved')); haptic('success');
            close(); onSaved && onSaved(); refresh();
          } catch (e) { fail(e); }
        },
      }, t('save')),
    ]);
  };

  const editAddressSheet = (onSaved) => {
    const u = state.me;
    const country = h('input.input', { value: u.country || '', maxlength: 64, placeholder: t('info_country') });
    const region = h('input.input', { value: u.region || '', maxlength: 64, placeholder: t('info_region') });
    sheet((close) => [
      h('h2', t('info_address')),
      h('div.label', t('info_country')), country,
      h('div.label', t('info_region')), region,
      h('button.cta', {
        type: 'button',
        onclick: async () => {
          try {
            state.me = await save({ country: country.value, region: region.value });
            toast(t('info_saved')); haptic('success');
            close(); onSaved && onSaved(); refresh();
          } catch (e) { fail(e); }
        },
      }, t('save')),
    ]);
  };

  const openMyInfo = () => openScreen((close) => {
    const host = h('div.myinfo');
    const draw = () => {
      const u = state.me;
      const nodes = [
        h('button.myinfo-av', {
          type: 'button',
          onclick: () => { haptic('select'); openAvatar(); },
        }, avBlock(u.displayName || u.firstName, u.id, {
          premium: !!u.premium, size: 'xl', round: true, avatarKey: u.avatarKey,
        })),
        h('div.info-sec',
          h('div.info-sec-h',
            h('span', t('info_personal')),
            h('button.info-edit', {
              type: 'button', 'aria-label': t('profile_edit'),
              onclick: () => { haptic('select'); editPersonalSheet(draw); },
            }, icon('pencil', 16))),
          h('div.info-card',
            h('div.info-row', h('span', t('info_first')), h('b', dash(u.firstName))),
            h('div.info-row', h('span', t('info_last')), h('b', dash(u.lastName))),
            h('div.info-row', h('span', t('info_username')), h('b.locked', u.username ? '@' + u.username : '—')))),
        h('div.info-sec',
          h('div.info-sec-h',
            h('span', t('info_address')),
            h('button.info-edit', {
              type: 'button', 'aria-label': t('profile_edit'),
              onclick: () => { haptic('select'); editAddressSheet(draw); },
            }, icon('pencil', 16))),
          h('div.info-card',
            h('div.info-row', h('span', t('info_country')), h('b', dash(u.country))),
            h('div.info-row', h('span', t('info_region')), h('b', dash(u.region))))),
        u.premium || u.isAdmin
          ? h('div.info-sec',
            h('div.info-sec-h',
              h('span', t('info_bio')),
              h('button.info-edit', {
                type: 'button', 'aria-label': t('profile_edit'),
                onclick: () => {
                  haptic('select');
                  const inp = h('textarea.input', {
                    rows: 3, maxlength: 160, value: u.bio || '', placeholder: t('info_bio_ph'),
                  });
                  sheet((c) => [
                    h('h2', t('info_bio')),
                    inp,
                    h('button.cta', {
                      type: 'button',
                      onclick: async () => {
                        try {
                          state.me = await save({ bio: inp.value });
                          toast(t('info_saved')); haptic('success');
                          c(); draw(); refresh();
                        } catch (e) { fail(e); }
                      },
                    }, t('save')),
                  ]);
                },
              }, icon('pencil', 16))),
            h('div.info-card',
              h('div.info-row', h('span', t('info_bio')), h('b', dash(u.bio)))))
          : null,
        h('button.btn.ghost', {
          type: 'button',
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 18), t('back')),
        !u.isAdmin
          ? h('button.info-delete', {
            type: 'button',
            onclick: async () => {
              haptic('light');
              if (!(await confirmSheet(t('delete_confirm'), t('delete_data'), true))) return;
              try { await api('DELETE', '/me'); tg.close(); } catch (e) { fail(e); }
            },
          }, t('delete_account'))
          : null,
      ].filter(Boolean);
      host.replaceChildren(...nodes);
    };
    draw();
    return [
      h('div.top.myinfo-top',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 22)),
        h('h1', t('my_info')),
        h('span.myinfo-top-spacer', { 'aria-hidden': 'true' })),
      host,
    ];
  });

  const openAvatar = () => openScreen((close) => {
    const host = h('div');
    let chars = [];
    const draw = async () => {
      let medals = [];
      try {
        const [r, ch] = await Promise.all([
          api('GET', '/medals/mine'),
          fetch('/api/char-avatars').then((x) => x.json()).catch(() => ({ avatars: [] })),
        ]);
        medals = r.medals || [];
        if (r.avatarKey != null) state.me.avatarKey = r.avatarKey;
        chars = ch.avatars || [];
      } catch (e) { fail(e); }
      const meNow = state.me;
      const cur = meNow.avatarKey || null;
      const canPhoto = !!(meNow.premium || meNow.isAdmin);
      const isPhoto = !!(cur && /^img:/i.test(cur));
      const isChar = !!(cur && /^char:/i.test(cur));
      const selectedChar = isChar ? chars.find((c) => c.key === cur) : null;
      const pick = async (key) => {
        try {
          state.me = await save({ avatarKey: key });
          toast(t('avatar_saved')); haptic('success');
          draw(); refresh();
        } catch (e) { fail(e); }
      };
      const fileInp = h('input', {
        type: 'file', accept: 'image/jpeg,image/png,image/gif,.jpg,.jpeg,.png,.gif',
        style: { display: 'none' },
        onchange: async () => {
          const file = fileInp.files && fileInp.files[0];
          fileInp.value = '';
          if (!file) return;
          if (!canPhoto) {
            toast(t('avatar_photo_premium'), true);
            document.dispatchEvent(new CustomEvent('open-premium'));
            return;
          }
          if (file.size > 5 * 1024 * 1024) return toast(t('e_media_big'), true);
          try {
            const res = await fetch('/api/me/avatar', {
              method: 'POST',
              headers: { 'X-Init-Data': getInitData() },
              body: file,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new ApiError(res.status, data);
            state.me = data.user;
            toast(t('avatar_saved')); haptic('success');
            draw(); refresh();
          } catch (e) { fail(e); }
        },
      });
      host.replaceChildren(
        h('div.char-preview',
          h('div.char-preview-av', avBlock(meNow.firstName, meNow.id, {
            size: 'xl', round: true, avatarKey: cur, premium: !!(meNow.premium),
          })),
          h('div.char-preview-meta',
            h('div.char-name-badge',
              h('div.t', selectedChar ? selectedChar.name : (isPhoto ? t('avatar_photo') : (!cur ? t('avatar_letter') : t('avatar_title')))),
              h('div.s', meNow.displayName || meNow.firstName || ''),
            ),
          ),
        ),
        h('div.h2', t('avatar_chars')),
        chars.length
          ? h('div.char-grid', chars.map((c) => h('button.char-tile' + (cur === c.key ? '.on' : ''), {
            type: 'button',
            title: c.name,
            onclick: () => { haptic('select'); pick(c.key); },
          }, h('img', { src: c.url, alt: c.name, draggable: 'false' }))))
          : h('p.muted', t('avatar_chars_empty')),
        h('div.h2', t('avatar_default')),
        h('button.avatar-pick' + (!cur ? '.on' : ''), {
          type: 'button',
          onclick: () => pick(null),
        }, avBlock(meNow.firstName, meNow.id, { size: 'xl', round: true }), h('span', t('avatar_letter'))),
        h('div.h2', t('avatar_photo')),
        canPhoto
          ? h('button.avatar-pick' + (isPhoto ? '.on' : ''), {
            type: 'button',
            onclick: () => { haptic('select'); fileInp.click(); },
          },
            isPhoto
              ? avBlock(meNow.firstName, meNow.id, { size: 'xl', round: true, avatarKey: cur })
              : h('div.avatar.xl.photo-ph', icon('image', 28)),
            h('span', isPhoto ? t('avatar_photo_change') : t('avatar_photo_pick')))
          : h('button.avatar-pick.locked', {
            type: 'button',
            onclick: () => {
              toast(t('avatar_photo_premium'), true);
              document.dispatchEvent(new CustomEvent('open-premium'));
            },
          }, h('div.avatar.xl.photo-ph', icon('image', 28)), h('span', t('avatar_photo_premium'))),
        fileInp,
        h('div.h2', t('avatar_medals')),
        medals.length
          ? h('div.medal-grid', medals.map((m) => h('div.medal-card' + (cur === m.key ? '.on' : ''),
            h('button.avatar-pick', {
              type: 'button',
              onclick: () => pick(m.key),
            },
              h('img.medal-preview', { src: m.url, alt: m.title }),
              h('div.t', m.title),
              h('div.s', m.monthLabel + ' · #' + m.place)),
            h('div.medal-actions',
              h('button.mini', {
                type: 'button',
                onclick: () => { haptic('select'); downloadMedal(m.url, `medal-${m.month}-top${m.place}.svg`); },
              }, t('avatar_download')),
              h('button.mini', {
                type: 'button',
                onclick: () => {
                  haptic('select');
                  shareUrl(m.url, `${m.title} · @${state.meta.botUsername || 'Chess_uz_bot'}`);
                },
              }, t('avatar_share'))))))
          : h('div.empty', h('div.empty-ic', '🏅'), t('avatar_medals_empty')),
      );
    };
    draw();
    return [...subTop(t('avatar_title'), close), host];
  });

  const openHelp = () => openScreen((close) => {
    const area = h('textarea.input', {
      rows: 4, maxlength: 1000, placeholder: t('feedback_ph'),
    });
    const send = h('button.cta', {
      type: 'button',
      onclick: async () => {
        try {
          await api('POST', '/feedback', { body: area.value });
          area.value = '';
          toast(t('feedback_sent')); haptic('success');
        } catch (e) { fail(e); }
      },
    }, t('feedback_send'));
    return [
      ...subTop(t('help'), close),
      h('div.card.prose',
        h('b', t('help_title')),
        h('p', t('help_p1')),
        h('p', t('help_p2')),
        h('p', t('help_p3'))),
      h('div.h2', t('feedback_title')),
      h('p.muted', t('feedback_sub')),
      area,
      send,
    ];
  });

  const openTerms = () => openScreen((close) => [
    ...subTop(t('terms'), close),
    h('div.card.prose',
      h('b', t('terms_title')),
      h('p', t('terms_p1')),
      h('p', t('terms_p2'))),
  ]);

  const pzDone = solvedCount();

  const bannerUrl = (state.meta && state.meta.profileBannerUrl) || '/img/profile-banner.png';
  const shownName = me.displayName || [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Player';

  return [
    h('div.prof-cover',
      h('div.prof-banner', { style: { backgroundImage: `url("${bannerUrl}")` } },
        h('button.prof-edit', {
          type: 'button',
          onclick: () => { haptic('select'); openMyInfo(); },
        }, icon('pencil', 16), t('profile_edit'))),
      h('div.prof-band',
        h('button.prof-av' + (me.premium ? '.prem-glow' : ''), {
          type: 'button',
          title: t('avatar_title'),
          onclick: () => {
            haptic('select');
            openUserProfile(me.id, { refreshHome: refresh });
          },
        }, avBlock(shownName, me.id, { premium: !!me.premium, size: 'xl', round: true, sparkles: !!me.premium, avatarKey: me.avatarKey })),
        h('div.prof-meta',
          h('h2', h('span.name', shownName), me.premium ? premIc() : null),
          me.username ? h('div.prof-user', me.username) : h('div.prof-user', t('profile_title'))),
        h('button.prof-gem', {
          type: 'button',
          title: t('diamonds'),
          onclick: () => { haptic('select'); openDiamonds(); },
        }, h('span.prof-gem-ic', '💎'), h('b', String(me.diamonds || 0))))),

    h('div.prof-body',
      sec(t('sec_rating')),
      h('div.rating-row',
        h('button.card.rating-tile', { type: 'button', onclick: () => { haptic('select'); openStats(); } },
          h('span.rating-ic', '♟'),
          h('div', h('small.muted', t('stats')), h('b.rating-n', `${s.w}/${s.d}/${s.l}`)),
          h('div.s', t('wins') + ' · ' + t('draws') + ' · ' + t('losses'))),
        h('button.card.rating-tile', { type: 'button', onclick: () => { haptic('select'); goTab('puzzles'); } },
          h('span.rating-ic', '🧩'),
          h('div', h('small.muted', t('nav_puzzles')), h('b.rating-n', String(pzDone))),
          h('div.s', t('puzzle_solved_count', { a: pzDone, b: dailyPuzzles().length })))),

      sec(t('sec_game')),
      menuCard(
        menuRow({ ic: 'chart', title: t('stats'), sub: `${s.w}W · ${s.d}D · ${s.l}L`, onClick: openStats }),
        menuRow({ ic: 'rankings', title: t('nav_rankings'), onClick: () => goTab('rankings') }),
        menuRow({ ic: 'profile', title: t('avatar_title'), sub: t('avatar_menu_sub'), onClick: openAvatar }),
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
        menuRow({ ic: 'profile', title: t('my_info'), sub: t('my_info_sub'), onClick: openMyInfo }),
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
        !me.isAdmin
          ? menuRow({
            ic: 'trash',
            title: t('delete_account'),
            sub: t('delete_data'),
            danger: true,
            onClick: async () => {
              if (!(await confirmSheet(t('delete_confirm'), t('delete_account'), true))) return;
              try {
                await api('DELETE', '/me');
                try { tg.close(); } catch { /* ignore */ }
              } catch (e) { fail(e); }
            },
          })
          : null,
      ),

      h('div.app-ver', t('app_version', { v: APP_VERSION })),
    ),
  ];
}

function applyThemeLocal(theme) {
  document.documentElement.dataset.theme = theme;
  const bg = theme === 'light' ? '#f3f5f9' : '#111827';
  try {
    tg.setHeaderColor(bg);
    tg.setBackgroundColor(bg);
    if (tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch { /* old */ }
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
  const app = document.getElementById('app');
  if (app) app.style.background = bg;
  const m = document.querySelector('meta[name=color-scheme]'); if (m) m.content = theme;
}
