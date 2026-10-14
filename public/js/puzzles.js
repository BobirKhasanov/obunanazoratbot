// Mate puzzles. A puzzle is a position and "mate in N" for the side to move; no stored solution is needed:
// a move is accepted when it keeps a forced mate within the remaining moves (so every correct line works).
export const PUZZLES = [
  { id: 1, fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', n: 1 },
  { id: 2, fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', n: 1 },
  { id: 3, fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', n: 1 },
  { id: 4, fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', n: 1 },
  { id: 5, fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1', n: 1 },
  { id: 6, fen: 'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', n: 1 },
  { id: 7, fen: 'r5k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1', n: 2 },
  { id: 8, fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', n: 1 },
  { id: 9, fen: '6k1/5ppp/8/8/8/8/5PPP/4RRK1 w - - 0 1', n: 1 },
  { id: 10, fen: '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1', n: 2 },
];

/** Is there a forced mate in <= n moves for the side to move? `chess` is mutated and restored. */
export function mateIn(chess, n) {
  for (const m of chess.moves()) {
    chess.move(m);
    let ok = chess.isCheckmate();
    if (!ok && n > 1 && !chess.isGameOver()) {
      const replies = chess.moves();
      ok = replies.length > 0 && replies.every((r) => { chess.move(r); const w = mateIn(chess, n - 1); chess.undo(); return w; });
    }
    chess.undo();
    if (ok) return true;
  }
  return false;
}
/** Moves (verbose) that keep a forced mate within n moves */
export function goodMoves(chess, n) {
  const out = [];
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    let ok = chess.isCheckmate();
    if (!ok && n > 1 && !chess.isGameOver()) {
      const replies = chess.moves();
      ok = replies.length > 0 && replies.every((r) => { chess.move(r); const w = mateIn(chess, n - 1); chess.undo(); return w; });
    }
    chess.undo();
    if (ok) out.push(m);
  }
  return out;
}
