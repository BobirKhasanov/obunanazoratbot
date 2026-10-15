// Boot splash defaults + admin wiring (static + normalize; no DB).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const {
  DEFAULT_COPY, ANIMATIONS, normalizeBootConfig, defaultBootConfig,
} = require('../src/boot-splash');

assert.strictEqual(DEFAULT_COPY.uz.title, "O'yin yuklanmoqda");
assert.strictEqual(DEFAULT_COPY.en.title, 'Loading game');
assert.strictEqual(DEFAULT_COPY.ru.title, 'Игра загружается');
assert.strictEqual(DEFAULT_COPY.uzc.title, 'Ўйин юкланмоқда');
assert.ok(ANIMATIONS.includes('orbit') && ANIMATIONS.includes('pulse') && ANIMATIONS.includes('bars'));

const def = defaultBootConfig();
assert.strictEqual(def.animation, 'orbit');
assert.strictEqual(def.uz.title, "O'yin yuklanmoqda");

const patched = normalizeBootConfig({
  animation: 'pulse',
  uz: { title: ' Custom  ', subtitle: 'kutish' },
  en: { title: '', subtitle: '' },
});
assert.strictEqual(patched.animation, 'pulse');
assert.strictEqual(patched.uz.title, 'Custom');
assert.strictEqual(patched.uz.subtitle, 'kutish');
assert.strictEqual(patched.en.title, DEFAULT_COPY.en.title, 'empty title falls back');
assert.strictEqual(normalizeBootConfig({ animation: 'nope' }).animation, 'orbit');

const html = read('public/index.html');
const serverSrc = read('src/server.js');
const adminSrc = read('public/js/admin.js');
const i18nSrc = read('public/js/i18n.js');

assert.ok(html.includes("O'yin yuklanmoqda"));
assert.ok(html.includes('data-anim="orbit"'));
assert.ok(html.includes('/api/public/boot-splash'));
assert.ok(serverSrc.includes("app.get('/api/public/boot-splash'"));
assert.ok(serverSrc.includes("admin.get('/boot-splash'"));
assert.ok(serverSrc.includes("admin.patch('/boot-splash'"));
assert.ok(adminSrc.includes('openBootSplash'));
assert.ok(i18nSrc.includes('boot_title_section:'));
assert.ok(i18nSrc.includes('boot_saved:'));
assert.ok(i18nSrc.includes("chess_lang"));

console.log('ok  boot-splash (copy, normalize, admin wiring)');
