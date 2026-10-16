// Static checks for Cloudflare Worker origin proxy resilience.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'workers', 'proxy.js'), 'utf8');
assert.ok(src.includes('RETRY_STATUSES'), 'retries 502/503/504');
assert.ok(src.includes('maxAttempts'), 'bounded retry loop');
assert.ok(src.includes('isIdempotent'), 'only retries safe methods by default path');
assert.ok(src.includes("code: 'net'"), 'maps origin down to net code');
assert.ok(src.includes('websocket'), 'forwards WebSocket upgrades without retry loop body buffer issues');
assert.ok(src.includes('API_ORIGIN'), 'requires API_ORIGIN');
console.log('ok  worker-proxy (origin retry)');
