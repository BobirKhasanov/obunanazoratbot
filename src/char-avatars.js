/** Free cartoon character avatars (circular, Play-Bots style). Keys: char:<id> */

const CHARS = [
  { id: 'jimmy', name: 'Jimmy', bg: '#7cb8e8', skin: '#f0c9a6', hair: '#3d2314', shirt: '#3b82f6', style: 'short', eyes: 'normal' },
  { id: 'maya', name: 'Maya', bg: '#f0a8c8', skin: '#c68642', hair: '#1a1210', shirt: '#e11d48', style: 'long', eyes: 'lash' },
  { id: 'leo', name: 'Leo', bg: '#f5d06a', skin: '#f5d0a9', hair: '#6b3e1a', shirt: '#16a34a', style: 'side', eyes: 'normal' },
  { id: 'nina', name: 'Nina', bg: '#c4a0e8', skin: '#ffe0bd', hair: '#8b5a2b', shirt: '#f59e0b', style: 'bun', eyes: 'lash' },
  { id: 'omar', name: 'Omar', bg: '#6ec6c0', skin: '#8d5524', hair: '#1c1410', shirt: '#eab308', style: 'short', eyes: 'normal' },
  { id: 'sara', name: 'Sara', bg: '#f0a090', skin: '#e0ac69', hair: '#2c1810', shirt: '#0f766e', style: 'long', eyes: 'lash' },
  { id: 'kai', name: 'Kai', bg: '#8fd4a8', skin: '#f8d5c8', hair: '#222222', shirt: '#ea580c', style: 'spiky', eyes: 'happy' },
  { id: 'lina', name: 'Lina', bg: '#a8d080', skin: '#d4a574', hair: '#4a2040', shirt: '#7c3aed', style: 'bob', eyes: 'lash' },
  { id: 'rex', name: 'Rex', bg: '#9aa8c8', skin: '#c68642', hair: '#3d2314', shirt: '#0284c7', style: 'bald', eyes: 'normal', beard: true },
  { id: 'zoe', name: 'Zoe', bg: '#e8b878', skin: '#ffe0bd', hair: '#1a0a00', shirt: '#059669', style: 'afro', eyes: 'happy' },
  { id: 'sam', name: 'Sam', bg: '#7eb8d8', skin: '#f0c9a6', hair: '#5c4033', shirt: '#db2777', style: 'short', eyes: 'happy' },
  { id: 'aria', name: 'Aria', bg: '#d8a0c8', skin: '#f5d0a9', hair: '#2b1d0e', shirt: '#155e75', style: 'long', eyes: 'lash' },
  { id: 'ben', name: 'Ben', bg: '#90c890', skin: '#8d5524', hair: '#0d0d0d', shirt: '#ca8a04', style: 'side', eyes: 'normal' },
  { id: 'eva', name: 'Eva', bg: '#e0a8b8', skin: '#ffe0bd', hair: '#5c4033', shirt: '#0369a1', style: 'bun', eyes: 'lash' },
  { id: 'max', name: 'Max', bg: '#88c0d0', skin: '#e0ac69', hair: '#1c1410', shirt: '#16a34a', style: 'spiky', eyes: 'happy' },
  { id: 'ira', name: 'Ira', bg: '#e8c080', skin: '#c68642', hair: '#3b2414', shirt: '#e11d48', style: 'bob', eyes: 'lash' },
  { id: 'tom', name: 'Tom', bg: '#78b0c8', skin: '#f8d5c8', hair: '#4a3728', shirt: '#2563eb', style: 'short', eyes: 'normal' },
  { id: 'yuki', name: 'Yuki', bg: '#b8a0d8', skin: '#ffe0bd', hair: '#1a1a1a', shirt: '#f59e0b', style: 'long', eyes: 'lash' },
  { id: 'ned', name: 'Ned', bg: '#88c8a0', skin: '#d4a574', hair: '#2c1810', shirt: '#7c3aed', style: 'side', eyes: 'normal', glasses: true },
  { id: 'pia', name: 'Pia', bg: '#e8a0a0', skin: '#f0c9a6', hair: '#8b4513', shirt: '#15803d', style: 'afro', eyes: 'happy' },
];

const BY_ID = new Map(CHARS.map((c) => [c.id, c]));

function hairPaths(style, color) {
  switch (style) {
    case 'long':
      return `
        <path d="M28 52c2-22 18-34 36-34s34 12 36 34v8c-6-16-20-24-36-24S34 44 28 60z" fill="${color}"/>
        <path d="M28 58c-2 22 2 48 8 58h8c-4-14-6-36-4-52 6-4 16-6 32-6s26 2 32 6c2 16 0 38-4 52h8c6-10 10-36 8-58" fill="${color}"/>`;
    case 'bun':
      return `
        <ellipse cx="64" cy="40" rx="34" ry="24" fill="${color}"/>
        <circle cx="64" cy="16" r="13" fill="${color}"/>
        <circle cx="64" cy="16" r="8" fill="${color}" opacity=".85"/>`;
    case 'side':
      return `
        <path d="M30 58c2-24 16-36 34-36s32 12 34 36c-8-14-20-20-34-20S38 44 30 58z" fill="${color}"/>
        <path d="M28 58c-4 18 0 36 6 44h6c-2-12-4-28-2-40 4-2 10-4 26-4" fill="${color}"/>`;
    case 'spiky':
      return `
        <path d="M30 60 L26 28 L42 46 L50 20 L64 42 L78 18 L86 46 L102 26 L98 60
          C90 44 78 36 64 36S38 44 30 60z" fill="${color}"/>`;
    case 'bob':
      return `
        <ellipse cx="64" cy="42" rx="34" ry="26" fill="${color}"/>
        <path d="M30 52c-2 22 6 40 14 44h40c8-4 16-22 14-44-8 10-22 14-34 14S38 62 30 52z" fill="${color}"/>`;
    case 'afro':
      return `
        <circle cx="64" cy="44" r="40" fill="${color}"/>
        <circle cx="40" cy="36" r="14" fill="${color}"/>
        <circle cx="88" cy="36" r="14" fill="${color}"/>
        <circle cx="64" cy="22" r="14" fill="${color}"/>`;
    case 'bald':
      return '';
    default:
      return `
        <path d="M30 58c2-22 16-34 34-34s32 12 34 34c-8-12-20-18-34-18S38 46 30 58z" fill="${color}"/>`;
  }
}

function eyePair(style) {
  if (style === 'lash') {
    return `
      <ellipse cx="50" cy="60" rx="3.4" ry="4.2" fill="#1e293b"/>
      <ellipse cx="78" cy="60" rx="3.4" ry="4.2" fill="#1e293b"/>
      <path d="M44 54c2-3 6-4 10-2M74 52c2-2 6-3 10 0" fill="none" stroke="#1e293b" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="51.2" cy="58.8" r="1" fill="#fff"/>
      <circle cx="79.2" cy="58.8" r="1" fill="#fff"/>`;
  }
  if (style === 'happy') {
    return `
      <path d="M46 60c2 3 6 3 8 0" fill="none" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M74 60c2 3 6 3 8 0" fill="none" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `
    <ellipse cx="50" cy="60" rx="3.6" ry="4.4" fill="#1e293b"/>
    <ellipse cx="78" cy="60" rx="3.6" ry="4.4" fill="#1e293b"/>
    <circle cx="51.3" cy="58.6" r="1.1" fill="#fff"/>
    <circle cx="79.3" cy="58.6" r="1.1" fill="#fff"/>`;
}

function renderCharSvg(c) {
  const hair = hairPaths(c.style, c.hair);
  const eyes = eyePair(c.eyes || 'normal');
  const beard = c.beard
    ? `<path d="M46 82c6 10 14 14 18 14s12-4 18-14c-8 4-14 6-18 6s-10-2-18-6z" fill="${c.hair}" opacity=".9"/>`
    : '';
  const glasses = c.glasses
    ? `<g fill="none" stroke="#1e293b" stroke-width="2">
        <circle cx="50" cy="60" r="9"/><circle cx="78" cy="60" r="9"/>
        <path d="M59 60h10M41 60H34M87 60h7" stroke-linecap="round"/>
      </g>`
    : '';
  // Full-bleed circle so circular UI crops cleanly (no square corners)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg-${c.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.bg}"/>
      <stop offset="100%" stop-color="${c.bg}" stop-opacity=".78"/>
    </linearGradient>
    <linearGradient id="skin-${c.id}" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="${c.skin}"/>
      <stop offset="100%" stop-color="${c.skin}" stop-opacity=".9"/>
    </linearGradient>
    <clipPath id="circ-${c.id}"><circle cx="64" cy="64" r="64"/></clipPath>
  </defs>
  <g clip-path="url(#circ-${c.id})">
    <circle cx="64" cy="64" r="64" fill="url(#bg-${c.id})"/>
    <ellipse cx="64" cy="126" rx="48" ry="34" fill="${c.shirt}"/>
    <ellipse cx="64" cy="110" rx="24" ry="12" fill="${c.skin}" opacity=".35"/>
    ${hair}
    <ellipse cx="64" cy="64" rx="30" ry="34" fill="url(#skin-${c.id})"/>
    ${eyes}
    <path d="M54 78 Q64 86 74 78" fill="none" stroke="#1e293b" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="42" cy="70" rx="6" ry="3.5" fill="${c.skin}" opacity=".45"/>
    <ellipse cx="86" cy="70" rx="6" ry="3.5" fill="${c.skin}" opacity=".45"/>
    ${beard}
    ${glasses}
  </g>
</svg>`;
}

function listCharAvatars() {
  return CHARS.map((c) => ({
    id: c.id,
    name: c.name,
    key: `char:${c.id}`,
    url: `/api/char-avatars/${c.id}.svg?v=3`,
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
