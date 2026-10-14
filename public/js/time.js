// Mirrors server time-control presets (home screen chips → live clocks).
export const PRESETS = {
  '1+0': { baseMs: 60_000, incMs: 0, category: 'bullet', label: '1+0' },
  '1+1': { baseMs: 60_000, incMs: 1_000, category: 'bullet', label: '1+1' },
  '2+1': { baseMs: 120_000, incMs: 1_000, category: 'bullet', label: '2+1' },
  '3+0': { baseMs: 180_000, incMs: 0, category: 'blitz', label: '3+0' },
  '3+2': { baseMs: 180_000, incMs: 2_000, category: 'blitz', label: '3+2' },
  '5+0': { baseMs: 300_000, incMs: 0, category: 'blitz', label: '5+0' },
  '10+0': { baseMs: 600_000, incMs: 0, category: 'rapid', label: '10+0' },
  '15+10': { baseMs: 900_000, incMs: 10_000, category: 'rapid', label: '15+10' },
  '30+0': { baseMs: 1_800_000, incMs: 0, category: 'rapid', label: '30+0' },
  classic: { baseMs: null, incMs: 0, category: 'classic', label: '∞' },
};

const LEGACY = { bullet: '1+0', blitz: '3+2', rapid: '10+0', classic: 'classic' };

export function normalizeTimeControl(raw) {
  if (raw && PRESETS[raw]) return raw;
  if (raw && LEGACY[raw]) return LEGACY[raw];
  return 'classic';
}

export function presetOf(raw) {
  return PRESETS[normalizeTimeControl(raw)];
}

export function categoryOf(raw) {
  return presetOf(raw).category;
}

export function isTimed(raw) {
  return presetOf(raw).baseMs != null;
}

export function formatClock(ms) {
  const n = Math.max(0, Math.ceil(Number(ms) / 1000));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Live remaining for one side from a game.clock snapshot. */
export function remainingMs(clock, side, turn, status, now = Date.now()) {
  if (!clock) return null;
  let ms = side === 'w' ? clock.whiteMs : clock.blackMs;
  if (ms == null) return null;
  if (status === 'active' && turn === side && clock.turnStartedAt) {
    const started = Date.parse(clock.turnStartedAt);
    const skew = clock.serverNow ? now - Date.parse(clock.serverNow) : 0;
    ms -= Math.max(0, now - skew - started);
  }
  return Math.max(0, ms);
}
