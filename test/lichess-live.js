// Live broadcast: id validation, round fetch, PGN export, clock units.
const assert = require('assert');
const lichess = require('../src/lichess');

/** Mirror of client: broadcast clocks are centiseconds. */
function clockMsFromPlayer(p, thinkingSec = 0) {
  const cs = Number(p && p.clock);
  if (!Number.isFinite(cs)) return null;
  return Math.max(0, cs * 10 - (Number(thinkingSec) || 0) * 1000);
}

function fmtClockMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function main() {
  assert.strictEqual(fmtClockMs(clockMsFromPlayer({ clock: 378200 })), '1:03:02');

  let threw = false;
  try { lichess.lichessId('round-11'); } catch (e) { threw = e.status === 400; }
  assert.ok(threw, 'non-8-char id rejected');

  threw = false;
  try { await lichess.broadcastRound('eGDNBzOF'); } // tour id ≠ round id
  catch (e) { threw = e.status === 404; }
  assert.ok(threw, 'tour id as round id → 404');

  const top = await lichess.topBroadcasts();
  assert.ok((top.active || []).length > 0, 'expected active broadcasts');

  let ok = 0;
  for (const item of top.active.slice(0, 8)) {
    const id = item.round.id;
    const withSlugs = await lichess.broadcastRound(id, {
      fresh: true,
      roundUrl: item.round.url,
      tourSlug: item.tour.slug,
      roundSlug: item.round.slug,
    });
    assert.ok(withSlugs.round && withSlugs.round.id === id, `slug path round ${id}`);
    const plain = await lichess.broadcastRound(id, { fresh: true });
    assert.ok(plain.round && plain.round.id === id, `/-/-/ path round ${id}`);
    ok++;
  }

  const sample = top.active[0];
  const roundId = sample.round.id;
  const round = await lichess.broadcastRound(roundId, { fresh: true, roundUrl: sample.round.url });
  assert.ok(Array.isArray(round.games), 'games array');

  const pgn = await lichess.broadcastRoundPgn(roundId, { fresh: true });
  assert.ok((pgn.games || []).length > 0, 'pgn export has games');
  assert.ok(pgn.games[0].pgn.includes('[Event'), 'pgn body');

  if (round.games[0] && round.games[0].players && round.games[0].players[0].clock > 100_000) {
    const mins = clockMsFromPlayer(round.games[0].players[0]) / 60_000;
    assert.ok(mins > 15, `classical-scale clock, got ${mins.toFixed(1)}m`);
  }

  console.log(`ok  lichess-live (${ok} rounds, pgn ${pgn.games.length}, games ${round.games.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
