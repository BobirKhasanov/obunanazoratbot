/**
 * Cloudflare Worker: serve Mini App static assets from CF,
 * proxy /api/* , /ws , /healthz to the Render origin.
 *
 * Set API_ORIGIN in Workers Settings → Variables
 *   e.g. https://your-service.onrender.com
 */
export default {
  async fetch(request, env) {
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
        return new Response(JSON.stringify({ error: 'API_ORIGIN not configured on Worker' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const target = new URL(path + url.search, origin);
      // WebSocket upgrades must forward the original Request (Upgrade / Connection).
      if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
        return fetch(new Request(target, request));
      }
      const headers = new Headers(request.headers);
      headers.set('Host', target.host);
      headers.delete('cf-connecting-ip');
      return fetch(new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        // @ts-expect-error duplex needed for streamed bodies on some runtimes
        duplex: 'half',
      }));
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
