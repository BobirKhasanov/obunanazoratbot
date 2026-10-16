// Chess piece SVGs. Style set is chosen via <html data-pieces="…"> (outline | classic | neo | staunton | studio).
// "studio" = ivory/ebony Staunton with soft 3D shading (CSS/SVG — no WebGL; safe on Android TG WebView).
export const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton', 'studio'];
export const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];
export const BOARD_SWATCH = {
  classic: { lt: '#b9c4d6', dk: '#5f7391' },
  green: { lt: '#eedfbb', dk: '#769656' },
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

// Classic / neo reuse outline silhouettes; CSS fill/stroke does the heavy lifting.
const CLASSIC = OUTLINE;
const NEO = {
  p: '<path d="M22.5 9.5a5.5 5.5 0 0 0-3.2 9.5c-3.2 1.3-5.3 4.2-5.3 8h17c0-3.8-2.1-6.7-5.3-8a5.5 5.5 0 0 0-3.2-9.5z"/><path d="M11.5 33h22v3.5h-22z"/>',
  r: '<path d="M10.5 9.5h4.2v3.2h4v-3.2h7.6v3.2h4v-3.2h4.2v8.2l-3.2 3v9.5l3.2 2.4v3.2H10.5v-3.2l3.2-2.4V20.7l-3.2-3z"/><path d="M13.5 20.7h18"/>',
  n: '<path d="M13.5 36c0-9.5 3.2-11.5 6.5-15.5-2.2 0-3.2 1.2-5.2 3.2l-3.2-2.2c3.2-6 7.5-12.2 14.5-12.2 6.2 0 10.5 5.2 10.5 13.5V36z"/><circle cx="21.2" cy="14.2" r="1.1" fill="currentColor" stroke="none"/>',
  b: '<path d="M22.5 7.5a2.8 2.8 0 0 1 2.8 2.8c0 1.1-.7 2-1.5 2.5C28.5 15 30.5 18.2 30.5 22.2c0 3.2-1.6 5.2-3.2 6.8H17.7c-1.6-1.6-3.2-3.6-3.2-6.8 0-4 2.1-7.2 6.7-9.4-.9-.5-1.5-1.4-1.5-2.5a2.8 2.8 0 0 1 2.8-2.8z"/><path d="M12.5 36c2.1-1.6 4.2-2.1 10-2.1s7.9.5 10 2.1v1.2h-20z"/><path d="M22.5 16.5v6.5M19.2 19.8h6.6"/>',
  q: '<circle cx="9" cy="13.5" r="2.4"/><circle cx="16" cy="8.5" r="2.4"/><circle cx="22.5" cy="7" r="2.4"/><circle cx="29" cy="8.5" r="2.4"/><circle cx="36" cy="13.5" r="2.4"/><path d="M9 15.5l4.2 14.2h18.6L36 15.5l-7.2 8-2.6-10.2-4.2 10.2-4.2-10.2-2.6 10.2z"/><path d="M11.5 32.5h22v3.8h-22z"/>',
  k: '<path d="M22.5 5.5v7.5M18.5 9h8"/><path d="M22.5 12.5c-5.2 0-9.5 3.2-9.5 8.5 0 3.2 2.1 5.2 4.2 6.8V31.5h10.6v-3.7c2.1-1.6 4.2-3.6 4.2-6.8 0-5.3-4.3-8.5-9.5-8.5z"/><path d="M11.5 33h22v3.5h-22z"/>',
};

// Staunton-ish: extra base rings / crown detail
const STAUNTON = {
  p: '<path d="M22.5 9a4.8 4.8 0 0 0-2.8 8.6c-3.2 1.2-5.2 4-5.2 7.9h16c0-3.9-2-6.7-5.2-7.9A4.8 4.8 0 0 0 22.5 9z"/><ellipse cx="22.5" cy="27.5" rx="9" ry="2.2"/><path d="M12 33h21v2.8H12z"/><path d="M13.5 35.8h18v1.6h-18z"/>',
  r: '<path d="M10.5 9h4v3.5h4V9h8v3.5h4V9h4v7.5l-2.8 2.8v11l2.8 2.2v3.2H10.5v-3.2l2.8-2.2v-11L10.5 16.5z"/><path d="M13.2 20.5h18.6"/><path d="M12 35.5h21v2H12z"/>',
  n: '<path d="M13 36c.2-9.2 3.2-12 6.8-16.2-2.4.2-3.6 1.4-5.6 3.4l-3-2.4C14.2 14 18.5 8.5 25.2 8.5 31.5 8.5 36 13.8 36 22.2V36z"/><path d="M18.5 12.5c1.2-1.8 2.8-3 5-3"/><circle cx="21.5" cy="14.8" r="1" fill="currentColor" stroke="none"/><path d="M12 36h23v1.8H12z"/>',
  b: '<path d="M22.5 6.8l1.4 2.4 2.6.2-2 1.8.6 2.6-2.6-1.4-2.6 1.4.6-2.6-2-1.8 2.6-.2z"/><path d="M22.5 13.5c-5 1.8-8 5.5-8 10 0 3.2 1.8 5.5 3.8 7.2h8.4c2-1.7 3.8-4 3.8-7.2 0-4.5-3-8.2-8-10z"/><path d="M22.5 18.5v7M19.2 22h6.6"/><path d="M12.5 35c2-1.4 4.5-2 10-2s8 0.6 10 2v2.5h-20z"/>',
  q: '<circle cx="9" cy="12.5" r="2"/><circle cx="15.8" cy="8.2" r="2"/><circle cx="22.5" cy="6.5" r="2"/><circle cx="29.2" cy="8.2" r="2"/><circle cx="36" cy="12.5" r="2"/><path d="M9 14.5l3.5 13.5h20L36 14.5l-6.5 7.2-2.8-9.2-4.2 9.5-4.2-9.5-2.8 9.2z"/><ellipse cx="22.5" cy="30.5" rx="11" ry="2"/><path d="M12 33.5h21v3.2H12z"/>',
  k: '<path d="M22.5 5v8M18.8 8.5h7.4"/><path d="M22.5 13c-5.5 0-9.5 3.5-9.5 8.8 0 3.5 2.2 5.5 4.5 7V30.5h10v-1.7c2.3-1.5 4.5-3.5 4.5-7 0-5.3-4-8.8-9.5-8.8z"/><ellipse cx="22.5" cy="32" rx="11" ry="2"/><path d="M12 34.2h21v3H12z"/>',
};

// Studio reuses Staunton silhouettes; felt pad is drawn separately (green, not body fill)
const STUDIO = STAUNTON;
const STUDIO_FELT = {
  p: 8.5, r: 9.2, n: 9, b: 9, q: 9.5, k: 9.5,
};

const SETS = { outline: OUTLINE, classic: CLASSIC, neo: NEO, staunton: STAUNTON, studio: STUDIO };
const STROKE = {
  outline: '2.35',
  classic: '1.7',
  neo: '2.05',
  staunton: '1.55',
  studio: '1.35',
};

const cache = Object.create(null);

export function currentPieceSet() {
  const v = typeof document !== 'undefined' ? document.documentElement.dataset.pieces : '';
  return PIECE_SETS.includes(v) ? v : 'neo';
}

export function clearPieceCache() {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** SVG markup for a piece: colour 'w'|'b', type 'pnbrqk'. Optional setOverride for style pickers. */
export function pieceSvg(colour, type, setOverride) {
  const set = PIECE_SETS.includes(setOverride) ? setOverride : currentPieceSet();
  const shapes = SETS[set] || OUTLINE;
  const key = `${set}:${colour}${type}`;
  if (cache[key]) return cache[key];
  const sw = STROKE[set] || '1.6';
  const body = `stroke-linejoin="round" stroke-linecap="round" stroke-width="${sw}"`;
  const shape = shapes[type] || OUTLINE.p;
  // Neo: soft interior shading like modern vector sets (cream board reference)
  if (set === 'neo') {
    const gid = `neo-${colour}${type}`;
    const defs = colour === 'w'
      ? `<linearGradient id="${gid}" x1="0.15" y1="0.05" x2="0.9" y2="0.95"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#dbe3ee"/></linearGradient>`
      : `<linearGradient id="${gid}" x1="0.15" y1="0.05" x2="0.9" y2="0.95"><stop offset="0%" stop-color="#334155"/><stop offset="45%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/></linearGradient>`;
    const stroke = colour === 'w' ? '#334155' : '#020617';
    cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} stroke="${stroke}" aria-hidden="true"><defs>${defs}</defs><g fill="url(#${gid})">${shape}</g></svg>`;
  } else if (set === 'studio') {
    // Ivory / ebony studio materials + green felt (reference sheet) — still flat SVG for mobile perf
    const gid = `st-${colour}${type}`;
    const hilite = `st-h-${colour}${type}`;
    const defs = colour === 'w'
      ? `<linearGradient id="${gid}" x1="0.2" y1="0.02" x2="0.85" y2="1"><stop offset="0%" stop-color="#fffdf8"/><stop offset="40%" stop-color="#f3ebe0"/><stop offset="78%" stop-color="#e2d2bc"/><stop offset="100%" stop-color="#cbb79a"/></linearGradient>`
        + `<linearGradient id="${hilite}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="45%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.12"/></linearGradient>`
      : `<linearGradient id="${gid}" x1="0.2" y1="0.02" x2="0.85" y2="1"><stop offset="0%" stop-color="#3a3a3c"/><stop offset="42%" stop-color="#1c1c1e"/><stop offset="100%" stop-color="#0a0a0b"/></linearGradient>`
        + `<linearGradient id="${hilite}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="50%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.35"/></linearGradient>`;
    const stroke = colour === 'w' ? '#5c4a36' : '#000000';
    const feltR = STUDIO_FELT[type] || 9;
    cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour} studio" ${body} stroke="${stroke}" aria-hidden="true"><defs>${defs}</defs>`
      + `<ellipse class="felt" cx="22.5" cy="38.4" rx="${feltR}" ry="1.4" fill="#2f6b3a" stroke="none"/>`
      + `<g fill="url(#${gid})">${shape}</g>`
      + `<rect x="10" y="6" width="10" height="28" rx="5" fill="url(#${hilite})" opacity="0.55" stroke="none"/>`
      + `</svg>`;
  } else {
    cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour}" ${body} aria-hidden="true">${shape}</svg>`;
  }
  return cache[key];
}
