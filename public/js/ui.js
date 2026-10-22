// Shared UI helpers: DOM builder, icons, haptics, toast, bottom sheet, API + websocket client, emoji effects.
import { t, errText } from './i18n.js';

export const tg = window.Telegram && window.Telegram.WebApp;
/** iPhone fullscreen already draws its own header pill; our round back button is enough there (otherwise two Back buttons). */
export const nativeBackWanted = () => !(tg && tg.isFullscreen && tg.platform === 'ios');

function insetPx(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Copy Telegram.WebApp safeAreaInset + contentSafeAreaInset onto the CSS
 * variables --safe-t already adds. When a phone reports 0 while the header
 * still overlays the webview, fill only that gap — never stack on a real inset.
 */
export function syncTgSafeArea() {
  const tw = tg || (window.Telegram && window.Telegram.WebApp);
  if (!tw) return;
  const root = document.documentElement;
  const s = tw.safeAreaInset || {};
  const c = tw.contentSafeAreaInset || {};
  for (const side of ['top', 'bottom', 'left', 'right']) {
    root.style.setProperty('--tg-safe-area-inset-' + side, insetPx(s[side]) + 'px');
    root.style.setProperty('--tg-content-safe-area-inset-' + side, insetPx(c[side]) + 'px');
  }
  const reportedTop = insetPx(s.top) + insetPx(c.top);
  if (reportedTop > 0) return;
  // The Telegram header only overlays the webview in fullscreen mode. In the normal
  // (bottom-sheet) mode the webview starts BELOW the header, so a 0 inset is correct —
  // adding a fallback there is what produced the big empty gap at the top of every page.
  if (!tw.isFullscreen) return;
  const plat = String(tw.platform || '').toLowerCase();
  if (plat === 'tdesktop' || plat === 'macos' || plat === 'web' || plat === 'weba' || plat === 'webk') return;
  const ios = plat === 'ios' || root.dataset.ios === '1';
  const android = plat === 'android' || root.dataset.android === '1';
  if (!ios && !android) return;
  root.style.setProperty('--tg-content-safe-area-inset-top', (ios ? 88 : 64) + 'px');
}

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
    else if (k === 'value') el.value = v === true ? '' : String(v); // textarea/input: attr alone does not set .value
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cancel in-flight smoothScrollTo on an element (avoids freeze when stacked). */
const scrollAnimIds = new WeakMap();
const scrollAbort = new WeakMap(); // { timer, onUser } cleanup for active glide
function cancelSmoothScroll(el) {
  if (!el) return;
  const id = scrollAnimIds.get(el);
  if (id != null) {
    try { cancelAnimationFrame(id); } catch { /* ignore */ }
    scrollAnimIds.delete(el);
  }
  const ab = scrollAbort.get(el);
  if (ab) {
    scrollAbort.delete(el);
    if (ab.timer != null) clearTimeout(ab.timer);
    if (ab.onUser) {
      try {
        el.removeEventListener('touchstart', ab.onUser, true);
        el.removeEventListener('pointerdown', ab.onUser, true);
        el.removeEventListener('wheel', ab.onUser, true);
      } catch { /* ignore */ }
    }
  }
}

function isiOSScroll() {
  try {
    if (document.documentElement.dataset.ios === '1') return true;
    const tw = window.Telegram && window.Telegram.WebApp;
    const plat = String((tw && tw.platform) || '').toLowerCase();
    if (plat === 'ios') return true;
  } catch { /* ignore */ }
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

/** Keep auto — restoring '' re-enables CSS smooth and makes the next finger-scroll jitter. */
function forceScrollAuto(el) {
  if (!el) return;
  el.style.scrollBehavior = 'auto';
}

/** Stop iOS rubber-band / momentum so a new scroll animation can start cleanly. */
function stopScrollMomentum(el) {
  if (!el) return;
  const y = el.scrollTop;
  const prev = el.style.overflowY;
  el.style.overflowY = 'hidden';
  try { el.scrollTop = y; } catch { /* ignore */ }
  void el.offsetHeight;
  el.style.overflowY = prev || '';
}

/** If the user touches/wheels during a glide, abort so we never fight their scroll. */
function armScrollUserAbort(el) {
  const onUser = () => {
    // Freeze at current offset — stops native iOS smooth mid-flight too
    forceScrollAuto(el);
    const y = el.scrollTop;
    try {
      if (typeof el.scrollTo === 'function') el.scrollTo(0, y);
      else el.scrollTop = y;
    } catch { /* ignore */ }
    cancelSmoothScroll(el);
  };
  scrollAbort.set(el, { timer: null, onUser });
  el.addEventListener('touchstart', onUser, { capture: true, passive: true });
  el.addEventListener('pointerdown', onUser, { capture: true, passive: true });
  el.addEventListener('wheel', onUser, { capture: true, passive: true });
  return onUser;
}

/** Jump to top without fighting CSS scroll-behavior (TG WebView–safe). */
export function scrollToTopNow(el) {
  if (!el) return;
  cancelSmoothScroll(el);
  stopScrollMomentum(el);
  forceScrollAuto(el);
  try {
    if (typeof el.scrollTo === 'function') el.scrollTo(0, 0);
    else el.scrollTop = 0;
  } catch {
    try { el.scrollTop = 0; } catch { /* ignore */ }
  }
}

/**
 * Slow, smooth scroll to top for the FAB.
 * Never re-enables CSS smooth afterward (that makes the next downward scroll shake).
 * Aborts immediately if the user touches the page mid-glide.
 */
export function scrollToTopSmooth(el, ms) {
  if (!el) return;
  cancelSmoothScroll(el);
  const reduce = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { scrollToTopNow(el); return; }
  const from = el.scrollTop;
  if (from < 2) { scrollToTopNow(el); return; }

  forceScrollAuto(el);
  armScrollUserAbort(el);

  // iOS Telegram WebView: kill momentum, then a single native smooth scroll
  if (isiOSScroll()) {
    stopScrollMomentum(el);
    try {
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        el.scrollTop = 0;
      }
    } catch {
      el.scrollTop = 0;
    }
    // Only finish cleanup — never force scrollTop=0 later (fights user scrolling down)
    const ab = scrollAbort.get(el);
    if (ab) {
      ab.timer = setTimeout(() => {
        cancelSmoothScroll(el);
        forceScrollAuto(el);
      }, 850);
    }
    return;
  }

  // Longer glide — scales a bit with distance, stays calm (not snappy)
  const lite = document.documentElement.dataset.perf === 'lite';
  const android = document.documentElement.dataset.android === '1';
  // Don't fight tab slide compositing on Android
  if (android && document.getElementById('track')?.classList.contains('settle')) {
    scrollToTopNow(el);
    return;
  }
  const base = ms != null ? ms : Math.min(1200, Math.max(780, 520 + from * 0.42));
  const duration = lite || android ? Math.min(base, android ? 520 : 920) : base;
  const t0 = performance.now();
  // Softer ease-out so the finish feels gradual
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const tick = (now) => {
    if (!scrollAbort.has(el)) return; // user aborted
    const p = Math.min(1, (now - t0) / duration);
    el.scrollTop = from * (1 - ease(p));
    if (p < 1) {
      scrollAnimIds.set(el, requestAnimationFrame(tick));
    } else {
      scrollAnimIds.delete(el);
      el.scrollTop = 0;
      cancelSmoothScroll(el);
      forceScrollAuto(el);
    }
  };
  scrollAnimIds.set(el, requestAnimationFrame(tick));
}

/** High-smooth programmatic scroll (longer ease than browser default). */
export function smoothScrollTo(el, top = 0, ms = 520) {
  if (!el) return;
  cancelSmoothScroll(el);
  const reduce = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || ms <= 0) {
    forceScrollAuto(el);
    el.scrollTop = top;
    return;
  }
  const from = el.scrollTop;
  const dist = top - from;
  if (Math.abs(dist) < 1) return;
  forceScrollAuto(el); // never leave CSS smooth fighting finger scroll afterward
  armScrollUserAbort(el);
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic
  const tick = (now) => {
    if (!scrollAbort.has(el)) return; // user aborted
    const p = Math.min(1, (now - t0) / ms);
    el.scrollTop = from + dist * ease(p);
    if (p < 1) {
      scrollAnimIds.set(el, requestAnimationFrame(tick));
    } else {
      scrollAnimIds.delete(el);
      cancelSmoothScroll(el);
      forceScrollAuto(el);
    }
  };
  scrollAnimIds.set(el, requestAnimationFrame(tick));
}

const P = {
  play: '<path d="M4 10.5l8-6.5 8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  home: '<path d="M4 10.5l8-6.5 8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  live: '<circle cx="9" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3 20c.5-3.4 2.8-5.2 6-5.2s5.5 1.8 6 5.2M14 20c.3-2.2 1.6-3.5 3.8-3.5 1.2 0 2.2.4 2.9 1.2"/>',
  friends: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 20c.4-3.6 3-5.5 6-5.5s5.6 1.9 6 5.5"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6M18 14.8c1.8.6 3 2.2 3.2 5.2"/>',
  puzzles: '<path d="M9.5 4.5a2 2 0 0 1 4 0V6H18a1 1 0 0 1 1 1v3.5h-1.5a2 2 0 0 0 0 4H19V18a1 1 0 0 1-1 1h-3.5v-1.5a2 2 0 0 0-4 0V19H7a1 1 0 0 1-1-1v-3.5h1.5a2 2 0 0 0 0-4H6V7a1 1 0 0 1 1-1h2.5z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4.2 3.6-6.5 7.5-6.5s6.9 2.3 7.5 6.5"/>',
  rankings: '<rect x="3" y="8" width="5" height="10" rx="1.2"/><rect x="9.5" y="4" width="5" height="14" rx="1.2"/><rect x="16" y="10" width="5" height="8" rx="1.2"/><circle cx="12" cy="7" r="1.2"/>',
  gamepad: '<rect x="3" y="8" width="18" height="11" rx="4"/><path d="M8 13.5h4M10 11.5v4M16.2 12.2h.01M18 14.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M16 5l-7 7 7 7"/>',
  arrow: '<path d="M7 17L17 7M8 7h9v9"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  ai: '<path d="M12 2.5l1.4 4.2L18 8l-4.6 1.3L12 13.5l-1.4-4.2L6 8l4.6-1.3z"/><path d="M5.2 14.2l.9 2.6 2.7.8-2.7.8-.9 2.6-.9-2.6-2.7-.8 2.7-.8z"/><path d="M17.8 13.5l.7 2 2 .6-2 .6-.7 2-.7-2-2-.6 2-.6z"/>',
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
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.2"/>',
  user: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>',
  playTri: '<path d="M8 5.5v13l11-6.5z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  chevronUp: '<path d="M6 14l6-6 6 6"/>',
  chevronDown: '<path d="M6 10l6 6 6-6"/>',
  crown: '<path d="M3 18h18l-1.5-9-4.5 3L12 6l-3 6-4.5-3z"/><path d="M5 18h14v2H5z"/>',
  gem: '<path d="M6 9l6-6 6 6-6 12z"/><path d="M6 9h12M9.5 3.5L12 9l2.5-5.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.6 1.1-1.6 2.3"/><path d="M12 17h.01"/>',
  docs: '<path d="M8 4h7l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4M10 12h6M10 16h6"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M9 12h10"/>',
  chart: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7.5L12 13l7.5-5.5"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  chat: '<path d="M5 6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H10l-4 3v-3a3 3 0 0 1-3-3z"/>',
  soundOn: '<path d="M4 10v4h3l4 3V7L7 10H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a6.5 6.5 0 0 1 0 10"/>',
  soundOff: '<path d="M4 10v4h3l4 3V7L7 10H4z"/><path d="M17 9l4 4M21 9l-4 4"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16.5 16.5L21 21"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  userPlus: '<circle cx="9.5" cy="8" r="3.6"/><path d="M3 20c.5-3.8 3.2-5.8 6.5-5.8s6 2 6.5 5.8M18.5 8v6M15.5 11h6"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.2l2.8 1.8"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3 20c.5-3.4 2.8-5.2 6-5.2s5.5 1.8 6 5.2M14 20c.3-2.2 1.6-3.5 3.8-3.5 1.2 0 2.2.4 2.9 1.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8.5 8h7M8.5 11.5h5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 0 5H7M17 6h2.5a2.5 2.5 0 0 1 0 5H17"/>',
  sparkles: '<path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 13l.7 2.1L21 16l-2.3.7L18 19l-.7-2.3L15 16l2.3-.9zM6 14l.6 1.8L8.5 16.5 6.6 17 6 19l-.6-2-1.9-.5L5.4 15.8z"/>',
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

export async function api(method, url, body, opts = {}) {
  let res;
  const timeoutMs = Number(opts && opts.timeoutMs) || 0;
  const ctrl = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* ignore */ } }, timeoutMs) : null;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: { 'X-Init-Data': initData, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'net' });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const fail = (e) => toast(errText(e), true);

/** Drop from the live online list (Mini App closed / backgrounded). */
export function sendBye() {
  try {
    // Close WS first so server leave clears present_until and pings cannot re-touch presence.
    clearTimeout(wsTimer);
    wsOpen = false;
    if (ws) {
      try { ws.onclose = null; ws.close(); } catch { /* ignore */ }
      ws = null;
    }
    fetch('/api/bye', {
      method: 'POST',
      headers: { 'X-Init-Data': initData },
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

// ---------- websocket (auto reconnect) ----------
const listeners = new Set();
let ws, wsTimer, wsOpen = false, retry = 0, wsOnState = null;
export const onWs = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const wsConnected = () => wsOpen;
export function connectWs(onState) {
  if (typeof onState === 'function') wsOnState = onState;
  const notify = wsOnState;
  clearTimeout(wsTimer);
  try {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  } catch { /* ignore */ }
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  } catch { return; }
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', initData }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'hello') { wsOpen = true; retry = 0; notify && notify(true); }
    listeners.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
  };
  ws.onclose = () => {
    const was = wsOpen; wsOpen = false;
    if (was && notify) notify(false);
    if (document.hidden) return; // closed Mini App — do not keep reconnecting as "online"
    retry = Math.min(retry + 1, 6);
    wsTimer = setTimeout(() => connectWs(), 600 * 2 ** retry);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}
setInterval(() => {
  if (!wsOpen || document.hidden) return;
  try { ws.send(JSON.stringify({ t: 'ping' })); } catch { /* ignore */ }
}, 25000);

// ---------- emoji effects ----------
/** Floating emoji rising from a point (reactions) — slow, smooth float */
export function floatEmoji(emoji, x, y) {
  const el = h('div.float-emoji', emoji);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  // Unitless px drift — keyframes multiply for a smooth arc (Android WebView–safe)
  el.style.setProperty('--dx', String(((Math.random() - 0.5) * 72).toFixed(1)));
  document.body.append(el);
  setTimeout(() => el.remove(), 5600);
}

/**
 * Move sound: HTMLAudio + short WAV (Telegram WebView–reliable).
 * Pure Web Audio alone often stays silent after drag gestures on iOS TG.
 */
let moveWavUrlCached = null;
let moveAudioProto = null;
let moveAudioCtx = null;
let moveAudioReady = false;
let lastMoveSoundAt = 0;

/** Soft wood piece-drop WAV (blob: allowed by CSP media-src). */
function moveWavUrl() {
  if (moveWavUrlCached) return moveWavUrlCached;
  const sr = 22050;
  const n = Math.floor(sr * 0.1);
  const samples = new Int16Array(n);
  let n0 = 0;
  let n1 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const thud = Math.sin(2 * Math.PI * 170 * t) * Math.exp(-t * 36);
    const knock = Math.sin(2 * Math.PI * 390 * t) * Math.exp(-t * 58) * 0.45;
    n0 = n0 * 0.72 + (Math.random() * 2 - 1) * 0.28;
    n1 = n1 * 0.55 + n0 * 0.45;
    const noise = n1 * Math.exp(-t * 80) * 0.28;
    const env = Math.exp(-t * 40);
    // Peak ~0.7 so phone speakers hear it; HTMLAudio.volume softens further
    const v = (thud * 0.75 + knock + noise) * env * 0.72;
    samples[i] = Math.max(-1, Math.min(1, v)) * 32767;
  }
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  moveWavUrlCached = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  return moveWavUrlCached;
}

function ensureMoveAudio() {
  if (moveAudioProto) return moveAudioProto;
  const el = new Audio(moveWavUrl());
  el.preload = 'auto';
  el.volume = 0.55;
  try { el.load(); } catch { /* ignore */ }
  moveAudioProto = el;
  return el;
}

function ensureMoveCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!moveAudioCtx) moveAudioCtx = new AC();
  return moveAudioCtx;
}

/** Must run inside a user gesture (board pointerdown). Unlocks audio without an audible click. */
export function unlockAudio() {
  try {
    // Respect local mute — otherwise HTMLAudio unlock still clicks on some TG WebViews
    if (!isMoveSoundOn()) return;
    // WebAudio resume alone is silent — preferred for Telegram WebViews
    const ctx = ensureMoveCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (moveAudioReady) return;
    const el = ensureMoveAudio();
    // Keep proto element muted forever — playMoveSound uses a fresh Audio each move
    el.muted = true;
    el.volume = 0;
    const p = el.play();
    const reset = () => {
      try {
        el.pause();
        el.currentTime = 0;
        el.muted = true;
        el.volume = 0;
        moveAudioReady = true;
      } catch { moveAudioReady = true; }
    };
    if (p && typeof p.then === 'function') p.then(reset).catch(reset);
    else reset();
  } catch { /* ignore */ }
}

function playMoveSoundOsc() {
  try {
    const ctx = ensureMoveCtx();
    if (!ctx) return;
    const run = () => {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(220, t0);
      o.frequency.exponentialRampToValueAtTime(90, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.11);
    };
    if (ctx.state === 'suspended') ctx.resume().then(run).catch(() => {});
    else run();
  } catch { /* ignore */ }
}

const MOVE_SOUND_KEY = 'chess-move-sound';
/** Local preference: hear move sounds in this Mini App (default on). */
export function isMoveSoundOn() {
  try {
    const v = localStorage.getItem(MOVE_SOUND_KEY);
    if (v === '0' || v === 'off' || v === 'false') return false;
  } catch { /* ignore */ }
  return true;
}
export function setMoveSoundOn(on) {
  try { localStorage.setItem(MOVE_SOUND_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (!on) {
    // Drop unlock state so a later unmute re-arms inside a gesture
    moveAudioReady = false;
    try {
      if (moveAudioProto) {
        moveAudioProto.pause();
        moveAudioProto.muted = true;
        moveAudioProto.volume = 0;
      }
    } catch { /* ignore */ }
  }
}

/** Piece-drop when a move lands (player, opponent, AI, puzzles). */
export function playMoveSound() {
  try {
    if (!isMoveSoundOn()) return;
    const now = performance.now();
    if (now - lastMoveSoundAt < 40) return;
    lastMoveSoundAt = now;
    // Fresh element per move — avoids currentTime/play races in WebView
    const el = new Audio(moveWavUrl());
    el.muted = false;
    el.volume = 0.55;
    const played = el.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        if (!isMoveSoundOn()) return;
        // Gesture may have ended — try oscillator (shared proto stays muted for unlock)
        try { playMoveSoundOsc(); } catch { /* ignore */ }
      });
    }
  } catch {
    if (isMoveSoundOn()) playMoveSoundOsc();
  }
}

/** Emoji rain (victory) — skipped on lite Android; full on iOS / high-end */
export function rain(list = ['🎉', '♟', '✨', '🏆', '👏']) {
  if (document.documentElement.dataset.perf === 'lite') return;
  const n = 28;
  const w = window.innerWidth;
  for (let i = 0; i < n; i++) {
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
/** Letter avatar, character (`char:<id>`), medal SVG (`medal:<id>`), or Premium photo (`img:<uuid>`). */
export const avatar = (name, id, cls = '', avatarKey = null) => {
  const el = h('div.avatar' + (cls ? '.' + cls : ''), { style: { background: `hsl(${hue(id)} 48% 44%)`, color: '#fff' } }, initial(name));
  const key = avatarKey ? String(avatarKey) : '';
  const char = /^char:([a-z0-9_-]+)$/i.exec(key);
  const medal = /^medal:(.+)$/.exec(key);
  const img = /^img:([0-9a-f-]{36})$/i.exec(key);
  if (char) {
    el.classList.add('medal', 'char');
    el.style.background = 'transparent';
    el.replaceChildren(h('img.avatar-medal', {
      src: `/img/char-avatars/${encodeURIComponent(char[1].toLowerCase())}.png?v=4`,
      alt: '',
      draggable: 'false',
      loading: 'lazy',
      decoding: 'async',
    }));
  } else if (medal) {
    el.classList.add('medal');
    el.style.background = '#0b0f16';
    el.replaceChildren(h('img.avatar-medal', {
      src: `/api/medals/${encodeURIComponent(medal[1])}.svg?v=4`,
      alt: '',
      draggable: 'false',
      loading: 'lazy',
      decoding: 'async',
    }));
  } else if (img) {
    el.classList.add('medal', 'photo');
    el.style.background = 'transparent';
    el.replaceChildren(h('img.avatar-medal', {
      src: `/api/avatars/${encodeURIComponent(img[1])}`,
      alt: '',
      draggable: 'false',
      loading: 'lazy',
      decoding: 'async',
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
let medalHolders = {};
/** { [userId]: { id, place } } — latest monthly medal of each champion, shown next to their avatar everywhere. */
export const setMedalHolders = (m) => { medalHolders = m && typeof m === 'object' ? m : {}; };
export const medalOf = (id) => medalHolders[String(id)] || null;

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
  const med = id ? medalOf(id) : null;
  if (med && !opts.noMedal) {
    wrap.append(h('img.med-bdg.p' + med.place, { src: `/api/medals/${med.id}.svg?v=4`, alt: '', loading: 'lazy', decoding: 'async', 'aria-hidden': 'true' }));
  }
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
