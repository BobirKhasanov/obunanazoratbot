// Play hub → time/color setup → searching, matching UzChess-style steps with our UI.
import { h, icon, haptic, api, fail, onWs } from './ui.js';
import { t } from './i18n.js';
import { openScreen, closeScreen } from './screen.js';
import { PRESETS, normalizeTimeControl } from './time.js';
import { softPollMs } from './perf.js';
import { openGameId } from './game.js';

const TIME_GROUPS = [
  { key: 'bullet', icon: '🚀', chips: ['1+0', '1+1', '2+1'] },
  { key: 'blitz', icon: '⚡', chips: ['3+0', '3+2', '5+0'] },
  { key: 'rapid', icon: '⏱', chips: ['10+0', '15+10', '30+0'] },
];

/** Short label for the hub time row (e.g. "1 min", "3 | 2"). */
export function timeLabel(id) {
  const p = PRESETS[id];
  if (!p || !p.baseMs) return t('any_time');
  const mins = Math.round(p.baseMs / 60000);
  const inc = Math.round((p.incMs || 0) / 1000);
  if (!inc) return t('time_min', { n: mins });
  return `${mins} | ${inc}`;
}

function chipLabel(id) {
  const p = PRESETS[id];
  if (!p) return id;
  const mins = Math.round(p.baseMs / 60000);
  const inc = Math.round((p.incMs || 0) / 1000);
  if (!inc) return t('time_daq', { n: mins });
  return `${mins} | ${inc}`;
}

/**
 * @param {object} deps
 * @param {() => object} deps.getState
 * @param {(g: object) => void} deps.openOnline
 * @param {() => void} deps.startFriendGame
 * @param {() => void} deps.aiSheet
 * @param {(tab: string) => void} deps.goTab
 * @param {(tc: string) => void} deps.setSelectedTime
 * @param {() => string} deps.getSelectedTime
 */
export function createPlayFlow(deps) {
  let flowTime = '1+0';
  let flowColour = 'r'; // w | b | r
  let matching = false;

  function syncFromHome() {
    const sel = deps.getSelectedTime();
    if (sel && sel !== 'any' && PRESETS[sel]) flowTime = sel;
    else if (!PRESETS[flowTime]) flowTime = '1+0';
  }

  function openHub() {
    syncFromHome();
    openScreen((close) => [
      h('div.top',
        h('button.round.back', {
          type: 'button',
          'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 22)),
        h('h1', t('nav_game'))),
      h('div.pf-hub',
        h('div.pf-hero', '⚔️'),
        h('h1.pf-title', t('nav_game')),
        h('div.pf-stack',
          h('button.pf-time-row', {
            type: 'button',
            onclick: () => { haptic('light'); openTimeSetup(); },
          }, h('span', timeLabel(flowTime)), icon('chevron', 18)),
          h('button.cta', {
            type: 'button',
            onclick: () => { haptic('medium'); startMatch(); },
          }, t('play_btn')),
          h('button.pf-menu-row', {
            type: 'button',
            onclick: () => {
              haptic('light');
              deps.setSelectedTime(flowTime);
              const preferredColor = flowColour === 'w' || flowColour === 'b' ? flowColour : null;
              close();
              deps.startFriendGame({ timeControl: normalizeTimeControl(flowTime), preferredColor });
            },
          }, h('span.art', '🤝'), t('play_card_friend')),
          h('button.pf-menu-row', {
            type: 'button',
            onclick: () => { haptic('light'); close(); setTimeout(() => deps.aiSheet(), 180); },
          }, h('span.art', '🤖'), t('play_card_ai')),
          h('button.pf-menu-row', {
            type: 'button',
            onclick: () => {
              haptic('light');
              close();
              try { deps.openLiveTournaments && deps.openLiveTournaments(); }
              catch { deps.goTab('live'); }
            },
          }, h('span.art', '🏆'), t('tournaments_menu')),
        )),
    ]);
  }

  function openTimeSetup() {
    openScreen((close) => {
      const root = h('div.pf-setup');
      const draw = () => {
        root.replaceChildren(
          h('div.top',
            h('button.round.back', {
              type: 'button',
              'aria-label': t('back'),
              onclick: () => { haptic('light'); close(); },
            }, icon('back', 22)),
            h('h1', '⏱ ' + t('choose_time_title'))),
          ...TIME_GROUPS.map((g) => h('div.pf-sec',
            h('div.pf-sec-h', h('span', g.icon), t('tc_' + g.key)),
            h('div.pf-chips', g.chips.map((id) => h('button.pf-chip' + (flowTime === id ? '.on' : ''), {
              type: 'button',
              onclick: () => { flowTime = id; deps.setSelectedTime(id); haptic('select'); draw(); },
            }, chipLabel(id)))))),
          h('div.pf-sec',
            h('div.pf-sec-h', t('pick_color')),
            h('div.pf-colors',
              [['r', '♟️', t('random')], ['w', '♙', t('white')], ['b', '♟', t('black')]].map(([id, art, label]) =>
                h('button.pf-color' + (flowColour === id ? '.on' : ''), {
                  type: 'button',
                  onclick: () => { flowColour = id; haptic('select'); draw(); },
                }, h('span.pawn', art), label)))),
          h('button.cta', {
            type: 'button',
            onclick: () => { haptic('medium'); startMatch(); },
          }, t('play_btn')),
        );
      };
      draw();
      return [root];
    });
  }

  async function startMatch() {
    if (matching) return;
    matching = true;
    const tc = normalizeTimeControl(flowTime);
    deps.setSelectedTime(flowTime);
    const preferredColor = flowColour === 'w' || flowColour === 'b' ? flowColour : null;
    try {
      const r = await api('POST', '/games/quick', { timeControl: tc, preferredColor });
      const game = r.game;
      closeScreen(true);
      if (game.status === 'active') deps.openOnline(game);
      else openSearching(game);
    } catch (e) { fail(e); }
    finally { matching = false; }
  }

  function openSearching(initialGame) {
    let game = initialGame;
    const searchIds = new Set([initialGame.id]);
    let alive = true;
    let unsub = () => {};
    let poll = null;
    let cancelled = false;

    const stop = () => {
      alive = false;
      if (poll) { clearInterval(poll); poll = null; }
      try { unsub(); } catch { /* ignore */ }
    };

    const onGameActive = (e) => {
      if (e && e.detail && e.detail.status === 'active' && e.detail.id && searchIds.has(e.detail.id)) {
        cancelled = true; // prevent onClose DELETE while global handler opens the board
        stop();
        window.removeEventListener('chess-game-active', onGameActive);
      }
    };
    window.addEventListener('chess-game-active', onGameActive);

    const deleteSearchIds = async (exceptId) => {
      for (const id of [...searchIds]) {
        if (exceptId && id === exceptId) continue;
        try {
          const r = await api('GET', `/games/${id}`);
          if (r.game && r.game.status === 'active') continue;
          await api('DELETE', `/games/${id}`);
        } catch { /* ignore */ }
      }
    };

    const cancelGame = async () => {
      stop(); // always clear poll/WS even if already cancelled
      window.removeEventListener('chess-game-active', onGameActive);
      if (cancelled) return;
      cancelled = true;
      await deleteSearchIds(null);
    };

    openScreen((close) => {
      const stats = h('div.pf-stats');
      let entering = false;
      const enterGame = async (g) => {
        if (!alive || entering || !g || g.status !== 'active') return;
        if (!searchIds.has(g.id) && g.id !== game.id) return;
        entering = true;
        stop();
        cancelled = true;
        window.removeEventListener('chess-game-active', onGameActive);
        await deleteSearchIds(g.id);
        let full = g;
        try {
          const r = await api('GET', `/games/${g.id}`);
          if (r.game) full = r.game;
        } catch { /* use snapshot */ }
        close(true);
        // Global WS handler may already have opened this board
        if (openGameId() === full.id) return;
        deps.openOnline(full);
      };

      const matched = (g) => {
        if (!alive || !g) return;
        if (g.status === 'active' && (g.id === game.id || searchIds.has(g.id))) enterGame(g);
        else if (g.id === game.id && (g.status === 'cancelled' || g.status === 'finished')) {
          stop();
          cancelled = true;
          close(true);
        }
      };

      const refreshStats = async () => {
        try {
          // Re-run quick match: join another searcher or nudge nearby-Elo players
          let eloDelta = null;
          try {
            const q = await api('POST', '/games/quick', {
              timeControl: game.timeControl || flowTime,
              preferredColor: flowColour === 'w' || flowColour === 'b' ? flowColour : null,
            });
            if (!alive) return;
            if (q.eloDelta != null) eloDelta = q.eloDelta;
            if (q.game) {
              if (q.game.id !== game.id) {
                const prevId = game.id;
                searchIds.add(q.game.id);
                game = q.game;
                // Drop superseded waiting search so it cannot match later
                try { await api('DELETE', `/games/${prevId}`); } catch { /* ignore */ }
                searchIds.delete(prevId);
              }
              matched(q.game);
              if (!alive) return;
            }
          } catch { /* keep waiting */ }

          const l = await api('GET', '/lobby');
          if (!alive) return;
          // Only enter an active game that is this search (or replaced by match) — never an unrelated game
          const active = (l.games?.active || []).find((g) => g && searchIds.has(g.id));
          if (active) { matched(active); return; }
          stats.replaceChildren(
            h('div', '👥 ' + t('live_players', { n: l.onlineCount || 0 })),
            h('div', '🎮 ' + t('live_games_n', { n: Number(l.liveGames || 0) })),
            eloDelta != null ? h('div', '🎯 ' + t('search_elo_window', { n: eloDelta })) : null,
          );
        } catch { /* ignore */ }
      };
      refreshStats();
      poll = setInterval(refreshStats, softPollMs());

      unsub = onWs((m) => {
        if (m.t === 'game' && m.game) matched(m.game);
      });

      return [
        h('div.top',
          h('button.round.back', {
            type: 'button',
            'aria-label': t('back'),
            onclick: async () => { haptic('light'); await cancelGame(); close(); },
          }, icon('back', 22)),
          h('h1', t('searching'))),
        h('div.pf-search',
          h('div.pf-search-art', '♟️'),
          h('h2', t('searching')),
          stats,
          h('div.pf-foot',
            h('button.cta', {
              type: 'button',
              onclick: async () => { haptic('light'); await cancelGame(); close(); },
            }, t('go_back')))),
      ];
    }, {
      onClose: () => {
        window.removeEventListener('chess-game-active', onGameActive);
        cancelGame();
      },
    });
  }

  return {
    open: () => { haptic('medium'); openHub(); },
    openTimeSetup: () => { syncFromHome(); openTimeSetup(); },
  };
}
