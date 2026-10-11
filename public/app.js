(() => {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // ---------- tiny DOM helper (user text always goes through textContent) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // only ever used with our own static SVG
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const svg = (d, size = 22, sw = 1.9) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    home: svg('<path d="M4 11.5 12 4l8 7.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>'),
    wallet: svg('<path d="M4 7a2 2 0 0 1 2-2h11v4"/><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor"/>'),
    repeat: svg('<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
    user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>'),
    bell: svg('<path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>'),
    pen: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>', 24),
    tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/>', 24),
    cal2: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>', 24),
    left: svg('<path d="M15 5l-7 7 7 7"/>', 20, 2.2),
    right: svg('<path d="M9 5l7 7-7 7"/>', 20, 2.2),
    shield: svg('<path d="M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>', 22),
  };

  const CAT_COLOR = {
    food: '#fb923c', transport: '#38bdf8', shopping: '#c084fc', bills: '#facc15',
    health: '#4ade80', fun: '#f472b6', other: '#94a3b8',
  };
  const catColor = (c) => CAT_COLOR[c] || CAT_COLOR.other;

  // ---------- state ----------
  const state = { me: null, meta: null, unread: 0 };
  let index = 0;
  const TABS = [
    { id: 'home', label: 'Home', icon: ICON.home },
    { id: 'expenses', label: 'Expenses', icon: ICON.wallet },
    { id: 'subs', label: 'Subs', icon: ICON.repeat },
    { id: 'calendar', label: 'Calendar', icon: ICON.calendar },
    { id: 'profile', label: 'Profile', icon: ICON.user },
  ];

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Init-Data': (tg && tg.initData) || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401) showGate();
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  // ---------- formatting ----------
  const money = (n) => {
    const cur = state.me ? state.me.currency : 'EUR';
    const v = n || 0;
    const whole = cur === 'UZS' || Number.isInteger(v);
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2,
    }).format(v);
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayISO = () => iso(new Date());
  const ymOf = (d) => d.slice(0, 7);
  const shiftMonth = (ym, n) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return iso(d).slice(0, 7);
  };
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const niceDate = (d) => {
    const t = todayISO();
    if (d === t) return 'Today';
    const diff = dayDiff(t, d);
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const inDays = (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? `${-n}d ago` : `in ${n} days`);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function countUp(el, to, format = money) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(to); return; }
    const t0 = performance.now();
    const dur = 700;
    const step = (t) => {
      const p = clamp((t - t0) / dur, 0, 1);
      el.textContent = format(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- feedback ----------
  const haptic = {
    tap: () => tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'),
    select: () => tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(),
    ok: () => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'),
    err: () => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'),
  };
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
    isErr ? haptic.err() : haptic.ok();
  }
  const fail = (e) => toast(e.message || 'Something went wrong', true);

  function confirmDialog(text) {
    return new Promise((resolve) => {
      if (tg && tg.showConfirm) tg.showConfirm(text, (ok) => resolve(!!ok));
      else resolve(window.confirm(text));
    });
  }

  function showGate() {
    $('#app').hidden = true;
    $('#gate').hidden = false;
  }

  // ---------- reusable UI ----------
  function seg(options, value, onChange) {
    const el = h('div', { class: 'seg' });
    const ind = h('i');
    ind.style.width = `calc((100% - 8px) / ${options.length})`;
    el.append(ind);
    const btns = options.map((o) => {
      const b = h('button', { type: 'button', onclick: () => set(o.v, true) }, o.label);
      el.append(b);
      return b;
    });
    function set(v, fire) {
      const i = Math.max(0, options.findIndex((o) => o.v === v));
      ind.style.transform = `translateX(${i * 100}%)`;
      btns.forEach((b, j) => b.classList.toggle('on', j === i));
      if (fire) { haptic.select(); onChange(v); }
    }
    set(value, false);
    return el;
  }

  function chips(options, value, onChange) {
    const wrap = h('div', { class: 'chips' });
    options.forEach((o) => {
      const c = h('button', { type: 'button', class: 'chip' + (o === value ? ' on' : ''), onclick: () => {
        wrap.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        c.classList.add('on'); haptic.select(); onChange(o);
      } }, o);
      wrap.append(c);
    });
    return wrap;
  }

  function toggle(on, onChange) {
    const s = h('button', { type: 'button', class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) });
    s.addEventListener('click', () => {
      const next = !s.classList.contains('on');
      s.classList.toggle('on', next);
      s.setAttribute('aria-checked', String(next));
      haptic.select(); onChange(next);
    });
    return s;
  }

  /** Draggable range slider: knob follows the finger continuously, then glides to the nearest step on release. */
  function slider({ min, max, value, format, onCommit }) {
    const labelVal = h('span', { class: 'slider-value' }, format(value));
    const rail = h('div', { class: 'rail' });
    const fill = h('div', { class: 'fill' });
    const knob = h('div', { class: 'knob' });
    const el = h('div', { class: 'slider smooth', 'data-noswipe': true }, rail, fill, knob);
    const pos = (v) => ((v - min) / (max - min)) * 100;
    let cur = value;
    const draw = (pct) => { fill.style.width = pct + '%'; knob.style.left = pct + '%'; };
    draw(pos(cur));
    let dragging = false;

    const fromEvent = (e) => {
      const r = el.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    const move = (e) => {
      const p = fromEvent(e);
      draw(p * 100);
      const v = Math.round(min + p * (max - min));
      if (v !== cur) { cur = v; labelVal.textContent = format(v); haptic.select(); }
    };
    el.addEventListener('pointerdown', (e) => {
      dragging = true; el.setPointerCapture(e.pointerId);
      el.classList.add('active'); el.classList.remove('smooth'); move(e);
    });
    el.addEventListener('pointermove', (e) => { if (dragging) move(e); });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('active'); el.classList.add('smooth');
      draw(pos(cur)); onCommit(cur);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    const labels = h('div', { class: 'slider-labels' }, h('span', {}, format(min)), h('span', {}, format(max)));
    return { el: h('div', {}, el, labels), label: labelVal };
  }

  // ---------- bottom sheet ----------
  let closeCurrentSheet = null;
  function openSheet(title, build) {
    if (closeCurrentSheet) closeCurrentSheet(true);
    const root = $('#sheet-root');
    const backdrop = h('div', { class: 'backdrop' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const grab = h('div', { class: 'grab' });
    const body = h('div');
    sheet.append(grab, h('h2', {}, title), body);
    root.append(backdrop, sheet);

    let closed = false;
    function close(instant) {
      if (closed) return;
      closed = true; closeCurrentSheet = null;
      backdrop.classList.remove('show'); sheet.classList.remove('show');
      setTimeout(() => { backdrop.remove(); sheet.remove(); }, instant ? 0 : 520);
    }
    closeCurrentSheet = close;
    backdrop.addEventListener('click', () => close());

    // drag the handle down to dismiss
    let sy = null;
    grab.style.padding = '10px 0'; grab.style.touchAction = 'none';
    grab.addEventListener('pointerdown', (e) => { sy = e.clientY; grab.setPointerCapture(e.pointerId); sheet.classList.add('drag'); });
    grab.addEventListener('pointermove', (e) => { if (sy != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - sy)}px)`; });
    const release = (e) => {
      if (sy == null) return;
      const dy = e.clientY - sy; sy = null; sheet.classList.remove('drag'); sheet.style.transform = '';
      if (dy > 90) close();
    };
    grab.addEventListener('pointerup', release);
    grab.addEventListener('pointercancel', release);

    build(body, close);
    requestAnimationFrame(() => requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); }));
    return close;
  }

  // ---------- pages ----------
  const pageEl = (id) => $(`.page[data-page="${id}"]`);
  const skeleton = () => [h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })];

  function setPage(id, ...nodes) {
    const el = pageEl(id);
    el.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
    el.classList.add('seen');
  }

  function header(title, right) {
    return h('div', { class: 'top' }, h('h1', {}, title), right || h('span'));
  }

  function tile(label, icon, onclick, hero) {
    return h('button', { class: 'tile' + (hero ? ' hero' : ''), onclick: () => { haptic.tap(); onclick(); } },
      h('b', {}, label), h('span', { html: icon }));
  }

  function emptyState(text) { return h('div', { class: 'empty' }, text); }

  // ----- Home -----
  async function renderHome() {
    const page = pageEl('home');
    if (!page.classList.contains('seen')) page.replaceChildren(...skeleton());
    const s = await api('GET', '/summary');

    const bell = h('button', { class: 'round', 'aria-label': 'Notifications', onclick: openNotifications },
      h('span', { html: ICON.bell }),
      state.unread > 0 && h('span', { class: 'badge' }, state.unread > 9 ? '9+' : state.unread));

    const monthVal = h('div', { class: 'stat-value' }, money(0));
    const delta = s.prevMonth > 0 ? ((s.month - s.prevMonth) / s.prevMonth) * 100 : null;
    const max = Math.max(...s.last7.map((d) => d.total), 1);
    const spark = h('div', { class: 'spark' }, s.last7.map((d, i) => {
      const b = h('i', { title: `${d.date}: ${money(d.total)}`, class: i === 6 ? 'on' : '' });
      b.style.height = `${Math.max(8, (d.total / max) * 100)}%`;
      b.style.animationDelay = `${i * 40}ms`;
      return b;
    }));

    const overview = h('div', { class: 'card' },
      h('div', { class: 'stat-label' }, 'Spent this month'),
      monthVal,
      h('div', { class: 'stat-sub' },
        delta === null ? 'No data for last month yet' : [
          h('span', { class: 'delta ' + (delta > 0 ? 'up' : 'down') }, `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`),
          ' vs last month',
        ]),
      spark);
    countUp(monthVal, s.month);

    const subsVal = h('div', { class: 'stat-value' }, money(0));
    const subsCard = h('div', { class: 'card' },
      h('div', { class: 'stat-label' }, 'Subscriptions / month'),
      subsVal,
      h('div', { class: 'stat-sub' }, `${s.subsCount} active`));
    countUp(subsVal, s.subsMonthly);

    const upcoming = s.upcoming.length
      ? h('div', { class: 'list' }, s.upcoming.map((u) =>
        h('button', { class: 'row', onclick: () => gotoTab(2) },
          h('div', { class: 'avatar' }, u.name.charAt(0).toUpperCase()),
          h('div', { class: 'grow' }, h('div', { class: 't' }, u.name), h('div', { class: 's' }, niceDate(u.date))),
          h('div', { class: 'amt' }, money(u.amount), h('small', {}, inDays(u.days))))))
      : emptyState('No subscriptions yet.\nTap + to add your first one.');

    const maxCat = Math.max(...s.byCategory.map((c) => c.total), 1);
    const cats = s.byCategory.length
      ? h('div', { class: 'card' }, h('div', { class: 'bars' }, s.byCategory.map((c) => {
        const fill = h('div', { class: 'bar-fill' });
        fill.style.width = `${(c.total / maxCat) * 100}%`;
        fill.style.background = catColor(c.category);
        return h('div', { class: 'bar-row' },
          h('div', { class: 'bar-head' }, h('span', {}, cap(c.category)), h('span', {}, money(c.total))),
          h('div', { class: 'bar-track' }, fill));
      })))
      : null;

    setPage('home',
      header('Home', bell),
      tile('Add expense', ICON.pen, () => openAdd('expense'), true),
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        tile('Subscription', ICON.tag, () => openAdd('sub')),
        tile('Calendar', ICON.cal2, () => gotoTab(3))),
      h('h2', { class: 'h2' }, 'Overview'),
      h('div', { class: 'stack' }, overview, subsCard),
      h('h2', { class: 'h2' }, 'Upcoming renewals'),
      upcoming,
      cats && [h('h2', { class: 'h2' }, 'By category'), cats]);
  }

  // ----- Expenses -----
  let expMonth = ymOf(todayISO());
  async function renderExpenses(dir = 0) {
    const page = pageEl('expenses');
    if (!page.classList.contains('seen')) page.replaceChildren(...skeleton());
    const { expenses } = await api('GET', `/expenses?month=${expMonth}`);
    const total = expenses.reduce((a, e) => a + e.amount, 0);

    const bar = h('div', { class: 'monthbar' },
      h('button', { class: 'round', 'aria-label': 'Previous month', onclick: () => { expMonth = shiftMonth(expMonth, -1); renderExpenses(-1).catch(fail); }, html: ICON.left }),
      h('div', { class: 'label' }, monthLabel(expMonth)),
      h('button', { class: 'round', 'aria-label': 'Next month', onclick: () => { expMonth = shiftMonth(expMonth, 1); renderExpenses(1).catch(fail); }, html: ICON.right }));

    const totalVal = h('div', { class: 'stat-value' }, money(0));
    const sum = h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Total'), totalVal,
      h('div', { class: 'stat-sub' }, `${expenses.length} ${expenses.length === 1 ? 'expense' : 'expenses'}`));
    countUp(totalVal, total);

    const groups = [];
    let last = null;
    for (const e of expenses) {
      if (e.date !== last) { groups.push({ date: e.date, items: [], sum: 0 }); last = e.date; }
      const g = groups[groups.length - 1]; g.items.push(e); g.sum += e.amount;
    }
    const body = h('div', { class: 'cal-body' });
    body.style.setProperty('--shift', `${dir * 24}px`);
    if (!dir) body.style.animation = 'none';
    if (!groups.length) body.append(emptyState('Nothing here yet.\nTap + to log an expense.'));
    groups.forEach((g) => {
      body.append(h('div', { class: 'day-head' }, h('span', {}, niceDate(g.date)), h('span', {}, money(g.sum))));
      body.append(h('div', { class: 'list' }, g.items.map(expenseRow)));
    });

    setPage('expenses', header('Expenses'), bar, sum, body);
  }

  function expenseRow(e) {
    const c = catColor(e.category);
    const av = h('div', { class: 'avatar' }, cap(e.category).charAt(0));
    av.style.background = c + '26'; av.style.color = c;
    return h('button', { class: 'row', onclick: () => openExpenseDetail(e) }, av,
      h('div', { class: 'grow' }, h('div', { class: 't' }, e.note || cap(e.category)), h('div', { class: 's' }, cap(e.category))),
      h('div', { class: 'amt' }, money(e.amount)));
  }

  function openExpenseDetail(e) {
    openSheet(money(e.amount), (body, close) => {
      body.append(
        h('div', { class: 'stack' },
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 's' }, 'Category'), h('div', { class: 't' }, cap(e.category)))),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 's' }, 'Date'), h('div', { class: 't' }, niceDate(e.date)))),
          e.note && h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 's' }, 'Note'), h('div', { class: 't', style: 'white-space:normal' }, e.note)))),
        h('button', { class: 'btn danger', onclick: async () => {
          try { await api('DELETE', `/expenses/${e.id}`); close(); toast('Expense deleted'); refreshAll(); } catch (er) { fail(er); }
        } }, 'Delete expense'));
    });
  }

  // ----- Subscriptions -----
  async function renderSubs() {
    const page = pageEl('subs');
    if (!page.classList.contains('seen')) page.replaceChildren(...skeleton());
    const { subscriptions } = await api('GET', '/subscriptions');
    const monthly = subscriptions.filter((s) => s.active).reduce((a, s) => a + (s.period === 'weekly' ? (s.amount * 52) / 12 : s.period === 'yearly' ? s.amount / 12 : s.amount), 0);

    const val = h('div', { class: 'stat-value' }, money(0));
    const sum = h('div', { class: 'card' }, h('div', { class: 'stat-label' }, 'Per month'), val,
      h('div', { class: 'stat-sub' }, `${money(monthly * 12)} per year`));
    countUp(val, monthly);

    const today = todayISO();
    const list = subscriptions.length
      ? h('div', { class: 'list', style: 'margin-top:10px' }, subscriptions.map((s) => {
        const d = dayDiff(today, s.next_date);
        const soon = s.active && d <= 3;
        return h('button', { class: 'row' + (s.active ? '' : ' off'), onclick: () => openAdd('sub', s) },
          h('div', { class: 'avatar' }, s.name.charAt(0).toUpperCase()),
          h('div', { class: 'grow' }, h('div', { class: 't' }, s.name),
            h('div', { class: 's' }, s.active ? [niceDate(s.next_date), ' · ', soon ? h('span', { class: 'pill warn' }, inDays(d)) : inDays(d)] : 'Paused')),
          h('div', { class: 'amt' }, money(s.amount), h('small', {}, s.period)));
      }))
      : emptyState('No subscriptions yet.\nTap + to track Netflix, Spotify, rent…');

    setPage('subs', header('Subscriptions'), sum, list);
  }

  // ----- Calendar -----
  let calMonth = ymOf(todayISO());
  let calSel = todayISO();
  let calCache = null; // { month, data } so tapping days doesn't refetch
  async function renderCalendar(dir = 0) {
    const page = pageEl('calendar');
    if (!page.classList.contains('seen')) page.replaceChildren(...skeleton());
    if (!calCache || calCache.month !== calMonth || dir === 0 && !page.classList.contains('seen')) {
      calCache = { month: calMonth, data: await api('GET', `/calendar?month=${calMonth}`) };
    }
    const data = calCache.data;
    const [y, m] = calMonth.split('-').map(Number);
    const first = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
    const dim = new Date(y, m, 0).getDate();
    const today = todayISO();

    const exp = {}; const ren = {};
    data.expenses.forEach((e) => { (exp[e.date] = exp[e.date] || []).push(e); });
    data.renewals.forEach((r) => { (ren[r.date] = ren[r.date] || []).push(r); });

    if (!calSel.startsWith(calMonth)) calSel = calMonth === ymOf(today) ? today : `${calMonth}-01`;

    const grid = h('div', { class: 'cal-grid' });
    for (let i = 0; i < first; i++) grid.append(h('span'));
    for (let d = 1; d <= dim; d++) {
      const date = `${calMonth}-${String(d).padStart(2, '0')}`;
      const cell = h('button', { class: 'day' + (date === today ? ' today' : '') + (date === calSel ? ' sel' : ''), onclick: () => { calSel = date; haptic.select(); renderCalendar().catch(fail); } }, String(d),
        (exp[date] || ren[date]) && h('span', { class: 'dots' }, exp[date] && h('i'), ren[date] && h('i', { class: 'sub' })));
      grid.append(cell);
    }
    const calBody = h('div', { class: 'cal-body' }, grid);
    calBody.style.setProperty('--shift', `${dir * 24}px`);
    if (!dir) calBody.style.animation = 'none'; // only animate when the month changes

    const bar = h('div', { class: 'monthbar' },
      h('button', { class: 'round', 'aria-label': 'Previous month', onclick: () => { calMonth = shiftMonth(calMonth, -1); renderCalendar(-1).catch(fail); }, html: ICON.left }),
      h('div', { class: 'label' }, monthLabel(calMonth)),
      h('button', { class: 'round', 'aria-label': 'Next month', onclick: () => { calMonth = shiftMonth(calMonth, 1); renderCalendar(1).catch(fail); }, html: ICON.right }));

    const cal = h('div', { class: 'cal' },
      h('div', { class: 'cal-head' }, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => h('span', {}, d))), calBody);

    const dayItems = [];
    (ren[calSel] || []).forEach((r) => dayItems.push(
      h('div', { class: 'row' }, h('div', { class: 'avatar', style: 'background:rgba(251,191,36,.16);color:var(--amber)' }, r.name.charAt(0).toUpperCase()),
        h('div', { class: 'grow' }, h('div', { class: 't' }, r.name), h('div', { class: 's' }, `Renewal · ${r.period}`)),
        h('div', { class: 'amt' }, money(r.amount)))));
    (exp[calSel] || []).forEach((e) => dayItems.push(expenseRow(e)));

    setPage('calendar', header('Calendar'), bar, cal,
      h('div', { class: 'legend' }, h('span', {}, h('i'), 'Expense'), h('span', {}, h('i', { class: 'sub' }), 'Renewal')),
      h('div', { class: 'day-head' }, h('span', {}, niceDate(calSel))),
      dayItems.length ? h('div', { class: 'list' }, dayItems) : emptyState('Nothing on this day.'));
  }

  // ----- Profile -----
  async function renderProfile() {
    const u = state.me;
    const name = u.firstName || 'You';
    const saveSettings = async (patch) => {
      try {
        const { user } = await api('PATCH', '/me', patch);
        state.me = user; haptic.ok();
        if ('currency' in patch) refreshAll();
      } catch (e) { fail(e); }
    };

    const currency = seg(state.meta.CURRENCIES.map((c) => ({ v: c, label: c })), u.currency, (v) => saveSettings({ currency: v }));
    currency.style.cssText = 'overflow-x:auto';

    const daysFmt = (v) => (v === 0 ? 'Same day' : `${v} ${v === 1 ? 'day' : 'days'}`);
    const sl = slider({ min: 0, max: 14, value: u.notifyDays, format: daysFmt, onCommit: (v) => saveSettings({ notifyDays: v }) });

    const settings = h('div', { class: 'card' },
      h('div', { class: 'setting' }, h('div', {}, h('b', {}, 'Reminders'), h('small', {}, 'Get a Telegram message before renewals')),
        toggle(u.notifyEnabled, (v) => saveSettings({ notifyEnabled: v }))),
      h('div', { style: 'padding:14px 0;border-top:1px solid var(--line)' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('b', {}, 'Remind me'), sl.label),
        sl.el),
      h('div', { style: 'padding:14px 0 4px;border-top:1px solid var(--line)' }, h('b', {}, 'Currency'), h('div', { style: 'margin-top:10px' }, currency)));

    setPage('profile',
      header('Profile'),
      h('div', { class: 'me' },
        h('div', { class: 'big' }, name.charAt(0).toUpperCase()),
        h('div', {}, h('h2', {}, name), h('div', { class: 'muted' }, u.username ? '@' + u.username : `ID ${u.id}`))),
      settings,
      u.isAdmin && h('button', { class: 'tile', style: 'margin-top:10px;width:100%', onclick: () => { haptic.tap(); openAdmin(); } },
        h('b', {}, 'Admin panel'), h('span', { html: ICON.shield })),
      h('button', { class: 'btn danger', style: 'margin-top:14px', onclick: async () => {
        if (u.isAdmin) return toast('Admins cannot delete their account here', true);
        if (!(await confirmDialog('Delete your account and all your data? This cannot be undone.'))) return;
        try { await api('DELETE', '/me'); toast('Your data was deleted'); setTimeout(() => tg && tg.close(), 800); } catch (e) { fail(e); }
      } }, 'Delete my data'));
  }

  // ---------- add / edit sheet ----------
  function openAdd(kind = 'expense', editing = null) {
    const cats = state.meta.CATEGORIES;
    const form = editing
      ? { amount: String(editing.amount), name: editing.name, category: editing.category, period: editing.period, date: editing.next_date }
      : { amount: '', note: '', name: '', category: 'food', period: 'monthly', date: todayISO() };
    let mode = kind;

    openSheet(editing ? 'Edit subscription' : 'Add', (body, close) => {
      const render = () => {
        const amount = h('input', { class: 'input amount', inputmode: 'decimal', placeholder: '0', value: form.amount, 'aria-label': 'Amount', maxlength: 12 });
        amount.addEventListener('input', () => {
          amount.value = amount.value.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
          form.amount = amount.value;
        });
        const date = h('input', { class: 'input', type: 'date', value: form.date });
        date.addEventListener('change', () => { form.date = date.value; });

        const parts = [];
        if (!editing) {
          parts.push(seg([{ v: 'expense', label: 'Expense' }, { v: 'sub', label: 'Subscription' }], mode, (v) => { mode = v; render(); }));
        }
        parts.push(h('div', { class: 'field' }, h('label', {}, 'Amount'), amount));

        if (mode === 'expense') {
          const note = h('input', { class: 'input', placeholder: 'What was it for? (optional)', maxlength: 120, value: form.note || '' });
          note.addEventListener('input', () => { form.note = note.value; });
          parts.push(
            h('div', { class: 'field' }, h('label', {}, 'Category'), chips(cats, form.category, (c) => { form.category = c; })),
            h('div', { class: 'field' }, h('label', {}, 'Note'), note),
            h('div', { class: 'field' }, h('label', {}, 'Date'), date));
        } else {
          const name = h('input', { class: 'input', placeholder: 'Netflix, Spotify, Gym…', maxlength: 60, value: form.name });
          name.addEventListener('input', () => { form.name = name.value; });
          parts.push(
            h('div', { class: 'field' }, h('label', {}, 'Name'), name),
            h('div', { class: 'field' }, h('label', {}, 'Repeats'), seg(state.meta.PERIODS.map((p) => ({ v: p, label: cap(p) })), form.period, (p) => { form.period = p; })),
            h('div', { class: 'field' }, h('label', {}, 'Next payment'), date),
            h('div', { class: 'field' }, h('label', {}, 'Category'), chips(cats, form.category, (c) => { form.category = c; })));
        }

        const save = h('button', { class: 'btn', type: 'button' }, editing ? 'Save changes' : mode === 'expense' ? 'Add expense' : 'Add subscription');
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            if (mode === 'expense') {
              await api('POST', '/expenses', { amount: form.amount, category: form.category, note: form.note, date: form.date });
              toast('Expense added');
            } else {
              const payload = { name: form.name, amount: form.amount, period: form.period, nextDate: form.date, category: form.category };
              if (editing) await api('PATCH', `/subscriptions/${editing.id}`, payload);
              else await api('POST', '/subscriptions', payload);
              toast(editing ? 'Saved' : 'Subscription added');
            }
            close(); refreshAll();
          } catch (e) { save.disabled = false; fail(e); }
        });
        parts.push(save);

        if (editing) {
          parts.push(
            h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
              try { await api('PATCH', `/subscriptions/${editing.id}`, { active: !editing.active }); close(); toast(editing.active ? 'Paused' : 'Resumed'); refreshAll(); } catch (e) { fail(e); }
            } }, editing.active ? 'Pause reminders' : 'Resume'),
            h('button', { class: 'btn danger', type: 'button', onclick: async () => {
              try { await api('DELETE', `/subscriptions/${editing.id}`); close(); toast('Deleted'); refreshAll(); } catch (e) { fail(e); }
            } }, 'Delete'));
        }
        body.replaceChildren(...parts);
      };
      render();
    });
  }

  // ---------- notifications ----------
  async function openNotifications() {
    haptic.tap();
    let list;
    try { list = (await api('GET', '/notifications')).notifications; } catch (e) { return fail(e); }
    openSheet('Notifications', (body, close) => {
      if (!list.length) body.append(emptyState('You are all caught up.'));
      else {
        body.append(h('div', { class: 'list' }, list.map((n) => h('div', { class: 'row' },
          h('div', { class: 'avatar', style: 'background:rgba(84,164,247,.16);color:var(--blue)', html: ICON.bell }),
          h('div', { class: 'grow' }, h('div', { class: 't', style: 'white-space:normal' }, n.text),
            h('div', { class: 's' }, new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })))))),
        h('button', { class: 'btn ghost', onclick: async () => { try { await api('DELETE', '/notifications'); close(); refreshAll(); } catch (e) { fail(e); } } }, 'Clear all'));
      }
    });
    if (state.unread) {
      api('POST', '/notifications/read').then(() => { state.unread = 0; renderHome().catch(() => {}); }).catch(() => {});
    }
  }

  // ---------- admin panel ----------
  function openAdmin() {
    const screen = $('#screen');
    screen.setAttribute('aria-hidden', 'false');
    const close = () => {
      screen.classList.remove('show'); screen.setAttribute('aria-hidden', 'true');
      if (tg) { tg.BackButton.hide(); tg.BackButton.offClick(close); }
    };
    if (tg) { tg.BackButton.show(); tg.BackButton.onClick(close); }

    const back = h('button', { class: 'back', onclick: close }, h('span', { html: ICON.left }), 'Back');
    const content = h('div', {}, ...skeleton());
    screen.replaceChildren(back, h('div', { class: 'top' }, h('h1', {}, 'Admin')), content);
    requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add('show')));

    (async () => {
      try {
        const stats = await api('GET', '/admin/stats');
        const kpi = (label, v) => h('div', { class: 'kpi' }, h('div', { class: 'stat-label' }, label), h('b', {}, String(v)));
        const maxS = Math.max(...stats.signups.map((s) => s.count), 1);
        const chart = h('div', { class: 'spark' }, stats.signups.map((s, i) => {
          const b = h('i', { class: i === 13 ? 'on' : '', title: `${s.date}: ${s.count}` });
          b.style.height = `${Math.max(8, (s.count / maxS) * 100)}%`; b.style.animationDelay = `${i * 30}ms`;
          return b;
        }));

        // broadcast
        const msg = h('textarea', { class: 'input', placeholder: 'Message to all users…', maxlength: 1000 });
        const send = h('button', { class: 'btn', onclick: async () => {
          const text = msg.value.trim();
          if (!text) return toast('Write a message first', true);
          if (!(await confirmDialog(`Send this to all users (${stats.users - stats.unreachable - stats.blockedUsers})?`))) return;
          send.disabled = true;
          try { const r = await api('POST', '/admin/broadcast', { text }); toast(`Sending to ${r.queued} users`); msg.value = ''; } catch (e) { fail(e); }
          send.disabled = false;
        } }, 'Send broadcast');

        // users
        const usersBox = h('div', { class: 'list' });
        const search = h('input', { class: 'input search', placeholder: 'Search name, @username or ID', 'data-noswipe': true });
        const loadUsers = async () => {
          const { users } = await api('GET', `/admin/users?q=${encodeURIComponent(search.value)}`);
          usersBox.replaceChildren(...(users.length ? users.map((u) => {
            const btn = u.isAdmin ? h('span', { class: 'pill' }, 'Admin')
              : h('button', { class: 'mini' + (u.blocked ? ' ok' : ''), onclick: async () => {
                try { await api('POST', `/admin/users/${u.id}/block`, { blocked: !u.blocked }); toast(u.blocked ? 'Unblocked' : 'Blocked'); loadUsers(); } catch (e) { fail(e); }
              } }, u.blocked ? 'Unblock' : 'Block');
            return h('div', { class: 'row' + (u.blocked ? ' off' : '') },
              h('div', { class: 'avatar' }, (u.first_name || '?').charAt(0).toUpperCase()),
              h('div', { class: 'grow' }, h('div', { class: 't' }, u.first_name || 'User'),
                h('div', { class: 's' }, `${u.username ? '@' + u.username + ' · ' : ''}${u.expenses} exp · ${u.subscriptions} subs`)),
              btn);
          }) : [emptyState('No users found.')]));
        };
        let t;
        search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadUsers().catch(fail), 250); });

        content.replaceChildren(
          h('div', { class: 'kpis' }, kpi('Users', stats.users), kpi('New today', stats.newToday), kpi('Active 7d', stats.active7d), kpi('Subscriptions', stats.subscriptions),
            kpi('Expenses', stats.expenses), kpi('Unreachable', stats.unreachable)),
          h('h2', { class: 'h2' }, 'Sign-ups, 14 days'), h('div', { class: 'card' }, chart),
          h('h2', { class: 'h2' }, 'Broadcast'), h('div', { class: 'card' }, msg, send),
          h('h2', { class: 'h2' }, 'Users'), search, usersBox);
        await loadUsers();
      } catch (e) { fail(e); close(); }
    })();
  }

  // ---------- pager + nav ----------
  const renderers = [renderHome, renderExpenses, renderSubs, renderCalendar, renderProfile];
  let go = () => {};
  const gotoTab = (i) => go(i, true);

  function initPager() {
    const pager = $('#pager'), track = $('#track'), ind = $('#nav-ind'), nav = $('#nav');
    const btns = TABS.map((t, i) => {
      const b = h('button', { class: 'nav-btn', 'aria-label': t.label, onclick: () => { haptic.select(); go(i, true); } },
        h('span', { html: t.icon }), h('span', {}, t.label));
      nav.append(b);
      return b;
    });
    let W = pager.clientWidth;
    const setX = (px) => { track.style.transform = `translate3d(${px}px,0,0)`; };

    go = (i, animate) => {
      const prev = index;
      index = clamp(i, 0, TABS.length - 1);
      track.classList.toggle('settle', !!animate);
      ind.classList.remove('drag');
      setX(-index * W);
      ind.style.transform = `translateX(${index * 100}%)`;
      btns.forEach((b, j) => b.classList.toggle('active', j === index));
      if (index !== prev) renderers[index]().catch(fail);
    };

    addEventListener('resize', () => { W = pager.clientWidth; go(index, false); });

    let drag = null;
    pager.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-noswipe], input, textarea, select')) return;
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), mode: null, dx: 0, id: e.pointerId };
    });
    pager.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.mode) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          drag.mode = 'h'; pager.setPointerCapture(drag.id);
          track.classList.remove('settle'); ind.classList.add('drag');
        } else if (Math.abs(dy) > 8) { drag = null; return; } else return;
      }
      drag.dx = dx;
      const atEdge = (index === 0 && dx > 0) || (index === TABS.length - 1 && dx < 0);
      const eff = atEdge ? dx * 0.28 : dx; // rubber band at the ends
      setX(-index * W + eff);
      ind.style.transform = `translateX(${(index - eff / W) * 100}%)`;
    });
    const finish = () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.mode !== 'h') return;
      const v = d.dx / Math.max(1, performance.now() - d.t); // px/ms
      let next = index;
      if (Math.abs(d.dx) > W * 0.2 || Math.abs(v) > 0.45) next = index + (d.dx < 0 ? 1 : -1);
      if (next !== index) haptic.select();
      go(next, true);
    };
    pager.addEventListener('pointerup', finish);
    pager.addEventListener('pointercancel', finish);

    go(0, false);
    renderers[0]().catch(fail);
  }

  async function refreshAll() {
    calCache = null;
    try {
      const me = await api('GET', '/me');
      state.me = me.user; state.unread = me.unread;
      await renderers[index]();
      // other pages re-render lazily when visited; mark them stale
      document.querySelectorAll('.page').forEach((p, i) => { if (i !== index) p.classList.remove('seen'); });
    } catch (e) { fail(e); }
  }

  // ---------- fab ----------
  $('#fab').addEventListener('click', () => { haptic.tap(); openAdd(index === 2 ? 'sub' : 'expense'); });

  // ---------- boot ----------
  async function boot() {
    if (!tg || !tg.initData) return showGate();
    tg.ready(); tg.expand();
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* older clients */ }
    try { tg.setHeaderColor('#111827'); tg.setBackgroundColor('#111827'); tg.setBottomBarColor && tg.setBottomBarColor('#111827'); } catch { /* ignore */ }

    try {
      const me = await api('GET', '/me');
      state.me = me.user; state.meta = me.meta; state.unread = me.unread;
    } catch (e) {
      if (!$('#gate').hidden) return;
      showGate();
      $('#gate h1').textContent = 'Unavailable';
      $('#gate p').textContent = e.message;
      return;
    }
    $('#app').hidden = false;
    initPager();
  }
  boot();
})();
