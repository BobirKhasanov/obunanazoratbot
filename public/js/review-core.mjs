// Pure game-review maths (no DOM, no chess.js) so it can be unit-tested in Node.
//
// Why win-percentage instead of raw centipawns: losing 100cp when the game is already decided
// (+9 vs +8) is harmless, while losing 100cp in an equal position is a real mistake. Mapping
// the evaluation through a logistic curve ("win chance") and measuring the *drop* in win chance
// gives the same effect Chess.com / Lichess use for move classification and accuracy.

export const MATE = 100000;

/** Win chance (0-100) for the side the score belongs to. cp is clamped so mates saturate. */
export function winPct(cp) {
  const c = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Lichess' per-move accuracy curve: 0 loss -> ~100, 10 loss -> ~62, 20 loss -> ~40. */
export function moveAccuracy(loss) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

export const isMateScore = (cp) => Math.abs(cp) > MATE - 400;
/** Full moves until mate for a mate score (positive = side to move mates). */
export function mateIn(cp) { return Math.ceil((MATE - Math.abs(cp)) / 2) || 1; }

/** White-POV pawn string: "+0.30", "-1.2", "#3", "-#2". */
export function fmtEval(cpWhite) {
  if (cpWhite == null) return '';
  if (isMateScore(cpWhite)) return `${cpWhite < 0 ? '-' : ''}#${mateIn(cpWhite)}`;
  const v = cpWhite / 100;
  const s = Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2);
  return `${v < 0 ? '-' : '+'}${s}`;
}

/** Tag from the drop in win chance (in percentage points) of the player who moved. */
export function tagFromLoss(loss) {
  if (loss < 0.5) return 'best';
  if (loss < 2) return 'excellent';
  if (loss < 5) return 'good';
  if (loss < 10) return 'inaccuracy';
  if (loss < 20) return 'mistake';
  return 'blunder';
}

/**
 * Final tag of one move.
 * @param {{playedIsBest:boolean, loss:number, isBook:boolean, prevLoss:number, sacrifice:boolean,
 *          winBefore:number, winAfter:number}} m
 */
export function classifyMove(m) {
  if (m.isBook) return 'book';
  const loss = m.playedIsBest ? 0 : m.loss;
  // Brilliant: a real piece sacrifice that costs nothing and leaves the mover not worse.
  if (m.sacrifice && loss < 2 && m.winAfter >= 45 && m.winBefore < 92) return 'brilliant';
  // Great: the best move, found right after the opponent let the advantage slip.
  if (m.playedIsBest && m.prevLoss >= 15 && m.winAfter >= 55) return 'great';
  const tag = m.playedIsBest ? 'best' : tagFromLoss(loss);
  // Miss: the opponent just erred and this move fails to punish it.
  if ((tag === 'mistake' || tag === 'blunder') && m.prevLoss >= 15 && loss >= 10 && m.winBefore >= 60) return 'miss';
  return tag;
}

/** Player accuracy 0-100: mean of per-move accuracies (book moves count as perfect). */
export function accuracyOf(rows) {
  if (!rows.length) return 100;
  const sum = rows.reduce((a, r) => a + (r.tag === 'book' ? 100 : moveAccuracy(r.loss)), 0);
  return Math.round((sum / rows.length) * 10) / 10;
}

export const TAGS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function countTags(rows, colour) {
  const out = Object.fromEntries(TAGS.map((k) => [k, 0]));
  for (const r of rows) if (r.colour === colour) out[r.tag] = (out[r.tag] || 0) + 1;
  return out;
}

export const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
