// Builds and sends admin posts: text + optional media + inline buttons with editable text and colour.
const { InputFile } = require('grammy');

// Bot API 9.4 lets an inline button carry a `style`. Telegram shows it as blue / green / red.
const STYLE = { primary: 'primary', success: 'success', danger: 'danger' };
const COLORS = ['default', 'primary', 'success', 'danger'];

/** Inline keyboard, one button per row. `plain` drops the colours (fallback for older Telegram servers). */
function buildMarkup(buttons, webAppUrl, plain = false) {
  if (!buttons || !buttons.length) return undefined;
  return {
    inline_keyboard: buttons.map((b) => {
      const btn = { text: b.text };
      if (b.type === 'app') btn.web_app = { url: webAppUrl };
      else btn.url = b.url;
      if (!plain && STYLE[b.color]) btn.style = STYLE[b.color];
      return [btn];
    }),
  };
}

const hasColours = (buttons) => (buttons || []).some((b) => STYLE[b.color]);

async function once(bot, chatId, post, plain) {
  const reply_markup = buildMarkup(post.buttons, post.webAppUrl, plain);
  const m = post.media;
  if (!m) return bot.api.sendMessage(chatId, post.text, { reply_markup, link_preview_options: { is_disabled: true } });
  const file = m.fileId || new InputFile(m.path);
  const opts = { caption: post.text || undefined, reply_markup };
  if (m.kind === 'photo') return bot.api.sendPhoto(chatId, file, opts);
  if (m.kind === 'animation') return bot.api.sendAnimation(chatId, file, opts);
  return bot.api.sendVideo(chatId, file, { ...opts, supports_streaming: true });
}

function fileIdOf(kind, res) {
  if (!res) return null;
  if (kind === 'photo' && Array.isArray(res.photo) && res.photo.length) return res.photo[res.photo.length - 1].file_id;
  if (kind === 'video' && res.video) return res.video.file_id;
  if (kind === 'animation' && res.animation) return res.animation.file_id;
  return null;
}

/**
 * Sends one post. The first media upload caches Telegram's file_id so the rest of the audience
 * reuses it instead of uploading the file again. If Telegram rejects the coloured buttons, the
 * post is re-sent once without colours, and later sends skip them.
 */
async function sendPost(bot, chatId, post) {
  let res;
  try {
    res = await once(bot, chatId, post, !!post.plain);
  } catch (e) {
    if (e.error_code === 400 && !post.plain && hasColours(post.buttons)) {
      post.plain = true;
      res = await once(bot, chatId, post, true);
    } else throw e;
  }
  if (post.media && !post.media.fileId) {
    const id = fileIdOf(post.media.kind, res);
    if (id) { post.media.fileId = id; if (post.onFileId) post.onFileId(id); }
  }
  return res;
}

module.exports = { sendPost, buildMarkup, COLORS };
