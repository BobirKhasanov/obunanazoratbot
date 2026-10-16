// Home announcement carousel (admin-managed banners).
import { h, haptic, getInitData, shareUrl, toast } from './ui.js';
import { t } from './i18n.js';
import { carouselDwellMs, carouselMaxSlides, isLite } from './perf.js';

const FONT_CSS = {
  system: 'inherit',
  rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** Puzzle carousel starts its timer this many ms after the home one (phase offset). */
export const CAROUSEL_STAGGER_MS = 2000;
const SWIPE_PX = 40;

/** Per-host cleanup + blob URLs so unused carousels can be torn down without killing reused ones. */
const hostState = new WeakMap();

function revokeBlobs(blobs) {
  while (blobs && blobs.length) {
    try { URL.revokeObjectURL(blobs.pop()); } catch { /* ignore */ }
  }
}

function stopHost(host) {
  const st = host && hostState.get(host);
  if (!st) return;
  hostState.delete(host);
  while (st.cleanups.length) {
    try { st.cleanups.pop()(); } catch { /* ignore */ }
  }
  revokeBlobs(st.blobs);
}

function pauseHost(host) {
  const st = host && hostState.get(host);
  if (!st || !st.pause) return;
  try { st.pause(); } catch { /* ignore */ }
}

function resumeHost(host) {
  const st = host && hostState.get(host);
  if (!st || !st.resume) return;
  try { st.resume(); } catch { /* ignore */ }
}

/** True when host still has live timers/blobs (safe to reuse without remount). */
export function isAnnouncementsHostLive(host) {
  return !!(host && hostState.get(host) && host.querySelector('.ann-track'));
}

/** Tear down one carousel host (timers + media blobs). */
export function stopAnnouncementsHost(host) {
  stopHost(host);
}

/** Tear down every mounted carousel under root (tab leave / full reset). */
export function stopAnnouncementsCarousel(root = document) {
  try {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.ann-carousel').forEach((el) => stopHost(el));
  } catch { /* ignore */ }
}

/** Pause auto-advance only — keep DOM + blob URLs (tab leave). */
export function pauseAnnouncementsCarousel(root = document) {
  try {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.ann-carousel').forEach((el) => pauseHost(el));
  } catch { /* ignore */ }
}

/** Resume auto-advance after pause / reuse. */
export function resumeAnnouncementsCarousel(root = document) {
  try {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.ann-carousel').forEach((el) => resumeHost(el));
  } catch { /* ignore */ }
}

export function resumeAnnouncementsHost(host) {
  resumeHost(host);
}

async function resolveMedia(items, blobs) {
  return Promise.all(items.map(async (a) => {
    if (!a.mediaId) return { ...a, _src: null };
    try {
      const res = await fetch('/api/media/' + a.mediaId, { headers: { 'X-Init-Data': getInitData() } });
      if (!res.ok) return { ...a, _src: null };
      const url = URL.createObjectURL(await res.blob());
      blobs.push(url);
      return { ...a, _src: url };
    } catch {
      return { ...a, _src: null };
    }
  }));
}

function referralLink(botUsername, userId) {
  if (!botUsername || !userId) return null;
  // startapp → Mini App with signed start_param (server pays on /me)
  return `https://t.me/${botUsername}?startapp=i${userId}`;
}

function openLink(a, { onPage, botUsername, userId } = {}) {
  haptic('light');
  if (a.linkType === 'invite') {
    const link = referralLink(botUsername, userId);
    if (!link) return toast(t('e_server'), true);
    shareUrl(link, t('share_text'));
    return;
  }
  if (a.linkType === 'url' && a.linkUrl) {
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && tg.openLink) tg.openLink(a.linkUrl);
      else window.open(a.linkUrl, '_blank', 'noopener');
    } catch { window.open(a.linkUrl, '_blank', 'noopener'); }
    return;
  }
  if (a.linkType === 'page' && a.linkPage && onPage) onPage(a.linkPage);
}

function hasCopy(a) {
  return !!(String(a.title || '').trim() || String(a.body || '').trim());
}

function slide(a, opts) {
  const font = FONT_CSS[a.fontFamily] || FONT_CSS.system;
  const clickable = a.linkType === 'url' || a.linkType === 'page' || a.linkType === 'invite';
  const wantedMedia = !!a.mediaId;
  // Media-only when there is no title/body (both boards may be media-only).
  const mediaOnly = wantedMedia && !hasCopy(a);
  const bgFrom = a.bgFrom || '#1a2740';
  const bgTo = a.bgTo || '#0b1220';
  return h((clickable ? 'button' : 'div') + '.ann-slide' + (mediaOnly ? '.media-only' : ''), {
    type: clickable ? 'button' : undefined,
    style: mediaOnly ? { fontFamily: font } : {
      background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
      fontFamily: font,
    },
    onclick: clickable ? (e) => {
      if (e.currentTarget.closest('.ann-carousel')?._annSwiped) return;
      openLink(a, opts);
    } : undefined,
  },
    mediaOnly ? null : h('div.ann-copy',
      a.title ? h('b.ann-title', { style: { color: a.titleColor, fontSize: `${a.fontSize}px` } }, a.title) : null,
      a.body ? h('span.ann-body', { style: { color: a.bodyColor, fontSize: `${Math.max(12, a.fontSize - 4)}px` } }, a.body) : null),
    a._src
      ? h('div.ann-media', h('img', {
        src: a._src,
        alt: '',
        draggable: 'false',
        decoding: 'async',
        // Keep last paint stable while the decode finishes (media-only boards).
        style: mediaOnly ? { background: '#0b1220' } : undefined,
      }))
      : (mediaOnly ? h('div.ann-media') : h('div.ann-media.emoji', '♛')));
}

function bindSwipe(host, track, n, go, { armAuto, stopAuto }) {
  let drag = null;
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAuto && stopAuto();
    host._annSwiped = false;
    drag = {
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      axis: null,
      base: -go.idx * host.clientWidth,
      id: e.pointerId,
    };
    track.classList.add('dragging');
    try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
      if (drag.axis === 'v') {
        track.classList.remove('dragging');
        drag = null;
        armAuto && armAuto();
        return;
      }
    }
    if (drag.axis !== 'h') return;
    e.preventDefault();
    drag.dx = dx;
    // rubber-band at ends
    let offset = drag.base + dx;
    if (go.idx === 0 && dx > 0) offset = drag.base + dx * 0.35;
    if (go.idx === n - 1 && dx < 0) offset = drag.base + dx * 0.35;
    track.style.transform = `translate3d(${offset}px,0,0)`;
  };
  const onUp = (e) => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    const dx = drag.dx;
    const wasH = drag.axis === 'h';
    track.classList.remove('dragging');
    drag = null;
    if (wasH && Math.abs(dx) >= SWIPE_PX) {
      host._annSwiped = true;
      haptic('select');
      go(go.idx + (dx < 0 ? 1 : -1));
      setTimeout(() => { host._annSwiped = false; }, 280);
    } else {
      go(go.idx); // snap back
    }
    armAuto && armAuto();
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  return () => {
    host.removeEventListener('pointerdown', onDown);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
  };
}

/** Fingerprint for reuse — same content keeps the live carousel (no media reload flicker). */
export function announcementsKey(items) {
  return JSON.stringify((items || []).map((a) => [a.id, a.title, a.body, a.mediaId, a.linkType, a.endsAt]));
}

/** Mount carousel into host (does not clear other carousels). Returns host or null. */
export async function mountAnnouncementsCarousel(host, items, { onPage, botUsername, userId, delayMs = 0 } = {}) {
  if (!host) return null;
  if (!items || !items.length) {
    stopHost(host);
    host.replaceChildren();
    host.hidden = true;
    host.classList.remove('ann-loading');
    return null;
  }

  // Weak Android: fewer slides + fewer media blob fetches (iOS keeps full list).
  const maxSlides = carouselMaxSlides();
  const capped = Number.isFinite(maxSlides) ? items.slice(0, maxSlides) : items;

  // Reserve fixed 140px box immediately (entry→home used to jump when hosts stayed [hidden]).
  host.hidden = false;
  host.classList.add('ann-loading');
  if (!host.querySelector('.ann-track')) {
    host.replaceChildren(h('div.ann-skel'));
  }

  // Fetch media first, then swap — avoids empty/emoji flash on remount (both boards can be media-only).
  const blobs = [];
  const resolved = await resolveMedia(capped, blobs);
  if (!host.isConnected) {
    revokeBlobs(blobs);
    return null;
  }

  stopHost(host);
  const cleanups = [];
  const state = { blobs, cleanups, pause: null, resume: null };
  hostState.set(host, state);

  host.hidden = false;
  host.classList.remove('ann-loading');
  const opts = { onPage, botUsername, userId };
  const lite = isLite();
  const track = h('div.ann-track' + (lite ? '.lite' : ''), resolved.map((a) => slide(a, opts)));
  host.replaceChildren(track);
  if (resolved.length < 2) return host;

  const dots = h('div.ann-dots', resolved.map((_, i) => h('i' + (i === 0 ? '.on' : ''))));
  host.append(dots);

  const n = resolved.length;
  const dwell = carouselDwellMs();
  let timer = null;
  let armed = false;
  const go = (next) => {
    go.idx = ((next % n) + n) % n;
    const w = host.clientWidth || 0;
    track.style.transform = w
      ? `translate3d(${-go.idx * w}px,0,0)`
      : `translate3d(-${go.idx * 100}%,0,0)`;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === go.idx));
  };
  go.idx = 0;

  const stopAuto = () => {
    clearInterval(timer);
    clearTimeout(timer);
    timer = null;
  };
  const armAuto = () => {
    stopAuto();
    const start = () => {
      armed = true;
      timer = setInterval(() => go(go.idx + 1), dwell);
    };
    // First mount: optional phase offset so two carousels don't flip together.
    // After swipe/interaction / resume: resume on the dwell cadence immediately once armed.
    if (!armed && delayMs > 0) timer = setTimeout(start, delayMs);
    else start();
  };
  state.pause = stopAuto;
  state.resume = armAuto;

  const unbindSwipe = bindSwipe(host, track, n, go, { armAuto, stopAuto });
  // After entry reveal, first paint often has clientWidth 0 — remeasure on next frames
  go(0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => go(go.idx));
  });
  armAuto();

  const onResize = () => go(go.idx);
  addEventListener('resize', onResize);
  cleanups.push(() => {
    stopAuto();
    try { unbindSwipe(); } catch { /* ignore */ }
    removeEventListener('resize', onResize);
  });

  return host;
}

export async function loadAnnouncements(api, board = 'home') {
  try {
    const q = board && board !== 'home' ? `?board=${encodeURIComponent(board)}` : '';
    const r = await api('GET', `/announcements${q}`);
    return r.announcements || [];
  } catch {
    return [];
  }
}
