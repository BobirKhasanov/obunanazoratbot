// In-app messages (DM search + chat) and notifications (admin → users; feedback → admins).
import { h, icon, haptic, toast, api, fail, avBlock, premIc } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';

function subTop(title, close, leading) {
  return [
    h('button.back', { type: 'button', onclick: () => close() }, icon('back', 20), t('back')),
    h('div.top.inbox-top', leading || null, h('h1', title)),
  ];
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayKey(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (start(now) - start(d)) / 86400000;
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return 'older';
}

function dayLabel(key) {
  if (key === 'today') return t('notif_today');
  if (key === 'yesterday') return t('notif_yesterday');
  return t('notif_earlier');
}

function badgeEl(n) {
  const v = Number(n) || 0;
  if (v <= 0) return null;
  return h('span.hdr-badge', v > 99 ? '99+' : String(v));
}

/** Squircle mail + bell for the home header (reference style). */
export function headerInboxBtns() {
  const mail = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('messages'),
    onclick: () => { haptic('light'); openMessages(); },
  }, icon('mail', 20), h('span.hdr-badge-slot'));
  const bell = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('xabarnoma'),
    onclick: () => { haptic('light'); openNotifications(); },
  }, icon('bell', 20), h('span.hdr-badge-slot'));
  const wrap = h('div.hdr-inbox', mail, bell);
  refreshInboxBadges(wrap);
  return wrap;
}

export async function refreshInboxBadges(root) {
  const host = root || document;
  try {
    const [n, m] = await Promise.all([
      api('GET', '/notifications/unread-count'),
      api('GET', '/messages/unread-count'),
    ]);
    const mailSlot = host.querySelector?.('.hdr-ic[aria-label="' + t('messages') + '"] .hdr-badge-slot')
      || host.querySelectorAll?.('.hdr-ic .hdr-badge-slot')?.[0];
    const bellSlot = host.querySelectorAll?.('.hdr-ic .hdr-badge-slot')?.[1];
    if (mailSlot) mailSlot.replaceChildren(badgeEl(m.count) || '');
    if (bellSlot) bellSlot.replaceChildren(badgeEl(n.count) || '');
  } catch { /* ignore badge errors */ }
}

export function openNotifications() {
  openScreen((close) => {
    const list = h('div.notif-list', h('div.skeleton'), h('div.skeleton'));
    const load = async () => {
      try {
        const r = await api('GET', '/notifications');
        const items = r.notifications || [];
        if (!items.length) {
          list.replaceChildren(h('div.empty', h('div.empty-ic', '🔔'), t('notif_empty')));
          return;
        }
        const nodes = [];
        let lastDay = null;
        for (const n of items) {
          const dk = dayKey(n.createdAt);
          if (dk !== lastDay) {
            lastDay = dk;
            nodes.push(h('div.notif-day', dayLabel(dk)));
          }
          nodes.push(h('button.notif-row' + (n.read ? '' : '.unread'), {
            type: 'button',
            onclick: async () => {
              try { if (!n.read) await api('POST', `/notifications/${n.id}/read`); } catch { /* ignore */ }
              n.read = true;
              openNotifDetail(n, () => { load(); refreshInboxBadges(); });
            },
          },
            h('div.notif-ic', icon('bell', 18)),
            h('div.grow',
              h('div.notif-head', h('b', n.title), h('span.notif-time', fmtTime(n.createdAt))),
              n.body ? h('div.s', n.body) : null,
              n.kind === 'feedback' && n.meta?.username ? h('div.s', '@' + n.meta.username) : null,
            )));
        }
        list.replaceChildren(...nodes);
        refreshInboxBadges();
      } catch (e) { fail(e); list.replaceChildren(h('div.empty', t('notif_empty'))); }
    };
    load();
    return [
      ...subTop(t('xabarnoma'), close, h('span.inbox-title-ic', icon('bell', 22))),
      list,
    ];
  }, { onClose: () => refreshInboxBadges() });
}

function openNotifDetail(n, onBack) {
  openScreen((close) => {
    const replyBox = n.kind === 'feedback' && n.meta?.fromUserId ? (() => {
      const area = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: t('notif_reply_ph') });
      const send = h('button.btn', {
        type: 'button',
        onclick: async () => {
          const body = area.value.trim();
          if (!body) return;
          try {
            await api('POST', '/admin/notifications', {
              userId: n.meta.fromUserId,
              title: t('notif_admin_reply_title'),
              body,
            });
            toast(t('notif_reply_sent')); haptic('success');
            area.value = '';
          } catch (e) { fail(e); }
        },
      }, t('notif_reply_send'));
      return h('div.notif-reply', h('p.muted', t('notif_reply_sub')), area, send);
    })() : null;
    return [
      ...subTop(n.title || t('xabarnoma'), () => { close(); onBack && onBack(); }),
      h('div.card',
        h('div.s', fmtTime(n.createdAt)),
        h('p', { style: { marginTop: '10px', lineHeight: '1.45', whiteSpace: 'pre-wrap' } }, n.body || ''),
        n.meta?.fromName ? h('div.muted', { style: { marginTop: '12px' } }, n.meta.fromName + (n.meta.username ? ` · @${n.meta.username}` : '')) : null,
      ),
      replyBox,
    ];
  });
}

export function openMessages() {
  openScreen((close) => {
    const threadsHost = h('div.msg-threads', h('div.skeleton'), h('div.skeleton'));
    const searchInput = h('input.input', {
      type: 'search',
      placeholder: t('msg_search_ph'),
      autocomplete: 'off',
    });
    const searchResults = h('div.msg-search-results');
    let searchTimer = null;

    const loadThreads = async () => {
      try {
        const r = await api('GET', '/messages/threads');
        const threads = r.threads || [];
        if (!threads.length) {
          threadsHost.replaceChildren(h('div.empty', h('div.empty-ic', '✉️'), t('msg_empty')));
          return;
        }
        threadsHost.replaceChildren(...threads.map((th) => h('button.row.msg-thread', {
          type: 'button',
          onclick: () => openChat(th.id, th.peer),
        },
          avBlock(th.peer.name, th.peer.id, { premium: !!th.peer.premium, round: true }),
          h('div.grow',
            h('div.t', th.peer.name, th.peer.premium ? premIc() : null),
            h('div.s', th.lastBody || t('msg_start'))),
          th.unread ? h('span.count-pill', String(th.unread)) : h('span.msg-time', fmtTime(th.updatedAt)),
        )));
        refreshInboxBadges();
      } catch (e) { fail(e); threadsHost.replaceChildren(h('div.empty', t('msg_empty'))); }
    };

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { searchResults.replaceChildren(); return; }
      searchTimer = setTimeout(async () => {
        try {
          const r = await api('GET', '/messages/search?q=' + encodeURIComponent(q));
          const users = r.users || [];
          searchResults.replaceChildren(
            users.length
              ? h('div.list', ...users.map((u) => h('button.row', {
                type: 'button',
                onclick: async () => {
                  try {
                    const th = await api('POST', '/messages/threads', { userId: u.id });
                    openChat(th.id, th.peer || u);
                  } catch (e) { fail(e); }
                },
              },
                avBlock(u.name, u.id, { premium: !!u.premium, round: true }),
                h('div.grow', h('div.t', u.name, u.premium ? premIc() : null),
                  h('div.s', u.username ? '@' + u.username : t('msg_start'))),
                icon('chevron', 18)))
              : h('div.muted', { style: { padding: '8px 4px' } }, t('msg_no_users')),
          );
        } catch (e) { fail(e); }
      }, 280);
    });

    loadThreads();
    return [
      ...subTop(t('messages'), close, h('span.inbox-title-ic', icon('mail', 22))),
      h('div.field', searchInput),
      searchResults,
      h('div.h2', t('msg_chats')),
      threadsHost,
    ];
  }, { onClose: () => refreshInboxBadges() });
}

function openChat(threadId, peer) {
  openScreen((close) => {
    const log = h('div.chat-log', h('div.skeleton'));
    const input = h('input.input.chat-input', { type: 'text', maxlength: 1000, placeholder: t('msg_ph') });
    const sendBtn = h('button.round.chat-send', {
      type: 'button',
      'aria-label': t('msg_send'),
      onclick: send,
    }, icon('send', 18));

    async function load() {
      try {
        const r = await api('GET', `/messages/threads/${threadId}`);
        const msgs = r.messages || [];
        if (!msgs.length) {
          log.replaceChildren(h('div.empty', t('msg_start')));
        } else {
          log.replaceChildren(...msgs.map((m) => h('div.chat-bubble' + (m.mine ? '.mine' : ''),
            h('div', m.body),
            h('small', fmtTime(m.createdAt)))));
          requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
        }
        refreshInboxBadges();
      } catch (e) { fail(e); }
    }

    async function send() {
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try {
        await api('POST', `/messages/threads/${threadId}`, { body });
        await load();
        haptic('light');
      } catch (e) { fail(e); }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });

    load();
    const poll = setInterval(load, 4000);
    return [
      ...subTop(peer?.name || t('messages'), () => { clearInterval(poll); close(); }),
      log,
      h('div.chat-compose', input, sendBtn),
    ];
  }, { onClose: () => refreshInboxBadges() });
}
