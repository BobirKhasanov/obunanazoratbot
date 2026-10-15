// Mate puzzles. A puzzle is a position and "mate in N" for the side to move; no stored solution is needed:
// a move is accepted when it keeps a forced mate within the remaining moves (so every correct line works).
// Pool is grouped by difficulty 1 (easiest) … 10 (hardest). Each Tashkent day picks one per level.

/** @type {{ id: string, diff: number, fen: string, n: number }[]} */
export const PUZZLE_POOL = [
  // 1 — simplest back-rank / edge mates
  { id: '1a', diff: 1, fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', n: 1 },
  { id: '1b', diff: 1, fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1', n: 1 },
  { id: '1c', diff: 1, fen: '6k1/5ppp/8/8/8/8/5PPP/4RRK1 w - - 0 1', n: 1 },
  // 2
  { id: '2a', diff: 2, fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', n: 1 },
  { id: '2b', diff: 2, fen: 'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', n: 1 },
  { id: '2c', diff: 2, fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', n: 1 },
  // 3
  { id: '3a', diff: 3, fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', n: 1 },
  { id: '3b', diff: 3, fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', n: 1 },
  { id: '3c', diff: 3, fen: '7k/5R2/6K1/8/8/8/8/8 w - - 0 1', n: 1 },
  // 4
  { id: '4a', diff: 4, fen: 'k7/2Q5/1K6/8/8/8/8/8 w - - 0 1', n: 1 },
  { id: '4b', diff: 4, fen: '7k/6Q1/6K1/8/8/8/8/8 w - - 0 1', n: 1 },
  { id: '4c', diff: 4, fen: '6k1/3R1ppp/8/8/8/8/5PPP/6K1 w - - 0 1', n: 1 },
  // 5
  { id: '5a', diff: 5, fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', n: 1 },
  { id: '5b', diff: 5, fen: '2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1', n: 1 },
  { id: '5c', diff: 5, fen: '1r4k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1', n: 1 },
  // 6
  { id: '6a', diff: 6, fen: 'r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', n: 1 },
  { id: '6b', diff: 6, fen: '4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', n: 1 },
  { id: '6c', diff: 6, fen: '8/8/8/8/8/4K3/8/4k2R w - - 0 1', n: 1 },
  // 7
  { id: '7a', diff: 7, fen: '5k2/8/5K2/8/8/8/8/7Q w - - 0 1', n: 1 },
  { id: '7b', diff: 7, fen: '8/8/8/8/8/3K4/8/R3k3 w - - 0 1', n: 1 },
  { id: '7c', diff: 7, fen: '3k4/3Q4/3K4/8/8/8/8/8 w - - 0 1', n: 1 },
  // 8 — mate in 2 starts
  { id: '8a', diff: 8, fen: '6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', n: 2 },
  { id: '8b', diff: 8, fen: '7k/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', n: 2 },
  { id: '8c', diff: 8, fen: '5k2/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', n: 2 },
  // 9
  { id: '9a', diff: 9, fen: '6k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1', n: 1 },
  { id: '9b', diff: 9, fen: '6k1/4Rppp/8/8/8/8/5PPP/6K1 w - - 0 1', n: 1 },
  { id: '9c', diff: 9, fen: 'r5k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1', n: 2 },
  // 10 — hardest mate-in-2
  { id: '10a', diff: 10, fen: '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1', n: 2 },
  { id: '10b', diff: 10, fen: 'r5k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1', n: 2 },
  { id: '10c', diff: 10, fen: '7k/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', n: 2 },
];

export function tashkentDayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function seedHash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** One puzzle per difficulty 1–10 for the given Tashkent calendar day. */
export function dailyPuzzles(day = tashkentDayKey()) {
  const byDiff = new Map();
  for (const p of PUZZLE_POOL) {
    const arr = byDiff.get(p.diff) || [];
    arr.push(p);
    byDiff.set(p.diff, arr);
  }
  const out = [];
  for (let d = 1; d <= 10; d++) {
    const arr = byDiff.get(d);
    if (!arr || !arr.length) continue;
    out.push(arr[seedHash(`${day}:${d}`) % arr.length]);
  }
  return out;
}

/** Legacy export: today's 10 puzzles (diff 1…10). */
export const PUZZLES = dailyPuzzles();

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
