/**
 * Admin media stored as Postgres BYTEA on Neon.
 * Legacy Supabase schemas may still have a NOT NULL `path` column — always set it.
 */
const db = require('./db');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4' };

/** Always false — kept for API response shape (`storage: false`). */
const storageEnabled = () => false;

function objectPath(id, mime) {
  return `${id}.${EXT[mime] || 'bin'}`;
}

/**
 * Persist uploaded bytes. Returns DB row fields.
 * @returns {{ id: string, kind: string, mime: string, size: number, storagePath: null }}
 */
async function saveMedia({ id, kind, mime, buf, adminId }) {
  const size = buf.length;
  const path = objectPath(id, mime);
  const attempts = [
    () => db.prepare(
      'INSERT INTO media (id, kind, mime, data, size, admin_id, path, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run(id, kind, mime, buf, size, adminId, path),
    () => db.prepare(
      'INSERT INTO media (id, kind, mime, data, size, admin_id, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, kind, mime, buf, size, adminId, path),
    () => db.prepare(
      'INSERT INTO media (id, kind, mime, data, size, admin_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, kind, mime, buf, size, adminId),
  ];
  let last;
  for (const attempt of attempts) {
    try {
      await attempt();
      return { id, kind, mime, size, storagePath: null };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Load media bytes for HTTP serve or Telegram upload (Neon BYTEA → Buffer). */
async function loadMediaBytes(row) {
  if (!row || row.data == null) return null;
  if (Buffer.isBuffer(row.data)) return row.data;
  if (row.data instanceof Uint8Array) return Buffer.from(row.data);
  // Rare: hex/escape string from a non-binary driver path
  if (typeof row.data === 'string') {
    const s = row.data.startsWith('\\x') ? row.data.slice(2) : row.data;
    try { return Buffer.from(s, 'hex'); } catch { return null; }
  }
  try { return Buffer.from(row.data); } catch { return null; }
}

module.exports = {
  storageEnabled,
  saveMedia,
  loadMediaBytes,
};
