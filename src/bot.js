const { Bot, InlineKeyboard } = require('grammy');
const db = require('./db');
const { isAdmin } = require('./auth');

function createBot(token, webAppUrl) {
  const bot = new Bot(token);

  const upsert = db.prepare(`
    INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
      bot_blocked = 0, last_seen = datetime('now')
  `);

  const openKeyboard = () => new InlineKeyboard().webApp('Open app', webAppUrl);

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    upsert.run(ctx.from.id, ctx.from.first_name || '', ctx.from.username || '');
    const name = ctx.from.first_name ? `, ${ctx.from.first_name}` : '';
    await ctx.reply(
      `Welcome${name}.\n\nTrack your expenses, keep every subscription in one place and get a reminder before each renewal.`,
      { reply_markup: openKeyboard() }
    );
  });

  bot.command('help', (ctx) =>
    ctx.reply(
      'Open the app to add expenses, subscriptions and see your calendar.\n\n/start - open the app\n/help - this message',
      { reply_markup: openKeyboard() }
    )
  );

  // Quick admin summary in chat (the full panel lives in the mini app)
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return; // silently ignore everyone else
    const n = (sql) => db.prepare(sql).get().n;
    await ctx.reply(
      [
        'Admin summary',
        `Users: ${n('SELECT COUNT(*) n FROM users')}`,
        `New today: ${n("SELECT COUNT(*) n FROM users WHERE date(created_at) = date('now')")}`,
        `Subscriptions: ${n('SELECT COUNT(*) n FROM subscriptions WHERE active = 1')}`,
        `Expenses logged: ${n('SELECT COUNT(*) n FROM expenses')}`,
      ].join('\n'),
      { reply_markup: openKeyboard() }
    );
  });

  // Track users who block / unblock the bot so reminders and broadcasts skip them
  bot.on('my_chat_member', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const status = ctx.myChatMember.new_chat_member.status;
    db.prepare('UPDATE users SET bot_blocked = ? WHERE id = ?').run(status === 'kicked' ? 1 : 0, ctx.from.id);
  });

  bot.catch((err) => console.error('[bot] error:', err.message));
  return bot;
}

async function setupMenu(bot, webAppUrl) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the app' },
    { command: 'help', description: 'How it works' },
  ]);
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Open', web_app: { url: webAppUrl } },
  });
}

module.exports = { createBot, setupMenu };
