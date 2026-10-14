const { Bot, InlineKeyboard } = require('grammy');
const db = require('./db');
const { isAdmin } = require('./auth');
const { LANG_BUTTONS, LANGS, STR, tr, fromTelegram } = require('./i18n');
const realtime = require('./realtime');

const PARTY = '5046509860389126442'; // Telegram's built-in 🎉 message effect (private chats only)
// Deep-link payloads: i<userId> = friend invite, g<gameId> = join a game
const PAYLOAD = /^[ig][A-Za-z0-9_-]{1,24}$/;

function createBot(token, webAppUrl) {
  // TG_API_ROOT lets the tests point the bot at a fake Telegram server
  const bot = new Bot(token, process.env.TG_API_ROOT ? { client: { apiRoot: process.env.TG_API_ROOT } } : {});

  const upsert = db.prepare(`
    INSERT INTO users (id, first_name, username, lang) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
      bot_blocked = 0, last_seen = now()
  `);
  const getUser = db.prepare('SELECT lang, blocked FROM users WHERE id = ?');
  const touch = (from) => upsert.run(from.id, from.first_name || '', from.username || '', fromTelegram(from.language_code));

  const isHttps = (webAppUrl || '').startsWith('https://');
  const openUrl = (payload) => {
    const u = new URL(webAppUrl);
    if (payload) u.searchParams.set('p', payload);
    return u.toString();
  };
  const openKeyboard = (lang, payload) =>
    isHttps ? new InlineKeyboard().webApp(tr(lang).open, openUrl(payload)) : undefined;

  const langKeyboard = (payload) => {
    const kb = new InlineKeyboard();
    LANG_BUTTONS.forEach((b, i) => {
      kb.text(b.label, `lang:${b.code}${payload ? ':' + payload : ''}`);
      if (i % 2 === 1) kb.row();
    });
    return kb;
  };

  // Shown in all four languages at once, because we do not know yet which one the user reads
  const askLanguage = (ctx, payload) =>
    ctx.reply('🌐 Tilni tanlang · Тилни танланг · Выберите язык · Choose your language', {
      reply_markup: langKeyboard(payload),
    });

  // /start always begins with the language picker; the welcome message comes after the choice
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await touch(ctx.from);
    const p = String(ctx.match || '').trim();
    await askLanguage(ctx, PAYLOAD.test(p) ? p : '');
  });

  bot.command('lang', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await touch(ctx.from);
    await askLanguage(ctx, '');
  });

  bot.callbackQuery(/^lang:(uz|uzc|ru|en)(?::([ig][A-Za-z0-9_-]{1,24}))?$/, async (ctx) => {
    const code = ctx.match[1];
    const payload = ctx.match[2] || '';
    await touch(ctx.from);
    await db.prepare('UPDATE users SET lang = ?, lang_set = 1 WHERE id = ?').run(code, ctx.from.id);
    await ctx.answerCallbackQuery({ text: LANG_BUTTONS.find((b) => b.code === code).label }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});

    const name = ctx.from.first_name ? `, ${ctx.from.first_name}` : '';
    const text = tr(code).welcome(name);
    const reply_markup = openKeyboard(code, payload);
    try {
      await ctx.api.sendMessage(ctx.from.id, text, { reply_markup, message_effect_id: PARTY });
    } catch {
      await ctx.api.sendMessage(ctx.from.id, text, { reply_markup }); // effect not supported: plain welcome
    }
  });

  const langOf = async (id) => ((await getUser.get(id)) || { lang: 'en' }).lang;

  bot.command(['play', 'help'], async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await touch(ctx.from);
    const lang = await langOf(ctx.from.id);
    return ctx.reply(tr(lang).help, { reply_markup: openKeyboard(lang) });
  });

  // Quick admin summary in chat (the full panel lives in the mini app)
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return; // silently ignore everyone else
    const n = async (sql) => (await db.prepare(sql).get()).n;
    await ctx.reply(
      [
        'Admin summary',
        `Users: ${await n('SELECT COUNT(*) n FROM users')}`,
        `Online now: ${realtime.onlineIds().length}`,
        `Games in progress: ${await n("SELECT COUNT(*) n FROM games WHERE status = 'active'")}`,
        `Games played: ${await n("SELECT COUNT(*) n FROM games WHERE status = 'finished'")}`,
      ].join('\n'),
      { reply_markup: openKeyboard('en') }
    );
  });

  // Any other private message just offers the game
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    await touch(ctx.from);
    const lang = await langOf(ctx.from.id);
    await ctx.reply(tr(lang).unknown, { reply_markup: openKeyboard(lang) });
  });

  // Users who block the bot are skipped by notifications and broadcasts
  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const status = ctx.myChatMember.new_chat_member.status;
    await db.prepare('UPDATE users SET bot_blocked = ? WHERE id = ?').run(status === 'kicked' ? 1 : 0, ctx.from.id);
  });

  bot.catch((err) => console.error('[bot] error:', err.message));
  return bot;
}

const COMMANDS = {
  en: [['start', 'Start / change language'], ['play', 'Open the game'], ['lang', 'Change language'], ['help', 'Help']],
  ru: [['start', 'Начать / сменить язык'], ['play', 'Открыть игру'], ['lang', 'Сменить язык'], ['help', 'Помощь']],
  uz: [['start', "Boshlash / tilni o'zgartirish"], ['play', "O'yinni ochish"], ['lang', "Tilni o'zgartirish"], ['help', 'Yordam']],
};

/** Menu button, command list and profile texts. Failures are logged and never stop the bot. */
async function setupMenu(bot, webAppUrl) {
  const run = async (what, fn) => { try { await fn(); } catch (e) { console.error(`[bot] ${what} failed:`, e.description || e.message); } };
  for (const [code, cmds] of Object.entries(COMMANDS)) {
    const opts = code === 'en' ? undefined : { language_code: code };
    await run('setMyCommands', () => bot.api.setMyCommands(cmds.map(([command, description]) => ({ command, description })), opts));
  }
  for (const code of ['en', 'ru', 'uz']) {
    const opts = code === 'en' ? undefined : { language_code: code };
    await run('setMyDescription', () => bot.api.setMyDescription(STR[code].description, opts));
    await run('setMyShortDescription', () => bot.api.setMyShortDescription(STR[code].shortDescription, opts));
  }
  if ((webAppUrl || '').startsWith('https://')) {
    await run('setChatMenuButton', () =>
      bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '♟ Play', web_app: { url: webAppUrl } } }));
  }
}

module.exports = { createBot, setupMenu, LANGS };
