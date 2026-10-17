// Sanity-check piece-set / board-theme constants stay in sync (server ↔ client).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PIECE_SETS = ['cartoon', 'outline', 'classic', 'neo', 'staunton', 'studio'];
const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio'];

const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const pieces = fs.readFileSync(path.join(__dirname, '../public/js/pieces.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
const perf = fs.readFileSync(path.join(__dirname, '../public/js/perf.js'), 'utf8');

assert.ok(server.includes("const PIECE_SETS = ['cartoon', 'outline', 'classic', 'neo', 'staunton', 'studio']"));
assert.ok(server.includes("const BOARD_THEMES = ['classic', 'green', 'wood', 'blue', 'brown', 'studio']"));
assert.ok(pieces.includes("export const PIECE_SETS = ['cartoon', 'outline', 'classic', 'neo', 'staunton', 'studio']"));
assert.ok(pieces.includes('neoSvg') && pieces.includes('#f8f8f8') && pieces.includes('#565352') && pieces.includes('linearGradient') && pieces.includes('neo-'), 'Chess.com Neo palette + gradients');
assert.ok(!pieces.includes('extruded3dSvg') && !pieces.includes('useExtruded3d'), 'no extruded 3D pieces (reverted)');
assert.ok(css.includes('#eeeed2') && css.includes('#769656'), 'Chess.com green board colors');
assert.ok(!/board-host\s*\{[^}]*padding:\s*5\.2%/.test(css), 'no wood frame padding on board-host');
assert.ok(/\.piece\s*\{[^}]*padding:\s*1\.5%/.test(css), 'pieces fill the square like Chess.com');
assert.ok(perf.includes('dataset.view3d'), 'perf still exposes view3d flag');

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
assert.ok(server.includes("DEFAULT_PIECE_SET = 'cartoon'") && server.includes("DEFAULT_BOARD_THEME = 'green'"));
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert.ok(appJs.includes("applyChessStyle(DEFAULT_PIECE_SET, 'green')"), 'non-premium boot uses default set + green');
assert.ok(pieces.includes("export const DEFAULT_PIECE_SET = 'cartoon'"), 'cartoon is the default piece set');
assert.ok(/export function currentPieceSet\(\) \{\s*return DEFAULT_PIECE_SET;\s*\}/.test(pieces), 'every board uses the one (cartoon) piece art');
{
  const profileJs = fs.readFileSync(path.join(__dirname, '../public/js/profile.js'), 'utf8');
  for (const [n, src] of [['app.js', appJs], ['profile.js', profileJs]]) {
    assert.ok(src.includes('root.dataset.pieces = DEFAULT_PIECE_SET'), n + ' always applies the one piece set');
  }
  const styleUi = fs.readFileSync(path.join(__dirname, '../public/js/style-ui.js'), 'utf8');
  assert.ok(!/pieceSwatchButtons\(piece,/.test(styleUi), 'no dead piece-set picker in settings');
}
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(indexHtml.includes('data-pieces="cartoon"'), 'first paint uses cartoon pieces');
const db = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
assert.ok(db.includes("ALTER COLUMN piece_set SET DEFAULT 'cartoon'"), 'db default piece set');
assert.ok(css.includes('img.pc-img'), 'raster pieces styled');

// Raster set: all 12 pieces exist as small transparent WebPs
const dir = path.join(__dirname, '../public/img/pieces/cartoon');
for (const c of 'wb') for (const t of 'KQRBNP') {
  const f = path.join(dir, `${c}${t}.webp`);
  assert.ok(fs.existsSync(f), `missing ${c}${t}.webp`);
  const buf = fs.readFileSync(f);
  assert.ok(buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP', `${c}${t} is webp`);
  assert.ok(buf.length < 20000, `${c}${t}.webp stays small for Lite mode`);
}
assert.ok(pieces.includes('preloadPieceSet') && appJs.includes('preloadPieceSet('), 'raster pieces are preloaded');
assert.ok(pieces.includes('draggable="false"'), 'raster pieces never start a native image drag');

// Behaviour: even if an old account/dataset still says "neo", boards (live, tournaments, own games) draw the new raster pieces
(async () => {
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `pieces-test-${process.pid}.mjs`);
  fs.writeFileSync(tmp, pieces);
  global.document = { documentElement: { dataset: { pieces: 'neo' } } };
  try {
    const mod = await import(require('url').pathToFileURL(tmp));
    assert.strictEqual(mod.currentPieceSet(), 'cartoon');
    for (const c of 'wb') for (const t of 'kqrbnp') {
      const html = mod.pieceSvg(c, t);
      assert.ok(html.includes('pc-img') && html.includes(`/img/pieces/cartoon/${c}${t.toUpperCase()}.webp`), `${c}${t} renders the new image`);
    }
  } finally { fs.rmSync(tmp, { force: true }); delete global.document; }
})().catch((e) => { console.error(e); process.exit(1); });

console.log(`ok  pieces-style (${PIECE_SETS.length} sets, ${BOARD_THEMES.length} boards)`);
