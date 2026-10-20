const assert = require('assert');
const { standings, pairRound, defaultRounds } = require('../src/swiss');

// 8 players, play 3 rounds, nobody meets twice, scores add up
const players = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, rating: 1500 - i * 20 }));
const ids = players.map((p) => p.id);
let games = [];
for (let round = 1; round <= 3; round += 1) {
  const { pairs, bye } = pairRound(ids, players, games, () => 0.3);
  assert.strictEqual(bye, null);
  assert.strictEqual(pairs.length, 4);
  assert.strictEqual(new Set(pairs.flat()).size, 8, 'everyone paired once');
  for (const [w, b] of pairs) {
    assert.ok(!games.some((g) => (g.white === w && g.black === b) || (g.white === b && g.black === w)), 'no rematch');
    games.push({ round, white: w, black: b, result: w < b ? '1-0' : '0-1' }); // better seed always wins
  }
}
const st = standings(players, games);
assert.strictEqual(st[0].id, 1);
assert.strictEqual(st[0].points, 3);
assert.strictEqual(st.reduce((s, r) => s + r.points, 0), 12, '4 games per round x 3 rounds');

// odd count -> a bye, never twice for the same player while others are eligible
const odd = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, rating: 1500 - i }));
const oids = odd.map((p) => p.id);
let og = []; const byes = [];
for (let r = 1; r <= 4; r += 1) {
  const { pairs, bye } = pairRound(oids, odd, og, () => 0.7);
  assert.ok(bye, 'bye exists'); byes.push(bye);
  assert.strictEqual(pairs.length, 2);
  og.push({ round: r, white: bye, black: null, result: 'bye' });
  for (const [w, b] of pairs) og.push({ round: r, white: w, black: b, result: '1/2-1/2' });
}
assert.strictEqual(new Set(byes).size, 4, 'bye rotates');
const ost = standings(odd, og);
assert.ok(ost.every((x) => x.points > 0));

// colours: nobody gets 3 whites in a row
const col = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, rating: 1600 - i }));
let cg = [];
for (let r = 1; r <= 5; r += 1) {
  const { pairs } = pairRound(col.map((p) => p.id), col, cg, () => 0.5);
  pairs.forEach(([w, b], i) => cg.push({ round: r, white: w, black: b, result: i % 2 ? '0-1' : '1-0' }));
}
for (const p of col) {
  const seq = cg.filter((g) => g.white === p.id || g.black === p.id).sort((a, b) => a.round - b.round).map((g) => (g.white === p.id ? 'w' : 'b')).join('');
  assert.ok(!/www|bbb/.test(seq), `colours for ${p.id}: ${seq}`);
}

// buchholz tie-break
const tb = standings([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], [
  { round: 1, white: 1, black: 2, result: '1-0' }, { round: 1, white: 3, black: 4, result: '1-0' },
  { round: 2, white: 1, black: 3, result: '0-1' }, { round: 2, white: 2, black: 4, result: '1-0' },
]);
assert.strictEqual(tb[0].id, 3);
assert.strictEqual(defaultRounds(4), 3); assert.strictEqual(defaultRounds(2), 1); assert.strictEqual(defaultRounds(64), 6); assert.strictEqual(defaultRounds(200), 8);
console.log('swiss ok');
