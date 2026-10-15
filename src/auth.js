const crypto = require('crypto');

const ADMIN_IDS = (process.env.ADMIN_IDS || '1895441858')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 as documented by Telegram).
 * Returns { user, startParam } or null.
 */
function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !user.id) return null;
    // Telegram Direct Link / startapp payload (signed) — used to pay referral bonuses
    user.startParam = String(params.get('start_param') || '').trim() || null;
    return user;
  } catch {
    return null;
  }
}

const isAdmin = (id) => ADMIN_IDS.includes(Number(id));

module.exports = { validateInitData, isAdmin, ADMIN_IDS };
