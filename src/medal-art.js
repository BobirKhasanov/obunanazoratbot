// Monthly podium medals: ONE approved artwork (assets/medals/base-top{1,2,3}.jpg, built by
// tools/make-medal-base.py) with only the month, the year and "TOP-N" drawn on top as vector text.
// The text is converted to paths with the bundled font so every client (Telegram PNG, <img>, share)
// shows exactly the same picture.
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const ROOT = path.join(__dirname, '..', 'assets');
const fontBuf = fs.readFileSync(path.join(ROOT, 'fonts', 'Poppins-Bold.ttf'));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const bases = {};
for (const p of [1, 2, 3]) {
  bases[p] = `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, 'medals', `base-top${p}.jpg`)).toString('base64')}`;
}

const BOT_HANDLE = '@chess_uz_bot';
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const PALETTE = {
  1: { top: '#fff3b0', mid: '#ffd23f', bot: '#e8970c', edge: '#0b1636' },
  2: { top: '#ffffff', mid: '#dfe4f0', bot: '#8d97ae', edge: '#160a30' },
  3: { top: '#ffdcb8', mid: '#e39a5f', bot: '#a65d29', edge: '#06190b' },
};

/** Glyph paths for `text`, laid out on an arc (radius R, 0 = straight) centred at (cx, baseY). */
function textPaths(text, { size, cx, baseY, maxWidth, R = 0 }) {
  const chars = [...text];
  const adv = (c) => font.getAdvanceWidth(c, size);
  let total = chars.reduce((s, c) => s + adv(c), 0);
  let sz = size;
  if (maxWidth && total > maxWidth) { sz = size * (maxWidth / total); total = maxWidth; }
  const k = sz / size;
  let x = cx - total / 2;
  const out = [];
  for (const c of chars) {
    const w = adv(c) * k;
    if (c !== ' ') {
      const mid = x + w / 2;
      const dx = mid - cx;
      const y = R ? baseY + (dx * dx) / (2 * R) : baseY;
      const ang = R ? (Math.atan(dx / R) * 180) / Math.PI : 0;
      const d = font.getPath(c, -w / 2, 0, sz).toPathData(2);
      out.push(`<path transform="translate(${mid.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(2)})" d="${d}"/>`);
    }
    x += w;
  }
  return out.join('');
}

function monthParts(month) {
  const [y, m] = String(month).split('-');
  const idx = Math.max(0, Math.min(11, Number(m) - 1));
  return { year: String(Number(y) || new Date().getUTCFullYear()), name: MONTHS[idx] };
}

/** @param {{ place: number, month: string }} o  month = 'YYYY-MM' */
function renderMedalSvg({ place, month }) {
  const pl = Math.min(3, Math.max(1, Math.floor(Number(place) || 1)));
  const { year, name } = monthParts(month);
  const label = `${name} ${year}`;
  const pal = PALETTE[pl];
  const ribbon = textPaths(label, { size: 96, cx: 627, baseY: 836, maxWidth: 625, R: 1700 });
  const tier = textPaths(`TOP-${pl}`, { size: 104, cx: 627, baseY: 1028, maxWidth: 300 });
  const handle = textPaths(BOT_HANDLE, { size: 62, cx: 627, baseY: 1196, maxWidth: 520 });
  const titleCase = `${name[0]}${name.slice(1).toLowerCase()} ${year}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" data-medal="3" data-place="${pl}" data-month="${month}" role="img" aria-label="${titleCase} TOP-${pl}">
<title>${titleCase} · TOP-${pl}</title>
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.top}"/><stop offset=".5" stop-color="${pal.mid}"/><stop offset="1" stop-color="${pal.bot}"/></linearGradient></defs>
<rect width="1254" height="1254" fill="#050608"/>
<image href="${bases[pl]}" x="0" y="0" width="1254" height="1254" preserveAspectRatio="xMidYMid slice"/>
<g fill="#000" opacity=".45" transform="translate(0 5)">${ribbon}${tier}${handle}</g>
<g fill="${pal.edge}" stroke="${pal.edge}" stroke-width="9" stroke-linejoin="round">${ribbon}${tier}${handle}</g>
<g fill="url(#g)">${ribbon}${tier}${handle}</g>
</svg>`;
}

module.exports = { renderMedalSvg, monthParts, BOT_HANDLE };
