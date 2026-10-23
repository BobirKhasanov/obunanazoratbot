const assert = require('assert');
const { pairUpdate, rdAfterIdle, INITIAL_RD } = require('../src/elo');

// settled players, equal rating: small, symmetric-ish swings (chess.com-like ±5…12)
let u = pairUpdate(1500, 1500, 1);
assert.ok(u.deltaA >= 4 && u.deltaA <= 14, `equal win ${u.deltaA}`);
assert.ok(u.deltaB <= -4 && u.deltaB >= -14, `equal loss ${u.deltaB}`);
// beating a much weaker player is worth little but never 0; losing to them hurts, but not the old −28
u = pairUpdate(1500, 1200, 1);
assert.ok(u.deltaA >= 1 && u.deltaA <= 4, `weak win ${u.deltaA}`);
u = pairUpdate(1500, 1200, 0);
assert.ok(u.deltaA <= -10 && u.deltaA >= -20, `weak loss ${u.deltaA}`);
// draw vs stronger player gains, vs weaker loses a little
assert.ok(pairUpdate(1300, 1500, 0.5).deltaA > 0);
assert.ok(pairUpdate(1500, 1300, 0.5).deltaA < 0);
// new players (big RD) move faster than settled ones, within the cap
const fresh = pairUpdate(1200, 1200, 1, INITIAL_RD, INITIAL_RD);
assert.ok(fresh.deltaA > u.deltaA && fresh.deltaA <= 60, `fresh ${fresh.deltaA}`);
assert.ok(fresh.rdA < INITIAL_RD, 'RD shrinks after a game');
// idle players become uncertain again, capped
assert.ok(rdAfterIdle(50, 60) > 50 && rdAfterIdle(50, 100000) === INITIAL_RD);
console.log('glicko: ok');
