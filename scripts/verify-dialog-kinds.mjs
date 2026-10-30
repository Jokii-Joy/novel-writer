#!/usr/bin/env node
/**
 * R58: every `openDialog('x')` must have an `NW.dialogs.X` to render.
 *
 * The dispatch is `NW.dialogs[cap(dialog.kind)]`, so a kind whose capitalised
 * name is not a registered dialog silently renders nothing at all — the row
 * looks clickable, the click runs, and the screen does not change. That is
 * exactly the shape of "校对那个没反应", and it is cheap to rule out by
 * comparing the two lists instead of reasoning about it.
 *
 * Run: node scripts/verify-dialog-kinds.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'client', 'src');

const read = (name) => readFileSync(join(srcDir, name), 'utf8');

const problems = [];
const notes = [];

// ---- 1. what the app asks for ------------------------------------------------
// `openDialog('kind'` and `setDialog({ kind: 'kind'` are the two spellings used.
const asked = new Set();
for (const file of ['90-app.js', '60-editor.js', '62-read.js', '55-welcome.js']) {
  const text = read(file);
  for (const m of text.matchAll(/openDialog\(\s*'([A-Za-z]+)'/g)) asked.add(m[1]);
  for (const m of text.matchAll(/setDialog\(\s*\{\s*kind:\s*'([A-Za-z]+)'/g)) asked.add(m[1]);
}

// ---- 2. what is registered --------------------------------------------------
const registered = new Set();
for (const m of read('95-dialogs.js').matchAll(/NW\.dialogs\.([A-Za-z]+)\s*=/g)) {
  registered.add(m[1]);
}

// ---- 3. the dispatch itself -------------------------------------------------
const app = read('90-app.js');
const dispatch = app.match(/NW\.dialogs\[cap\(dialog && dialog\.kind\)\]/);
if (!dispatch) {
  problems.push('90-app.js — the dialog dispatch no longer reads NW.dialogs[cap(dialog.kind)]; this audit is stale');
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

for (const kind of [...asked].sort()) {
  const name = cap(kind);
  if (!registered.has(name)) {
    problems.push(
      `openDialog('${kind}') has no NW.dialogs.${name} — the click opens nothing, the screen does not change`,
    );
  }
}

// A registered dialog nobody opens is not an error (it may be reached from a
// nested panel), but it is worth naming so the list stays honest.
for (const name of [...registered].sort()) {
  if (!asked.has(name.charAt(0).toLowerCase() + name.slice(1))) {
    notes.push(`NW.dialogs.${name} is registered but nothing calls openDialog('${name.charAt(0).toLowerCase() + name.slice(1)}')`);
  }
}

// ---- 4. a disabled dock row must not be a dead end --------------------------
// The rail renders `disabled: needsChapter ? !p.chapter : false`. A disabled
// button fires no click, so a row that is disabled for a reason the writer
// cannot see is indistinguishable from a broken row.
const dock = app.slice(app.indexOf('function Dock(props)'));
const dockBody = dock.slice(0, dock.indexOf('\n  }\n'));
if (/disabled:\s*needsChapter/.test(dockBody)) {
  problems.push(
    'Dock rows use the disabled attribute for "no chapter" — a disabled row is silent, ' +
    'so the writer cannot tell it apart from a broken one. Use aria-disabled + a toast instead',
  );
}

// ---- report -----------------------------------------------------------------
console.log('verify-dialog-kinds: dialog dispatch audit\n');
for (const n of notes) console.log(`  note ${n}`);
if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\n结果: ${problems.length} 处问题`);
  process.exit(1);
}
console.log(`  ok   ${asked.size} openDialog kinds all resolve to a registered dialog`);
console.log('\n结果: 全部通过 ✅');
