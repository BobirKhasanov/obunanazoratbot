// Home announcement carousel (admin-managed banners).
import { h, haptic, getInitData } from './ui.js';

const FONT_CSS = {
  system: 'inherit',
  rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

let timer = null;
const blobUrls = [];

export function stopAnnouncementsCarousel() {
  clearInterval(timer); timer = null;
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

function openLink(a, onPage) {
  haptic('light');
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

function slide(a, onPage) {
  const font = FONT_CSS[a.fontFamily] || FONT_CSS.system;
  const clickable = a.linkType === 'url' || a.linkType === 'page';
  return h((clickable ? 'button' : 'div') + '.ann-slide', {
    type: clickable ? 'button' : undefined,
    style: {
      background: `linear-gradient(135deg, ${a.bgFrom}, ${a.bgTo})`,
      fontFamily: font,
    },
    onclick: clickable ? () => openLink(a, onPage) : undefined,
  },
    h('div.ann-copy',
      a.title ? h('b.ann-title', { style: { color: a.titleColor, fontSize: `${a.fontSize}px` } }, a.title) : null,
      a.body ? h('span.ann-body', { style: { color: a.bodyColor, fontSize: `${Math.max(12, a.fontSize - 4)}px` } }, a.body) : null),
    a._src ? h('div.ann-media', h('img', { src: a._src, alt: '' })) : h('div.ann-media.emoji', '♛'));
}

/** Mount carousel into host. Returns host or null. */
export async function mountAnnouncementsCarousel(host, items, { onPage } = {}) {
  stopAnnouncementsCarousel();
  if (!host) return null;
  host.replaceChildren();
  if (!items || !items.length) { host.hidden = true; return null; }
  const resolved = await resolveMedia(items);
  if (!host.isConnected) return null;
  host.hidden = false;
  const track = h('div.ann-track', resolved.map((a) => slide(a, onPage)));
  const dots = resolved.length > 1
    ? h('div.ann-dots', resolved.map((_, i) => h('i' + (i === 0 ? '.on' : ''))))
    : null;
  host.append(track, dots);
  if (resolved.length < 2) return host;

  let idx = 0;
  const go = (n) => {
    idx = ((n % resolved.length) + resolved.length) % resolved.length;
    track.style.transform = `translate3d(-${idx * 100}%,0,0)`;
    if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
  };
  timer = setInterval(() => go(idx + 1), 4200);

  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX };
    clearInterval(timer); timer = null;
  });
  host.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag = null;
    if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
    timer = setInterval(() => go(idx + 1), 4200);
  });
  host.addEventListener('pointercancel', () => {
    drag = null;
    if (!timer) timer = setInterval(() => go(idx + 1), 4200);
  });
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
