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
    this.pieces = new Map(); // square -> {el, c, t}
    this.selected = null; this.legal = [];
    this.squares = h('div.squares'); this.hl = h('div.hl'); this.layer = h('div.pieces'); this.coords = h('div.coords');
    this.el = h('div.board', this.squares, this.hl, this.layer, this.coords);
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
  place(el, sq) { const { x, y } = this.xy(sq); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; el.dataset.sq = sq; }

  /** Show a position. chess: chess.js instance. mine: colour that may move ('w'|'b') or null for view-only. */
  set(chess, { lastMove = null, orientation = this.orientation, mine = null, animate = true } = {}) {
    const flipped = orientation !== this.orientation;
    this.chess = chess; this.lastMove = lastMove; this.mine = mine; this.orientation = orientation;
    this.deselect();
    this.el.classList.toggle('still', !animate);
    this.syncPieces(lastMove);
    if (flipped) for (const [sq, p] of this.pieces) this.place(p.el, sq);
    this.drawCoords(); this.drawHighlights();
    if (!animate) requestAnimationFrame(() => this.el.classList.remove('still'));
  }

  syncPieces(last) {
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
      if (osq) { const o = oldLeft.get(osq); oldLeft.delete(osq); kept.set(sq, o); this.place(o.el, sq); newLeft.delete(sq); }
    }
    for (const [, o] of oldLeft) { o.el.classList.add('gone'); const el = o.el; setTimeout(() => el.remove(), 320); }
    for (const [sq, p] of newLeft) {
      const el = h('div.piece', { html: pieceSvg(p.color, p.type) });
      this.place(el, sq); el.classList.add('born'); this.layer.append(el);
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

  mark(sq, cls) { const { x, y } = this.xy(sq); const el = h('u.' + cls); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; this.hl.append(el); return el; }
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
    if (this.hintMove) { this.mark(this.hintMove.from, 'hint'); this.mark(this.hintMove.to, 'hint'); }
  }
  showHint(m) { this.hintMove = m; this.drawHighlights(); clearTimeout(this.hintT); this.hintT = setTimeout(() => { this.hintMove = null; this.drawHighlights(); }, 2500); }

  canTouch(sq) {
    if (!this.chess || !this.mine || this.chess.turn() !== this.mine) return false;
    const p = this.chess.get(sq);
    return !!p && p.color === this.mine;
  }
  select(sq) {
    this.selected = sq; this.legal = this.chess.moves({ square: sq, verbose: true }); this.drawHighlights();
  }
  deselect() { this.selected = null; this.legal = []; this.promo && this.closePromo(); }

  down(e) {
    if (this.promo || e.button > 0) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && this.legal.some((m) => m.to === sq)) { this.tryMove(this.selected, sq); return; } // tap-to-move
    if (this.canTouch(sq)) {
      this.select(sq); haptic('select');
      const p = this.pieces.get(sq);
      if (p) { this.drag = { sq, el: p.el, sx: e.clientX, sy: e.clientY, moved: false }; }
    } else if (this.selected) { this.deselect(); this.drawHighlights(); }
  }
  move(e) {
    const d = this.drag; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) { d.moved = true; d.el.classList.add('drag'); }
    const b = this.el.getBoundingClientRect(), cell = b.width / 8;
    const { x, y } = this.xy(d.sq);
    d.el.style.transform = `translate(${(e.clientX - b.left) / cell * 100 - 50}%, ${(e.clientY - b.top) / cell * 100 - 60}%)`;
    d.el.dataset.x = x; d.el.dataset.y = y;
  }
  up(e) {
    const d = this.drag; if (!d) return;
    this.drag = null; d.el.classList.remove('drag');
    if (!d.moved) { this.place(d.el, d.sq); return; }
    const to = this.sqAt(e.clientX, e.clientY);
    if (to && to !== d.sq && this.legal.some((m) => m.to === to)) this.tryMove(d.sq, to);
    else { this.place(d.el, d.sq); haptic('light'); }
  }
  cancelDrag() { if (this.drag) { this.drag.el.classList.remove('drag'); this.place(this.drag.el, this.drag.sq); this.drag = null; } }

  tryMove(from, to) {
    const cand = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!cand.length) { const p = this.pieces.get(from); if (p) this.place(p.el, from); return; }
    if (cand[0].promotion) { this.askPromotion(from, to, cand[0].color); return; }
    this.commit(from, to);
  }
  commit(from, to, promotion) {
    this.deselect(); haptic('light');
    this.opts.onMove && this.opts.onMove(from, to, promotion);
  }
  askPromotion(from, to, colour) {
    const p = this.pieces.get(from); if (p) this.place(p.el, from);
    const { x } = this.xy(to);
    const down = this.xy(to).y === 0; // promotion square at the top: list grows downward
    const box = h('div.promo', { style: { left: `${Math.min(Math.max(x, 0), 4) * 12.5 + (x > 4 ? 0 : 0)}%` } });
    const opts = ['q', 'n', 'r', 'b'];
    const wrap = h('div.promo-wrap', h('div.promo-title', t('promote_to')), box);
    box.style.left = '12.5%'; box.style.right = '12.5%';
    box.style.top = down ? '25%' : '25%';
    for (const o of opts) box.append(h('button.promo-btn', { onclick: (ev) => { ev.stopPropagation(); this.closePromo(); this.commit(from, to, o); }, html: pieceSvg(colour, o) }));
    wrap.addEventListener('pointerdown', (ev) => { if (ev.target === wrap) { this.closePromo(); this.drawHighlights(); } });
    this.promo = wrap; this.el.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
  }
  closePromo() { if (this.promo) { this.promo.remove(); this.promo = null; } }
}
