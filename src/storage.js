/**
 * Admin media: Supabase Storage when configured, else Postgres BYTEA fallback.
 * Env:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=…   (service_role — server only, never ship to client)
 * Bucket: `media` (private)
 */
const db = require('./db');

const BUCKET = 'media';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4' };

const supabaseUrl = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const storageEnabled = () => !!(supabaseUrl() && serviceKey());

function objectPath(id, mime) {
  return `${id}.${EXT[mime] || 'bin'}`;
}

async function storageFetch(path, { method = 'GET', body, mime } = {}) {
  const url = `${supabaseUrl()}/storage/v1/object/${BUCKET}/${path}`;
  const headers = {
    Authorization: `Bearer ${serviceKey()}`,
    apikey: serviceKey(),
  };
  if (mime) headers['Content-Type'] = mime;
  if (method === 'POST' || method === 'PUT') headers['x-upsert'] = 'true';
  const r = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return r;
}

/**
 * Persist uploaded bytes. Returns DB row fields.
 * @returns {{ id: string, kind: string, mime: string, size: number, storagePath: string|null }}
 */
async function saveMedia({ id, kind, mime, buf, adminId }) {
  const size = buf.length;
  if (storageEnabled()) {
    const path = objectPath(id, mime);
    const r = await storageFetch(path, { method: 'POST', body: buf, mime });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      throw new Error(`Supabase Storage upload failed: ${r.status} ${err.slice(0, 200)}`);
    }
    // Also set legacy `path` when that column exists (older prod schemas).
    try {
      await db.prepare(
        'INSERT INTO media (id, kind, mime, data, size, admin_id, storage_path, path) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
      ).run(id, kind, mime, size, adminId, path, path);
    } catch {
      await db.prepare(
        'INSERT INTO media (id, kind, mime, data, size, admin_id, storage_path) VALUES (?, ?, ?, NULL, ?, ?, ?)',
      ).run(id, kind, mime, size, adminId, path);
    }
    return { id, kind, mime, size, storagePath: path };
  }
  await db.prepare(
    'INSERT INTO media (id, kind, mime, data, size, admin_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, kind, mime, buf, size, adminId);
  return { id, kind, mime, size, storagePath: null };
}

/** Load media bytes for HTTP serve or Telegram upload. */
async function loadMediaBytes(row) {
  if (!row) return null;
  if (row.data) {
    return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  }
  const objectKey = row.storage_path || row.path;
  if (objectKey && storageEnabled()) {
    const r = await storageFetch(objectKey, { method: 'GET' });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }
  return null;
}

async function deleteMediaObject(storagePath) {
  if (!storagePath || !storageEnabled()) return;
  const url = `${supabaseUrl()}/storage/v1/object/${BUCKET}`;
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceKey()}`,
        apikey: serviceKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [storagePath] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
}

module.exports = {
  storageEnabled,
  saveMedia,
  loadMediaBytes,
  deleteMediaObject,
  BUCKET,
};
