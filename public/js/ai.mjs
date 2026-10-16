// Chess engine for the "play vs computer" mode, built on top of chess.js.
//
// Why this design (so it can be explained later):
//  - chess.js already knows every rule (castling, en passant, promotion, pins), so we do not
//    risk subtle rule bugs by writing our own move generator. We only add the *search*.
//  - Search = negamax with alpha-beta pruning + iterative deepening, which is the classic
//    textbook way to get a decent engine without a huge amount of code.
//  - The evaluation is "material + piece-square tables" and is updated incrementally per
//    move, so a leaf costs O(1) instead of re-scanning the whole board.
//  - Iterative deepening with a time budget keeps the strength adaptive: a fast phone reaches
//    a deeper search than a slow one, but a move never takes longer than the budget.
//  - The Chess constructor is injected (makeEngine(Chess)), so the very same file runs in the
//    browser (web worker) and in Node (tests) without any bundler or import map.
//  - Inside the search we use chess.js's internal generator (_moves/_makeMove/_undoMove). The
//    public moves({verbose:true}) builds the SAN text of every move (with check/mate suffixes),
//    which made the search ~20x slower. chess.js is pinned to an exact version in package.json
//    and the engine refuses to start if those internals ever disappear.

export const LEVELS = [
  { id: 1, depth: 0, qdepth: 0, time: 0, noise: 0 },     // beginner: random, likes captures
  { id: 2, depth: 1, qdepth: 0, time: 300, noise: 70 },  // casual: greedy, sometimes careless
  { id: 3, depth: 3, qdepth: 2, time: 900, noise: 12 },  // club
  { id: 4, depth: 5, qdepth: 4, time: 1800, noise: 0 },  // strong
  { id: 5, depth: 6, qdepth: 5, time: 2600, noise: 0 },  // strongest
];

const MATE = 100000;
const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables ("Simplified Evaluation Function"), white's point of view, index 0 = a8.
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
};
const KING_MG = [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
  20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20];
const KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
  -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
  -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

// chess.js keeps squares as "0x88" numbers: rank 8 is row 0, a8 = 0, h8 = 7, a1 = 112, h1 = 119.
const idx = (sq) => (sq >> 4) * 8 + (sq & 7); // table index, a8 = 0
const mirror = (i) => (7 - (i >> 3)) * 8 + (i & 7);
const ox88 = (name) => (8 - (name.charCodeAt(1) - 48)) * 16 + (name.charCodeAt(0) - 97);
const alg = (sq) => 'abcdefgh'[sq & 15] + (8 - (sq >> 4));
const F_CAPTURE = 2, F_EP = 8, F_PROMO = 16, F_KSIDE = 32, F_QSIDE = 64; // chess.js move flag bits

/** Signed value (white positive) of one piece standing on one square. */
function term(piece, color, sq, endgame) {
  let i = idx(sq);
  if (color === 'b') i = mirror(i);
  const table = piece === 'k' ? (endgame ? KING_EG : KING_MG) : PST[piece];
  const v = PV[piece] + table[i];
  return color === 'w' ? v : -v;
}

/** How much the white-minus-black score changes when (internal) move m is played. */
function delta(m, eg) {
  const c = m.color;
  const o = c === 'w' ? 'b' : 'w';
  let d = -term(m.piece, c, m.from, eg) + term(m.promotion || m.piece, c, m.to, eg);
  if (m.captured) {
    // en passant removes the pawn that stands beside the landing square, not on it
    const capSq = m.flags & F_EP ? (c === 'w' ? m.to + 16 : m.to - 16) : m.to;
    d -= term(m.captured, o, capSq, eg);
  }
  if (m.flags & F_KSIDE) d += -term('r', c, m.to + 1, eg) + term('r', c, m.to - 1, eg);
  else if (m.flags & F_QSIDE) d += -term('r', c, m.to - 2, eg) + term('r', c, m.to + 1, eg);
  return d;
}

/** Cheap move ordering: good captures and promotions first, so alpha-beta prunes more. */
function orderScore(m) {
  let s = 0;
  if (m.captured) s += 10 * PV[m.captured] - PV[m.piece] + 1000;
  if (m.promotion) s += 800 + PV[m.promotion];
  return s;
}
const order = (moves) => moves.sort((a, b) => orderScore(b) - orderScore(a));

const TIMEOUT = Symbol('timeout');
const TIE = 3; // centipawns: moves this close to the best are considered equally good

export function makeEngine(Chess) {
  const probe = new Chess();
  if (typeof probe._moves !== 'function' || typeof probe._makeMove !== 'function' || typeof probe._undoMove !== 'function' || !probe._kings) {
    throw new Error('Unsupported chess.js build: the engine needs chess.js 1.4.0 (see package.json)');
  }

  function boardScore(chess, eg) {
    let s = 0;
    for (const row of chess.board()) for (const p of row) if (p) s += term(p.type, p.color, ox88(p.square), eg);
    return s;
  }

  function isEndgame(chess) {
    let npm = 0;
    for (const row of chess.board()) for (const p of row) if (p && p.type !== 'p' && p.type !== 'k') npm += PV[p.type];
    return npm <= 2600;
  }

  // Looks only at captures until the position is "quiet", so we never stop the search in the
  // middle of an exchange and misjudge it (the "horizon effect").
  function quiesce(chess, alpha, beta, ply, score, ctx, qd) {
    const side = ctx.rootSide * (ply % 2 === 0 ? 1 : -1);
    // "Mop-up": in a lopsided endgame the stronger side is rewarded for walking its king towards
    // the enemy king. Without it the engine can shuffle forever instead of delivering mate.
    let eval_ = score;
    if (ctx.mop) {
      const a = chess._kings.w;
      const b = chess._kings.b;
      eval_ += ctx.mop * 8 * (14 - (Math.abs((a & 15) - (b & 15)) + Math.abs((a >> 4) - (b >> 4))));
    }
    const stand = side * eval_;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return alpha;
    const caps = chess._moves().filter((m) => m.captured || m.promotion);
    order(caps);
    for (const m of caps) {
      chess._makeMove(m);
      const v = -quiesce(chess, -beta, -alpha, ply + 1, score + delta(m, ctx.eg), ctx, qd - 1);
      chess._undoMove();
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function negamax(chess, depth, alpha, beta, ply, score, ctx) {
    if ((++ctx.nodes & 255) === 0 && ctx.deadline && Date.now() > ctx.deadline) throw TIMEOUT;
    const moves = chess._moves();
    if (!moves.length) return chess.isCheck() ? -MATE + ply : 0; // checkmate / stalemate
    if (depth <= 0) return quiesce(chess, alpha, beta, ply, score, ctx, ctx.qdepth);
    order(moves);
    let best = -Infinity;
    for (const m of moves) {
      chess._makeMove(m);
      const v = -negamax(chess, depth - 1, -beta, -alpha, ply + 1, score + delta(m, ctx.eg), ctx);
      chess._undoMove();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

  /**
   * Picks a move for the side to move in `fen`.
   * opts: { timeMs, seen: [positions already played, to avoid shuffling], rng }
   * Returns { from, to, promotion?, depth, score } or null when the game is over.
   */
  function bestMove(fen, level = 3, opts = {}) {
    const cfg = LEVELS.find((l) => l.id === level) || LEVELS[2];
    const rng = opts.rng || Math.random;
    const chess = new Chess(fen);
    const moves = chess._moves();
    if (!moves.length) return null;
    let reached = 0;
    let topScore = 0;
    const out = (m) => ({ from: alg(m.from), to: alg(m.to), promotion: m.promotion, depth: reached, score: topScore });

    if (cfg.depth === 0) {
      // Beginner: weighted random. Captures, promotions and checks look attractive to it.
      const pretty = chess.moves({ verbose: true });
      const w = pretty.map((m) => (m.promotion ? 6 : m.captured ? 4 : m.san.endsWith('+') ? 3 : 1));
      let r = rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pretty.length; i++) {
        r -= w[i];
        if (r <= 0) return { from: pretty[i].from, to: pretty[i].to, promotion: pretty[i].promotion, depth: 0, score: 0 };
      }
      const last = pretty[pretty.length - 1];
      return { from: last.from, to: last.to, promotion: last.promotion, depth: 0, score: 0 };
    }

    const eg = isEndgame(chess);
    const rootScore = boardScore(chess, eg);
    const rootSide = chess.turn() === 'w' ? 1 : -1;
    const mop = eg && Math.abs(rootScore) > 300 ? Math.sign(rootScore) : 0; // which side (if any) is winning
    const seen = new Set((opts.seen || []).map(posKey));
    const budget = opts.timeMs ?? cfg.time;
    const deadline = Date.now() + budget;
    let scored = moves.map((m) => ({ m, v: 0 }));
    scored.sort((a, b) => orderScore(b.m) - orderScore(a.m));

    for (let depth = 1; depth <= cfg.depth; depth++) {
      // Depth 1 always completes, so we always have an answer even on a very slow device.
      const ctx = { nodes: 0, deadline: depth === 1 ? 0 : deadline, eg, rootSide, qdepth: cfg.qdepth, mop };
      try {
        const next = [];
        let best = -Infinity;
        for (const { m } of scored) {
          chess._makeMove(m);
          const key = posKey(chess.fen());
          // Levels with noise need an exact score for every move (full window). The others only
          // need moves within TIE points of the best so far. The window is one point wider than
          // the tie band on purpose: a move that fails low comes back clamped to the window edge,
          // and that clamped value must never look like a tie with the real best move.
          const rootAlpha = cfg.noise || best === -Infinity ? -MATE : best - (TIE + 1);
          let v = -negamax(chess, depth - 1, -MATE, -rootAlpha, 1, rootScore + delta(m, eg), ctx);
          chess._undoMove();
          if (seen.has(key) && Math.abs(v) < MATE / 2) v -= 50; // do not walk in circles
          next.push({ m, v });
          if (v > best) best = v;
        }
        scored = next.sort((a, b) => b.v - a.v);
        reached = depth;
        topScore = best;
        if (best > MATE - 100) break; // forced mate found, no need to look deeper
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break; // keep the result of the last fully completed depth
      }
      if (Date.now() > deadline) break;
    }

    // Pick: add a little noise on weaker levels, otherwise choose randomly among equally good moves.
    let pick;
    if (cfg.noise) {
      let bestN = -Infinity;
      for (const s of scored) {
        const n = s.v + (rng() * 2 - 1) * cfg.noise;
        if (n > bestN) { bestN = n; pick = s; }
      }
    } else {
      const top = scored[0].v;
      const ties = scored.filter((s) => s.v >= top - TIE);
      pick = ties[Math.floor(rng() * ties.length)];
    }
    const result = out(pick.m);
    if (opts.debug) result.all = scored.map((x) => ({ mv: alg(x.m.from) + alg(x.m.to), v: x.v }));
    return result;
  }

  return { bestMove, LEVELS };
}

// Exposed for tests only: lets us verify the incremental evaluation against a full recompute.
export const _internals = { term, delta, ox88 };
