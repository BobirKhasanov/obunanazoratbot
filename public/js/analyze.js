// Post-game analysis (Chess.com-style classifications) using the local engine.
import { Chess } from '/vendor/chess.js';
import { h, icon, haptic, toast, api, fail, sleep } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';
import { isLite } from './perf.js';

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

function classify(playedUci, bestUci) {
  if (!playedUci || !bestUci) return 'ok';
  if (playedUci === bestUci) return 'best';
  // Same from-square often = ok/inaccuracy; different = miss/blunder heuristic
  if (playedUci.slice(0, 2) === bestUci.slice(0, 2)) return 'ok';
  if (playedUci[0] === bestUci[0]) return 'miss';
  return 'blunder';
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
    const run = async () => {
      const moves = payload.moves || [];
      const lite = isLite();
      const step = lite ? 2 : 1; // Android lite: sample every other ply
      const timeMs = lite ? 180 : 350;
      const rows = [];
      const chess = new Chess();
      let analyzed = 0;
      for (let i = 0; i < moves.length; i++) {
        const [from, to, promotion] = moves[i];
        const fenBefore = chess.fen();
        const turn = chess.turn();
        let best = null;
        if (i % step === 0) {
          try { best = await bestMove(fenBefore, timeMs); } catch { best = null; }
          analyzed++;
        }
        let played;
        try { played = chess.move({ from, to, promotion }); } catch { break; }
        const playedUci = `${from}${to}${promotion || ''}`;
        const bestUci = uciOf(best);
        const tag = bestUci ? classify(playedUci, bestUci) : 'ok';
        const plyLabel = turn === 'w' ? `${Math.floor(i / 2) + 1}.` : `${Math.floor(i / 2) + 1}…`;
        rows.push(h('div.analyze-row',
          h('span.tag.' + tag, t('analyze_' + tag)),
          h('b', plyLabel + ' ' + (played.san || playedUci)),
          bestUci && bestUci !== playedUci ? h('span.muted', t('analyze_best_line', { m: bestUci })) : null,
        ));
        if (analyzed % 3 === 0) {
          host.replaceChildren(
            h('p.muted', t('analyze_progress', { n: String(i + 1), total: String(moves.length) })),
            ...rows,
          );
          await sleep(0);
        }
      }
      const wName = (payload.white && payload.white.name) || t('white');
      const bName = (payload.black && payload.black.name) || t('black');
      const res = payload.result || '½-½';
      let winnerLine = t('draw_title');
      if (res === '1-0') winnerLine = t('analyze_winner', { name: wName });
      else if (res === '0-1') winnerLine = t('analyze_winner', { name: bName });
      host.replaceChildren(
        h('div.card', h('b', winnerLine), h('p.muted', t('result_label', { r: res }))),
        h('div.h2', t('analyze_moves')),
        rows.length ? h('div.list', ...rows) : h('p.muted', t('analyze_empty')),
      );
      haptic('success');
    };
    run().catch((e) => { fail(e); host.replaceChildren(h('p.muted', t('e_server'))); });
    return [
      h('div.top.inbox-head',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 22)),
        h('h1', t('analyze_title')),
        h('span.inbox-head-spacer', { 'aria-hidden': 'true' })),
      host,
    ];
  });
}
