// Telegram chat notifications. Every message carries a web_app button that opens the Mini App
// (straight into a specific game when a gameId is given).
const db = require('./db');
const { tr } = require('./i18n');

// Telegram message effects (animated reactions on a message, private chats only)
const EFFECT = { fire: '5104841245755180586', party: '5046509860389126442' };

let bot = null;
let baseUrl = '';

function init(b, webAppUrl) {
  bot = b;
  baseUrl = webAppUrl || '';
}

function appUrl(gameId) {
  if (!baseUrl.startsWith('https://')) return null; // Telegram only accepts https for web_app buttons
  const u = new URL(baseUrl);
  if (gameId) u.searchParams.set('game', gameId);
  return u.toString();
}

const getUser = db.prepare('SELECT lang, notify_enabled, bot_blocked, blocked FROM users WHERE id = ?');

/**
 * Sends `build(T)` (T = the user's language strings) to a user, with an "Open" button.
 * Never throws. Returns true when Telegram accepted the message.
 */
async function toUser(userId, build, { gameId, effect, force } = {}) {
  if (!bot) return false;
  const u = await getUser.get(userId);
  if (!u || u.blocked || u.bot_blocked) return false;
  if (!u.notify_enabled && !force) return false;

  const T = tr(u.lang);
  const url = appUrl(gameId);
  const extra = url ? { reply_markup: { inline_keyboard: [[{ text: gameId ? T.openGame : T.open, web_app: { url } }]] } } : {};
  const text = build(T);

  try {
    try {
      await bot.api.sendMessage(userId, text, { ...extra, ...(effect ? { message_effect_id: EFFECT[effect] } : {}) });
    } catch (e) {
      // an unsupported effect is a 400: retry as a plain message
      if (effect && e.error_code === 400) await bot.api.sendMessage(userId, text, extra);
      else throw e;
    }
    return true;
  } catch (e) {
    if (e.error_code === 403) await db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?').run(userId).catch(() => {});
    else console.error('[notify] send failed:', e.description || e.message);
    return false;
  }
}

module.exports = { init, toUser, appUrl, EFFECT };
