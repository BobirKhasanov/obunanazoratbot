// Regression: no fake top gap in normal Telegram mode + Home (Asosiy) page must scroll.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---------- 1. syncTgSafeArea behaviour (extracted from ui.js, run against stubs) ----------
const ui = read('public/js/ui.js');
const m = /function insetPx[\s\S]*?\n}\n[\s\S]*?export function syncTgSafeArea\(\) \{[\s\S]*?\n}\n/.exec(ui);
assert.ok(m, 'found insetPx + syncTgSafeArea in ui.js');
const src = m[0].replace('export function', 'function');

function run(tw, dataset = {}) {
  const props = {};
  const root = { dataset, style: { setProperty: (k, v) => { props[k] = v; } } };
  const fn = new Function('tg', 'window', 'document', `${src}; return syncTgSafeArea;`)(
    tw, { Telegram: { WebApp: tw } }, { documentElement: root },
  );
  fn();
  return props;
}

// Normal bottom-sheet mode on a phone (what the screenshot showed): insets are 0 and MUST stay 0.
for (const platform of ['ios', 'android']) {
  const p = run({ platform, isFullscreen: false, safeAreaInset: {}, contentSafeAreaInset: {} });
  assert.strictEqual(p['--tg-content-safe-area-inset-top'], '0px', platform + ': no fake top inset when not fullscreen');
  assert.strictEqual(p['--tg-safe-area-inset-top'], '0px', platform + ': no safe-area top when not fullscreen');
}
// Older clients that don't know isFullscreen at all behave like normal mode.
assert.strictEqual(
  run({ platform: 'ios', safeAreaInset: {}, contentSafeAreaInset: {} })['--tg-content-safe-area-inset-top'], '0px',
  'undefined isFullscreen -> no fake inset',
);
// Fullscreen on a phone that reports 0 still gets the header fallback.
assert.strictEqual(
  run({ platform: 'ios', isFullscreen: true, safeAreaInset: {}, contentSafeAreaInset: {} })['--tg-content-safe-area-inset-top'], '88px',
  'ios fullscreen fallback kept',
);
assert.strictEqual(
  run({ platform: 'android', isFullscreen: true, safeAreaInset: {}, contentSafeAreaInset: {} })['--tg-content-safe-area-inset-top'], '64px',
  'android fullscreen fallback kept',
);
// Real reported insets are copied as-is, never stacked with the fallback.
const real = run({ platform: 'ios', isFullscreen: true, safeAreaInset: { top: 47 }, contentSafeAreaInset: { top: 44 } });
assert.strictEqual(real['--tg-safe-area-inset-top'], '47px');
assert.strictEqual(real['--tg-content-safe-area-inset-top'], '44px');

// Re-sync when fullscreen toggles.
assert.ok(read('public/js/entry.js').includes("'fullscreenChanged'"), 'entry.js re-syncs on fullscreenChanged');
assert.ok(read('public/js/app.js').includes("'fullscreenChanged'"), 'app.js re-syncs on fullscreenChanged');

// ---------- 2. Home page scrolls (CSS contract) ----------
const css = read('public/styles.css');
const rule = (sel) => {
  const i = css.indexOf('\n' + sel + ' {') + 1 || css.indexOf(sel + ' {');
  assert.ok(i >= 0, 'css rule exists: ' + sel);
  return css.slice(i, css.indexOf('}', i) + 1);
};
const home = rule('.page[data-page="play"]');
assert.ok(/overflow-y:\s*auto/.test(home), 'home page scrolls vertically');
assert.ok(!/overflow(-y)?:\s*hidden/.test(home), 'home page is not overflow:hidden');
assert.ok(/padding-bottom:\s*0\b/.test(home), 'home page does not rely on padding-bottom for its scroll range (WebKit flex quirk)');
const spacer = rule('.page[data-page="play"]::after');
const sh = /height:\s*calc\((\d+)px/.exec(spacer);
assert.ok(/flex:\s*none/.test(spacer) && sh && Number(sh[1]) >= 120, 'home page has a real spacer item so it can always scroll past the dock');
const row = rule('.page[data-page="play"] .nx-mode-row');
assert.ok(/flex:\s*none/.test(row) && /max-height:\s*none/.test(row), 'mode row is not squeezed to fit one screen');
const card = rule('.page[data-page="play"] .nx-mode.rich');
assert.ok(/min-height:\s*1\d\dpx/.test(card) && !/height:\s*100%/.test(card), 'mode cards have a minimum height that fits art + panel + CTA (not squeezed)');
assert.ok(/#pager \{[^}]*touch-action:\s*pan-y/.test(css), 'pager allows vertical panning');

// ---------- 3. Home mode cards: full-bleed art + glass panel (reference design) ----------
const rich = rule('.nx-mode.rich');
assert.ok(/padding:\s*0/.test(rich), 'rich mode cards let the art bleed to the edges');
assert.ok(/clamp\(\s*1\d\dpx,\s*\d+dvh/.test(rule('.page[data-page="play"] .nx-mode.rich')), 'home cards scale with screen height so Kunlik topshiriq stays above the dock');
const art = rule('.nx-mode.rich .nx-mode-art');
assert.ok(/position:\s*absolute/.test(art) && /cover/.test(art) && !/contain/.test(art), 'card art is full-bleed (cover), not a small contained image');
const body = rule('.nx-mode-body');
assert.ok(/backdrop-filter/.test(body) && /border-radius:\s*1\d px/.test(body.replace(/(\d)px/g, "$1 px")), 'card text sits on a rounded glass panel');
assert.ok(!/background-size:\s*contain/.test(css.slice(css.indexOf('.nx-mode.rich .nx-mode-art'))), 'no iOS/lite override shrinks the art back to contain');
assert.ok(/@media \(max-width: 380px\)[^}]*\.nx-hdr/.test(css), 'header tightens on narrow phones');

console.log('safe-area OK');
