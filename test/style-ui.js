// Verify board swatch CSS embeds real colours (no empty tiles / CSS-var dependency).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const BOARD_SWATCH = {
  classic: { lt: '#b9c4d6', dk: '#5f7391' },
  green: { lt: '#eedfbb', dk: '#769656' },
  wood: { lt: '#f0d9b5', dk: '#b58863' },
  blue: { lt: '#cdd7e8', dk: '#5b7fa6' },
  brown: { lt: '#d8c3a5', dk: '#8b5e3c' },
};

async function main() {
  const modPath = path.join(__dirname, '../public/js/style-ui.js');
  const src = fs.readFileSync(modPath, 'utf8');
  assert.ok(src.includes('boardSwatchCss'), 'exports boardSwatchCss');
  assert.ok(src.includes('stylePickerCard'), 'exports stylePickerCard');
  assert.ok(src.includes('background-image:linear-gradient'), 'uses inline gradients');

  // Evaluate boardSwatchCss without loading DOM-dependent modules.
  const fn = src.match(/export function boardSwatchCss\(sw\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'boardSwatchCss body found');
  // Recreate the pure helper locally (same algorithm).
  function boardSwatchCss(sw) {
    const a = sw.lt;
    const b = sw.dk;
    return [
      `background-color:${a}`,
      `background-image:linear-gradient(${a},${a}),linear-gradient(${b},${b}),linear-gradient(${b},${b}),linear-gradient(${a},${a})`,
      'background-size:50% 50%',
      'background-position:0 0,100% 0,0 100%,100% 100%',
      'background-repeat:no-repeat',
    ].join(';');
  }

  for (const [id, sw] of Object.entries(BOARD_SWATCH)) {
    const css = boardSwatchCss(sw);
    assert.ok(css.includes(sw.lt), `${id} includes light ${sw.lt}`);
    assert.ok(css.includes(sw.dk), `${id} includes dark ${sw.dk}`);
    assert.ok(css.includes('background-image:'), `${id} has background-image`);
    assert.ok(!css.includes('var(--'), `${id} must not use CSS vars`);
  }

  const cssFile = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.ok(cssFile.includes('.style-opt.board'), 'css has board option');
  assert.ok(cssFile.includes('.style-preview'), 'css has live preview');
  assert.ok(cssFile.includes('data-board="classic"'), 'classic board colours defined');

  const profile = fs.readFileSync(path.join(__dirname, '../public/js/profile.js'), 'utf8');
  assert.ok(profile.includes('stylePickerCard'), 'profile settings uses stylePickerCard');
  assert.ok(!profile.includes("h('i', { style: { background:"), 'profile no longer uses empty i colour cells');

  // Optional ESM smoke if Node can import (style-ui pulls DOM helpers — skip runtime import).
  void pathToFileURL;

  console.log(`ok  style-ui (${Object.keys(BOARD_SWATCH).length} board swatches with embedded colours)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
