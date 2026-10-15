// Telegram chat notifications. Every message carries a web_app button that opens the Mini App
// (straight into a specific game or DM thread when given).
const { InputFile } = require('grammy');
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

/**
 * Build Mini App URL. Accepts legacy appUrl(gameId) or appUrl({ gameId, dmThreadId }).
 */
function appUrl(opts) {
  if (!baseUrl.startsWith('https://')) return null;
  const u = new URL(baseUrl);
  if (opts != null && (typeof opts === 'string' || typeof opts === 'number')) {
    u.searchParams.set('game', String(opts));
    return u.toString();
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.gameId) u.searchParams.set('game', String(o.gameId));
  if (o.dmThreadId) u.searchParams.set('dm', String(o.dmThreadId));
  return u.toString();
}

const getUser = db.prepare('SELECT lang, notify_enabled, bot_blocked, blocked FROM users WHERE id = ?');

/**
 * Sends `build(T)` (T = the user's language strings) to a user, with an "Open" button.
 * Never throws. Returns true when Telegram accepted the message.
 */
async function toUser(userId, build, { gameId, dmThreadId, effect, force } = {}) {
  if (!bot) return false;
  const u = await getUser.get(userId);
  if (!u || u.blocked || u.bot_blocked) return false;
  if (!u.notify_enabled && !force) return false;

  const T = tr(u.lang);
  const url = appUrl({ gameId, dmThreadId });
  let btn = T.open;
  if (gameId) btn = T.openGame;
  else if (dmThreadId) btn = T.openChat || T.open;
  const extra = url ? { reply_markup: { inline_keyboard: [[{ text: btn, web_app: { url } }]] } } : {};
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

/**
 * Deliver a monthly podium medal as PNG photo (preferred) or SVG document.
 * @param {number} userId
 * @param {{ svg: string, filename?: string, caption: string, png?: Buffer|null }} opts
 */
async function sendMedal(userId, opts) {
  if (!bot) return false;
  const u = await getUser.get(userId);
  if (!u || u.blocked || u.bot_blocked) return false;
  const T = tr(u.lang);
  const url = appUrl();
  const extra = url ? { reply_markup: { inline_keyboard: [[{ text: T.open, web_app: { url } }]] } } : {};
  const base = String(opts.filename || 'medal').replace(/\.(svg|png)$/i, '');
  let png = opts.png;
  if (!png && opts.svg) {
    try {
      png = await require('./medal-png').svgToPngBuffer(opts.svg);
    } catch { png = null; }
  }

  const sendPhoto = async (withEffect) => {
    if (!png) return false;
    const photo = new InputFile(png, `${base}.png`);
    const payload = { caption: opts.caption, ...extra };
    if (withEffect) payload.message_effect_id = EFFECT.party;
    await bot.api.sendPhoto(userId, photo, payload);
    return true;
  };
  const sendDoc = async (withEffect) => {
    const file = new InputFile(Buffer.from(opts.svg, 'utf8'), `${base}.svg`);
    const payload = { caption: opts.caption, ...extra };
    if (withEffect) payload.message_effect_id = EFFECT.party;
    await bot.api.sendDocument(userId, file, payload);
    return true;
  };

  try {
    if (await sendPhoto(true)) return true;
    return await sendDoc(true);
  } catch (e) {
    if (e.error_code === 400 && e.description && /effect/i.test(e.description)) {
      try {
        if (await sendPhoto(false)) return true;
        return await sendDoc(false);
      } catch (e2) {
        console.error('[notify] medal send failed:', e2.description || e2.message);
      }
    } else if (e.error_code === 403) {
      await db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?').run(userId).catch(() => {});
    } else {
      console.error('[notify] medal send failed:', e.description || e.message);
      return toUser(userId, () => opts.caption, { force: true, effect: 'party' });
    }
    return false;
  }
}

module.exports = { init, toUser, sendMedal, appUrl, EFFECT };
