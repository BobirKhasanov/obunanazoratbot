// Admin panel: nx hub (overview stats + grouped sections) → live, users, shop, promos, messages, content.
import { h, icon, haptic, toast, api, fail, getInitData, avatar, avBlock, confirmSheet, pillBar } from './ui.js';
import { t, LANGS, LANG_NAMES } from './i18n.js';
import { sectionHead, statCard, emptyNote, filterChip } from './neonui.js';
import { openScreen } from './screen.js';

let timer = null;
const COLOR_KEYS = ['default', 'primary', 'success', 'danger'];
const swatch = { default: 'var(--card-2)', primary: '#2f81f7', success: '#2ea043', danger: '#e5484d' };

function menuCard(...rows) {
  return h('div.menu-card', rows.filter(Boolean));
}

function menuRow({ ic, title, sub, tone, onClick }) {
  return h('button.menu-row', {
    type: 'button',
    onclick: () => { haptic('select'); onClick(); },
  },
    h('span.menu-ic' + (tone ? '.' + tone : ''), icon(ic, 22)),
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

/** nx chip selector (replaces pill segments in admin forms); `.set(v)` updates selection. */
function chipSeg(options, value, onChange) {
  let cur = value;
  const el = h('div.nx-chips.adm-chips', { 'data-noswipe': '' });
  const draw = () => el.replaceChildren(...options.map(([id, label]) => filterChip(id, label, id === cur, (v) => {
    if (v === cur) return;
    cur = v; draw(); onChange(v);
  })));
  draw();
  el.set = (v) => { cur = v; draw(); };
  return el;
}

const card = (...kids) => h('div.adm-card', ...kids);
const field = (label, ...kids) => h('div.adm-field', h('div.label', label), ...kids);
const primaryBtn = (ic, label, onclick) => h('button.nx-btn-p.adm-btn', { type: 'button', onclick }, ic ? icon(ic, 18) : null, label);
const ghostBtn = (ic, label, onclick) => h('button.nx-btn-o.adm-btn', { type: 'button', onclick }, ic ? icon(ic, 18) : null, label);
const icBtn = (ic, title, onclick, tone) => h('button.adm-ic' + (tone ? '.' + tone : ''), { type: 'button', title, 'aria-label': title, onclick }, icon(ic, 16));
const listRow = (title, subs, ...actions) => h('div.adm-row',
  h('div.nx-row-tx', h('b', title), ...[].concat(subs).filter(Boolean).map((s) => h('small.wrap', s))),
  actions.length ? h('div.adm-row-act', ...actions.filter(Boolean)) : null);
const cardList = (rows, empty) => (rows.length ? h('div.nx-card-list', ...rows) : emptyNote(empty));

async function uploadMedia(f) {
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'X-Init-Data': getInitData(), 'Content-Type': 'application/octet-stream' },
    body: f,
  });
  const d = await res.json();
  if (!res.ok) throw Object.assign(new Error(d.error || d.message || 'upload'), { code: d.code });
  return d;
}

/** Default end date (YYYY-MM-DDT23:59) N days after the server's Tashkent "now". */
function tashkentDefault(nowTashkent, days) {
  const d = new Date(nowTashkent.slice(0, 10) + 'T12:00:00+05:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T23:59`;
}

const broadcastSub = (b) => `#${b.id} · ${b.lang} · ${b.sent}/${b.total}${b.failed ? ` · ✗${b.failed}` : ''} · ${t('status_' + b.status)}`;

/** Inline-keyboard button editor shared by broadcast + welcome. */
function buttonEditor(host, buttons, redraw) {
  host.replaceChildren(...buttons.map((b, i) => h('div.beditor',
    h('input.input', { value: b.text, placeholder: t('btn_text'), maxlength: 64, oninput: (e) => { b.text = e.target.value; redraw(false); } }),
    chipSeg(
      [['app', t('btn_app')], ['invite', t('btn_invite')], ['url', t('btn_url')]],
      b.type,
      (v) => { b.type = v; redraw(true); },
    ),
    b.type === 'url'
      ? h('input.input', { value: b.url || '', placeholder: t('btn_link'), inputmode: 'url', oninput: (e) => { b.url = e.target.value; } })
      : b.type === 'invite'
        ? h('p.muted', t('btn_invite_hint'))
        : null,
    h('div.beditor-foot',
      h('div.swatches', COLOR_KEYS.map((c) => h('button.sw' + (b.color === c ? '.on' : ''), {
        type: 'button',
        'aria-label': t('c_' + (c === 'default' ? 'default' : c)),
        style: { background: swatch[c] },
        onclick: () => { b.color = c; redraw(true); },
      }))),
      icBtn('trash', t('remove'), () => { buttons.splice(i, 1); redraw(true); }, 'danger')))));
  if (buttons.length < 6) {
    host.append(h('button.nx-btn-o.sm.adm-add', {
      type: 'button',
      onclick: () => { buttons.push({ text: '', type: 'app', url: '', color: 'primary' }); redraw(true); },
    }, icon('plus', 16), t('add_button')));
  }
}

export function openAdmin(onClose) {
  const liveHost = h('div'), kpis = h('div.nx-stats'), bars = h('div.spark');
  const usersBox = h('div'), histBox = h('div');

  async function loadLive() {
    try {
      const [live, st] = await Promise.all([api('GET', '/admin/live'), api('GET', '/admin/stats')]);
      liveHost.replaceChildren(
        sectionHead(t('live_users'), null, null, { dot: 'green', sub: String(live.count) }),
        live.users.length
          ? h('div.adm-live', live.users.map((u) => h('span.adm-live-u', avatar(u.name, u.id, 'sm'), h('span', u.name), u.inGame ? h('em', '♟') : null)))
          : emptyNote(t('nobody_live')));
      kpis.replaceChildren(
        statCard('users', t('k_users'), st.users, 'blue'),
        statCard('userPlus', t('k_new'), st.newToday, 'green'),
        statCard('chart', t('k_active'), st.active7d, 'gold'),
        statCard('gamepad', t('k_games_live'), st.gamesLive, 'green'),
        statCard('trophy', t('k_games_played'), st.gamesPlayed, 'blue'),
        statCard('x', t('k_unreachable'), st.unreachable, 'gold'));
      const max = Math.max(1, ...st.signups.map((d) => d.count));
      bars.replaceChildren(...st.signups.map((d, i) => h('i' + (i === st.signups.length - 1 ? '.on' : ''), { title: `${d.date}: ${d.count}`, style: { height: `${Math.max(6, (d.count / max) * 100)}%` } })));
    } catch (e) { if (e.code !== 'net') fail(e); }
  }

  async function loadUsers(q = '') {
    try {
      const r = await api('GET', '/admin/users?q=' + encodeURIComponent(q));
      const rows = (r.users || []).map((u) => {
        const name = u.first_name || 'Player';
        const meta = [
          u.username ? '@' + u.username : null,
          String(u.id),
          `💎 ${u.diamonds || 0}`,
          u.premium ? 'Premium' : null,
          `♟ ${u.games || 0}`,
        ].filter(Boolean).join(' · ');
        const actions = [
          icBtn('gem', t('admin_grant_diamonds'), async () => {
            const raw = window.prompt(t('admin_grant_prompt', { name: name || u.id }), '100');
            if (raw == null || raw === '') return;
            const amount = Math.floor(Number(raw));
            if (!Number.isFinite(amount) || amount === 0) return toast(t('e_bad_request'), true);
            try {
              await api('POST', `/admin/users/${u.id}/diamonds`, { amount });
              toast(amount < 0
                ? t('admin_remove_ok', { n: Math.abs(amount) })
                : t('admin_grant_ok', { n: amount }));
              haptic('success');
              loadUsers(q);
            } catch (e) { fail(e); }
          }),
        ];
        if (!u.isAdmin) {
          actions.push(
            icBtn(u.blocked ? 'check' : 'x', u.blocked ? t('unblock') : t('block'), async () => {
              try {
                await api('POST', `/admin/users/${u.id}/block`, { blocked: !u.blocked });
                loadUsers(q);
              } catch (e) { fail(e); }
            }, u.blocked ? 'ok' : ''),
            icBtn('trash', t('admin_delete_user'), async () => {
              if (!(await confirmSheet(t('admin_delete_confirm', { name }), t('admin_delete_user'), true))) return;
              try {
                await api('DELETE', `/admin/users/${u.id}`);
                toast(t('admin_user_deleted'));
                haptic('success');
                loadUsers(q);
              } catch (e) { fail(e); }
            }, 'danger'),
          );
        }
        return h('div.adm-row.admin-user-row' + (u.blocked ? '.off' : ''),
          avBlock(name, u.id, { round: true, online: !!u.online, premium: !!u.premium }),
          h('div.nx-row-tx',
            h('b', h('span.name', name), u.isAdmin ? h('span.nx-chip-s.blue', t('admin_tag')) : null),
            h('small.wrap', meta)),
          h('div.adm-row-act', ...actions));
      });
      usersBox.replaceChildren(cardList(rows, t('admin_users_empty')));
    } catch (e) { fail(e); }
  }

  async function loadHistory() {
    try {
      const r = await api('GET', '/admin/broadcasts');
      histBox.replaceChildren(cardList(r.broadcasts.map((b) => listRow((b.text || '📎').slice(0, 60), broadcastSub(b))), t('msg_stats_empty')));
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
      const d = await uploadMedia(f);
      post.media = { id: d.id, kind: d.kind, url: URL.createObjectURL(f), isVideo: f.type.startsWith('video') };
      drawMedia(); drawPreview(); haptic('success');
    } catch (e) { fail(e); }
  }
  function drawMedia() {
    mediaBox.replaceChildren();
    if (post.media) {
      const m = post.media.isVideo ? h('video', { src: post.media.url, muted: true, playsinline: true, loop: true, autoplay: true }) : h('img', { src: post.media.url, alt: '' });
      mediaBox.append(m, h('button.nx-btn-o.sm', { type: 'button', onclick: () => { post.media = null; drawMedia(); drawPreview(); } }, icon('x', 14), t('remove')));
    } else mediaBox.append(h('button.nx-btn-o.sm', { type: 'button', onclick: () => file.click() }, icon('image', 16), t('add_media')));
  }
  function drawButtons() {
    buttonEditor(btnBox, post.buttons, (full) => { if (full) drawButtons(); drawPreview(); });
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
  const sendTest = ghostBtn('send', t('send_test'), async () => { try { await api('POST', '/admin/broadcast', payload(true)); toast(t('test_sent')); } catch (e) { fail(e); } });
  const sendAll = primaryBtn('send', t('send_all'), async () => {
    try {
      const st = await api('GET', '/admin/stats');
      const n = post.lang === 'all' ? st.users : (st.byLang.find((x) => x.lang === post.lang) || { c: 0 }).c;
      if (!(await confirmSheet(t('confirm_send', { n }), t('send_all')))) return;
      const r = await api('POST', '/admin/broadcast', payload(false));
      toast(t('sending', { n: r.queued })); haptic('success');
      setTimeout(loadHistory, 2500);
    } catch (e) { fail(e); }
  });
  const audience = chipSeg([['all', t('all_users')], ...LANGS.map((l) => [l, LANG_NAMES[l].slice(0, 3)])], 'all', (v) => { post.lang = v; });
  const search = h('input.input', { type: 'search', placeholder: t('search'), oninput: (e) => { clearTimeout(search._t); search._t = setTimeout(() => loadUsers(e.target.value), 250); } });

  // ----- home announcements -----
  const annList = h('div');
  let editingAnnId = null;
  const annForm = {
    title: '', body: '', titleColor: '#ffffff', bodyColor: '#fbbf24',
    bgFrom: '#3b82f6', bgTo: '#6366f1', fontFamily: 'system', fontSize: 18,
    mediaId: null, mediaPreview: null, linkType: 'none', linkUrl: '', linkPage: 'play',
    endsAtTashkent: '',
  };
  const annMediaBox = h('div.media-box');
  const annFile = h('input', {
    // Carousel renders <img> only — keep announcements to still images
    type: 'file', accept: 'image/jpeg,image/png,image/gif', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      toast(t('uploading'));
      try {
        const d = await uploadMedia(f);
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
        h('button.nx-btn-o.sm', { type: 'button', onclick: () => { annForm.mediaId = null; annForm.mediaPreview = null; drawAnnMedia(); } }, icon('x', 14), t('remove')),
      );
    } else annMediaBox.append(h('button.nx-btn-o.sm', { type: 'button', onclick: () => annFile.click() }, icon('image', 16), t('add_media')));
  }
  drawAnnMedia();
  async function loadAnnMediaPreview(mediaId) {
    if (!mediaId) { annForm.mediaPreview = null; drawAnnMedia(); return; }
    try {
      const res = await fetch('/api/media/' + mediaId, { headers: { 'X-Init-Data': getInitData() } });
      if (!res.ok) { annForm.mediaPreview = null; drawAnnMedia(); return; }
      annForm.mediaPreview = URL.createObjectURL(await res.blob());
    } catch { annForm.mediaPreview = null; }
    drawAnnMedia();
  }

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
  const fontSeg = chipSeg([['system', 'Aa'], ['rounded', 'Rd'], ['serif', 'Se'], ['mono', 'Mo']], 'system', (v) => { annForm.fontFamily = v; });
  const linkSeg = chipSeg([
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
      const pages = [
        ['play', 'play'], ['puzzles', 'puzzles'], ['rankings', 'rankings'], ['live', 'live'],
        ['profile', 'profile'], ['premium', 'premium'], ['friends', 'friends'],
        ['settings', 'settings'], ['diamonds', 'diamonds'], ['promo', t('promo_title')],
      ];
      linkExtra.append(chipSeg(pages, annForm.linkPage, (p) => { annForm.linkPage = p; }));
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
    fontSeg.set(annForm.fontFamily || 'system');
    linkSeg.set(annForm.linkType || 'none');
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
      mediaPreview: null, // loaded via authenticated blob fetch (media URL needs X-Init-Data)
      linkType: a.linkType || 'none',
      linkUrl: a.linkUrl || '',
      linkPage: a.linkPage || 'play',
      endsAtTashkent: (a.endsAtTashkent || '').slice(0, 16),
    });
    syncAnnFormInputs();
    loadAnnMediaPreview(a.mediaId || null);
    try { titleIn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ }
  }

  const saveAnn = h('button.nx-btn-p.adm-btn', { type: 'button' });
  const cancelEditAnn = h('button.nx-btn-o.adm-btn', {
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
      // Only the home carousel is rendered by the client
      board: 'home',
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
      const r = await api('GET', '/admin/announcements?board=home');
      if (!annForm.endsAtTashkent && r.nowTashkent) {
        annForm.endsAtTashkent = tashkentDefault(r.nowTashkent, 1);
        endsIn.value = annForm.endsAtTashkent;
      }
      const active = (r.announcements || []).filter((a) => {
        const end = a.endsAt ? new Date(a.endsAt).getTime() : 0;
        return !end || end > Date.now();
      });
      annList.replaceChildren(cardList(active.map((a) => listRow(
        a.title || a.body || '—',
        `${t('ann_until')}: ${(a.endsAtTashkent || '').replace('T', ' ')} (Tashkent)`,
        icBtn('pencil', t('ann_edit'), () => { haptic('select'); beginEditAnn(a); }),
        icBtn('trash', t('remove'), async () => {
          if (!(await confirmSheet(t('ann_delete_confirm'), t('remove'), true))) return;
          try {
            await api('DELETE', `/admin/announcements/${a.id}`);
            if (editingAnnId === a.id) resetAnnForm(true);
            loadAnnouncements();
            toast(t('ann_deleted'));
          } catch (e) { fail(e); }
        }, 'danger'))), t('ann_empty')));
    } catch (e) { fail(e); }
  }

  const annCard = card(
    h('p.muted', t('ann_sub')),
    field(t('ann_title'), titleIn),
    field(t('ann_body'), bodyIn),
    field(t('ann_font'), fontSeg),
    field(t('ann_colors'), h('div.ann-colors',
      colorRow(t('ann_title_color'), 'titleColor', '#ffffff'),
      colorRow(t('ann_body_color'), 'bodyColor', '#fbbf24'),
      colorRow(t('ann_bg_from'), 'bgFrom', '#3b82f6'),
      colorRow(t('ann_bg_to'), 'bgTo', '#6366f1'))),
    field(t('ann_media'), annMediaBox, annFile),
    field(t('ann_link'), linkSeg, linkExtra),
    field(t('ann_ends') + ' · Tashkent (UTC+5)', endsIn),
    h('div.adm-actions', saveAnn, cancelEditAnn));

  // ----- shop settings (incl. game analysis limit) -----
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
    puzzleDailyReward: 2,
    referralReward: 20,
    referralInviteeReward: 10,
    analysisDailyFree: 3,
    tour: { prize1: 20, prize2: 15, prize3: 10, organizer: 10, organizerBig: 15, bigThreshold: 16, weeklyLimit: 1, dailyJoinLimit: 1 },
  };
  const shopHost = h('div.sx');
  let shopTab = 'premium';

  function drawShop() {
    if (!shop.premiumPlans || !shop.premiumPlans.length) {
      shop.premiumPlans = [
        { months: 1, diamonds: shop.premiumPriceDiamonds || 200 },
        { months: 3, diamonds: 500 },
        { months: 6, diamonds: 900 },
        { months: 12, diamonds: 1600 },
      ];
    }
    if (shop.puzzleDailyReward == null) shop.puzzleDailyReward = 2;
    if (shop.referralReward == null) shop.referralReward = 20;
    if (shop.referralInviteeReward == null) shop.referralInviteeReward = 10;
    if (shop.analysisDailyFree == null) shop.analysisDailyFree = 3;
    if (!shop.tour) shop.tour = { prize1: 20, prize2: 15, prize3: 10, organizer: 10, organizerBig: 15, bigThreshold: 16, weeklyLimit: 1, dailyJoinLimit: 1 };
    const tnum = (key, max) => h('input.input.adm-num-in', {
      type: 'number', inputmode: 'numeric', value: String(shop.tour[key]), min: '0', max: String(max),
      oninput: (e) => { shop.tour[key] = Math.floor(Number(e.target.value) || 0); },
    });
    const num = (key, def, max) => h('input.input.adm-num-in', {
      type: 'number', inputmode: 'numeric', value: String(shop[key] ?? def), min: '0', max: String(max),
      oninput: (e) => { shop[key] = Math.floor(Number(e.target.value) || 0); },
    });
    const numRow = (label, input, unit) => h('div.sx-row', h('span.sx-lbl', label), h('span.sx-fld', input, unit ? h('small.sx-unit', unit) : null));
    const payIn = h('input.input', {
      value: shop.payUsername, maxlength: 64,
      oninput: (e) => { shop.payUsername = e.target.value.replace(/^@/, ''); },
    });
    const plansBox = h('div', ...(shop.premiumPlans || []).map((p) => numRow(
      p.months === 12 ? t('premium_plan_year') : t('premium_plan_months', { n: p.months }),
      h('input.input.adm-num-in', {
        type: 'number', inputmode: 'numeric', value: String(p.diamonds),
        oninput: (e) => { p.diamonds = Math.floor(Number(e.target.value) || 0); },
      }),
      '💎')));
    const packsBox = h('div');
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
      packsBox.replaceChildren(...packs.map((p, i) => h('div.sx-pack',
        h('div.admin-pack-order',
          h('button.adm-ic.sm', {
            type: 'button',
            disabled: i === 0,
            title: t('admin_pack_up'),
            onclick: () => movePack(i, -1),
          }, icon('chevronUp', 14)),
          h('button.adm-ic.sm', {
            type: 'button',
            disabled: i === packs.length - 1,
            title: t('admin_pack_down'),
            onclick: () => movePack(i, 1),
          }, icon('chevronDown', 14))),
        h('input.input.adm-num-in', {
          type: 'number', inputmode: 'numeric', value: String(p.diamonds),
          oninput: (e) => { p.diamonds = Math.floor(Number(e.target.value) || 0); },
        }),
        h('small.adm-unit', '💎 →'),
        h('input.input.grow', {
          type: 'number', inputmode: 'numeric', value: String(p.sum),
          oninput: (e) => { p.sum = Math.floor(Number(e.target.value) || 0); },
        }),
        h('small.adm-unit', "so'm"),
        icBtn('trash', t('remove'), () => { shop.diamondPacks.splice(i, 1); redrawPacks(); }, 'danger'),
      )));
    };
    redrawPacks();
    const save = async () => {
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
        const analysisDailyFree = Math.floor(Number(shop.analysisDailyFree) || 0);
        if (!(referralReward >= 0 && referralReward <= 1000000)
          || !(referralInviteeReward >= 0 && referralInviteeReward <= 1000000)) {
          toast(t('admin_referral_bad'), true); return;
        }
        if (!(analysisDailyFree >= 0 && analysisDailyFree <= 100)) {
          toast(t('admin_analysis_bad'), true); return;
        }
        shop.diamondPacks = packs;
        shop.puzzleDailyReward = puzzleDailyReward;
        shop.referralReward = referralReward;
        shop.referralInviteeReward = referralInviteeReward;
        shop.analysisDailyFree = analysisDailyFree;
        const r = await api('PATCH', '/admin/shop', {
          premiumPlans: shop.premiumPlans,
          diamondPacks: packs,
          payUsername: shop.payUsername,
          puzzleDailyReward,
          referralReward,
          referralInviteeReward,
          analysisDailyFree,
          tour: shop.tour,
        });
        shop = r.shop;
        toast(t('admin_shop_saved')); haptic('success');
        drawShop();
      } catch (e) { fail(e); }
    };
    const group = (title, ...kids) => h('div.sx-group', title ? h('div.sx-gt', title) : null, h('div.sx-card', ...kids.filter(Boolean)));
    const hint = (txt) => h('p.sx-hint', txt);
    const tabs = {
      premium: () => [
        group(t('admin_premium_plans'), plansBox),
        group(t('analyze_title'), numRow(t('admin_analysis_free'), num('analysisDailyFree', 3, 100), '/ ' + t('swiss_day_short'))),
        hint(t('admin_analysis_free_sub')),
      ],
      diamonds: () => [
        group(t('shop_packs'), packsBox,
          h('button.sx-add', {
            type: 'button',
            onclick: () => {
              if (!Array.isArray(shop.diamondPacks)) shop.diamondPacks = [];
              shop.diamondPacks.push({ diamonds: 100, sum: 100000 });
              redrawPacks();
            },
          }, icon('plus', 16), t('admin_add_pack'))),
        group(t('admin_pay_user'), h('div.sx-pad', payIn)),
      ],
      rewards: () => [
        group(t('admin_sec_rewards'), numRow(t('admin_puzzle_reward'), num('puzzleDailyReward', 2, 1000000), '💎')),
        hint(t('admin_puzzle_reward_sub')),
        group(t('admin_referral_rewards'),
          numRow(t('admin_referral_inviter'), num('referralReward', 20, 1000000), '💎'),
          numRow(t('admin_referral_invitee'), num('referralInviteeReward', 10, 1000000), '💎')),
        hint(t('admin_referral_sub')),
      ],
      tours: () => [
        group(t('swiss_prizes'),
          numRow('🥇 ' + t('admin_tour_prize1'), tnum('prize1', 1000000), '💎'),
          numRow('🥈 ' + t('admin_tour_prize2'), tnum('prize2', 1000000), '💎'),
          numRow('🥉 ' + t('admin_tour_prize3'), tnum('prize3', 1000000), '💎')),
        group(t('admin_tour_org_sec'),
          numRow(t('admin_tour_org'), tnum('organizer', 1000000), '💎'),
          numRow(t('admin_tour_org_big'), tnum('organizerBig', 1000000), '💎'),
          numRow(t('admin_tour_big_n'), tnum('bigThreshold', 64), '')),
        group(t('admin_tour_limits_sec'),
          numRow(t('admin_tour_weekly'), tnum('weeklyLimit', 50), '/ 7 ' + t('swiss_day_short')),
          numRow(t('admin_tour_daily'), tnum('dailyJoinLimit', 50), '/ ' + t('swiss_day_short'))),
        hint(t('admin_tour_hint')),
      ],
    };
    const tabBar = pillBar([
      ['premium', t('sx_t_premium')], ['diamonds', t('sx_t_diamonds')], ['rewards', t('sx_t_rewards')], ['tours', t('sx_t_tours')],
    ], shopTab, (v) => { shopTab = v; drawShop(); }, { className: 'seg sx-tabs' });
    shopHost.replaceChildren(
      h('p.muted.adm-lead', t('admin_shop_sub')),
      tabBar,
      ...tabs[shopTab](),
      h('div.sx-save', primaryBtn('check', t('save'), save)),
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
      h('input.input.adm-num-in', {
        type: 'number', min: String(min), max: String(max), step: '1',
        value: String(cfg[key] ?? ''),
        oninput: (e) => { cfg[key] = Math.floor(Number(e.target.value) || 0); },
      }));
    const fontSeg = (key, label) => field(label, chipSeg(fonts.map((f) => [f, f]), cfg[key] || fonts[0], (v) => { cfg[key] = v; }));
    const pieceSeg = (key, label) => field(label, chipSeg(pieces.map((p) => [p, p]), cfg[key] || pieces[0], (v) => { cfg[key] = v; }));
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
    const placeSeg = chipSeg([['1', '#1'], ['2', '#2'], ['3', '#3']], String(medalState.previewPlace || 1), (v) => {
      medalState.previewPlace = Number(v);
    });
    const yearRow = h('div.medal-year-row',
      icBtn('back', String(year - 1), () => { medalState.previewYear = year - 1; loadMedalsForYear(year - 1); }),
      h('b', String(year)),
      icBtn('chevron', String(year + 1), () => { medalState.previewYear = year + 1; loadMedalsForYear(year + 1); }));
    const monthChips = h('div.medal-months',
      (months.length ? months : Array.from({ length: 12 }, (_, i) => ({
        key: `${year}-${String(i + 1).padStart(2, '0')}`,
        short: String(i + 1).padStart(2, '0'),
      }))).map((m, i) => filterChip(m.key, monthNames[i] || m.short, curMonth === m.key, () => {
        medalState.previewMonth = m.key;
        loadMedals(m.key);
      })));
    const preview = h('div');
    if (medalState.previewUrl) {
      preview.append(h('img.medal-admin-preview', { src: medalState.previewUrl, alt: 'preview' }));
    }
    const list = cardList((medalState.medals || []).map((m) => h('div.adm-row',
      h('img.adm-medal-thumb', { src: m.url, alt: '' }),
      h('div.nx-row-tx', h('b', m.title), h('small', `${m.month} · #${m.place} · ${m.name || m.userId}`)))), '—');
    medalHost.replaceChildren(
      card(
        h('p.muted', t('admin_medals_sub')),
        field(t('admin_medals_bot'), botIn),
        field(t('admin_medals_title_tpl'), tplIn, h('p.muted.adm-hint', t('admin_medals_tpl_hint'))),
        field(t('ann_colors'), h('div.ann-colors',
          color('primary', 'Primary'), color('secondary', 'Secondary'),
          color('accent', 'Accent'), color('text', 'Text'), color('muted', 'Muted'))),
        h('div.label', t('admin_medals_pieces')),
        pieceSeg('pieceTop1', t('admin_medals_piece_1')),
        pieceSeg('pieceTop2', t('admin_medals_piece_2')),
        pieceSeg('pieceTop3', t('admin_medals_piece_3')),
        fontSeg('fontTitle', t('admin_medals_font_title')),
        fontSeg('fontFamily', t('admin_medals_font_body')),
        field(t('admin_medals_sizes'), h('div.medal-sizes',
          sizeIn('sizePlace', t('admin_medals_sz_place'), 12, 40),
          sizeIn('sizeName', t('admin_medals_sz_name'), 14, 40),
          sizeIn('sizeTitle', t('admin_medals_sz_title'), 12, 28),
          sizeIn('sizeBot', t('admin_medals_sz_bot'), 10, 24))),
        h('p.muted.adm-hint', t('admin_medals_pattern_hint')),
        field(t('admin_medals_pick_month'), yearRow, monthChips),
        field(t('admin_medals_preview_place'), placeSeg),
        ghostBtn('eye', t('admin_medals_preview'), async () => {
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
        }),
        preview,
        h('div.adm-save', primaryBtn('check', t('save'), async () => {
          try {
            const r = await api('PATCH', '/admin/medals/config', cfg);
            medalState.config = r.config;
            toast(t('admin_medals_saved')); haptic('success');
            drawMedals();
          } catch (e) { fail(e); }
        })),
        h('p.muted.adm-hint', t('admin_medals_auto_hint')),
        curMonth
          ? ghostBtn('trash', t('admin_medals_clear_month'), async () => {
            try {
              await api('DELETE', `/admin/medals/${encodeURIComponent(curMonth)}`);
              toast(t('admin_medals_cleared')); haptic('success');
              loadMedals(curMonth);
            } catch (e) { fail(e); }
          })
          : null),
      sectionHead(t('admin_medals')), list,
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
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadLive(); }, 10000);
    return [
      ...subTop(t('admin_sec_live'), close),
      liveHost,
      sectionHead(t('stats')), kpis,
      sectionHead(t('signups')), card(bars),
    ];
  }, { onClose: () => { clearInterval(timer); timer = null; } });

  const openAnnouncements = () => openScreen((close) => {
    loadAnnouncements();
    return [
      ...subTop(t('ann_title_section'), close),
      annCard,
      sectionHead(t('ann_list')), annList,
    ];
  });

  const openUsers = () => openScreen((close) => {
    loadUsers(search.value);
    return [
      ...subTop(t('users_list'), close),
      h('p.muted.adm-lead', t('admin_users_sub')),
      h('label.adm-search', icon('search', 18), search),
      usersBox,
    ];
  });

  const openShop = () => openScreen((close) => {
    loadShop();
    return [
      ...subTop(t('admin_sec_shop'), close),
      shopHost,
    ];
  });

  const openPromos = () => {
    const list = h('div');
    const codeIn = h('input.input', { placeholder: t('promo_code_ph'), maxlength: 32, autocomplete: 'off' });
    const amountIn = h('input.input', { type: 'number', inputmode: 'numeric', min: '1', value: '100', placeholder: '100' });
    const maxIn = h('input.input', { type: 'number', inputmode: 'numeric', min: '1', placeholder: t('promo_max_ph') });
    const endsIn = h('input.input', { type: 'datetime-local' });
    const noteIn = h('input.input', { placeholder: t('promo_note_ph'), maxlength: 120 });
    let rewardType = 'diamonds';
    const typeSeg = chipSeg([
      ['diamonds', t('promo_reward_diamonds')],
      ['premium_days', t('promo_reward_days')],
      ['premium_months', t('promo_reward_months')],
    ], 'diamonds', (v) => { rewardType = v; });

    const rewardLabel = (p) => {
      if (p.rewardType === 'diamonds') return t('promo_reward_n_diamonds', { n: p.rewardAmount });
      if (p.rewardType === 'premium_days') return t('promo_reward_n_days', { n: p.rewardAmount });
      return t('promo_reward_n_months', { n: p.rewardAmount });
    };

    async function loadPromos() {
      try {
        const r = await api('GET', '/admin/promos');
        if (!endsIn.value && r.nowTashkent) endsIn.value = tashkentDefault(r.nowTashkent, 7);
        const rows = r.promos || [];
        list.replaceChildren(cardList(rows.map((p) => h('div.adm-row' + (p.active ? '' : '.off'),
          h('div.nx-row-tx',
            h('b', p.code, p.active ? null : h('span.nx-chip-s', t('promo_inactive'))),
            h('small.wrap', `${rewardLabel(p)} · ${p.usedCount}${p.maxUses != null ? '/' + p.maxUses : ''} · ${t('ann_until')} ${String(p.endsAtTashkent || '').replace('T', ' ')}`),
            p.note ? h('small.wrap', p.note) : null),
          h('div.adm-row-act',
            h('button.nx-btn-o.sm', {
              type: 'button',
              onclick: async () => {
                try {
                  await api('PATCH', `/admin/promos/${p.id}`, { active: !p.active });
                  loadPromos();
                } catch (e) { fail(e); }
              },
            }, p.active ? t('promo_disable') : t('promo_enable')),
            icBtn('trash', t('remove'), async () => {
              if (!(await confirmSheet(t('promo_delete_confirm'), t('remove'), true))) return;
              try {
                await api('DELETE', `/admin/promos/${p.id}`);
                toast(t('promo_deleted'));
                loadPromos();
              } catch (e) { fail(e); }
            }, 'danger')))), t('promo_empty')));
      } catch (e) { fail(e); }
    }

    const createBtn = primaryBtn('plus', t('promo_create'), async () => {
      try {
        const payload = {
          code: codeIn.value.trim() || undefined,
          rewardType,
          rewardAmount: Math.floor(Number(amountIn.value)),
          maxUses: maxIn.value === '' ? null : Math.floor(Number(maxIn.value)),
          endsAtTashkent: endsIn.value,
          note: noteIn.value.trim(),
        };
        const r = await api('POST', '/admin/promos', payload);
        toast(t('promo_created', { code: r.promo.code }));
        haptic('success');
        codeIn.value = '';
        noteIn.value = '';
        loadPromos();
      } catch (e) { fail(e); }
    });

    openScreen((close) => {
      loadPromos();
      return [
        ...subTop(t('promo_admin_title'), close),
        h('p.muted.adm-lead', t('promo_admin_hint')),
        card(
          field(t('promo_code'), codeIn),
          field(t('promo_reward'), typeSeg),
          h('div.adm-grid2',
            field(t('promo_amount'), amountIn),
            field(t('promo_max'), maxIn)),
          field(t('promo_ends') + ' · Tashkent (UTC+5)', endsIn),
          field(t('promo_note'), noteIn),
          h('div.adm-save', createBtn)),
        sectionHead(t('promo_list')),
        list,
      ];
    });
  };

  const openBroadcast = () => openScreen((close) => {
    drawMedia(); drawButtons(); drawPreview(); loadHistory();
    return [
      ...subTop(t('composer'), close),
      card(
        text,
        mediaBox, file,
        field(t('buttons') + ' · ' + t('up_to'), btnBox),
        field(t('audience'), audience),
        field(t('preview'), preview),
        h('div.adm-actions', sendTest, sendAll)),
      sectionHead(t('history')), histBox,
    ];
  });

  const msgStatsHost = h('div');
  const loadMessageStats = async () => {
    try {
      const r = await api('GET', '/admin/message-stats');
      const tg = r.telegram || {};
      const app = r.inApp || {};
      const n = (v) => v ?? 0;
      const period = (rows) => h('div.nx-card-list', ...rows.map(([label, value]) => h('div.adm-row', h('div.nx-row-tx', h('b', label), h('small.wrap', value)))));
      msgStatsHost.replaceChildren(
        sectionHead(t('msg_stats_tg'), null, null, { sub: t('msg_stats_tg_sub') }),
        h('div.nx-stats.adm-stats2',
          statCard('send', t('msg_stats_campaigns'), n(tg.campaigns), 'blue'),
          statCard('check', t('msg_stats_sent'), n(tg.sent), 'green'),
          statCard('x', t('msg_stats_failed'), n(tg.failed), 'gold'),
          statCard('users', t('msg_stats_targeted'), n(tg.targeted), 'blue')),
        period([
          [t('msg_stats_7d'), t('msg_stats_period', { c: tg.last7d?.campaigns || 0, s: tg.last7d?.sent || 0, f: tg.last7d?.failed || 0 })],
          [t('msg_stats_30d'), t('msg_stats_period', { c: tg.last30d?.campaigns || 0, s: tg.last30d?.sent || 0, f: tg.last30d?.failed || 0 })],
        ]),
        sectionHead(t('msg_stats_tg_recent')),
        cardList((tg.recent || []).map((b) => listRow((b.text || '📎').slice(0, 80), broadcastSub(b))), t('msg_stats_empty')),
        sectionHead(t('msg_stats_app'), null, null, { sub: t('msg_stats_app_sub') }),
        h('div.nx-stats.adm-stats2',
          statCard('bell', t('msg_stats_campaigns'), n(app.campaigns), 'blue'),
          statCard('send', t('msg_stats_sent'), n(app.sent), 'green'),
          statCard('eye', t('msg_stats_read'), n(app.read), 'gold'),
          statCard('mail', t('msg_stats_unread'), n(app.unreadActive), 'blue')),
        period([
          [t('msg_stats_7d'), t('msg_stats_app_period', { c: app.last7d?.campaigns || 0, s: app.last7d?.sent || 0 })],
          [t('msg_stats_30d'), t('msg_stats_app_period', { c: app.last30d?.campaigns || 0, s: app.last30d?.sent || 0 })],
        ]),
        sectionHead(t('msg_stats_app_recent')),
        cardList((app.recent || []).map((c) => listRow(c.title, [
          (c.body || '').slice(0, 80),
          t('msg_stats_app_row', {
            n: c.sentCount || 0,
            r: c.readCount || 0,
            ttl: c.permanent ? t('admin_notif_ttl_permanent') : (c.expiresAt ? new Date(c.expiresAt).toLocaleString() : '—'),
          }),
        ])), t('msg_stats_empty')),
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
        const d = await uploadMedia(f);
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
        h('button.nx-btn-o.sm', {
          type: 'button',
          onclick: () => {
            welcomeForm.mediaId = null; welcomeForm.mediaPreview = null; welcomeForm.mediaIsVideo = false;
            drawWelcomeMedia(); drawWelcomePreview();
          },
        }, icon('x', 14), t('remove')),
      );
    } else {
      welcomeMediaBox.append(h('button.nx-btn-o.sm', { type: 'button', onclick: () => welcomeFile.click() }, icon('image', 16), t('add_media')));
    }
  }

  function drawWelcomeButtons() {
    buttonEditor(welcomeBtnBox, welcomeForm.buttons, (full) => { if (full) drawWelcomeButtons(); drawWelcomePreview(); });
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
    const langSeg = chipSeg(LANGS.map((l) => [l, LANG_NAMES[l]]), welcomeLang, (v) => { applyWelcomeLang(v); });
    const saveBtn = primaryBtn('check', t('save'), async () => {
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
    });
    const testBtn = ghostBtn('send', t('send_test'), async () => {
      try {
        await api('POST', '/admin/welcome/test', { lang: welcomeLang });
        toast(t('test_sent')); haptic('success');
      } catch (e) { fail(e); }
    });
    welcomeHost.replaceChildren(
      h('p.muted.adm-lead', t('welcome_sub')),
      card(
        field(t('language'), langSeg),
        field(t('welcome_text'), welcomeText),
        field(t('ann_media'), welcomeMediaBox, welcomeFile),
        field(t('buttons'), welcomeBtnBox),
        field(t('preview'), welcomePreview),
        h('div.adm-actions', testBtn, saveBtn)),
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
    const langSeg = chipSeg(LANGS.map((l) => [l, LANG_NAMES[l]]), bootLang, (v) => { applyBootLang(v); });
    const animSeg = chipSeg(
      bootAnims.map((a) => [a, t('boot_anim_' + a)]),
      bootCfg.animation || 'orbit',
      (v) => { bootCfg.animation = v; drawBootPreview(); },
    );
    const saveBtn = primaryBtn('check', t('save'), async () => {
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
    });
    bootHost.replaceChildren(
      h('p.muted.adm-lead', t('boot_sub')),
      card(
        field(t('language'), langSeg),
        field(t('boot_title'), bootTitle),
        field(t('boot_subtitle'), bootSub),
        field(t('boot_animation'), animSeg),
        field(t('preview'), bootPreview),
        h('div.adm-save', saveBtn)),
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
        const d = await uploadMedia(f);
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
      h('p.muted.adm-lead', t('admin_banner_sub')),
      card(
        h('div.admin-banner-preview', { style: { backgroundImage: `url("${url}")` } }),
        h('div.adm-actions',
          custom ? ghostBtn(null, t('admin_banner_default'), async () => {
            try {
              const saved = await api('PATCH', '/admin/profile-banner', { mediaId: null });
              toast(t('admin_banner_reset')); haptic('success');
              drawBanner(saved);
            } catch (err) { fail(err); }
          }) : null,
          primaryBtn('image', t('admin_banner_upload'), () => bannerFile.click()))),
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
    const listBox = h('div');
    const mediaBox = h('div.admin-notif-media');
    const actionBtn = h('button.nx-btn-p.adm-btn', { type: 'button' });
    const cancelEditBtn = h('button.nx-btn-o.adm-btn', {
      type: 'button',
      hidden: true,
      onclick: () => resetForm(),
    }, t('cancel'));
    const file = h('input', {
      type: 'file', accept: 'image/jpeg,image/png,image/gif', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        toast(t('uploading'));
        try {
          const d = await uploadMedia(f);
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
          ? h('div.nx-card-list', listRow(t('admin_notif_media_ok'), mediaId.slice(0, 8) + '…',
            icBtn('x', t('remove'), () => { mediaId = null; drawMedia(); }, 'danger')))
          : h('button.nx-btn-o.sm', {
            type: 'button',
            onclick: () => file.click(),
          }, icon('image', 16), t('admin_notif_media')),
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
      cancelEditBtn.hidden = !editingId;
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
    const beginEdit = (c) => {
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
    };
    const loadList = async () => {
      try {
        const r = await api('GET', '/admin/notifications');
        const campaigns = r.campaigns || [];
        listBox.replaceChildren(cardList(campaigns.map((c) => listRow(
          c.title,
          [c.body, t('admin_notif_meta', { n: c.sentCount || 0, ttl: ttlLabel(c) })],
          icBtn('pencil', t('ann_edit'), () => beginEdit(c)),
          icBtn('trash', t('remove'), async () => {
            if (!(await confirmSheet(t('admin_notif_delete_confirm'), t('admin_notif_delete'), true))) return;
            try {
              await api('DELETE', `/admin/notifications/${c.id}`);
              toast(t('admin_notif_deleted'));
              haptic('success');
              if (editingId === c.id) resetForm();
              loadList();
            } catch (e) { fail(e); }
          }, 'danger'))), t('admin_notif_list_empty')));
      } catch (e) { fail(e); }
    };
    drawMedia();
    drawTtl();
    drawAction();
    loadList();
    return [
      ...subTop(t('admin_notif'), close),
      h('p.muted.adm-lead', t('admin_notif_sub')),
      card(
        field(t('admin_notif_title'), title),
        field(t('admin_notif_body'), body),
        field(t('admin_notif_ttl'), ttlSelect),
        field(t('admin_notif_media'), mediaBox),
        h('div.adm-actions', cancelEditBtn, actionBtn)),
      sectionHead(t('admin_notif_list')),
      listBox,
    ];
  });

  // ----- hub -----
  const hubStats = h('div.nx-stats.adm-hub-stats');
  const drawHubStats = (st) => {
    const v = (x) => (st ? (x ?? 0) : '—');
    hubStats.replaceChildren(
      statCard('users', t('k_users'), v(st && st.users), 'blue', openUsers),
      statCard('live', t('stat_online'), v(st && st.live), 'green', openLive),
      statCard('gamepad', t('k_games_live'), v(st && st.gamesLive), 'gold', openLive),
      statCard('userPlus', t('k_new'), v(st && st.newToday), 'green', openLive),
      statCard('chart', t('k_active'), v(st && st.active7d), 'blue', openLive),
      statCard('trophy', t('k_games_played'), v(st && st.gamesPlayed), 'gold', openLive));
  };
  let hubCache = null;
  const loadHubStats = async () => {
    try {
      hubCache = await api('GET', '/admin/stats');
      drawHubStats(hubCache);
    } catch (e) { if (e.code !== 'net') fail(e); }
  };

  openScreen((close) => {
    drawHubStats(hubCache);
    loadHubStats();
    return [
      ...subTop(t('admin_title'), close),
      h('p.muted.adm-lead', t('admin_hub_sub')),
      hubStats,
      sectionHead(t('admin_sec_overview')),
      menuCard(
        menuRow({ ic: 'live', tone: 'ok', title: t('admin_sec_live'), sub: t('admin_sec_live_sub'), onClick: openLive }),
        menuRow({ ic: 'chart', title: t('msg_stats_title'), sub: t('msg_stats_menu_sub'), onClick: openMessageStats }),
      ),
      sectionHead(t('admin_sec_economy')),
      menuCard(
        menuRow({ ic: 'users', title: t('users_list'), sub: t('admin_users_sub'), onClick: openUsers }),
        menuRow({ ic: 'gem', title: t('admin_sec_shop'), sub: t('admin_shop_sub'), onClick: openShop }),
        menuRow({ ic: 'sparkles', title: t('promo_admin_title'), sub: t('promo_admin_sub'), onClick: openPromos }),
      ),
      sectionHead(t('admin_sec_messages')),
      menuCard(
        menuRow({ ic: 'send', title: t('composer'), sub: t('admin_sec_broadcast_sub'), onClick: openBroadcast }),
        menuRow({ ic: 'bell', title: t('admin_notif'), sub: t('admin_notif_menu_sub'), onClick: openInAppNotif }),
        menuRow({ ic: 'chat', title: t('welcome_title'), sub: t('welcome_menu_sub'), onClick: openWelcome }),
      ),
      sectionHead(t('admin_sec_content')),
      menuCard(
        menuRow({ ic: 'image', title: t('ann_title_section'), sub: t('admin_sec_ann_sub'), onClick: openAnnouncements }),
        menuRow({ ic: 'profile', title: t('admin_banner'), sub: t('admin_banner_menu_sub'), onClick: openBanner }),
        menuRow({ ic: 'cpu', title: t('boot_title_section'), sub: t('boot_menu_sub'), onClick: openBootSplash }),
        menuRow({ ic: 'trophy', title: t('admin_medals'), sub: t('admin_medals_sub'), onClick: openMedals }),
      ),
    ];
  }, {
    onClose: () => {
      clearInterval(timer); timer = null;
      onClose && onClose();
    },
  });
}
