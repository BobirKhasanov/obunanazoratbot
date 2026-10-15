// Chess rules on the server. Games are stored as a list of moves and replayed with chess.js,
// so the server never trusts the board a client claims to see.
const { Chess } = require('chess.js');
const { bad } = require('./errors');

const PROMO = ['q', 'r', 'b', 'n'];

/** Rebuild a game from its stored moves: [[from, to, promotion?], ...] */
function replay(moves) {
  const chess = new Chess();
  for (const [from, to, promotion] of moves) chess.move({ from, to, promotion: promotion || undefined });
  return chess;
}

/**
 * Applies one move on top of `moves`. Returns the new moves list plus the outcome if the move
 * ended the game. Throws a 400 'illegal_move' for anything chess.js refuses.
 */
function applyMove(moves, from, to, promotion) {
  const chess = replay(moves);
  const turn = chess.turn();
  const cand = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cand.length) throw bad('Illegal move', 'illegal_move');
  // Pawn promotion must name the piece (Chess.com / FIDE) — refuse bare to-rank moves
  if (cand.some((m) => m.promotion) && !PROMO.includes(promotion)) {
    throw bad('Illegal move', 'illegal_move');
  }
  try {
    chess.move({ from, to, promotion: PROMO.includes(promotion) ? promotion : undefined });
  } catch {
    throw bad('Illegal move', 'illegal_move');
  }
  const next = [...moves, [from, to, PROMO.includes(promotion) ? promotion : null]];
  return { moves: next, ...outcome(chess, turn), check: chess.isCheck() };
}

/** Is the game over after the last move? `mover` is the colour that just moved. */
function outcome(chess, mover) {
  if (chess.isCheckmate()) return { over: true, result: mover === 'w' ? '1-0' : '0-1', reason: 'checkmate' };
  if (chess.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { over: true, result: '1/2-1/2', reason: 'fifty' };
  return { over: false };
}

const turnOf = (moves) => (moves.length % 2 === 0 ? 'w' : 'b');

/**
 * Postgres `jsonb` comes back as a JS array via `pg`; older TEXT columns
 * come back as a string. Accept both so Play / lobby / moves never crash on parse.
 */
function parseMoves(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  if (typeof raw === 'object') return [];
  return JSON.parse(String(raw));
}

/** Canonical JSON text for writing/comparing the moves column (works for TEXT and JSONB). */
const movesJson = (raw) => JSON.stringify(parseMoves(raw));

module.exports = { replay, applyMove, outcome, turnOf, parseMoves, movesJson, PROMO };
