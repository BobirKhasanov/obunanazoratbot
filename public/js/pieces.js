// Chess pieces. Style set via <html data-pieces="…"> (cartoon | outline | classic | neo | staunton | studio).
// Default "cartoon" is a raster set (public/img/pieces/cartoon/wK.webp …); the rest are inline SVG.
export const PIECE_SETS = ['cartoon', 'outline', 'classic', 'neo', 'staunton', 'studio'];
export const DEFAULT_PIECE_SET = 'cartoon';
const IMAGE_SETS = { cartoon: '/img/pieces/cartoon' };
const IMAGE_V = '3';
export const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];
export const BOARD_SWATCH = {
  classic: { lt: '#b9c4d6', dk: '#5f7391' },
  green: { lt: '#eeeed2', dk: '#769656' },
  wood: { lt: '#f0d9b5', dk: '#b58863' },
  blue: { lt: '#cdd7e8', dk: '#5b7fa6' },
  brown: { lt: '#d8c3a5', dk: '#8b5e3c' },
  studio: { lt: '#d7b48a', dk: '#6b4428' },
};
export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const OUTLINE = {
  p: '<path d="M22.5 10a5 5 0 0 0-3 9c-3 1.4-5 4.4-5 8h16c0-3.6-2-6.6-5-8a5 5 0 0 0-3-9z"/><path d="M12 33.5h21v3H12z"/>',
  r: '<path d="M11 10h4v3h3.5v-3h8v3H30v-3h4v8l-3 3v10l3 2.5v3H11v-3L14 31V21l-3-3z"/><path d="M14 21h17"/>',
  n: '<path d="M14 36c0-9 3-11 6-15-2 0-3 1-5 3l-3-2c3-6 7-12 14-12 6 0 10 5 10 13v13z"/><circle cx="21" cy="14.5" r=".9" fill="currentColor" stroke="none"/>',
  b: '<path d="M22.5 8a2.5 2.5 0 0 1 2.5 2.5c0 1-.6 1.8-1.4 2.3C28 15 30 18 30 22c0 3-1.5 5-3 6.5H18C16.5 27 15 25 15 22c0-4 2-7 6.4-9.2-.8-.5-1.4-1.3-1.4-2.3A2.5 2.5 0 0 1 22.5 8z"/><path d="M13 36c2-1.5 4-2 9.5-2s7.5.5 9.5 2v1H13z"/><path d="M22.5 17v6M19.5 20h6"/>',
  q: '<circle cx="9" cy="14" r="2.2"/><circle cx="16" cy="9" r="2.2"/><circle cx="22.5" cy="7.5" r="2.2"/><circle cx="29" cy="9" r="2.2"/><circle cx="36" cy="14" r="2.2"/><path d="M9 16l4 14h19l4-14-7 8-2.5-10-4 10-4-10-2.5 10z"/><path d="M12 33h21v3.5H12z"/>',
  k: '<path d="M22.5 6v7M19 9.5h7"/><path d="M22.5 13c-5 0-9 3-9 8 0 3 2 5 4 6.5V31h10v-3.5c2-1.5 4-3.5 4-6.5 0-5-4-8-9-8z"/><path d="M12 33.5h21v3H12z"/>',
};

const CLASSIC = OUTLINE;

// Neo silhouettes — chunky Chess.com-like proportions in a 45×45 box
const NEO = {
  p: '<path d="M22.5 9.2c-3.1 0-5.5 2.5-5.5 5.6 0 1.7.8 3.2 2 4.2-3.6 1.4-5.9 4.5-5.9 8.5h18.8c0-4-2.3-7.1-5.9-8.5 1.2-1 2-2.5 2-4.2 0-3.1-2.4-5.6-5.5-5.6z"/><path d="M12.2 31.8c1.4-1.1 3.6-1.7 10.3-1.7s8.9.6 10.3 1.7v1.2H12.2z"/><path d="M10.8 34.6h23.4v4.2c0 .6-.5 1.1-1.1 1.1H11.9c-.6 0-1.1-.5-1.1-1.1z"/>',
  r: '<path d="M11.2 8.2h4.4v4H19v-4h7v4h3.4v-4h4.4v8.4l-2.8 2.6v11.2l2.8 2.4v4.2H11.2v-4.2l2.8-2.4V19.2l-2.8-2.6z"/><path d="M14.2 19.4h16.6"/><path d="M9.4 37.2h26.2v2.6H9.4z"/>',
  n: '<path d="M12.4 39.8c-.2-9.8 2.8-13.2 7.2-18.2-2.6.1-4 1.5-6.2 3.8l-3.6-2.6C13.2 15.2 18.2 8.4 26.2 8.4c6.8 0 11.4 5.4 11.4 14.2v17.2z"/><path d="M15.6 12.6c1.4-2.2 3.4-3.6 6.2-3.8"/><circle cx="21.2" cy="14.4" r="1.2" fill="currentColor" stroke="none"/><path d="M10.8 37.4h25.2v2.4H10.8z"/>',
  b: '<path d="M22.5 6.4c1.5 0 2.7 1.2 2.7 2.7 0 1-.5 1.8-1.3 2.3 4.6 2.2 7.6 6.2 7.6 11.2 0 3.6-1.8 6-3.6 7.8h-10.8c-1.8-1.8-3.6-4.2-3.6-7.8 0-5 3-9 7.6-11.2-.8-.5-1.3-1.3-1.3-2.3 0-1.5 1.2-2.7 2.7-2.7z"/><path d="M22.5 15.6v7.4M19 19.3h7"/><path d="M11.2 34.8c2.2-1.6 4.8-2.2 11.3-2.2s9.1.6 11.3 2.2v1.4H11.2z"/><path d="M9.4 37.6h26.2v2.2H9.4z"/>',
  q: '<circle cx="8.4" cy="13.2" r="2.55"/><circle cx="15.4" cy="8" r="2.55"/><circle cx="22.5" cy="6.2" r="2.55"/><circle cx="29.6" cy="8" r="2.55"/><circle cx="36.6" cy="13.2" r="2.55"/><path d="M8.4 15.6l4.4 14.8h20.4l4.4-14.8-7.6 8.4-2.8-10.6-4.3 10.6-4.3-10.6-2.8 10.6z"/><path d="M12.2 33.4h20.6v1.4H12.2z"/><path d="M10.2 36.2h24.6v3.6H10.2z"/>',
  k: '<path d="M22.5 4.2v8.2M18.4 7.8h8.2"/><path d="M22.5 12.2c-5.8 0-10.4 3.6-10.4 9.4 0 3.6 2.4 5.8 4.8 7.4V32h11.2v-3c2.4-1.6 4.8-3.8 4.8-7.4 0-5.8-4.6-9.4-10.4-9.4z"/><path d="M12.2 33.6h20.6v1.3H12.2z"/><path d="M10 36.4h25v3.4H10z"/>',
};

const STAUNTON = {
  p: '<path d="M22.5 9a4.8 4.8 0 0 0-2.8 8.6c-3.2 1.2-5.2 4-5.2 7.9h16c0-3.9-2-6.7-5.2-7.9A4.8 4.8 0 0 0 22.5 9z"/><ellipse cx="22.5" cy="27.5" rx="9" ry="2.2"/><path d="M12 33h21v2.8H12z"/><path d="M13.5 35.8h18v1.6h-18z"/>',
  r: '<path d="M10.5 9h4v3.5h4V9h8v3.5h4V9h4v7.5l-2.8 2.8v11l2.8 2.2v3.2H10.5v-3.2l2.8-2.2v-11L10.5 16.5z"/><path d="M13.2 20.5h18.6"/><path d="M12 35.5h21v2H12z"/>',
  n: '<path d="M13 36c.2-9.2 3.2-12 6.8-16.2-2.4.2-3.6 1.4-5.6 3.4l-3-2.4C14.2 14 18.5 8.5 25.2 8.5 31.5 8.5 36 13.8 36 22.2V36z"/><path d="M18.5 12.5c1.2-1.8 2.8-3 5-3"/><circle cx="21.5" cy="14.8" r="1" fill="currentColor" stroke="none"/><path d="M12 36h23v1.8H12z"/>',
  b: '<path d="M22.5 6.8l1.4 2.4 2.6.2-2 1.8.6 2.6-2.6-1.4-2.6 1.4.6-2.6-2-1.8 2.6-.2z"/><path d="M22.5 13.5c-5 1.8-8 5.5-8 10 0 3.2 1.8 5.5 3.8 7.2h8.4c2-1.7 3.8-4 3.8-7.2 0-4.5-3-8.2-8-10z"/><path d="M22.5 18.5v7M19.2 22h6.6"/><path d="M12.5 35c2-1.4 4.5-2 10-2s8 0.6 10 2v2.5h-20z"/>',
  q: '<circle cx="9" cy="12.5" r="2"/><circle cx="15.8" cy="8.2" r="2"/><circle cx="22.5" cy="6.5" r="2"/><circle cx="29.2" cy="8.2" r="2"/><circle cx="36" cy="12.5" r="2"/><path d="M9 14.5l3.5 13.5h20L36 14.5l-6.5 7.2-2.8-9.2-4.2 9.5-4.2-9.5-2.8 9.2z"/><ellipse cx="22.5" cy="30.5" rx="11" ry="2"/><path d="M12 33.5h21v3.2H12z"/>',
  k: '<path d="M22.5 5v8M18.8 8.5h7.4"/><path d="M22.5 13c-5.5 0-9.5 3.5-9.5 8.8 0 3.5 2.2 5.5 4.5 7V30.5h10v-1.7c2.3-1.5 4.5-3.5 4.5-7 0-5.3-4-8.8-9.5-8.8z"/><ellipse cx="22.5" cy="32" rx="11" ry="2"/><path d="M12 34.2h21v3H12z"/>',
};

const STUDIO = STAUNTON;
const SETS = { outline: OUTLINE, classic: CLASSIC, neo: NEO, staunton: STAUNTON, studio: STUDIO };
const STROKE = {
  outline: '2.35',
  classic: '1.85',
  neo: '1.65',
  staunton: '1.55',
  studio: '1.55',
};

const cache = Object.create(null);

/**
 * Every board in the app (own games, live spectate, live + international tournaments, mini boards,
 * analysis…) draws the same piece art: the raster "cartoon" set. Old saved piece-set choices
 * (outline / classic / neo / staunton / studio) are ignored for boards.
 */
export function currentPieceSet() {
  return DEFAULT_PIECE_SET;
}

const pieceUrl = (set, colour, type) => `${IMAGE_SETS[set]}/${colour}${type.toUpperCase()}.webp?v=${IMAGE_V}`;

/** Warm the HTTP/decode cache so the first board paint doesn't pop in piece by piece. */
export function preloadPieceSet(set = currentPieceSet()) {
  if (!IMAGE_SETS[set] || typeof Image === 'undefined') return;
  for (const c of 'wb') for (const t of 'pnbrqk') {
    const img = new Image();
    img.decoding = 'async';
    img.src = pieceUrl(set, c, t);
  }
}

export function clearPieceCache() {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** Chess.com Neo palette: soft face gradient + strong outline. */
function neoSvg(colour, type, shape, sw) {
  const gid = `neo-${colour}${type}`;
  const body = `stroke-linejoin="round" stroke-linecap="round" stroke-width="${sw}"`;
  const isW = colour === 'w';
  // Chess.com Neo palette
  const stroke = isW ? '#464646' : '#262626';
  const detail = isW ? '#464646' : '#777474';
  const defs = isW
    ? `<linearGradient id="${gid}" x1="0.18" y1="0.05" x2="0.88" y2="0.95"><stop offset="0%" stop-color="#ffffff"/><stop offset="42%" stop-color="#f8f8f8"/><stop offset="100%" stop-color="#d3d3d3"/></linearGradient>`
    : `<linearGradient id="${gid}" x1="0.18" y1="0.05" x2="0.88" y2="0.95"><stop offset="0%" stop-color="#777474"/><stop offset="38%" stop-color="#565352"/><stop offset="100%" stop-color="#454242"/></linearGradient>`;
  const shaped = shape.replace(/fill="currentColor"/g, `style="fill:${detail};stroke:none"`);
  // Inline style beats stylesheet .pc fill so Neo gradients actually show
  return `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} color="${detail}" aria-hidden="true"><defs>${defs}</defs><g style="fill:url(#${gid});stroke:${stroke}">${shaped}</g></svg>`;
}

/** SVG markup for a piece: colour 'w'|'b', type 'pnbrqk'. Optional setOverride for style pickers. */
export function pieceSvg(colour, type, setOverride) {
  const set = PIECE_SETS.includes(setOverride) ? setOverride : currentPieceSet();
  const key = `${set}:${colour}${type}`;
  if (cache[key]) return cache[key];

  if (IMAGE_SETS[set]) {
    cache[key] = `<img class="pc pc-img ${colour}" src="${pieceUrl(set, colour, type)}" alt="" draggable="false" decoding="async" aria-hidden="true">`;
    return cache[key];
  }

  const sw = STROKE[set] || '1.6';
  const body = `stroke-linejoin="round" stroke-linecap="round" stroke-width="${sw}"`;
  const shape = (SETS[set] || OUTLINE)[type] || OUTLINE.p;

  if (set === 'neo' || set === 'classic' || set === 'studio' || set === 'staunton') {
    cache[key] = neoSvg(colour, type, shape, sw);
  } else {
    cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} aria-hidden="true">${shape}</svg>`;
  }
  return cache[key];
}
