// Game screen features: move navigation, abort/takeback, rating delta, prefs, no new timers.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const g = read('public/js/game.js'), srv = read('src/server.js'), db = read('src/db.js'), b = read('public/js/board.js');
assert.ok(g.includes('function goView') && g.includes('mnav-btn') && g.includes('movebar'), 'move list navigation');
assert.ok(g.includes("/abort`") && g.includes("/takeback`") && srv.includes("'/games/:id/abort'") && srv.includes("'/games/:id/takeback'"), 'abort + takeback');
assert.ok(db.includes('elo_w_before') && srv.includes('g.rating =') && g.includes('ratingLine'), 'rating change on result');
assert.ok(g.includes('confirmPend') && b.includes('autoQueen'), 'confirm move + auto-queen');
assert.ok(g.includes('pgnText') && g.includes('copyText'), 'PGN copy');
// heat guard: the new code adds no timers, intervals or frame loops
const added = read('public/js/gameprefs.js');
assert.ok(!/setInterval|requestAnimationFrame|setTimeout/.test(added), 'prefs module has no timers');
assert.strictEqual((g.match(/setInterval/g) || []).length, 1, 'game.js keeps only the spectate poll interval');
console.log('game-features OK');
