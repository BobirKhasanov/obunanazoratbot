/**
 * Classic Elo rating updates for finished PvP games.
 * K=32 under 2100, K=24 otherwise. Draw = 0.5.
 */

const DEFAULT_ELO = 1200;
const CATS = ['bullet', 'blitz', 'rapid', 'classic'];

function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function kFactor(elo) {
  return elo < 2100 ? 32 : 24;
}

/**
 * @param {number} eloA
 * @param {number} eloB
 * @param {'1-0'|'0-1'|'1/2-1/2'} result  from white's perspective vs black… actually we pass scores for A
 * @param {number} scoreA 1 | 0.5 | 0
 */
function pairUpdate(eloA, eloB, scoreA) {
  const ea = expectedScore(eloA, eloB);
  const eb = 1 - ea;
  const scoreB = 1 - scoreA;
  const nextA = Math.round(eloA + kFactor(eloA) * (scoreA - ea));
  const nextB = Math.round(eloB + kFactor(eloB) * (scoreB - eb));
  return {
    a: Math.max(100, nextA),
    b: Math.max(100, nextB),
    deltaA: nextA - eloA,
    deltaB: nextB - eloB,
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

module.exports = {
  DEFAULT_ELO, CATS, expectedScore, kFactor, pairUpdate, scoresForResult, eloColumn,
};
