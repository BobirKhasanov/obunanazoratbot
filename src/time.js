// Chess time-control presets selected on the home screen.
// `classic` (and the "Any" option) means correspondence: no live clock.
const { parseMoves, turnOf } = require('./game');

const PRESETS = {
  '1+0': { baseMs: 60_000, incMs: 0, category: 'bullet', label: '1+0' },
  '3+2': { baseMs: 180_000, incMs: 2_000, category: 'blitz', label: '3+2' },
  '5+0': { baseMs: 300_000, incMs: 0, category: 'blitz', label: '5+0' },
  '10+0': { baseMs: 600_000, incMs: 0, category: 'rapid', label: '10+0' },
  '15+10': { baseMs: 900_000, incMs: 10_000, category: 'rapid', label: '15+10' },
  classic: { baseMs: null, incMs: 0, category: 'classic', label: '∞' },
};

// Older rows stored only the ranking category
const LEGACY = { bullet: '1+0', blitz: '3+2', rapid: '10+0', classic: 'classic' };

const PRESET_IDS = Object.keys(PRESETS);

function normalizeTimeControl(raw) {
  if (raw && PRESETS[raw]) return raw;
  if (raw && LEGACY[raw]) return LEGACY[raw];
  return 'classic';
}

function presetOf(raw) {
  return PRESETS[normalizeTimeControl(raw)];
}

function categoryOf(raw) {
  return presetOf(raw).category;
}

function isTimed(raw) {
  return presetOf(raw).baseMs != null;
}

/** Remaining ms for the side to move after draining the active turn up to `now`. */
function settleClocks(row, now = Date.now()) {
  const spec = presetOf(row.time_control);
  if (spec.baseMs == null || row.white_ms == null || row.black_ms == null) {
    return { timed: false, whiteMs: null, blackMs: null, flagged: null };
  }
  let whiteMs = Number(row.white_ms);
  let blackMs = Number(row.black_ms);
  if (row.status !== 'active' || !row.turn_started_at) {
    return { timed: true, whiteMs, blackMs, flagged: null };
  }
  const started = new Date(row.turn_started_at).getTime();
  const elapsed = Math.max(0, now - started);
  const turn = turnOf(parseMoves(row.moves));
  if (turn === 'w') {
    whiteMs -= elapsed;
    if (whiteMs <= 0) return { timed: true, whiteMs: 0, blackMs, flagged: 'w' };
  } else {
    blackMs -= elapsed;
    if (blackMs <= 0) return { timed: true, whiteMs, blackMs: 0, flagged: 'b' };
  }
  return { timed: true, whiteMs, blackMs, flagged: null };
}

/** After a legal move by `mover`, apply elapsed time + increment and start the opponent's clock. */
function afterMoveClocks(row, mover, now = Date.now()) {
  const spec = presetOf(row.time_control);
  if (spec.baseMs == null) return null;
  const settled = settleClocks(row, now);
  if (!settled.timed) return null;
  if (settled.flagged) return settled;
  let { whiteMs, blackMs } = settled;
  if (mover === 'w') whiteMs += spec.incMs;
  else blackMs += spec.incMs;
  return { timed: true, whiteMs, blackMs, flagged: null, turnStartedAt: new Date(now) };
}

function formatClock(ms) {
  const n = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = {
  PRESETS, PRESET_IDS, LEGACY,
  normalizeTimeControl, presetOf, categoryOf, isTimed,
  settleClocks, afterMoveClocks, formatClock,
};
