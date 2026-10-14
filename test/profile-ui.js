// Sanity: profile hub modules + i18n keys stay wired.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('public/js/app.js');
const profile = read('public/js/profile.js');
const screen = read('public/js/screen.js');
const admin = read('public/js/admin.js');
const i18n = read('public/js/i18n.js');
const css = read('public/styles.css');

assert.ok(app.includes("from './profile.js'"), 'app imports profile');
assert.ok(app.includes('renderProfilePage'), 'app mounts profile hub');
assert.ok(app.includes('closeScreen'), 'app closes subpages on tab change');
assert.ok(app.includes("behavior: animate ? 'smooth'"), 'smooth scroll on tab change');

assert.ok(profile.includes('export function renderProfilePage'));
assert.ok(profile.includes('sec_rating'));
assert.ok(profile.includes('sec_settings'));
assert.ok(profile.includes('openScreen'));
assert.ok(profile.includes('menu-card') || profile.includes('menuCard'));
assert.ok(!profile.includes('prof-brand'), 'profile brand badge removed');
assert.ok(profile.includes('openDiamonds'));
assert.ok(profile.includes('shop_pay_btn') || profile.includes('openPayContact'));
assert.ok(profile.includes('premiumPlans') || profile.includes('premium_plans') || profile.includes('premium_plan_'));

assert.ok(screen.includes('export function openScreen'));
assert.ok(screen.includes('export function closeScreen'));
assert.ok(screen.includes('stack') || screen.includes('stack.length'), 'screen stack for admin back');
assert.ok(admin.includes("from './screen.js'"));
assert.ok(admin.includes('openScreen'));
assert.ok(admin.includes('admin_sec_shop') || admin.includes('/admin/shop'));
assert.ok(admin.includes('admin_grant') || admin.includes('/diamonds'));
assert.ok(admin.includes('menu-card') || admin.includes('menuCard'));
assert.ok(profile.includes('/shop/order') || profile.includes('shop/order'));
assert.ok(profile.includes('premiumPlans') || profile.includes('premium_plans'));
assert.ok(app.includes("t === 'wallet'") || app.includes('m.t === \'wallet\''));

for (const k of ['sec_rating', 'sec_game', 'sec_settings', 'settings', 'help', 'terms', 'dark_mode', 'close_app', 'app_version', 'shop_packs', 'admin_sec_shop', 'premium_until', 'shop_order_sent', 'premium_plans']) {
  assert.ok(i18n.includes(k + ':'), `i18n ${k}`);
}

assert.ok(css.includes('scroll-behavior: smooth'));
assert.ok(css.includes('.menu-card'));
assert.ok(css.includes('.sec-label'));
assert.ok(css.includes('.prof-me'));
assert.ok(css.includes('#track.settle') && css.includes('0.55s'));

console.log('ok  profile-ui (hub + smooth nav)');
