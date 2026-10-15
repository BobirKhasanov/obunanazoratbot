// Sanity: scale defaults for ~2.5k concurrent Mini App users stay wired.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const db = read('src/db.js');
const server = read('src/server.js');
const realtime = read('src/realtime.js');
const cache = read('src/cache.js');
const envEx = read('.env.example');
const app = read('public/js/app.js');

assert.ok(/PG_POOL_MAX\s*\|\|\s*20/.test(db), 'default PG pool sized for ~2.5k');
assert.ok(db.includes('idx_games_status_updated'), 'games status+updated_at index');
assert.ok(server.includes('ensureAuthedUser') && server.includes('PRESENCE_WRITE_MIN_MS'), 'auth throttles upsert/presence');
assert.ok(/RATE_LIMIT_PER_MIN[^\n]*240/.test(server), 'rate limit default 240/min');
assert.ok(server.includes("cacheGet('shop:settings'") && server.includes("cacheGet('lobby:onlineCount'"), 'shop + onlineCount cached');
assert.ok(/SWEEPER_MS[^\n]*4_000|SWEEPER_MS[^\n]*4000/.test(server), 'sweeper default 4s');
assert.ok(/MAX_WS_CONNECTIONS[^\n]*4_000|MAX_WS_CONNECTIONS[^\n]*4000/.test(realtime), 'WS soft cap ~4000');
assert.ok(cache.includes('MEM_MAX') && cache.includes('8_000'), 'in-memory cache capped');
assert.ok(envEx.includes('UPSTASH_REDIS_REST_URL') && envEx.includes('PG_POOL_MAX'), 'env documents scale knobs');
assert.ok(app.includes('8_000') || app.includes('8000'), 'client tab refresh ~8s');

console.log('ok  scale-config (~2.5k live defaults)');
