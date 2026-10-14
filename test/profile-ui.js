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
assert.ok(!admin.includes('admin_grant_premium_prompt'), 'diamond grant must not ask for Premium months');
assert.ok(admin.includes('menu-card') || admin.includes('menuCard'));
assert.ok(app.includes('avBlock') && app.includes('premIc'), 'online list premium badge + ring');
assert.ok(app.includes('!!u.premium') || app.includes('u.premium ? premIc'), 'online row shows premIc when premium');
assert.ok(app.includes('open-premium') && app.includes("detail: 'premium'"), 'premIc opens Premium shop');
assert.ok(app.includes('round: true'), 'online avatars are circular');
const ui = read('public/js/ui.js');
assert.ok(ui.includes("CustomEvent('open-premium')") && ui.includes('button.prem-ic'), 'premIc is a tappable button');
assert.ok(css.includes('prem-ring') && css.includes('prem-spin'), 'rotating premium avatar ring');
assert.ok(css.includes('border-radius: 50%') && (css.includes('.avwrap.circ') || css.includes('.avwrap.round')), 'circular avatar + ring');
assert.ok(css.includes('.avwrap.xl'), 'profile xl avatar wrap sized correctly');
assert.ok(!css.includes('.mini.back svg { transform: rotate(180deg)'), 'live back no longer flipped chevron');
assert.ok(css.includes('.round.back .ic svg'), 'back chevron optically centered');
assert.ok(css.includes('#play-sticky'), 'sticky Play CTA above dock');
assert.ok(css.includes('#app:has(#screen.show) #play-sticky'), 'sticky Play hidden under overlays');
assert.ok(app.includes('createPlayFlow') && app.includes('setPlaySticky'), 'home wires play flow + sticky Play');
assert.ok(!app.includes("t('home_rank')"), 'live ranking banner removed from home');
assert.ok(app.includes("t('online_players')") && app.includes('home-online'), 'home shows live online players list');
const playflow = read('public/js/playflow.js');
assert.ok(playflow.includes('openSearching') && playflow.includes('/games/quick'), 'play flow searching + quick match');
assert.ok(playflow.includes('preferredColor') && playflow.includes('TIME_GROUPS'), 'time/color setup in play flow');
const live = read('public/js/live.js');
assert.ok(live.includes('backBtn') && !live.includes('syncTgBack'), 'single in-app back, no Telegram BackButton duplicate');
assert.ok(live.includes("role: 'button'") && live.includes('live-game-card'), 'live game cards scroll-friendly');
assert.ok(css.includes('box-shadow: 0 0 0 2.5px #f5c542') || css.includes('box-shadow: 0 0 0 2px #f5c542'), 'gold avatar border for premium');
assert.ok(/\.prem-ic[\s\S]{0,160}width:\s*(2[8-9]|3[0-9])px/.test(css), 'premIc badge at least 28px');
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
assert.ok(css.includes('.prof-cover') && css.includes('.prof-banner'), 'profile cover banner');
assert.ok(profile.includes('prof-cover') && profile.includes('profileBannerUrl'), 'profile uses banner URL');
assert.ok(profile.includes('profile_edit') && profile.includes('prof-edit'), 'profile edit chip on banner');
assert.ok(profile.includes('openMyInfo') && profile.includes('my_info'), 'Edit opens My information');
assert.ok(profile.includes('info_username_locked'), 'username not editable in UI');
assert.ok(profile.includes('delete_account') && profile.includes('confirmSheet'), 'delete account asks once');
assert.ok(profile.includes('/feedback') && profile.includes('feedback_send'), 'help feedback chat');
assert.ok(profile.includes('openUserProfile') || read('public/js/userprofile.js').includes('openUserProfile'), 'user profile view');
assert.ok(css.includes('prem-glow') && css.includes('uprof-hero'), 'premium glow + public profile styles');
assert.ok(admin.includes('ann_board_puzzle') && admin.includes("board: annBoard"), 'admin puzzle board');
assert.ok(app.includes("loadAnnouncements(api, 'puzzle')") || app.includes("loadAnnouncements(api, \"puzzle\")"), 'puzzle carousel load');
assert.ok(admin.includes('/admin/profile-banner') && admin.includes('admin_banner'), 'admin can change profile banner');
assert.ok(i18n.includes('profile_edit:') && i18n.includes('admin_banner:') && i18n.includes('my_info:'));
const server = read('src/server.js');
assert.ok(server.includes('/api/public/profile-banner') && server.includes('profile_banner_media_id'), 'public banner + setting');
assert.ok(server.includes('username_readonly') && server.includes('last_name'), 'username locked + last_name field');
assert.ok(fs.existsSync(path.join(root, 'public/img/profile-banner.png')), 'default banner asset');
assert.ok(/\.screen[\s\S]{0,280}0\.78s/.test(css), 'smooth screen page transition');
assert.ok(css.includes('#track.settle') && /#track\.settle[^}]*0\.78s/.test(css), 'smooth pager settle');
assert.ok(/#dock[\s\S]{0,200}flex-direction:\s*column/.test(css), 'dock stacks Play above nav');
assert.ok(css.includes('#play-sticky') && css.includes('order: -1'), 'Play CTA ordered above nav in dock');
assert.ok(/#play-sticky\.show[\s\S]{0,220}overflow:\s*visible/.test(css), 'Play CTA edges/shadow not clipped');
assert.ok(/#nav-ind\s*\{[^}]*0\.78s/.test(css), 'nav indicator matches pager timing');
assert.ok(css.includes('overscroll-behavior-y: contain'), 'pages contain overscroll for smoother feel');
const html = read('public/index.html');
assert.ok(html.includes('id="play-sticky"') && html.includes('id="dock"'), 'Play mount lives inside dock markup');
assert.ok(css.includes('pill-thumb') && ui.includes('pillBar'), 'sliding pill bars for section selection');
assert.ok(app.includes('headerInboxBtns') && app.includes('rank-board-bar'), 'home inbox + ranking bars');
const inbox = read('public/js/inbox.js');
assert.ok(inbox.includes('openNotifications') && inbox.includes('openMessages'), 'inbox screens');
assert.ok(inbox.includes('/messages/search') && inbox.includes('/notifications'), 'inbox API wiring');
assert.ok(server.includes("CREATE TABLE IF NOT EXISTS notifications") || read('src/db.js').includes('CREATE TABLE IF NOT EXISTS notifications'), 'notifications table');
assert.ok(read('src/db.js').includes('dm_threads') && read('src/db.js').includes('dm_messages'), 'DM tables');
assert.ok(server.includes("admin.post('/notifications'") && server.includes("api.get('/notifications'"), 'notif APIs');
assert.ok(server.includes("api.get('/messages/threads'") && server.includes("api.post('/messages/threads'"), 'messages APIs');
assert.ok(admin.includes('admin_notif') && admin.includes('/admin/notifications'), 'admin in-app notif composer');
assert.ok(css.includes('.hdr-ic') && css.includes('.hdr-badge'), 'header mail/bell style');
assert.ok(i18n.includes('xabarnoma:') && i18n.includes('messages:') && i18n.includes('msg_search_ph:'), 'inbox i18n');

console.log('ok  profile-ui (hub + smooth nav)');
