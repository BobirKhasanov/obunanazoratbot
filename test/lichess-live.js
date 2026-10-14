// Live broadcast clock + fresh round poll sanity checks against Lichess.
const assert = require('assert');
const lichess = require('../src/lichess');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // Unit: classical remaining ~1h must not look like ~6 minutes
  assert.strictEqual(fmtClockMs(clockMsFromPlayer({ clock: 378200 })), '1:03:02');
  assert.strictEqual(fmtClockMs(clockMsFromPlayer({ clock: 378200 }, 122)), '1:01:00');

  const top = await lichess.topBroadcasts();
  assert.ok((top.active || []).length > 0, 'expected active broadcasts');
  const roundId = top.active[0].round.id;

  const a = await lichess.broadcastRound(roundId, { fresh: true });
  assert.ok((a.games || []).length > 0, 'round has games');
  const g0 = a.games[0];
  assert.ok(g0.fen, 'game has fen');
  assert.ok(g0.players && g0.players[0].clock != null, 'game has clock');

  const shown = fmtClockMs(clockMsFromPlayer(g0.players[0], g0.thinkTime));
  assert.ok(/^\d+:\d{2}/.test(shown), `clock formats: ${shown}`);
  // Must not be the old bug (treating cs as ms → ~6 min for classical)
  if (g0.players[0].clock > 100_000) {
    const mins = clockMsFromPlayer(g0.players[0]) / 60_000;
    assert.ok(mins > 15, `clock should be classical-scale minutes, got ${mins.toFixed(1)}m raw=${g0.players[0].clock}`);
  }

  await sleep(200);
  const b = await lichess.broadcastRound(roundId, { fresh: true });
  assert.ok(b.games.length >= a.games.length, 'fresh poll returns games');

  const pgn = await lichess.broadcastRoundPgn(roundId, { fresh: true });
  assert.ok((pgn.games || []).length > 0, 'pgn dump has games');
  const one = pgn.games.find((x) => x.id === g0.id) || pgn.games[0];
  assert.ok(one.pgn && one.pgn.includes('[Event'), 'pgn body present');

  console.log(`ok  lichess-live (${a.games.length} games, clock ${shown}, pgn ${pgn.games.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
