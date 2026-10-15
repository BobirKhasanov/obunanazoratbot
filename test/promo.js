// Static checks for promo codes wiring (admin + user + carousel deep-link).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const db = read('src/db.js');
const server = read('src/server.js');
const admin = read('public/js/admin.js');
const profile = read('public/js/profile.js');
const app = read('public/js/app.js');
const i18n = read('public/js/i18n.js');

assert.ok(db.includes('CREATE TABLE IF NOT EXISTS promo_codes'));
assert.ok(db.includes('CREATE TABLE IF NOT EXISTS promo_redemptions'));
assert.ok(db.includes('UNIQUE (promo_id, user_id)') || db.includes('UNIQUE(promo_id, user_id)'));

assert.ok(server.includes("api.post('/promo/redeem'"));
assert.ok(server.includes("admin.post('/promos'"));
assert.ok(server.includes("admin.get('/promos'"));
assert.ok(server.includes("'promo'") && server.includes('ANN_PAGES'), 'carousel can link to promo page');
assert.ok(server.includes('premium_days') && server.includes('premium_months') && server.includes('diamonds'));
assert.ok(server.includes('FOR UPDATE'), 'redeem locks promo row');

assert.ok(admin.includes('openPromos') && admin.includes('/admin/promos'));
assert.ok(admin.includes("['promo', t('promo_title')]") || admin.includes("'promo'"), 'announcement page chip for promo');
assert.ok(profile.includes('openPromo') && profile.includes('/promo/redeem'));
assert.ok(profile.includes("page === 'promo'"), 'profile-open handles promo');
assert.ok(app.includes("'promo'") || app.includes('"promo"'), 'home carousel deep-link opens promo');
assert.ok(i18n.includes('promo_title:') && i18n.includes('e_promo_expired:'));

console.log('ok  promo (schema, admin, redeem, carousel link)');
