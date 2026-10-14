/**
 * Professional winged chess medal SVG (admin-configurable).
 * Layout matches game-UI crests: crown + tiered wings + glossy piece + shield.
 * Top 1/2/3 = gold/silver/bronze + distinct piece icons.
 * 12 months × year shift → unique wing flare / gem accent / background wash.
 */

const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  display: 'Palatino Linotype, Palatino, "Book Antiqua", Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
};

const FONT_KEYS = Object.keys(FONTS);
const PIECE_KEYS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

const DEFAULT_CONFIG = {
  botHandle: '@Chess_uz_bot',
  titleTemplate: 'Top {place} Chess player of {month}',
  primary: '#ffd54a',
  secondary: '#0a0a0a',
  accent: '#fff3c4',
  text: '#fff8e7',
  muted: '#e8c878',
  fontFamily: 'sans',
  fontTitle: 'serif',
  sizeInitial: 0,
  sizePlace: 26,
  sizeName: 18,
  sizeHandle: 13,
  sizeTitle: 11,
  sizeBot: 12,
  pieceTop1: 'king',
  pieceTop2: 'queen',
  pieceTop3: 'knight',
  shieldText: 'CHESS', // empty → TOP {place}
};

const MONTH_NAMES_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Chunky piece silhouettes (viewBox 0 0 64 80) — game-icon style like the references.
 */
const PIECE = {
  pawn: `
    <circle cx="32" cy="18" r="12"/>
    <path d="M20 32h24l4 10H16z"/>
    <path d="M14 44h36l-4 28H18z"/>
    <ellipse cx="32" cy="74" rx="22" ry="5"/>`,
  rook: `
    <path d="M12 8h10v10h6V8h8v10h6V8h10v22H12z"/>
    <path d="M16 32h32v36H16z"/>
    <path d="M12 68h40v8H12z"/>
    <ellipse cx="32" cy="78" rx="24" ry="4"/>`,
  knight: `
    <path d="M18 72h32v-6l-6-4 2-10c6-6 10-12 10-20 0-12-8-20-20-20-5 0-9 1.5-12 4L14 22l4 7-8 4 4 7-10 4 8 12 4-4z"/>
    <circle cx="28" cy="28" r="2.5" fill="#1a0f05"/>
    <ellipse cx="32" cy="76" rx="22" ry="4"/>`,
  bishop: `
    <circle cx="32" cy="8" r="4"/>
    <path d="M32 12c10 10 16 16 16 28a16 16 0 1 1-32 0c0-12 6-18 16-28z"/>
    <path d="M26 18c6 4 10 10 12 18" fill="none" stroke="#1a0f05" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
    <path d="M18 58h28l-3 16H21z"/>
    <ellipse cx="32" cy="76" rx="22" ry="4"/>`,
  queen: `
    <circle cx="12" cy="14" r="4"/><circle cx="32" cy="6" r="5"/><circle cx="52" cy="14" r="4"/>
    <circle cx="22" cy="10" r="3.5"/><circle cx="42" cy="10" r="3.5"/>
    <path d="M10 18l6 16h32l6-16-8 6-6-12-6 10-6-10-6 12z"/>
    <path d="M16 36h32l-3 28H19z"/>
    <path d="M14 64h36v8H14z"/>
    <ellipse cx="32" cy="76" rx="24" ry="4"/>`,
  king: `
    <path d="M29 2h6v8h8v5h-8v8h-6v-8h-8V10h8z"/>
    <path d="M14 26h36l-4 10H18z"/>
    <path d="M16 38h32l-2 26H18z"/>
    <path d="M12 64h40v8H12z"/>
    <ellipse cx="32" cy="76" rx="24" ry="4"/>`,
};

function monthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

function monthLabelEn(key) {
  const [y, m] = String(key).split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Math.max(0, Math.min(11, Number(m) - 1))]} ${y}`;
}

function previousMonthKey(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hsl(h, s, l) {
  return `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;
}

function clampSize(n, min, max, fallback) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
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
    sizePlace: clampSize(cfg.sizePlace, 14, 48, DEFAULT_CONFIG.sizePlace),
    sizeName: clampSize(cfg.sizeName, 12, 36, DEFAULT_CONFIG.sizeName),
    sizeHandle: clampSize(cfg.sizeHandle, 10, 28, DEFAULT_CONFIG.sizeHandle),
    sizeTitle: clampSize(cfg.sizeTitle, 9, 22, DEFAULT_CONFIG.sizeTitle),
    sizeBot: clampSize(cfg.sizeBot, 10, 24, DEFAULT_CONFIG.sizeBot),
    pieceTop1: pieceKey(cfg.pieceTop1, DEFAULT_CONFIG.pieceTop1),
    pieceTop2: pieceKey(cfg.pieceTop2, DEFAULT_CONFIG.pieceTop2),
    pieceTop3: pieceKey(cfg.pieceTop3, DEFAULT_CONFIG.pieceTop3),
    shieldText: String(cfg.shieldText != null ? cfg.shieldText : DEFAULT_CONFIG.shieldText).slice(0, 16),
  };
}

function titleFor(cfg, place, month) {
  return cfg.titleTemplate
    .replace(/\{place\}/g, String(place))
    .replace(/\{month\}/g, monthLabelEn(month));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseMonth(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  return {
    year: Number.isFinite(y) ? y : 2026,
    month: Math.min(12, Math.max(1, Number.isFinite(m) ? m : 1)),
  };
}

function monthStyleIndex(month) {
  const { year, month: mo } = parseMonth(month);
  return (mo - 1 + ((year * 5) % 12)) % 12;
}

function pieceForPlace(cfg, place) {
  if (place === 1) return cfg.pieceTop1;
  if (place === 2) return cfg.pieceTop2;
  return cfg.pieceTop3;
}

/** Gold / silver / bronze metal stops (reference look). */
function metalPalette(place, cfg, year) {
  if (place === 1) {
    return {
      hi: cfg.accent || '#fff6c8',
      mid: cfg.primary || '#ffd54a',
      mid2: '#f0a820',
      lo: '#c47a0a',
      deep: '#7a4508',
      ink: '#5c3006',
      rim: '#ffe9a0',
    };
  }
  if (place === 2) {
    return {
      hi: '#ffffff',
      mid: '#e2e8f0',
      mid2: '#94a3b8',
      lo: '#64748b',
      deep: '#334155',
      ink: '#1e293b',
      rim: '#f1f5f9',
    };
  }
  const tint = (year * 3) % 15;
  return {
    hi: hsl(28 + tint, 75, 62),
    mid: '#d4893a',
    mid2: '#a85c22',
    lo: '#7a3f14',
    deep: '#4a240a',
    ink: '#2e1608',
    rim: '#f0c08a',
  };
}

/** Tiered wing crest — styleIdx varies flare count / curve for month uniqueness. */
function wingsCrest(uid, m, styleIdx) {
  const tiers = 3 + (styleIdx % 3); // 3–5 wing plates
  const spread = 16 + (styleIdx % 4) * 3;
  const length = 92 + (styleIdx % 5) * 6;
  const curve = 8 + (styleIdx % 4) * 2;

  const plate = (side, i) => {
    const dir = side === 'L' ? -1 : 1;
    const rot = dir * (12 + i * spread * 0.55);
    const w = 22 + i * 4;
    const h = length - i * 8;
    const skew = curve + i * 2;
    // Jagged leaf/wing plate like the reference
    return `<g transform="translate(256 210) rotate(${rot.toFixed(1)})">
      <path d="M0 ${10 + i * 4}
        C${dir * 8} ${-h * 0.25} ${dir * (w * 0.6)} ${-h * 0.55} ${dir * w} ${-h}
        L${dir * (w + skew)} ${-h + 18}
        L${dir * (w * 0.55)} ${-h * 0.35}
        L${dir * (w * 0.35 + 4)} 18 Z"
        fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M${dir * 4} ${-h * 0.15} L${dir * (w * 0.55)} ${-h * 0.75}"
        fill="none" stroke="${esc(m.hi)}" stroke-width="3.5" stroke-opacity="0.65" stroke-linecap="round"/>
      <path d="M${dir * 2} ${-h * 0.05} L${dir * (w * 0.35)} ${-h * 0.45}"
        fill="none" stroke="${esc(m.rim)}" stroke-width="1.5" stroke-opacity="0.4" stroke-linecap="round"/>
    </g>`;
  };

  // Optional laurel overlay for some months
  let laurel = '';
  if (styleIdx === 3 || styleIdx === 11) {
    laurel = Array.from({ length: 6 }, (_, i) => {
      const a = -50 + i * 20;
      const leaf = (dir) => `<g transform="translate(256 225) rotate(${dir * a})">
        <ellipse cx="0" cy="-70" rx="11" ry="24" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>
        <path d="M0 -50 V-88" stroke="${esc(m.hi)}" stroke-width="1.8" stroke-opacity="0.5"/>
      </g>`;
      return leaf(-1) + leaf(1);
    }).join('');
  }

  // Fan shards for platinum-like months
  let fan = '';
  if (styleIdx === 7 || styleIdx === 9) {
    fan = Array.from({ length: 7 }, (_, i) => {
      const a = -48 + i * 16;
      return `<g transform="translate(256 200) rotate(${a})">
        <path d="M-5 -30 L0 -115 L5 -30 Z" fill="url(#metal-${uid})" fill-opacity="0.75" stroke="${esc(m.ink)}" stroke-width="1"/>
      </g>`;
    }).join('');
  }

  const plates = Array.from({ length: tiers }, (_, i) => plate('L', i) + plate('R', i)).join('');
  return fan + plates + laurel;
}

function crown(uid, m) {
  return `<g transform="translate(256 72)">
    <path d="M-48 34 L-40 -8 L-16 16 L0 -22 L16 16 L40 -8 L48 34 Z"
      fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M-36 8 L-40 -4" stroke="${esc(m.hi)}" stroke-width="3" stroke-opacity="0.7" stroke-linecap="round"/>
    <circle cx="-40" cy="-10" r="6" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>
    <circle cx="0" cy="-24" r="7" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>
    <circle cx="40" cy="-10" r="6" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>
    <circle cx="-40" cy="-12" r="2" fill="${esc(m.hi)}"/>
    <circle cx="0" cy="-26" r="2.5" fill="${esc(m.hi)}"/>
    <circle cx="40" cy="-12" r="2" fill="${esc(m.hi)}"/>
    <rect x="-46" y="30" width="92" height="12" rx="3" fill="${esc(m.lo)}" stroke="${esc(m.ink)}" stroke-width="1.5"/>
    <rect x="-40" y="32" width="80" height="4" rx="1" fill="${esc(m.hi)}" opacity="0.35"/>
  </g>`;
}

function sparkles(seed) {
  const pts = [[108, 150], [404, 142], [130, 290], [382, 285], [256, 58], [86, 220], [426, 225], [200, 100], [312, 95]];
  return pts.map(([x, y], i) => {
    const s = 7 + ((seed >> (i * 2)) & 3);
    const o = 0.45 + (((seed >> i) & 3) * 0.12);
    return `<g transform="translate(${x} ${y})" opacity="${o.toFixed(2)}">
      <path d="M0 -${s} L${s * 0.28} -${s * 0.28} L${s} 0 L${s * 0.28} ${s * 0.28} L0 ${s} L-${s * 0.28} ${s * 0.28} L-${s} 0 L-${s * 0.28} -${s * 0.28} Z" fill="#fff"/>
    </g>`;
  }).join('');
}

function shield(uid, m, label, font, size) {
  return `
    <path d="M148 348 L364 348 L352 418 Q256 468 160 418 Z"
      fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M162 358 L350 358 L340 408 Q256 448 172 408 Z"
      fill="${esc(m.deep)}" fill-opacity="0.28"/>
    <path d="M170 362 L340 362" stroke="${esc(m.hi)}" stroke-width="2" stroke-opacity="0.35"/>
    <text x="256" y="408" text-anchor="middle" font-family="${esc(font)}" font-size="${size}"
      font-weight="900" letter-spacing="3" fill="${esc(m.hi)}"
      stroke="${esc(m.ink)}" stroke-width="0.8">${esc(label)}</text>`;
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
  const seed = hash(`crest:${month}:${place}:${cfg.pieceTop1}:${cfg.pieceTop2}:${cfg.pieceTop3}`);
  const m = metalPalette(place, cfg, year);
  const uid = `c${seed.toString(36)}`;
  const piece = pieceForPlace(cfg, place);
  const pieceMarkup = PIECE[piece] || PIECE.king;
  const name = String(opts.name || 'Player').slice(0, 26);
  const handle = opts.username
    ? `@${String(opts.username).replace(/^@/, '').slice(0, 22)}`
    : (opts.userId ? `id ${opts.userId}` : '');
  const title = titleFor(cfg, place, month);
  const bodyFont = fontCss(cfg.fontFamily);
  const titleFont = fontCss(cfg.fontTitle, 'serif');
  const shortMonth = `${MONTH_NAMES_SHORT[mo - 1]} ${year}`;
  const shieldLabel = (cfg.shieldText && cfg.shieldText.trim())
    ? cfg.shieldText.trim().toUpperCase()
    : `TOP ${place}`;
  const bgHue = (year * 53 + mo * 19 + place * 11) % 360;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg-${uid}" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="${esc(hsl(bgHue, 20, 6))}"/>
      <stop offset="100%" stop-color="${esc(cfg.secondary)}"/>
    </linearGradient>
    <linearGradient id="metal-${uid}" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="${esc(m.hi)}"/>
      <stop offset="22%" stop-color="${esc(m.mid)}"/>
      <stop offset="48%" stop-color="${esc(m.mid2)}"/>
      <stop offset="72%" stop-color="${esc(m.lo)}"/>
      <stop offset="100%" stop-color="${esc(m.deep)}"/>
    </linearGradient>
    <linearGradient id="piece-${uid}" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="${esc(m.hi)}"/>
      <stop offset="40%" stop-color="${esc(m.mid)}"/>
      <stop offset="100%" stop-color="${esc(m.lo)}"/>
    </linearGradient>
    <radialGradient id="glow-${uid}" cx="50%" cy="38%" r="48%">
      <stop offset="0%" stop-color="${esc(m.hi)}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${esc(cfg.secondary)}" stop-opacity="0"/>
    </radialGradient>
    <filter id="drop-${uid}" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="512" height="512" rx="40" fill="url(#bg-${uid})"/>
  <rect width="512" height="512" rx="40" fill="url(#glow-${uid})"/>

  <g filter="url(#drop-${uid})">
    ${wingsCrest(uid, m, styleIdx)}
    ${crown(uid, m)}

    <!-- central glossy piece -->
    <g transform="translate(256 198)">
      <ellipse cx="0" cy="48" rx="54" ry="12" fill="#000" opacity="0.35"/>
      <g transform="translate(-48 -58) scale(1.5)" fill="url(#piece-${uid})" stroke="${esc(m.ink)}" stroke-width="1.8" stroke-linejoin="round">
        ${pieceMarkup}
      </g>
      <!-- gloss streak -->
      <path d="M-22 -40 Q-8 -52 6 -28" fill="none" stroke="${esc(m.hi)}" stroke-width="6" stroke-opacity="0.55" stroke-linecap="round"/>
      <path d="M-18 -36 Q-6 -46 4 -26" fill="none" stroke="#fff" stroke-width="2" stroke-opacity="0.35" stroke-linecap="round"/>
    </g>

    ${shield(uid, m, shieldLabel, bodyFont, cfg.sizePlace)}
  </g>

  ${sparkles(seed)}

  <text x="256" y="488" text-anchor="middle" font-family="${esc(bodyFont)}" font-size="${cfg.sizeName}"
    font-weight="700" fill="${esc(cfg.text)}">${esc(name)}</text>
  <text x="40" y="32" font-family="${esc(bodyFont)}" font-size="${cfg.sizeBot}" font-weight="800"
    fill="${esc(m.mid)}" letter-spacing="1">${esc(shortMonth)}</text>
  <text x="472" y="32" text-anchor="end" font-family="${esc(bodyFont)}" font-size="${cfg.sizeBot}" font-weight="700"
    fill="${esc(cfg.primary)}">${esc(cfg.botHandle)}</text>
  ${handle ? `<text x="256" y="506" text-anchor="middle" font-family="${esc(bodyFont)}" font-size="${cfg.sizeHandle}" fill="${esc(cfg.muted)}">${esc(handle)}</text>` : ''}
  <text x="256" y="28" text-anchor="middle" font-family="${esc(titleFont)}" font-size="${cfg.sizeTitle}"
    font-weight="600" fill="${esc(cfg.accent)}" opacity="0.9">${esc(title)}</text>
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
