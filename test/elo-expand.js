const assert = require('assert');
const { expandingEloDelta } = require('../src/elo');

const t0 = 1_000_000;
assert.strictEqual(expandingEloDelta(t0, t0), 80, 'starts at ±80');
assert.strictEqual(expandingEloDelta(t0, t0 + 4_999), 80, 'under 5s still ±80');
assert.strictEqual(expandingEloDelta(t0, t0 + 5_000), 160, '+80 at 5s');
assert.strictEqual(expandingEloDelta(t0, t0 + 20_000), 400, 'grows with wait');
assert.strictEqual(expandingEloDelta(t0, t0 + 100_000), 800, 'caps at ±800');
assert.strictEqual(expandingEloDelta(null, t0), 80, 'missing since → min window');

console.log('elo-expand: ok');
