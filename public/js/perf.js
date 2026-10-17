// Device performance helpers. Lite mode targets weak Android only — iOS always stays full.

/** @typedef {'LOW'|'AVERAGE'|'HIGH'|null} PerfClass */

let cached = null;

function tw() {
  return window.Telegram && window.Telegram.WebApp;
}

function readPerfClass() {
  const twApp = tw();
  // Telegram Android UA / newer clients expose performance class
  const fromApi = twApp && (twApp.devicePerformance || twApp.performanceClass || twApp.perfClass);
  if (fromApi) {
    const s = String(fromApi).toUpperCase();
    if (s.includes('LOW')) return 'LOW';
    if (s.includes('HIGH')) return 'HIGH';
    if (s.includes('AVERAGE') || s.includes('AVG') || s.includes('MEDIUM')) return 'AVERAGE';
  }
  const ua = navigator.userAgent || '';
  const m = ua.match(/Perf(?:ormance)?Class[/=:\s]*(LOW|AVERAGE|HIGH|AVG|MEDIUM)/i);
  if (!m) return null;
  const v = m[1].toUpperCase();
  if (v === 'AVG' || v === 'MEDIUM') return 'AVERAGE';
  return /** @type {PerfClass} */ (v);
}

function detect() {
  if (cached) return cached;
  const twApp = tw();
  const platform = String((twApp && twApp.platform) || '').toLowerCase();
  const ua = navigator.userAgent || '';
  const isAndroid = platform === 'android' || /Android/i.test(ua);
  const isIOS = platform === 'ios' || /iPhone|iPad|iPod/i.test(ua);
  const performanceClass = readPerfClass();
  const cores = Number(navigator.hardwareConcurrency) || 4;
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
  const reducedMotion = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  })();

  // Lite ONLY on Android. iOS never gets lite — even with reduced-motion.
  // Mid/unknown Android → lite (HIGH stays full). Caps cores/mem alone miss many 8-core phones.
  let lite = false;
  if (isAndroid && !isIOS) {
    if (reducedMotion) lite = true;
    else if (performanceClass === 'HIGH') lite = false;
    else if (performanceClass === 'LOW' || performanceClass === 'AVERAGE') lite = true;
    else lite = true; // unknown Android → lite (safer default)
  }

  cached = {
    platform: platform || (isAndroid ? 'android' : isIOS ? 'ios' : 'unknown'),
    isAndroid,
    isIOS,
    performanceClass,
    lite,
    cores,
    mem,
  };
  return cached;
}

/** Apply html[data-perf] / data-android / data-ios / data-view3d for CSS. Safe to call multiple times. */
export function applyPerfMode() {
  const p = detect();
  const root = document.documentElement;
  root.dataset.perf = p.lite ? 'lite' : 'full';
  if (p.isAndroid) root.dataset.android = '1';
  else delete root.dataset.android;
  if (p.isIOS) root.dataset.ios = '1';
  else delete root.dataset.ios;
  // CSS/SVG "studio 3D" depth — on for iOS + normal Android; off on weak Android lite
  if (p.lite) delete root.dataset.view3d;
  else root.dataset.view3d = '1';
  return p;
}

/** Whether the CSS/SVG 3D board presentation is active. */
export function isView3d() { return !detect().lite; }

export function isLite() { return detect().lite; }
export function isAndroid() { return detect().isAndroid; }
export function isIOS() { return detect().isIOS; }
export function getPerf() { return detect(); }

/** Lichess round grid poll (ms). Slower on Android; even slower on lite. */
export function liveRoundPollMs() {
  const p = detect();
  if (p.lite) return 5000;
  if (p.isAndroid) return 3000;
  return 2000;
}

/** Open live game poll (ms) — kept short so the board stays close to live. */
export function liveGamePollMs() {
  const p = detect();
  if (p.lite) return 3000;
  if (p.isAndroid) return 2000;
  return 1000;
}

/** Local clock UI tick (ms) — live boards + in-game clocks. */
export function liveClockTickMs() {
  return detect().lite ? 500 : 250;
}

/** In-game chess clock drain tick (ms). */
export function gameClockTickMs() {
  return detect().lite ? 400 : 200;
}

/** Home / lobby soft refresh when WS is connected (ms). */
export function homeTabRefreshMs() {
  const p = detect();
  if (p.lite) return 24000;
  if (p.isAndroid) return 16000;
  return 14000;
}

/** Sheet / inbox / friend-wait soft poll (ms). */
export function softPollMs() {
  const p = detect();
  if (p.lite) return 10000;
  if (p.isAndroid) return 6000;
  return 5000;
}

/** Announcement carousel auto-advance dwell (ms). */
export function carouselDwellMs() {
  return detect().lite ? 10000 : 6000;
}

/** Cap carousel slides (and media fetches) on weak Android. */
export function carouselMaxSlides() {
  const p = detect();
  if (p.lite) return 2;
  if (p.isAndroid) return 4;
  return Infinity;
}

/** Per-image media fetch timeout (ms) — keeps boot splash from hanging. */
export function mediaFetchTimeoutMs() {
  const p = detect();
  // Lite Android often needs more than 1.4s on TG WebView — empty media looked like "no carousel"
  if (p.lite) return 3200;
  if (p.isAndroid) return 2800;
  return 4500;
}

/** How many mini-boards to mount on a live round (rest = lightweight placeholder). */
export function liveMiniBoardBudget() {
  return detect().lite ? 4 : Infinity;
}

/** Victory emoji rain count (0 = skip). */
export function rainCount() {
  return detect().lite ? 0 : 28;
}

/** Piece glide animations on the chess board. */
export function boardAnimateDefault() {
  return !detect().lite;
}
