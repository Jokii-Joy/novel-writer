// Concatenate client/src/*.js exactly like build-client.mjs and run node --check.
// Scratch helper for parallel work: does not write client/client.js.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'client', 'src');
const parts = readdirSync(src).filter((f) => f.endsWith('.js')).sort()
  .map((f) => readFileSync(join(src, f), 'utf8'));
const out = join(tmpdir(), 'nw-src-check.js');
writeFileSync(out, parts.join('\n'));
try {
  execFileSync(process.execPath, ['--check', out], { stdio: 'inherit' });
  console.log('src-check: ok');
} catch (e) {
  console.error('src-check: FAILED');
  process.exit(1);
}
