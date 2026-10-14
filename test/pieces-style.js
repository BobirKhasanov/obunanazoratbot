// Sanity-check piece-set / board-theme constants stay in sync (server ↔ client).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton'];
const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown'];

const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const pieces = fs.readFileSync(path.join(__dirname, '../public/js/pieces.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

assert.ok(server.includes("const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton']"));
assert.ok(server.includes("const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown']"));
assert.ok(pieces.includes("export const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton']"));

for (const set of PIECE_SETS) {
  assert.ok(pieces.includes(set), `pieces.js mentions ${set}`);
}
for (const b of BOARD_THEMES.filter((x) => x !== 'classic')) {
  assert.ok(css.includes(`data-board="${b}"`), `css board ${b}`);
}
for (const set of ['classic', 'neo', 'staunton']) {
  assert.ok(css.includes(`data-pieces="${set}"`), `css pieces ${set}`);
}

assert.ok(pieces.includes('function pieceSvg'));
assert.ok(pieces.includes('STAUNTON'));
assert.ok(pieces.includes('clearPieceCache'));

console.log(`ok  pieces-style (${PIECE_SETS.length} sets, ${BOARD_THEMES.length} boards)`);
