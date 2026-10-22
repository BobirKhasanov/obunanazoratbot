// Public player profile: banner cover, likes, stats, friend / block actions.
import { h, icon, haptic, toast, api, fail, avBlock, premIc, confirmSheet } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';
import { sectionHead, statCard } from './neonui.js';

const DEFAULT_BANNER = '/img/profile-banner.png';

function actRow({ ic, title, sub, onClick, danger, done }) {
  // Settled states (already friends / request sent) are plain rows, not buttons.
  const el = onClick ? 'button' : 'div';
  return h(el + '.menu-row.uprof-row' + (danger ? '.danger' : '') + (done ? '.done' : ''), {
    type: onClick ? 'button' : undefined,
    onclick: onClick ? () => { haptic('select'); onClick(); } : undefined,
  },
    h('span.menu-ic' + (danger ? '.danger' : '') + (done ? '.ok' : ''), icon(ic, 22)),
    h('div.grow', h('div.t', title), sub ? h('div.s', sub) : null),
    onClick ? icon('chevron', 18) : null);
}

/**
 * @param {number} userId
 * @param {{ onChallenge?: (u: object) => void, refreshHome?: () => void, bannerUrl?: string }} [opts]
 */
export function openUserProfile(userId, opts = {}) {
  openScreen((close) => {
    const host = h('div.uprof');
    let data = null;

    const cover = (...band) => h('div.prof-cover.uprof-cover',
      h('div.prof-banner', { style: { backgroundImage: `url("${opts.bannerUrl || DEFAULT_BANNER}")` } },
        h('button.uprof-back.nx-round', {
          type: 'button', 'aria-label': t('back'),
          onclick: () => { haptic('light'); close(); },
        }, icon('back', 20))),
      band.length ? h('div.prof-band', ...band) : null);

    host.replaceChildren(cover());

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
      const games = total.w + total.d + total.l;
      const pct = (n) => (games ? Math.round((n / games) * 100) : 0);
      const wdlCol = (n, label, cls) => h('div.nx-wdl-col', h('b.' + cls, String(n)), h('small', label));
      const elo = u.elo || 1200;
      const shownName = u.displayName || 'Player';

      const likeBtn = u.you ? null : h('button.uprof-like' + (data.likedByMe ? '.on' : ''), {
        type: 'button',
        'aria-pressed': data.likedByMe ? 'true' : 'false',
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
      }, h('span.uprof-heart', '❤'), h('b', String(data.likes || 0)));

      const bioText = String(u.bio || '').trim();
      const placeBits = [u.country, u.region].map((x) => String(x || '').trim()).filter(Boolean);
      const userLine = [u.username ? '@' + u.username : '', placeBits.join(', ')].filter(Boolean).join(' · ');

      const openChat = async () => {
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
      };

      const friendRow = () => {
        if (data.isFriend) {
          return actRow({ ic: 'check', title: t('already_friends'), sub: t('uprof_friend_sub'), done: true });
        }
        if (data.friendRequest && data.friendRequest.direction === 'out') {
          return actRow({ ic: 'clock', title: t('friend_req_sent'), sub: t('uprof_friend_out_sub') });
        }
        if (data.friendRequest && data.friendRequest.direction === 'in') {
          return actRow({
            ic: 'friends',
            title: t('accept_friend'),
            sub: t('uprof_friend_in_sub', { name: shownName }),
            onClick: async () => {
              try {
                await api('POST', `/friends/request/${data.friendRequest.id}/respond`, { accept: true });
                toast(t('friend_req_accepted')); haptic('success');
                opts.refreshHome && opts.refreshHome();
                draw();
              } catch (e) { fail(e); }
            },
          });
        }
        return actRow({
          ic: 'friends',
          title: t('add_friend'),
          sub: t('uprof_friend_add_sub'),
          onClick: async () => {
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
        });
      };

      const blockRow = () => actRow({
        ic: data.blockedByMe ? 'shield' : 'x',
        title: data.blockedByMe ? t('unblock_user') : t('block_user'),
        sub: data.blockedByMe ? t('uprof_unblock_sub') : t('uprof_block_sub'),
        danger: !data.blockedByMe,
        onClick: async () => {
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
      });

      host.replaceChildren(...[
        cover(
          h('div.prof-av' + (u.premium ? '.prem-glow' : ''),
            avBlock(shownName, u.id, {
              premium: !!u.premium,
              size: 'xl',
              round: true,
              sparkles: !!u.premium,
              avatarKey: u.avatarKey,
            })),
          h('div.prof-meta',
            h('h2', h('span.name', shownName), u.premium ? premIc(18) : null),
            userLine ? h('div.prof-user', userLine) : null,
            h('div.nx-prof-chips',
              h('span.nx-chip-s.blue', icon('chart', 12), String(elo)),
              u.diamonds != null ? h('span.nx-chip-s.gold', `💎 ${u.diamonds}`) : null,
              u.online
                ? h('span.nx-chip-s.uprof-on', h('i.nx-dot.green'), t('online'))
                : h('span.nx-chip-s', icon('clock', 12), t('profile_recently')),
              u.premium ? h('span.nx-chip-s.gold', '👑 Premium') : null)),
          likeBtn),

        h('div.prof-body.uprof-body', ...[
          bioText ? h('div.uprof-bio', h('span.uprof-quote', '“'), h('span', bioText)) : null,

          h('div.nx-stats',
            statCard('chart', t('elo'), elo, 'blue'),
            statCard('trophy', t('hist_win'), total.w, 'green'),
            statCard('gamepad', t('uprof_games'), games, 'gold')),

          h('div.nx-wdl.uprof-wdl',
            h('div.nx-wdl-head',
              h('b', t('stats')),
              h('small', t('prof_games_total', { n: games }))),
            h('div.nx-wdl-bar',
              h('i.w', { style: { width: pct(total.w) + '%' } }),
              h('i.d', { style: { width: pct(total.d) + '%' } }),
              h('i.l', { style: { width: pct(total.l) + '%' } })),
            h('div.nx-wdl-nums',
              wdlCol(total.w, t('wins'), 'w'), wdlCol(total.d, t('draws'), 'd'), wdlCol(total.l, t('losses'), 'l'))),

          !u.you
            ? h('div.uprof-cta' + (opts.onChallenge ? '' : '.one'), ...[
              opts.onChallenge
                ? h('button.nx-btn-p', {
                  type: 'button',
                  disabled: !u.online,
                  onclick: () => {
                    if (!u.online) return toast(t('e_user_offline') || t('offline'), true);
                    haptic('light');
                    close(true);
                    opts.onChallenge({
                      id: u.id, name: u.displayName, premium: u.premium,
                      discoverable: true, online: u.online,
                    });
                  },
                }, icon('gamepad', 18), u.online ? t('challenge') : t('offline'))
                : null,
              h('button.nx-btn-o', { type: 'button', onclick: openChat }, icon('send', 17), t('send_message')),
            ].filter(Boolean))
            : null,

          !u.you ? h('div.menu-card.uprof-menu', friendRow(), blockRow()) : null,

          (data.medals && data.medals.length)
            ? h('div.uprof-medals',
              sectionHead(t('avatar_medals')),
              h('div.medal-grid.uprof-medal-grid', ...data.medals.map((m) => h('div.medal-card',
                h('img.medal-preview', { src: m.url, alt: m.title }),
                h('div.t', m.title),
                h('div.s', `${m.monthLabel} · #${m.place}`)))))
            : null,
        ].filter(Boolean)),
      ].filter(Boolean));
    };

    draw();
    return [host];
  });
}
