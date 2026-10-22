// Mirrors server time-control presets (home screen chips → live clocks).
export const PRESETS = {
  '1+0': { baseMs: 60000, incMs: 0, category: 'bullet', label: '1+0' },
  '1+1': { baseMs: 60000, incMs: 1000, category: 'bullet', label: '1+1' },
  '2+1': { baseMs: 120000, incMs: 1000, category: 'bullet', label: '2+1' },
  '3+0': { baseMs: 180000, incMs: 0, category: 'blitz', label: '3+0' },
  '3+2': { baseMs: 180000, incMs: 2000, category: 'blitz', label: '3+2' },
  '5+0': { baseMs: 300000, incMs: 0, category: 'blitz', label: '5+0' },
  '10+0': { baseMs: 600000, incMs: 0, category: 'rapid', label: '10+0' },
  '15+10': { baseMs: 900000, incMs: 10000, category: 'rapid', label: '15+10' },
  '30+0': { baseMs: 1800000, incMs: 0, category: 'rapid', label: '30+0' },
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

/** Finished-game wall clock in Asia/Tashkent (no zone label in UI). */
export function formatTashkentWhen(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${g('day')}.${g('month')}.${g('year')} · ${g('hour')}:${g('minute')}`;
}

const tashkentParts = (d) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (k) => (parts.find((p) => p.type === k) || {}).value || '';
  // some engines print midnight as 24
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') === '24' ? '00' : g('hour'), mi: g('minute') };
};

/** Upcoming event time in Asia/Tashkent: "HH:MM" today, else "DD.MM HH:MM". Same zone on every device. */
export function formatTashkentShort(ts) {
  if (ts == null || ts === '') return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = tashkentParts(d);
  const n = tashkentParts(new Date());
  const today = p.y === n.y && p.mo === n.mo && p.d === n.d;
  return `${today ? '' : `${p.d}.${p.mo} `}${p.h}:${p.mi}`;
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
