const { Bot, InlineKeyboard } = require('grammy');
const db = require('./db');
const { isAdmin } = require('./auth');
const { LANG_BUTTONS, LANGS, STR, tr, fromTelegram } = require('./i18n');
const realtime = require('./realtime');
const { sendWelcome } = require('./welcome');

const PARTY = '5046509860389126442'; // Telegram's built-in 🎉 message effect (private chats only)
// Deep-link payloads: i<userId> = friend invite, g<gameId> = join a game
const PAYLOAD = /^[ig][A-Za-z0-9_-]{1,24}$/;

function createBot(token, webAppUrl) {
  // TG_API_ROOT lets the tests point the bot at a fake Telegram server
  const bot = new Bot(token, process.env.TG_API_ROOT ? { client: { apiRoot: process.env.TG_API_ROOT } } : {});

  let cachedUsername = process.env.BOT_USERNAME || null;
  const ensureUsername = async () => {
    if (cachedUsername) return cachedUsername;
    try {
      cachedUsername = (await bot.api.getMe()).username || null;
    } catch { /* ignore */ }
    return cachedUsername;
  };

  const upsert = db.prepare(`
    INSERT INTO users (id, first_name, last_name, username, lang) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username,
      bot_blocked = 0, last_seen = now()
  `);
  const getUser = db.prepare('SELECT lang, blocked FROM users WHERE id = ?');
  const touch = (from) => upsert.run(
    from.id, from.first_name || '', from.last_name || '', from.username || '', fromTelegram(from.language_code),
  );

  const isHttps = (webAppUrl || '').startsWith('https://');
  /** Open-app URL: friend invite (i…) + game (g…). Client skips stale i… once already friends. */
  const openUrl = (payload) => {
    const u = new URL(webAppUrl);
    const p = String(payload || '');
    if (/^i\d{1,15}$/.test(p) || /^g[\w-]{4,20}$/.test(p)) u.searchParams.set('p', p);
    return u.toString();
  };
  const openKeyboard = (lang, payload) =>
    isHttps ? new InlineKeyboard().webApp(tr(lang).open, openUrl(payload)) : undefined;

  const deliverWelcome = async (userId, lang, payload) => {
    if (!isHttps) {
      await bot.api.sendMessage(userId, tr(lang).welcome(``), { reply_markup: openKeyboard(lang, payload) });
      return;
    }
    const botUsername = await ensureUsername();
    await sendWelcome(bot, userId, lang, {
      webAppUrl,
      payload: payload || '',
      botUsername,
      userId,
      messageEffectId: PARTY,
    });
  };

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

  /** Remember invite payload so Mini App can pay diamonds even if Menu Button opens without ?p= */
  const rememberInvite = async (fromId, payload) => {
    const m = /^i(\d{1,15})$/.exec(String(payload || ''));
    if (!m) return;
    const inviterId = Number(m[1]);
    if (!inviterId || inviterId === fromId) return;
    try {
      // Only store if inviter exists (FK); Mini App start_param path still pays without this
      const inv = await db.prepare('SELECT id FROM users WHERE id = ? AND blocked = 0').get(inviterId);
      if (!inv) return;
      await db.prepare(`
        UPDATE users SET pending_inviter_id = COALESCE(pending_inviter_id, ?)
        WHERE id = ? AND id <> ?
      `).run(inviterId, fromId, inviterId);
    } catch (e) {
      console.error('[bot] rememberInvite', e.message || e);
    }
  };

  // /start always begins with the language picker; the welcome message comes after the choice
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await touch(ctx.from);
    const p = String(ctx.match || '').trim();
    const payload = PAYLOAD.test(p) ? p : '';
    if (payload) await rememberInvite(ctx.from.id, payload);
    await askLanguage(ctx, payload);
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
    if (payload) await rememberInvite(ctx.from.id, payload);
    await db.prepare('UPDATE users SET lang = ?, lang_set = 1 WHERE id = ?').run(code, ctx.from.id);
    await ctx.answerCallbackQuery({ text: LANG_BUTTONS.find((b) => b.code === code).label }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});

    await deliverWelcome(ctx.from.id, code, payload);
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
        `Online now: ${(await db.prepare(`
          SELECT COUNT(*)::int AS n FROM users WHERE blocked = 0 AND present_until > now()
        `).get())?.n || realtime.onlineIds().length}`,
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
