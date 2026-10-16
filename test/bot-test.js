// Bot conversation test: feeds Telegram updates straight into the bot and checks the replies.
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const fake = require('./helpers/fake-telegram');

(async () => {
  const tg = await fake.start();
  const pg = await require('./helpers/pg').freshDb();
  process.env.DATABASE_URL = pg.url;
  process.env.TG_API_ROOT = tg.url;
  process.env.NODE_NO_WARNINGS = '1';
  const db = require('../src/db');
  await db.ready;
  const { createBot, setupMenu } = require('../src/bot');

  const bot = createBot('123456:TEST_TOKEN_NOT_REAL', 'https://chess.example.test');
  await bot.init();
  let updateId = 1;
  const from = (id, lang) => ({ id, is_bot: false, first_name: 'Tester', language_code: lang });
  const say = (id, text, lang) => bot.handleUpdate({
    update_id: updateId++,
    message: { message_id: updateId, date: 1, chat: { id, type: 'private' }, from: from(id, lang), text, entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined },
  });
  const press = (id, data, lang) => bot.handleUpdate({
    update_id: updateId++,
    callback_query: { id: String(updateId), from: from(id, lang), chat_instance: 'x', data, message: { message_id: 7, date: 1, chat: { id, type: 'private' } } },
  });
  let n = 0;
  const step = (name) => console.log(`ok  ${name}`) || n++;

  // 1. /start shows the picker with all four languages BEFORE any welcome message
  await say(501, '/start', 'en');
  let sent = tg.to(501);
  assert.strictEqual(sent.length, 1, 'only the language picker so far');
  let kb = sent[0].body.reply_markup.inline_keyboard.flat();
  assert.deepStrictEqual(kb.map((b) => b.callback_data), ['lang:uz', 'lang:uzc', 'lang:ru', 'lang:en']);
  assert.deepStrictEqual(kb.map((b) => b.text), ["🇺🇿 O'zbekcha", '🇺🇿 Ўзбекча', '🇷🇺 Русский', '🇬🇧 English']);
  assert.ok(!/Welcome|Добро/.test(sent[0].body.text), 'no welcome before the language is chosen');
  assert.ok(sent[0].body.text.includes('\n'), 'language prompt is multi-line (not one long · row)');
  assert.ok(/Tilni tanlang/.test(sent[0].body.text) && /Choose your language/.test(sent[0].body.text));
  step('/start asks for the language first (Uzbek, Uzbek Cyrillic, Russian, English)');

  // 2. choosing a language deletes the picker and sends the welcome in that language with Open + Invite
  for (const [code, word, openBtn, inviteBtn] of [
    ['uz', 'XUSH KELIBSIZ', 'Ilovani ochish', "Do'stni taklif qilish"],
    ['uzc', 'ХУШ КЕЛИБСИЗ', 'Иловани очиш', 'Дўстни таклиф қилиш'],
    ['ru', 'ДОБРО ПОЖАЛОВАТЬ', 'Открыть приложение', 'Пригласить друга'],
    ['en', 'WELCOME TO THE CHESS BOT', 'Open app', 'Invite a friend'],
  ]) {
    tg.calls.length = 0;
    await press(501, `lang:${code}`, 'en');
    assert.ok(tg.calls.some((c) => c.method === 'deleteMessage'), 'picker removed');
    const welcome = tg.to(501).pop();
    assert.ok(welcome.body.text.includes(word), `${code}: welcome in the chosen language`);
    const rows = welcome.body.reply_markup.inline_keyboard;
    assert.strictEqual(rows[0][0].text, openBtn);
    assert.strictEqual(rows[0][0].web_app.url, 'https://chess.example.test/', 'Open button launches the Mini App');
    assert.strictEqual(rows[1][0].text, inviteBtn);
    assert.ok(rows[1][0].url.includes('t.me/share/url'), 'Invite opens Telegram share');
    assert.ok(decodeURIComponent(rows[1][0].url).includes('startapp=i501'), 'Invite uses personal referral');
    assert.ok(welcome.body.message_effect_id, 'welcome has the confetti effect');
    const u = await db.prepare('SELECT lang, lang_set FROM users WHERE id = 501').get();
    assert.deepStrictEqual({ ...u }, { lang: code, lang_set: 1 });
  }
  step('each language choice stores the language and sends a localized welcome with Open + Invite');

  // 3. invite deep link is remembered + Open carries ?p=i (client ignores once already friends)
  tg.calls.length = 0;
  await say(502, '/start i501', 'ru');
  kb = tg.to(502)[0].body.reply_markup.inline_keyboard.flat();
  assert.deepStrictEqual(kb.map((b) => b.callback_data), ['lang:uz:i501', 'lang:uzc:i501', 'lang:ru:i501', 'lang:en:i501']);
  await press(502, 'lang:ru:i501', 'ru');
  const w = tg.to(502).pop();
  const openUrl = w.body.reply_markup.inline_keyboard[0][0].web_app.url;
  assert.ok(openUrl.includes('p=i501'), 'welcome Open carries invite for first claim');
  const pending = await db.prepare('SELECT pending_inviter_id FROM users WHERE id = 502').get();
  assert.strictEqual(Number(pending.pending_inviter_id), 501, 'invite stored for /me claim');
  // Newer /start i… overwrites stale pending (so Mini App pays the latest inviter)
  await say(503, '/start', 'en'); // ensure inviter 503 exists
  await say(502, '/start i503', 'ru');
  const pending2 = await db.prepare('SELECT pending_inviter_id FROM users WHERE id = 502').get();
  assert.strictEqual(Number(pending2.pending_inviter_id), 503, 'newer invite overwrites pending');
  step('friend-invite stored as pending_inviter and on welcome Open button');

  tg.calls.length = 0;
  await say(503, '/start gAbC_123-x', 'en');
  await press(503, 'lang:en:gAbC_123-x', 'en');
  assert.ok(tg.to(503).pop().body.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?p=gAbC_123-x'));
  step('game-invite link is carried through too');

  // 4. hostile payloads are ignored, not echoed into URLs
  tg.calls.length = 0;
  await say(504, '/start ../../evil?x=1&y=<script>', 'en');
  kb = tg.to(504)[0].body.reply_markup.inline_keyboard.flat();
  assert.deepStrictEqual(kb.map((b) => b.callback_data), ['lang:uz', 'lang:uzc', 'lang:ru', 'lang:en']);
  await press(504, 'lang:en:../../evil', 'en'); // forged callback data
  assert.ok(!tg.calls.some((c) => c.method === 'sendMessage' && c.body.reply_markup && JSON.stringify(c.body.reply_markup).includes('evil')));
  step('malformed deep-link payloads are dropped');

  // 5. /lang, /help, unknown text, /admin
  tg.calls.length = 0;
  await say(501, '/lang', 'en');
  assert.strictEqual(tg.to(501)[0].body.reply_markup.inline_keyboard.flat().length, 4);
  await say(501, '/help', 'en');
  assert.ok(/Play/.test(tg.to(501).pop().body.text));
  await say(501, 'hello bot', 'en');
  assert.ok(tg.to(501).pop().body.reply_markup.inline_keyboard[0][0].web_app, 'any text offers the game');
  const before = tg.to(501).length;
  await say(501, '/admin', 'en');
  assert.strictEqual(tg.to(501).length, before, 'non-admins get no reply to /admin at all');
  await say(1895441858, '/admin', 'en');
  assert.ok(/Admin summary/.test(tg.to(1895441858).pop().body.text));
  step('/lang, /help, free text and /admin (admin only)');

  // 6. blocking / unblocking the bot is tracked
  await bot.handleUpdate({ update_id: updateId++, my_chat_member: { chat: { id: 501, type: 'private' }, from: from(501, 'en'), date: 1, old_chat_member: { status: 'member' }, new_chat_member: { status: 'kicked', user: { id: 99, is_bot: true, first_name: 'b' } } } });
  assert.strictEqual((await db.prepare('SELECT bot_blocked b FROM users WHERE id = 501').get()).b, 1);
  await say(501, '/start', 'en'); // coming back clears the flag
  assert.strictEqual((await db.prepare('SELECT bot_blocked b FROM users WHERE id = 501').get()).b, 0);
  step('bot block / unblock is tracked');

  // 7. menu button, per-language commands and descriptions are registered
  tg.calls.length = 0;
  await setupMenu(bot, 'https://chess.example.test');
  const methods = tg.calls.map((c) => c.method);
  assert.strictEqual(methods.filter((m) => m === 'setMyCommands').length, 3);
  assert.ok(methods.includes('setChatMenuButton') && methods.includes('setMyDescription'));
  const menu = tg.calls.find((c) => c.method === 'setChatMenuButton').body.menu_button;
  assert.deepStrictEqual([menu.type, menu.web_app.url], ['web_app', 'https://chess.example.test']);
  step('menu button, commands and descriptions are set up');

  console.log(`\nAll ${n} bot tests passed`);
  tg.close();
  await db.close().catch(() => {});
  await pg.drop();
})().catch((e) => { console.error('\nFAILED:', e.stack || e.message); process.exit(1); });
