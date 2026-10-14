/**
 * Monthly podium medal SVG generator (admin-configurable).
 * Top 1/2/3 = distinct chess pieces; 12 month backdrops × year palette shift.
 * Visual language: winged gold badge + crown + pedestal (share/avatar 512²).
 */

const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  display: 'Palatino Linotype, Palatino, "Book Antiqua", Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", system-ui, sans-serif',
};

const FONT_KEYS = Object.keys(FONTS);

const DEFAULT_CONFIG = {
  botHandle: '@Chess_uz_bot',
  titleTemplate: 'Top {place} Chess player of {month}',
  primary: '#f5c542',
  secondary: '#1a0f05',
  accent: '#ffe9a0',
  text: '#fff8e7',
  muted: '#d4b87a',
  fontFamily: 'sans',
  fontTitle: 'serif',
  sizeInitial: 0, // unused on winged badge (piece is icon)
  sizePlace: 28,
  sizeName: 20,
  sizeHandle: 14,
  sizeTitle: 12,
  sizeBot: 13,
  // Piece icons per podium place (admin-overridable)
  pieceTop1: 'king',
  pieceTop2: 'queen',
  pieceTop3: 'knight',
};

const PIECE_KEYS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

/** Chunky chess silhouette paths (24×28-ish local coords). */
const PIECE = {
  king: 'M11 1h2v3h3v2h-3v2.2l4.5 1.3-.6 2.2L13 10.5V13h5l-.8 12H6.8L6 13h5V10.5L6.1 11.7l-.6-2.2L10 8.2V6H7V4h3z',
  queen: 'M5 9l1.8-5.5L9.5 7 12 2.5 14.5 7l2.7-3.5L19 9l-1.2 1.5H6.2zm2.2 3.2h9.6L15.6 24H8.4z',
  rook: 'M6 3h3v3h2V3h2v3h2V3h3v7H6zm1.5 8h9L15.2 25H8.8z',
  bishop: 'M12 2c2.8 3.2 5.5 5.2 5.5 9.2A5.5 5.5 0 1 1 6.5 11.2C6.5 7.2 9.2 5.2 12 2zm-3.2 18.5h6.4L14.2 26H9.8z',
  knight: 'M7.5 25h10v-2.2l-2.2-1.2.8-3.2c2.2-2 3.4-4.2 3.4-6.5 0-3.4-2.2-5.6-5.6-5.6-1.2 0-2.3.35-3.3 1.05L7.2 9.2l1.1 2.1-2.3 1.1 1.1 2.2-3.2 1.15 2.2 3.2 1.15-1.1z',
  pawn: 'M12 3.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM9.2 12.2h5.6l1.3 3.4H7.9zm-1.3 4.5h8.2L15 26H9z',
};

const MONTH_NAMES_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
  return `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;
}

function clampSize(n, min, max, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function fontCss(key, fallback = 'sans') {
  return FONTS[FONT_KEYS.includes(key) ? key : fallback] || FONTS.sans;
}

function pieceKey(raw, fallback) {
  const k = String(raw || '').toLowerCase();
  return PIECE_KEYS.includes(k) ? k : fallback;
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
    fontFamily: FONT_KEYS.includes(cfg.fontFamily) ? cfg.fontFamily : DEFAULT_CONFIG.fontFamily,
    fontTitle: FONT_KEYS.includes(cfg.fontTitle) ? cfg.fontTitle : DEFAULT_CONFIG.fontTitle,
    sizeInitial: clampSize(cfg.sizeInitial, 0, 140, DEFAULT_CONFIG.sizeInitial),
    sizePlace: clampSize(cfg.sizePlace, 16, 48, DEFAULT_CONFIG.sizePlace),
    sizeName: clampSize(cfg.sizeName, 12, 36, DEFAULT_CONFIG.sizeName),
    sizeHandle: clampSize(cfg.sizeHandle, 10, 28, DEFAULT_CONFIG.sizeHandle),
    sizeTitle: clampSize(cfg.sizeTitle, 9, 22, DEFAULT_CONFIG.sizeTitle),
    sizeBot: clampSize(cfg.sizeBot, 10, 24, DEFAULT_CONFIG.sizeBot),
    pieceTop1: pieceKey(cfg.pieceTop1, DEFAULT_CONFIG.pieceTop1),
    pieceTop2: pieceKey(cfg.pieceTop2, DEFAULT_CONFIG.pieceTop2),
    pieceTop3: pieceKey(cfg.pieceTop3, DEFAULT_CONFIG.pieceTop3),
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

function parseMonth(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  return {
    year: Number.isFinite(y) ? y : 2026,
    month: Math.min(12, Math.max(1, Number.isFinite(m) ? m : 1)),
  };
}

/** Month 0–11 style + year rotates palette so Oct 2026 ≠ Oct 2027. */
function monthStyleIndex(month) {
  const { year, month: mo } = parseMonth(month);
  return (mo - 1 + ((year * 5) % 12)) % 12;
}

function metalPalette(place, cfg, year) {
  const yearHue = (year * 47) % 360;
  if (place === 1) {
    return {
      hi: cfg.accent || '#ffe9a0',
      mid: cfg.primary || '#f5c542',
      lo: '#b8860b',
      deep: '#6b4a08',
      spark: '#ffffff',
      label: 'GOLD',
    };
  }
  if (place === 2) {
    return {
      hi: '#f8fafc',
      mid: '#c0c7d1',
      lo: '#64748b',
      deep: '#334155',
      spark: '#ffffff',
      label: 'SILVER',
    };
  }
  // bronze — slight year tint
  return {
    hi: hsl(28 + (yearHue % 20), 70, 62),
    mid: '#cd7f32',
    lo: '#8b4513',
    deep: '#5c2e0a',
    spark: '#fff7ed',
    label: 'BRONZE',
  };
}

function pieceForPlace(cfg, place) {
  if (place === 1) return cfg.pieceTop1;
  if (place === 2) return cfg.pieceTop2;
  return cfg.pieceTop3;
}

/** Wing / backdrop variants — one family per month slot. */
function wingsSvg(styleIdx, uid, m) {
  // Common: 3 layered plates left + right (reference look)
  const plate = (side, i, extraRot = 0) => {
    const dir = side === 'L' ? -1 : 1;
    const rot = dir * (18 + i * 14 + extraRot);
    const x = side === 'L' ? 210 : 302;
    return `<g transform="translate(${x} 210) rotate(${rot})">
      <path d="M0 0 L${dir * 18} -95 L${dir * 52} -88 L${dir * 28} 8 Z"
        fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M${dir * 6} -20 L${dir * 22} -78" stroke="${esc(m.hi)}" stroke-width="3" stroke-opacity="0.55" stroke-linecap="round"/>
    </g>`;
  };

  switch (styleIdx) {
    case 0: // classic triple wings
      return [0, 1, 2].map((i) => plate('L', i) + plate('R', i)).join('');
    case 1: // wider fan (5 plates)
      return [0, 1, 2, 3, 4].map((i) => plate('L', i, -4) + plate('R', i, -4)).join('');
    case 2: // short stubby wings
      return [0, 1].map((i) => plate('L', i, 8) + plate('R', i, 8)).join('');
    case 3: // laurel leaves
      return Array.from({ length: 7 }, (_, i) => {
        const a = -55 + i * 18;
        const leaf = (dir) => `<g transform="translate(256 230) rotate(${dir * a})">
          <ellipse cx="0" cy="-78" rx="14" ry="28" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="1.5"/>
          <path d="M0 -52 V-100" stroke="${esc(m.hi)}" stroke-width="2" stroke-opacity="0.5"/>
        </g>`;
        return leaf(-1) + leaf(1);
      }).join('');
    case 4: // sunburst spikes
      return Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * 360;
        return `<g transform="translate(256 205) rotate(${a})">
          <path d="M-6 -40 L0 -130 L6 -40 Z" fill="url(#metal-${uid})" fill-opacity="0.85" stroke="${esc(m.lo)}" stroke-width="1"/>
        </g>`;
      }).join('');
    case 5: // diamond shards
      return [-2, -1, 0, 1, 2].map((i) => {
        const x = 256 + i * 38;
        return `<path d="M${x} 95 L${x + 16} 160 L${x} 210 L${x - 16} 160 Z" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="1.5" opacity="${0.7 + Math.abs(i) * 0.05}"/>`;
      }).join('');
    case 6: // ribbon banners
      return `
        <path d="M90 180 Q160 120 210 200 Q160 250 90 220 Z" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2"/>
        <path d="M422 180 Q352 120 302 200 Q352 250 422 220 Z" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2"/>`;
    case 7: // arched halo
      return `
        <path d="M120 230 A136 136 0 0 1 392 230" fill="none" stroke="url(#metal-${uid})" stroke-width="22" stroke-linecap="round"/>
        <path d="M135 230 A121 121 0 0 1 377 230" fill="none" stroke="${esc(m.hi)}" stroke-width="4" stroke-opacity="0.45"/>`;
    case 8: // chevron stacks
      return [-1, 0, 1].map((i) => `
        <path d="M${200 + i * 8} ${150 + i * 18} L256 ${110 + i * 18} L${312 - i * 8} ${150 + i * 18} L256 ${175 + i * 18} Z"
          fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="1.5" opacity="${0.9 - Math.abs(i) * 0.15}"/>`).join('');
    case 9: // twin towers (rook motif)
      return `
        <rect x="118" y="120" width="44" height="120" rx="6" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2"/>
        <rect x="350" y="120" width="44" height="120" rx="6" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2"/>
        <path d="M118 120 h10 v-14 h8 v14 h8 v-14 h8 v14 h10" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="1.5"/>
        <path d="M350 120 h10 v-14 h8 v14 h8 v-14 h8 v14 h10" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="1.5"/>`;
    case 10: // star burst points
      return Array.from({ length: 8 }, (_, i) => {
        const a = i * 45;
        return `<g transform="translate(256 205) rotate(${a})">
          <path d="M0 -45 L8 -100 L0 -115 L-8 -100 Z" fill="${esc(m.hi)}" stroke="${esc(m.lo)}" stroke-width="1"/>
        </g>`;
      }).join('');
    default: // month 11 — ornate double ring + wing tips
      return `
        <circle cx="256" cy="205" r="118" fill="none" stroke="url(#metal-${uid})" stroke-width="10" opacity="0.55"/>
        <circle cx="256" cy="205" r="132" fill="none" stroke="${esc(m.hi)}" stroke-width="3" opacity="0.35"/>
        ${[0, 1, 2].map((i) => plate('L', i, 2) + plate('R', i, 2)).join('')}`;
  }
}

function crownSvg(uid, m) {
  return `<g transform="translate(256 78)">
    <path d="M-42 28 L-36 -6 L-14 14 L0 -18 L14 14 L36 -6 L42 28 Z"
      fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="-36" cy="-8" r="5" fill="${esc(m.hi)}"/>
    <circle cx="0" cy="-20" r="6" fill="${esc(m.hi)}"/>
    <circle cx="36" cy="-8" r="5" fill="${esc(m.hi)}"/>
    <rect x="-40" y="26" width="80" height="10" rx="3" fill="${esc(m.lo)}"/>
  </g>`;
}

function sparkles(uid, seed) {
  const pts = [
    [120, 140], [390, 130], [150, 280], [370, 270], [256, 95], [95, 210], [420, 215],
  ];
  return pts.map(([x, y], i) => {
    const o = ((seed >> (i * 3)) & 7) / 10 + 0.35;
    return `<g transform="translate(${x} ${y})" opacity="${o.toFixed(2)}">
      <path d="M0 -10 L2.5 -2.5 L10 0 L2.5 2.5 L0 10 L-2.5 2.5 L-10 0 L-2.5 -2.5 Z" fill="#fff"/>
    </g>`;
  }).join('');
}

function pedestalSvg(uid, m) {
  return `
    <ellipse cx="256" cy="318" rx="78" ry="16" fill="${esc(m.deep)}" opacity="0.55"/>
    <path d="M178 300 Q256 330 334 300 L318 318 Q256 348 194 318 Z" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="2"/>
    <path d="M190 298 Q256 318 322 298" fill="none" stroke="${esc(m.hi)}" stroke-width="3" stroke-opacity="0.4"/>
  `;
}

function shieldSvg(uid, m, label, font, size) {
  return `
    <path d="M156 340 L356 340 L348 400 Q256 445 164 400 Z"
      fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M170 348 L342 348 L336 392 Q256 428 176 392 Z"
      fill="${esc(m.deep)}" fill-opacity="0.35"/>
    <text x="256" y="392" text-anchor="middle" font-family="${esc(font)}" font-size="${size}"
      font-weight="800" letter-spacing="2" fill="${esc(m.hi)}">${esc(label)}</text>
  `;
}

/**
 * @param {{ place:1|2|3, month:string, name:string, username?:string, userId?:number|string, config?:object }} opts
 */
function generateMedalSvg(opts) {
  const place = Math.min(3, Math.max(1, Math.floor(Number(opts.place) || 1)));
  const month = opts.month || monthKey();
  const cfg = normalizeConfig(opts.config);
  const { year, month: mo } = parseMonth(month);
  const styleIdx = monthStyleIndex(month);
  const seed = hash(`winged:${month}:${place}:${cfg.pieceTop1}`);
  const m = metalPalette(place, cfg, year);
  const uid = `w${seed.toString(36)}`;
  const piece = pieceForPlace(cfg, place);
  const piecePath = PIECE[piece] || PIECE.king;
  const name = String(opts.name || 'Player').slice(0, 26);
  const handle = opts.username
    ? `@${String(opts.username).replace(/^@/, '').slice(0, 22)}`
    : (opts.userId ? `id ${opts.userId}` : '');
  const title = titleFor(cfg, place, month);
  const bodyFont = fontCss(cfg.fontFamily);
  const titleFont = fontCss(cfg.fontTitle, 'serif');
  const shortMonth = `${MONTH_NAMES_SHORT[mo - 1]} ${year}`;
  const shieldLabel = `TOP ${place}`;
  // Year-shifted background wash so same month differs across years
  const bgHue = (year * 53 + mo * 17 + place * 11) % 360;
  const bgA = hsl(bgHue, 35, 8);
  const bgB = hsl((bgHue + 40) % 360, 40, 14);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${esc(bgA)}"/>
      <stop offset="100%" stop-color="${esc(bgB)}"/>
    </linearGradient>
    <linearGradient id="metal-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${esc(m.hi)}"/>
      <stop offset="35%" stop-color="${esc(m.mid)}"/>
      <stop offset="70%" stop-color="${esc(m.lo)}"/>
      <stop offset="100%" stop-color="${esc(m.deep)}"/>
    </linearGradient>
    <radialGradient id="glow-${uid}" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="${esc(m.hi)}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${esc(bgA)}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft-${uid}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="512" height="512" rx="48" fill="url(#bg-${uid})"/>
  <rect width="512" height="512" rx="48" fill="url(#glow-${uid})"/>

  <!-- month/year pattern watermark -->
  <text x="256" y="500" text-anchor="middle" font-family="${esc(bodyFont)}" font-size="64"
    font-weight="900" fill="${esc(m.mid)}" fill-opacity="0.06" letter-spacing="6">${esc(shortMonth)}</text>

  ${wingsSvg(styleIdx, uid, m)}
  ${crownSvg(uid, m)}
  ${pedestalSvg(uid, m)}

  <!-- central piece -->
  <g transform="translate(256 205)" filter="url(#soft-${uid})">
    <circle r="78" fill="${esc(m.deep)}" fill-opacity="0.35"/>
    <g transform="translate(-48 -56) scale(4)" fill="url(#metal-${uid})" stroke="${esc(m.lo)}" stroke-width="0.6">
      <path d="${piecePath}"/>
    </g>
    <path d="M-30 -40 Q-10 -55 5 -35" fill="none" stroke="${esc(m.hi)}" stroke-width="5" stroke-opacity="0.55" stroke-linecap="round"/>
  </g>

  ${sparkles(uid, seed)}
  ${shieldSvg(uid, m, shieldLabel, bodyFont, cfg.sizePlace)}

  <text x="256" y="458" text-anchor="middle" font-family="${esc(bodyFont)}" font-size="${cfg.sizeName}"
    font-weight="700" fill="${esc(cfg.text)}">${esc(name)}</text>
  <text x="256" y="478" text-anchor="middle" font-family="${esc(bodyFont)}" font-size="${cfg.sizeHandle}"
    fill="${esc(cfg.muted)}">${esc(handle)}</text>
  <text x="256" y="496" text-anchor="middle" font-family="${esc(titleFont)}" font-size="${cfg.sizeTitle}"
    font-weight="600" fill="${esc(cfg.accent)}">${esc(title)}</text>
  <text x="40" y="36" font-family="${esc(bodyFont)}" font-size="${cfg.sizeBot}" font-weight="700"
    fill="${esc(m.mid)}">${esc(shortMonth)}</text>
  <text x="472" y="36" text-anchor="end" font-family="${esc(bodyFont)}" font-size="${cfg.sizeBot}" font-weight="700"
    fill="${esc(cfg.primary)}">${esc(cfg.botHandle)}</text>
</svg>`;
}

module.exports = {
  DEFAULT_CONFIG,
  FONTS,
  FONT_KEYS,
  PIECE_KEYS,
  monthKey,
  monthLabelEn,
  previousMonthKey,
  normalizeConfig,
  titleFor,
  generateMedalSvg,
  monthStyleIndex,
  pieceForPlace,
};
