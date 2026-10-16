// Animated chess board. Pieces are keyed DOM elements positioned with CSS transforms, so every move
// (including castling, captures and flips) glides instead of jumping.
import { h, haptic } from './ui.js';
import { pieceSvg, clearPieceCache } from './pieces.js';
import { t } from './i18n.js';

const FILES = 'abcdefgh';
const liveBoards = new Set();

/** Rebuild SVG inside every live board after piece-set / theme change. */
export function restyleBoards() {
  clearPieceCache();
  for (const b of liveBoards) {
    for (const [, p] of b.pieces) p.el.innerHTML = pieceSvg(p.c, p.t);
  }
}

export class Board {
  /** opts.onMove(from, to, promotion|undefined) -> called after the player makes a legal move */
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.orientation = 'w'; this.chess = null; this.lastMove = null; this.mine = null; // colour allowed to move, or null
    this.premoveEnabled = false; // Chess.com-style premove (bullet 1+0)
    this.premove = null; // { from, to, promotion } queued while waiting
    this.pieces = new Map(); // square -> {el, c, t}
    this.selected = null; this.legal = [];
    this.squares = h('div.squares'); this.hl = h('div.hl'); this.layer = h('div.pieces'); this.coords = h('div.coords');
    this.el = h('div.board', this.squares, this.hl, this.layer, this.coords);
    this.setBoardTouchAction('pan-y');
    root.append(this.el);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) this.squares.append(h('i' + ((r + c) % 2 ? '.dk' : '.lt')));
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.h = { move: (e) => this.move(e), up: (e) => this.up(e), cancel: () => this.cancelDrag() };
    window.addEventListener('pointermove', this.h.move);
    window.addEventListener('pointerup', this.h.up);
    window.addEventListener('pointercancel', this.h.cancel);
    this.drag = null;
    liveBoards.add(this);
  }

  destroy() {
    liveBoards.delete(this);
    window.removeEventListener('pointermove', this.h.move);
    window.removeEventListener('pointerup', this.h.up);
    window.removeEventListener('pointercancel', this.h.cancel);
    clearTimeout(this.hintT);
    clearTimeout(this.settleT);
  }

  // square name -> {x, y} in board cells for the current orientation
  xy(sq) {
    const f = FILES.indexOf(sq[0]), r = 8 - Number(sq[1]);
    return this.orientation === 'w' ? { x: f, y: r } : { x: 7 - f, y: 7 - r };
  }
  sqAt(px, py) {
    const b = this.el.getBoundingClientRect();
    const x = Math.floor(((px - b.left) / b.width) * 8), y = Math.floor(((py - b.top) / b.height) * 8);
    if (x < 0 || y < 0 || x > 7 || y > 7) return null;
    const f = this.orientation === 'w' ? x : 7 - x, r = this.orientation === 'w' ? 8 - y : y + 1;
    return FILES[f] + r;
  }
  place(el, sq, { animate = true } = {}) {
    const { x, y } = this.xy(sq);
    // translate3d — stable compositing; % is relative to the piece box (= one square)
    const next = `translate3d(${x * 100}%, ${y * 100}%, 0)`;
    if (!animate) {
      const prev = el.style.transition;
      el.style.transition = 'none';
      el.style.transform = next;
      // force reflow so later transitions don't replay from a stale matrix
      void el.offsetWidth;
      el.style.transition = prev;
    } else {
      el.style.transform = next;
    }
    el.dataset.sq = sq;
  }

  /** Snap every piece to its square and kill leftover transition jitter. */
  settlePieces() {
    for (const [sq, p] of this.pieces) {
      this.place(p.el, sq, { animate: false });
      p.el.classList.remove('drag', 'born');
      p.el.style.willChange = 'auto';
    }
  }

  /** Show a position. chess: chess.js instance. mine: colour that may move ('w'|'b') or null for view-only. */
  set(chess, { lastMove = null, orientation = this.orientation, mine = null, animate = true, premoveEnabled = this.premoveEnabled } = {}) {
    const flipped = orientation !== this.orientation;
    this.chess = chess; this.lastMove = lastMove; this.mine = mine; this.orientation = orientation;
    this.premoveEnabled = !!premoveEnabled;
    this.deselect();
    // Weak Android (data-perf=lite): skip piece glides. iOS stays animated.
    const lite = document.documentElement.dataset.perf === 'lite';
    if (lite) animate = false;
    clearTimeout(this.settleT);
    this.el.classList.toggle('still', !animate);
    this.syncPieces(lastMove, animate);
    if (flipped) for (const [sq, p] of this.pieces) this.place(p.el, sq, { animate: false });
    this.drawCoords(); this.drawHighlights();
    if (!animate) {
      this.settlePieces();
      requestAnimationFrame(() => this.el.classList.remove('still'));
    } else {
      // After the glide finishes, hard-snap so pieces don't keep jittering
      this.settleT = setTimeout(() => {
        this.el.classList.add('still');
        this.settlePieces();
        requestAnimationFrame(() => this.el.classList.remove('still'));
      }, 380);
    }
  }

  syncPieces(last, animate = true) {
    const next = new Map();
    for (const row of this.chess.board()) for (const p of row) if (p) next.set(p.square, p);
    const oldLeft = new Map(this.pieces); const newLeft = new Map();
    const kept = new Map();
    for (const [sq, p] of next) {
      const o = oldLeft.get(sq);
      if (o && o.c === p.color && o.t === p.type) { kept.set(sq, o); oldLeft.delete(sq); } else newLeft.set(sq, p);
    }
    // moved pieces: match leftovers by colour+type, preferring the move's origin square
    const takeOld = (p, sq) => {
      if (last && sq === last.to && oldLeft.has(last.from)) { const o = oldLeft.get(last.from); if (o.c === p.color && o.t === p.type) return last.from; }
      for (const [osq, o] of oldLeft) if (o.c === p.color && o.t === p.type) return osq;
      return null;
    };
    for (const [sq, p] of newLeft) {
      const osq = takeOld(p, sq);
      if (osq) {
        const o = oldLeft.get(osq); oldLeft.delete(osq); kept.set(sq, o);
        if (animate) o.el.style.willChange = 'transform';
        this.place(o.el, sq, { animate });
        newLeft.delete(sq);
      }
    }
    for (const [, o] of oldLeft) { o.el.classList.add('gone'); const el = o.el; setTimeout(() => el.remove(), 320); }
    for (const [sq, p] of newLeft) {
      const el = h('div.piece', { html: pieceSvg(p.color, p.type) });
      this.place(el, sq, { animate: false }); el.classList.add('born'); this.layer.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('born')));
      kept.set(sq, { el, c: p.color, t: p.type });
    }
    for (const [sq, p] of kept) p.el.dataset.sq = sq;
    this.pieces = kept;
  }

  drawCoords() {
    this.coords.replaceChildren();
    for (let i = 0; i < 8; i++) {
      const f = this.orientation === 'w' ? FILES[i] : FILES[7 - i], r = this.orientation === 'w' ? 8 - i : i + 1;
      this.coords.append(h('b.cf', { style: { left: `${i * 12.5}%` } }, f), h('b.cr', { style: { top: `${i * 12.5}%` } }, String(r)));
    }
  }

  mark(sq, cls) { const { x, y } = this.xy(sq); const el = h('u.' + cls); el.style.transform = `translate3d(${x * 100}%, ${y * 100}%, 0)`; this.hl.append(el); return el; }
  drawHighlights() {
    this.hl.replaceChildren();
    if (this.lastMove) { this.mark(this.lastMove.from, 'last'); this.mark(this.lastMove.to, 'last'); }
    if (this.chess && this.chess.inCheck()) {
      const turn = this.chess.turn();
      for (const row of this.chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) this.mark(p.square, 'check');
    }
    if (this.selected) {
      this.mark(this.selected, 'sel');
      for (const m of this.legal) this.mark(m.to, m.captured || m.flags.includes('e') ? 'cap' : 'mv');
    }
    if (this.premove) {
      this.mark(this.premove.from, 'pre');
      this.mark(this.premove.to, 'pre');
    }
    if (this.hintMove) { this.mark(this.hintMove.from, 'hint'); this.mark(this.hintMove.to, 'hint'); }
  }
  showHint(m) { this.hintMove = m; this.drawHighlights(); clearTimeout(this.hintT); this.hintT = setTimeout(() => { this.hintMove = null; this.drawHighlights(); }, 2500); }
  clearPremove() { this.premove = null; this.drawHighlights(); }
  takePremove() { const p = this.premove; this.premove = null; this.drawHighlights(); return p; }

  canTouch(sq) {
    if (!this.chess || !this.mine) return false;
    const p = this.chess.get(sq);
    if (!p || p.color !== this.mine) return false;
    // Own turn: normal. Opponent's turn + premoveEnabled: queue a premove (Chess.com).
    if (this.chess.turn() === this.mine) return true;
    return !!this.premoveEnabled;
  }
  select(sq) {
    this.selected = sq;
    if (this.chess.turn() === this.mine) {
      this.legal = this.chess.moves({ square: sq, verbose: true });
    } else {
      // Pseudo-legal destinations from a cloned board with side-to-move flipped for UI dots
      this.legal = this.premoveDests(sq);
    }
    this.drawHighlights();
  }
  /** Destinations for a premove (ignore whose turn it is — Chess.com style). */
  premoveDests(from) {
    try {
      const tmp = new (this.chess.constructor)();
      const parts = this.chess.fen().split(' ');
      parts[1] = this.mine;
      parts[3] = '-';
      tmp.load(parts.join(' '));
      return tmp.moves({ square: from, verbose: true });
    } catch {
      return [];
    }
  }
  deselect() { this.selected = null; this.legal = []; this.promo && this.closePromo(); }

  setBoardTouchAction(mode) {
    // pan-y: finger scroll over the board reaches the game screen; none: active piece drag
    try { this.el.style.touchAction = mode; } catch { /* ignore */ }
  }

  down(e) {
    if (this.promo || e.button > 0) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && this.legal.some((m) => m.to === sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (this.canTouch(sq)) {
      // Chess.com: tap the same piece again to deselect
      if (this.selected === sq) {
        this.deselect();
        this.drawHighlights();
        haptic('select');
        return;
      }
      this.select(sq); haptic('select');
      const p = this.pieces.get(sq);
      if (p) {
        // mode null until we know drag vs vertical page scroll
        this.drag = {
          sq, el: p.el, sx: e.clientX, sy: e.clientY,
          moved: false, mode: null, id: e.pointerId,
        };
      }
    } else if (this.selected) {
      this.deselect();
      this.drawHighlights();
    }
  }
  move(e) {
    const d = this.drag; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.mode) {
      if (Math.hypot(dx, dy) < 10) return;
      // Vertical intent → let the game screen scroll; do not wash the piece
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        this.place(d.el, d.sq, { animate: false });
        this.drag = null;
        this.setBoardTouchAction('pan-y');
        return;
      }
      d.mode = 'drag';
      d.moved = true;
      d.el.classList.add('drag');
      this.setBoardTouchAction('none');
      try { this.el.setPointerCapture(d.id); } catch { /* ignore */ }
    }
    if (d.mode !== 'drag') return;
    const b = this.el.getBoundingClientRect(), cell = b.width / 8;
    const { x, y } = this.xy(d.sq);
    d.el.style.transform = `translate3d(${(e.clientX - b.left) / cell * 100 - 50}%, ${(e.clientY - b.top) / cell * 100 - 55}%, 0)`;
    d.el.dataset.x = x; d.el.dataset.y = y;
  }
  up(e) {
    const d = this.drag; if (!d) return;
    this.drag = null;
    d.el.classList.remove('drag');
    this.setBoardTouchAction('pan-y');
    try { this.el.releasePointerCapture(d.id); } catch { /* ignore */ }
    if (!d.moved || d.mode !== 'drag') { this.place(d.el, d.sq, { animate: false }); return; }
    const to = this.sqAt(e.clientX, e.clientY);
    if (to && to !== d.sq && this.legal.some((m) => m.to === to)) this.tryMove(d.sq, to);
    else { this.place(d.el, d.sq, { animate: true }); haptic('light'); }
  }
  cancelDrag() {
    if (!this.drag) return;
    const d = this.drag;
    d.el.classList.remove('drag');
    this.place(d.el, d.sq, { animate: false });
    this.drag = null;
    this.setBoardTouchAction('pan-y');
  }

  tryMove(from, to) {
    const myTurn = this.chess.turn() === this.mine;
    if (!myTurn && this.premoveEnabled) {
      const cand = this.premoveDests(from).filter((m) => m.to === to);
      if (!cand.length) { const p = this.pieces.get(from); if (p) this.place(p.el, from); return; }
      if (cand[0].promotion) { this.askPromotion(from, to, cand[0].color, true); return; }
      this.commitPremove(from, to);
      return;
    }
    const cand = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!cand.length) { const p = this.pieces.get(from); if (p) this.place(p.el, from); return; }
    if (cand[0].promotion) { this.askPromotion(from, to, cand[0].color, false); return; }
    this.commit(from, to);
  }
  commitPremove(from, to, promotion) {
    this.deselect();
    this.premove = { from, to, promotion };
    this.drawHighlights();
    haptic('select');
    this.opts.onPremove && this.opts.onPremove(from, to, promotion);
  }
  commit(from, to, promotion) {
    this.deselect(); this.premove = null; haptic('light');
    this.opts.onMove && this.opts.onMove(from, to, promotion);
  }
  askPromotion(from, to, colour, asPremove = false) {
    const p = this.pieces.get(from); if (p) this.place(p.el, from);
    const { x, y } = this.xy(to);
    // Chess.com: vertical Q/N/R/B column on the promotion file, starting at the promo square
    const growDown = y === 0;
    const opts = ['q', 'n', 'r', 'b'];
    const box = h('div.promo.promo-col', {
      style: {
        left: `${x * 12.5}%`,
        top: growDown ? '0%' : '50%',
        flexDirection: growDown ? 'column' : 'column-reverse',
      },
      role: 'listbox',
      'aria-label': t('promote_to'),
    });
    const wrap = h('div.promo-wrap', box);
    for (const o of opts) {
      box.append(h('button.promo-btn', {
        type: 'button',
        role: 'option',
        'aria-label': o,
        onclick: (ev) => {
          ev.stopPropagation();
          this.closePromo();
          if (asPremove) this.commitPremove(from, to, o);
          else this.commit(from, to, o);
        },
        html: pieceSvg(colour, o),
      }));
    }
    wrap.addEventListener('pointerdown', (ev) => {
      if (ev.target === wrap) { this.closePromo(); this.drawHighlights(); }
    });
    this.promo = wrap; this.el.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
  }
  closePromo() { if (this.promo) { this.promo.remove(); this.promo = null; } }
}
