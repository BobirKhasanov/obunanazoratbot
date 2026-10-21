// Full-screen subpages (slide in from the right). Stacked so admin sections return to the admin hub.
import { $, tg, nativeBackWanted } from './ui.js';

/** @type {{ build: Function, opts: object, close: Function }[]} */
const stack = [];

function isLitePerf() {
  try { return document.documentElement.dataset.perf === 'lite'; } catch { return false; }
}
function isAndroidShell() {
  try { return document.documentElement.dataset.android === '1'; } catch { return false; }
}

function hideShell() {
  const el = $('#screen');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  try { tg.BackButton.hide(); } catch { /* ignore */ }
  // Wait for CSS close transition: lite ~160ms, Android ~340ms, iOS ~950ms
  const ms = isLitePerf() ? 200 : (isAndroidShell() ? 400 : 820);
  setTimeout(() => { if (!el.classList.contains('show')) el.replaceChildren(); }, ms);
}

function bindBack(close) {
  try {
    // Drop handlers from lower stack levels so only the top screen responds
    for (const e of stack) {
      try { tg.BackButton.offClick(e.close); } catch { /* ignore */ }
    }
    tg.BackButton.onClick(close);
    if (nativeBackWanted()) tg.BackButton.show(); else tg.BackButton.hide();
  } catch { /* ignore */ }
}

function renderTop({ animate } = { animate: true }) {
  const el = $('#screen');
  if (!el) return;
  const top = stack[stack.length - 1];
  if (!top) {
    hideShell();
    return;
  }
  el.replaceChildren(...[].concat(top.build(top.close)).flat(Infinity).filter(Boolean));
  el.scrollTop = 0;
  el.removeAttribute('aria-hidden');
  // Lite: skip reflow on first open (faster). If already open (stacked), always restart enter anim.
  const alreadyOpen = el.classList.contains('show');
  if (animate && (alreadyOpen || !isLitePerf())) {
    el.classList.remove('show');
    void el.offsetWidth;
  }
  el.classList.add('show');
  if (top.opts && top.opts.tgBack === false) {
    try { tg.BackButton.hide(); } catch { /* ignore */ }
  } else {
    bindBack(top.close);
  }
}

/** build(close) → nodes to put inside #screen. opts.onClose runs after this level is dismissed. */
export function openScreen(build, opts = {}) {
  const el = $('#screen');
  if (!el) return () => {};

  let closed = false;
  const entry = { build, opts, close: null };
  const close = (silent) => {
    if (closed) return;
    if (stack[stack.length - 1] !== entry) return;
    closed = true;
    stack.pop();
    try { tg.BackButton.offClick(close); } catch { /* ignore */ }
    try { opts.onClose && opts.onClose(); } catch { /* ignore */ }
    if (stack.length) {
      // Re-open previous level (e.g. admin hub) instead of jumping to profile
      renderTop({ animate: !silent });
    } else {
      hideShell();
    }
  };
  entry.close = close;
  stack.push(entry);
  renderTop({ animate: true });
  return close;
}

export function closeScreen(silent) {
  // Close the entire stack (tab change / leave profile)
  while (stack.length) {
    const top = stack[stack.length - 1];
    top.close(silent || stack.length > 1);
  }
}

export function screenOpen() {
  return stack.length > 0;
}
