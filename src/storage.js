/**
 * Admin media stored as Postgres BYTEA on Neon.
 * Legacy Supabase schemas may still have a NOT NULL `path` column — always set it.
 */
const db = require('./db');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4' };

/**
 * Optional Cloudflare R2 (S3 API). With R2_* env vars set, new uploads go to the bucket and
 * Postgres keeps only the row (data = NULL, storage_path = 'r2:<key>'). Without them everything
 * stays in Postgres exactly as before.
 */
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ON = !!(R2_ACCOUNT_ID && R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
let s3 = null; let S3 = null;
function r2() {
  if (!R2_ON) return null;
  if (!s3) {
    S3 = require('@aws-sdk/client-s3');
    s3 = new S3.S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
  }
  return s3;
}
const r2Key = (id) => `media/${id}`;

async function r2Put(id, buf, mime) {
  await r2().send(new S3.PutObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(id), Body: buf, ContentType: mime }));
}
async function r2Get(id) {
  const out = await r2().send(new S3.GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(id) }));
  return Buffer.from(await out.Body.transformToByteArray());
}
/** Best-effort delete of R2 copies for rows that were just removed from Postgres. */
async function deleteR2Objects(ids) {
  if (!R2_ON || !ids || !ids.length) return;
  try {
    await r2().send(new S3.DeleteObjectsCommand({
      Bucket: R2_BUCKET, Delete: { Objects: ids.map((id) => ({ Key: r2Key(id) })), Quiet: true },
    }));
  } catch (e) { console.warn('[r2] delete failed:', e.message); }
}
/** Move a few legacy Postgres files to R2 per call (called from housekeeping). */
async function migrateSomeToR2(limit = 10) {
  if (!R2_ON) return 0;
  const rows = await db.prepare(
    "SELECT id, mime, data FROM media WHERE data IS NOT NULL AND (storage_path IS NULL OR storage_path = '') ORDER BY created_at DESC LIMIT ?",
  ).all(limit);
  let n = 0;
  for (const row of rows) {
    const buf = await loadMediaBytes({ data: row.data });
    if (!buf) continue;
    try {
      await r2Put(row.id, buf, row.mime || 'application/octet-stream');
      await db.prepare("UPDATE media SET data = NULL, storage_path = ? WHERE id = ?").run(`r2:${r2Key(row.id)}`, row.id);
      n += 1;
    } catch (e) { console.warn('[r2] migrate failed:', e.message); break; }
  }
  return n;
}

const storageEnabled = () => R2_ON;

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
  if (R2_ON) {
    try {
      await r2Put(id, buf, mime);
      const sp = `r2:${r2Key(id)}`;
      try {
        await db.prepare('INSERT INTO media (id, kind, mime, data, size, admin_id, path, storage_path) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
          .run(id, kind, mime, size, adminId, path, sp);
      } catch {
        await db.prepare('INSERT INTO media (id, kind, mime, data, size, admin_id, storage_path) VALUES (?, ?, ?, NULL, ?, ?, ?)')
          .run(id, kind, mime, size, adminId, sp);
      }
      return { id, kind, mime, size, storagePath: sp };
    } catch (e) { console.warn('[r2] upload failed, storing in Postgres:', e.message); }
  }
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
  if (!row) return null;
  if (row.data == null && typeof row.storage_path === 'string' && row.storage_path.startsWith('r2:') && R2_ON) {
    try { return await r2Get(row.id); } catch (e) { console.warn('[r2] read failed:', e.message); return null; }
  }
  if (row.data == null) return null;
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
  deleteR2Objects,
  migrateSomeToR2,
};
