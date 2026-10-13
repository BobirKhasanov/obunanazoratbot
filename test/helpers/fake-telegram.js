// A tiny fake of the Telegram Bot API. The bot is pointed at it with TG_API_ROOT, so tests can
// see exactly which messages (and buttons) would have been sent, without touching the real Telegram.
const http = require('http');
const crypto = require('crypto');

function sign(user, token, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

function start() {
  const calls = [];
  const state = { rejectStyle: false, rejectEffect: false, fail403: new Set() };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const method = req.url.split('/').pop();
      const type = req.headers['content-type'] || '';
      let body = {};
      if (type.includes('json')) { try { body = JSON.parse(raw.toString()); } catch { /* ignore */ } }
      else body = { _raw: raw.toString('utf8'), _multipart: true };
      calls.push({ method, body });

      const reply = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const text = type.includes('json') ? raw.toString() : body._raw;
      const chat = Number(body.chat_id) || 0;

      if (state.fail403.has(chat)) return reply({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);
      if (state.rejectStyle && /"style"|name="reply_markup"[\s\S]*"style"/.test(text)) {
        return reply({ ok: false, error_code: 400, description: 'Bad Request: BUTTON_STYLE_INVALID' }, 400);
      }
      if (state.rejectEffect && body.message_effect_id) {
        return reply({ ok: false, error_code: 400, description: 'Bad Request: effect not available' }, 400);
      }
      if (method === 'getMe') return reply({ ok: true, result: { id: 99, is_bot: true, first_name: 'Chess', username: 'chess_test_bot', can_join_groups: true } });
      if (method === 'sendPhoto') return reply({ ok: true, result: { message_id: 1, chat: { id: chat }, date: 1, photo: [{ file_id: 'SMALL' }, { file_id: 'BIG_FILE_ID' }] } });
      if (method === 'sendVideo') return reply({ ok: true, result: { message_id: 1, chat: { id: chat }, date: 1, video: { file_id: 'VID_FILE_ID' } } });
      if (method === 'sendAnimation') return reply({ ok: true, result: { message_id: 1, chat: { id: chat }, date: 1, animation: { file_id: 'GIF_FILE_ID' } } });
      return reply({ ok: true, result: method.startsWith('send') ? { message_id: 1, chat: { id: chat }, date: 1, text: '' } : true });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
        state,
        close: () => server.close(),
        // messages sent to one chat, newest last
        to: (chatId, method = 'sendMessage') => calls.filter((c) => c.method === method && Number(c.body.chat_id) === chatId),
      });
    });
  });
}

module.exports = { start, sign };
