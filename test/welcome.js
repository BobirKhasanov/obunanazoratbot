// Welcome message defaults + admin wiring (static checks; no DB).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const welcomeSrc = read('src/welcome.js');
const botSrc = read('src/bot.js');
const serverSrc = read('src/server.js');
const adminSrc = read('public/js/admin.js');
const i18nSrc = read('public/js/i18n.js');
const postsSrc = read('src/posts.js');
const annSrc = read('public/js/announcements.js');
const appSrc = read('public/js/app.js');

assert.ok(welcomeSrc.includes('SHAXMAT BOTIGA XUSH KELIBSIZ'));
assert.ok(welcomeSrc.includes('Ilovani ochish'));
assert.ok(welcomeSrc.includes("Do'stni taklif qilish"));
assert.ok(welcomeSrc.includes("type: 'invite'"));
assert.ok(welcomeSrc.includes('startapp=i'));
assert.ok(welcomeSrc.includes('function resolveButtons'));
assert.ok(welcomeSrc.includes('function mergeWelcomeConfig'));
assert.ok(botSrc.includes('sendWelcome'));
assert.ok(botSrc.includes('deliverWelcome'));
assert.ok(serverSrc.includes("admin.get('/welcome'"));
assert.ok(serverSrc.includes("admin.patch('/welcome'"));
assert.ok(serverSrc.includes("admin.post('/welcome/test'"));
assert.ok(adminSrc.includes('openWelcome'));
assert.ok(adminSrc.includes('btn_invite'));
assert.ok(i18nSrc.includes('welcome_title:'));
assert.ok(postsSrc.includes('b.url || webAppUrl'));
assert.ok(/DWELL_MS\s*=\s*6000\b/.test(annSrc));
assert.ok(/CAROUSEL_STAGGER_MS\s*=\s*2000\b/.test(annSrc));
assert.ok(appSrc.includes('delayMs: CAROUSEL_STAGGER_MS'));

console.log('ok  welcome (defaults, admin wiring, carousel stagger)');
