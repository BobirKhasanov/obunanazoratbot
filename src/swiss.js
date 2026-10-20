// Swiss-system pairing + standings. Pure functions (no DB) so they can be unit-tested.
//
// players: [{ id, rating }]
// games:   [{ round, white, black|null, result }]  result: '1-0' | '0-1' | '1/2-1/2' | '0-0' | 'bye' | null
//
// Rules: win 1, draw 0.5, bye 1, anything else 0. Tie-break: Buchholz (sum of opponents' points),
// then number of wins, then rating.

function scoreOf(result, asWhite) {
  if (result === '1-0') return asWhite ? 1 : 0;
  if (result === '0-1') return asWhite ? 0 : 1;
  if (result === '1/2-1/2') return 0.5;
  if (result === 'bye') return 1;
  return 0;
}

function standings(players, games) {
  const by = new Map(players.map((p) => [p.id, { id: p.id, rating: p.rating || 0, points: 0, wins: 0, played: 0, opponents: [], whites: 0, blacks: 0, colors: [], byes: 0 }]));
  const settled = games.filter((g) => g.result);
  for (const g of settled) {
    const w = by.get(g.white);
    if (!g.black) { // bye
      if (w) { w.points += 1; w.byes += 1; }
      continue;
    }
    const b = by.get(g.black);
    if (w) { w.points += scoreOf(g.result, true); w.played += 1; w.opponents.push(g.black); }
    if (b) { b.points += scoreOf(g.result, false); b.played += 1; b.opponents.push(g.white); }
    if (g.result === '1-0' && w) w.wins += 1;
    if (g.result === '0-1' && b) b.wins += 1;
  }
  // colour history comes from every pairing, played or still running
  for (const g of games.slice().sort((x, y) => x.round - y.round)) {
    if (!g.black) continue;
    const w = by.get(g.white); const b = by.get(g.black);
    if (w) { w.whites += 1; w.colors.push('w'); }
    if (b) { b.blacks += 1; b.colors.push('b'); }
  }
  const rows = [...by.values()];
  for (const r of rows) {
    r.buchholz = r.opponents.reduce((s, id) => s + ((by.get(id) || {}).points || 0), 0);
  }
  rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.wins - a.wins || b.rating - a.rating || a.id - b.id);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Pair the next round. `active` = ids still playing. Returns { pairs: [[whiteId, blackId]], bye: id|null } */
function pairRound(activeIds, players, games, rng = Math.random) {
  const rows = standings(players, games).filter((r) => activeIds.includes(r.id));
  const played = new Set();
  for (const g of games) if (g.black) { played.add(`${g.white}:${g.black}`); played.add(`${g.black}:${g.white}`); }
  const hadBye = new Set(games.filter((g) => !g.black).map((g) => g.white));

  let list = rows.slice();
  let bye = null;
  if (list.length % 2 === 1) {
    // Lowest-ranked player who has not had a bye yet gets it
    const cand = [...list].reverse().find((r) => !hadBye.has(r.id)) || list[list.length - 1];
    bye = cand.id;
    list = list.filter((r) => r.id !== bye);
  }

  const solve = (items, allowRematch, budget) => {
    if (!items.length) return [];
    if (budget.n-- <= 0) return null;
    const p = items[0];
    for (let i = 1; i < items.length; i += 1) {
      const q = items[i];
      if (!allowRematch && played.has(`${p.id}:${q.id}`)) continue;
      const rest = items.filter((_, k) => k !== 0 && k !== i);
      const tail = solve(rest, allowRematch, budget);
      if (tail) return [[p, q], ...tail];
    }
    return null;
  };

  let pairs = solve(list, false, { n: 20000 });
  if (!pairs) pairs = solve(list, true, { n: 20000 });
  if (!pairs) { // last resort: pair neighbours
    pairs = [];
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  }

  const out = pairs.map(([a, b]) => {
    // Colours: the player who has had fewer whites gets white; avoid 3 in a row; else the higher seed alternates
    const need = (r) => (r.whites - r.blacks); // >0 means too many whites
    const streak = (r) => {
      const c = r.colors; const last = c[c.length - 1];
      if (c.length >= 2 && c[c.length - 2] === last) return last; // already 2 in a row
      return null;
    };
    const sa = streak(a); const sb = streak(b);
    let aWhite;
    if (sa === 'w' && sb !== 'w') aWhite = false;
    else if (sa === 'b' && sb !== 'b') aWhite = true;
    else if (sb === 'w' && sa !== 'w') aWhite = true;
    else if (sb === 'b' && sa !== 'b') aWhite = false;
    else if (need(a) !== need(b)) aWhite = need(a) < need(b);
    else {
      const la = a.colors[a.colors.length - 1]; const lb = b.colors[b.colors.length - 1];
      if (la && lb && la !== lb) aWhite = la === 'b';
      else if (la && !lb) aWhite = la === 'b';
      else if (!la && lb) aWhite = lb === 'w';
      else aWhite = rng() < 0.5;
    }
    return aWhite ? [a.id, b.id] : [b.id, a.id];
  });
  return { pairs: out, bye };
}

/** Sensible default number of rounds for n players (3..9, never more than n-1). */
function defaultRounds(n) {
  if (n < 2) return 0;
  return Math.max(1, Math.min(9, Math.max(3, Math.ceil(Math.log2(n))), n - 1));
}

module.exports = { standings, pairRound, defaultRounds, scoreOf };
