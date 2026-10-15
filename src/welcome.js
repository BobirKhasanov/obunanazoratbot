// Admin-managed /start welcome (per language): text, media, buttons (app / invite / url).
const db = require('./db');
const { LANGS, STR, norm } = require('./i18n');
const { sendPost } = require('./posts');
const { loadMediaBytes } = require('./storage');

const WELCOME_KEY = 'welcome_config';

const DEFAULT_TEXT = {
  en: `♟️ WELCOME TO THE CHESS BOT!

With this bot you can:

🤝 Play online chess with your friends
🤖 Test your strength against AI
🏆 Climb the rating and join the Top players!

Tap the button below to start 👇`,
  ru: `♟️ ДОБРО ПОЖАЛОВАТЬ В ШАХМАТНОГО БОТА!

С этим ботом вы можете:

🤝 Играть в шахматы онлайн с друзьями
🤖 Проверить силы против ИИ
🏆 Набирать рейтинг и попадать в Топ!

Нажмите кнопку ниже, чтобы начать 👇`,
  uz: `♟️ SHAXMAT BOTIGA XUSH KELIBSIZ!

Bu bot orqali siz:

🤝 Do'stlaringiz bilan online shaxmat o'ynashingiz
🤖 Sun'iy intellektga qarshi kuchingizni sinashingiz
🏆 Reyting to'plab Top o'yinchilar ro'yxatiga kirishingiz mumkin!

Boshlash uchun quyidagi tugmani bosing 👇`,
  uzc: `♟️ ШАХМАТ БОТИГА ХУШ КЕЛИБСИЗ!

Бу бот орқали сиз:

🤝 Дўстларингиз билан онлайн шахмат ўйнашингиз
🤖 Сунъий интеллектга қарши кучингизни синашингиз
🏆 Рейтинг тўплаб Top ўйинчилар рўйхатига киришингиз мумкин!

Бошлаш учун қуйидаги тугмани босинг 👇`,
};

const DEFAULT_BUTTONS = {
  en: [
    { text: 'Open app', type: 'app', color: 'primary' },
    { text: 'Invite a friend', type: 'invite', color: 'default' },
  ],
  ru: [
    { text: 'Открыть приложение', type: 'app', color: 'primary' },
    { text: 'Пригласить друга', type: 'invite', color: 'default' },
  ],
  uz: [
    { text: 'Ilovani ochish', type: 'app', color: 'primary' },
    { text: "Do'stni taklif qilish", type: 'invite', color: 'default' },
  ],
  uzc: [
    { text: 'Иловани очиш', type: 'app', color: 'primary' },
    { text: 'Дўстни таклиф қилиш', type: 'invite', color: 'default' },
  ],
};

const BTN_TYPES = new Set(['app', 'invite', 'url']);
const COLORS = new Set(['default', 'primary', 'success', 'danger']);

function defaultLang(lang) {
  const code = norm(lang);
  return {
    text: DEFAULT_TEXT[code],
    mediaId: null,
    buttons: DEFAULT_BUTTONS[code].map((b) => ({ ...b })),
  };
}

function defaultWelcomeConfig() {
  const out = {};
  for (const code of LANGS) out[code] = defaultLang(code);
  return out;
}

function cleanButtons(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw.slice(0, 6)) {
    const text = String(b && b.text != null ? b.text : '').trim().slice(0, 64);
    if (!text) continue;
    const type = BTN_TYPES.has(b.type) ? b.type : 'app';
    const color = COLORS.has(b.color) ? b.color : 'default';
    const url = type === 'url' ? String(b.url || '').trim().slice(0, 512) : '';
    if (type === 'url' && !/^https?:\/\//i.test(url)) continue;
    out.push({ text, type, color, ...(type === 'url' ? { url } : {}) });
  }
  return out;
}

function normalizeLangEntry(raw, lang) {
  const base = defaultLang(lang);
  if (!raw || typeof raw !== 'object') return base;
  const text = String(raw.text != null ? raw.text : base.text).trim().slice(0, 4096) || base.text;
  let mediaId = null;
  if (raw.mediaId != null && raw.mediaId !== '') mediaId = String(raw.mediaId).slice(0, 64);
  const buttons = cleanButtons(raw.buttons);
  return {
    text,
    mediaId,
    buttons: buttons.length ? buttons : base.buttons,
  };
}

function mergeWelcomeConfig(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const out = defaultWelcomeConfig();
  if (!parsed || typeof parsed !== 'object') return out;
  for (const code of LANGS) {
    if (parsed[code]) out[code] = normalizeLangEntry(parsed[code], code);
  }
  return out;
}

async function loadWelcomeConfig() {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WELCOME_KEY);
  return mergeWelcomeConfig(row ? row.value : null);
}

async function saveWelcomeLang(lang, patch) {
  const code = norm(lang);
  if (!LANGS.includes(code)) throw new Error('bad_lang');
  const cfg = await loadWelcomeConfig();
  const next = { ...cfg[code] };
  if (patch.text !== undefined) next.text = patch.text;
  if (patch.mediaId !== undefined) next.mediaId = patch.mediaId === '' || patch.mediaId == null ? null : patch.mediaId;
  if (patch.buttons !== undefined) next.buttons = patch.buttons;
  cfg[code] = normalizeLangEntry(next, code);
  await db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(WELCOME_KEY, JSON.stringify(cfg));
  return cfg[code];
}

function openAppUrl(webAppUrl, payload) {
  const u = new URL(webAppUrl);
  // Friend invite (i…) and game (g…) deep links. Client ignores i… once already friends.
  const p = String(payload || '');
  if (/^i\d{1,15}$/.test(p) || /^g[\w-]{4,20}$/.test(p)) u.searchParams.set('p', p);
  return u.toString();
}

function referralShareUrl(botUsername, userId, shareText) {
  // startapp → Mini App with signed start_param (claimed on /me); also works after bot /start i…
  const link = `https://t.me/${botUsername}?startapp=i${userId}`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText || '')}`;
}

function resolveButtons(buttons, { webAppUrl, payload, botUsername, userId, shareText }) {
  return (buttons || []).map((b) => {
    if (b.type === 'app') {
      return { text: b.text, type: 'app', color: b.color, url: openAppUrl(webAppUrl, payload) };
    }
    if (b.type === 'invite') {
      if (!botUsername || !userId) return null;
      return {
        text: b.text,
        type: 'url',
        color: b.color,
        url: referralShareUrl(botUsername, userId, shareText),
      };
    }
    return { text: b.text, type: 'url', color: b.color, url: b.url };
  }).filter(Boolean);
}

async function buildWelcomePost(lang, { webAppUrl, payload, botUsername, userId }) {
  const code = norm(lang);
  const entry = (await loadWelcomeConfig())[code];
  const shareText = (STR[code] && STR[code].shareText) || STR.en.shareText;
  const buttons = resolveButtons(entry.buttons, {
    webAppUrl, payload, botUsername, userId, shareText,
  });
  let media = null;
  if (entry.mediaId) {
    const row = await db.prepare('SELECT * FROM media WHERE id = ?').get(entry.mediaId);
    if (row) {
      const data = await loadMediaBytes(row);
      if (data || row.file_id) {
        media = {
          id: row.id,
          kind: row.kind,
          data,
          filename: `${row.id}.bin`,
          fileId: row.file_id || null,
        };
      }
    }
  }
  return {
    text: entry.text || defaultLang(code).text,
    buttons,
    media,
    webAppUrl,
    onFileId: (id) => media && db.prepare('UPDATE media SET file_id = ? WHERE id = ?').run(id, media.id),
  };
}

/** Send the configured welcome (with optional confetti effect on plain text). */
async function sendWelcome(bot, chatId, lang, opts = {}) {
  const post = await buildWelcomePost(lang, opts);
  if (opts.messageEffectId && !post.media) {
    const { buildMarkup } = require('./posts');
    const reply_markup = buildMarkup(post.buttons, post.webAppUrl);
    try {
      return await bot.api.sendMessage(chatId, post.text, {
        reply_markup,
        link_preview_options: { is_disabled: true },
        message_effect_id: opts.messageEffectId,
      });
    } catch {
      return bot.api.sendMessage(chatId, post.text, {
        reply_markup,
        link_preview_options: { is_disabled: true },
      });
    }
  }
  return sendPost(bot, chatId, post);
}

module.exports = {
  LANGS,
  defaultWelcomeConfig,
  defaultLang,
  loadWelcomeConfig,
  saveWelcomeLang,
  normalizeLangEntry,
  mergeWelcomeConfig,
  buildWelcomePost,
  sendWelcome,
  resolveButtons,
  WELCOME_KEY,
};
