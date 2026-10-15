/**
 * Free character avatars from the shipped PNG set (public/img/char-avatars/).
 * Keys stay `char:<id>` so existing user picks keep working.
 */

const MALE = [
  { id: 'rex', name: 'Rex' },
  { id: 'kai', name: 'Kai' },
  { id: 'leo', name: 'Leo' },
  { id: 'ned', name: 'Ned' },
  { id: 'tom', name: 'Tom' },
  { id: 'omar', name: 'Omar' },
  { id: 'sam', name: 'Sam' },
  { id: 'max', name: 'Max' },
  { id: 'ben', name: 'Ben' },
  { id: 'jimmy', name: 'Jimmy' },
  { id: 'wolf', name: 'Wolf' },
  { id: 'ninja', name: 'Ninja' },
  { id: 'bridge', name: 'Bridge' },
  { id: 'neon', name: 'Neon' },
  { id: 'crown', name: 'Crown' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'shades', name: 'Shades' },
  { id: 'king', name: 'King' },
  { id: 'forest', name: 'Forest' },
  { id: 'beanie', name: 'Beanie' },
];

const FEMALE = [
  { id: 'maya', name: 'Maya' },
  { id: 'aria', name: 'Aria' },
  { id: 'nina', name: 'Nina' },
  { id: 'lina', name: 'Lina' },
  { id: 'sara', name: 'Sara' },
  { id: 'zoe', name: 'Zoe' },
  { id: 'yuki', name: 'Yuki' },
  { id: 'ira', name: 'Ira' },
  { id: 'pia', name: 'Pia' },
  { id: 'eva', name: 'Eva' },
  { id: 'nova', name: 'Nova' },
  { id: 'mask', name: 'Mask' },
  { id: 'frost', name: 'Frost' },
  { id: 'pulse', name: 'Pulse' },
  { id: 'queen', name: 'Queen' },
  { id: 'tower', name: 'Tower' },
  { id: 'sky', name: 'Sky' },
  { id: 'rook', name: 'Rook' },
  { id: 'pine', name: 'Pine' },
  { id: 'gothic', name: 'Gothic' },
];

const CHARS = [...MALE, ...FEMALE];
const BY_ID = new Map(CHARS.map((c) => [c.id, c]));
const CHAR_IDS = CHARS.map((c) => c.id);

/** Cache-bust when art sheets are replaced. */
const ASSET_V = '4';

function charAvatarUrl(id) {
  return `/img/char-avatars/${encodeURIComponent(id)}.png?v=${ASSET_V}`;
}

function listCharAvatars() {
  return CHARS.map((c) => ({
    id: c.id,
    name: c.name,
    key: `char:${c.id}`,
    url: charAvatarUrl(c.id),
    group: MALE.some((m) => m.id === c.id) ? 'm' : 'f',
  }));
}

function isCharAvatarKey(key) {
  const m = /^char:([a-z0-9_-]+)$/i.exec(String(key || ''));
  return m && BY_ID.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

function charAvatarExists(id) {
  return BY_ID.has(String(id || '').toLowerCase());
}

module.exports = {
  listCharAvatars,
  isCharAvatarKey,
  charAvatarUrl,
  charAvatarExists,
  CHAR_IDS,
  ASSET_V,
};
