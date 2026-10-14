/**
 * Monthly podium medal SVG generator (admin-configurable).
 * Unique look per month via seeded palette; place 1/2/3 shapes differ.
 */

const DEFAULT_CONFIG = {
  botHandle: '@Chess_uz_bot',
  titleTemplate: 'Top {place} Chess player of {month}',
  primary: '#f5c542',
  secondary: '#1e293b',
  accent: '#38bdf8',
  text: '#ffffff',
  muted: '#94a3b8',
};

function monthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}

function monthLabelEn(key) {
  const [y, m] = String(key).split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const mi = Math.max(0, Math.min(11, Number(m) - 1));
  return `${names[mi]} ${y}`;
}

function previousMonthKey(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hsl(h, s, l) {
  return `hsl(${h % 360} ${s}% ${l}%)`;
}

function normalizeConfig(raw) {
  let cfg = raw;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
  }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    botHandle: String(cfg.botHandle || DEFAULT_CONFIG.botHandle).slice(0, 64),
    titleTemplate: String(cfg.titleTemplate || DEFAULT_CONFIG.titleTemplate).slice(0, 120),
    primary: String(cfg.primary || DEFAULT_CONFIG.primary).slice(0, 32),
    secondary: String(cfg.secondary || DEFAULT_CONFIG.secondary).slice(0, 32),
    accent: String(cfg.accent || DEFAULT_CONFIG.accent).slice(0, 32),
    text: String(cfg.text || DEFAULT_CONFIG.text).slice(0, 32),
    muted: String(cfg.muted || DEFAULT_CONFIG.muted).slice(0, 32),
  };
}

function titleFor(cfg, place, month) {
  return cfg.titleTemplate
    .replace(/\{place\}/g, String(place))
    .replace(/\{month\}/g, monthLabelEn(month));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a share / avatar medal SVG (512×512).
 * @param {{ place:1|2|3, month:string, name:string, username?:string, userId?:number|string, config?:object }} opts
 */
function generateMedalSvg(opts) {
  const place = Math.min(3, Math.max(1, Math.floor(Number(opts.place) || 1)));
  const month = opts.month || monthKey();
  const cfg = normalizeConfig(opts.config);
  const seed = hash(`${month}:${place}:${cfg.primary}`);
  const hue = seed % 360;
  const ring = place === 1 ? cfg.primary : place === 2 ? '#c0c7d1' : '#cd7f32';
  const glow = hsl(hue, 70, 55);
  const name = String(opts.name || 'Player').slice(0, 28);
  const handle = opts.username
    ? `@${String(opts.username).replace(/^@/, '').slice(0, 24)}`
    : (opts.userId ? `id ${opts.userId}` : '');
  const title = titleFor(cfg, place, month);
  const star = place === 1 ? '★' : place === 2 ? '◆' : '●';
  const initial = ([...name][0] || '?').toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${esc(cfg.secondary)}"/>
      <stop offset="100%" stop-color="${esc(glow)}"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${esc(ring)}"/>
      <stop offset="50%" stop-color="#fff6c8"/>
      <stop offset="100%" stop-color="${esc(ring)}"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="64" fill="url(#bg)"/>
  <circle cx="256" cy="210" r="118" fill="none" stroke="url(#ring)" stroke-width="18"/>
  <circle cx="256" cy="210" r="96" fill="${esc(cfg.secondary)}" filter="url(#soft)"/>
  <text x="256" y="230" text-anchor="middle" font-family="Georgia, serif" font-size="92" font-weight="700" fill="${esc(cfg.text)}">${esc(initial)}</text>
  <text x="256" y="340" text-anchor="middle" font-family="system-ui,sans-serif" font-size="36" font-weight="800" fill="${esc(ring)}">${star} #${place}</text>
  <text x="256" y="382" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="${esc(cfg.text)}">${esc(name)}</text>
  <text x="256" y="412" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="${esc(cfg.muted)}">${esc(handle)}</text>
  <text x="256" y="448" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${esc(cfg.accent)}">${esc(title)}</text>
  <text x="256" y="478" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="${esc(cfg.primary)}">${esc(cfg.botHandle)}</text>
</svg>`;
}

module.exports = {
  DEFAULT_CONFIG,
  monthKey,
  monthLabelEn,
  previousMonthKey,
  normalizeConfig,
  titleFor,
  generateMedalSvg,
};
