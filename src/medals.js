/**
 * PUBG-style season rank badges with chess pieces for Top 1/2/3.
 * Layout: ornate emblem → tier plaque → arrow banner (name · season · bot).
 * Unique frame / palette per calendar month; year shifts hues.
 */

const { renderMedalSvg } = require('./medal-art');

const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  display: 'Palatino Linotype, Palatino, "Book Antiqua", Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Arial, Black, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
};

const FONT_KEYS = Object.keys(FONTS);
const PIECE_KEYS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

const DEFAULT_CONFIG = {
  botHandle: '@Chess_uz_bot',
  titleTemplate: 'Top {place} · {month}',
  primary: '#ffd54a',
  secondary: '#0b0d12',
  accent: '#fff3c4',
  text: '#ffffff',
  muted: '#c8d0dc',
  fontFamily: 'sans',
  fontTitle: 'sans',
  sizeInitial: 0,
  sizePlace: 22,
  sizeName: 28,
  sizeHandle: 16,
  sizeTitle: 18,
  sizeBot: 15,
  pieceTop1: 'king',
  pieceTop2: 'queen',
  pieceTop3: 'knight',
  shieldText: '',
};

/** Piece icons (64×80). */
const PIECE = {
  pawn: `<circle cx="32" cy="16" r="11"/><path d="M20 30h24l3 9H17z"/><path d="M15 42h34l-4 28H19z"/><ellipse cx="32" cy="74" rx="20" ry="4"/>`,
  rook: `<path d="M10 6h10v9h6V6h8v9h6V6h10v20H10z"/><path d="M14 28h36v34H14z"/><path d="M10 62h44v10H10z"/><ellipse cx="32" cy="76" rx="22" ry="4"/>`,
  knight: `<path d="M16 70h30v-5l-5-3 2-9c5-5 9-11 9-18 0-11-7-18-18-18-4 0-8 1-11 3.5L12 20l3.5 6-7 3.5 3.5 6-9 3.5 7 11 3.5-3.5z"/><circle cx="26" cy="26" r="2.2" fill="#0b0d12"/><ellipse cx="32" cy="74" rx="20" ry="4"/>`,
  bishop: `<circle cx="32" cy="7" r="3.5"/><path d="M32 11c9 9 14 15 14 26a14 14 0 1 1-28 0c0-11 5-17 14-26z"/><path d="M26 17c5 3.5 9 9 11 16" fill="none" stroke="#0b0d12" stroke-width="2.5" opacity=".35"/><path d="M18 55h28l-3 15H21z"/><ellipse cx="32" cy="74" rx="20" ry="4"/>`,
  queen: `<circle cx="12" cy="12" r="3.5"/><circle cx="32" cy="5" r="4.5"/><circle cx="52" cy="12" r="3.5"/><circle cx="22" cy="9" r="3"/><circle cx="42" cy="9" r="3"/><path d="M10 16l5 14h34l5-14-7 5-5-10-5 8-5-8-5 10z"/><path d="M16 32h32l-3 28H19z"/><path d="M13 60h38v8H13z"/><ellipse cx="32" cy="74" rx="22" ry="4"/>`,
  king: `<path d="M29 1h6v7h7v5h-7v7h-6v-7h-7V8h7z"/><path d="M14 24h36l-4 9H18z"/><path d="M16 35h32l-2 25H18z"/><path d="M12 60h40v8H12z"/><ellipse cx="32" cy="74" rx="22" ry="4"/>`,
};

const MONTH_NAMES_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ROMAN = ['I', 'II', 'III'];

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

function seasonLabel(key) {
  return monthLabelEn(key).toUpperCase();
}

function previousMonthKey(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Tashkent calendar parts (Asia/Tashkent wall clock). */
function tashkentParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  let hour = g('hour');
  // en-CA may yield 24 for midnight in some engines
  if (hour === 24) hour = 0;
  return { year: g('year'), month: g('month'), day: g('day'), hour, minute: g('minute') };
}

/** Tashkent calendar day 1–31 as number. */
function tashkentDay(date = new Date()) {
  return tashkentParts(date).day;
}

function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** True on the last calendar day of the month in Tashkent. */
function isLastDayOfMonthTashkent(date = new Date()) {
  const p = tashkentParts(date);
  return p.day === daysInMonth(p.year, p.month);
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
    sizePlace: clampSize(cfg.sizePlace, 12, 40, DEFAULT_CONFIG.sizePlace),
    sizeName: clampSize(cfg.sizeName, 14, 40, DEFAULT_CONFIG.sizeName),
    sizeHandle: clampSize(cfg.sizeHandle, 10, 28, DEFAULT_CONFIG.sizeHandle),
    sizeTitle: clampSize(cfg.sizeTitle, 12, 28, DEFAULT_CONFIG.sizeTitle),
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

/** Place metals + month banner colors (PUBG-like). */
function palettes(place, month, cfg) {
  const { year, month: mo } = parseMonth(month);
  const style = monthStyleIndex(month);
  const bannerHues = [25, 210, 45, 190, 220, 48, 0, 160, 230, 15, 280, 35];
  const bh = (bannerHues[style] + year * 11) % 360;

  let metal;
  if (place === 1) {
    metal = {
      hi: '#fff6c8', mid: cfg.primary || '#ffd54a', mid2: '#f0a820', lo: '#c47a0a', deep: '#6b3f08', ink: '#3d2406',
    };
  } else if (place === 2) {
    metal = {
      hi: '#ffffff', mid: '#e8eef5', mid2: '#9aa8b8', lo: '#5c6b7a', deep: '#2c3640', ink: '#151a20',
    };
  } else {
    metal = {
      hi: '#f5c89a', mid: '#d4893a', mid2: '#a85c22', lo: '#6e3a12', deep: '#3a1e0a', ink: '#1f1006',
    };
  }

  const banner = {
    top: hsl(bh, 70, place === 1 ? 42 : 32),
    mid: hsl(bh, 75, place === 1 ? 28 : 22),
    bot: hsl(bh, 80, 14),
    text: '#ffffff',
  };
  return { metal, banner, style, year, mo };
}

/** Emblem frame shapes — one family per month style. */
function emblemFrame(uid, m, place, style) {
  const spikes = place === 1 ? 8 : place === 2 ? 6 : 0;
  let extras = '';
  if (spikes) {
    extras = Array.from({ length: spikes }, (_, i) => {
      const a = (i / spikes) * 360 - 90;
      return `<g transform="rotate(${a} 256 168)">
        <path d="M256 48 L264 95 L256 88 L248 95 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.2"/>
      </g>`;
    }).join('');
  }

  // Outer ring / hex / octagon by month
  const shapes = [
    // 0 circle
    `<circle cx="256" cy="168" r="108" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <circle cx="256" cy="168" r="92" fill="${esc(m.deep)}" fill-opacity="0.55"/>`,
    // 1 hex
    `<path d="M256 52 L348 105 V211 L256 264 L164 211 V105 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M256 72 L328 114 V202 L256 244 L184 202 V114 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 2 octagon
    `<path d="M210 58 H302 L354 110 V206 L302 258 H210 L158 206 V110 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M218 78 H294 L330 114 V202 L294 238 H218 L182 202 V114 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 3 star plate
    `<circle cx="256" cy="168" r="110" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <circle cx="256" cy="168" r="88" fill="none" stroke="${esc(m.hi)}" stroke-width="3" opacity="0.4"/>
     <circle cx="256" cy="168" r="78" fill="${esc(m.deep)}" fill-opacity="0.55"/>`,
    // 4 diamond
    `<path d="M256 48 L368 168 L256 288 L144 168 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M256 78 L330 168 L256 258 L182 168 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 5 shield
    `<path d="M256 50 L360 95 V175 Q360 250 256 290 Q152 250 152 175 V95 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M256 70 L338 108 V172 Q338 232 256 262 Q174 232 174 172 V108 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 6 winged circle (top1-ish)
    `<circle cx="256" cy="168" r="100" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <circle cx="256" cy="168" r="82" fill="${esc(m.deep)}" fill-opacity="0.55"/>`,
    // 7 cross plate
    `<rect x="176" y="78" width="160" height="180" rx="28" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <rect x="192" y="94" width="128" height="148" rx="20" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 8 double ring
    `<circle cx="256" cy="168" r="112" fill="none" stroke="url(#metal-${uid})" stroke-width="14"/>
     <circle cx="256" cy="168" r="96" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="3"/>
     <circle cx="256" cy="168" r="78" fill="${esc(m.deep)}" fill-opacity="0.55"/>`,
    // 9 crown crest
    `<path d="M160 200 Q160 70 256 55 Q352 70 352 200 Q352 250 256 275 Q160 250 160 200 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M180 195 Q180 95 256 80 Q332 95 332 195 Q332 230 256 250 Q180 230 180 195 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
    // 10 pointed star badge
    `<circle cx="256" cy="168" r="105" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <circle cx="256" cy="168" r="86" fill="${esc(m.deep)}" fill-opacity="0.55"/>`,
    // 11 ornate hex + ring
    `<circle cx="256" cy="168" r="114" fill="none" stroke="${esc(m.hi)}" stroke-width="3" opacity="0.35"/>
     <path d="M256 52 L348 105 V211 L256 264 L164 211 V105 Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="4"/>
     <path d="M256 72 L328 114 V202 L256 244 L184 202 V114 Z" fill="${esc(m.deep)}" fill-opacity="0.5"/>`,
  ];

  // Side ornaments grow with place
  let wings = '';
  if (place <= 2) {
    const n = place === 1 ? 4 : 2;
    wings = Array.from({ length: n }, (_, i) => {
      const y = 120 + i * 28;
      return `
        <path d="M148 ${y} L90 ${y - 20} L100 ${y + 10} L90 ${y + 40} L148 ${y + 20} Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>
        <path d="M364 ${y} L422 ${y - 20} L412 ${y + 10} L422 ${y + 40} L364 ${y + 20} Z" fill="url(#metal-${uid})" stroke="${esc(m.ink)}" stroke-width="1.5"/>`;
    }).join('');
  }

  return extras + wings + (shapes[style % shapes.length] || shapes[0]);
}

function sparkles(seed) {
  const pts = [[120, 100], [390, 95], [140, 220], [370, 230], [256, 55], [100, 160], [412, 165]];
  return pts.map(([x, y], i) => {
    const s = 6 + ((seed >> i) & 3);
    return `<path transform="translate(${x} ${y})" d="M0 -${s} L${s * 0.25} -${s * 0.25} L${s} 0 L${s * 0.25} ${s * 0.25} L0 ${s} L-${s * 0.25} ${s * 0.25} L-${s} 0 L-${s * 0.25} -${s * 0.25} Z" fill="#fff" opacity="0.7"/>`;
  }).join('');
}

/**
 * Season medal = the approved artwork with only the month + year (and TOP-N) changed.
 * See src/medal-art.js. Old config knobs (colours, pieces, fonts) no longer affect the picture.
 * @param {{ place:1|2|3, month:string }} opts
 */
function generateMedalSvg(opts) {
  return renderMedalSvg({ place: opts.place, month: opts.month || monthKey() });
}

/** List YYYY-MM keys for a year (admin month picker). */
function monthsForYear(year) {
  const y = Number(year) || parseMonth(monthKey()).year;
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

module.exports = {
  DEFAULT_CONFIG,
  FONTS,
  FONT_KEYS,
  PIECE_KEYS,
  monthKey,
  monthLabelEn,
  seasonLabel,
  previousMonthKey,
  tashkentDay,
  tashkentParts,
  isLastDayOfMonthTashkent,
  normalizeConfig,
  titleFor,
  generateMedalSvg,
  monthStyleIndex,
  pieceForPlace,
  monthsForYear,
};
