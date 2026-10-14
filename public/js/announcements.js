// Home announcement carousel (admin-managed banners).
import { h, haptic, getInitData, shareUrl, toast } from './ui.js';
import { t } from './i18n.js';

const FONT_CSS = {
  system: 'inherit',
  rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** How long each slide stays before auto-advance (ms). */
const DWELL_MS = 6000;
const SWIPE_PX = 48;

let timer = null;
let unbindSwipe = null;
const blobUrls = [];

export function stopAnnouncementsCarousel() {
  clearInterval(timer); timer = null;
  if (unbindSwipe) { try { unbindSwipe(); } catch { /* ignore */ } unbindSwipe = null; }
  while (blobUrls.length) {
    try { URL.revokeObjectURL(blobUrls.pop()); } catch { /* ignore */ }
  }
}

async function resolveMedia(items) {
  return Promise.all(items.map(async (a) => {
    if (!a.mediaId) return { ...a, _src: null };
    try {
      const res = await fetch('/api/media/' + a.mediaId, { headers: { 'X-Init-Data': getInitData() } });
      if (!res.ok) return { ...a, _src: null };
      const url = URL.createObjectURL(await res.blob());
      blobUrls.push(url);
      return { ...a, _src: url };
    } catch {
      return { ...a, _src: null };
    }
  }));
}

function referralLink(botUsername, userId) {
  if (!botUsername || !userId) return null;
  return `https://t.me/${botUsername}?start=i${userId}`;
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

function slide(a, opts) {
  const font = FONT_CSS[a.fontFamily] || FONT_CSS.system;
  const clickable = a.linkType === 'url' || a.linkType === 'page' || a.linkType === 'invite';
  return h((clickable ? 'button' : 'div') + '.ann-slide', {
    type: clickable ? 'button' : undefined,
    style: {
      background: `linear-gradient(135deg, ${a.bgFrom}, ${a.bgTo})`,
      fontFamily: font,
    },
    onclick: clickable ? (e) => {
      if (e.currentTarget.closest('.ann-carousel')?._annSwiped) return;
      openLink(a, opts);
    } : undefined,
  },
    h('div.ann-copy',
      a.title ? h('b.ann-title', { style: { color: a.titleColor, fontSize: `${a.fontSize}px` } }, a.title) : null,
      a.body ? h('span.ann-body', { style: { color: a.bodyColor, fontSize: `${Math.max(12, a.fontSize - 4)}px` } }, a.body) : null),
    a._src ? h('div.ann-media', h('img', { src: a._src, alt: '', draggable: 'false' })) : h('div.ann-media.emoji', '♛'));
}

function bindSwipe(host, track, n, go, armAuto) {
  let drag = null;
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearInterval(timer); timer = null;
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
      drag.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'h' : 'v';
      if (drag.axis === 'v') {
        track.classList.remove('dragging');
        drag = null;
        armAuto();
        return;
      }
    }
    if (drag.axis !== 'h') return;
    e.preventDefault();
    drag.dx = dx;
    const w = host.clientWidth || 1;
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
    armAuto();
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

/** Mount carousel into host. Returns host or null. */
export async function mountAnnouncementsCarousel(host, items, { onPage, botUsername, userId } = {}) {
  stopAnnouncementsCarousel();
  if (!host) return null;
  host.replaceChildren();
  if (!items || !items.length) { host.hidden = true; return null; }
  const resolved = await resolveMedia(items);
  if (!host.isConnected) return null;
  host.hidden = false;
  const opts = { onPage, botUsername, userId };
  const track = h('div.ann-track', resolved.map((a) => slide(a, opts)));
  host.replaceChildren(track);
  if (resolved.length < 2) return host;

  const dots = h('div.ann-dots', resolved.map((_, i) => h('i' + (i === 0 ? '.on' : ''))));
  host.append(dots);

  const n = resolved.length;
  const go = (next) => {
    go.idx = ((next % n) + n) % n;
    const w = host.clientWidth || 0;
    track.style.transform = w
      ? `translate3d(${-go.idx * w}px,0,0)`
      : `translate3d(-${go.idx * 100}%,0,0)`;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === go.idx));
  };
  go.idx = 0;

  const armAuto = () => {
    clearInterval(timer);
    timer = setInterval(() => go(go.idx + 1), DWELL_MS);
  };

  unbindSwipe = bindSwipe(host, track, n, go, armAuto);
  armAuto();

  // keep pixel offsets correct on resize
  const onResize = () => go(go.idx);
  addEventListener('resize', onResize);
  const prevUnbind = unbindSwipe;
  unbindSwipe = () => {
    prevUnbind();
    removeEventListener('resize', onResize);
  };

  return host;
}

export async function loadAnnouncements(api) {
  try {
    const r = await api('GET', '/announcements');
    return r.announcements || [];
  } catch {
    return [];
  }
}
