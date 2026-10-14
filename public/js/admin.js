// Admin panel: live users, KPIs, post composer (media, button text + colours), users list.
import { h, $, icon, haptic, toast, api, fail, getInitData, avatar, confirmSheet, seg } from './ui.js';
import { t, LANGS, LANG_NAMES } from './i18n.js';
import { PIECE_SETS, BOARD_THEMES, BOARD_SWATCH, pieceSvg } from './pieces.js';
import { restyleBoards } from './board.js';
import { restyleOpenGame } from './game.js';

let timer = null;
const COLOR_KEYS = ['default', 'primary', 'success', 'danger'];
const swatch = { default: 'var(--card-2)', primary: '#2f81f7', success: '#2ea043', danger: '#e5484d' };

export function openAdmin(onClose) {
  const el = $('#screen');
  el.replaceChildren(); el.classList.add('show'); el.removeAttribute('aria-hidden');
  const close = () => { clearInterval(timer); el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); try { window.Telegram.WebApp.BackButton.offClick(close); window.Telegram.WebApp.BackButton.hide(); } catch { /* ignore */ } onClose && onClose(); };
  try { const bb = window.Telegram.WebApp.BackButton; bb.onClick(close); bb.show(); } catch { /* ignore */ }

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
  const pieceBox = h('div.style-swatches');
  const boardBox = h('div.style-swatches');
  const applyLocal = (pieceSet, boardTheme) => {
    document.documentElement.dataset.pieces = pieceSet;
    document.documentElement.dataset.board = boardTheme;
    restyleBoards();
    try { restyleOpenGame(); } catch { /* ignore */ }
  };
  const drawStyle = () => {
    pieceBox.replaceChildren(...PIECE_SETS.map((id) => h('button.style-sw' + (styleUser.pieceSet === id ? '.on' : ''), {
      type: 'button',
      'data-pieces': id,
      'aria-label': t('piece_' + id),
      onclick: async () => {
        try {
          styleUser = (await api('PATCH', '/me', { pieceSet: id })).user;
          applyLocal(styleUser.pieceSet, styleUser.boardTheme);
          drawStyle(); haptic('select'); toast(t('piece_' + id));
        } catch (e) { fail(e); }
      },
    }, h('span.sw-pc', { html: pieceSvg('w', 'n', id) }), h('span.sw-lab', t('piece_' + id)))));
    boardBox.replaceChildren(...BOARD_THEMES.map((id) => {
      const sw = BOARD_SWATCH[id];
      return h('button.style-sw.board' + (styleUser.boardTheme === id ? '.on' : ''), {
        type: 'button',
        'aria-label': t('board_' + id),
        title: t('board_' + id),
        onclick: async () => {
          try {
            styleUser = (await api('PATCH', '/me', { boardTheme: id })).user;
            applyLocal(styleUser.pieceSet, styleUser.boardTheme);
            drawStyle(); haptic('select'); toast(t('board_' + id));
          } catch (e) { fail(e); }
        },
      },
        h('i', { style: { background: sw.lt } }),
        h('i', { style: { background: sw.dk } }),
        h('i', { style: { background: sw.dk } }),
        h('i', { style: { background: sw.lt } }));
    }));
  };
  api('GET', '/me').then((r) => {
    styleUser = r.user;
    applyLocal(styleUser.pieceSet || 'outline', styleUser.boardTheme || 'classic');
    drawStyle();
  }).catch(() => drawStyle());

  el.append(
    h('button.back', { onclick: close }, icon('back', 20), t('back')),
    h('div.top', h('h1', t('admin_title'))),
    liveBox, h('div.h2', t('stats')), kpis,
    h('div.h2', t('signups')), h('div.card', bars),
    h('div.h2', t('admin_style')), h('p.muted', t('admin_style_sub')),
    h('div.card', h('div.label', t('piece_set')), pieceBox, h('div.label', t('board_theme')), boardBox),
    h('div.h2', t('composer')),
    h('div.card', text, mediaBox, file, h('div.label', t('buttons') + ' · ' + t('up_to')), btnBox, h('div.label', t('audience')), audience, h('div.label', t('preview')), preview, sendTest, sendAll),
    h('div.h2', t('history')), histBox,
    h('div.h2', t('users_list')), search, usersBox);
  drawMedia(); drawButtons(); drawPreview();
  loadLive(); loadUsers(); loadHistory();
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadLive(); }, 5000);
  el.scrollTop = 0;
}
