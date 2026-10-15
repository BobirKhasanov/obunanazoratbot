/** Free cartoon character avatars. Keys: char:<id> */

const CHARS = [
  { id: 'jimmy', name: 'Jimmy', bg: '#5b8a6e', skin: '#e8b898', hair: '#3b2414', shirt: '#3b7dd8', style: 'short' },
  { id: 'maya', name: 'Maya', bg: '#6b7bb8', skin: '#c68642', hair: '#1a1a1a', shirt: '#e85d75', style: 'long' },
  { id: 'leo', name: 'Leo', bg: '#c4a35a', skin: '#f1c27d', hair: '#5c3317', shirt: '#2d6a4f', style: 'side' },
  { id: 'nina', name: 'Nina', bg: '#8b6b9e', skin: '#ffdbac', hair: '#8b4513', shirt: '#f4a261', style: 'bun' },
  { id: 'omar', name: 'Omar', bg: '#4a7c9b', skin: '#8d5524', hair: '#1c1c1c', shirt: '#e9c46a', style: 'short' },
  { id: 'sara', name: 'Sara', bg: '#b86b6b', skin: '#e0ac69', hair: '#2c1810', shirt: '#264653', style: 'long' },
  { id: 'kai', name: 'Kai', bg: '#5a8f7b', skin: '#f5d0c5', hair: '#111111', shirt: '#e76f51', style: 'spiky' },
  { id: 'lina', name: 'Lina', bg: '#7a8f5a', skin: '#d4a574', hair: '#4a2040', shirt: '#9b5de5', style: 'bob' },
  { id: 'rex', name: 'Rex', bg: '#6d6d8a', skin: '#c68642', hair: '#3d2314', shirt: '#118ab2', style: 'bald' },
  { id: 'zoe', name: 'Zoe', bg: '#a67c5d', skin: '#ffdbac', hair: '#1a0a00', shirt: '#06d6a0', style: 'afro' },
  { id: 'sam', name: 'Sam', bg: '#5c7a9a', skin: '#e8b898', hair: '#654321', shirt: '#ef476f', style: 'short' },
  { id: 'aria', name: 'Aria', bg: '#9a6b8a', skin: '#f1c27d', hair: '#2b1d0e', shirt: '#073b4c', style: 'long' },
  { id: 'ben', name: 'Ben', bg: '#7b8f6b', skin: '#8d5524', hair: '#0d0d0d', shirt: '#ffd166', style: 'side' },
  { id: 'eva', name: 'Eva', bg: '#8a6b7b', skin: '#ffdbac', hair: '#5c4033', shirt: '#118ab2', style: 'bun' },
  { id: 'max', name: 'Max', bg: '#6b8a9a', skin: '#e0ac69', hair: '#1c1410', shirt: '#06d6a0', style: 'spiky' },
  { id: 'ira', name: 'Ira', bg: '#9a7b5a', skin: '#c68642', hair: '#3b2414', shirt: '#e85d75', style: 'bob' },
  { id: 'tom', name: 'Tom', bg: '#5a7b8a', skin: '#f5d0c5', hair: '#4a3728', shirt: '#3b7dd8', style: 'short' },
  { id: 'yuki', name: 'Yuki', bg: '#7b6b9a', skin: '#ffdbac', hair: '#1a1a1a', shirt: '#f4a261', style: 'long' },
  { id: 'ned', name: 'Ned', bg: '#6b9a7b', skin: '#d4a574', hair: '#2c1810', shirt: '#9b5de5', style: 'side' },
  { id: 'pia', name: 'Pia', bg: '#9a6b6b', skin: '#e8b898', hair: '#8b4513', shirt: '#2d6a4f', style: 'afro' },
];

const BY_ID = new Map(CHARS.map((c) => [c.id, c]));

function hairPaths(style, color) {
  switch (style) {
    case 'long':
      return `<ellipse cx="64" cy="38" rx="36" ry="28" fill="${color}"/><path d="M30 48 Q28 110 34 128 H94 Q100 110 98 48" fill="${color}"/>`;
    case 'bun':
      return `<ellipse cx="64" cy="40" rx="34" ry="26" fill="${color}"/><circle cx="64" cy="18" r="14" fill="${color}"/>`;
    case 'side':
      return `<path d="M28 55 Q30 28 64 22 Q98 28 100 55 Q90 38 64 36 Q38 38 28 55Z" fill="${color}"/><path d="M28 55 Q22 80 30 100 Q36 70 40 55Z" fill="${color}"/>`;
    case 'spiky':
      return `<path d="M32 58 L28 22 L44 40 L52 18 L64 38 L76 16 L84 40 L100 20 L96 58 Q64 30 32 58Z" fill="${color}"/>`;
    case 'bob':
      return `<ellipse cx="64" cy="42" rx="35" ry="28" fill="${color}"/><path d="M29 50 Q26 85 38 95 H90 Q102 85 99 50" fill="${color}"/>`;
    case 'afro':
      return `<circle cx="64" cy="42" r="42" fill="${color}"/>`;
    case 'bald':
      return '';
    default: // short
      return `<path d="M30 58 Q32 26 64 22 Q96 26 98 58 Q88 40 64 38 Q40 40 30 58Z" fill="${color}"/>`;
  }
}

function renderCharSvg(c) {
  const hair = hairPaths(c.style, c.hair);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="${c.bg}"/>
  <ellipse cx="64" cy="118" rx="40" ry="28" fill="${c.shirt}"/>
  <ellipse cx="64" cy="62" rx="28" ry="32" fill="${c.skin}"/>
  ${hair}
  <ellipse cx="52" cy="60" rx="3.2" ry="4" fill="#1e293b"/>
  <ellipse cx="76" cy="60" rx="3.2" ry="4" fill="#1e293b"/>
  <path d="M54 76 Q64 84 74 76" fill="none" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="44" cy="68" rx="5" ry="3" fill="${c.skin}" opacity=".35"/>
  <ellipse cx="84" cy="68" rx="5" ry="3" fill="${c.skin}" opacity=".35"/>
</svg>`;
}

function listCharAvatars() {
  return CHARS.map((c) => ({
    id: c.id,
    name: c.name,
    key: `char:${c.id}`,
    url: `/api/char-avatars/${c.id}.svg`,
  }));
}

function isCharAvatarKey(key) {
  const m = /^char:([a-z0-9_-]+)$/i.exec(String(key || ''));
  return m && BY_ID.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

function charAvatarSvg(id) {
  const c = BY_ID.get(String(id || '').toLowerCase());
  return c ? renderCharSvg(c) : null;
}

module.exports = { listCharAvatars, isCharAvatarKey, charAvatarSvg, CHAR_IDS: CHARS.map((c) => c.id) };
