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

/** Load media bytes for HTTP serve or Telegram upload. */
async function loadMediaBytes(row) {
  if (!row || row.data == null) return null;
  return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
}

module.exports = {
  storageEnabled,
  saveMedia,
  loadMediaBytes,
};
