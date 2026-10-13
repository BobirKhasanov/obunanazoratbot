// Engine sanity + strength tests. Run with: node test/ai-test.mjs
import assert from 'node:assert';
import { Chess } from 'chess.js';
import { makeEngine, LEVELS, _internals } from '../public/js/ai.mjs';

const engine = makeEngine(Chess);
const uci = (m) => m.from + m.to + (m.promotion || '');
const lcg = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); };

// 0. The incremental evaluation must equal a full recompute after every kind of move
{
  const { term, delta, ox88 } = _internals;
  const full = (c, eg) => { let s = 0; for (const r of c.board()) for (const p of r) if (p) s += term(p.type, p.color, ox88(p.square), eg); return s; };
  const rng = lcg(5);
  const flags = new Set();
  let checked = 0;
  for (let g = 0; g < 80; g++) {
    const c = new Chess();
    for (let i = 0; i < 150 && !c.isGameOver(); i++) {
      const ms = c._moves();
      const m = ms[Math.floor(rng() * ms.length)];
      for (const eg of [false, true]) {
        const before = full(c, eg);
        const d = delta(m, eg);
        c._makeMove(m);
        const after = full(c, eg);
        c._undoMove();
        assert.strictEqual(before + d, after, `delta mismatch (eg=${eg}, flags=${m.flags})`);
        checked++;
      }
      flags.add(m.flags);
      c._makeMove(m);
    }
  }
  for (const f of [8, 16, 32, 64]) assert.ok([...flags].some((x) => x & f), `test never exercised flag ${f}`);
  console.log(`ok  incremental evaluation matches full recompute (${checked} checks, incl. castling, en passant, promotion)`);
}

// 1. Mate in one must be found by every searching level
const mate1 = [
  ['6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1', 'a1a8'],                                              // back-rank mate
  ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'h5f7'],          // scholar's mate
];
for (const level of [2, 3, 4]) {
  for (const [fen, want] of mate1) {
    const m = engine.bestMove(fen, level, { timeMs: 400 });
    assert.strictEqual(uci(m), want, `level ${level} should mate with ${want}, got ${uci(m)}`);
  }
}
console.log('ok  mate in one found at levels 2-4');

// 2. Game over positions return null
assert.strictEqual(engine.bestMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 3), null); // stalemate
assert.strictEqual(engine.bestMove('R5k1/5ppp/8/8/8/8/8/4K3 b - - 0 1', 3), null); // checkmate
console.log('ok  returns null when the game is over');

// 3. Returned moves are always legal, all levels
{
  const rng = lcg(7);
  for (const level of [1, 2, 3, 4]) {
    const c = new Chess();
    for (let i = 0; i < 24 && !c.isGameOver(); i++) {
      const m = engine.bestMove(c.fen(), level, { timeMs: 60, rng });
      assert.ok(m, 'move expected');
      c.move(m); // throws if illegal
    }
  }
  console.log('ok  moves are always legal (levels 1-4)');
}

// 4. Regression: with a short budget the search window once let a rook-hanging move look "equal"
{
  const fen = '8/8/8/5R2/8/2K5/4k3/8 w - - 10 6'; // Rf1?? would simply lose the rook to Kxf1
  for (const timeMs of [50, 200, 1000]) {
    const m = engine.bestMove(fen, 4, { timeMs });
    assert.notStrictEqual(uci(m), 'f5f1', `must not hang the rook (budget ${timeMs}ms)`);
    const t = new Chess(fen);
    t.move(m);
    assert.ok(!t.moves({ verbose: true }).some((x) => x.captured === 'r'), 'rook must stay safe');
  }
  console.log('ok  does not hang pieces under short time budgets');
}

// 5. Converts basic won endgames against a random defender
{
  const starts = { 'KQ vs K': '8/8/8/4k3/8/8/8/KQ6 w - - 0 1', 'KR vs K': '8/8/8/4k3/8/8/8/KR6 w - - 0 1', 'KRR vs K': '8/8/8/4k3/8/8/8/KRR5 w - - 0 1' };
  for (const [name, fen] of Object.entries(starts)) {
    for (const level of [3, 4]) {
      for (let g = 0; g < 4; g++) {
        const rng = lcg(31 * g + level);
        const c = new Chess(fen);
        const seen = [];
        while (!c.isGameOver() && c.history().length < 100) {
          if (c.turn() === 'w') c.move(engine.bestMove(c.fen(), level, { timeMs: 150, rng, seen }));
          else { const ms = c.moves({ verbose: true }); c.move(ms[Math.floor(rng() * ms.length)]); }
          seen.push(c.fen());
        }
        assert.ok(c.isCheckmate(), `${name}: level ${level} did not mate (game ${g}): ${c.fen()}`);
      }
    }
  }
  console.log('ok  mates with Q / R / RR against a lone king (levels 3-4)');
}

// 6. Strength: each level against a random mover (a random mover must never beat it)
function playVsRandom(level, engineWhite, seed) {
  const rng = lcg(seed);
  const c = new Chess();
  const seen = [];
  while (!c.isGameOver() && c.history().length < 240) {
    if ((c.turn() === 'w') === engineWhite) c.move(engine.bestMove(c.fen(), level, { timeMs: 100, rng, seen }));
    else { const ms = c.moves({ verbose: true }); c.move(ms[Math.floor(rng() * ms.length)]); }
    seen.push(c.fen());
  }
  if (c.isCheckmate()) return (c.turn() === 'w') === engineWhite ? 'loss' : 'win';
  return 'draw';
}
for (const [level, games, minWins] of [[2, 6, 5], [3, 4, 4], [4, 4, 4]]) {
  const r = { win: 0, draw: 0, loss: 0 };
  const t0 = Date.now();
  for (let g = 0; g < games; g++) r[playVsRandom(level, g % 2 === 0, 1000 + g * 17 + level)]++;
  console.log(`    level ${level} vs random (${games} games):`, JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  assert.strictEqual(r.loss, 0, `level ${level} lost to a random mover`);
  assert.ok(r.win >= minWins, `level ${level} should win at least ${minWins}`);
}
console.log('ok  every level beats a random mover');

// 7. Level ordering: the strong engine should not do worse than the casual one
{
  let w = 0, l = 0, d = 0;
  for (let g = 0; g < 4; g++) {
    const rng = lcg(99 + g);
    const c = new Chess();
    const strongWhite = g % 2 === 0;
    while (!c.isGameOver() && c.history().length < 160) {
      const strongTurn = (c.turn() === 'w') === strongWhite;
      c.move(engine.bestMove(c.fen(), strongTurn ? 4 : 2, { timeMs: 150, rng }));
    }
    if (c.isCheckmate()) ((c.turn() === 'w') === strongWhite ? l++ : w++); else d++;
  }
  console.log(`    level 4 vs level 2 (4 games): win ${w}, draw ${d}, loss ${l}`);
  assert.ok(w > l, 'level 4 should beat level 2');
  console.log('ok  strong beats casual');
}

console.log(`All engine tests passed (${LEVELS.length} levels)`);
