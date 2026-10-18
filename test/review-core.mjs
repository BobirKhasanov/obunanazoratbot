// Game-review maths + opening book + a tiny end-to-end check with the real engine.
import assert from 'node:assert';
import { Chess } from 'chess.js';
import { makeEngine } from '../public/js/ai.mjs';
import {
  MATE, winPct, moveAccuracy, fmtEval, mateIn, isMateScore, tagFromLoss, classifyMove, accuracyOf, countTags,
} from '../public/js/review-core.mjs';
import { bookInfo } from '../public/js/openings.mjs';

// win chance: symmetric, saturating
assert.ok(Math.abs(winPct(0) - 50) < 1e-9);
assert.ok(winPct(300) > 70 && winPct(300) < 80);
assert.ok(Math.abs(winPct(200) + winPct(-200) - 100) < 1e-9);
assert.ok(winPct(MATE) > 99);
// accuracy curve: no loss ~100, big loss low
assert.ok(moveAccuracy(0) > 99.9 && moveAccuracy(10) < 70 && moveAccuracy(40) < 25);
// eval strings
assert.strictEqual(fmtEval(30), '+0.30');
assert.strictEqual(fmtEval(-16), '-0.16');
assert.strictEqual(fmtEval(MATE - 5), '#3');
assert.strictEqual(fmtEval(-(MATE - 3)), '-#2');
assert.ok(isMateScore(MATE - 7) && !isMateScore(900));
assert.strictEqual(mateIn(MATE - 1), 1);
// thresholds
assert.deepStrictEqual([0, 1, 3, 7, 15, 40].map(tagFromLoss), ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
const base = { playedIsBest: false, loss: 0, isBook: false, prevLoss: 0, sacrifice: false, winBefore: 50, winAfter: 50 };
assert.strictEqual(classifyMove({ ...base, isBook: true, loss: 50 }), 'book');
assert.strictEqual(classifyMove({ ...base, playedIsBest: true }), 'best');
assert.strictEqual(classifyMove({ ...base, loss: 30 }), 'blunder');
assert.strictEqual(classifyMove({ ...base, sacrifice: true, playedIsBest: true, winAfter: 60 }), 'brilliant');
assert.strictEqual(classifyMove({ ...base, sacrifice: true, winBefore: 97, winAfter: 98, playedIsBest: true }), 'best', 'no brilliancy when already crushing');
assert.strictEqual(classifyMove({ ...base, playedIsBest: true, prevLoss: 25, winAfter: 70 }), 'great');
assert.strictEqual(classifyMove({ ...base, loss: 25, prevLoss: 25, winBefore: 80 }), 'miss');
// accuracy / counts
const rows = [{ colour: 'w', tag: 'best', loss: 0 }, { colour: 'w', tag: 'blunder', loss: 40 }, { colour: 'b', tag: 'book', loss: 0 }];
assert.ok(accuracyOf(rows.filter((r) => r.colour === 'w')) < accuracyOf(rows.filter((r) => r.colour === 'b')));
assert.strictEqual(countTags(rows, 'w').blunder, 1);
// opening book
const it = bookInfo('e4 e5 Nf3 Nc6 Bc4 Bc5 b4'.split(' '));
assert.ok(it.plies >= 6 && /Italian|Evans/.test(it.name), 'Italian/Evans recognised: ' + JSON.stringify(it));
assert.strictEqual(bookInfo(['a3', 'h5']).plies <= 1, true);
assert.strictEqual(bookInfo('e4 e5 Qh5'.split(' ')).plies, 2, 'leaves book at the first non-book move');

// end to end: a blunder that allows mate must be flagged, the mating move is best
const engine = makeEngine(Chess);
const game = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const c = new Chess();
const fens = [c.fen()]; const moves = [];
for (const san of game) { moves.push(c.move(san)); fens.push(c.fen()); }
const E = fens.map((f) => {
  const g = new Chess(f);
  return g.isGameOver() ? (g.isCheckmate() ? -MATE : 0) : engine.bestMove(f, 4, { timeMs: 400 });
});
const score = (k) => (typeof E[k] === 'number' ? E[k] : E[k].score);
const loss = (i) => {
  const best = E[i] && E[i].from ? E[i].from + E[i].to + (E[i].promotion || '') : '';
  const played = moves[i].from + moves[i].to + (moves[i].promotion || '');
  return played === best ? 0 : Math.max(0, winPct(score(i)) - winPct(-score(i + 1)));
};
assert.ok(loss(5) >= 20, `3...Nf6?? should be a blunder (loss ${loss(5).toFixed(1)})`);
assert.strictEqual(loss(6), 0, 'mating move scores no loss');
assert.ok(score(7) === -MATE, 'checkmate position is -MATE for the side to move');
assert.ok(isMateScore(score(6)) && score(6) > 0 && mateIn(score(6)) === 1, 'engine sees mate in 1 before the mating move');
console.log('ok review-core (maths, book, engine blunder)');
