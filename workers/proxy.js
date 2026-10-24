/**
 * Cloudflare Worker: serve Mini App static assets from CF,
 * proxy /api/* , /ws , /healthz to the Render origin.
 *
 * Set API_ORIGIN in Workers Settings → Variables
 *   e.g. https://your-service.onrender.com
 *
 * Retries transient origin failures so Render cold-starts / blips
 * do not surface as "No connection" in Telegram.
 */

// public, immutable-per-URL binaries (media id / medal id / avatar id are unique)
const EDGE_CACHEABLE = /^\/api\/(media\/[0-9a-f-]{36}|medals\/[^/]+\.svg|avatars\/[0-9a-f-]{36}|public\/profile-banner)$/i;

const RETRY_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isIdempotent(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

async function proxyToOrigin(request, origin, url) {
  const path = url.pathname;
  const target = new URL(path + url.search, origin);

  // WebSocket upgrades must forward the original Request (Upgrade / Connection).
  if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
    return fetch(new Request(target, request));
  }

  const method = request.method || 'GET';
  const canRetry = isIdempotent(method);
  const maxAttempts = canRetry ? 3 : 1;

  // Buffer body once so retries can re-send (non-WS).
  let bodyBuf = null;
  if (method !== 'GET' && method !== 'HEAD') {
    try { bodyBuf = await request.arrayBuffer(); } catch { bodyBuf = null; }
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const headers = new Headers(request.headers);
    headers.set('Host', target.host);
    headers.delete('cf-connecting-ip');

    try {
      const res = await fetch(new Request(target, {
        method,
        headers,
        body: bodyBuf,
        redirect: 'manual',
        // @ts-expect-error duplex needed for streamed bodies on some runtimes
        duplex: 'half',
      }));
      lastStatus = res.status;
      if (canRetry && RETRY_STATUSES.has(res.status) && attempt < maxAttempts - 1) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      return res;
    } catch {
      if (attempt < maxAttempts - 1) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      return new Response(JSON.stringify({
        error: 'Server waking up — try again',
        code: 'net',
        originStatus: lastStatus || 0,
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': '2',
        },
      });
    }
  }

  return new Response(JSON.stringify({
    error: 'Server temporarily unavailable',
    code: 'net',
    originStatus: lastStatus,
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '2',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const needsOrigin =
      path === '/ws'
      || path === '/healthz'
      || path.startsWith('/api/')
      || path === '/api';

    if (needsOrigin) {
      const origin = String(env.API_ORIGIN || '').replace(/\/$/, '');
      if (!origin) {
        return new Response(JSON.stringify({ error: 'API_ORIGIN not configured on Worker', code: 'server' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Images/medals never change for a given URL: serve them from Cloudflare's edge so the
      // origin (and Postgres behind it) is hit once, not on every phone.
      if (request.method === 'GET' && EDGE_CACHEABLE.test(path)) {
        const cache = caches.default;
        const key = new Request(url.origin + path + url.search, { method: 'GET' });
        const hit = await cache.match(key);
        if (hit) return hit;
        const res = await proxyToOrigin(request, origin, url);
        const cc = res.headers.get('Cache-Control') || '';
        if (res.status === 200 && /public/.test(cc) && !/no-store|private/.test(cc)) {
          const copy = new Response(res.clone().body, res);
          ctx.waitUntil(cache.put(key, copy));
        }
        return res;
      }
      return proxyToOrigin(request, origin, url);
    }

    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      // HTML must not be cached hard in Telegram WebView; hashed query on CSS/JS bustes the rest.
      if (path === '/' || path.endsWith('.html')) {
        const out = new Response(res.body, res);
        out.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        return out;
      }
      if (path.endsWith('.css') || path.endsWith('.js') || path.endsWith('.mjs')) {
        const out = new Response(res.body, res);
        out.headers.set('Cache-Control', 'no-cache, must-revalidate');
        return out;
      }
      return res;
    }
    return new Response('Not found', { status: 404 });
  },
};
