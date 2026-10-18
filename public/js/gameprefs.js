// In-game preferences (per device). Plain localStorage reads — nothing runs in the background.
const KEY = 'chess-game-prefs';
const DEFAULTS = { premove: 'fast', autoQueen: false, confirmMove: false };
let cache = null;
const load = () => {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* storage blocked */ }
  cache = { ...DEFAULTS, ...saved };
  return cache;
};
export const getPrefs = () => load();
export function setPref(k, v) {
  const p = load(); p[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
/** premove: 'off' | 'fast' (≤3 min games, the default) | 'all' */
export function premoveAllowed(timeControl, baseMs) {
  const m = load().premove;
  if (m === 'off') return false;
  if (m === 'all') return true;
  return baseMs != null && baseMs <= 180000;
}
