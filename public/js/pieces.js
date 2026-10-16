// Chess piece SVGs. Style set via <html data-pieces="…"> (outline | classic | neo | staunton | studio).
// Default "neo" matches Chess.com-style flat pieces: large, outlined, centered in the square.
export const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton', 'studio'];
export const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];
export const BOARD_SWATCH = {
  classic: { lt: '#b9c4d6', dk: '#5f7391' },
  // Chess.com green board
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
// Chess.com-like neo silhouettes (fill the 45×45 viewBox)
const NEO = {
  p: '<path d="M22.5 9a5.8 5.8 0 0 0-3.4 10.2c-3.4 1.2-5.6 4.2-5.6 8.3h18c0-4.1-2.2-7.1-5.6-8.3A5.8 5.8 0 0 0 22.5 9z"/><path d="M11 32.5h23v4H11z"/>',
  r: '<path d="M9.5 8.5h4.5v3.5h4V8.5h9v3.5h4V8.5H36v8.5l-3.5 3v10.5l3.5 2.5v3.5H9.5v-3.5l3.5-2.5V20l-3.5-3z"/><path d="M13 19.5h19"/>',
  n: '<path d="M12.5 36.5c0-10 3.5-12 7-16.5-2.4 0-3.5 1.3-5.6 3.4l-3.4-2.3C14 14.5 18.5 8 26 8c6.5 0 11 5.5 11 14.5V36.5z"/><circle cx="21.5" cy="14" r="1.15" fill="currentColor" stroke="none"/>',
  b: '<path d="M22.5 7a3 3 0 0 1 3 3c0 1.15-.7 2.1-1.6 2.6C29 15 31.5 18.5 31.5 23c0 3.4-1.7 5.6-3.4 7.2H16.4c-1.7-1.6-3.4-3.8-3.4-7.2 0-4.5 2.5-8 7.1-10.4-.9-.5-1.6-1.45-1.6-2.6a3 3 0 0 1 3-3z"/><path d="M12 36.5c2.2-1.6 4.5-2.2 10.5-2.2s8.3.6 10.5 2.2v1.5H12z"/><path d="M22.5 16v7M19 19.5h7"/>',
  q: '<circle cx="8.5" cy="13" r="2.5"/><circle cx="15.5" cy="8" r="2.5"/><circle cx="22.5" cy="6.5" r="2.5"/><circle cx="29.5" cy="8" r="2.5"/><circle cx="36.5" cy="13" r="2.5"/><path d="M8.5 15.5l4.5 14.5h19l4.5-14.5-7.5 8.2-2.8-10.5-4.2 10.5-4.2-10.5-2.8 10.5z"/><path d="M11 33h23v4H11z"/>',
  k: '<path d="M22.5 5v8M18.5 8.5h8"/><path d="M22.5 12c-5.5 0-10 3.4-10 9 0 3.4 2.2 5.5 4.5 7.2V32h11v-3.8c2.3-1.7 4.5-3.8 4.5-7.2 0-5.6-4.5-9-10-9z"/><path d="M11 33.5h23v3.5H11z"/>',
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
  neo: '1.9',
  staunton: '1.55',
  studio: '1.55',
};

const cache = Object.create(null);

export function currentPieceSet() {
  const v = typeof document !== 'undefined' ? document.documentElement.dataset.pieces : '';
  return PIECE_SETS.includes(v) ? v : 'neo';
}

export function clearPieceCache() {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** Chess.com-style neo: solid fill + strong outline (no tiny extruded layers). */
function neoSvg(colour, type, shape, sw) {
  const body = `stroke-linejoin="round" stroke-linecap="round" stroke-width="${sw}"`;
  const fill = colour === 'w' ? '#f0f0f0' : '#2c2c2c';
  const stroke = colour === 'w' ? '#1a1a1a' : '#f0f0f0';
  const eye = colour === 'w' ? '#1a1a1a' : '#f0f0f0';
  const shaped = shape.replace(/fill="currentColor"/g, `fill="${eye}"`);
  return `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} fill="${fill}" stroke="${stroke}" aria-hidden="true">${shaped}</svg>`;
}

/** SVG markup for a piece: colour 'w'|'b', type 'pnbrqk'. Optional setOverride for style pickers. */
export function pieceSvg(colour, type, setOverride) {
  const set = PIECE_SETS.includes(setOverride) ? setOverride : currentPieceSet();
  const key = `${set}:${colour}${type}`;
  if (cache[key]) return cache[key];

  const sw = STROKE[set] || '1.6';
  const body = `stroke-linejoin="round" stroke-linecap="round" stroke-width="${sw}"`;
  const shape = (SETS[set] || OUTLINE)[type] || OUTLINE.p;

  if (set === 'neo' || set === 'classic' || set === 'studio' || set === 'staunton') {
    // Same Chess.com-like rendering for the common sets (large, readable, centered)
    cache[key] = neoSvg(colour, type, shape, sw);
  } else {
    cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} aria-hidden="true">${shape}</svg>`;
  }
  return cache[key];
}
