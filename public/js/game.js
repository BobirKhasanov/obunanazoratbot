// Game screen: vs computer (local engine in a Web Worker) and online / friend games (server-authoritative over WebSocket).
import { Chess } from '/vendor/chess.js';
import { h, $, icon, haptic, toast, sheet, confirmSheet, api, fail, onWs, floatEmoji, rain, avatar, avBlock, sleep, shareUrl, copyText, playMoveSound, unlockAudio, isMoveSoundOn, setMoveSoundOn } from './ui.js';
import { t, getLang } from './i18n.js';
import { Board } from './board.js';
import { pieceSvg, PIECE_VALUE } from './pieces.js';
import { formatClock, remainingMs, isTimed, formatTashkentWhen, categoryOf } from './time.js';
import { liveGamePollMs, gameClockTickMs, boardAnimateDefault } from './perf.js';
import { openGameAnalysis } from './analyze.js';

const AI_KEY = 'chess-ai-game';
const EMOTES = ['🤔', '😎', '😮', '👏', '🙈', '😀'];
let ctx = null; // the open game, or null

export const openGameId = () => (ctx && (ctx.kind === 'online' || ctx.kind === 'spectate') ? ctx.id : null);
/** After piece-set change: refresh captures / clocks without animation. */
export function restyleOpenGame() { if (ctx && ctx.render) ctx.render(false); }
export const savedAiGame = () => { try { const s = JSON.parse(localStorage.getItem(AI_KEY)); return s && Array.isArray(s.moves) ? s : null; } catch { return null; } };
const saveAi = (s) => { try { s ? localStorage.setItem(AI_KEY, JSON.stringify(s)) : localStorage.removeItem(AI_KEY); } catch { /* storage blocked */ } };

// ---------- engine (worker with a main-thread fallback) ----------
let worker = null, workerBroken = false, reqId = 0; const pending = new Map();
function startWorker() {
  if (worker || workerBroken) return;
  try {
    worker = new Worker('/js/ai-worker.mjs', { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.move); } };
    worker.onerror = () => { workerBroken = true; worker = null; for (const [, p] of pending) p(undefined); pending.clear(); };
  } catch { workerBroken = true; }
}
let mainEngine = null;
async function askEngine(fen, level, seen, timeMs) {
  startWorker();
  if (worker) {
    const id = ++reqId;
    const r = await new Promise((res) => { pending.set(id, res); worker.postMessage({ id, fen, level, seen, timeMs }); });
    if (r !== undefined) return r;
  }
  if (!mainEngine) { const m = await import('./ai.mjs'); mainEngine = m.makeEngine(Chess); }
  await sleep(30);
  return mainEngine.bestMove(fen, level, { seen, timeMs });
}

// ---------- helpers ----------
const build = (moves) => { const c = new Chess(); for (const [from, to, promotion] of moves) c.move({ from, to, promotion }); return c; };
function captured(chess) {
  const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') have[p.color][p.type]++;
  const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const lost = { w: [], b: [] }; let score = 0;
  for (const col of ['w', 'b']) for (const k of ['q', 'r', 'b', 'n', 'p']) {
    const n = Math.max(0, full[k] - have[col][k]);
    for (let i = 0; i < n; i++) lost[col].push(k);
    score += (col === 'w' ? -1 : 1) * n * PIECE_VALUE[k]; // + = white is ahead
  }
  return { lost, score };
}
const reasonKey = (r) => ({ checkmate: 'reason_checkmate', resign: 'reason_resign', stalemate: 'reason_stalemate', agreement: 'reason_agreement', insufficient: 'reason_insufficient', repetition: 'reason_repetition', fifty: 'reason_fifty', abandoned: 'reason_abandoned', timeout: 'reason_timeout', timeout_draw: 'reason_timeout_draw' }[r] || 'reason_checkmate');

// ---------- the screen ----------
export function openGame(opts, onClose) {
  if (ctx) closeNow();
  const root = $('#game');
  root.replaceChildren();
  const S = ctx = {
    kind: opts.kind, onClose, level: opts.level || 3, colour: opts.colour || 'w', id: opts.game ? opts.game.id : null,
    moves: [], chess: new Chess(), over: false, busy: false, game: opts.game || null, flipped: false, meta: opts.meta || {}, thinking: false,
    clockTimer: null, flagClaimed: false, chat: [], chatOpen: false,
    allowUndo: opts.allowUndo !== false,
  };

  const bar = (cls) => ({
    el: h('div.pbar.' + cls), av: h('div.pav'), name: h('b'), sub: h('small'), cap: h('div.cap'), mat: h('em'),
  });
  const top = bar('top'), bot = bar('bot');
  for (const b of [top, bot]) b.el.append(b.av, h('div.pinfo', b.name, b.sub), h('div.capwrap', b.cap, b.mat));
  const status = h('div.status');
  const moveStrip = h('div.moves');
  const boardHost = h('div.board-host');
  const banner = h('div.gbanner'); banner.hidden = true;
  const back = h('button.round.back', { 'aria-label': t('back'), onclick: () => closeGame() }, icon('back', 22));
  const title = h('div.gtitle');
  const soundBtn = h('button.round.sound-btn', {
    type: 'button',
    'aria-label': t('move_sound'),
    onclick: () => {
      const on = !isMoveSoundOn();
      setMoveSoundOn(on);
      paintSoundBtn();
      haptic('select');
      // Spectators: toggle only — do not play a "player move" preview sound
      if (on && S.kind !== 'spectate') { unlockAudio(); playMoveSound(); }
      else if (on) unlockAudio();
    },
  });
  // Hide move-sound control while spectating (watching ≠ playing)
  if (opts.kind === 'spectate') soundBtn.hidden = true;
  const paintSoundBtn = () => {
    const on = isMoveSoundOn();
    soundBtn.replaceChildren(icon(on ? 'soundOn' : 'soundOff', 28));
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundBtn.classList.toggle('off', !on);
  };
  paintSoundBtn();
  const act = (ic, label, fn) => h('button.act', { onclick: fn, 'aria-label': label }, icon(ic, 22), h('span', label));
  const actions = h('div.actions');
  const reactBar = h('div.reactbar'); reactBar.hidden = true;
  const chatPanel = h('div.gchat'); chatPanel.hidden = true;
  const chatLog = h('div.gchat-log');
  const chatInput = h('input.input', {
    type: 'text', maxlength: 120, placeholder: t('game_chat_ph'), autocomplete: 'off',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } },
  });
  chatPanel.append(
    chatLog,
    h('div.gchat-form', chatInput, h('button.mini', { type: 'button', 'aria-label': t('game_chat_send'), onclick: sendChat }, icon('send', 18))),
  );
  root.append(
    h('div.ghead', back, title,
      h('div.ghead-tools',
        soundBtn,
        h('button.round', { 'aria-label': t('flip'), onclick: () => { S.flipped = !S.flipped; render(false); haptic('light'); } }, icon('flip', 22)))),
    status, top.el, boardHost, bot.el, moveStrip, banner, reactBar, chatPanel, actions,
  );
  const board = S.board = new Board(boardHost, {
    onMove: (f, to, p) => humanMove(f, to, p),
    onPremove: () => { /* highlight only — executed in applyServer */ },
  });
  S.spectators = (opts.game && opts.game.spectators) || 0;
  // Telegram/iOS: unlock on board touch only when sound is on (muted unlock still clicks on some TG builds)
  boardHost.addEventListener('pointerdown', () => { if (isMoveSoundOn()) unlockAudio(); }, { passive: true });

  const orientation = () => ((S.colour === 'b') !== S.flipped ? 'b' : 'w');
  const meName = () => (S.meta.me && S.meta.me.name) || t('you');

  function names() {
    const meMeta = S.meta.me || {};
    if (S.kind === 'ai') {
      return {
        me: { name: meName(), id: meMeta.id || 1, premium: !!meMeta.premium, avatarKey: meMeta.avatarKey || null },
        opp: { name: `${t('ai')} · ${t('lvl' + S.level)}`, id: 7 + S.level, ai: true },
      };
    }
    if (S.kind === 'spectate') {
      const g = S.game || {};
      const w = g.white || {}, b = g.black || {};
      return {
        me: { name: w.name || t('white'), id: w.id || 1, online: w.online, premium: !!w.premium, avatarKey: w.avatarKey || null },
        opp: { name: b.name || t('black'), id: b.id || 2, online: b.online, premium: !!b.premium, avatarKey: b.avatarKey || null },
      };
    }
    const g = S.game; const o = g.opponent || {};
    const waitingFriend = g && g.mode === 'friend' && g.status === 'open' && !o.id;
    return {
      me: {
        name: meName(), id: meMeta.id || 1,
        premium: !!meMeta.premium, avatarKey: meMeta.avatarKey || null,
      },
      opp: {
        name: o.name || (waitingFriend ? t('friend_slot') : '…'),
        id: o.id || 0, online: o.online,
        premium: !!o.premium, avatarKey: o.avatarKey || null,
      },
    };
  }

  function sideClock(side) {
    const g = S.game;
    if (!g || !g.clock) return null;
    if (g.status === 'open' || g.status === 'invited') {
      const base = g.clock.initialMs;
      const inc = g.clock.incrementMs || 0;
      return formatClock(base) + (inc ? `+${inc / 1000}` : '');
    }
    return formatClock(remainingMs(g.clock, side, g.turn, g.status));
  }

  function fillBar(b, p, colour, cap, ai) {
    b.av.replaceChildren(ai
      ? h('div.avatar.ai', icon('ai', 22))
      : avBlock(p.name, p.id, {
        premium: !!p.premium,
        online: !!p.online,
        round: true,
        avatarKey: p.avatarKey || null,
      }));
    b.name.textContent = p.name;
    const clock = sideClock(colour);
    const ms = S.game && S.game.clock && S.game.status === 'active'
      ? remainingMs(S.game.clock, colour, S.game.turn, S.game.status) : null;
    if (clock != null) {
      const cat = categoryOf((S.game && S.game.timeControl) || 'classic');
      const low = ms != null && ms <= 20000;
      b.sub.replaceChildren(h('span.pclk.' + cat + (low ? '.low' : ''), clock));
    } else {
      b.sub.textContent = colour === 'w' ? t('white') : t('black');
    }
    b.el.classList.toggle('low', ms != null && ms <= 20000);
    b.cap.replaceChildren(...cap.lost[colour === 'w' ? 'b' : 'w'].map((k) => h('span.cp', { html: pieceSvg(colour === 'w' ? 'b' : 'w', k) })));
    const diff = (colour === 'w' ? 1 : -1) * cap.score;
    b.mat.textContent = diff > 0 ? `+${diff}` : '';
  }

  function paintChat() {
    const meId = S.meta.me && S.meta.me.id;
    chatLog.replaceChildren(...S.chat.map((m) => h('div.gchat-row' + (m.by === meId ? '.me' : ''),
      h('span.who', m.name || '?'),
      h('span.msg', m.text))));
    chatLog.scrollTop = chatLog.scrollHeight;
    chatPanel.hidden = !S.chatOpen;
  }
  function sendChat() {
    if (S.kind !== 'online' || S.over || !S.game || S.game.status !== 'active') return;
    const text = String(chatInput.value || '').trim().slice(0, 120);
    if (!text) return;
    chatInput.value = '';
    const me = S.meta.me || {};
    const local = { by: me.id, name: me.name || t('you'), text };
    S.chat.push(local);
    if (S.chat.length > 40) S.chat.shift();
    paintChat();
    api('POST', `/games/${S.id}/chat`, { text }).catch(() => {});
  }
  function toggleChat() {
    if (S.kind !== 'online') return;
    S.chatOpen = !S.chatOpen;
    if (S.chatOpen) reactBar.hidden = true;
    paintChat();
    haptic('select');
    if (S.chatOpen) setTimeout(() => chatInput.focus(), 50);
  }

  function paintSideClock(el, side) {
    const text = sideClock(side);
    if (text == null) return;
    const ms = remainingMs(S.game.clock, side, S.game.turn, S.game.status);
    const cat = categoryOf(S.game.timeControl || 'classic');
    const low = ms != null && ms <= 20000;
    let span = el.querySelector('.pclk');
    if (!span) {
      span = h('span.pclk.' + cat + (low ? '.low' : ''), text);
      el.replaceChildren(span);
    } else {
      span.textContent = text;
      span.className = 'pclk ' + cat + (low ? ' low' : '');
    }
  }

  function syncClocks() {
    if (!ctx || ctx !== S || (S.kind !== 'online' && S.kind !== 'spectate') || !S.game || !S.game.clock || S.over) return;
    if (S.game.status !== 'active') return;
    const ori = orientation();
    const oppCol = S.colour === 'w' ? 'b' : 'w';
    const topIsOpp = ori === S.colour;
    const topSide = topIsOpp ? oppCol : S.colour;
    const botSide = topIsOpp ? S.colour : oppCol;
    paintSideClock(top.sub, topSide);
    paintSideClock(bot.sub, botSide);
    const topMs = remainingMs(S.game.clock, topSide, S.game.turn, S.game.status);
    const botMs = remainingMs(S.game.clock, botSide, S.game.turn, S.game.status);
    top.el.classList.toggle('low', topMs != null && topMs <= 20000);
    bot.el.classList.toggle('low', botMs != null && botMs <= 20000);
    if (S.kind === 'online' && !S.flagClaimed && (topMs === 0 || botMs === 0)) {
      S.flagClaimed = true;
      api('POST', `/games/${S.id}/flag`).then((r) => applyServer(r.game, true)).catch(() => { S.flagClaimed = false; });
    }
  }

  function armClock() {
    clearInterval(S.clockTimer);
    S.clockTimer = null;
    if ((S.kind !== 'online' && S.kind !== 'spectate') || !S.game || !S.game.clock || S.game.status !== 'active' || S.over) return;
    S.clockTimer = setInterval(syncClocks, gameClockTickMs());
    syncClocks();
  }

  function render(animate = boardAnimateDefault()) {
    const { me, opp } = names();
    const c = S.chess; const cap = captured(c);
    const ori = orientation();
    const lastMoves = c.history({ verbose: true }); const lm = lastMoves[lastMoves.length - 1];
    const myTurn = S.kind === 'ai' ? (!S.over && !S.thinking && c.turn() === S.colour)
      : S.kind === 'spectate' ? false
      : (!S.busy && S.game.status === 'active' && S.game.you && c.turn() === S.game.you);
    // Bullet 1+0: Chess.com premoves while waiting for opponent
    const premoveOk = S.kind === 'online' && !S.over && S.game && S.game.status === 'active'
      && S.game.timeControl === '1+0' && !!S.colour;
    const mine = S.kind === 'spectate' ? null
      : (S.over ? null : (myTurn || premoveOk ? S.colour : null));
    board.set(c, {
      lastMove: lm ? { from: lm.from, to: lm.to } : null,
      orientation: ori,
      mine,
      animate,
      premoveEnabled: premoveOk && !myTurn,
    });
    const oppCol = S.colour === 'w' ? 'b' : 'w';
    const topIsOpp = ori === S.colour;
    fillBar(topIsOpp ? top : bot, opp, oppCol, cap, opp.ai);
    fillBar(topIsOpp ? bot : top, me, S.colour, cap, false);
    paintSpectators();
    top.el.classList.toggle('turn', !S.over && c.turn() === (topIsOpp ? oppCol : S.colour));
    bot.el.classList.toggle('turn', !S.over && c.turn() === (topIsOpp ? S.colour : oppCol));

    if (S.kind === 'ai') title.textContent = t('vs_ai');
    else if (S.kind === 'spectate') title.textContent = `${me.name} – ${opp.name}`;
    else title.textContent = S.game.status === 'active' || S.game.status === 'finished' ? opp.name : t('new_game');
    // status line
    let st = '';
    if (S.over) st = '';
    else if (S.kind === 'spectate') st = t('watching');
    else if (S.kind === 'online' && S.game.status !== 'active') st = '';
    else if (S.thinking) st = t('thinking');
    else if (myTurn) st = c.inCheck() ? t('check') : t('your_move');
    else st = t('opp_move', { name: opp.name });
    status.textContent = st; status.classList.toggle('alert', c.inCheck() && !S.over);

    const san = c.history(); moveStrip.replaceChildren(...san.map((m, i) => h('span' + (i === san.length - 1 ? '.cur' : ''), i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)));
    moveStrip.scrollLeft = moveStrip.scrollWidth;
    renderActions(); renderBanner();
    armClock();
  }

  function renderBanner() {
    banner.hidden = true; banner.replaceChildren();
    banner.classList.remove('wait', 'draw');
    const g = S.game;
    if (S.kind === 'online' && g) {
      if (g.status === 'open' || g.status === 'invited') {
        banner.hidden = false; banner.classList.add('wait');
        const meId = S.meta && S.meta.me ? S.meta.me.id : null;
        // Referral link (startapp=i…) pays diamonds; joiner auto-joins open friend board
        const link = (S.meta.botUsername && meId)
          ? `https://t.me/${S.meta.botUsername}?startapp=i${meId}`
          : '';
        const shareFriend = async () => {
          if (!link) return toast(t('e_server'), true);
          shareUrl(link, t('share_text'));
        };
        const copyFriend = async () => {
          if (!link) return toast(t('e_server'), true);
          if (await copyText(link)) toast(t('link_copied'));
        };
        const tcHint = g.timeControl && g.timeControl !== 'classic' ? ` · ${g.timeControl}` : '';
        const iAmCreator = meId != null && Number(g.creator) === Number(meId);
        const iAmInvitee = g.status === 'invited' && !iAmCreator;
        banner.append(
          h('b', iAmInvitee
            ? t('invites')
            : (g.status === 'invited' ? t('wait_invite', { name: (g.opponent || {}).name || '' }) : (g.mode === 'online' ? t('searching') : t('wait_friend')))),
          h('small', (iAmInvitee
            ? ((g.opponent || {}).name || '')
            : (g.status === 'invited' ? t('wait_invite_sub') : (g.mode === 'online' ? t('searching_sub') : t('wait_friend_sub')))) + tcHint),
          h('div.row2',
            iAmInvitee ? h('button.btn.sm', {
              onclick: async () => {
                try {
                  const r = await api('POST', `/games/${g.id}/join`);
                  S.game = r.game; render(true);
                } catch (e) { fail(e); closeGame(); }
              },
            }, t('accept')) : null,
            iAmInvitee ? h('button.btn.sm.ghost', {
              onclick: async () => {
                try { await api('POST', `/games/${g.id}/decline`); } catch (e) { return fail(e); }
                closeGame();
              },
            }, t('decline')) : null,
            !iAmInvitee && g.mode === 'friend' && g.status === 'open' ? h('button.btn.sm', { onclick: shareFriend }, icon('share', 18), t('share_link')) : null,
            !iAmInvitee && g.mode === 'friend' && g.status === 'open' ? h('button.btn.sm.ghost', { onclick: copyFriend }, icon('link', 18), t('copy_link')) : null,
            !iAmInvitee ? h('button.btn.sm.ghost', { onclick: async () => { try { await api('DELETE', `/games/${g.id}`); } catch (e) { return fail(e); } closeGame(); } }, t('cancel')) : null),
        );
      } else if (g.status === 'active' && g.drawBy && g.drawBy !== g.you) {
        banner.classList.remove('wait'); banner.classList.add('draw'); banner.hidden = false;
        banner.append(
          h('b', t('draw_received', { name: (g.opponent || {}).name || '' })),
          h('small', t('draw_received_sub')),
        );
      } else if (g.status === 'active' && g.drawBy === g.you) {
        banner.classList.remove('wait'); banner.classList.remove('draw'); banner.hidden = false;
        banner.append(h('b', t('draw_sent')), h('small', t('draw_sent_sub')));
      }
    }
  }

  function renderActions() {
    actions.replaceChildren();
    reactBar.hidden = true;
    if (S.over || (S.game && S.game.status === 'finished')) {
      S.chatOpen = false;
      chatPanel.hidden = true;
      S.chat = [];
    } else {
      chatPanel.hidden = !S.chatOpen;
    }
    const live = !S.over && (S.kind === 'ai' || (S.game && S.game.status === 'active'));
    const drawIn = S.kind === 'online' && live && S.game.drawBy && S.game.drawBy !== S.game.you;
    const drawOut = S.kind === 'online' && live && S.game.drawBy === S.game.you;
    if (drawIn) {
      // Accept / Decline live in the bottom bar so they stay visible and do not clash with "Offer draw"
      actions.append(
        act('check', t('accept'), () => drawAction('accept')),
        act('x', t('decline'), () => drawAction('decline')),
        act('flag', t('resign'), resign),
      );
    } else if (S.kind === 'ai' && live) {
      if (S.allowUndo) actions.append(act('undo', t('undo'), undo));
      actions.append(
        act('flag', t('resign'), resign),
        act('smile', '', toggleReact),
        act('globe', t('hint'), hint),
      );
    } else if (S.kind === 'online' && live) {
      if (!drawOut) actions.append(act('handshake', t('offer_draw'), () => drawAction('offer')));
      actions.append(act('flag', t('resign'), resign), act('chat', t('game_chat'), toggleChat), act('smile', '', toggleReact));
    } else if (S.kind === 'spectate') {
      // view-only: no actions
    } else if (S.over || (S.game && S.game.status === 'finished')) {
      actions.append(act('smile', '', toggleReact));
    }
  }

  function toggleReact() {
    if (!reactBar.children.length) {
      for (const e of S.meta.reactions) reactBar.append(h('button', { onclick: (ev) => react(e, ev.currentTarget) }, e));
    }
    reactBar.hidden = !reactBar.hidden;
    if (!reactBar.hidden) { S.chatOpen = false; chatPanel.hidden = true; }
    haptic('select');
  }
  function react(emoji, el) {
    const r = el.getBoundingClientRect();
    floatEmoji(emoji, r.left + r.width / 2, r.top);
    haptic('light');
    if (S.kind === 'online') api('POST', `/games/${S.id}/react`, { emoji }).catch(() => {});
    else if (!S.emoteT) S.emoteT = setTimeout(() => { S.emoteT = null; const b = top.av.getBoundingClientRect(); floatEmoji(EMOTES[Math.floor(Math.random() * EMOTES.length)], b.left + 20, b.bottom); }, 900);
  }

  // ----- moves -----
  async function humanMove(from, to, promotion) {
    if (S.over || S.kind === 'spectate' || S.busy || S.thinking) return;
    if (isMoveSoundOn()) unlockAudio(); // ensure Telegram WebView allows sound on this gesture
    if (S.kind === 'ai') {
      try { S.chess.move({ from, to, promotion }); } catch { return render(); }
      playMoveSound();
      S.moves.push([from, to, promotion]); afterMove(true);
    } else {
      const before = S.chess.fen();
      try { S.chess.move({ from, to, promotion }); } catch { return render(); }
      playMoveSound();
      S.busy = true;
      render(); // lock board while waiting for server (Chess.com-style)
      try {
        const r = await api('POST', `/games/${S.id}/move`, { from, to, promotion });
        S.busy = false;
        applyServer(r.game);
      } catch (e) {
        S.busy = false;
        fail(e);
        try { applyServer((await api('GET', `/games/${S.id}`)).game, true); }
        catch { S.chess = new Chess(before); render(false); }
      }
    }
  }

  function afterMove(human) {
    S.thinking = false;
    const over = checkEnd();
    render();
    if (S.kind === 'ai') {
      saveAi(S.over ? null : {
        moves: S.moves, level: S.level, colour: S.colour, allowUndo: !!S.allowUndo,
      });
    }
    if (!over && S.kind === 'ai' && S.chess.turn() !== S.colour) aiTurn();
    void human;
  }

  function checkEnd() {
    const c = S.chess;
    if (S.kind !== 'ai' || !c.isGameOver()) return false;
    S.over = true;
    let outcome = 'draw', reason = 'stalemate';
    if (c.isCheckmate()) { outcome = c.turn() === S.colour ? 'loss' : 'win'; reason = 'checkmate'; }
    else if (c.isInsufficientMaterial()) reason = 'insufficient';
    else if (c.isThreefoldRepetition()) reason = 'repetition';
    else if (typeof c.isDrawByFiftyMoves === 'function' ? c.isDrawByFiftyMoves() : (c.isDraw() && !c.isStalemate())) reason = 'fifty';
    else if (c.isStalemate()) reason = 'stalemate';
    saveAi(null);
    // Vs-computer never updates server stats / Elo
    setTimeout(() => { render(); showResult(outcome, reason); }, 650);
    return true;
  }

  async function aiTurn() {
    S.thinking = true; render(false);
    const token = S.token = {};
    const t0 = Date.now();
    // Pause after the player moves (2s total, including engine time)
    const thinkMs = 2000;
    const seen = []; { const c = new Chess(); seen.push(c.fen()); for (const [f, to, p] of S.moves) { c.move({ from: f, to, promotion: p }); seen.push(c.fen()); } }
    let mv = null;
    try { mv = await askEngine(S.chess.fen(), S.level, seen); } catch { mv = null; }
    await sleep(Math.max(0, thinkMs - (Date.now() - t0)));
    if (S.token !== token || ctx !== S) return; // game closed or undone meanwhile
    S.thinking = false;
    if (!mv) { const all = S.chess.moves({ verbose: true }); if (!all.length) return afterMove(false); const m = all[Math.floor(Math.random() * all.length)]; mv = { from: m.from, to: m.to, promotion: m.promotion }; }
    S.chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    S.moves.push([mv.from, mv.to, mv.promotion]);
    playMoveSound();
    haptic('light'); afterMove(false);
  }

  function undo() {
    if (!S.allowUndo || S.thinking || S.over || S.moves.length === 0) return;
    const n = S.chess.turn() === S.colour ? 2 : 1;
    for (let i = 0; i < n && S.moves.length; i++) { S.moves.pop(); }
    S.chess = build(S.moves); S.token = null; haptic('select');
    render(); saveAi({ moves: S.moves, level: S.level, colour: S.colour, allowUndo: !!S.allowUndo });
  }
  async function hint() {
    if (S.thinking || S.over || S.chess.turn() !== S.colour) return;
    haptic('select');
    const mv = await askEngine(S.chess.fen(), 3, [], 500);
    if (mv && ctx === S) board.showHint(mv);
  }
  async function resign() {
    if (!(await confirmSheet(t('resign_confirm'), t('resign'), true))) return;
    if (S.kind === 'ai') { S.over = true; S.token = null; saveAi(null); render(); showResult('loss', 'resign'); }
    else try { applyServer((await api('POST', `/games/${S.id}/resign`)).game); } catch (e) { fail(e); }
  }
  async function drawAction(action) {
    try { applyServer((await api('POST', `/games/${S.id}/draw`, { action })).game); if (action === 'offer') toast(t('draw_sent')); } catch (e) { fail(e); }
  }

  function winnerHeadline(outcome) {
    const g = S.game || {};
    const wName = (g.white && g.white.name) || t('white');
    const bName = (g.black && g.black.name) || t('black');
    const res = g.result || '';
    if (res === '1-0') return t('analyze_winner', { name: wName });
    if (res === '0-1') return t('analyze_winner', { name: bName });
    if (outcome === 'win') return t('you_won');
    if (outcome === 'loss') return t('you_lost');
    return t('draw_title');
  }

  function paintSpectators() {
    const n = Number(S.spectators || (S.game && S.game.spectators) || 0);
    // Show viewer count on the local player's bar (online games only)
    const bar = bot;
    let el = bar.el.querySelector('.spectators');
    if (S.kind === 'online' && n > 0 && !S.over) {
      if (!el) {
        el = h('span.spectators', icon('eye', 14), h('b', '0'));
        bar.name.after(el);
      }
      const b = el.querySelector('b');
      if (b) b.textContent = String(n);
    } else if (el) el.remove();
  }

  function showResult(outcome, reason) {
    const when = formatTashkentWhen((S.game && S.game.updatedAt) || new Date().toISOString());
    const whenEl = when ? h('p.result-when', when) : null;
    const onlineAnalyze = S.kind === 'online' && S.id
      ? h('button.btn', {
        onclick: () => {
          openGameAnalysis({
            id: S.id,
            moves: S.moves,
            white: S.game.white,
            black: S.game.black,
            you: S.game.you,
            result: S.game.result,
          });
        },
      }, icon('sparkles', 18), t('analyze'))
      : null;
    // onlineAnalyze used below; AI has its own analyze button
    if (S.kind === 'spectate') {
      haptic('light');
      const res = (S.game && S.game.result) || '½-½';
      sheet((close) => [
        h('div.result',
          h('div.result-emoji', '♟'),
          h('h2', winnerHeadline('draw')),
          h('p.muted', t('result_label', { r: res })),
          h('p.muted', t(reasonKey(reason))),
          whenEl),
        h('button.btn.ghost', { onclick: () => { close(); closeGame(); } }, t('close')),
      ]);
      return;
    }
    if (outcome === 'win') { rain(); haptic('success'); } else haptic(outcome === 'loss' ? 'error' : 'warning');
    const ttl = winnerHeadline(outcome);
    const emo = outcome === 'win' ? '🏆' : outcome === 'loss' ? '🤝' : '🤝';
    sheet((close) => [
      h('div.result', h('div.result-emoji', emo), h('h2', ttl), h('p.muted', t(reasonKey(reason))), whenEl),
      onlineAnalyze,
      S.kind === 'ai' ? h('button.btn', {
        onclick: () => openGameAnalysis({
          id: 'ai-local',
          moves: S.moves,
          white: S.colour === 'w' ? { name: (S.meta.me && S.meta.me.name) || 'You' } : { name: t('ai') },
          black: S.colour === 'b' ? { name: (S.meta.me && S.meta.me.name) || 'You' } : { name: t('ai') },
          result: outcome === 'win' ? (S.colour === 'w' ? '1-0' : '0-1') : outcome === 'loss' ? (S.colour === 'w' ? '0-1' : '1-0') : '1/2-1/2',
        }),
      }, icon('ai', 18), t('analyze')) : null,
      S.kind === 'ai' ? h('button.btn', { onclick: () => { close(); const o = { kind: 'ai', level: S.level, colour: S.colour === 'w' ? 'b' : 'w', meta: S.meta }; const cb = S.onClose, st = S.onStats; openGame(o, cb); ctx.onStats = st; } }, t('play_again')) : null,
      S.kind === 'online' && S.game.opponent ? h('button.btn', { onclick: async () => { close(); try { const r = await api('POST', '/games', { opponentId: S.game.opponent.id, timeControl: S.game.timeControl || 'classic' }); closeNow(); openGame({ kind: 'online', game: r.game, meta: S.meta }, S.onClose); } catch (e) { fail(e); } } }, t('rematch')) : null,
      h('button.btn.ghost', { onclick: () => { close(); closeGame(); } }, t('close')),
    ].filter(Boolean));
  }

  // ----- server updates (online) -----
  function applyServer(g, force) {
    if (!ctx || ctx !== S || g.id !== S.id) return;
    S.busy = false;
    const prev = S.game; S.game = g;
    if (g.spectators != null) S.spectators = g.spectators;
    const moves = g.moves || [];
    if (S.kind !== 'spectate') S.colour = g.you || S.colour;
    const prevLen = S.moves.length;
    const grew = moves.length !== prevLen || force;
    const oppMoved = moves.length > prevLen && S.kind !== 'spectate' && prev && prev.status === 'active';
    S.moves = moves;
    if (grew) S.chess = build(moves);
    // Never play move sound while spectating
    if (oppMoved && S.kind !== 'spectate' && S.chess.turn() === S.colour) playMoveSound();
    const was = prev && prev.status;
    if (g.status === 'finished' && was !== 'finished') {
      S.over = true; S.chat = []; S.chatOpen = false; board.clearPremove(); render(grew);
      const outcome = S.kind === 'spectate' ? 'draw'
        : g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === (g.you === 'w') ? 'win' : 'loss';
      setTimeout(() => showResult(outcome, g.reason), 500);
      return;
    }
    if (g.status === 'cancelled' && was !== 'cancelled') {
      if (S.kind === 'spectate') { toast(t('game_ended'), true); closeGame(); return; }
      toast(was === 'invited' ? t('challenge_expired') : t('opponent_left'), true); closeGame(); return;
    }
    if (S.kind !== 'spectate' && g.status === 'active' && was !== 'active') {
      const tc = isTimed(g.timeControl) ? ` · ${g.timeControl}` : '';
      toast(t('you_are', { c: g.you === 'w' ? t('white') : t('black') }) + tc);
      haptic('success');
      S.flagClaimed = false;
    }
    S.over = g.status === 'finished';
    render(grew);
    // Fire queued premove when it becomes our turn (1+0 Chess.com rules)
    if (S.kind === 'online' && !S.over && g.status === 'active' && S.chess.turn() === S.colour && !S.busy) {
      const pm = board.takePremove();
      if (pm) {
        try {
          S.chess.move({ from: pm.from, to: pm.to, promotion: pm.promotion });
          S.chess.undo();
          setTimeout(() => { if (ctx === S) humanMove(pm.from, pm.to, pm.promotion); }, 30);
        } catch { board.clearPremove(); }
      }
    }
  }
  S.unsub = onWs((m) => {
    if (ctx !== S) return;
    if (S.kind === 'online') {
      if (m.t === 'game' && m.game.id === S.id) applyServer(m.game);
      else if (m.t === 'spectators' && m.id === S.id) { S.spectators = m.count || 0; paintSpectators(); }
      else if (m.t === 'react' && m.id === S.id) { const b = top.av.getBoundingClientRect(); floatEmoji(m.emoji, b.left + 24, b.bottom); haptic('light'); }
      else if (m.t === 'chat' && m.id === S.id && !S.over) {
        const meId = S.meta.me && S.meta.me.id;
        if (m.by === meId) return;
        S.chat.push({ by: m.by, name: m.name || '…', text: m.text });
        if (S.chat.length > 40) S.chat.shift();
        if (!S.chatOpen) S.chatOpen = true;
        paintChat();
        haptic('light');
      }
      else if (m.t === 'hello') api('GET', `/games/${S.id}`).then((r) => applyServer(r.game, true)).catch(() => {});
    }
  });

  S.render = render;
  if (S.kind === 'ai') {
    if (opts.resume) {
      S.moves = opts.resume.moves;
      S.chess = build(S.moves);
      if (opts.resume.allowUndo != null) S.allowUndo = !!opts.resume.allowUndo;
    }
    S.colour = opts.colour || 'w'; S.chess = build(S.moves); render(false);
    if (S.chess.turn() !== S.colour) aiTurn();
  } else if (S.kind === 'spectate') {
    S.moves = opts.game.moves || []; S.chess = build(S.moves); S.colour = 'w';
    S.over = opts.game.status === 'finished'; render(false);
    S.poll = setInterval(() => {
      if (ctx !== S || S.over) return;
      api('GET', `/live/games/${S.id}`).then((r) => applyServer(r.game)).catch(() => {});
    }, liveGamePollMs());
  } else { S.moves = opts.game.moves || []; S.chess = build(S.moves); S.colour = opts.game.you || 'w'; S.over = opts.game.status === 'finished'; render(false); }

  root.classList.add('show'); root.removeAttribute('aria-hidden');
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.BackButton) { try { const bb = window.Telegram.WebApp.BackButton; bb.onClick(closeGame); bb.show(); } catch { /* old client */ } }
  return S;
}

function closeNow() {
  if (!ctx) return;
  if (ctx.unsub) ctx.unsub();
  clearInterval(ctx.clockTimer);
  clearInterval(ctx.poll);
  ctx.token = null; clearTimeout(ctx.emoteT);
  ctx.chat = []; ctx.chatOpen = false;
  try { if (ctx.board) ctx.board.destroy(); } catch { /* ignore */ }
  ctx.board = null;
  const root = $('#game');
  root.classList.remove('show'); root.setAttribute('aria-hidden', 'true');
  try { const bb = window.Telegram.WebApp.BackButton; bb.offClick(closeGame); bb.hide(); } catch { /* ignore */ }
  const cb = ctx.onClose; ctx = null;
  setTimeout(() => { if (!ctx) root.replaceChildren(); }, 520);
  return cb;
}
export function closeGame() { const cb = closeNow(); if (cb) cb(); }
