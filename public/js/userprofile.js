// Public player profile: premium glow, bio, likes, stats, block.
import { h, icon, haptic, toast, api, fail, avBlock, premIc, confirmSheet } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';

function presenceLabel(online) {
  return online ? t('online') : t('profile_recently');
}

/**
 * @param {number} userId
 * @param {{ onChallenge?: (u: object) => void, refreshHome?: () => void }} [opts]
 */
export function openUserProfile(userId, opts = {}) {
  openScreen((close) => {
    const host = h('div.uprof');
    let data = null;

    const draw = async () => {
      try {
        data = await api('GET', `/users/${userId}`);
      } catch (e) {
        fail(e);
        close();
        return;
      }
      const u = data.user;
      const st = data.stats || {};
      const online = st.online || { w: 0, d: 0, l: 0 };
      const ai = st.ai || { w: 0, d: 0, l: 0 };
      const total = {
        w: (online.w || 0) + (ai.w || 0),
        d: (online.d || 0) + (ai.d || 0),
        l: (online.l || 0) + (ai.l || 0),
      };

      const likeBtn = h('button.uprof-like' + (data.likedByMe ? '.on' : ''), {
        type: 'button',
        hidden: !!u.you,
        onclick: async () => {
          if (u.you) return;
          haptic('select');
          try {
            const r = await api('POST', `/users/${u.id}/like`);
            data.likes = r.likes;
            data.likedByMe = r.likedByMe;
            draw();
          } catch (e) { fail(e); }
        },
      }, '❤ ', h('b', String(data.likes || 0)));

      host.replaceChildren(
        h('div.uprof-hero' + (u.premium ? '.prem' : ''),
          h('div.uprof-avwrap' + (u.premium ? '.prem-glow' : ''),
            avBlock(u.displayName, u.id, {
              premium: !!u.premium, size: 'xl', round: true, avatarKey: u.avatarKey,
            })),
          likeBtn,
          h('h2.uprof-name', u.displayName || 'Player', u.premium ? premIc(20) : null),
          h('div.uprof-bar',
            h('span', h('span.uprof-star', '★'), ' ', t('elo') + ' : ', h('b', String(u.elo || 1200))),
            u.premium ? h('span.uprof-prem', '👑 ', t('premium_member')) : null),
          h('div.uprof-presence', h('span', '◷'), ' ', presenceLabel(!!u.online)),
          (u.bio || u.username)
            ? h('div.uprof-bio',
              h('span.uprof-quote', '“'),
              h('span', u.bio || (u.username ? '@' + u.username : '')))
            : null),

        h('div.uprof-stats',
          h('div.h2', t('stats')),
          h('div.uprof-statgrid',
            h('div.card.uprof-stat', h('small.muted', t('vs_online')), h('b', `${online.w}/${online.d}/${online.l}`)),
            h('div.card.uprof-stat', h('small.muted', t('vs_pc')), h('b', `${ai.w}/${ai.d}/${ai.l}`)),
            h('div.card.uprof-stat', h('small.muted', t('wins')), h('b', String(total.w))),
            h('div.card.uprof-stat', h('small.muted', t('draws')), h('b', String(total.d))),
            h('div.card.uprof-stat', h('small.muted', t('losses')), h('b', String(total.l)))),
          (u.country || u.region)
            ? h('div.card', h('div.s', [u.country, u.region].filter(Boolean).join(' · ')))
            : null),

        !u.you
          ? h('div.uprof-actions',
            opts.onChallenge
              ? h('button.cta', {
                type: 'button',
                onclick: () => {
                  close(true);
                  opts.onChallenge({
                    id: u.id, name: u.displayName, premium: u.premium,
                    discoverable: true, online: u.online,
                  });
                },
              }, t('challenge'))
              : null,
            h('button.btn.ghost' + (data.blockedByMe ? '.ok' : ''), {
              type: 'button',
              onclick: async () => {
                haptic('select');
                const next = !data.blockedByMe;
                if (next && !(await confirmSheet(t('block_confirm'), t('block_user'), true))) return;
                try {
                  const r = await api('POST', `/users/${u.id}/block`, { blocked: next });
                  data.blockedByMe = r.blockedByMe;
                  toast(next ? t('blocked_ok') : t('unblocked_ok'));
                  opts.refreshHome && opts.refreshHome();
                  if (next) close();
                  else draw();
                } catch (e) { fail(e); }
              },
            }, data.blockedByMe ? t('unblock_user') : t('block_user')))
          : null,
      );
    };

    draw();
    return [
      h('div.top',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 22)),
        h('h1', t('profile_title'))),
      host,
    ];
  });
}
