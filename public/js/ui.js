// Shared UI helpers: DOM builder, icons, haptics, toast, bottom sheet, API + websocket client, emoji effects.
import { t, errText } from './i18n.js';

export const tg = window.Telegram && window.Telegram.WebApp;

/** h('div.card#id', {onclick}, child, 'text') */
export function h(sel, props, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const p of (m[2] || '').match(/[.#][\w-]+/g) || []) p[0] === '#' ? (el.id = p.slice(1)) : el.classList.add(p.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') v.split(' ').forEach((c) => c && el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style.setProperty(sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), sv);
      }
    } else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = {
  play: '<path d="M7 20h10M9 20l1-6-2-2c0-3 1.5-5 4-6 2.5 1 4 3 4 6l-2 2 1 6"/><circle cx="12" cy="4.5" r="1.6"/>',
  live: '<circle cx="12" cy="12" r="2.2"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/>',
  friends: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 20c.4-3.6 3-5.5 6-5.5s5.6 1.9 6 5.5"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6M18 14.8c1.8.6 3 2.2 3.2 5.2"/>',
  puzzles: '<path d="M9.5 4.5a2 2 0 0 1 4 0V6H18a1 1 0 0 1 1 1v3.5h-1.5a2 2 0 0 0 0 4H19V18a1 1 0 0 1-1 1h-3.5v-1.5a2 2 0 0 0-4 0V19H7a1 1 0 0 1-1-1v-3.5h1.5a2 2 0 0 0 0-4H6V7a1 1 0 0 1 1-1h2.5z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4.2 3.6-6.5 7.5-6.5s6.9 2.3 7.5 6.5"/>',
  rankings: '<path d="M4 19h16M6 16V9h3v7M11 16V4h3v12M16 16v-5h3v5"/><path d="M5 6l3-2 3 2 4-3 4 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M16 5l-7 7 7 7"/>',
  arrow: '<path d="M7 17L17 7M8 7h9v9"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  flip: '<path d="M7 4v13M3.5 13.5L7 17l3.5-3.5M17 20V7M13.5 10.5L17 7l3.5 3.5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  handshake: '<path d="M3 12l4-4 4 2 3-2 3 2 4 4-6 6-3-1-2 1z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2"/><path d="M9 9.5v.5M15 9.5v.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.7"/><path d="M21 16l-5-5-8 8"/>',
  pencil: '<path d="M14.5 4.5l5 5M4 20l.8-4.2L15.5 5.1a1.5 1.5 0 0 1 2.1 0l1.3 1.3a1.5 1.5 0 0 1 0 2.1L8.2 19.2 4 20z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  crown: '<path d="M3 18h18l-1.5-9-4.5 3L12 6l-3 6-4.5-3z"/><path d="M5 18h14v2H5z"/>',
  gem: '<path d="M6 9l6-6 6 6-6 12z"/><path d="M6 9h12M9.5 3.5L12 9l2.5-5.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.6 1.1-1.6 2.3"/><path d="M12 17h.01"/>',
  docs: '<path d="M8 4h7l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4M10 12h6M10 16h6"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M9 12h10"/>',
  chart: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7.5L12 13l7.5-5.5"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
};
export const icon = (name, size = 24, sw = 1.9) => h('span.ic', {
  html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`,
});

export const haptic = (kind = 'light') => {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (['success', 'error', 'warning'].includes(kind)) tg.HapticFeedback.notificationOccurred(kind);
    else if (kind === 'select') tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.impactOccurred(kind);
  } catch { /* not in Telegram */ }
};

let toastTimer;
export function toast(msg, isErr) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  haptic(isErr ? 'error' : 'light');
}

/** Bottom sheet with backdrop, drag to close. build(close) returns the content nodes. */
export function sheet(build, { onClose } = {}) {
  const root = $('#sheet-root');
  const back = h('div.backdrop');
  const grab = h('div.grab');
  const el = h('div.sheet', grab);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    back.classList.remove('show'); el.classList.remove('show');
    setTimeout(() => { back.remove(); el.remove(); }, 500);
    if (onClose) onClose();
  };
  el.append(...[].concat(build(close)).filter(Boolean));
  back.addEventListener('click', close);
  root.append(back, el);
  requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add('show'); el.classList.add('show'); }));
  // drag down to dismiss
  let y0 = null, dy = 0;
  el.addEventListener('pointerdown', (e) => { if (el.scrollTop <= 0 && e.target.closest('.grab, .sheet')) { y0 = e.clientY; dy = 0; } });
  el.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = e.clientY - y0;
    if (dy > 6) { el.classList.add('drag'); el.style.transform = `translateY(${dy}px)`; }
  });
  const end = () => {
    if (y0 == null) return; y0 = null; el.classList.remove('drag'); el.style.transform = '';
    if (dy > 110) close();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return close;
}

export function confirmSheet(title, okText, danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    sheet((close) => [
      h('h2', title),
      h('button.btn' + (danger ? '.danger-solid' : ''), { onclick: () => { fin(true); close(); } }, okText),
      h('button.btn.ghost', { onclick: () => close() }, t('cancel')),
    ], { onClose: () => fin(false) });
  });
}

/** Segmented control with a sliding thumb */
export function seg(options, value, onChange) {
  return pillBar(options, value, onChange, { className: 'seg' });
}

/**
 * Sliding pill selector used by seg / rankings / live filters.
 * options: [value, labelNodeOrString][]
 */
export function pillBar(options, value, onChange, { className = 'pill-bar', fireOnInit = false } = {}) {
  const n = Math.max(1, options.length);
  const thumb = h('i.pill-thumb');
  const el = h('div.' + String(className).split(/\s+/).filter(Boolean).join('.'), thumb);
  const btns = options.map(([v, label]) => h('button', {
    type: 'button',
    onclick: () => set(v, true),
  }, label));
  el.append(...btns);
  el.style.setProperty('--pill-n', String(n));
  function set(v, fire) {
    const i = Math.max(0, options.findIndex(([x]) => x === v));
    const pad = /rank-tabs|rank-board|live-tabs/.test(className) ? 10 : 8;
    thumb.style.width = `calc((100% - ${pad}px) / ${n})`;
    thumb.style.transform = `translateX(${i * 100}%)`;
    btns.forEach((b, j) => b.classList.toggle('on', j === i));
    if (fire) { haptic('select'); onChange && onChange(options[i][0]); }
  }
  set(value, !!fireOnInit);
  return Object.assign(el, { set: (v) => set(v, false) });
}

export function toggle(on, onChange) {
  const el = h('button.switch' + (on ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': !!on });
  el.addEventListener('click', () => {
    const v = !el.classList.contains('on');
    el.classList.toggle('on', v); el.setAttribute('aria-checked', v); haptic('select');
    onChange(v);
  });
  return el;
}

// ---------- API ----------
let initData = '';
export const setInitData = (s) => { initData = s || ''; };
export const getInitData = () => initData;

export class ApiError extends Error {
  constructor(status, body) { super((body && body.error) || 'Error'); this.status = status; this.code = (body && body.code) || (status ? 'server' : 'net'); }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: { 'X-Init-Data': initData, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, { code: 'net' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const fail = (e) => toast(errText(e), true);

/** Drop from the live online list (Mini App closed / backgrounded). */
export function sendBye() {
  try {
    fetch('/api/bye', {
      method: 'POST',
      headers: { 'X-Init-Data': initData },
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

// ---------- websocket (auto reconnect) ----------
const listeners = new Set();
let ws, wsTimer, wsOpen = false, retry = 0;
export const onWs = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const wsConnected = () => wsOpen;
export function connectWs(onState) {
  clearTimeout(wsTimer);
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  } catch { return; }
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', initData }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'hello') { wsOpen = true; retry = 0; onState && onState(true); }
    listeners.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
  };
  ws.onclose = () => {
    const was = wsOpen; wsOpen = false;
    if (was && onState) onState(false);
    if (document.hidden) return; // closed Mini App — do not keep reconnecting as "online"
    retry = Math.min(retry + 1, 6);
    wsTimer = setTimeout(() => connectWs(onState), 600 * 2 ** retry);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}
setInterval(() => { if (wsOpen) try { ws.send(JSON.stringify({ t: 'ping' })); } catch { /* ignore */ } }, 25_000);

// ---------- emoji effects ----------
/** Floating emoji rising from a point (reactions) */
export function floatEmoji(emoji, x, y) {
  const el = h('div.float-emoji', emoji);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
  document.body.append(el);
  setTimeout(() => el.remove(), 1700);
}

/** Emoji rain (victory) */
export function rain(list = ['🎉', '♟', '✨', '🏆', '👏']) {
  const w = window.innerWidth;
  for (let i = 0; i < 28; i++) {
    const el = h('div.rain', list[i % list.length]);
    el.style.left = `${Math.random() * w}px`;
    el.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    el.style.animationDelay = `${Math.random() * 0.8}s`;
    el.style.fontSize = `${20 + Math.random() * 16}px`;
    document.body.append(el);
    setTimeout(() => el.remove(), 4500);
  }
}

export const initial = (name) => ([...String(name || '?').trim()][0] || '?').toUpperCase();
export const hue = (id) => (Number(id) * 47) % 360;
/** Letter avatar, or medal SVG when avatarKey is `medal:<id>`. */
export const avatar = (name, id, cls = '', avatarKey = null) => {
  const el = h('div.avatar' + (cls ? '.' + cls : ''), { style: { background: `hsl(${hue(id)} 45% 42%)`, color: '#fff' } }, initial(name));
  const m = avatarKey && /^medal:(.+)$/.exec(String(avatarKey));
  if (m) {
    el.classList.add('medal');
    el.style.background = 'transparent';
    el.replaceChildren(h('img.avatar-medal', {
      src: `/api/medals/${encodeURIComponent(m[1])}.svg`,
      alt: '',
      draggable: 'false',
    }));
  }
  return el;
};

/** Premium crown — tap opens Premium shop (via `open-premium` event). */
export function premIc(size = 18) {
  return h('button.prem-ic', {
    type: 'button',
    title: 'Premium',
    'aria-label': 'Premium',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic('select');
      document.dispatchEvent(new CustomEvent('open-premium'));
    },
  }, icon('crown', size));
}

/**
 * Avatar wrap with optional online dot and rotating gold Premium ring.
 * @param {string} name
 * @param {number|string} id
 * @param {{ premium?: boolean, online?: boolean, size?: string, round?: boolean, sparkles?: boolean }} [opts]
 * Note: circular shape uses class `circ` (not `round`) so it never clashes with `.round` icon buttons.
 */
export function avBlock(name, id, opts = {}) {
  const size = opts.size || '';
  const circ = !!opts.round || size === 'xl';
  const wrap = h(
    'div.avwrap'
    + (opts.premium ? '.prem' : '')
    + (size === 'xl' ? '.xl' : '')
    + (circ ? '.circ' : ''),
  );
  if (opts.premium) {
    // Single spinning gold rim (no second solid border on the avatar itself)
    wrap.append(h('span.prem-ring', { 'aria-hidden': 'true' }));
    // Telegram Stars–style twinkles around large / profile avatars
    if (opts.sparkles || size === 'xl') {
      const glyphs = ['✦', '✧', '★', '✧', '✦', '⋆', '✦', '✧'];
      for (let i = 0; i < glyphs.length; i++) {
        wrap.append(h('span.prem-spark', {
          'aria-hidden': 'true',
          style: { '--i': String(i), '--n': String(glyphs.length) },
        }, glyphs[i]));
      }
    }
  }
  wrap.append(avatar(name, id, size, opts.avatarKey || null));
  if (opts.online) wrap.append(h('i.dot.on'));
  return wrap;
}

/** Open Telegram's share sheet with a link and text (falls back to copying) */
export function shareUrl(link, text) {
  const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text || '')}`;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u, '_blank');
}
export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = s; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
  }
}
