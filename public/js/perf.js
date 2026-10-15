// Device performance helpers. Lite mode targets weak Android only — iOS / high-end stay full.
// No imports from ui.js (avoid circular deps with rain / boot).

/** @typedef {'LOW'|'AVERAGE'|'HIGH'|null} PerfClass */

let cached = null;

function tw() {
  return window.Telegram && window.Telegram.WebApp;
}

function readPerfClass() {
  const twApp = tw();
  // Future / newer clients
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

  // Lite: weak Android (or reduced-motion). Never force lite on iOS solely for being iOS.
  let lite = reducedMotion;
  if (isAndroid) {
    if (performanceClass === 'LOW') lite = true;
    else if (performanceClass === 'AVERAGE' && ((mem != null && mem <= 4) || cores <= 4)) lite = true;
    else if (!performanceClass && ((mem != null && mem <= 3) || cores <= 4)) lite = true;
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

/** Apply html[data-perf] / data-android for CSS. Safe to call multiple times. */
export function applyPerfMode() {
  const p = detect();
  const root = document.documentElement;
  root.dataset.perf = p.lite ? 'lite' : 'full';
  if (p.isAndroid) root.dataset.android = '1';
  else delete root.dataset.android;
  return p;
}

export function isLite() { return detect().lite; }
export function isAndroid() { return detect().isAndroid; }
export function getPerf() { return detect(); }

/** Lichess round grid poll (ms). Slower on Android; even slower on lite. */
export function liveRoundPollMs() {
  const p = detect();
  if (p.lite) return 7000;
  if (p.isAndroid) return 5000;
  return 3000;
}

/** Open live game poll (ms). */
export function liveGamePollMs() {
  const p = detect();
  if (p.lite) return 5000;
  if (p.isAndroid) return 4000;
  return 2000;
}

/** Local clock UI tick (ms). */
export function liveClockTickMs() {
  return detect().lite ? 500 : 250;
}

/** Home / lobby soft refresh when WS is connected (ms). Longer = lighter free tier. */
export function homeTabRefreshMs() {
  const p = detect();
  if (p.lite) return 20000;
  if (p.isAndroid) return 16000;
  return 14000;
}

/** Sheet / inbox / friend-wait soft poll (ms). */
export function softPollMs() {
  const p = detect();
  if (p.lite) return 8000;
  if (p.isAndroid) return 6000;
  return 5000;
}

/** How many mini-boards to mount on a live round (rest = lightweight placeholder). */
export function liveMiniBoardBudget() {
  return detect().lite ? 6 : Infinity;
}

/** Victory emoji rain count. */
export function rainCount() {
  return detect().lite ? 10 : 28;
}
