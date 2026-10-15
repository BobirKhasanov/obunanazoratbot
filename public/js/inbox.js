// In-app messages (DM search + chat) and notifications (admin → users; feedback → admins).
import { h, icon, haptic, toast, api, fail, avBlock, premIc, getInitData, onWs, hasTgBack, confirmSheet } from './ui.js';
import { t } from './i18n.js';
import { openScreen } from './screen.js';

/** Thread currently open in the chat UI (suppresses toast spam for that chat). */
let activeThreadId = null;

function inboxHead(title, close, emoji) {
  const back = hasTgBack()
    ? h('span.inbox-head-spacer', { 'aria-hidden': 'true' })
    : h('button.round.back', {
      type: 'button', 'aria-label': t('back'),
      onclick: () => { haptic('light'); close(); },
    }, icon('back', 22));
  return h('div.top.inbox-head',
    back,
    h('h1', (emoji ? emoji + ' ' : '') + title),
    h('span.inbox-head-spacer', { 'aria-hidden': 'true' }));
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

function mediaIdOf(n) {
  const id = n && n.meta && n.meta.mediaId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function notifMediaEl(n) {
  const id = mediaIdOf(n);
  if (!id) return null;
  const wrap = h('div.notif-media');
  fetch('/api/media/' + id, { headers: { 'X-Init-Data': getInitData() } })
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob || !wrap.isConnected) return;
      const url = URL.createObjectURL(blob);
      const img = h('img', { src: url, alt: '' });
      img.onload = () => URL.revokeObjectURL(url);
      wrap.replaceChildren(img);
    })
    .catch(() => {});
  return wrap;
}

/** Squircle mail + bell for the home header (reference style). */
export function headerInboxBtns() {
  const bind = (el, open) => {
    // Stop home pager from stealing the gesture; debounce so pointerup+click don't double-open.
    let last = 0;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - last < 450) return;
      last = now;
      haptic('light');
      try { open(); } catch (err) { console.warn('[inbox]', err); fail(err); }
    };
    el.addEventListener('pointerup', go);
    el.addEventListener('click', go);
  };
  const mail = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('messages'),
    'data-noswipe': '',
  }, icon('mail', 20), h('span.hdr-badge-slot'));
  const bell = h('button.hdr-ic', {
    type: 'button',
    'aria-label': t('xabarnoma'),
    'data-noswipe': '',
  }, icon('bell', 20), h('span.hdr-badge-slot'));
  bind(mail, openMessages);
  bind(bell, openNotifications);
  const wrap = h('div.hdr-inbox', { 'data-noswipe': '' }, mail, bell);
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

/** True when the open chat matches this thread (used by app.js to skip toast). */
export function isViewingDmThread(threadId) {
  return activeThreadId != null && Number(activeThreadId) === Number(threadId);
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
          const bodyPreview = String(n.body || '').trim();
          const feedbackHint = n.kind === 'feedback' && n.meta?.username
            ? '@' + n.meta.username
            : (n.kind === 'feedback' && n.meta?.fromName ? n.meta.fromName : '');
          const isDm = n.kind === 'dm' && n.meta && n.meta.threadId;
          nodes.push(h('button.notif-row' + (n.read ? '' : '.unread'), {
            type: 'button',
            onclick: async () => {
              try { if (!n.read) await api('POST', `/notifications/${n.id}/read`); } catch { /* ignore */ }
              n.read = true;
              if (isDm) {
                openChat(n.meta.threadId, n.meta.peer || {
                  id: n.meta.fromUserId,
                  name: n.meta.fromName || n.title || t('messages'),
                });
                refreshInboxBadges();
                return;
              }
              openNotifDetail(n, () => { load(); refreshInboxBadges(); });
            },
          },
            h('div.notif-ic' + (n.kind === 'feedback' ? '.feedback' : n.kind === 'dm' ? '.dm' : ''),
              icon(n.kind === 'feedback' ? 'help' : n.kind === 'dm' ? 'mail' : 'bell', 18)),
            h('div.notif-body',
              h('div.notif-head', h('b', n.title), h('span.notif-time', fmtTime(n.createdAt))),
              bodyPreview ? h('div.notif-snippet', bodyPreview) : null,
              feedbackHint ? h('div.notif-snippet.meta', feedbackHint) : null,
              notifMediaEl(n),
            )));
        }
        list.replaceChildren(...nodes.filter(Boolean));
        refreshInboxBadges();
      } catch (e) { fail(e); list.replaceChildren(h('div.empty', t('notif_empty'))); }
    };
    load();
    return [inboxHead(t('xabarnoma'), close, '🔔'), list];
  }, { onClose: () => refreshInboxBadges() });
}

function openNotifDetail(n, onBack) {
  openScreen((close) => {
    const goBack = () => { close(); onBack && onBack(); };
    const replyBox = n.kind === 'feedback' && n.meta?.fromUserId ? (() => {
      const area = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: t('notif_reply_ph') });
      const send = h('button.cta', {
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
    const campaignId = n.meta && n.meta.campaignId;
    const delHost = h('div');
    if (n.kind === 'admin') {
      api('GET', '/me').then((r) => {
        if (!(r.user && r.user.isAdmin)) return;
        delHost.replaceChildren(h('button.btn.ghost', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmSheet(t('admin_notif_delete_confirm'), t('admin_notif_delete'), true))) return;
            try {
              if (campaignId) await api('DELETE', `/admin/notifications/${campaignId}`);
              else await api('DELETE', `/admin/notifications/by-copy/${n.id}`);
              toast(t('admin_notif_deleted')); haptic('success');
              goBack();
            } catch (e) { fail(e); }
          },
        }, icon('trash', 18), t('admin_notif_delete')));
      }).catch(() => {});
    }
    return [
      inboxHead(n.title || t('xabarnoma'), goBack),
      h('div.card.notif-detail',
        h('div.s', fmtTime(n.createdAt)),
        h('p.notif-detail-body', n.body || ''),
        n.meta?.fromName
          ? h('div.muted', n.meta.fromName + (n.meta.username ? ` · @${n.meta.username}` : ''))
          : null,
        notifMediaEl(n),
      ),
      replyBox,
      delHost,
    ].filter(Boolean);
  });
}

export function openMessages() {
  openScreen((close) => {
    const threadsHost = h('div.msg-threads', h('div.skeleton'), h('div.skeleton'));
    const searchInput = h('input.input.msg-search', {
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
      } catch (e) { fail(e); threadsHost.replaceChildren(h('div.empty', h('div.empty-ic', '✉️'), t('msg_empty'))); }
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
              ? h('div.list.msg-search-list', ...users.map((u) => h('button.row', {
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
                icon('chevron', 18))))
              : h('div.muted.msg-search-empty', t('msg_no_users')),
          );
        } catch (e) { fail(e); }
      }, 280);
    });

    loadThreads();
    return [
      inboxHead(t('messages'), close, '✉️'),
      h('p.muted.msg-sub', t('msg_sub')),
      h('div.field.msg-search-field', searchInput),
      searchResults,
      h('div.h2', t('msg_chats')),
      threadsHost,
    ];
  }, { onClose: () => refreshInboxBadges() });
}

/** Open (or create) a DM thread with a friend and show the chat screen. */
export async function openChatWithUser(userId, peerHint) {
  try {
    const th = await api('POST', '/messages/threads', { userId });
    openChat(th.id, th.peer || peerHint || { id: userId, name: 'Player' });
  } catch (e) { fail(e); }
}

/** Open an existing thread (deep link / notification). Fetches peer if missing. */
export async function openDmThread(threadId, peerHint) {
  try {
    let peer = peerHint;
    if (!peer || !peer.name) {
      const r = await api('GET', `/messages/threads/${threadId}`);
      peer = r.peer || peerHint || { name: t('messages') };
    }
    openChat(threadId, peer);
  } catch (e) { fail(e); }
}

function bubbleEl(m) {
  return h('div.chat-bubble' + (m.mine ? '.mine' : ''),
    h('div.chat-bubble-text', m.body),
    h('small', fmtTime(m.createdAt)));
}

function openChat(threadId, peer) {
  const tid = Number(threadId);
  openScreen((close) => {
    activeThreadId = tid;
    const log = h('div.chat-log');
    const input = h('input.input.chat-input', {
      type: 'text',
      maxlength: 1000,
      placeholder: t('msg_ph'),
      enterKeyHint: 'send',
      autocomplete: 'off',
    });
    const sendBtn = h('button.round.chat-send', {
      type: 'button',
      'aria-label': t('msg_send'),
      onclick: () => { send(); },
    }, icon('send', 18));
    let sending = false;
    let knownIds = new Set();

    function paint(msgs) {
      const list = msgs || [];
      knownIds = new Set(list.map((m) => m.id).filter((x) => x != null));
      if (!list.length) {
        log.replaceChildren(h('div.chat-empty', h('div.empty-ic', '💬'), t('msg_start')));
        return;
      }
      log.replaceChildren(...list.map(bubbleEl));
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }

    function appendMsg(m) {
      if (m.id != null && knownIds.has(m.id)) return;
      if (m.id != null) knownIds.add(m.id);
      const empty = log.querySelector('.chat-empty');
      if (empty) log.replaceChildren();
      log.append(bubbleEl(m));
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }

    async function load() {
      try {
        const r = await api('GET', `/messages/threads/${tid}`);
        paint(r.messages || []);
        refreshInboxBadges();
      } catch (e) { fail(e); }
    }

    async function send() {
      const body = input.value.trim();
      if (!body || sending) return;
      sending = true;
      sendBtn.disabled = true;
      input.value = '';
      try {
        const r = await api('POST', `/messages/threads/${tid}`, { body });
        appendMsg({
          id: r.id,
          body: r.body || body,
          mine: true,
          createdAt: r.createdAt || new Date().toISOString(),
        });
        haptic('light');
      } catch (e) {
        input.value = body;
        fail(e);
      } finally {
        sending = false;
        sendBtn.disabled = false;
        try { input.focus(); } catch { /* ignore */ }
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });

    const offWs = onWs((m) => {
      if (m.t !== 'dm' || Number(m.threadId) !== tid) return;
      if (m.body) {
        appendMsg({
          id: m.id,
          body: m.body,
          mine: false,
          createdAt: m.createdAt || new Date().toISOString(),
        });
        refreshInboxBadges();
      } else {
        load();
      }
    });

    load();
    const poll = setInterval(load, 5000);
    const finish = () => {
      clearInterval(poll);
      try { offWs(); } catch { /* ignore */ }
      if (activeThreadId === tid) activeThreadId = null;
      close();
    };

    return [
      h('div.chat-screen',
        inboxHead(peer?.name || t('messages'), finish),
        log,
        h('div.chat-compose', input, sendBtn)),
    ];
  }, {
    onClose: () => {
      if (activeThreadId === tid) activeThreadId = null;
      refreshInboxBadges();
    },
  });
}
