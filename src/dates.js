// Date helpers. All dates are plain 'YYYY-MM-DD' strings in the configured TZ (default Europe/Riga).
const TZ = process.env.TZ || 'Europe/Riga';

const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function today() {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function hourNow() {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())
  ) % 24;
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addDays(s, n) {
  const { y, m, d } = parse(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function addMonths(s, n, anchorDay) {
  const { y, m, d } = parse(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay || d, daysInMonth(ny, nm));
  return fmt(ny, nm, day);
}

function diffDays(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** The charge date that follows `s` for a given period. `anchorDay` keeps e.g. the 31st stable. */
function nextOccurrence(s, period, anchorDay) {
  if (period === 'weekly') return addDays(s, 7);
  if (period === 'yearly') return addMonths(s, 12, anchorDay);
  return addMonths(s, 1, anchorDay);
}

/** Roll a stale next_date forward until it is today or later. */
function rollForward(s, period, anchorDay, now = today()) {
  let cur = s;
  let guard = 0;
  while (cur < now && guard++ < 5000) cur = nextOccurrence(cur, period, anchorDay);
  return cur;
}

/** All charge dates of a subscription within [from, to] inclusive. */
function occurrencesBetween(nextDate, period, from, to) {
  const anchorDay = parse(nextDate).d;
  const out = [];
  let cur = nextDate;
  let guard = 0;
  while (cur <= to && guard++ < 5000) {
    if (cur >= from) out.push(cur);
    cur = nextOccurrence(cur, period, anchorDay);
  }
  return out;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: fmt(y, m, 1), to: fmt(y, m, daysInMonth(y, m)) };
}

module.exports = {
  TZ, today, hourNow, addDays, addMonths, diffDays, nextOccurrence,
  rollForward, occurrencesBetween, isDate, monthRange, parse,
};
