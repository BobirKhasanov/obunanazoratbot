// Light entry: dismiss splash + /me before downloading the heavy app graph (game/live/profile…).
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
  try { boot.remove(); } catch { /* ignore */ }
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
    try { tg.ready(); } catch { /* ignore */ }
    try { tg.expand(); } catch { /* ignore */ }
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* ignore */ }
    const bg = '#111827';
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

async function loadMe() {
  const req = api('GET', '/me', undefined, { timeoutMs: 6_000 });
  req.catch(() => {});
  let timer;
  const backup = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'net' })), 6_500);
  });
  try {
    return await Promise.race([req, backup]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  try { applyPerfMode(); } catch { /* ignore */ }
  syncChrome();

  if (!tg || !tg.initData) {
    showGate();
    return;
  }
  setInitData(tg.initData);

  let me;
  try {
    me = await loadMe();
  } catch (e) {
    showGate(errText(e));
    return;
  }

  // Reveal shell BEFORE downloading game/live/profile modules
  try { if (me.user && me.user.lang) setLang(me.user.lang); } catch { /* ignore */ }
  showApp();

  try {
    const mod = await import('./app.js');
    await mod.start(me);
  } catch (e) {
    console.error('[entry] app', e);
    // Shell already visible — show a toast-level failure if possible
    try {
      const { fail } = await import('./ui.js');
      fail(e);
    } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('[entry]', e);
  try { showGate((e && e.message) || 'Something went wrong'); } catch { hideBoot(); }
});
