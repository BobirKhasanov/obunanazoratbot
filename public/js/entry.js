// Light entry: /me + app.js in parallel; keep splash until home first paint.
// Retries /me through Render cold-starts so users do not land on "No connection".
import { api, setInitData, tg } from './ui.js';
import { errText, setLang, t } from './i18n.js';
import { applyPerfMode } from './perf.js';

function hideBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.hidden = true;
  boot.setAttribute('hidden', '');
  boot.style.setProperty('display', 'none', 'important');
  boot.style.visibility = 'hidden';
  boot.style.pointerEvents = 'none';
  try { boot.remove(); } catch (e) { /* ignore */ }
}

function showGate(msg) {
  hideBoot();
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  if (app) app.hidden = true;
  if (gate) {
    gate.hidden = false;
    if (msg) {
      const h1 = gate.querySelector('h1');
      if (h1) h1.textContent = msg;
    }
    const retry = gate.querySelector('[data-gate-retry]');
    if (retry) {
      const net = !msg || /connection|aloqa|соединен|нет соедин/i.test(String(msg));
      retry.hidden = !net;
      retry.textContent = t('retry_live') || 'Try again';
      retry.onclick = () => { location.reload(); };
    }
  }
}

/** Reveal shell (used by start after first paint, or gate recovery). */
function showApp() {
  hideBoot();
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  if (gate) gate.hidden = true;
  if (app) {
    app.hidden = false;
    app.removeAttribute('hidden');
  }
}

function syncChrome() {
  try {
    if (!tg) return;
    try { tg.ready(); } catch (e) { /* ignore */ }
    try { tg.expand(); } catch (e) { /* ignore */ }
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { /* ignore */ }
    const bg = '#111827';
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

function assetV() {
  return document.documentElement.getAttribute('data-asset') || String(Date.now());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fire-and-forget wake so Render leaves sleep before /me. */
function wakeOrigin() {
  try {
    fetch('/healthz', { cache: 'no-store', credentials: 'omit' }).catch(() => {});
  } catch (e) { /* ignore */ }
}

async function loadMeOnce(timeoutMs) {
  const req = api('GET', '/me', undefined, { timeoutMs });
  req.catch(function () {});
  let timer;
  const backup = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(Object.assign(new Error('timeout'), { code: 'net' }));
    }, timeoutMs + 400);
  });
  try {
    return await Promise.race([req, backup]);
  } finally {
    clearTimeout(timer);
  }
}

/** Several attempts — covers Render free-tier wake (often 10–40s). */
async function loadMe() {
  const attempts = [9000, 12000, 16000];
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) wakeOrigin();
    try {
      return await loadMeOnce(attempts[i]);
    } catch (e) {
      lastErr = e;
      const code = (e && e.code) || '';
      const retryable = !code || code === 'net' || code === 'server' || code === 'timeout';
      if (!retryable || i === attempts.length - 1) throw e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr || Object.assign(new Error('timeout'), { code: 'net' });
}

function isSyntaxLoadError(e) {
  const msg = String((e && e.message) || e || '');
  return e && (e.name === 'SyntaxError'
    || /missing \) after argument list/i.test(msg)
    || /Unexpected (token|end|identifier)/i.test(msg)
    || /Identifier directly after number/i.test(msg));
}

async function main() {
  try { applyPerfMode(); } catch (e) { /* ignore */ }
  syncChrome();
  wakeOrigin();

  if (!tg || !tg.initData) {
    showGate();
    return;
  }
  setInitData(tg.initData);

  const v = assetV();
  // Download app graph while /me runs — biggest open-time win on Android
  const appP = import('./app.js?v=' + encodeURIComponent(v));

  let me;
  try {
    me = await loadMe();
  } catch (e) {
    showGate(errText(e));
    return;
  }

  try { if (me.user && me.user.lang) setLang(me.user.lang); } catch (e) { /* ignore */ }

  // Keep #boot until start() finishes first home paint (carousels included)
  try {
    const mod = await appP;
    await mod.start(me);
    try { sessionStorage.removeItem('chess-syntax-reload'); } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('[entry] app', e);
    if (isSyntaxLoadError(e)) {
      try {
        if (!sessionStorage.getItem('chess-syntax-reload')) {
          sessionStorage.setItem('chess-syntax-reload', '1');
          location.reload();
          return;
        }
      } catch (err) { /* ignore */ }
    }
    showGate(errText(e));
    try {
      const ui = await import('./ui.js?v=' + encodeURIComponent(v));
      ui.fail(e);
    } catch (err) { /* ignore */ }
  }
}

main().catch(function (e) {
  console.error('[entry]', e);
  try { showGate((e && e.message) || 'Something went wrong'); } catch (err) { hideBoot(); }
});
