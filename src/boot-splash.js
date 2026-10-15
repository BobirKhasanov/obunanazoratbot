// Admin-managed Mini App boot splash: title/subtitle per language + animation style.
const { LANGS, norm } = require('./i18n');

function db() { return require('./db'); }

const BOOT_KEY = 'boot_splash_config';
const ANIMATIONS = ['orbit', 'pulse', 'bars'];

const DEFAULT_COPY = {
  en: { title: 'Loading game', subtitle: 'Please wait…' },
  ru: { title: 'Игра загружается', subtitle: 'Подождите…' },
  uz: { title: "O'yin yuklanmoqda", subtitle: 'Iltimos kuting…' },
  uzc: { title: 'Ўйин юкланмоқда', subtitle: 'Илтимос кутинг…' },
};

function defaultLang(code) {
  const c = norm(code);
  return {
    title: DEFAULT_COPY[c].title,
    subtitle: DEFAULT_COPY[c].subtitle,
  };
}

function defaultBootConfig() {
  const out = { animation: 'orbit' };
  for (const code of LANGS) out[code] = defaultLang(code);
  return out;
}

function normalizeLangEntry(raw, code) {
  const d = defaultLang(code);
  const title = String((raw && raw.title) != null ? raw.title : d.title).trim().slice(0, 80) || d.title;
  const subtitle = String((raw && raw.subtitle) != null ? raw.subtitle : d.subtitle).trim().slice(0, 120);
  return { title, subtitle };
}

function normalizeBootConfig(raw) {
  const base = defaultBootConfig();
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') return base;
  const anim = ANIMATIONS.includes(parsed.animation) ? parsed.animation : 'orbit';
  const out = { animation: anim };
  for (const code of LANGS) {
    out[code] = normalizeLangEntry(parsed[code], code);
  }
  return out;
}

async function loadBootSplashConfig() {
  const row = await db().prepare('SELECT value FROM app_settings WHERE key = ?').get(BOOT_KEY);
  return normalizeBootConfig(row && row.value);
}

async function saveBootSplashLang(lang, patch) {
  const code = norm(lang);
  const cfg = await loadBootSplashConfig();
  cfg[code] = normalizeLangEntry({ ...cfg[code], ...patch }, code);
  if (patch && patch.animation != null && ANIMATIONS.includes(patch.animation)) {
    cfg.animation = patch.animation;
  }
  await db().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(BOOT_KEY, JSON.stringify(cfg));
  return cfg;
}

async function saveBootSplashConfig(next) {
  const cfg = normalizeBootConfig(next);
  await db().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(BOOT_KEY, JSON.stringify(cfg));
  return cfg;
}

module.exports = {
  ANIMATIONS,
  DEFAULT_COPY,
  defaultBootConfig,
  normalizeBootConfig,
  loadBootSplashConfig,
  saveBootSplashLang,
  saveBootSplashConfig,
};
