// Shared neon-shell UI bits for Home / Play hub / Online (iOS + Android Lite safe).
import { h, icon, haptic, avBlock, premIc } from './ui.js';
import { t } from './i18n.js';
import { isLite } from './perf.js';

export function seeAll(label, onClick) {
  return h('button.neon-seeall', {
    type: 'button',
    onclick: () => { haptic('light'); onClick && onClick(); },
  }, label || t('see_all'), icon('chevron', 14));
}

export function sectionHead(title, onSeeAll, seeLabel) {
  return h('div.neon-sec-h',
    h('h2.neon-sec-title', title),
    onSeeAll ? seeAll(seeLabel, onSeeAll) : null);
}

/** Compact app header: avatar + name/elo · inbox · notif · gems */
export function appHeader({ me, onProfile, onGems, inboxBtns, elo }) {
  const name = me.displayName || me.firstName || 'Player';
  return h('div.neon-hdr',
    h('button.neon-hdr-me', {
      type: 'button',
      onclick: () => { haptic('light'); onProfile && onProfile(); },
    },
      avBlock(name, me.id, {
        premium: !!me.premium, round: true, online: true, avatarKey: me.avatarKey,
      }),
      h('div.neon-hdr-meta',
        h('div.neon-hdr-name',
          h('b', name),
          me.premium ? premIc(16) : null),
        h('div.neon-hdr-elo', icon('chart', 14), h('span', String(elo != null ? elo : (me.elo || 1200)))))),
    h('div.neon-hdr-actions',
      ...(inboxBtns || []),
      h('button.neon-gem', {
        type: 'button',
        onclick: () => { haptic('light'); onGems && onGems(); },
      }, icon('gem', 16), h('b', String(me.diamonds || 0)), h('span.neon-gem-plus', '+'))));
}

export function modeCard({ title, sub, tone, emoji, onClick }) {
  return h('button.neon-mode.' + (tone || 'blue'), {
    type: 'button',
    onclick: () => { haptic('light'); onClick && onClick(); },
  },
    h('span.neon-mode-ic', emoji || '♟'),
    h('b', title),
    h('small', sub),
    h('span.neon-mode-go', icon('chevron', 14)));
}

export function liveMiniCard(g, onOpen) {
  const w = g.white || {};
  const b = g.black || {};
  return h('button.neon-live-card', {
    type: 'button',
    'data-noswipe': '',
    onclick: () => { haptic('light'); onOpen && onOpen(g); },
  },
    h('div.neon-live-vs',
      h('div.neon-live-p',
        avBlock(w.name || '?', w.id || 0, { round: true, online: true, avatarKey: w.avatarKey }),
        h('b', (w.name || '?').split(' ')[0]),
        h('small', String(w.elo || '—'))),
      h('div.neon-live-mid',
        h('span.neon-live-badge', '● LIVE'),
        h('b', g.result || '–'),
        h('small', g.timeControl && g.timeControl !== 'classic' ? g.timeControl : t('watching_live'))),
      h('div.neon-live-p',
        avBlock(b.name || '?', b.id || 0, { round: true, online: true, avatarKey: b.avatarKey }),
        h('b', (b.name || '?').split(' ')[0]),
        h('small', String(b.elo || '—')))));
}

export function playerPlayRow(u, { onPlay, onProfile, actionLabel } = {}) {
  return h('div.neon-player-row',
    h('button.neon-player-main', {
      type: 'button',
      onclick: () => { haptic('select'); onProfile && onProfile(u.id); },
    },
      avBlock(u.name || '?', u.id, {
        premium: !!u.premium, round: true, online: u.online !== false, avatarKey: u.avatarKey,
      }),
      h('div.grow',
        h('div.t', h('span.name', u.name || '…'), u.premium ? premIc() : null),
        h('div.s', [
          u.elo != null ? String(u.elo) : '',
          u.inGame ? t('in_game') : (u.online ? t('online') : ''),
        ].filter(Boolean).join(' · ')))),
    h('button.neon-play-btn', {
      type: 'button',
      disabled: !!u.invited || u.inGame || u.discoverable === false,
      onclick: () => { haptic('medium'); onPlay && onPlay(u); },
    }, actionLabel || t('play_btn')));
}

export function friendActionRow(f, { onMsg, onInvite, onProfile } = {}) {
  const status = f.inGame
    ? (t('in_game') + (f.elo != null ? ` · ${f.elo}` : ''))
    : (`${t('online')}${f.elo != null ? ` · ${t('elo')} ${f.elo}` : ''}`);
  return h('div.neon-friend-row',
    h('button.neon-player-main', {
      type: 'button',
      onclick: () => { haptic('select'); onProfile && onProfile(f.id); },
    },
      avBlock(f.name || '?', f.id, {
        premium: !!f.premium, round: true, online: !!f.online, avatarKey: f.avatarKey,
      }),
      h('div.grow', h('div.t', f.name || '…'), h('div.s', status))),
    h('div.neon-friend-acts',
      h('button.neon-btn-ghost', {
        type: 'button',
        onclick: () => { haptic('light'); onMsg && onMsg(f); },
      }, icon('chat', 14), t('msg_write')),
      h('button.neon-play-btn', {
        type: 'button',
        disabled: !f.online || f.inGame || f.invited,
        onclick: () => { haptic('medium'); onInvite && onInvite(f); },
      }, icon('gamepad', 14), t('invite_short'))));
}

export function statCard(label, value, tone) {
  return h('div.neon-stat.' + (tone || 'blue'),
    h('small', label),
    h('b', String(value)));
}

export function filterChip(id, label, on, onClick) {
  return h('button.neon-chip' + (on ? '.on' : ''), {
    type: 'button',
    onclick: () => { haptic('select'); onClick && onClick(id); },
  }, label);
}

export function historyRow(g, onOpen) {
  const o = g.opponent || {};
  const win = g.result === '1/2-1/2' ? null : (g.result === '1-0') === (g.you === 'w');
  const tag = win == null ? 'draw' : (win ? 'win' : 'loss');
  const label = win == null ? t('hist_draw') : (win ? t('hist_win') : t('hist_loss'));
  return h('button.neon-hist-row.' + tag, {
    type: 'button',
    onclick: () => { haptic('light'); onOpen && onOpen(g); },
  },
    avBlock(o.name || '?', o.id || 0, {
      premium: !!o.premium, round: true, online: !!o.online, avatarKey: o.avatarKey,
    }),
    h('div.grow',
      h('div.t', o.name || '…'),
      h('div.s', [g.timeControl, o.elo != null ? String(o.elo) : ''].filter(Boolean).join(' · '))),
    h('span.neon-hist-tag.' + tag, label),
    icon('chevron', 16));
}

export function liteSafe(fnHeavy, fnLite) {
  return isLite() ? fnLite() : fnHeavy();
}
