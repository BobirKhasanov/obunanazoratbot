const db = require('./db');
const D = require('./dates');

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', RUB: '₽', UZS: "so'm" };
const money = (amount, cur) => {
  const n = Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const s = CURRENCY_SYMBOLS[cur] || cur;
  return s.length === 1 && cur !== 'UZS' ? `${s}${n}` : `${n} ${s}`;
};

/** Move subscriptions whose date has passed to their next upcoming charge. */
function rollAllSubscriptions() {
  const now = D.today();
  const stale = db.prepare('SELECT id, period, next_date FROM subscriptions WHERE active = 1 AND next_date < ?').all(now);
  const upd = db.prepare('UPDATE subscriptions SET next_date = ? WHERE id = ?');
  for (const s of stale) upd.run(D.rollForward(s.next_date, s.period, D.parse(s.next_date).d, now), s.id);
}

function dueText(name, amount, cur, days, date) {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days (${date})`;
  return `${name} renews ${when}: ${money(amount, cur)}`;
}

/**
 * Sends one reminder per subscription per billing cycle, once the user's
 * "remind me N days before" window is reached.
 */
async function sendReminders(bot) {
  rollAllSubscriptions();
  const now = D.today();
  const rows = db.prepare(`
    SELECT s.id, s.user_id, s.name, s.amount, s.next_date, s.last_notified, u.currency, u.notify_days
    FROM subscriptions s JOIN users u ON u.id = s.user_id
    WHERE s.active = 1 AND u.notify_enabled = 1 AND u.blocked = 0
  `).all();

  const mark = db.prepare('UPDATE subscriptions SET last_notified = ? WHERE id = ?');
  const note = db.prepare('INSERT INTO notifications (user_id, type, text) VALUES (?, ?, ?)');
  const botBlocked = db.prepare('UPDATE users SET bot_blocked = 1 WHERE id = ?');
  const canDm = db.prepare('SELECT bot_blocked FROM users WHERE id = ?');

  for (const s of rows) {
    const days = D.diffDays(now, s.next_date);
    if (days < 0 || days > s.notify_days || s.last_notified === s.next_date) continue;

    const text = dueText(s.name, s.amount, s.currency, days, s.next_date);
    note.run(s.user_id, 'renewal', text);
    mark.run(s.next_date, s.id);

    if (bot && !canDm.get(s.user_id).bot_blocked) {
      try {
        await bot.api.sendMessage(s.user_id, `Reminder\n${text}`);
      } catch (e) {
        if (e.error_code === 403) botBlocked.run(s.user_id);
        else console.error('[reminder] send failed:', e.message);
      }
      await new Promise((r) => setTimeout(r, 50)); // stay far below Telegram's rate limit
    }
  }
}

function startScheduler(bot) {
  const reminderHour = Number(process.env.REMINDER_HOUR ?? 9);
  let lastRunDay = null;

  const tick = async () => {
    try {
      const day = D.today();
      if (lastRunDay !== day && D.hourNow() >= reminderHour) {
        lastRunDay = day;
        await sendReminders(bot);
      }
    } catch (e) {
      console.error('[scheduler] error:', e);
    }
  };

  tick();
  return setInterval(tick, 5 * 60 * 1000);
}

module.exports = { startScheduler, sendReminders, rollAllSubscriptions };
