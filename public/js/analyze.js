// Game review — Chess.com-style: per-move quality tags, evaluation, coach comments, arrows,
// retry. The maths lives in review-core.mjs (unit-tested); the opening book in openings.mjs.
import { Chess } from '/vendor/chess.js';
import { h, icon, haptic, api, fail, sleep, toast } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';
import { isLite, isIOS } from './perf.js';
import { Board } from './board.js';
import {
  MATE, winPct, isMateScore, mateIn, fmtEval, classifyMove, accuracyOf, countTags, TAGS, PIECE_VALUE,
} from './review-core.mjs';
import { bookInfo } from './openings.mjs';

// ---------- engine plumbing (web worker with main-thread fallback) ----------
let worker = null; let workerBroken = false; let reqId = 0;
const pending = new Map();
function startWorker() {
  if (worker || workerBroken) return;
  try {
    worker = new Worker('/js/ai-worker.mjs', { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.move); } };
    worker.onerror = () => { workerBroken = true; worker = null; for (const [, p] of pending) p(undefined); pending.clear(); };
  } catch { workerBroken = true; }
}
let mainEngine = null;
/** Best move + score (centipawns for the side to move) of a position. */
async function engine(fen, timeMs) {
  startWorker();
  if (worker) {
    const id = ++reqId;
    const r = await new Promise((res) => {
      pending.set(id, res);
      worker.postMessage({ id, fen, level: 4, seen: [], timeMs });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(undefined); } }, timeMs + 600);
    });
    if (r) return r;
  }
  if (!mainEngine) { const m = await import('./ai.mjs'); mainEngine = m.makeEngine(Chess); }
  await sleep(10);
  return mainEngine.bestMove(fen, 4, { seen: [], timeMs });
}

const uciOf = (m) => (m ? `${m.from}${m.to}${m.promotion || ''}` : '');

// ---------- chess helpers for the coach ----------
/** Did the mover give up real material that the opponent can win back? (brilliant candidates) */
function isSacrifice(fenBefore, mv) {
  try {
    if (mv.piece === 'p' || mv.piece === 'k') return false;
    const pv = PIECE_VALUE[mv.piece];
    const gain = mv.captured ? PIECE_VALUE[mv.captured] : 0;
    const c = new Chess(fenBefore);
    c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    const caps = c.moves({ verbose: true }).filter((m) => m.to === mv.to && m.captured);
    if (!caps.length) return false;
    caps.sort((a, b) => PIECE_VALUE[a.piece] - PIECE_VALUE[b.piece]);
    const a = caps[0];
    c.move(a.san);
    const recapture = c.moves({ verbose: true }).some((m) => m.to === mv.to && m.captured);
    const net = gain - pv + (recapture ? PIECE_VALUE[a.piece] : 0);
    return net <= -200;
  } catch { return false; }
}

/** The moved piece now attacks two (or more) valuable pieces / the king at once. */
function forkTargets(fenAfter, mv) {
  try {
    const parts = fenAfter.split(' ');
    parts[1] = mv.color; parts[3] = '-'; // pretend the mover is to move again
    const c = new Chess(parts.join(' '));
    const pv = PIECE_VALUE[mv.piece] || 0;
    const seen = new Set();
    for (const m of c.moves({ square: mv.to, verbose: true })) {
      if (!m.captured) continue;
      if (m.captured === 'k' || PIECE_VALUE[m.captured] > pv) seen.add(m.to);
    }
    return seen.size;
  } catch { return 0; }
}

// ---------- visuals ----------
const BADGE = {
  brilliant: ['!!', '#26c2a3'], great: ['!', '#5b8bb0'], best: ['★', '#81b64c'], excellent: ['✓', '#81b64c'],
  good: ['✓', '#95b776'], book: ['♗', '#a88865'], inaccuracy: ['?!', '#f7c631'],
  mistake: ['?', '#e58f2a'], miss: ['✕', '#ca3431'], blunder: ['??', '#ca3431'],
};
const TAG_KEY = {
  brilliant: 'rv_brilliant', great: 'rv_great', best: 'analyze_best', excellent: 'analyze_excellent', good: 'analyze_good',
  book: 'rv_book', inaccuracy: 'analyze_inaccuracy', mistake: 'analyze_mistake', miss: 'analyze_miss', blunder: 'analyze_blunder',
};
const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const tagLabel = (tag) => t(TAG_KEY[tag]);

/** Coach title + sentence for one reviewed move. */
function coachFor(row, openingName) {
  const san = row.san;
  const best = row.bestSan || '';
  let title = t('rv_is', { san, tag: tagLabel(row.tag) });
  if (row.tag === 'best') title = t('rv_is_best', { san });
  if (row.tag === 'book') title = t('rv_book');
  let text;
  const f = row.feat;
  if (f.mate) text = t('rv_c_mate');
  else if (row.tag === 'book') text = (openingName ? `${openingName}. ` : '') + t('rv_c_book');
  else if (row.tag === 'brilliant') text = t('rv_c_brilliant');
  else if (row.tag === 'great') text = t('rv_c_great');
  else if (BAD.has(row.tag)) {
    text = row.bestMate && best ? t('rv_c_mate_missed', { n: row.bestMate, best }) : t('rv_c_' + row.tag, { best });
  } else if (f.fork) text = t('rv_c_fork', { piece: t('rv_p_' + row.piece), sq: row.to });
  else if (f.promo) text = t('rv_c_promo');
  else if (f.castle) text = t('rv_c_castle');
  else if (f.check) text = t('rv_c_check');
  else if (row.tag === 'best') text = t(row.i % 2 ? 'rv_c_best2' : 'rv_c_best');
  else text = t('rv_c_' + row.tag, { best });
  return { title, text };
}

// ---------- review ----------
/**
 * Open the review for a finished game. Claims a daily slot on the server first.
 * @param {{ id: string, moves: any[], white?: object, black?: object, you?: string, result?: string }} game
 */
export async function openGameAnalysis(game) {
  if (!game || !game.id) return;
  const localOnly = String(game.id).startsWith('ai-');
  let payload = game;
  if (!localOnly && !(payload.moves && payload.moves.length)) {
    try {
      const r = await api('GET', `/games/${game.id}`);
      if (r.game) payload = { ...payload, ...r.game };
    } catch (e) { fail(e); return; }
  }
  if (!localOnly) {
    try { await api('POST', `/games/${payload.id}/analyze`); } catch (e) { fail(e); return; }
  }

  openScreen((close) => {
    const host = h('div.analyze-screen.rv');
    let board = null;
    let dead = false;
    const tearDown = () => {
      dead = true;
      try { if (board) board.destroy(); } catch { /* ignore */ }
      board = null;
    };
    const progress = (n, total) => host.replaceChildren(
      h('div.rv-load',
        h('div.rv-load-art', '♞'),
        h('b', t('analyze_loading')),
        h('p.muted', `${t('analyze_progress', { n: String(n), total: String(total) })} · ${t('rv_engine')}`),
        h('div.rv-load-bar', h('i', { style: { width: `${Math.round((n / Math.max(1, total)) * 100)}%` } }))));
    progress(0, (payload.moves || []).length);

    const run = async () => {
      const moves = payload.moves || [];
      const lite = isLite();
      const timeMs = lite ? 140 : isIOS() ? 240 : 320;

      // 1. replay the game, remembering every position and move detail
      const chess = new Chess();
      const fens = [chess.fen()];
      const plies = [];
      for (let i = 0; i < moves.length; i++) {
        const [from, to, promotion] = moves[i];
        const fenBefore = chess.fen();
        let mv;
        try { mv = chess.move({ from, to, promotion }); } catch { break; }
        plies.push({
          i, colour: mv.color, san: mv.san, from: mv.from, to: mv.to, piece: mv.piece, promotion: mv.promotion,
          uci: `${mv.from}${mv.to}${mv.promotion || ''}`, fenBefore, fenAfter: chess.fen(), mv,
          feat: {
            check: chess.inCheck() && !chess.isCheckmate(), mate: chess.isCheckmate(),
            castle: mv.san.startsWith('O-O'), promo: !!mv.promotion,
          },
        });
        fens.push(chess.fen());
      }
      const n = plies.length;

      // 2. evaluate every position with the engine (score = side to move, centipawns)
      const E = new Array(n + 1);
      const BEST = new Array(n + 1);
      for (let k = 0; k <= n; k++) {
        if (dead) return;
        const c = new Chess(fens[k]);
        if (c.isGameOver()) E[k] = c.isCheckmate() ? -MATE : 0;
        else {
          let r = null;
          try { r = await engine(fens[k], timeMs); } catch { r = null; }
          E[k] = r && Number.isFinite(r.score) ? r.score : 0;
          BEST[k] = r || null;
        }
        if (k % 2 === 0) { progress(Math.min(k + 1, n), n); await sleep(0); }
      }

      // 3. score each move
      const sans = plies.map((p) => p.san);
      const book = bookInfo(sans);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const p = plies[i];
        const before = E[i];
        const after = -E[i + 1];
        const bestMove = BEST[i];
        const bestUci = uciOf(bestMove);
        const playedIsBest = !!bestUci && bestUci === p.uci;
        const winBefore = winPct(before);
        const winAfter = winPct(after);
        const lossRaw = playedIsBest ? 0 : Math.max(0, winBefore - winAfter);
        const prevLoss = i ? rows[i - 1].lossRaw : 0;
        const sacrifice = !p.feat.mate && isSacrifice(p.fenBefore, p.mv);
        let tag = classifyMove({
          playedIsBest, loss: lossRaw, isBook: i < book.plies, prevLoss, sacrifice, winBefore, winAfter,
        });
        if (p.feat.mate) tag = 'best';
        let bestSan = '';
        if (bestMove) { try { bestSan = new Chess(p.fenBefore).move({ from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion }).san; } catch { bestSan = ''; } }
        const evalW = p.colour === 'w' ? after : -after;
        const feat = { ...p.feat, fork: !p.feat.mate && forkTargets(p.fenAfter, p.mv) >= 2 };
        rows.push({
          ...p, tag, loss: lossRaw, lossRaw, winBefore, winAfter, bestUci, bestSan, evalW, feat,
          bestMate: bestMove && isMateScore(before) && before > 0 ? mateIn(before) : 0,
          evalBeforeW: p.colour === 'w' ? before : -before,
        });
      }

      renderReview(rows, fens, book);
      haptic('success');
    };

    // ---------- UI ----------
    const wName = (payload.white && payload.white.name) || t('white');
    const bName = (payload.black && payload.black.name) || t('black');
    const orientation = payload.you === 'b' ? 'b' : 'w';

    function renderReview(rows, fens, book) {
      const n = rows.length;
      let idx = 0; let mode = 'after'; let view = 'summary';
      let retrying = null;

      const wRows = rows.filter((r) => r.colour === 'w');
      const bRows = rows.filter((r) => r.colour === 'b');
      const wAcc = accuracyOf(wRows);
      const bAcc = accuracyOf(bRows);
      const wCounts = countTags(rows, 'w');
      const bCounts = countTags(rows, 'b');

      // ----- summary -----
      const summary = () => {
        const res = payload.result || '½-½';
        let line = t('draw_title');
        if (res === '1-0') line = t('analyze_winner', { name: wName });
        else if (res === '0-1') line = t('analyze_winner', { name: bName });

        const accCard = (name, acc, side) => h('div.rv-acc.' + side,
          h('span.rv-acc-name', name),
          h('b.rv-acc-num', acc.toFixed(1)),
          h('span.rv-acc-lbl', t('rv_acc')));

        // evaluation graph (white win chance over the game)
        const W = 320; const H = 64;
        const pts = [winPct(0)].concat(rows.map((r) => winPct(r.evalW)));
        const x = (k) => (n ? (k / n) * W : 0);
        const y = (v) => H - (v / 100) * H;
        const line2 = pts.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
        const graph = h('div.rv-graph', {
          onclick: (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const k = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * n);
            haptic('select'); view = 'review'; showAt(k);
          },
          html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
            + `<rect width="${W}" height="${H}" fill="#2b2f36"/>`
            + `<path d="${line2}L${W},${H}L0,${H}Z" fill="#f2f2f2"/>`
            + `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#7b8190" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`
            + '</svg>',
        });

        const countRow = (tag) => h('div.rv-cnt.' + tag,
          h('span.rv-cnt-l', h('i.rv-dot', { style: { background: BADGE[tag][1] } }, BADGE[tag][0]), tagLabel(tag)),
          h('b', String(wCounts[tag] || 0)),
          h('b', String(bCounts[tag] || 0)));

        host.replaceChildren(
          h('div.card.rv-sum',
            h('b.rv-sum-title', line),
            h('p.muted', t('result_label', { r: res }) + (book.name ? ` · ${t('rv_opening')}: ${book.name}` : '')),
            h('div.rv-acc-grid', accCard(wName, wAcc, 'w'), accCard(bName, bAcc, 'b')),
            graph,
            h('div.rv-cnts', TAGS.filter((k) => (wCounts[k] || 0) + (bCounts[k] || 0) > 0).map(countRow))),
          h('button.rv-next', { type: 'button', onclick: () => { haptic('medium'); view = 'review'; showAt(0); } }, t('rv_start_review')));
      };

      // ----- review -----
      const coachAv = h('div.rv-av', '♞');
      const coachHead = h('div.rv-bh');
      const coachText = h('p.rv-text');
      const coach = h('div.rv-coach', coachAv, h('div.rv-bubble', coachHead, coachText));
      const boardHost = h('div.rv-board');
      const bar = h('div.rv-bar', h('i'));
      const strip = h('div.rv-moves');
      const mkBtn = (label, onclick, cls = '') => h('button.rv-act' + cls, { type: 'button', onclick }, label);
      const bShow = mkBtn([icon('eye', 20), h('span', t('rv_show'))], () => toggleMode('show'));
      const bBest = mkBtn([icon('sparkles', 20), h('span', t('rv_bestbtn'))], () => toggleMode('best'));
      const bRetry = mkBtn([icon('refresh', 20), h('span', t('rv_retry'))], () => startRetry());
      const bNext = h('button.rv-next', { type: 'button', onclick: () => next() }, t('rv_next'));
      const arrowBtn = (ch, d) => h('button.rv-step', { type: 'button', 'aria-label': ch, onclick: () => { haptic('select'); showAt(idx + d); } }, ch);

      const posFor = (k) => new Chess(fens[Math.max(0, Math.min(n, k))]);

      const paintBoard = () => {
        if (!board) return;
        const row = idx > 0 ? rows[idx - 1] : null;
        let c; let last = null; let overlay = null;
        if (mode === 'after' || !row) {
          c = posFor(idx);
          last = row ? { from: row.from, to: row.to } : null;
          if (row) overlay = { badges: [{ sq: row.to, text: BADGE[row.tag][0], color: BADGE[row.tag][1] }] };
        } else if (mode === 'show') {
          c = new Chess(row.fenBefore);
          const arrows = [];
          if (row.bestUci) arrows.push({ from: row.bestUci.slice(0, 2), to: row.bestUci.slice(2, 4), color: '#81b64c' });
          if (row.uci !== row.bestUci) arrows.push({ from: row.from, to: row.to, color: '#ca3431' });
          overlay = { arrows };
        } else if (mode === 'best') {
          c = new Chess(row.fenBefore);
          try {
            if (row.bestUci) {
              c.move({ from: row.bestUci.slice(0, 2), to: row.bestUci.slice(2, 4), promotion: row.bestUci[4] });
              last = { from: row.bestUci.slice(0, 2), to: row.bestUci.slice(2, 4) };
              overlay = { badges: [{ sq: last.to, text: BADGE.best[0], color: BADGE.best[1] }] };
            }
          } catch { c = posFor(idx); }
        } else { // retry
          c = new Chess(row.fenBefore);
        }
        board.set(c, { lastMove: last, mine: mode === 'retry' ? row.colour : null, orientation, animate: !isLite() });
        board.setOverlay(overlay);
      };

      const paintCoach = () => {
        const row = idx > 0 ? rows[idx - 1] : null;
        const bad = row && BAD.has(row.tag);
        coachHead.replaceChildren();
        if (!row) {
          coachHead.append(h('b', t('analyze_title')));
          coachText.textContent = idx >= n && n ? t('rv_end') : t('rv_start');
        } else if (mode === 'retry') {
          coachHead.append(h('b', t('rv_retry')));
          coachText.textContent = t('rv_retry_hint');
        } else {
          const { title, text } = coachFor(row, book.name);
          const [sym, col] = BADGE[row.tag];
          coachHead.append(
            h('i.rv-sym', { style: { background: col } }, sym),
            h('b', title),
            h('span.rv-eval' + (row.evalW >= 0 ? '.pos' : '.neg'), fmtEval(row.evalW)));
          coachText.textContent = text;
        }
        const ew = row ? row.evalW : 0;
        const pct = winPct(ew);
        const fill = bar.firstChild;
        fill.style.height = `${pct}%`;
        bar.classList.toggle('flip', orientation === 'b');
        bShow.disabled = !row || !row.bestUci || mode === 'retry';
        bBest.disabled = !row || !row.bestUci || mode === 'retry';
        bRetry.disabled = !bad;
        bShow.classList.toggle('on', mode === 'show');
        bBest.classList.toggle('on', mode === 'best');
        bRetry.classList.toggle('on', mode === 'retry');
        bNext.textContent = idx >= n ? t('rv_summary') : t('rv_next');
      };

      const paintStrip = () => {
        let cur = null;
        [...strip.children].forEach((el, k) => { const on = k === idx - 1; el.classList.toggle('on', on); if (on) cur = el; });
        if (cur) strip.scrollTo({ left: cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2, behavior: 'smooth' });
        else strip.scrollTo({ left: 0 });
      };

      function showAt(k) {
        idx = Math.max(0, Math.min(n, k));
        mode = 'after'; retrying = null;
        if (view === 'summary') { summary(); return; }
        mountReview();
        paintBoard(); paintCoach(); paintStrip();
      }
      function toggleMode(m) {
        if (idx === 0) return;
        haptic('select');
        mode = mode === m ? 'after' : m;
        paintBoard(); paintCoach();
      }
      function next() {
        haptic('light');
        if (idx >= n) { view = 'summary'; mode = 'after'; summary(); return; }
        showAt(idx + 1);
      }
      function startRetry() {
        const row = idx > 0 ? rows[idx - 1] : null;
        if (!row || !BAD.has(row.tag)) return;
        haptic('medium');
        mode = 'retry'; retrying = row;
        paintBoard(); paintCoach();
        board.opts.onMove = async (from, to, promotion) => {
          const r = retrying; if (!r || mode !== 'retry') return;
          const uci = `${from}${to}${promotion || ''}`;
          const c = new Chess(r.fenBefore);
          try { c.move({ from, to, promotion }); } catch { return; }
          let ok = uci === r.bestUci;
          if (!ok && uci !== r.uci) {
            coachText.textContent = t('rv_engine');
            try {
              const e = await engine(c.fen(), 220);
              const afterCp = c.isGameOver() ? (c.isCheckmate() ? MATE : 0) : -(e && Number.isFinite(e.score) ? e.score : 0);
              ok = winPct(r.evalBeforeW * (r.colour === 'w' ? 1 : -1)) - winPct(afterCp) < 5;
            } catch { ok = false; }
          }
          if (dead || mode !== 'retry') return;
          if (ok) {
            haptic('success'); toast(t('rv_retry_ok'));
            mode = 'best'; retrying = null; paintBoard(); paintCoach();
          } else {
            haptic('error'); coachText.textContent = t('rv_retry_no');
            board.set(new Chess(r.fenBefore), { lastMove: null, mine: r.colour, orientation, animate: !isLite() });
          }
        };
      }

      function mountReview() {
        if (host.querySelector('.rv-board')) return;
        tearBoard();
        strip.replaceChildren(...rows.map((r, k) => {
          const ply = Math.floor(k / 2) + 1;
          return h('button.rv-mv.' + r.tag, {
            type: 'button', onclick: () => { haptic('select'); showAt(k + 1); },
          }, r.colour === 'w' ? h('small', `${ply}.`) : null, h('span', r.san));
        }));
        host.replaceChildren(
          coach,
          h('div.rv-boardrow', bar, boardHost),
          h('div.rv-strip', arrowBtn('‹', -1), strip, arrowBtn('›', 1)),
          h('div.rv-actions', h('div.rv-small', bShow, bBest, bRetry), bNext),
          h('button.rv-sumlink', { type: 'button', onclick: () => { haptic('light'); view = 'summary'; summary(); } }, t('rv_summary')));
        try {
          board = new Board(boardHost, {});
          board.orientation = orientation;
        } catch { boardHost.hidden = true; }
      }
      function tearBoard() { try { if (board) board.destroy(); } catch { /* ignore */ } board = null; }

      summary();
    }

    run().catch((e) => { fail(e); host.replaceChildren(h('p.muted', t('e_server'))); });
    return [
      h('div.top.inbox-head',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); tearDown(); close(); },
        }, icon('back', 22)),
        h('h1', t('analyze_title')),
        h('span.inbox-head-spacer', { 'aria-hidden': 'true' })),
      host,
    ];
  }, { onClose: () => { /* board torn down in back */ } });
}
