// Optional shared cache via Upstash Redis REST. Falls back to in-process memory.
// Env (new DB only — do not reuse another bot's Redis):
//   UPSTASH_REDIS_REST_URL=https://….upstash.io
//   UPSTASH_REDIS_REST_TOKEN=…

const PREFIX = 'obunanazorat:';
const memory = new Map(); // key -> { at, data, maxAge }
/** Soft cap so in-process cache cannot grow without bound under load (~2.5k users). */
const MEM_MAX = Math.max(500, Number(process.env.CACHE_MEM_MAX || 8_000));

const url = () => String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const token = () => String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
const enabled = () => !!(url() && token());

async function redisCommand(args) {
  if (!enabled()) return null;
  try {
    const r = await fetch(url(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) return null;
    const body = await r.json().catch(() => null);
    return body && Object.prototype.hasOwnProperty.call(body, 'result') ? body.result : null;
  } catch {
    return null;
  }
}

function memGet(key, maxAge) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (maxAge ?? hit.maxAge ?? 0)) {
    memory.delete(key);
    return null;
  }
  return hit.data;
}

function memSet(key, data, maxAge) {
  if (memory.size >= MEM_MAX) {
    // Drop oldest ~10% (Map insertion order)
    const n = Math.max(1, Math.floor(MEM_MAX * 0.1));
    let i = 0;
    for (const k of memory.keys()) {
      memory.delete(k);
      if (++i >= n) break;
    }
  }
  memory.set(key, { at: Date.now(), data, maxAge });
  return data;
}

/**
 * @param {string} key
 * @param {number} maxAge ms
 */
async function cacheGet(key, maxAge) {
  const full = PREFIX + key;
  const local = memGet(full, maxAge);
  if (local != null) return local;

  if (!enabled() || maxAge <= 0) return null;
  const raw = await redisCommand(['GET', full]);
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('at' in parsed)) return null;
    if (Date.now() - Number(parsed.at) > maxAge) {
      redisCommand(['DEL', full]).catch(() => {});
      return null;
    }
    memSet(full, parsed.data, maxAge);
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {any} data
 * @param {number} maxAge ms
 */
async function cacheSet(key, data, maxAge) {
  const full = PREFIX + key;
  memSet(full, data, maxAge);
  if (!enabled() || maxAge <= 0) return data;
  const ttlSec = Math.max(1, Math.ceil(maxAge / 1000));
  const payload = JSON.stringify({ at: Date.now(), data });
  await redisCommand(['SET', full, payload, 'EX', String(ttlSec)]);
  return data;
}

async function cacheDel(key) {
  const full = PREFIX + key;
  memory.delete(full);
  if (enabled()) await redisCommand(['DEL', full]);
}

function cacheEnabled() {
  return enabled();
}

/** Redis INCR with TTL (memory fallback). Used for per-user rate limits. */
async function incr(key, ttlSec = 60) {
  const full = PREFIX + key;
  if (enabled()) {
    const n = await redisCommand(['INCR', full]);
    if (n === 1 || n === '1') await redisCommand(['EXPIRE', full, String(Math.max(1, ttlSec))]);
    const num = Number(n);
    if (Number.isFinite(num) && num > 0) return num;
  }
  const cur = (memGet(full, ttlSec * 1000) || 0) + 1;
  memSet(full, cur, ttlSec * 1000);
  return cur;
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheEnabled, incr };
