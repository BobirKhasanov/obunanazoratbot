/**
 * Admin media stored as Postgres BYTEA on Neon.
 */
const db = require('./db');

/** Always false — kept for API response shape (`storage: false`). */
const storageEnabled = () => false;

/**
 * Persist uploaded bytes. Returns DB row fields.
 * @returns {{ id: string, kind: string, mime: string, size: number, storagePath: null }}
 */
async function saveMedia({ id, kind, mime, buf, adminId }) {
  const size = buf.length;
  await db.prepare(
    'INSERT INTO media (id, kind, mime, data, size, admin_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, kind, mime, buf, size, adminId);
  return { id, kind, mime, size, storagePath: null };
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
