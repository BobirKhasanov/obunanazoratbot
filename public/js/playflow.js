// Play hub → time/color setup → searching, matching UzChess-style steps with our UI.
import { h, icon, haptic, api, fail, onWs } from './ui.js';
import { t } from './i18n.js';
import { openScreen, closeScreen } from './screen.js';
import { PRESETS, normalizeTimeControl } from './time.js';

const TIME_GROUPS = [
  { key: 'bullet', icon: '🚀', chips: ['1+0', '1+1', '2+1'] },
  { key: 'blitz', icon: '⚡', chips: ['3+0', '3+2', '5+0'] },
  { key: 'rapid', icon: '⏱', chips: ['10+0', '15+10', '30+0'] },
];

/** Short label for the hub time row (e.g. "1 min", "3 | 2"). */
export function timeLabel(id) {
  const p = PRESETS[id];
  if (!p || !p.baseMs) return t('any_time');
  const mins = Math.round(p.baseMs / 60_000);
  const inc = Math.round((p.incMs || 0) / 1000);
  if (!inc) return t('time_min', { n: mins });
  return `${mins} | ${inc}`;
}

function chipLabel(id) {
  const p = PRESETS[id];
  if (!p) return id;
  const mins = Math.round(p.baseMs / 60_000);
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
            onclick: () => { haptic('light'); close(); deps.startFriendGame(); },
          }, h('span.art', '🤝'), t('play_card_friend')),
          h('button.pf-menu-row', {
            type: 'button',
            onclick: () => { haptic('light'); close(); setTimeout(() => deps.aiSheet(), 180); },
          }, h('span.art', '🤖'), t('play_card_ai')),
          h('button.pf-menu-row', {
            type: 'button',
            onclick: () => { haptic('light'); close(); deps.goTab('live'); },
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
          h('div.pf-sec',
            h('div.pf-sec-h', t('game_variant')),
            h('div.pf-variants',
              h('button.pf-chip.on', { type: 'button' }, t('variant_standard')),
              h('button.pf-chip', {
                type: 'button',
                onclick: () => haptic('light'),
              }, t('variant_960')))),
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

  function openSearching(game) {
    let alive = true;
    let unsub = () => {};
    let poll = null;
    let cancelled = false;

    const stop = () => {
      alive = false;
      if (poll) { clearInterval(poll); poll = null; }
      try { unsub(); } catch { /* ignore */ }
    };

    const cancelGame = async () => {
      if (cancelled) return;
      cancelled = true;
      stop();
      try { await api('DELETE', `/games/${game.id}`); } catch { /* ignore */ }
    };

    openScreen((close) => {
      const stats = h('div.pf-stats');
      let entering = false;
      const enterGame = async (g) => {
        if (!alive || entering || !g || g.id !== game.id || g.status !== 'active') return;
        entering = true;
        stop();
        cancelled = true;
        let full = g;
        try {
          const r = await api('GET', `/games/${game.id}`);
          if (r.game) full = r.game;
        } catch { /* use snapshot */ }
        close(true);
        deps.openOnline(full);
      };

      const matched = (g) => {
        if (!alive || !g || g.id !== game.id) return;
        if (g.status === 'active') enterGame(g);
        else if (g.status === 'cancelled' || g.status === 'finished') {
          stop();
          cancelled = true;
          close(true);
        }
      };

      const refreshStats = async () => {
        try {
          const l = await api('GET', '/lobby');
          if (!alive) return;
          stats.replaceChildren(
            h('div', '👥 ' + t('live_players', { n: l.onlineCount || 0 })),
            h('div', '🎮 ' + t('live_games_n', { n: (l.games?.active || []).length })),
          );
          try {
            const r = await api('GET', `/games/${game.id}`);
            matched(r.game);
          } catch { /* gone */ }
        } catch { /* ignore */ }
      };
      refreshStats();
      poll = setInterval(refreshStats, 2500);

      unsub = onWs((m) => {
        if (m.t === 'game' && m.game) matched(m.game);
      });

      return [
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
      onClose: () => { cancelGame(); },
    });
  }

  return {
    open: () => { haptic('medium'); openHub(); },
    openTimeSetup: () => { syncFromHome(); openTimeSetup(); },
  };
}
