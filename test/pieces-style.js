// Sanity-check piece-set / board-theme constants stay in sync (server ↔ client).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton', 'studio'];
const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];

const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const pieces = fs.readFileSync(path.join(__dirname, '../public/js/pieces.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
const perf = fs.readFileSync(path.join(__dirname, '../public/js/perf.js'), 'utf8');

assert.ok(server.includes("const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton', 'studio']"));
assert.ok(server.includes("const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio']"));
assert.ok(pieces.includes("export const PIECE_SETS = ['outline', 'classic', 'neo', 'staunton', 'studio']"));
assert.ok(pieces.includes("set === 'studio'") && pieces.includes('STUDIO_FELT'), 'studio ivory/ebony SVG materials');
assert.ok(perf.includes('dataset.view3d') && css.includes('data-view3d="1"'), 'view3d CSS/SVG board depth');

for (const set of PIECE_SETS) {
  assert.ok(pieces.includes(set), `pieces.js mentions ${set}`);
}
for (const b of BOARD_THEMES) {
  assert.ok(css.includes(`data-board="${b}"`), `css board ${b}`);
}
for (const set of PIECE_SETS) {
  assert.ok(css.includes(`data-pieces="${set}"`), `css pieces ${set}`);
}
assert.ok(pieces.includes('BOARD_THEMES'));
assert.ok(pieces.includes('BOARD_SWATCH'));
assert.ok(css.includes('style-opt.board'));
assert.ok(css.includes('.style-preview'));

assert.ok(pieces.includes('function pieceSvg'));
assert.ok(pieces.includes('STAUNTON'));
assert.ok(pieces.includes('clearPieceCache'));
assert.ok(server.includes("DEFAULT_PIECE_SET = 'neo'") && server.includes("DEFAULT_BOARD_THEME = 'green'"));
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert.ok(appJs.includes("applyChessStyle('neo', 'green')"), 'non-premium boot uses neo+green');
assert.ok(pieces.includes(": 'neo'") || pieces.includes(': "neo"'), 'currentPieceSet defaults to neo');

console.log(`ok  pieces-style (${PIECE_SETS.length} sets, ${BOARD_THEMES.length} boards)`);
