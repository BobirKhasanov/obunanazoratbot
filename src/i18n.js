// Server-side strings (bot messages and notifications). The Mini App has its own dictionary in
// public/js/i18n.js. Language codes: en, ru, uz (Uzbek Latin), uzc (Uzbek Cyrillic).
const LANGS = ['uz', 'uzc', 'ru', 'en'];

const STR = {
  en: {
    welcome: (n) => `♟ Welcome${n}!\n\nPlay chess against the computer, challenge players who are online or invite your friends, right here in Telegram.`,
    open: '♟ Play',
    openGame: '♟ Open game',
    invited: (n) => `🎮 ${n} invited you to a game of chess. Tap the button to join.`,
    help: 'Tap Play to open the game.\n\n/start - open the game\n/play - open the game\n/lang - change language\n/help - this message',
    challenge: (n) => `⚔️ ${n} challenges you to a game of chess!`,
    accepted: (n) => `✅ ${n} joined your game. Let's play!`,
    yourMove: (n) => `⏰ Your move against ${n}.`,
    reminder: (n) => `⏳ ${n} is waiting for your move.`,
    win: (n) => `🏆 You won against ${n}!`,
    loss: (n) => `😔 ${n} won this game.`,
    draw: (n) => `🤝 Draw against ${n}.`,
    drawOffer: (n) => `🤝 ${n} offers a draw.`,
    friendJoined: (n) => `👋 ${n} joined through your invite. You are now friends. Challenge them to a game!`,
    unknown: 'Tap the button below to start playing.',
    description: 'Play chess against the computer, online players or your friends, right inside Telegram.',
    shortDescription: 'Chess in Telegram: vs computer, online or friends',
  },
  ru: {
    welcome: (n) => `♟ Добро пожаловать${n}!\n\nИграйте в шахматы с компьютером, вызывайте игроков онлайн или приглашайте друзей, прямо в Telegram.`,
    open: '♟ Играть',
    openGame: '♟ Открыть партию',
    invited: (n) => `🎮 ${n} приглашает вас сыграть в шахматы. Нажмите кнопку, чтобы присоединиться.`,
    help: 'Нажмите «Играть», чтобы открыть игру.\n\n/start - открыть игру\n/play - открыть игру\n/lang - сменить язык\n/help - эта справка',
    challenge: (n) => `⚔️ ${n} вызывает вас на партию в шахматы!`,
    accepted: (n) => `✅ ${n} присоединился к вашей партии. Играем!`,
    yourMove: (n) => `⏰ Ваш ход в партии с ${n}.`,
    reminder: (n) => `⏳ ${n} ждёт вашего хода.`,
    win: (n) => `🏆 Вы выиграли партию у ${n}!`,
    loss: (n) => `😔 В этой партии победил(а) ${n}.`,
    draw: (n) => `🤝 Ничья с ${n}.`,
    drawOffer: (n) => `🤝 ${n} предлагает ничью.`,
    friendJoined: (n) => `👋 ${n} присоединился(ась) по вашему приглашению. Теперь вы друзья. Вызовите на партию!`,
    unknown: 'Нажмите кнопку ниже, чтобы начать игру.',
    description: 'Играйте в шахматы с компьютером, игроками онлайн или друзьями, прямо в Telegram.',
    shortDescription: 'Шахматы в Telegram: с компьютером, онлайн или с друзьями',
  },
  uz: {
    welcome: (n) => `♟ Xush kelibsiz${n}!\n\nKompyuter bilan shaxmat o'ynang, onlayn o'yinchilarni o'yinga chorlang yoki do'stlaringizni taklif qiling, to'g'ridan-to'g'ri Telegramda.`,
    open: "♟ O'ynash",
    openGame: "♟ O'yinni ochish",
    invited: (n) => `🎮 ${n} sizni shaxmat o'ynashga taklif qildi. Qo'shilish uchun tugmani bosing.`,
    help: "O'yinni ochish uchun «O'ynash» tugmasini bosing.\n\n/start - o'yinni ochish\n/play - o'yinni ochish\n/lang - tilni o'zgartirish\n/help - yordam",
    challenge: (n) => `⚔️ ${n} sizni shaxmat o'yiniga chorlamoqda!`,
    accepted: (n) => `✅ ${n} o'yiningizga qo'shildi. O'ynaymiz!`,
    yourMove: (n) => `⏰ ${n} bilan o'yinda yurish navbati sizda.`,
    reminder: (n) => `⏳ ${n} sizning yurishingizni kutmoqda.`,
    win: (n) => `🏆 Siz ${n} ustidan g'alaba qozondingiz!`,
    loss: (n) => `😔 Bu o'yinda ${n} g'olib bo'ldi.`,
    draw: (n) => `🤝 ${n} bilan durang.`,
    drawOffer: (n) => `🤝 ${n} durang taklif qilmoqda.`,
    friendJoined: (n) => `👋 ${n} taklifingiz orqali qo'shildi. Endi do'stsiz. O'yinga chorlang!`,
    unknown: "O'ynashni boshlash uchun pastdagi tugmani bosing.",
    description: "Kompyuter, onlayn o'yinchilar yoki do'stlaringiz bilan shaxmat o'ynang, to'g'ridan-to'g'ri Telegramda.",
    shortDescription: "Telegramda shaxmat: kompyuter, onlayn yoki do'stlar bilan",
  },
  uzc: {
    welcome: (n) => `♟ Хуш келибсиз${n}!\n\nКомпьютер билан шахмат ўйнанг, онлайн ўйинчиларни ўйинга чорланг ёки дўстларингизни таклиф қилинг, тўғридан-тўғри Телеграмда.`,
    open: '♟ Ўйнаш',
    openGame: '♟ Ўйинни очиш',
    invited: (n) => `🎮 ${n} сизни шахмат ўйнашга таклиф қилди. Қўшилиш учун тугмани босинг.`,
    help: 'Ўйинни очиш учун «Ўйнаш» тугмасини босинг.\n\n/start - ўйинни очиш\n/play - ўйинни очиш\n/lang - тилни ўзгартириш\n/help - ёрдам',
    challenge: (n) => `⚔️ ${n} сизни шахмат ўйинига чорламоқда!`,
    accepted: (n) => `✅ ${n} ўйинингизга қўшилди. Ўйнаймиз!`,
    yourMove: (n) => `⏰ ${n} билан ўйинда юриш навбати сизда.`,
    reminder: (n) => `⏳ ${n} сизнинг юришингизни кутмоқда.`,
    win: (n) => `🏆 Сиз ${n} устидан ғалаба қозондингиз!`,
    loss: (n) => `😔 Бу ўйинда ${n} ғолиб бўлди.`,
    draw: (n) => `🤝 ${n} билан дуранг.`,
    drawOffer: (n) => `🤝 ${n} дуранг таклиф қилмоқда.`,
    friendJoined: (n) => `👋 ${n} таклифингиз орқали қўшилди. Энди дўстсиз. Ўйинга чорланг!`,
    unknown: 'Ўйнашни бошлаш учун пастдаги тугмани босинг.',
    description: 'Компьютер, онлайн ўйинчилар ёки дўстларингиз билан шахмат ўйнанг, тўғридан-тўғри Телеграмда.',
    shortDescription: 'Телеграмда шахмат: компьютер, онлайн ёки дўстлар билан',
  },
};

const LANG_BUTTONS = [
  { code: 'uz', label: "🇺🇿 O'zbekcha" },
  { code: 'uzc', label: '🇺🇿 Ўзбекча' },
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'en', label: '🇬🇧 English' },
];

const norm = (l) => (LANGS.includes(l) ? l : 'en');
const tr = (lang) => STR[norm(lang)];

/** Map Telegram's language_code to one of ours (used until the user picks one). */
function fromTelegram(code) {
  const c = String(code || '').toLowerCase();
  if (c.startsWith('ru')) return 'ru';
  if (c.startsWith('uz')) return 'uz';
  return 'en';
}

module.exports = { LANGS, LANG_BUTTONS, STR, tr, norm, fromTelegram };
