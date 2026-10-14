// Full-screen subpages (slide in from the right). Shared by profile + admin.
import { $, tg } from './ui.js';

let closer = null;

/** build(close) → nodes to put inside #screen. opts.onClose runs after dismiss. */
export function openScreen(build, opts = {}) {
  const el = $('#screen');
  if (!el) return () => {};
  if (closer) {
    const prev = closer;
    closer = null;
    try { prev(true); } catch { /* ignore */ }
  }
  let closed = false;
  const close = (silent) => {
    if (closed) return;
    closed = true;
    if (closer === close) closer = null;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
    try { tg.BackButton.offClick(close); if (!silent) tg.BackButton.hide(); } catch { /* ignore */ }
    try { opts.onClose && opts.onClose(); } catch { /* ignore */ }
    setTimeout(() => { if (!el.classList.contains('show')) el.replaceChildren(); }, 520);
  };
  closer = close;
  el.replaceChildren(...[].concat(build(close)).flat(Infinity).filter(Boolean));
  el.scrollTop = 0;
  el.removeAttribute('aria-hidden');
  // force reflow so the slide-in animates
  void el.offsetWidth;
  el.classList.add('show');
  try { tg.BackButton.onClick(close); tg.BackButton.show(); } catch { /* ignore */ }
  return close;
}

export function closeScreen(silent) {
  if (closer) closer(silent);
}

export function screenOpen() {
  return !!closer;
}
