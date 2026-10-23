/**
 * Glicko-style rating updates for finished PvP games (chess.com-like). Draw = 0.5.
 */

const DEFAULT_ELO = 1200;
const CATS = ['bullet', 'blitz', 'rapid', 'classic'];

function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Glicko (the system chess.com uses): every rating has a "rating deviation" (RD).
 *  New / returning players have a big RD → their rating moves fast; regulars have a small RD → ±5…12 a game. */
const INITIAL_RD = 250;
const MIN_RD = 50;
const RD_PER_DAY = 6;     // uncertainty that creeps back in per idle day
const MAX_STEP = 60;      // never more than this in one game
const Q = Math.log(10) / 400;

const gFactor = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));

/** RD after `days` without playing. */
function rdAfterIdle(rd, days) {
  const r = Number(rd) || INITIAL_RD;
  return Math.min(INITIAL_RD, Math.sqrt(r * r + RD_PER_DAY * RD_PER_DAY * Math.max(0, Number(days) || 0)));
}

function glickoSide(r, rd, rOpp, rdOpp, score) {
  const g = gFactor(rdOpp);
  const e = 1 / (1 + 10 ** ((-g * (r - rOpp)) / 400));
  const d2 = 1 / (Q * Q * g * g * e * (1 - e));
  const denom = 1 / (rd * rd) + 1 / d2;
  let delta = (Q / denom) * g * (score - e);
  delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, delta));
  let step = Math.round(delta);
  if (score === 1 && step < 1) step = 1;   // a win always counts
  if (score === 0 && step > -1) step = -1; // a loss always counts
  return { next: Math.max(100, Math.round(r) + step), rd: Math.max(MIN_RD, Math.round(Math.sqrt(1 / denom))) };
}

/**
 * @param {number} eloA @param {number} eloB
 * @param {number} scoreA 1 | 0.5 | 0
 * @param {number} [rdA] @param {number} [rdB] rating deviations (default: settled player)
 */
function pairUpdate(eloA, eloB, scoreA, rdA = MIN_RD, rdB = MIN_RD) {
  const A = glickoSide(eloA, rdA, eloB, rdB, scoreA);
  const B = glickoSide(eloB, rdB, eloA, rdA, 1 - scoreA);
  return {
    a: A.next, b: B.next, deltaA: A.next - eloA, deltaB: B.next - eloB, rdA: A.rd, rdB: B.rd,
  };
}

/** result is game result string from white's perspective. */
function scoresForResult(result) {
  if (result === '1-0') return { white: 1, black: 0 };
  if (result === '0-1') return { white: 0, black: 1 };
  return { white: 0.5, black: 0.5 };
}

function eloColumn(category) {
  if (CATS.includes(category)) return `elo_${category}`;
  return 'elo_classic';
}

/**
 * Quick-match Elo window: start ±80, +80 every 5s of waiting, cap ±800.
 * @param {number} sinceMs  search start (Date.now() ms)
 * @param {number} [nowMs]
 */
function expandingEloDelta(sinceMs, nowMs = Date.now()) {
  const t0 = Number(sinceMs) || nowMs;
  const waited = Math.max(0, nowMs - t0);
  const steps = Math.floor(waited / 5_000);
  return Math.min(800, 80 + steps * 80);
}

module.exports = {
  DEFAULT_ELO, CATS, INITIAL_RD, MIN_RD, expectedScore, rdAfterIdle, pairUpdate, scoresForResult, eloColumn, expandingEloDelta,
};
