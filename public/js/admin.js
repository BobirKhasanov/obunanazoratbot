// Admin panel: sectioned hub (live, announcements, users/grants, shop, broadcast, style).
import { h, icon, haptic, toast, api, fail, getInitData, avatar, confirmSheet, seg } from './ui.js';
import { t, LANGS, LANG_NAMES } from './i18n.js';
import { restyleBoards } from './board.js';
import { restyleOpenGame } from './game.js';
import { stylePickerCard } from './style-ui.js';
import { openScreen } from './screen.js';

let timer = null;
const COLOR_KEYS = ['default', 'primary', 'success', 'danger'];
const swatch = { default: 'var(--card-2)', primary: '#2f81f7', success: '#2ea043', danger: '#e5484d' };

function sec(label) {
  return h('div.sec-label', label);
}

function menuCard(...rows) {
  return h('div.menu-card', rows.filter(Boolean));
}

function menuRow({ ic, title, sub, onClick }) {
  return h('button.menu-row', {
    type: 'button',
    onclick: () => { haptic('select'); onClick(); },
  },
    h('span.menu-ic', icon(ic, 22)),
    h('div.grow', h('div.t', title), sub ? h('div.s', sub) : null),
    icon('chevron', 18));
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

export function openAdmin(onClose) {
  const liveBox = h('div.card.live'), kpis = h('div.kpis'), bars = h('div.spark'), liveHead = h('div.livehead');
  const usersBox = h('div.list'), histBox = h('div.list');

  async function loadLive() {
    try {
      const [live, st] = await Promise.all([api('GET', '/admin/live'), api('GET', '/admin/stats')]);
      liveHead.replaceChildren(h('i.dot.on'), h('b', String(live.count)), h('span.muted', ' ' + t('live_users')));
      liveBox.replaceChildren(liveHead, live.users.length ? h('div.livelist', live.users.map((u) => h('div.chipuser', avatar(u.name, u.id, 'sm'), h('span', u.name), u.inGame ? h('em', '♟') : null))) : h('div.muted', t('nobody_live')));
      const k = (label, v) => h('div.kpi', h('small.muted', label), h('b', String(v)));
      kpis.replaceChildren(k(t('k_users'), st.users), k(t('k_new'), st.newToday), k(t('k_active'), st.active7d), k(t('k_games_live'), st.gamesLive), k(t('k_games_played'), st.gamesPlayed), k(t('k_unreachable'), st.unreachable));
      const max = Math.max(1, ...st.signups.map((d) => d.count));
      bars.replaceChildren(...st.signups.map((d, i) => h('i' + (i === st.signups.length - 1 ? '.on' : ''), { title: `${d.date}: ${d.count}`, style: { height: `${Math.max(6, (d.count / max) * 100)}%` } })));
    } catch (e) { if (e.code !== 'net') fail(e); }
  }

  async function loadUsers(q = '') {
    try {
      const r = await api('GET', '/admin/users?q=' + encodeURIComponent(q));
      usersBox.replaceChildren(...r.users.map((u) => h('div.row' + (u.blocked ? '.off' : ''),
        h('div.avwrap', avatar(u.first_name, u.id), u.online ? h('i.dot.on') : null),
        h('div.grow',
          h('div.t', u.first_name || 'Player', u.isAdmin ? h('span.pill', ' ' + t('admin_tag')) : null),
          h('div.s', `${u.username ? '@' + u.username + ' · ' : ''}${u.id} · 💎${u.diamonds || 0}${u.premium ? ' · Premium' : ''} · ♟${u.games}`)),
        h('button.mini', {
          title: t('admin_grant_diamonds'),
          onclick: async () => {
            const raw = window.prompt(t('admin_grant_prompt', { name: u.first_name || u.id }), '100');
            if (raw == null || raw === '') return;
            const amount = Math.floor(Number(raw));
            if (!Number.isFinite(amount) || amount === 0) return toast(t('e_bad_request'), true);
            try {
              await api('POST', `/admin/users/${u.id}/diamonds`, { amount });
              toast(t('admin_grant_ok', { n: amount }));
              haptic('success');
              loadUsers(q);
            } catch (e) { fail(e); }
          },
        }, '💎'),
        u.isAdmin ? null : h('button.mini' + (u.blocked ? '.ok' : ''), {
          type: 'button',
          onclick: async () => {
            try { await api('POST', `/admin/users/${u.id}/block`, { blocked: !u.blocked }); loadUsers(q); } catch (e) { fail(e); }
          },
        }, u.blocked ? t('unblock') : t('block')),
        u.isAdmin ? null : h('button.mini.danger', {
          type: 'button',
          title: t('admin_delete_user'),
          onclick: async () => {
            const name = u.first_name || String(u.id);
            if (!(await confirmSheet(t('admin_delete_confirm', { name }), t('admin_delete_user'), true))) return;
            try {
              await api('DELETE', `/admin/users/${u.id}`);
              toast(t('admin_user_deleted'));
              haptic('success');
              loadUsers(q);
            } catch (e) { fail(e); }
          },
        }, icon('trash', 16)))));
    } catch (e) { fail(e); }
  }

  async function loadHistory() {
    try {
      const r = await api('GET', '/admin/broadcasts');
      histBox.replaceChildren(...r.broadcasts.map((b) => h('div.row', h('div.grow', h('div.t', (b.text || '📎').slice(0, 60)), h('div.s', `#${b.id} · ${b.lang} · ${b.sent}/${b.total}${b.failed ? ` · ✗${b.failed}` : ''} · ${t('status_' + b.status)}`)))));
      return r.busy;
    } catch { return false; }
  }

  // ----- composer -----
  const post = { text: '', media: null, buttons: [], lang: 'all' };
  const text = h('textarea.input', { rows: 5, placeholder: t('post_text'), maxlength: 4096, oninput: (e) => { post.text = e.target.value; drawPreview(); } });
  const mediaBox = h('div.media-box'), btnBox = h('div.btn-editor'), preview = h('div.tg-preview');
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,video/mp4', hidden: true, onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); } });

  async function upload(f) {
    toast(t('uploading'));
    try {
      const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' }, body: f });
      const d = await res.json();
      if (!res.ok) throw Object.assign(new Error(d.error), { code: d.code });
      post.media = { id: d.id, kind: d.kind, url: URL.createObjectURL(f), isVideo: f.type.startsWith('video') };
      drawMedia(); drawPreview(); haptic('success');
    } catch (e) { fail(e); }
  }
  function drawMedia() {
    mediaBox.replaceChildren();
    if (post.media) {
      const m = post.media.isVideo ? h('video', { src: post.media.url, muted: true, playsinline: true, loop: true, autoplay: true }) : h('img', { src: post.media.url, alt: '' });
      mediaBox.append(m, h('button.mini', { onclick: () => { post.media = null; drawMedia(); drawPreview(); } }, icon('x', 16), t('remove')));
    } else mediaBox.append(h('button.btn.ghost.sm', { onclick: () => file.click() }, icon('image', 18), t('add_media')));
  }
  function drawButtons() {
    btnBox.replaceChildren(...post.buttons.map((b, i) => h('div.beditor',
      h('input.input', { value: b.text, placeholder: t('btn_text'), maxlength: 64, oninput: (e) => { b.text = e.target.value; drawPreview(); } }),
      seg(
        [['app', t('btn_app')], ['invite', t('btn_invite')], ['url', t('btn_url')]],
        b.type,
        (v) => { b.type = v; drawButtons(); drawPreview(); },
      ),
      b.type === 'url'
        ? h('input.input', { value: b.url, placeholder: t('btn_link'), inputmode: 'url', oninput: (e) => { b.url = e.target.value; } })
        : b.type === 'invite'
          ? h('p.muted', t('btn_invite_hint'))
          : null,
      h('div.swatches', COLOR_KEYS.map((c) => h('button.sw' + (b.color === c ? '.on' : ''), { 'aria-label': t('c_' + (c === 'default' ? 'default' : c)), style: { background: swatch[c] }, onclick: () => { b.color = c; drawButtons(); drawPreview(); } }))),
      h('button.mini', { onclick: () => { post.buttons.splice(i, 1); drawButtons(); drawPreview(); } }, icon('trash', 16), t('remove')))));
    if (post.buttons.length < 6) btnBox.append(h('button.btn.ghost.sm', { onclick: () => { post.buttons.push({ text: '', type: 'app', url: '', color: 'primary' }); drawButtons(); drawPreview(); } }, icon('plus', 18), t('add_button')));
  }
  function drawPreview() {
    preview.replaceChildren(...[
      post.media ? (post.media.isVideo ? h('video', { src: post.media.url, muted: true, playsinline: true }) : h('img', { src: post.media.url, alt: '' })) : null,
      post.text ? h('p', post.text) : null,
      ...post.buttons.map((b) => h('div.pb.c-' + b.color, b.text || '…'))].filter(Boolean));
    preview.hidden = !post.text && !post.media;
  }
  const payload = (test) => ({
    text: post.text,
    mediaId: post.media ? post.media.id : undefined,
    lang: post.lang,
    test,
    buttons: post.buttons.map((b) => ({
      text: b.text,
      type: b.type,
      color: b.color,
      url: b.type === 'url' ? b.url : undefined,
    })),
  });
  const sendTest = h('button.btn.ghost', { onclick: async () => { try { await api('POST', '/admin/broadcast', payload(true)); toast(t('test_sent')); } catch (e) { fail(e); } } }, icon('send', 18), t('send_test'));
  const sendAll = h('button.btn', { onclick: async () => {
    try {
      const st = await api('GET', '/admin/stats');
      const n = post.lang === 'all' ? st.users : (st.byLang.find((x) => x.lang === post.lang) || { c: 0 }).c;
      if (!(await confirmSheet(t('confirm_send', { n }), t('send_all')))) return;
      const r = await api('POST', '/admin/broadcast', payload(false));
      toast(t('sending', { n: r.queued })); haptic('success');
      setTimeout(loadHistory, 2500);
    } catch (e) { fail(e); }
  } }, icon('send', 18), t('send_all'));
  const audience = seg([['all', t('all_users')], ...LANGS.map((l) => [l, LANG_NAMES[l].slice(0, 3)])], 'all', (v) => { post.lang = v; });
  const search = h('input.input.search', { placeholder: t('search'), oninput: (e) => { clearTimeout(search._t); search._t = setTimeout(() => loadUsers(e.target.value), 250); } });

  // Admin appearance
  let styleUser = { pieceSet: 'neo', boardTheme: 'green' };
  const styleHost = h('div');
  const applyLocal = (pieceSet, boardTheme) => {
    document.documentElement.dataset.pieces = pieceSet;
    document.documentElement.dataset.board = boardTheme;
    restyleBoards();
    try { restyleOpenGame(); } catch { /* ignore */ }
  };
  const drawStyle = () => {
    const pickPiece = async (id) => {
      try {
        styleUser = (await api('PATCH', '/me', { pieceSet: id })).user;
        applyLocal(styleUser.pieceSet, styleUser.boardTheme);
        drawStyle(); haptic('select'); toast(t('piece_' + id));
      } catch (e) { fail(e); }
    };
    const pickBoard = async (id) => {
      try {
        styleUser = (await api('PATCH', '/me', { boardTheme: id })).user;
        applyLocal(styleUser.pieceSet, styleUser.boardTheme);
        drawStyle(); haptic('select'); toast(t('board_' + id));
      } catch (e) { fail(e); }
    };
    styleHost.replaceChildren(stylePickerCard({
      pieceSet: styleUser.pieceSet,
      boardTheme: styleUser.boardTheme,
      locked: false,
      onPiece: pickPiece,
      onBoard: pickBoard,
    }), h('p.muted', t('admin_style_sub')));
  };
  api('GET', '/me').then((r) => {
    styleUser = r.user;
    applyLocal(styleUser.pieceSet || 'neo', styleUser.boardTheme || 'green');
    drawStyle();
  }).catch(() => drawStyle());

  // ----- home announcements -----
  const annList = h('div.list');
  let annBoard = 'home';
  let editingAnnId = null;
  const annForm = {
    title: '', body: '', titleColor: '#ffffff', bodyColor: '#fbbf24',
    bgFrom: '#3b82f6', bgTo: '#6366f1', fontFamily: 'system', fontSize: 18,
    mediaId: null, mediaPreview: null, linkType: 'none', linkUrl: '', linkPage: 'play',
    endsAtTashkent: '',
  };
  const annMediaBox = h('div.media-box');
  const annFile = h('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/gif', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      toast(t('uploading'));
      try {
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' },
          body: f,
        });
        const d = await res.json();
        if (!res.ok) throw Object.assign(new Error(d.error), { code: d.code });
        annForm.mediaId = d.id;
        annForm.mediaPreview = URL.createObjectURL(f);
        drawAnnMedia(); haptic('success');
      } catch (err) { fail(err); }
    },
  });
  function drawAnnMedia() {
    annMediaBox.replaceChildren();
    if (annForm.mediaPreview) {
      annMediaBox.append(
        h('img', { src: annForm.mediaPreview, alt: '' }),
        h('button.mini', { onclick: () => { annForm.mediaId = null; annForm.mediaPreview = null; drawAnnMedia(); } }, icon('x', 16), t('remove')),
      );
    } else annMediaBox.append(h('button.btn.ghost.sm', { onclick: () => annFile.click() }, icon('image', 18), t('add_media')));
  }
  drawAnnMedia();

  const titleIn = h('input.input', { placeholder: t('ann_title'), maxlength: 80, oninput: (e) => { annForm.title = e.target.value; } });
  const bodyIn = h('input.input', { placeholder: t('ann_body'), maxlength: 160, oninput: (e) => { annForm.body = e.target.value; } });
  const endsIn = h('input.input', { type: 'datetime-local', oninput: (e) => { annForm.endsAtTashkent = e.target.value; } });
  const colorInputs = {};
  const colorRow = (label, key, def) => {
    const inp = h('input', {
      type: 'color', value: def,
      oninput: (e) => { annForm[key] = e.target.value; },
    });
    colorInputs[key] = inp;
    return h('div.ann-color', h('span', label), inp);
  };
  const fontSeg = seg([['system', 'Aa'], ['rounded', 'Rd'], ['serif', 'Se'], ['mono', 'Mo']], 'system', (v) => { annForm.fontFamily = v; });
  const linkSeg = seg([
    ['none', t('ann_link_none')],
    ['invite', t('ann_link_invite')],
    ['url', t('ann_link_url')],
    ['page', t('ann_link_page')],
  ], 'none', (v) => {
    annForm.linkType = v; drawAnnLink();
  });
  const linkExtra = h('div');
  function drawAnnLink() {
    linkExtra.replaceChildren();
    if (annForm.linkType === 'invite') {
      linkExtra.append(h('p.muted', t('ann_link_invite_hint')));
    } else if (annForm.linkType === 'url') {
      linkExtra.append(h('input.input', {
        placeholder: 'https://…', inputmode: 'url', value: annForm.linkUrl,
        oninput: (e) => { annForm.linkUrl = e.target.value; },
      }));
    } else if (annForm.linkType === 'page') {
      const pages = ['play', 'puzzles', 'rankings', 'live', 'profile', 'premium', 'friends', 'settings', 'diamonds'];
      linkExtra.append(h('div.chips', pages.map((p) => h('button.chip' + (annForm.linkPage === p ? '.on' : ''), {
        type: 'button',
        onclick: () => { annForm.linkPage = p; drawAnnLink(); },
      }, p))));
    }
  }
  drawAnnLink();

  function syncAnnFormInputs() {
    titleIn.value = annForm.title || '';
    bodyIn.value = annForm.body || '';
    endsIn.value = annForm.endsAtTashkent || '';
    for (const [k, inp] of Object.entries(colorInputs)) {
      if (annForm[k]) inp.value = annForm[k];
    }
    if (fontSeg && fontSeg.set) fontSeg.set(annForm.fontFamily || 'system');
    if (linkSeg && linkSeg.set) linkSeg.set(annForm.linkType || 'none');
    drawAnnLink();
    drawAnnMedia();
    syncAnnSaveBtn();
  }

  function resetAnnForm(keepEnds) {
    const ends = keepEnds ? annForm.endsAtTashkent : '';
    editingAnnId = null;
    Object.assign(annForm, {
      title: '', body: '', titleColor: '#ffffff', bodyColor: '#fbbf24',
      bgFrom: '#3b82f6', bgTo: '#6366f1', fontFamily: 'system', fontSize: 18,
      mediaId: null, mediaPreview: null, linkType: 'none', linkUrl: '', linkPage: 'play',
      endsAtTashkent: ends,
    });
    syncAnnFormInputs();
  }

  function beginEditAnn(a) {
    editingAnnId = a.id;
    Object.assign(annForm, {
      title: a.title || '',
      body: a.body || '',
      titleColor: a.titleColor || '#ffffff',
      bodyColor: a.bodyColor || '#fbbf24',
      bgFrom: a.bgFrom || '#3b82f6',
      bgTo: a.bgTo || '#6366f1',
      fontFamily: a.fontFamily || 'system',
      fontSize: a.fontSize || 18,
      mediaId: a.mediaId || null,
      mediaPreview: a.mediaUrl || null,
      linkType: a.linkType || 'none',
      linkUrl: a.linkUrl || '',
      linkPage: a.linkPage || 'play',
      endsAtTashkent: (a.endsAtTashkent || '').slice(0, 16),
    });
    syncAnnFormInputs();
    try { titleIn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
  }

  const saveAnn = h('button.btn', { type: 'button' }, icon('plus', 18), t('ann_publish'));
  const cancelEditAnn = h('button.btn.ghost', {
    type: 'button',
    hidden: true,
    onclick: () => resetAnnForm(true),
  }, t('cancel'));
  function syncAnnSaveBtn() {
    saveAnn.replaceChildren(
      icon(editingAnnId ? 'check' : 'plus', 18),
      editingAnnId ? t('ann_save_edit') : t('ann_publish'),
    );
    cancelEditAnn.hidden = !editingAnnId;
  }
  syncAnnSaveBtn();
  saveAnn.onclick = async () => {
    const payload = {
      board: annBoard,
      title: annForm.title,
      body: annForm.body,
      titleColor: annForm.titleColor,
      bodyColor: annForm.bodyColor,
      bgFrom: annForm.bgFrom,
      bgTo: annForm.bgTo,
      fontFamily: annForm.fontFamily,
      fontSize: annForm.fontSize,
      mediaId: annForm.mediaId || null,
      linkType: annForm.linkType,
      linkUrl: annForm.linkUrl,
      linkPage: annForm.linkPage,
      endsAtTashkent: annForm.endsAtTashkent,
    };
    try {
      if (editingAnnId) {
        await api('PATCH', `/admin/announcements/${editingAnnId}`, payload);
        toast(t('ann_updated'));
      } else {
        await api('POST', '/admin/announcements', payload);
        toast(t('ann_saved'));
      }
      haptic('success');
      resetAnnForm(true);
      loadAnnouncements();
    } catch (e) { fail(e); }
  };

  async function loadAnnouncements() {
    try {
      const r = await api('GET', '/admin/announcements?board=' + encodeURIComponent(annBoard));
      if (!annForm.endsAtTashkent && r.nowTashkent) {
        const base = r.nowTashkent.slice(0, 10);
        const d = new Date(base + 'T12:00:00+05:00');
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        annForm.endsAtTashkent = `${y}-${m}-${day}T23:59`;
        endsIn.value = annForm.endsAtTashkent;
      }
      const active = (r.announcements || []).filter((a) => {
        const end = a.endsAt ? new Date(a.endsAt).getTime() : 0;
        return !end || end > Date.now();
      });
      annList.replaceChildren(...active.map((a) => h('div.row',
        h('div.grow',
          h('div.t', a.title || a.body || '—'),
          h('div.s', `${t('ann_until')}: ${(a.endsAtTashkent || '').replace('T', ' ')} (Tashkent)`)),
        h('button.mini', {
          type: 'button',
          title: t('ann_edit'),
          onclick: () => { haptic('select'); beginEditAnn(a); },
        }, icon('pencil', 16)),
        h('button.mini', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmSheet(t('ann_delete_confirm'), t('remove'), true))) return;
            try {
              await api('DELETE', `/admin/announcements/${a.id}`);
              if (editingAnnId === a.id) resetAnnForm(true);
              loadAnnouncements();
              toast(t('ann_deleted'));
            } catch (e) { fail(e); }
          },
        }, icon('trash', 16)))));
      if (!active.length) annList.append(h('div.muted', t('ann_empty')));
    } catch (e) { fail(e); }
  }

  const boardSeg = seg(
    [['home', t('ann_board_home')], ['puzzle', t('ann_board_puzzle')]],
    'home',
    (v) => { annBoard = v; if (editingAnnId) resetAnnForm(true); loadAnnouncements(); },
  );

  const annCard = h('div.card',
    h('p.muted', t('ann_sub')),
    h('div.label', t('ann_board')), boardSeg,
    h('div.label', t('ann_title')), titleIn,
    h('div.label', t('ann_body')), bodyIn,
    h('div.label', t('ann_font')), fontSeg,
    h('div.label', t('ann_colors')),
    h('div.ann-colors',
      colorRow(t('ann_title_color'), 'titleColor', '#ffffff'),
      colorRow(t('ann_body_color'), 'bodyColor', '#fbbf24'),
      colorRow(t('ann_bg_from'), 'bgFrom', '#3b82f6'),
      colorRow(t('ann_bg_to'), 'bgTo', '#6366f1')),
    h('div.label', t('ann_media')), annMediaBox, annFile,
    h('div.label', t('ann_link')), linkSeg, linkExtra,
    h('div.label', t('ann_ends') + ' · Tashkent (UTC+5)'), endsIn,
    h('div.ann-actions', saveAnn, cancelEditAnn));

  // ----- shop settings -----
  let shop = {
    premiumPriceDiamonds: 200,
    premiumPlans: [
      { months: 1, diamonds: 200 },
      { months: 3, diamonds: 500 },
      { months: 6, diamonds: 900 },
      { months: 12, diamonds: 1600 },
    ],
    diamondPacks: [],
    payUsername: 'hasanovbobur',
    puzzleDailyReward: 1,
    referralReward: 20,
    referralInviteeReward: 10,
  };
  const shopHost = h('div');

  function drawShop() {
    if (!shop.premiumPlans || !shop.premiumPlans.length) {
      shop.premiumPlans = [
        { months: 1, diamonds: shop.premiumPriceDiamonds || 200 },
        { months: 3, diamonds: 500 },
        { months: 6, diamonds: 900 },
        { months: 12, diamonds: 1600 },
      ];
    }
    if (shop.puzzleDailyReward == null) shop.puzzleDailyReward = 1;
    if (shop.referralReward == null) shop.referralReward = 20;
    if (shop.referralInviteeReward == null) shop.referralInviteeReward = 10;
    const payIn = h('input.input', {
      value: shop.payUsername, maxlength: 64,
      oninput: (e) => { shop.payUsername = e.target.value.replace(/^@/, ''); },
    });
    const puzzleRewardIn = h('input.input', {
      type: 'number', value: String(shop.puzzleDailyReward ?? 1), min: '0', max: '1000000',
      style: { maxWidth: '120px' },
      oninput: (e) => { shop.puzzleDailyReward = Math.floor(Number(e.target.value) || 0); },
    });
    const referralIn = h('input.input', {
      type: 'number', value: String(shop.referralReward ?? 20), min: '0', max: '1000000',
      style: { maxWidth: '120px' },
      oninput: (e) => { shop.referralReward = Math.floor(Number(e.target.value) || 0); },
    });
    const inviteeIn = h('input.input', {
      type: 'number', value: String(shop.referralInviteeReward ?? 10), min: '0', max: '1000000',
      style: { maxWidth: '120px' },
      oninput: (e) => { shop.referralInviteeReward = Math.floor(Number(e.target.value) || 0); },
    });
    const plansBox = h('div.list');
    const redrawPlans = () => {
      plansBox.replaceChildren(...(shop.premiumPlans || []).map((p) => h('div.row',
        h('span.muted', p.months === 12 ? t('premium_plan_year') : t('premium_plan_months', { n: p.months })),
        h('input.input', {
          type: 'number', value: String(p.diamonds), style: { maxWidth: '110px' },
          oninput: (e) => { p.diamonds = Math.floor(Number(e.target.value) || 0); },
        }),
        h('span.muted', '💎'),
      )));
    };
    redrawPlans();
    const packsBox = h('div.list');
    const movePack = (i, dir) => {
      const packs = shop.diamondPacks || [];
      const j = i + dir;
      if (j < 0 || j >= packs.length) return;
      const tmp = packs[i];
      packs[i] = packs[j];
      packs[j] = tmp;
      haptic('select');
      redrawPacks();
    };
    const redrawPacks = () => {
      const packs = shop.diamondPacks || [];
      packsBox.replaceChildren(...packs.map((p, i) => h('div.row.admin-pack-row',
        h('div.admin-pack-order',
          h('button.mini', {
            type: 'button',
            disabled: i === 0,
            title: t('admin_pack_up'),
            onclick: () => movePack(i, -1),
          }, icon('chevronUp', 16)),
          h('button.mini', {
            type: 'button',
            disabled: i === packs.length - 1,
            title: t('admin_pack_down'),
            onclick: () => movePack(i, 1),
          }, icon('chevronDown', 16))),
        h('input.input', {
          type: 'number', value: String(p.diamonds), style: { maxWidth: '90px' },
          oninput: (e) => { p.diamonds = Math.floor(Number(e.target.value) || 0); },
        }),
        h('span.muted', '💎 →'),
        h('input.input', {
          type: 'number', value: String(p.sum), style: { flex: '1' },
          oninput: (e) => { p.sum = Math.floor(Number(e.target.value) || 0); },
        }),
        h('span.muted', "so'm"),
        h('button.mini', {
          type: 'button',
          onclick: () => { shop.diamondPacks.splice(i, 1); redrawPacks(); },
        }, icon('trash', 16)),
      )));
    };
    redrawPacks();
    shopHost.replaceChildren(
      h('div.card',
        h('p.muted', t('admin_shop_sub')),
        h('div.label', t('admin_premium_plans')), plansBox,
        h('div.label', t('admin_pay_user')), payIn,
        h('div.label', t('admin_puzzle_reward')),
        h('div.row', puzzleRewardIn, h('span.muted', '💎')),
        h('p.muted', t('admin_puzzle_reward_sub')),
        h('div.label', t('admin_referral_rewards')),
        h('div.row', h('span.muted', t('admin_referral_inviter')), referralIn, h('span.muted', '💎')),
        h('div.row', h('span.muted', t('admin_referral_invitee')), inviteeIn, h('span.muted', '💎')),
        h('p.muted', t('admin_referral_sub')),
        h('div.label', t('shop_packs')), packsBox,
        h('button.btn.ghost.sm', {
          onclick: () => {
            if (!Array.isArray(shop.diamondPacks)) shop.diamondPacks = [];
            shop.diamondPacks.push({ diamonds: 100, sum: 100000 });
            redrawPacks();
          },
        }, icon('plus', 16), t('admin_add_pack')),
        h('button.btn', {
          onclick: async () => {
            try {
              const packs = (shop.diamondPacks || []).map((p) => ({
                diamonds: Math.floor(Number(p.diamonds) || 0),
                sum: Math.floor(Number(p.sum) || 0),
              }));
              if (!packs.length) { toast(t('admin_pack_need'), true); return; }
              for (const p of packs) {
                if (!(p.diamonds >= 1 && p.diamonds <= 1000000)) { toast(t('admin_pack_diamonds'), true); return; }
                if (!(p.sum >= 1000 && p.sum <= 1000000000)) { toast(t('admin_pack_sum'), true); return; }
              }
              const puzzleDailyReward = Math.floor(Number(shop.puzzleDailyReward) || 0);
              if (!(puzzleDailyReward >= 0 && puzzleDailyReward <= 1000000)) {
                toast(t('admin_puzzle_reward_bad'), true); return;
              }
              const referralReward = Math.floor(Number(shop.referralReward) || 0);
              const referralInviteeReward = Math.floor(Number(shop.referralInviteeReward) || 0);
              if (!(referralReward >= 0 && referralReward <= 1000000)
                || !(referralInviteeReward >= 0 && referralInviteeReward <= 1000000)) {
                toast(t('admin_referral_bad'), true); return;
              }
              shop.diamondPacks = packs;
              shop.puzzleDailyReward = puzzleDailyReward;
              shop.referralReward = referralReward;
              shop.referralInviteeReward = referralInviteeReward;
              const r = await api('PATCH', '/admin/shop', {
                premiumPlans: shop.premiumPlans,
                diamondPacks: packs,
                payUsername: shop.payUsername,
                puzzleDailyReward,
                referralReward,
                referralInviteeReward,
              });
              shop = r.shop;
              toast(t('admin_shop_saved')); haptic('success');
              drawShop();
            } catch (e) { fail(e); }
          },
        }, icon('check', 18), t('save'))),
    );
  }

  async function loadShop() {
    try {
      const r = await api('GET', '/admin/shop');
      shop = r.shop;
      drawShop();
    } catch (e) { fail(e); drawShop(); }
  }

  // ----- medal generator -----
  let medalState = { config: {}, month: '', top: [], medals: [], previewUrl: '' };
  const medalHost = h('div');

  function drawMedals() {
    const cfg = medalState.config || {};
    const fonts = medalState.fonts || ['display', 'serif', 'sans', 'mono', 'rounded'];
    const pieces = medalState.pieces || ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
    const color = (key, label) => h('div.ann-color',
      h('span', label),
      h('input', {
        type: 'color', value: cfg[key] || '#ffffff',
        oninput: (e) => { cfg[key] = e.target.value; },
      }));
    const sizeIn = (key, label, min, max) => h('div.medal-size-row',
      h('span', label),
      h('input.input', {
        type: 'number', min: String(min), max: String(max), step: '1',
        value: String(cfg[key] ?? ''),
        style: { maxWidth: '88px' },
        oninput: (e) => { cfg[key] = Math.floor(Number(e.target.value) || 0); },
      }));
    const fontSeg = (key, label) => h('div',
      h('div.label', label),
      seg(fonts.map((f) => [f, f]), cfg[key] || fonts[0], (v) => { cfg[key] = v; }));
    const pieceSeg = (key, label) => h('div',
      h('div.label', label),
      seg(pieces.map((p) => [p, p]), cfg[key] || pieces[0], (v) => { cfg[key] = v; }));
    const botIn = h('input.input', {
      value: cfg.botHandle || '@Chess_uz_bot', maxlength: 64,
      oninput: (e) => { cfg.botHandle = e.target.value; },
    });
    const tplIn = h('input.input', {
      value: cfg.titleTemplate || 'Top {place} Chess player of {month}', maxlength: 120,
      oninput: (e) => { cfg.titleTemplate = e.target.value; },
    });
    const curMonth = medalState.previewMonth || medalState.month || '';
    const year = medalState.previewYear || medalState.year || Number(String(curMonth).slice(0, 4)) || new Date().getFullYear();
    const months = medalState.months || [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const placeSeg = seg([['1', '#1'], ['2', '#2'], ['3', '#3']], String(medalState.previewPlace || 1), (v) => {
      medalState.previewPlace = Number(v);
    });
    const yearRow = h('div.medal-year-row',
      h('button.mini', {
        type: 'button',
        onclick: () => { medalState.previewYear = year - 1; loadMedalsForYear(year - 1); },
      }, '‹'),
      h('b', String(year)),
      h('button.mini', {
        type: 'button',
        onclick: () => { medalState.previewYear = year + 1; loadMedalsForYear(year + 1); },
      }, '›'));
    const monthChips = h('div.chips.medal-months',
      (months.length ? months : Array.from({ length: 12 }, (_, i) => ({
        key: `${year}-${String(i + 1).padStart(2, '0')}`,
        short: String(i + 1).padStart(2, '0'),
      }))).map((m, i) => h('button.chip' + (curMonth === m.key ? '.on' : ''), {
        type: 'button',
        onclick: () => {
          medalState.previewMonth = m.key;
          haptic('select');
          loadMedals(m.key);
        },
      }, monthNames[i] || m.short)));
    const preview = h('div');
    if (medalState.previewUrl) {
      preview.append(h('img.medal-admin-preview', { src: medalState.previewUrl, alt: 'preview' }));
    }
    const list = (medalState.medals || []).length
      ? h('div.list', medalState.medals.map((m) => h('div.row',
        h('img', { src: m.url, alt: '', style: { width: '40px', height: '48px', borderRadius: '8px', objectFit: 'cover' } }),
        h('div.grow', h('div.t', m.title), h('div.s', `${m.month} · #${m.place} · ${m.name || m.userId}`)))))
      : h('div.muted', '—');
    medalHost.replaceChildren(
      h('div.card',
        h('p.muted', t('admin_medals_sub')),
        h('div.label', t('admin_medals_bot')), botIn,
        h('div.label', t('admin_medals_title_tpl')), tplIn,
        h('p.muted', t('admin_medals_tpl_hint')),
        h('div.label', t('ann_colors')),
        h('div.ann-colors',
          color('primary', 'Primary'), color('secondary', 'Secondary'),
          color('accent', 'Accent'), color('text', 'Text'), color('muted', 'Muted')),
        h('div.label', t('admin_medals_pieces')),
        pieceSeg('pieceTop1', t('admin_medals_piece_1')),
        pieceSeg('pieceTop2', t('admin_medals_piece_2')),
        pieceSeg('pieceTop3', t('admin_medals_piece_3')),
        fontSeg('fontTitle', t('admin_medals_font_title')),
        fontSeg('fontFamily', t('admin_medals_font_body')),
        h('div.label', t('admin_medals_sizes')),
        h('div.medal-sizes',
          sizeIn('sizePlace', t('admin_medals_sz_place'), 12, 40),
          sizeIn('sizeName', t('admin_medals_sz_name'), 14, 40),
          sizeIn('sizeTitle', t('admin_medals_sz_title'), 12, 28),
          sizeIn('sizeBot', t('admin_medals_sz_bot'), 10, 24)),
        h('p.muted', t('admin_medals_pattern_hint')),
        h('div.label', t('admin_medals_pick_month')), yearRow, monthChips,
        h('div.label', t('admin_medals_preview_place')), placeSeg,
        h('button.btn.ghost.sm', {
          onclick: async () => {
            try {
              const month = medalState.previewMonth || medalState.month;
              const r = await api('POST', '/admin/medals/preview', {
                config: cfg,
                place: medalState.previewPlace || 1,
                month,
                name: (medalState.top[0] && medalState.top[0].name) || 'Player',
                username: (medalState.top[0] && medalState.top[0].username) || '',
                userId: (medalState.top[0] && medalState.top[0].id) || 0,
              });
              medalState.previewUrl = r.dataUrl;
              drawMedals();
            } catch (e) { fail(e); }
          },
        }, t('admin_medals_preview')),
        preview,
        h('button.btn', {
          onclick: async () => {
            try {
              const r = await api('PATCH', '/admin/medals/config', cfg);
              medalState.config = r.config;
              toast(t('admin_medals_saved')); haptic('success');
              drawMedals();
            } catch (e) { fail(e); }
          },
        }, icon('check', 18), t('save')),
        h('p.muted', t('admin_medals_auto_hint')),
        curMonth
          ? h('button.btn.ghost.sm', {
            type: 'button',
            onclick: async () => {
              try {
                await api('DELETE', `/admin/medals/${encodeURIComponent(curMonth)}`);
                toast(t('admin_medals_cleared')); haptic('success');
                loadMedals(curMonth);
              } catch (e) { fail(e); }
            },
          }, t('admin_medals_clear_month'))
          : null),
      h('div.h2', t('admin_medals')), list,
    );
  }

  async function loadMedals(month) {
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : '';
      const r = await api('GET', '/admin/medals' + q);
      medalState = {
        ...medalState,
        ...r,
        previewMonth: month || r.month || medalState.previewMonth,
        previewYear: r.year || medalState.previewYear,
        previewUrl: medalState.previewUrl || '',
      };
      drawMedals();
    } catch (e) { fail(e); drawMedals(); }
  }

  async function loadMedalsForYear(y) {
    const m = `${y}-01`;
    medalState.previewYear = y;
    medalState.previewMonth = m;
    await loadMedals(m);
  }

  // ----- section screens -----
  const openLive = () => openScreen((close) => {
    loadLive();
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadLive(); }, 5000);
    return [
      ...subTop(t('admin_sec_live'), close),
      liveBox,
      h('div.h2', t('stats')), kpis,
      h('div.h2', t('signups')), h('div.card', bars),
    ];
  }, { onClose: () => { clearInterval(timer); timer = null; } });

  const openAnnouncements = () => openScreen((close) => {
    loadAnnouncements();
    return [
      ...subTop(t('ann_title_section'), close),
      annCard,
      h('div.h2', t('ann_list')), annList,
    ];
  });

  const openUsers = () => openScreen((close) => {
    loadUsers();
    return [
      ...subTop(t('users_list'), close),
      h('p.muted', t('admin_users_sub')),
      search, usersBox,
    ];
  });

  const openShop = () => openScreen((close) => {
    loadShop();
    return [
      ...subTop(t('admin_sec_shop'), close),
      shopHost,
    ];
  });

  const openBroadcast = () => openScreen((close) => {
    drawMedia(); drawButtons(); drawPreview(); loadHistory();
    return [
      ...subTop(t('composer'), close),
      h('div.card', text, mediaBox, file, h('div.label', t('buttons') + ' · ' + t('up_to')), btnBox, h('div.label', t('audience')), audience, h('div.label', t('preview')), preview, sendTest, sendAll),
      h('div.h2', t('history')), histBox,
    ];
  });

  const msgStatsHost = h('div');
  const loadMessageStats = async () => {
    try {
      const r = await api('GET', '/admin/message-stats');
      const tg = r.telegram || {};
      const app = r.inApp || {};
      const kpi = (label, value) => h('div.kpi', h('small.muted', label), h('b', String(value ?? 0)));
      msgStatsHost.replaceChildren(
        h('div.h2', t('msg_stats_tg')),
        h('p.muted', t('msg_stats_tg_sub')),
        h('div.kpis',
          kpi(t('msg_stats_campaigns'), tg.campaigns),
          kpi(t('msg_stats_sent'), tg.sent),
          kpi(t('msg_stats_failed'), tg.failed),
          kpi(t('msg_stats_targeted'), tg.targeted),
        ),
        h('div.card',
          h('div.t', t('msg_stats_7d')),
          h('div.s', t('msg_stats_period', {
            c: tg.last7d?.campaigns || 0,
            s: tg.last7d?.sent || 0,
            f: tg.last7d?.failed || 0,
          })),
          h('div.t', { style: { marginTop: '8px' } }, t('msg_stats_30d')),
          h('div.s', t('msg_stats_period', {
            c: tg.last30d?.campaigns || 0,
            s: tg.last30d?.sent || 0,
            f: tg.last30d?.failed || 0,
          })),
        ),
        h('div.h2', t('msg_stats_tg_recent')),
        (tg.recent || []).length
          ? h('div.list', ...(tg.recent || []).map((b) => h('div.card',
            h('div.t', (b.text || '📎').slice(0, 80)),
            h('div.s', `#${b.id} · ${b.lang} · ${b.sent}/${b.total}${b.failed ? ` · ✗${b.failed}` : ''} · ${t('status_' + b.status)}`),
          )))
          : h('div.empty', t('msg_stats_empty')),
        h('div.h2', t('msg_stats_app')),
        h('p.muted', t('msg_stats_app_sub')),
        h('div.kpis',
          kpi(t('msg_stats_campaigns'), app.campaigns),
          kpi(t('msg_stats_sent'), app.sent),
          kpi(t('msg_stats_read'), app.read),
          kpi(t('msg_stats_unread'), app.unreadActive),
        ),
        h('div.card',
          h('div.t', t('msg_stats_7d')),
          h('div.s', t('msg_stats_app_period', { c: app.last7d?.campaigns || 0, s: app.last7d?.sent || 0 })),
          h('div.t', { style: { marginTop: '8px' } }, t('msg_stats_30d')),
          h('div.s', t('msg_stats_app_period', { c: app.last30d?.campaigns || 0, s: app.last30d?.sent || 0 })),
        ),
        h('div.h2', t('msg_stats_app_recent')),
        (app.recent || []).length
          ? h('div.list', ...(app.recent || []).map((c) => h('div.card',
            h('div.t', c.title),
            h('div.s', (c.body || '').slice(0, 80)),
            h('div.s', t('msg_stats_app_row', {
              n: c.sentCount || 0,
              r: c.readCount || 0,
              ttl: c.permanent ? t('admin_notif_ttl_permanent') : (c.expiresAt ? new Date(c.expiresAt).toLocaleString() : '—'),
            })),
          )))
          : h('div.empty', t('msg_stats_empty')),
      );
    } catch (e) { fail(e); }
  };
  const openMessageStats = () => openScreen((close) => {
    loadMessageStats();
    return [
      ...subTop(t('msg_stats_title'), close),
      msgStatsHost,
    ];
  });

  // ----- welcome message (bot /start after language pick) -----
  const welcomeHost = h('div');
  let welcomeCfg = null;
  let welcomeLang = 'uz';
  const welcomeForm = {
    text: '', mediaId: null, mediaPreview: null, mediaIsVideo: false, buttons: [],
  };
  const welcomeText = h('textarea.input', {
    rows: 8, maxlength: 4096, placeholder: t('welcome_text'),
    oninput: (e) => { welcomeForm.text = e.target.value; drawWelcomePreview(); },
  });
  const welcomeMediaBox = h('div.media-box');
  const welcomeBtnBox = h('div.btn-editor');
  const welcomePreview = h('div.tg-preview');
  const welcomeFile = h('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/gif,video/mp4', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      toast(t('uploading'));
      try {
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' },
          body: f,
        });
        const d = await res.json();
        if (!res.ok) throw Object.assign(new Error(d.error), { code: d.code });
        welcomeForm.mediaId = d.id;
        welcomeForm.mediaPreview = URL.createObjectURL(f);
        welcomeForm.mediaIsVideo = f.type.startsWith('video');
        drawWelcomeMedia(); drawWelcomePreview(); haptic('success');
      } catch (err) { fail(err); }
    },
  });

  function drawWelcomeMedia() {
    welcomeMediaBox.replaceChildren();
    if (welcomeForm.mediaPreview) {
      const m = welcomeForm.mediaIsVideo
        ? h('video', { src: welcomeForm.mediaPreview, muted: true, playsinline: true, loop: true, autoplay: true })
        : h('img', { src: welcomeForm.mediaPreview, alt: '' });
      welcomeMediaBox.append(
        m,
        h('button.mini', {
          onclick: () => {
            welcomeForm.mediaId = null; welcomeForm.mediaPreview = null; welcomeForm.mediaIsVideo = false;
            drawWelcomeMedia(); drawWelcomePreview();
          },
        }, icon('x', 16), t('remove')),
      );
    } else {
      welcomeMediaBox.append(h('button.btn.ghost.sm', { onclick: () => welcomeFile.click() }, icon('image', 18), t('add_media')));
    }
  }

  function drawWelcomeButtons() {
    welcomeBtnBox.replaceChildren(...welcomeForm.buttons.map((b, i) => h('div.beditor',
      h('input.input', {
        value: b.text, placeholder: t('btn_text'), maxlength: 64,
        oninput: (e) => { b.text = e.target.value; drawWelcomePreview(); },
      }),
      seg(
        [['app', t('btn_app')], ['invite', t('btn_invite')], ['url', t('btn_url')]],
        b.type,
        (v) => { b.type = v; drawWelcomeButtons(); drawWelcomePreview(); },
      ),
      b.type === 'url'
        ? h('input.input', {
          value: b.url || '', placeholder: t('btn_link'), inputmode: 'url',
          oninput: (e) => { b.url = e.target.value; },
        })
        : b.type === 'invite'
          ? h('p.muted', t('btn_invite_hint'))
          : null,
      h('div.swatches', COLOR_KEYS.map((c) => h('button.sw' + (b.color === c ? '.on' : ''), {
        'aria-label': t('c_' + (c === 'default' ? 'default' : c)),
        style: { background: swatch[c] },
        onclick: () => { b.color = c; drawWelcomeButtons(); drawWelcomePreview(); },
      }))),
      h('button.mini', {
        onclick: () => { welcomeForm.buttons.splice(i, 1); drawWelcomeButtons(); drawWelcomePreview(); },
      }, icon('trash', 16), t('remove')),
    )));
    if (welcomeForm.buttons.length < 6) {
      welcomeBtnBox.append(h('button.btn.ghost.sm', {
        onclick: () => {
          welcomeForm.buttons.push({ text: '', type: 'app', url: '', color: 'primary' });
          drawWelcomeButtons(); drawWelcomePreview();
        },
      }, icon('plus', 18), t('add_button')));
    }
  }

  function drawWelcomePreview() {
    welcomePreview.replaceChildren(...[
      welcomeForm.mediaPreview
        ? (welcomeForm.mediaIsVideo
          ? h('video', { src: welcomeForm.mediaPreview, muted: true, playsinline: true })
          : h('img', { src: welcomeForm.mediaPreview, alt: '' }))
        : null,
      welcomeForm.text ? h('p', { style: { whiteSpace: 'pre-wrap' } }, welcomeForm.text) : null,
      ...welcomeForm.buttons.map((b) => h('div.pb.c-' + (b.color || 'default'), b.text || '…')),
    ].filter(Boolean));
    welcomePreview.hidden = !welcomeForm.text && !welcomeForm.mediaPreview;
  }

  async function applyWelcomeLang(code) {
    welcomeLang = code;
    const entry = (welcomeCfg && welcomeCfg[code]) || { text: '', mediaId: null, buttons: [] };
    welcomeForm.text = entry.text || '';
    welcomeForm.mediaId = entry.mediaId || null;
    welcomeForm.mediaPreview = null;
    welcomeForm.mediaIsVideo = false;
    welcomeForm.buttons = (entry.buttons || []).map((b) => ({
      text: b.text || '', type: b.type || 'app', url: b.url || '', color: b.color || 'default',
    }));
    welcomeText.value = welcomeForm.text;
    if (entry.mediaId) {
      try {
        const res = await fetch('/api/media/' + entry.mediaId, { headers: { 'X-Init-Data': getInitData() } });
        if (res.ok) {
          welcomeForm.mediaPreview = URL.createObjectURL(await res.blob());
          const ct = res.headers.get('content-type') || '';
          welcomeForm.mediaIsVideo = ct.startsWith('video');
        }
      } catch { /* ignore */ }
    }
    drawWelcomeMedia(); drawWelcomeButtons(); drawWelcomePreview();
  }

  async function loadWelcome() {
    try {
      const r = await api('GET', '/admin/welcome');
      welcomeCfg = r.welcome || {};
      await applyWelcomeLang(welcomeLang);
    } catch (e) { fail(e); }
  }

  function renderWelcomeHost() {
    const langSeg = seg(LANGS.map((l) => [l, LANG_NAMES[l].slice(0, 3)]), welcomeLang, (v) => { applyWelcomeLang(v); });
    const saveBtn = h('button.btn', {
      onclick: async () => {
        try {
          const r = await api('PATCH', '/admin/welcome', {
            lang: welcomeLang,
            text: welcomeForm.text,
            mediaId: welcomeForm.mediaId,
            buttons: welcomeForm.buttons.map((b) => ({
              text: b.text, type: b.type, color: b.color,
              url: b.type === 'url' ? b.url : undefined,
            })),
          });
          if (!welcomeCfg) welcomeCfg = {};
          welcomeCfg[welcomeLang] = r.entry;
          toast(t('welcome_saved')); haptic('success');
        } catch (e) { fail(e); }
      },
    }, icon('check', 18), t('save'));
    const testBtn = h('button.btn.ghost', {
      onclick: async () => {
        try {
          await api('POST', '/admin/welcome/test', { lang: welcomeLang });
          toast(t('test_sent')); haptic('success');
        } catch (e) { fail(e); }
      },
    }, icon('send', 18), t('send_test'));
    welcomeHost.replaceChildren(
      h('p.muted', t('welcome_sub')),
      h('div.label', t('language')), langSeg,
      h('div.label', t('welcome_text')), welcomeText,
      h('div.label', t('ann_media')), welcomeMediaBox, welcomeFile,
      h('div.label', t('buttons')), welcomeBtnBox,
      h('div.label', t('preview')), welcomePreview,
      saveBtn, testBtn,
    );
  }

  const openWelcome = () => openScreen((close) => {
    loadWelcome().then(() => renderWelcomeHost());
    renderWelcomeHost();
    return [
      ...subTop(t('welcome_title'), close),
      welcomeHost,
    ];
  });

  // ----- boot splash (Mini App loading screen) -----
  const bootHost = h('div');
  let bootCfg = null;
  let bootLang = 'uz';
  const bootAnims = ['orbit', 'pulse', 'bars'];
  const bootTitle = h('input.input', {
    maxlength: 80, placeholder: t('boot_title_ph'),
    oninput: (e) => { if (bootCfg && bootCfg[bootLang]) bootCfg[bootLang].title = e.target.value; drawBootPreview(); },
  });
  const bootSub = h('input.input', {
    maxlength: 120, placeholder: t('boot_sub_ph'),
    oninput: (e) => { if (bootCfg && bootCfg[bootLang]) bootCfg[bootLang].subtitle = e.target.value; drawBootPreview(); },
  });
  const bootPreview = h('div.boot-admin-preview');

  function drawBootPreview() {
    if (!bootCfg) return;
    const entry = bootCfg[bootLang] || { title: '', subtitle: '' };
    const anim = bootCfg.animation || 'orbit';
    bootPreview.replaceChildren(
      h('div.boot-admin-stage', { 'data-anim': anim },
        h('div.boot-mark',
          h('div.boot-glow'),
          anim === 'orbit' ? h('div.boot-orbit', h('i'), h('i'), h('i')) : null,
          h('div.boot-ic', '♟')),
        h('p.boot-label', entry.title || '…'),
        entry.subtitle ? h('p.boot-sub', entry.subtitle) : null,
        h('div.boot-bar', h('i'))),
    );
  }

  function applyBootLang(code) {
    bootLang = code;
    const entry = (bootCfg && bootCfg[code]) || { title: '', subtitle: '' };
    bootTitle.value = entry.title || '';
    bootSub.value = entry.subtitle || '';
    drawBootPreview();
  }

  async function loadBootSplash() {
    try {
      const r = await api('GET', '/admin/boot-splash');
      bootCfg = r.splash || {};
      applyBootLang(bootLang);
    } catch (e) { fail(e); }
  }

  function renderBootHost() {
    if (!bootCfg) bootCfg = { animation: 'orbit' };
    const langSeg = seg(LANGS.map((l) => [l, LANG_NAMES[l].slice(0, 3)]), bootLang, (v) => { applyBootLang(v); });
    const animSeg = seg(
      bootAnims.map((a) => [a, t('boot_anim_' + a)]),
      bootCfg.animation || 'orbit',
      (v) => { bootCfg.animation = v; drawBootPreview(); },
    );
    const saveBtn = h('button.btn', {
      onclick: async () => {
        try {
          if (!bootCfg[bootLang]) bootCfg[bootLang] = { title: '', subtitle: '' };
          bootCfg[bootLang].title = bootTitle.value;
          bootCfg[bootLang].subtitle = bootSub.value;
          const r = await api('PATCH', '/admin/boot-splash', {
            lang: bootLang,
            title: bootTitle.value,
            subtitle: bootSub.value,
            animation: bootCfg.animation,
          });
          bootCfg = r.splash || bootCfg;
          toast(t('boot_saved')); haptic('success');
          drawBootPreview();
        } catch (e) { fail(e); }
      },
    }, icon('check', 18), t('save'));
    bootHost.replaceChildren(
      h('p.muted', t('boot_sub')),
      h('div.label', t('language')), langSeg,
      h('div.label', t('boot_title')), bootTitle,
      h('div.label', t('boot_subtitle')), bootSub,
      h('div.label', t('boot_animation')), animSeg,
      h('div.label', t('preview')), bootPreview,
      saveBtn,
    );
    drawBootPreview();
  }

  const openBootSplash = () => openScreen((close) => {
    loadBootSplash().then(() => renderBootHost());
    renderBootHost();
    return [
      ...subTop(t('boot_title_section'), close),
      bootHost,
    ];
  });

  const openStyle = () => openScreen((close) => {
    drawStyle();
    return [
      ...subTop(t('admin_style'), close),
      styleHost,
    ];
  });

  const openMedals = () => openScreen((close) => {
    loadMedals();
    return [
      ...subTop(t('admin_medals'), close),
      medalHost,
    ];
  });

  // ----- profile banner -----
  const bannerHost = h('div.admin-banner');
  const bannerFile = h('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/gif', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      toast(t('uploading'));
      try {
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' },
          body: f,
        });
        const d = await res.json();
        if (!res.ok) throw Object.assign(new Error(d.error), { code: d.code });
        const saved = await api('PATCH', '/admin/profile-banner', { mediaId: d.id });
        toast(t('admin_banner_saved')); haptic('success');
        drawBanner(saved);
      } catch (err) { fail(err); }
    },
  });

  function drawBanner(info) {
    const url = (info && info.url) || '/img/profile-banner.png';
    const custom = !!(info && info.mediaId);
    bannerHost.replaceChildren(
      h('p.muted', t('admin_banner_sub')),
      h('div.admin-banner-preview', { style: { backgroundImage: `url("${url}")` } }),
      h('div.row', { style: { gap: '8px', marginTop: '12px' } },
        h('button.btn.ghost.sm', { type: 'button', onclick: () => bannerFile.click() }, icon('image', 18), t('admin_banner_upload')),
        custom ? h('button.btn.ghost.sm', {
          type: 'button',
          onclick: async () => {
            try {
              const saved = await api('PATCH', '/admin/profile-banner', { mediaId: null });
              toast(t('admin_banner_reset')); haptic('success');
              drawBanner(saved);
            } catch (err) { fail(err); }
          },
        }, t('admin_banner_default')) : null),
      bannerFile,
    );
  }

  async function loadBanner() {
    try {
      drawBanner(await api('GET', '/admin/profile-banner'));
    } catch (e) { fail(e); drawBanner({ url: '/img/profile-banner.png', mediaId: null }); }
  }

  const openBanner = () => openScreen((close) => {
    loadBanner();
    return [
      ...subTop(t('admin_banner'), close),
      bannerHost,
    ];
  });

  const openInAppNotif = () => openScreen((close) => {
    const TTL_OPTS = [
      ['permanent', t('admin_notif_ttl_permanent')],
      ['1h', t('admin_notif_ttl_1h')],
      ['6h', t('admin_notif_ttl_6h')],
      ['24h', t('admin_notif_ttl_24h')],
      ['3d', t('admin_notif_ttl_3d')],
      ['7d', t('admin_notif_ttl_7d')],
      ['30d', t('admin_notif_ttl_30d')],
    ];
    const title = h('input.input', { placeholder: t('admin_notif_title_ph'), maxlength: 80 });
    const body = h('textarea.input', { rows: 4, placeholder: t('admin_notif_body_ph'), maxlength: 1000 });
    let mediaId = null;
    let ttl = 'permanent';
    let editingId = null;
    const ttlSelect = h('select.input', {
      onchange: () => { ttl = ttlSelect.value; },
    }, ...TTL_OPTS.map(([v, label]) => h('option', { value: v }, label)));
    ttlSelect.value = ttl;
    const listBox = h('div.list');
    const mediaBox = h('div.admin-notif-media');
    const actionBtn = h('button.btn');
    const file = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/gif', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        toast(t('uploading'));
        try {
          const res = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' },
            body: f,
          });
          const d = await res.json();
          if (!res.ok) throw Object.assign(new Error(d.error), { code: d.code });
          mediaId = d.id;
          drawMedia();
          haptic('success');
        } catch (err) { fail(err); }
      },
    });
    const drawTtl = () => {
      ttlSelect.value = ttl;
    };
    const drawMedia = () => {
      mediaBox.replaceChildren(
        mediaId
          ? h('div.row',
            h('div.grow', h('div.t', t('admin_notif_media_ok')), h('div.s', mediaId.slice(0, 8) + '…')),
            h('button.mini', {
              type: 'button',
              onclick: () => { mediaId = null; drawMedia(); },
            }, icon('x', 16), t('remove')))
          : h('button.btn.ghost.sm', {
            type: 'button',
            onclick: () => file.click(),
          }, icon('image', 18), t('admin_notif_media')),
        file,
      );
    };
    const resetForm = () => {
      editingId = null;
      title.value = '';
      body.value = '';
      mediaId = null;
      ttl = 'permanent';
      drawMedia();
      drawTtl();
      drawAction();
    };
    const drawAction = () => {
      actionBtn.replaceChildren(
        icon(editingId ? 'check' : 'bell', 18),
        editingId ? t('admin_notif_save') : t('admin_notif_send'),
      );
      actionBtn.onclick = async () => {
        const ttlTitle = title.value.trim();
        const txt = body.value.trim();
        if (!ttlTitle) return toast(t('e_title'), true);
        if (!txt) return toast(t('e_text'), true);
        try {
          if (editingId) {
            await api('PATCH', `/admin/notifications/${editingId}`, {
              title: ttlTitle,
              body: txt,
              mediaId: mediaId || null,
              ttl,
            });
            toast(t('admin_notif_updated'));
          } else {
            const r = await api('POST', '/admin/notifications', {
              title: ttlTitle,
              body: txt,
              mediaId: mediaId || undefined,
              ttl,
            }, { timeoutMs: 60000 });
            toast(t('admin_notif_sent', { n: r.sent || 0 }));
          }
          haptic('success');
          resetForm();
          loadList();
        } catch (e) { fail(e); }
      };
    };
    const ttlLabel = (c) => {
      if (c.permanent || !c.expiresAt) return t('admin_notif_ttl_permanent');
      try {
        return new Date(c.expiresAt).toLocaleString();
      } catch { return String(c.expiresAt); }
    };
    const loadList = async () => {
      try {
        const r = await api('GET', '/admin/notifications');
        const campaigns = r.campaigns || [];
        if (!campaigns.length) {
          listBox.replaceChildren(h('div.empty', t('admin_notif_list_empty')));
          return;
        }
        listBox.replaceChildren(...campaigns.map((c) => h('div.card',
          h('div.t', c.title),
          h('div.s', c.body),
          h('div.s', t('admin_notif_meta', { n: c.sentCount || 0, ttl: ttlLabel(c) })),
          h('div.row',
            h('button.mini', {
              type: 'button',
              onclick: () => {
                editingId = c.id;
                title.value = c.title || '';
                body.value = c.body || '';
                mediaId = c.mediaId || null;
                ttl = c.permanent ? 'permanent' : '24h';
                if (!c.permanent && c.expiresAt) {
                  const ms = new Date(c.expiresAt).getTime() - Date.now();
                  if (ms > 20 * 24 * 3600 * 1000) ttl = '30d';
                  else if (ms > 5 * 24 * 3600 * 1000) ttl = '7d';
                  else if (ms > 2 * 24 * 3600 * 1000) ttl = '3d';
                  else if (ms > 12 * 3600 * 1000) ttl = '24h';
                  else if (ms > 3 * 3600 * 1000) ttl = '6h';
                  else ttl = '1h';
                }
                drawMedia();
                drawTtl();
                drawAction();
                haptic('select');
                title.scrollIntoView({ behavior: 'smooth', block: 'center' });
              },
            }, icon('pencil', 16), t('ann_edit')),
            h('button.mini', {
              type: 'button',
              onclick: async () => {
                if (!(await confirmSheet(t('admin_notif_delete_confirm'), t('admin_notif_delete'), true))) return;
                try {
                  await api('DELETE', `/admin/notifications/${c.id}`);
                  toast(t('admin_notif_deleted'));
                  haptic('success');
                  if (editingId === c.id) resetForm();
                  loadList();
                } catch (e) { fail(e); }
              },
            }, icon('trash', 16), t('remove')),
          ),
        )));
      } catch (e) { fail(e); }
    };
    drawMedia();
    drawTtl();
    drawAction();
    loadList();
    return [
      ...subTop(t('admin_notif'), close),
      h('p.muted', t('admin_notif_sub')),
      h('div.field', h('label', t('admin_notif_title')), title),
      h('div.field', h('label', t('admin_notif_body')), body),
      h('div.field', h('label', t('admin_notif_ttl')), ttlSelect),
      h('div.field', h('label', t('admin_notif_media')), mediaBox),
      actionBtn,
      editingId
        ? h('button.btn.ghost', { type: 'button', onclick: () => resetForm() }, t('cancel'))
        : null,
      h('div.h2', t('admin_notif_list')),
      listBox,
    ];
  });

  openScreen((close) => [
    h('button.back', { type: 'button', onclick: () => close() }, icon('back', 20), t('back')),
    h('div.top', h('h1', t('admin_title'))),
    sec(t('admin_sec_overview')),
    menuCard(
      menuRow({ ic: 'live', title: t('admin_sec_live'), sub: t('admin_sec_live_sub'), onClick: openLive }),
      menuRow({ ic: 'chart', title: t('ann_title_section'), sub: t('admin_sec_ann_sub'), onClick: openAnnouncements }),
    ),
    sec(t('admin_sec_economy')),
    menuCard(
      menuRow({ ic: 'friends', title: t('users_list'), sub: t('admin_users_sub'), onClick: openUsers }),
      menuRow({ ic: 'gem', title: t('admin_sec_shop'), sub: t('admin_shop_sub'), onClick: openShop }),
    ),
    sec(t('admin_sec_content')),
    menuCard(
      menuRow({ ic: 'send', title: t('composer'), sub: t('admin_sec_broadcast_sub'), onClick: openBroadcast }),
      menuRow({ ic: 'chart', title: t('msg_stats_title'), sub: t('msg_stats_menu_sub'), onClick: openMessageStats }),
      menuRow({ ic: 'play', title: t('welcome_title'), sub: t('welcome_menu_sub'), onClick: openWelcome }),
      menuRow({ ic: 'cpu', title: t('boot_title_section'), sub: t('boot_menu_sub'), onClick: openBootSplash }),
      menuRow({ ic: 'bell', title: t('admin_notif'), sub: t('admin_notif_menu_sub'), onClick: openInAppNotif }),
      menuRow({ ic: 'image', title: t('admin_banner'), sub: t('admin_banner_menu_sub'), onClick: openBanner }),
      menuRow({ ic: 'gear', title: t('admin_style'), sub: t('admin_style_sub'), onClick: openStyle }),
      menuRow({ ic: 'rankings', title: t('admin_medals'), sub: t('admin_medals_sub'), onClick: openMedals }),
    ),
  ], {
    onClose: () => {
      clearInterval(timer); timer = null;
      onClose && onClose();
    },
  });
}
