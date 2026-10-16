// Post-game analysis — Chess.com-style accuracy + move classifications (local engine).
import { Chess } from '/vendor/chess.js';
import { h, icon, haptic, api, fail, sleep } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';
import { isLite } from './perf.js';
import { Board } from './board.js';

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
async function bestMove(fen, timeMs) {
  startWorker();
  if (worker) {
    const id = ++reqId;
    const r = await new Promise((res) => {
      pending.set(id, res);
      worker.postMessage({ id, fen, level: 4, seen: [], timeMs });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(undefined); } }, timeMs + 400);
    });
    if (r) return r;
  }
  if (!mainEngine) { const m = await import('./ai.mjs'); mainEngine = m.makeEngine(Chess); }
  await sleep(10);
  return mainEngine.bestMove(fen, 4, { seen: [], timeMs });
}

function uciOf(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return `${m.from}${m.to}${m.promotion || ''}`;
}

/** Chess.com-ish buckets from played vs engine best (heuristic without centipawns). */
function classify(playedUci, bestUci) {
  if (!playedUci || !bestUci) return 'good';
  if (playedUci === bestUci) return 'best';
  const pf = playedUci.slice(0, 2);
  const pt = playedUci.slice(2, 4);
  const bf = bestUci.slice(0, 2);
  const bt = bestUci.slice(2, 4);
  if (pf === bf && pt === bt) return 'best';
  if (pf === bf) return 'excellent';
  if (pt === bt) return 'good';
  if (pf[0] === bf[0] || pf[1] === bf[1]) return 'inaccuracy';
  if (playedUci[0] === bestUci[0]) return 'mistake';
  return 'blunder';
}

const TAG_SCORE = {
  best: 100, excellent: 90, good: 75, inaccuracy: 45, mistake: 25, blunder: 5, miss: 20,
};

function accuracyOf(tags) {
  if (!tags.length) return 100;
  const sum = tags.reduce((a, t) => a + (TAG_SCORE[t] ?? 70), 0);
  return Math.round(sum / tags.length);
}

function countTags(rows, colour) {
  const out = {};
  for (const r of rows) {
    if (r.colour !== colour) continue;
    out[r.tag] = (out[r.tag] || 0) + 1;
  }
  return out;
}

/**
 * Open analysis for a finished game. Claims a daily slot on the server first.
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
    } catch (e) {
      fail(e);
      return;
    }
  }
  if (!localOnly) {
    try {
      await api('POST', `/games/${payload.id}/analyze`);
    } catch (e) {
      fail(e);
      return;
    }
  }

  openScreen((close) => {
    const host = h('div.analyze-screen', h('p.muted', t('analyze_loading')));
    let board = null;
    const tearDown = () => {
      try { if (board) board.destroy(); } catch { /* ignore */ }
      board = null;
    };

    const run = async () => {
      const moves = payload.moves || [];
      const lite = isLite();
      const step = lite ? 2 : 1;
      const timeMs = lite ? 160 : 320;
      const analyzed = [];
      const chess = new Chess();
      let n = 0;
      for (let i = 0; i < moves.length; i++) {
        const [from, to, promotion] = moves[i];
        const fenBefore = chess.fen();
        const turn = chess.turn();
        let best = null;
        if (i % step === 0) {
          try { best = await bestMove(fenBefore, timeMs); } catch { best = null; }
          n++;
        }
        let played;
        try { played = chess.move({ from, to, promotion }); } catch { break; }
        const playedUci = `${from}${to}${promotion || ''}`;
        const bestUci = uciOf(best);
        const tag = bestUci ? classify(playedUci, bestUci) : 'good';
        analyzed.push({
          i,
          colour: turn,
          san: played.san || playedUci,
          tag,
          bestUci,
          playedUci,
          fen: chess.fen(),
          lastMove: { from, to },
        });
        if (n % 3 === 0) {
          host.replaceChildren(
            h('p.muted', t('analyze_progress', { n: String(i + 1), total: String(moves.length) })),
          );
          await sleep(0);
        }
      }

      const wTags = analyzed.filter((x) => x.colour === 'w').map((x) => x.tag);
      const bTags = analyzed.filter((x) => x.colour === 'b').map((x) => x.tag);
      const wAcc = accuracyOf(wTags);
      const bAcc = accuracyOf(bTags);
      const wName = (payload.white && payload.white.name) || t('white');
      const bName = (payload.black && payload.black.name) || t('black');
      const res = payload.result || '½-½';
      let winnerLine = t('draw_title');
      if (res === '1-0') winnerLine = t('analyze_winner', { name: wName });
      else if (res === '0-1') winnerLine = t('analyze_winner', { name: bName });

      const wCounts = countTags(analyzed, 'w');
      const bCounts = countTags(analyzed, 'b');
      const legendKeys = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

      const boardHost = h('div.analyze-board');
      const moveStrip = h('div.analyze-moves');
      let cursor = analyzed.length;
      const showAt = (idx) => {
        cursor = Math.max(0, Math.min(analyzed.length, idx));
        const c = new Chess();
        let last = null;
        for (let i = 0; i < cursor; i++) {
          const m = moves[i];
          if (!m) break;
          try { c.move({ from: m[0], to: m[1], promotion: m[2] }); last = { from: m[0], to: m[1] }; } catch { break; }
        }
        if (board) board.set(c, { lastMove: last, mine: null, orientation: 'w', animate: !lite });
        [...moveStrip.children].forEach((el, i) => el.classList.toggle('on', i === cursor - 1));
      };

      const paintMoves = () => {
        moveStrip.replaceChildren(...analyzed.map((m, idx) => {
          const ply = Math.floor(idx / 2) + 1;
          const label = m.colour === 'w' ? `${ply}. ${m.san}` : `${ply}… ${m.san}`;
          return h('button.analyze-move.' + m.tag, {
            type: 'button',
            onclick: () => { haptic('select'); showAt(idx + 1); },
          }, h('i.analyze-dot.' + m.tag), h('span', label));
        }));
      };

      const accCard = (name, acc, counts, side) => h('div.analyze-acc.' + side,
        h('div.analyze-acc-top',
          h('b', name),
          h('span.analyze-acc-num', String(acc))),
        h('div.analyze-acc-bar', h('i', { style: { width: `${acc}%` } })),
        h('div.analyze-acc-legend', ...legendKeys.map((k) =>
          h('span.analyze-lg.' + k, t('analyze_' + k), ' ', h('b', String(counts[k] || 0))))));

      tearDown();
      host.replaceChildren(
        h('div.card.analyze-summary',
          h('b', winnerLine),
          h('p.muted', t('result_label', { r: res })),
          h('div.analyze-acc-grid',
            accCard(wName, wAcc, wCounts, 'w'),
            accCard(bName, bAcc, bCounts, 'b'))),
        boardHost,
        h('div.analyze-nav',
          h('button.mini', { type: 'button', onclick: () => showAt(0) }, '⏮'),
          h('button.mini', { type: 'button', onclick: () => showAt(cursor - 1) }, '◀'),
          h('button.mini', { type: 'button', onclick: () => showAt(cursor + 1) }, '▶'),
          h('button.mini', { type: 'button', onclick: () => showAt(analyzed.length) }, '⏭')),
        h('div.h2', t('analyze_moves')),
        analyzed.length ? moveStrip : h('p.muted', t('analyze_empty')),
      );

      try {
        board = new Board(boardHost, {});
        board.orientation = 'w';
      } catch {
        boardHost.hidden = true;
      }
      paintMoves();
      showAt(analyzed.length);
      haptic('success');
    };

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
  }, { onClose: () => { /* board torn in back */ } });
}
