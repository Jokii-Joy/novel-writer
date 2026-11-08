#!/usr/bin/env node
// Static guard for promises that must never be used as booleans.
//
// Why a static check and not a unit test: the bug this pins lived inside a React
// callback (`syncLibrary`), where the only way to observe it is to run the whole
// app with a fake IndexedDB and a fake crypto store. `NW.crypto.hasPassword()`
// and `NW.crypto.encryptionOn()` are async, and testing either one without
// `await` makes the condition permanently truthy (a Promise is always truthy):
//
//   if (NW.crypto.hasPassword && NW.crypto.hasPassword() && !isUnlocked()) ...
//
// read as "a password exists and we are locked" but evaluated as "always true"
// on an install without a password — which silently disabled every `sync.push`
// (R79 audit §A1). `encryptionOn()` has the same shape and would silently seal or
// leak chapter text the other way round.
//
// Rule: every call to these two helpers is either awaited, or consumes the
// promise with `.then(` / `.catch(` / `.finally(` (on the same line or the next).
//
// Usage: node scripts/verify-async-guards.mjs        (exits 1 on any finding)

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'client', 'src');

/** Helpers that return a Promise and are easy to test as if they were sync. */
const ASYNC_HELPERS = ['hasPassword()', 'encryptionOn()'];
/** A call whose result is *consumed* rather than coerced counts as correct. */
const CONSUMER_RE = /^\s*\.(?:then|catch|finally)\s*\(/;
/** Function definitions that legitimately contain the name. */
const DEFINITION_RE = /(?:async\s+)?function\s+(?:hasPassword|encryptionOn)\s*\(/;

const problems = [];

function stripComment(line) {
  const at = line.indexOf('//');
  return at >= 0 ? line.slice(0, at) : line;
}

const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

for (const name of files) {
  const text = readFileSync(join(srcDir, name), 'utf8');
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const code = stripComment(raw);
    if (DEFINITION_RE.test(code)) continue;
    for (const helper of ASYNC_HELPERS) {
      let from = 0;
      for (;;) {
        const at = code.indexOf(helper, from);
        if (at < 0) break;
        from = at + helper.length;
        const before = code.slice(0, at);
        // `await NW.crypto.hasPassword()` / `(await NW.crypto.encryptionOn())`:
        // the keyword sits before the object chain, not right before the name, so
        // look for an `await` after the last statement boundary on this line.
        const lastAwait = before.lastIndexOf('await');
        const awaited = lastAwait >= 0 && before.slice(lastAwait).indexOf(';') < 0;
        if (awaited) continue;
        const after = code.slice(at + helper.length);
        if (CONSUMER_RE.test(after)) continue;
        // Multi-line `.then(` chains: look at the next non-empty line.
        let next = index + 1;
        while (next < lines.length && !lines[next].trim()) next += 1;
        const nextLine = next < lines.length ? stripComment(lines[next]) : '';
        if (CONSUMER_RE.test(nextLine)) continue;
        problems.push({
          file: name,
          line: index + 1,
          text: raw.trim(),
          helper,
        });
      }
    }
  }
}

if (problems.length > 0) {
  console.error('verify-async-guards: FAILED — an async helper is used as a boolean');
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  ${problem.helper}`);
    console.error(`    ${problem.text}`);
  }
  console.error('\n  Fix: await the call, or chain .then()/.catch() on it.');
  process.exit(1);
}

console.log(`verify-async-guards: ok (${files.length} files, ${ASYNC_HELPERS.join(' / ')} all awaited or chained)`);
