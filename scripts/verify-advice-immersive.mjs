#!/usr/bin/env node
/**
 * R114: 沉浸模式里「修改建议」必须能打开。
 *
 * Usage: node scripts/verify-advice-immersive.mjs   (exits 1 on regression)
 *
 * The floating 修改建议 button is painted by the editor, the dock row by the
 * app, and the column/window by the app render branches. Immersive mode must
 * not gate any of them: the writer asked for the panel to work there, not to
 * disappear. Pin all four surfaces here without a browser.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '..', 'client', 'src', name), 'utf8');
const editor = read('60-editor.js');
const app = read('90-app.js');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.log(`  FAIL ${name}`);
  }
}

check('建议栏的开合只看 adviceOpen，不看沉浸状态', () => {
  assert.ok(
    app.includes("'data-advice': adviceOpen ? '1' : '0'"),
    'the bench must reserve the advice column whenever it is open',
  );
  assert.match(app, /adviceOpen\s*\n\s*\? h\(NW\.Advice/, 'the column must render whenever it is open');
  assert.ok(!app.includes('adviceOpen && !immersive'), 'no immersive gate on the column');
});

check('选中改写窗口同样能在沉浸里并排出现', () => {
  assert.ok(
    app.includes("'data-selwin': selAdvice ? '1' : '0'"),
    'the bench must pin the paper for the selection window',
  );
  assert.match(app, /selAdvice\s*\n\s*\? h\(NW\.SelectionAdvice/, 'the window must render whenever selected');
  assert.ok(!app.includes('selAdvice && !immersive'), 'no immersive gate on the window');
});

check('工具坞保留「修改建议」这一行', () => {
  assert.ok(
    app.includes("item('sparkle', NW.t('修改建议'), p.onAdvice, true)"),
    'the dock row must exist',
  );
  assert.ok(!app.includes("p.immersive ? null : item('sparkle'"), 'the row must not be hidden in immersive mode');
});

check('App 的三个入口不再被沉浸挡住', () => {
  assert.match(app, /onAdvice: \(\) => \{\s*\/\/ The column sits beside the paper/, 'onAdvice guard removed');
  assert.ok(
    app.includes('onToggleAdvice: () => setAdviceOpen((v) => !v)'),
    'Alt+A toggles the column in immersive mode too',
  );
  assert.match(
    app,
    /onAdviceSelection: \(sel\) => \{\s*if \(!sel \|\| !String\(sel\.text \|\| ''\)\.trim\(\)\) return;/,
    'selection advice opens in immersive mode too',
  );
  assert.ok(!app.includes('if (!immersive) setAdviceOpen'), 'no keyboard gate');
});

check('编辑器的选字浮钮在沉浸里照常浮出', () => {
  assert.match(
    editor,
    /function showSelBtn\(ev\) \{\s*if \(typeof propsRef\.current\.onAdviceSelection !== 'function'\) return;\s*const ta = taRef\.current;/,
    'showSelBtn must not bail out for immersive mode',
  );
  assert.match(editor, /const selBtnBar = selBtn\s*\n\s*\? h\(/, 'the button renders from selBtn alone');
  assert.ok(!editor.includes('selBtn && !immersive'), 'no immersive gate on the floating button');
});

check('重新定位 / 同步选区不会因为沉浸而放弃', () => {
  assert.match(editor, /function reseatSelBtn\(\) \{\s*const cur = selBtnRef\.current;/, 'reseat keeps working');
  assert.match(editor, /function syncSelBtn\(\) \{\s*const cur = selBtnRef\.current;/, 'sync keeps working');
});

check('Alt+A 在沉浸中也能开合建议栏', () => {
  assert.ok(editor.includes('&& onToggleAdvice) {'), 'the keyboard shortcut is not gated by immersive');
});

check('建议栏或选中窗口打开时，工具坞在沉浸里也让位', () => {
  assert.match(
    app,
    /view === 'write' \|\| immersive\s*\?\s*adviceOpen \|\| selAdvice\s*\?\s*null\s*:\s*dock/,
    'the dock must not float over the advice column',
  );
});

console.log('');
if (failed) {
  console.log(`${passed} passed, ${failed} failed`);
  for (const failure of failures) {
    console.log('');
    console.log(`FAIL: ${failure.name}`);
    console.log(failure.error && failure.error.stack ? failure.error.stack : failure.error);
  }
  process.exit(1);
}
console.log(`${passed} passed`);
