#!/usr/bin/env node
/**
 * R95: the home screen's 创作统计 numbers.
 *
 *   node scripts/verify-welcome-stats.mjs
 *
 * The card used to sum the *stored* wordCount and treat every chapter whose
 * updatedAt fell on today as "written today". Both numbers drifted:
 *
 *   - stored counts are only rewritten on save, so toggling 字数含标点 (or an
 *     import that used another algorithm) left 全书/本书 stale;
 *   - re-opening an old chapter, or a sync that restamped every chapter,
 *     counted whole chapters as today's work.
 *
 * The card now counts the live text (NW.format.chapterWordCount) and takes
 * 今天/近 7 天 from the per-day ledger (settings.dailyStats). This script loads
 * the two real client modules in a small stub and pins those rules down.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'client', 'src');
const read = (name) => readFileSync(join(SRC, name), 'utf8');

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
    console.log(`       ${error && error.message ? error.message : error}`);
  }
}

// --- load the real modules -------------------------------------------------
const NW = { CSS_PARTS: [] };
const windowStub = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};

new Function('NW', read('20-format.js'))(NW);

const welcomeSrc = read('55-welcome.js');
const welcomeMarker = '  NW.Welcome = Welcome;';
assert.ok(welcomeSrc.includes(welcomeMarker), '55-welcome.js still ends with NW.Welcome = Welcome');
const welcomePatched = welcomeSrc.replace(
  welcomeMarker,
  `${welcomeMarker}\n  NW.__statsTest = { computeStats: computeStats, rollupNovels: rollupNovels };`,
);
new Function('NW', 'window', welcomePatched)(NW, windowStub);

const T = NW.__statsTest;
assert.ok(T && typeof T.computeStats === 'function', 'computeStats exported for the test');
assert.ok(typeof T.rollupNovels === 'function', 'rollupNovels exported for the test');
assert.ok(typeof NW.format.chapterWordCount === 'function', 'NW.format.chapterWordCount exists');

// --- fixtures --------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const dayKey = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const chapters = [
  // Live text wins over a stale stored count.
  { id: 'c1', novelId: 'n1', content: '你好，世界。', wordCount: 999, updatedAt: today + 1000 },
  // Latin words count as words.
  { id: 'c2', novelId: 'n2', content: 'abc def', wordCount: 0, updatedAt: 0 },
  // Metadata-only rows (stripContent) keep the stored number.
  { id: 'c3', novelId: 'n1', content: '', wordCount: 50, updatedAt: today + 2000 },
  // Locked chapters only carry a placeholder body; use the stored number.
  { id: 'c4', novelId: 'n2', content: '被加密的占位正文', locked: true, wordCount: 77, updatedAt: 0 },
];

const ledger = {
  [dayKey(today)]: 120,
  [dayKey(today - DAY)]: 80,
  [dayKey(today - 6 * DAY)]: 30,
  [dayKey(today - 7 * DAY)]: 999, // outside the 7-day window
};

// --- tests -----------------------------------------------------------------
check('有明文时按当前算法重算，忽略陈旧的 wordCount', () => {
  assert.equal(NW.format.chapterWordCount({ content: '你好，世界。', wordCount: 999 }), 6);
  assert.equal(NW.format.chapterWordCount({ content: '你好，世界。', wordCount: 999 }, { includePunctuation: false }), 4);
});

check('locked 与无正文的行沿用 stored 字数', () => {
  assert.equal(NW.format.chapterWordCount({ locked: true, content: '被加密的占位正文', wordCount: 77 }), 77);
  assert.equal(NW.format.chapterWordCount({ content: '', wordCount: 50 }), 50);
  assert.equal(NW.format.chapterWordCount(null), 0);
});

check('全书 / 本书按实时正文统计', () => {
  const stats = T.computeStats(chapters, 'n1', null, true);
  assert.equal(stats.total, 135);
  assert.equal(stats.novel, 56);
  assert.equal(stats.count, 4);
});

check('关闭「字数含标点」后全书立即少算标点', () => {
  const stats = T.computeStats(chapters, 'n1', null, false);
  assert.equal(stats.total, 133);
  assert.equal(stats.novel, 54);
});

check('今天 / 近 7 天取按天账，不再把整章算进今天', () => {
  const stats = T.computeStats(chapters, 'n1', ledger, true);
  assert.equal(stats.todayWords, 120);
  assert.equal(stats.weekWords, 230);
});

check('没有账本（旧安装）时回退到按 updatedAt 的估算', () => {
  const stats = T.computeStats(chapters, 'n1', {}, true);
  assert.equal(stats.todayWords, 56); // c1 6 + c3 50
  assert.equal(stats.weekWords, 0);
});

check('账本里的脏值不会变成 NaN，回退到估算', () => {
  const stats = T.computeStats(chapters, 'n1', { [dayKey(today)]: 'abc' }, true);
  assert.ok(Number.isFinite(stats.todayWords), 'today stays a number');
  assert.equal(stats.todayWords, 56); // no usable ledger entry → old estimate
  assert.equal(stats.weekWords, 0);
});

check('按书汇总也用同一套字数', () => {
  const rows = T.rollupNovels([{ id: 'n1' }, { id: 'n2' }], chapters, {}, true);
  const byId = new Map(rows.map((row) => [String(row.novel.id), row.words]));
  assert.equal(byId.get('n1'), 56);
  assert.equal(byId.get('n2'), 79);
});

check('统计结果按行缓存，正文或标点开关变了会重算', () => {
  const row = { content: '你好，世界。', wordCount: 999 };
  assert.equal(NW.format.chapterWordCount(row), 6);
  assert.equal(NW.format.chapterWordCount(row, { includePunctuation: false }), 4);
  row.content = '你好';
  assert.equal(NW.format.chapterWordCount(row), 2);
});

check('统计卡把「本书」写对', () => {
  assert.ok(welcomeSrc.includes("{ k: '本书'"), 'stats card label is 本书');
  assert.ok(!welcomeSrc.includes('本章书'), 'no leftover 本章书 typo');
});

check('App 把 dailyStats 与标点开关传给首页', () => {
  const appSrc = read('90-app.js');
  assert.ok(appSrc.includes('dailyStats: dailyStats'), 'Welcome receives dailyStats');
  assert.ok(appSrc.includes('countPunctuation: settings.countPunctuation !== false'), 'Welcome receives countPunctuation');
  assert.ok(appSrc.includes('NW.format.chapterWordCount(row, options)'), 'status bar uses live counts');
});

check('开章时播种每日字数基线，首次自动保存不再丢字', () => {
  const appSrc = read('90-app.js');
  assert.ok(
    appSrc.includes('dailyWordsRef.current[key]') &&
      appSrc.includes('NW.format.chapterWordCount(row, { includePunctuation: settings.countPunctuation !== false })'),
    'baseline is seeded from the opened chapter with the live counting rule',
  );
  assert.ok(appSrc.includes('dailyWordsRuleRef'), 'toggling 字数含标点 drops the stale baselines');
});

// --- summary ---------------------------------------------------------------
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
