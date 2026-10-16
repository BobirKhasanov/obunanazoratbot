// Light entry: /me + app.js in parallel; keep splash until home first paint.
import { api, setInitData, tg } from './ui.js';
import { errText, setLang } from './i18n.js';
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

async function loadMe() {
  const req = api('GET', '/me', undefined, { timeoutMs: 5000 });
  req.catch(function () {});
  let timer;
  const backup = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(Object.assign(new Error('timeout'), { code: 'net' }));
    }, 5500);
  });
  try {
    return await Promise.race([req, backup]);
  } finally {
    clearTimeout(timer);
  }
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
