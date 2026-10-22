// Swiss tournaments (Turnirlar page): list section, create sheet and detail screen.
import { h, icon, haptic, api, fail, toast, sheet, confirmSheet, avBlock } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';
import { formatTashkentShort } from './time.js';
import { openGame, } from './game.js';
import { spectateGame } from './live.js';
import { sectionHead, emptyNote } from './neonui.js';

const fmtWhen = (iso) => formatTashkentShort(iso);
const untilLabel = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('swiss_starting');
  const m = Math.ceil(ms / 60000);
  return m >= 90 ? fmtWhen(iso) : t('swiss_in_min', { n: m });
};
const statusLabel = (x) => {
  if (x.status === 'registration') return t('swiss_st_reg');
  if (x.status === 'running') return t('swiss_round_of', { n: Math.max(1, x.round), m: x.rounds });
  if (x.status === 'finished') return t('swiss_st_done');
  return t('swiss_st_cancel');
};
const prizeLine = (x) => (x.prizes && x.prizes.some((v) => v > 0) ? `🥇 ${x.prizes[0]} · 🥈 ${x.prizes[1]} · 🥉 ${x.prizes[2]} 💎` : '');
const POINT = (p) => (Number.isInteger(p) ? String(p) : p.toFixed(1));

export function swissCard(x, onOpen) {
  const live = x.status === 'running';
  return h('button.sw-card' + (live ? '.live' : ''), { type: 'button', 'data-noswipe': '', onclick: () => { haptic('light'); onOpen(x); } },
    h('div.sw-card-t', h('b', x.name), x.joined ? h('span.sw-me', t('swiss_joined')) : null),
    h('div.sw-card-s',
      h('span', `${x.timeControl}`),
      h('span', t('swiss_rounds_n', { n: x.rounds })),
      h('span', icon('users', 13), ` ${x.players}/${x.maxPlayers}`)),
    prizeLine(x) ? h('div.sw-prize', prizeLine(x)) : null,
    h('div.sw-card-f', h('span.sw-st' + (live ? '.on' : ''), statusLabel(x)),
      x.status === 'registration' ? h('span.sw-when', untilLabel(x.startsAt)) : null));
}

/** The section shown on the Turnirlar page. */
export function swissSection(data, { onRefresh, meta, onClose }) {
  const list = (data && data.tournaments) || [];
  const open = (x) => openSwiss(x.id, { onRefresh, meta, onClose });
  const create = () => {
    if (!data.canCreate) {
      toast(t('swiss_premium_only'), true);
      document.dispatchEvent(new CustomEvent('open-premium'));
      return;
    }
    openCreate({ ...(data.options || {}), rules: data.rules }, (tr) => { onRefresh(); open(tr); });
  };
  return [
    sectionHead(t('swiss_title'), create, t('swiss_create')),
    list.length
      ? h('div.sw-list', ...list.map((x) => swissCard(x, open)))
      : emptyNote(data && data.canCreate ? t('swiss_empty_can') : t('swiss_empty')),
  ];
}

function openCreate(options, onDone) {
  const tcs = options.timeControls || ['3+0', '5+0', '10+0'];
  const starts = options.startMinutes || [5, 15, 30, 60];
  const state = { tc: tcs.includes('5+0') ? '5+0' : tcs[0], rounds: 5, max: 16, mins: 15 };
  const name = h('input.input', { maxlength: 40, placeholder: t('swiss_name_ph') });
  const chips = (vals, key, label) => {
    const row = h('div.sw-chips');
    const paint = () => [...row.children].forEach((b, i) => b.classList.toggle('on', vals[i] === state[key]));
    vals.forEach((v) => row.append(h('button.sw-chip', { type: 'button', onclick: () => { state[key] = v; haptic('select'); paint(); } }, label(v))));
    paint();
    return row;
  };
  const minLabel = (m) => (m >= 1440 ? t('swiss_in_day') : m >= 60 ? t('swiss_in_hour', { n: m / 60 }) : t('swiss_in_min', { n: m }));
  sheet((close) => [
    h('h2', t('swiss_create')),
    h('div.label', t('swiss_name')), name,
    h('div.label', t('swiss_tc')), chips(tcs, 'tc', (v) => v),
    h('div.label', t('swiss_rounds')), chips([3, 4, 5, 6, 7], 'rounds', (v) => String(v)),
    h('div.label', t('swiss_max')), chips([8, 16, 32, 64], 'max', (v) => String(v)),
    h('div.label', t('swiss_starts')), chips(starts, 'mins', minLabel),
    h('p.muted', t('swiss_rules', { n: options.minPlayers || 4 })),
    options.rules ? h('p.muted', t('swiss_org_reward', { n: options.rules.organizer }) + (options.rules.organizerBig !== options.rules.organizer ? ` · >${options.rules.bigThreshold}: +${options.rules.organizerBig} 💎` : '')) : null,
    options.rules ? h('p.muted', t('swiss_limits', { w: options.rules.weeklyLimit, d: options.rules.dailyJoinLimit })) : null,
    h('button.cta', {
      type: 'button',
      onclick: async () => {
        const nm = name.value.trim();
        if (nm.length < 3) return toast(t('swiss_name_short'), true);
        try {
          const r = await api('POST', '/tournaments', { name: nm, timeControl: state.tc, rounds: state.rounds, maxPlayers: state.max, startsInMin: state.mins });
          haptic('success'); close(); onDone(r.tournament);
        } catch (e) { fail(e); }
      },
    }, t('swiss_create')),
  ]);
}

export function openSwiss(id, { onRefresh, meta, onClose } = {}) {
  openScreen((close) => {
    const box = h('div.sw-box', h('div.nx-empty', '…'));
    let timer = null;
    let lastRound = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const back = () => { stop(); haptic('light'); close(); onRefresh && onRefresh(); };

    const playMine = async (gid) => {
      try {
        const r = await api('GET', `/games/${gid}`);
        openGame({ kind: 'online', game: r.game, meta }, () => { onRefresh && onRefresh(); });
      } catch (e) { fail(e); }
    };
    const act = (path, confirm) => async () => {
      if (confirm && !(await confirmSheet(confirm.title, confirm.ok, true))) return;
      try { await api('POST', `/tournaments/${id}/${path}`); haptic('success'); await load(); if (path === 'cancel') back(); } catch (e) { fail(e); }
    };

    const draw = (d) => {
      const x = d.tournament;
      lastRound = x.round;
      const mine = d.standing.find((s) => s.id === (meta && meta.me && meta.me.id));
      const buttons = [];
      if (x.status === 'registration') {
        if (x.joined) {
          if (!x.mine) buttons.push(h('button.btn.ghost', { type: 'button', onclick: act('leave') }, t('swiss_leave')));
        } else buttons.push(h('button.cta', { type: 'button', onclick: act('join') }, t('swiss_join')));
        if (x.mine || (meta && meta.me && meta.me.isAdmin)) {
          buttons.push(h('button.btn', { type: 'button', disabled: d.standing.length < 4, onclick: act('start') }, d.standing.length < 4 ? t('swiss_need_min', { n: 4 }) : t('swiss_start_now')));
          buttons.push(h('button.btn.danger', { type: 'button', onclick: act('cancel', { title: t('swiss_cancel_q'), ok: t('swiss_cancel') }) }, t('swiss_cancel')));
        }
      } else if (x.status === 'running') {
        if (d.myGameId) buttons.push(h('button.cta', { type: 'button', onclick: () => playMine(d.myGameId) }, icon('gamepad', 18), t('swiss_play_now')));
        else if (x.joined && x.roundState === 'break') buttons.push(h('div.sw-note', t('swiss_next_round')));
        if (x.joined) buttons.push(h('button.btn.ghost', { type: 'button', onclick: act('leave', { title: t('swiss_leave_q'), ok: t('swiss_leave') }) }, t('swiss_leave')));
        if (meta && meta.me && meta.me.isAdmin) buttons.push(h('button.btn.danger', { type: 'button', onclick: act('cancel', { title: t('swiss_cancel_q'), ok: t('swiss_cancel') }) }, t('swiss_cancel')));
      }
      const standRow = (s) => h('div.sw-row' + (s.withdrawn ? '.out' : ''),
        h('span.sw-rk', String(s.rank)),
        avBlock(s.name, s.id, { premium: !!s.premium, round: true, avatarKey: s.avatarKey || null }),
        h('span.sw-nm', s.name),
        h('span.sw-pt', POINT(s.points)));
      const resLabel = (p) => {
        if (!p.black) return t('swiss_bye');
        if (p.result === '1-0') return '1 – 0';
        if (p.result === '0-1') return '0 – 1';
        if (p.result === '1/2-1/2') return '½ – ½';
        if (p.result === '0-0') return '0 – 0';
        return p.live && p.live.status === 'active' ? t('swiss_live') : '…';
      };
      const pairRow = (p) => {
        const row = h('div.sw-pair',
          h('span.sw-pn', p.white.name),
          h('span.sw-res', resLabel(p)),
          h('span.sw-pn.r', p.black ? p.black.name : '—'));
        if (p.gameId && p.live && p.live.status === 'active') {
          row.classList.add('tap');
          row.addEventListener('click', () => {
            api('GET', `/games/${p.gameId}`).then((r) => spectateGame(r.game, meta, onClose)).catch(fail);
          });
        }
        return row;
      };
      box.replaceChildren(
        h('div.sw-head',
          h('h2', x.name),
          h('div.sw-meta', h('span', x.timeControl), h('span', t('swiss_rounds_n', { n: x.rounds })), h('span', icon('users', 13), ` ${x.players}/${x.maxPlayers}`), h('span.sw-st' + (x.status === 'running' ? '.on' : ''), statusLabel(x))),
          prizeLine(x) ? h('div.sw-prize', t('swiss_prizes') + ': ' + prizeLine(x)) : null,
          x.organizerReward ? h('p.muted', t('swiss_org_reward', { n: x.organizerReward })) : null,
          x.status === 'registration' ? h('p.muted', t('swiss_starts_at', { w: untilLabel(x.startsAt) })) : null,
          x.status === 'finished' && d.standing[0] ? h('div.sw-winner', '🏆 ', d.standing[0].name) : null,
          x.status === 'cancelled' ? h('p.muted', t('swiss_st_cancel')) : null),
        h('div.sw-actions', ...buttons),
        d.pairings.length ? h('div.h2', t('swiss_pairings') + (x.round ? ` · ${t('swiss_round_of', { n: x.round, m: x.rounds })}` : '')) : null,
        d.pairings.length ? h('div.sw-pairs', ...d.pairings.map(pairRow)) : null,
        h('div.h2', t('swiss_standings')),
        d.standing.length ? h('div.sw-table', ...d.standing.map(standRow)) : emptyNote(t('swiss_no_players')),
        d.standing.length && x.status !== 'registration' ? h('p.muted.sw-tb', t('swiss_tb_note')) : null,
        mine && x.status === 'finished' ? h('p.muted', t('swiss_your_place', { n: mine.rank })) : null);
    };

    const load = async () => {
      try { draw(await api('GET', `/tournaments/${id}`)); } catch (e) { if (e.code !== 'net') fail(e); }
    };
    load();
    timer = setInterval(() => { if (!box.isConnected) return stop(); load(); }, 5000);
    return [h('div.top', h('button.round.back', { type: 'button', 'aria-label': t('back'), onclick: back }, icon('back', 22)), h('h1', t('swiss_title'))), box];
  });
}

/** Rules booklet (opened from the book button in the Turnirlar header). */
export function openRules(rules) {
  const r = rules || { prize1: 20, prize2: 15, prize3: 10, organizer: 10, organizerBig: 15, bigThreshold: 16, weeklyLimit: 1, dailyJoinLimit: 1 };
  const p = { min: 4, max: 64, d: r.dailyJoinLimit, p1: r.prize1, p2: r.prize2, p3: r.prize3, w: r.weeklyLimit, o: r.organizer, ob: r.organizerBig, big: r.bigThreshold };
  const parts = [
    ['info', 'what'], ['users', 'join'], ['history', 'rounds'], ['rankings', 'score'], ['gamepad', 'game'],
    ['clock', 'active'], ['trophy', 'prizes'], ['plus', 'org'], ['check', 'fair'],
  ];
  openScreen((close) => [
    h('div.top', h('button.round.back', { type: 'button', 'aria-label': t('back'), onclick: () => { haptic('light'); close(); } }, icon('back', 22)), h('h1', t('tr_title'))),
    h('div.tr-book',
      h('p.muted.tr-sub', t('tr_sub')),
      ...parts.map(([ic, k], i) => h('section.tr-sec',
        h('div.tr-ic', icon(ic, 20)),
        h('div.tr-tx', h('h3', `${i + 1}. ${t('tr_h_' + k)}`), h('p', t('tr_' + k, p)))))),
  ]);
}
