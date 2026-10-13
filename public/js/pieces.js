// Minimalist chess pieces drawn as inline SVG (45x45 grid). Fill uses CSS variables so both themes look right.
const BODY = 'stroke-linejoin="round" stroke-linecap="round" stroke-width="1.6"';
const SHAPES = {
  p: '<path d="M22.5 10a5 5 0 0 0-3 9c-3 1.4-5 4.4-5 8h16c0-3.600-2-6.600-5-8a5 5 0 0 0-3-9z"/><path d="M12 33.500h21v3H12z"/>',
  r: '<path d="M11 10h4v3h3.500v-3h8v3H30v-3h4v8l-3 3v10l3 2.500v3H11v-3L14 31V21l-3-3z"/><path d="M14 21h17"/>',
  n: '<path d="M14 36c0-9 3-11 6-15-2 0-3 1-5 3l-3-2c3-6 7-12 14-12 6 0 10 5 10 13v13z"/><circle cx="21" cy="14.500" r=".9" fill="currentColor" stroke="none"/>',
  b: '<path d="M22.500 8a2.500 2.500 0 0 1 2.500 2.500c0 1-.6 1.800-1.400 2.300C28 15 30 18 30 22c0 3-1.500 5-3 6.500H18C16.500 27 15 25 15 22c0-4 2-7 6.400-9.200-.8-.5-1.400-1.300-1.400-2.300A2.500 2.500 0 0 1 22.500 8z"/><path d="M13 36c2-1.500 4-2 9.500-2s7.500.5 9.500 2v1H13z"/><path d="M22.500 17v6M19.500 20h6"/>',
  q: '<circle cx="9" cy="14" r="2.200"/><circle cx="16" cy="9" r="2.200"/><circle cx="22.500" cy="7.500" r="2.200"/><circle cx="29" cy="9" r="2.200"/><circle cx="36" cy="14" r="2.200"/><path d="M9 16l4 14h19l4-14-7 8-2.500-10-4 10-4-10-2.500 10z"/><path d="M12 33h21v3.500H12z"/>',
  k: '<path d="M22.500 6v7M19 9.500h7"/><path d="M22.500 13c-5 0-9 3-9 8 0 3 2 5 4 6.500V31h10v-3.500c2-1.500 4-3.500 4-6.500 0-5-4-8-9-8z"/><path d="M12 33.500h21v3H12z"/>',
};
const cache = {};
/** SVG markup for a piece: colour 'w'|'b', type 'pnbrqk' */
export function pieceSvg(colour, type) {
  const key = colour + type;
  return cache[key] || (cache[key] = `<svg viewBox="0 0 45 45" class="pc ${colour}" ${BODY} aria-hidden="true">${SHAPES[type]}</svg>`);
}
export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
