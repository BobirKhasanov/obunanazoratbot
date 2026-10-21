// Shared neon UI kit for Home / O'ynash / Online (iOS + Android Lite safe).
import { h, icon, haptic, avBlock, premIc } from './ui.js';
import { t } from './i18n.js';
import { remainingMs, formatClock } from './time.js';

const tap = (fn) => (e) => {
  if (e) e.stopPropagation();
  haptic('light');
  if (fn) fn(e);
};

export function seeAll(label, onClick) {
  return h('button.nx-seeall', { type: 'button', onclick: tap(onClick) },
    h('span', label || t('see_all')), icon('chevron', 14));
}

/** Section title row: optional status dot, subtitle and "see all" link. */
export function sectionHead(title, onSeeAll, seeLabel, { dot, sub } = {}) {
  return h('div.nx-sec',
    h('div.nx-sec-l',
      h('h2.nx-sec-t', dot ? h('i.nx-dot.' + dot) : null, title),
      sub ? h('small.nx-sec-sub', sub) : null),
    onSeeAll ? seeAll(seeLabel, onSeeAll) : null);
}

/** App header: avatar + name/crown/elo · mail · bell · gems(+). */
export function appHeader({ me, elo, inboxBtns, onProfile, onGems }) {
  const name = me.displayName || me.firstName || 'Player';
  return h('div.nx-hdr',
    h('button.nx-hdr-me', { type: 'button', onclick: tap(onProfile) },
      avBlock(name, me.id, { premium: !!me.premium, round: true, online: true, avatarKey: me.avatarKey }),
      h('div.nx-hdr-meta',
        h('div.nx-hdr-name', h('b', name), me.premium ? premIc(16) : null),
        h('div.nx-hdr-elo', icon('chart', 13), h('span.nx-elo-v', String(elo != null ? elo : (me.elo || 1200)))))),
    h('div.nx-hdr-act',
      inboxBtns || null,
      h('button.nx-gem', { type: 'button', 'data-noswipe': '', 'aria-label': t('diamonds'), onclick: tap(onGems) },
        h('span.nx-gem-ic', '💎'), h('b', String(me.diamonds || 0)), h('span.nx-gem-plus', icon('plus', 12, 2.6)))));
}

/** Page title block (O'ynash / Online). */
export function pageTitle(title, sub, actions) {
  return h('div.nx-title',
    h('div.nx-title-l', h('h1', title), sub ? h('p', sub) : null),
    actions && actions.length ? h('div.nx-title-act', ...actions) : null);
}

export function roundBtn(ic, label, onClick) {
  return h('button.nx-round', { type: 'button', 'aria-label': label, 'data-noswipe': '', onclick: tap(onClick) }, icon(ic, 20));
}

/** Fallback hero when admins have no announcements. */
export function heroBanner() {
  return h('div.nx-hero',
    h('div.nx-hero-art', { style: { backgroundImage: 'url(/img/ui/hero.webp)' } }),
    h('div.nx-hero-txt',
      h('h2', t('hero_t1'), h('br'), h('span', t('hero_t2'))),
      h('p', t('hero_sub'))));
}

/** Tag icon for the home mode-card pill. */
function modeTag(tone) {
  if (tone === 'gold') return icon('friends', 12);
  if (tone === 'violet') return icon('gem', 12);
  return h('i.nx-mode-dot');
}

/**
 * Big mode card with illustration (Home) or compact selectable card (O'ynash).
 * Home cards: tag pill + art + title/sub + Boshlash CTA (screenshot design).
 */
export function modeCard({ title, sub, glyph, tone, selected, onClick }) {
  const tOne = tone || 'blue';
  return h('button.nx-mode.' + tOne + '.compact' + (selected ? '.on' : ''), {
    type: 'button', 'data-noswipe': '', onclick: tap(onClick),
  },
    selected ? h('span.nx-mode-check', icon('check', 12, 3)) : null,
    h('span.nx-mode-ic', glyph || '♟'),
    h('b', title),
    h('small', sub));
}

function liveClock(g) {
  if (!g.clock || g.status !== 'active') return null;
  const side = g.turn === 'b' ? 'b' : 'w';
  const ms = remainingMs(g.clock, side, g.turn, g.status);
  return ms == null ? null : formatClock(ms);
}

const firstName = (n) => String(n || '?').split(' ')[0];
const tcLabel = (g) => (g.timeControl && g.timeControl !== 'classic' ? g.timeControl : t('tc_classic'));
const scoreOf = (g) => {
  if (g.result === '1-0') return '1 - 0';
  if (g.result === '0-1') return '0 - 1';
  if (g.result === '1/2-1/2') return '½ - ½';
  return '0 - 0';
};

/** Online page live row: player · LIVE score · player · Ko'rish. */
export function liveMatchRow(g, { onWatch, onProfile } = {}) {
  const w = g.white || {};
  const b = g.black || {};
  const side = (p, dot) => h('button.nx-vm-p', {
    type: 'button', onclick: tap(() => p.id && onProfile && onProfile(p.id)),
  },
    avBlock(p.name || '?', p.id || 0, { round: true, online: true, avatarKey: p.avatarKey, premium: !!p.premium }),
    h('div.nx-vm-n', h('b', p.name || '?'), h('small', String(p.elo || '—'))),
    h('i.nx-vm-dot.' + dot));
  return h('div.nx-vm',
    h('div.nx-vm-h',
      h('span.nx-live', h('i'), 'LIVE'),
      h('small', tcLabel(g)),
      h('span.nx-chip-s', t('ply_short', { n: Math.max(1, Math.ceil((g.ply || 0) / 2)) })),
      h('b.nx-vm-sc', scoreOf(g))),
    side(w, 'w'),
    side(b, 'b'),
    h('button.nx-btn-o.nx-vm-watch', { type: 'button', onclick: tap(() => onWatch && onWatch(g)) }, icon('eye', 15), t('watch_btn')));
}

export function statCard(ic, label, value, tone, onClick) {
  return h((onClick ? 'button' : 'div') + '.nx-stat.' + (tone || 'blue'), onClick ? { type: 'button', onclick: tap(onClick) } : {},
    h('span.nx-stat-ic', icon(ic, 20)),
    h('div', h('small', label), h('b', String(value))));
}

/** Jonli turnirlar card (Lichess broadcast). */
export function tourneyCard({ title, sub, live, soon, art, primary, actionLabel, onClick }) {
  return h('button.nx-tour' + (primary ? '.primary' : ''), { type: 'button', 'data-noswipe': '', onclick: tap(onClick) },
    art ? h('span.nx-tour-art', { style: { backgroundImage: `url(${art})` } }) : null,
    h('div.nx-tour-h', h('span.nx-tour-ic', icon('trophy', 16)), h('b', title)),
    h('small', sub),
    live ? h('span.nx-live', h('i'), 'LIVE') : soon ? h('span.nx-soon', icon('clock', 12), soon) : null,
    h('span.' + (primary ? 'nx-btn-p' : 'nx-btn-o') + '.nx-tour-btn', icon('eye', 15), actionLabel));
}

export function onlineBubble(u, onOpen) {
  return h('button.nx-ob', { type: 'button', 'data-noswipe': '', onclick: tap(() => onOpen && onOpen(u.id)) },
    avBlock(u.name || '?', u.id, { premium: !!u.premium, round: true, online: true, avatarKey: u.avatarKey }),
    h('b', firstName(u.name)),
    h('small', String(u.elo || '—'), ' ♟'));
}

/** Friend row with Yozish (chat) + Taklif (challenge). */
export function friendRow(f, { onMsg, onInvite, onProfile } = {}) {
  const status = f.inGame ? t('friend_in_game') : `${t('online')} · ${t('rating_n', { n: f.elo || 1200 })}`;
  return h('div.nx-fr',
    h('button.nx-row-main', { type: 'button', onclick: tap(() => onProfile && onProfile(f.id)) },
      avBlock(f.name || '?', f.id, { premium: !!f.premium, round: true, online: !!f.online, avatarKey: f.avatarKey }),
      h('div.nx-row-tx', h('b', f.name || '…'), h('small', h('i.nx-dot.' + (f.inGame ? 'amber' : 'green')), status))),
    h('button.nx-btn-o.sm', { type: 'button', onclick: tap(() => onMsg && onMsg(f)) }, icon('chat', 14), t('msg_write')),
    h('button.nx-btn-p.sm', {
      type: 'button', disabled: !f.online || !!f.inGame || !!f.invited, onclick: tap(() => onInvite && onInvite(f)),
    }, icon('gamepad', 14), f.invited ? t('challenge_sent_short') : t('invite_short')));
}

/** O'ynash player row: avatar · name/elo · ⚡ time · O'ynash. */
export function playerRow(u, { tc, onPlay, onProfile, actionLabel, actionIcon } = {}) {
  const blocked = !!u.inGame || u.discoverable === false;
  return h('div.nx-pr',
    h('button.nx-row-main', { type: 'button', onclick: tap(() => onProfile && onProfile(u.id)) },
      avBlock(u.name || '?', u.id, { premium: !!u.premium, round: true, online: u.online !== false, avatarKey: u.avatarKey }),
      h('div.nx-row-tx', h('b', u.name || '…', u.premium ? premIc(14) : null), h('small', String(u.elo || 1200)))),
    tc ? h('span.nx-tc', icon('bolt', 14), tc) : null,
    h('button.nx-btn-p.play', {
      type: 'button', disabled: blocked || !!u.invited, onclick: tap(() => onPlay && onPlay(u)),
    }, actionIcon ? icon(actionIcon, 14) : null,
    u.invited ? t('challenge_sent_short') : (u.inGame ? t('in_game') : (actionLabel || t('play_btn')))));
}

export function filterChip(id, label, on, onClick) {
  return h('button.nx-chip' + (on ? '.on' : ''), { type: 'button', onclick: tap(() => onClick && onClick(id)) }, label);
}

/** Underline sub-tabs (Onlayn o'yinchilar / Jonli o'yinlar / Turnirlar). */
export function underTabs(options, value, onChange) {
  return h('div.nx-utabs', { 'data-noswipe': '' }, ...options.map(([id, label]) => h('button' + (id === value ? '.on' : ''), {
    type: 'button', onclick: tap(() => id !== value && onChange(id)),
  }, label)));
}

/** Segmented tabs with icons (Online / Reyting / Tarix). */
export function segTabs(options, value, onChange, cls = '') {
  return h('div.nx-seg' + (cls ? '.' + cls : ''), { 'data-noswipe': '' }, ...options.map(([id, label, ic]) => h('button' + (id === value ? '.on' : ''), {
    type: 'button', onclick: tap(() => id !== value && onChange(id)),
  }, ic ? icon(ic, 16) : null, h('span', label))));
}

export function rankRow(p, { you, onOpen } = {}) {
  const place = p.rank;
  const medal = place >= 1 && place <= 3 ? h('span.nx-medal.m' + place, String(place)) : h('span.nx-rank-n', String(place || '—'));
  return h('button.nx-rank' + (place >= 1 && place <= 3 ? '.podium.t' + place : '') + (you ? '.you' : ''), {
    type: 'button', onclick: tap(() => onOpen && onOpen(p.id)),
  },
    medal,
    avBlock(p.name || '?', p.id, { premium: !!p.premium, round: true, avatarKey: p.avatarKey, online: !!p.online }),
    h('b.nx-rank-name', you ? t('you_label') : p.name, !you && p.premium ? premIc(14) : null),
    h('b.nx-rank-score', String(p.score)));
}

export function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('ago_now');
  if (m < 60) return t('ago_min', { n: m });
  const hr = Math.floor(m / 60);
  if (hr < 24) return t('ago_hour', { n: hr });
  return t('ago_day', { n: Math.floor(hr / 24) });
}

export function gameOutcome(g) {
  if (g.result === '1/2-1/2') return 'draw';
  return ((g.result === '1-0') === (g.you === 'w')) ? 'win' : 'loss';
}

export function historyRow(g, onAnalyze) {
  const o = g.opponent || {};
  const tag = gameOutcome(g);
  const label = tag === 'win' ? t('hist_win') : tag === 'loss' ? t('hist_loss') : t('hist_draw');
  const ic = tag === 'win' ? 'trophy' : tag === 'loss' ? 'x' : 'handshake';
  const open = tap(() => onAnalyze && onAnalyze(g));
  return h('div.nx-hist',
    h('button.nx-hist-main', { type: 'button', onclick: open },
      avBlock(o.name || '?', o.id || 0, { premium: !!o.premium, round: true, online: !!o.online, avatarKey: o.avatarKey }),
      h('div.nx-row-tx', h('b', o.name || '…'), h('small', String(o.elo || 1200))),
      h('span.nx-hist-ic.' + tag, icon(ic, 18)),
      h('div.nx-hist-r', h('b.' + tag, label), h('small', [g.timeControl && g.timeControl !== 'classic' ? g.timeControl : t('tc_classic'), timeAgo(g.updatedAt)].filter(Boolean).join(' · ')))),
    h('button.nx-hist-an', { type: 'button', 'aria-label': t('analyze'), title: t('analyze'), onclick: open },
      icon('sparkles', 17)));
}

/** Tarix header: what game analysis gives you. */
export function analysisCard() {
  return h('div.nx-an-card',
    h('span.nx-an-ic', icon('sparkles', 22)),
    h('div.nx-row-tx', h('b', t('analyze_title')), h('small.wrap', t('analyze_hist_sub'))));
}

/** AI level row: coloured bars · title · range · description. */
export function levelRow({ n, title, range, desc, onClick }) {
  return h('button.nx-lvl.l' + n, { type: 'button', onclick: tap(onClick) },
    h('span.nx-lvl-bars', ...[1, 2, 3, 4, 5].map((i) => h('i' + (i <= n ? '.f' : '')))),
    h('div.nx-row-tx', h('b', title), h('small', range)),
    h('small.nx-lvl-d', desc),
    icon('chevron', 16));
}

export function dailyCard({ reward, onClick }) {
  return h('button.nx-daily', { type: 'button', 'data-noswipe': '', onclick: tap(onClick) },
    h('span.nx-daily-art', { style: { backgroundImage: 'url(/img/ui/daily.webp)' } }),
    h('span.nx-daily-ic', '🎯'),
    h('div.nx-row-tx', h('b', t('home_daily_title')), h('small', t('home_daily_sub'))),
    h('span.nx-daily-rw', '💎', h('b', '+' + reward)),
    icon('chevron', 16));
}

export function emptyNote(text) {
  return h('div.nx-empty', text);
}
