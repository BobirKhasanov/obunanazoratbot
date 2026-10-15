/** Fail CI if public client JS cannot be parsed as ESM (catches truncated / bad syntax). */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(root)
  .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  .map((f) => path.join(root, f));

const out = path.join(__dirname, '..', 'tmp-esbuild-syntax');
fs.mkdirSync(out, { recursive: true });
try {
  execFileSync('npx', ['--yes', 'esbuild', ...files, `--outdir=${out}`, '--format=esm', '--log-level=error'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
  });
} catch (e) {
  const err = (e.stderr && e.stderr.toString()) || e.message;
  console.error('client-syntax FAIL:\n', err);
  process.exit(1);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

// Numeric separators break some Telegram WebViews — keep them out of client JS
const sep = /(?<![\w$])\d{1,3}(?:_\d{3})+\b/;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (sep.test(src)) {
    console.error('client-syntax FAIL: numeric separator in', path.relative(path.join(__dirname, '..'), f));
    process.exit(1);
  }
}

console.log('client-syntax: ok (' + files.length + ' modules)');
