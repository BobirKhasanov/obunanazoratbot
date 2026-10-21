/**
 * Monthly podium medals. The picture itself lives in medal-art.js (approved artwork, only the
 * month/year/TOP-N change); this file keeps the calendar helpers (Tashkent time) and the wrappers.
 */
const { renderMedalSvg } = require('./medal-art');

function monthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

function monthLabelEn(key) {
  const [y, m] = String(key).split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Math.max(0, Math.min(11, Number(m) - 1))]} ${y}`;
}

function seasonLabel(key) {
  return monthLabelEn(key).toUpperCase();
}

function previousMonthKey(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Tashkent calendar parts (Asia/Tashkent wall clock). */
function tashkentParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  let hour = g('hour');
  // en-CA may yield 24 for midnight in some engines
  if (hour === 24) hour = 0;
  return { year: g('year'), month: g('month'), day: g('day'), hour, minute: g('minute') };
}

/** Tashkent calendar day 1–31 as number. */
function tashkentDay(date = new Date()) {
  return tashkentParts(date).day;
}

function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** True on the last calendar day of the month in Tashkent. */
function isLastDayOfMonthTashkent(date = new Date()) {
  const p = tashkentParts(date);
  return p.day === daysInMonth(p.year, p.month);
}

function titleFor(place, month) {
  return `Top ${place} · ${monthLabelEn(month)}`;
}

/** @param {{ place:1|2|3, month:string }} opts */
function generateMedalSvg(opts) {
  return renderMedalSvg({ place: opts.place, month: opts.month || monthKey() });
}

/** List YYYY-MM keys for a year (admin month picker). */
function monthsForYear(year) {
  const y = Number(year) || Number(monthKey().slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

module.exports = {
  monthKey, monthLabelEn, seasonLabel, previousMonthKey, tashkentDay, tashkentParts,
  isLastDayOfMonthTashkent, titleFor, generateMedalSvg, monthsForYear,
};
