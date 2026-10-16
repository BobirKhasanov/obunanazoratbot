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
      // Online PvP only — computer games excluded from stats
      const total = {
        w: online.w || 0,
        d: online.d || 0,
        l: online.l || 0,
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

      const bioText = String(u.bio || '').trim() || (u.username ? '@' + u.username : '');
      const placeBits = [u.country, u.region].map((x) => String(x || '').trim()).filter(Boolean);

      host.replaceChildren(...[
        h('div.uprof-hero' + (u.premium ? '.prem' : ''),
          h('div.uprof-avwrap' + (u.premium ? '.prem-glow' : ''),
            avBlock(u.displayName, u.id, {
              premium: !!u.premium,
              size: 'xl',
              round: true,
              sparkles: !!u.premium,
              avatarKey: u.avatarKey,
            })),
          likeBtn,
          h('h2.uprof-name', u.displayName || 'Player', u.premium ? premIc(20) : null),
          h('div.uprof-bar',
            h('span', h('span.uprof-star', '★'), ' ', t('elo') + ' : ', h('b', String(u.elo || 1200))),
            u.premium ? h('span.uprof-prem', '👑 ', t('premium_member')) : null),
          h('div.uprof-presence', h('span', '◷'), ' ', presenceLabel(!!u.online)),
          bioText
            ? h('div.uprof-bio',
              h('span.uprof-quote', '“'),
              h('span', bioText))
            : null),

        h('div.uprof-stats',
          h('div.h2', t('stats')),
          h('div.uprof-statgrid.wdl',
            h('div.card.uprof-stat', h('small.muted', t('wins')), h('b', String(total.w))),
            h('div.card.uprof-stat', h('small.muted', t('draws')), h('b', String(total.d))),
            h('div.card.uprof-stat', h('small.muted', t('losses')), h('b', String(total.l)))),
          placeBits.length ? h('div.card.uprof-place', h('div.s', placeBits.join(' · '))) : null),

        (data.medals && data.medals.length)
          ? h('div.uprof-medals',
            h('div.h2', t('avatar_medals')),
            h('div.medal-grid.uprof-medal-grid', ...data.medals.map((m) => h('div.medal-card',
              h('img.medal-preview', { src: m.url, alt: m.title }),
              h('div.t', m.title),
              h('div.s', `${m.monthLabel} · #${m.place}`)))))
          : null,

        !u.you
          ? h('div.uprof-actions', ...[
            h('button.cta', {
              type: 'button',
              onclick: async () => {
                haptic('light');
                try {
                  const { openChatWithUser } = await import('./inbox.js');
                  close(true);
                  await openChatWithUser(u.id, {
                    id: u.id,
                    name: u.displayName,
                    premium: !!u.premium,
                    avatarKey: u.avatarKey || null,
                  });
                } catch (e) { fail(e); }
              },
            }, icon('send', 18), t('send_message')),
            opts.onChallenge
              ? h('button.btn', {
                type: 'button',
                disabled: !u.online,
                onclick: () => {
                  if (!u.online) return toast(t('e_user_offline') || t('offline'), true);
                  close(true);
                  opts.onChallenge({
                    id: u.id, name: u.displayName, premium: u.premium,
                    discoverable: true, online: u.online,
                  });
                },
              }, u.online ? t('challenge') : t('offline'))
              : null,
            (() => {
              if (data.isFriend) return h('button.btn.ghost', { type: 'button', disabled: true }, t('already_friends'));
              if (data.friendRequest && data.friendRequest.direction === 'out') {
                return h('button.btn.ghost', { type: 'button', disabled: true }, t('friend_req_sent'));
              }
              if (data.friendRequest && data.friendRequest.direction === 'in') {
                return h('button.btn', {
                  type: 'button',
                  onclick: async () => {
                    haptic('select');
                    try {
                      await api('POST', `/friends/request/${data.friendRequest.id}/respond`, { accept: true });
                      toast(t('friend_req_accepted')); haptic('success');
                      opts.refreshHome && opts.refreshHome();
                      draw();
                    } catch (e) { fail(e); }
                  },
                }, t('accept_friend'));
              }
              return h('button.btn', {
                type: 'button',
                onclick: async () => {
                  haptic('select');
                  try {
                    const r = await api('POST', '/friends/request', { userId: u.id });
                    if (r.accepted) {
                      toast(t('friend_added', { name: u.displayName }));
                      haptic('success');
                    } else {
                      toast(t('friend_req_sent'));
                    }
                    opts.refreshHome && opts.refreshHome();
                    draw();
                  } catch (e) { fail(e); }
                },
              }, t('add_friend'));
            })(),
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
            }, data.blockedByMe ? t('unblock_user') : t('block_user')),
          ].filter(Boolean))
          : null,
      ].filter(Boolean));
    };

    draw();
    return [
      h('div.top.inbox-head',
        h('button.round.back', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 22)),
        h('h1', t('profile_title')),
        h('span.inbox-head-spacer', { 'aria-hidden': 'true' })),
      host,
    ];
  });
}
