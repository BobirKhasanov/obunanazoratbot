// Announcements: schema + API wiring + Tashkent end-date helpers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const db = read('src/db.js');
const server = read('src/server.js');
const app = read('public/js/app.js');
const profile = read('public/js/profile.js');
const admin = read('public/js/admin.js');
const ann = read('public/js/announcements.js');
const css = read('public/styles.css');
const i18n = read('public/js/i18n.js');

assert.ok(db.includes('CREATE TABLE IF NOT EXISTS announcements'));
assert.ok(db.includes('ends_at TIMESTAMPTZ'));
assert.ok(server.includes("api.get('/announcements'"));
assert.ok(server.includes("admin.post('/announcements'"));
assert.ok(server.includes('parseTashkentEnd'));
assert.ok(server.includes('Asia/Tashkent') || server.includes('+05:00'));
assert.ok(server.includes("api.get('/media/:id'"));
assert.ok(server.includes('purgeExpiredAnnouncements'));

assert.ok(app.includes('mountAnnouncementsCarousel'));
assert.ok(app.includes('annHost') || app.includes('ann-carousel'));
assert.ok(!app.includes("h('div.h2', t('recent'))"), 'recent games removed from home');
assert.ok(profile.includes('openStats'));
assert.ok(profile.includes("t('recent')"));
assert.ok(admin.includes('ann_publish') || admin.includes('/admin/announcements'));
assert.ok(admin.includes("PATCH', `/admin/announcements/") || admin.includes('PATCH\', `/admin/announcements/'), 'admin can edit announcements');
assert.ok(admin.includes('beginEditAnn') || admin.includes('editingAnnId'), 'admin edit mode for active announcements');
assert.ok(admin.includes('ann_save_edit') && admin.includes('ann_updated'), 'edit save copy');
assert.ok(server.includes("admin.patch('/announcements/:id'"), 'server PATCH announcements');
assert.ok(ann.includes('translate3d'));
assert.ok(ann.includes("linkType === 'invite'") || ann.includes('linkType === "invite"') || ann.includes("a.linkType === 'invite'"));
assert.ok(server.includes("b.linkType === 'invite'"));
assert.ok(ann.includes('startapp=i'));
assert.ok(ann.includes('replaceChildren(track)'), 'must not append null dots');
assert.ok(!ann.includes('host.append(track, dots)'));
assert.ok(ann.includes('DWELL_MS') && /DWELL_MS\s*=\s*6000\b/.test(ann), 'dwell = 6s');
assert.ok(ann.includes('CAROUSEL_STAGGER_MS') && /CAROUSEL_STAGGER_MS\s*=\s*2000\b/.test(ann), 'stagger = 2s');
assert.ok(app.includes('CAROUSEL_STAGGER_MS') || app.includes('delayMs'), 'puzzle carousel delayed');
assert.ok(ann.includes('bindSwipe') || ann.includes('pointermove'), 'swipe handlers');
assert.ok(ann.includes('dragging'), 'live drag class');
assert.ok(ann.includes('stopAuto'), 'swipe pauses auto-advance');
assert.ok(i18n.includes("1- E'lonlar taxtasi") || i18n.includes('1- E\'lonlar taxtasi') || i18n.includes('ann_board_home: "1-'));
assert.ok(i18n.includes("2- E'lonlar taxtasi") || i18n.includes('2- E\'lonlar taxtasi') || i18n.includes('ann_board_puzzle: "2-'));
assert.ok(css.includes('0.72s') || css.includes('ann-track.dragging'));
assert.ok(css.includes('.ann-carousel'));
assert.ok(css.includes('.ann-track'));
assert.ok(ann.includes('mediaOnly') && ann.includes('media-only') && css.includes('.ann-slide.media-only'), 'media-only full-bleed slides');
assert.ok(i18n.includes('ann_title_section:'));

// Pure Tashkent parse/format mirrors (same rules as server)
function parseTashkentEnd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  assert.ok(m, 'parse pattern');
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+05:00`;
  return new Date(iso);
}
function formatTashkent(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const d = parseTashkentEnd('2026-12-31T23:59');
assert.ok(d.getTime() > Date.now(), 'future end');
const round = formatTashkent(d);
assert.equal(round, '2026-12-31T23:59');

console.log('ok  announcements (schema, carousel, Tashkent end date)');
