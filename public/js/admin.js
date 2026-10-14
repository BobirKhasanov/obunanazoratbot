// Admin panel: live users, KPIs, post composer (media, button text + colours), users list.
import { h, icon, haptic, toast, api, fail, getInitData, avatar, confirmSheet, seg } from './ui.js';
import { t, LANGS, LANG_NAMES } from './i18n.js';
import { restyleBoards } from './board.js';
import { restyleOpenGame } from './game.js';
import { stylePickerCard } from './style-ui.js';
import { openScreen } from './screen.js';

let timer = null;
const COLOR_KEYS = ['default', 'primary', 'success', 'danger'];
const swatch = { default: 'var(--card-2)', primary: '#2f81f7', success: '#2ea043', danger: '#e5484d' };

export function openAdmin(onClose) {
  const liveBox = h('div.card.live'), kpis = h('div.kpis'), bars = h('div.spark'), liveHead = h('div.livehead');
  const usersBox = h('div.list'), histBox = h('div.list');

  async function loadLive() {
    try {
      const [live, st] = await Promise.all([api('GET', '/admin/live'), api('GET', '/admin/stats')]);
      liveHead.replaceChildren(h('i.dot.on'), h('b', String(live.count)), h('span.muted', ' ' + t('live_users')));
      liveBox.replaceChildren(liveHead, live.users.length ? h('div.livelist', live.users.map((u) => h('div.chipuser', avatar(u.name, u.id, 'sm'), h('span', u.name), u.inGame ? h('em', '♟') : null, u.isAdmin ? h('em', '★') : null))) : h('div.muted', t('nobody_live')));
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
        h('div.grow', h('div.t', u.first_name || 'Player', u.isAdmin ? h('span.pill', ' ' + t('admin_tag')) : null), h('div.s', `${u.username ? '@' + u.username + ' · ' : ''}${u.id} · ${u.lang} · ♟${u.games}`)),
        u.isAdmin ? null : h('button.mini' + (u.blocked ? '.ok' : ''), { onclick: async () => { try { await api('POST', `/admin/users/${u.id}/block`, { blocked: !u.blocked }); loadUsers(q); } catch (e) { fail(e); } } }, u.blocked ? t('unblock') : t('block')))));
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
      seg([['app', t('btn_app')], ['url', t('btn_url')]], b.type, (v) => { b.type = v; drawButtons(); drawPreview(); }),
      b.type === 'url' ? h('input.input', { value: b.url, placeholder: t('btn_link'), inputmode: 'url', oninput: (e) => { b.url = e.target.value; } }) : null,
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
  const payload = (test) => ({ text: post.text, mediaId: post.media ? post.media.id : undefined, lang: post.lang, test, buttons: post.buttons.map((b) => ({ text: b.text, type: b.type, color: b.color, url: b.type === 'url' ? b.url : undefined })) });
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

  // Admin appearance (piece set + board) — saved on this admin account
  let styleUser = { pieceSet: 'outline', boardTheme: 'classic' };
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
    applyLocal(styleUser.pieceSet || 'outline', styleUser.boardTheme || 'classic');
    drawStyle();
  }).catch(() => drawStyle());

  // ----- home announcements -----
  const annList = h('div.list');
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
      const pages = ['play', 'puzzles', 'rankings', 'live', 'profile', 'premium', 'friends', 'settings'];
      linkExtra.append(h('div.chips', pages.map((p) => h('button.chip' + (annForm.linkPage === p ? '.on' : ''), {
        type: 'button',
        onclick: () => { annForm.linkPage = p; drawAnnLink(); },
      }, p))));
    }
  }
  drawAnnLink();

  const colorRow = (label, key, def) => h('div.ann-color',
    h('span', label),
    h('input', {
      type: 'color', value: def,
      oninput: (e) => { annForm[key] = e.target.value; },
    }));

  async function loadAnnouncements() {
    try {
      const r = await api('GET', '/admin/announcements');
      if (!annForm.endsAtTashkent && r.nowTashkent) {
        // default end = tomorrow 23:59 Tashkent
        const base = r.nowTashkent.slice(0, 10);
        const d = new Date(base + 'T12:00:00+05:00');
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        annForm.endsAtTashkent = `${y}-${m}-${day}T23:59`;
        endsIn.value = annForm.endsAtTashkent;
      }
      annList.replaceChildren(...(r.announcements || []).map((a) => h('div.row',
        h('div.grow',
          h('div.t', a.title || a.body || '—'),
          h('div.s', `${t('ann_until')}: ${a.endsAtTashkent.replace('T', ' ')} (Tashkent)`)),
        h('button.mini', {
          onclick: async () => {
            if (!(await confirmSheet(t('ann_delete_confirm'), t('remove'), true))) return;
            try { await api('DELETE', `/admin/announcements/${a.id}`); loadAnnouncements(); toast(t('ann_deleted')); } catch (e) { fail(e); }
          },
        }, icon('trash', 16)))));
      if (!(r.announcements || []).length) annList.append(h('div.muted', t('ann_empty')));
    } catch (e) { fail(e); }
  }

  const saveAnn = h('button.btn', {
    onclick: async () => {
      try {
        await api('POST', '/admin/announcements', {
          title: annForm.title,
          body: annForm.body,
          titleColor: annForm.titleColor,
          bodyColor: annForm.bodyColor,
          bgFrom: annForm.bgFrom,
          bgTo: annForm.bgTo,
          fontFamily: annForm.fontFamily,
          fontSize: annForm.fontSize,
          mediaId: annForm.mediaId || undefined,
          linkType: annForm.linkType,
          linkUrl: annForm.linkUrl,
          linkPage: annForm.linkPage,
          endsAtTashkent: annForm.endsAtTashkent,
        });
        toast(t('ann_saved')); haptic('success');
        annForm.title = ''; annForm.body = ''; annForm.mediaId = null; annForm.mediaPreview = null;
        titleIn.value = ''; bodyIn.value = '';
        drawAnnMedia();
        loadAnnouncements();
      } catch (e) { fail(e); }
    },
  }, icon('plus', 18), t('ann_publish'));

  const annCard = h('div.card',
    h('p.muted', t('ann_sub')),
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
    saveAnn);

  openScreen((close) => {
    drawMedia(); drawButtons(); drawPreview();
    loadLive(); loadUsers(); loadHistory(); loadAnnouncements();
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadLive(); }, 5000);
    return [
      h('button.back', { onclick: () => close() }, icon('back', 20), t('back')),
      h('div.top', h('h1', t('admin_title'))),
      liveBox, h('div.h2', t('stats')), kpis,
      h('div.h2', t('signups')), h('div.card', bars),
      h('div.h2', t('ann_title_section')), annCard, h('div.h2', t('ann_list')), annList,
      h('div.h2', t('admin_style')), styleHost,
      h('div.h2', t('composer')),
      h('div.card', text, mediaBox, file, h('div.label', t('buttons') + ' · ' + t('up_to')), btnBox, h('div.label', t('audience')), audience, h('div.label', t('preview')), preview, sendTest, sendAll),
      h('div.h2', t('history')), histBox,
      h('div.h2', t('users_list')), search, usersBox,
    ];
  }, {
    onClose: () => {
      clearInterval(timer); timer = null;
      onClose && onClose();
    },
  });
}
