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

check('空账就是零：打开章节不再把整章算进今天', () => {
  const stats = T.computeStats(chapters, 'n1', {}, true);
  assert.equal(stats.todayWords, 0);
  assert.equal(stats.weekWords, 0);
});

check('账本里的脏值不会变成 NaN，按 0 计', () => {
  const stats = T.computeStats(chapters, 'n1', { [dayKey(today)]: 'abc' }, true);
  assert.ok(Number.isFinite(stats.todayWords), 'today stays a number');
  assert.equal(stats.todayWords, 0);
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

check('记账立即落盘，不再被 1.2s 自动保存重置 2s 防抖', () => {
  const appSrc = read('90-app.js');
  assert.ok(
    appSrc.includes('NW.db.saveSettings({ dailyStats: dailyStatsRef.current })'),
    'the ledger is written on every bump',
  );
  const block = appSrc.slice(
    appSrc.indexOf('const persistDailyStats = () => {'),
    appSrc.indexOf('const bumpDailyWords = (delta) => {'),
  );
  assert.ok(!block.includes('setTimeout'), 'no debounce timer left between bump and write');
});

check('建议面板显示等待秒数与已到条数', () => {
  const adviceSrc = read('92-advice.js');
  assert.ok(adviceSrc.includes('模型正在思考… {0}s'), 'long thinking shows an explicit message');
  assert.ok(adviceSrc.includes('已读到 {0} 条'), 'streamed cards are counted');
  assert.ok(adviceSrc.includes('const [elapsed, setElapsed] = useState(0)'), 'elapsed state exists');
});

// --- R100: 低摩擦启动 ------------------------------------------------------
check('默认每日目标是 500 字（0 关闭）', () => {
  const dbSrc = read('10-db.js');
  assert.ok(/dailyGoal:\s*500,/.test(dbSrc), 'DEFAULT_SETTINGS carries dailyGoal: 500');
});

check('首页有「继续写」与「只写 100 字」两个入口', () => {
  assert.ok(welcomeSrc.includes("tr('继续写')"), 'resume button exists');
  assert.ok(welcomeSrc.includes("p.onResumeChapter(resumeTarget.novel.id, resumeTarget.resume.id)"), 'resume lands on the remembered chapter');
  assert.ok(welcomeSrc.includes("tr('只写 100 字')"), 'micro goal button exists');
  assert.ok(welcomeSrc.includes("p.onMicroGoal(resumeTarget.novel.id, resumeTarget.resume.id, 100)"), 'micro goal starts at 100');
});

check('今天变成可点击的目标环', () => {
  assert.ok(welcomeSrc.includes('nw-goal-ring'), 'ring is rendered');
  assert.ok(welcomeSrc.includes('strokeDashoffset'), 'ring reflects progress');
  assert.ok(welcomeSrc.includes('nw-welcome-statgoal'), 'the cell is a button');
  assert.ok(welcomeSrc.includes('p.onSetDailyGoal'), 'clicking the ring edits the goal');
  assert.ok(welcomeSrc.includes("'data-done'"), 'met goal has its own state');
});

check('App 接线：目标、微目标、完成提示', () => {
  const appSrc = read('90-app.js');
  assert.ok(appSrc.includes('dailyGoal: dailyGoal'), 'Welcome receives the goal');
  assert.ok(appSrc.includes('onSetDailyGoal: editDailyGoal'), 'goal editor is wired');
  assert.ok(appSrc.includes('onMicroGoal: startMicroGoal'), 'micro goal starter is wired');
  assert.ok(appSrc.includes("const MICRO_GOAL_KEY = 'nw.microGoal'"), 'micro goal survives a reload');
  assert.ok(appSrc.includes('微目标达成'), 'finishing the goal says so once');
  assert.ok(appSrc.includes("title: '每日字数目标'"), 'the goal prompt exists');
  assert.ok(appSrc.includes('nw-microbar'), 'the thin bar is rendered');
});

check('「继续写」恢复精确光标位置', () => {
  const edSrc = read('60-editor.js');
  assert.ok(edSrc.includes("const CARET_PREFIX = 'nw.caret.'"), 'caret is stored per chapter');
  assert.ok(edSrc.includes('function readCaret('), 'caret can be read back');
  assert.ok(edSrc.includes('function flushCaretNow('), 'caret is flushed on unload/switch');
  assert.ok(edSrc.includes('const savedCaret = readCaret(nextId)'), 'chapter load restores it');
  assert.ok(edSrc.includes('scrollOffsetToCenter(target)'), 'restored caret is scrolled into view');
});

check('R102: 恢复光标要等布局稳定，且保存前先落盘', () => {
  const edSrc = read('60-editor.js');
  const appSrc = read('90-app.js');
  // The first paint of a fresh editor can have a zero-height scroller; a single
  // scroll attempt then clamps to 0 and the writer lands at the top of the
  // chapter (their last sentence only shows after a click).
  assert.ok(edSrc.includes('window.setTimeout(land, 200)'), 'caret landing is retried after layout');
  assert.ok(edSrc.includes('const CARET_SAVE_MS = 400;'), 'caret is persisted quickly after typing');
  const blurAt = edSrc.indexOf('function handleBlur()');
  assert.ok(blurAt > 0 && edSrc.slice(blurAt, blurAt + 400).includes('flushCaretNow();'), 'blur persists the caret');
  // A fast 首页 → 继续写 must not read the chapter before the unmount write lands.
  assert.ok(appSrc.includes('await flushEditor();'), 'chapter open waits for the editor flush');
  assert.ok(appSrc.includes('pendingSaveRef.current = pending;'), 'flush waits for the in-flight save');
});

check('R103: 「继续写」聚焦并真正把最后一行带进视野', () => {
  const edSrc = read('60-editor.js');
  const appSrc = read('90-app.js');
  // The pane can report a zero-height scroller on first paint. A pending
  // landing is re-settled by every measure pass until the caret is inside the
  // viewport, instead of relying on one scroll + a click to fix it.
  assert.ok(edSrc.includes('const landPendingRef = React.useRef(null);'), 'a landing can be pending');
  assert.ok(edSrc.includes('function settleLanding('), 'the measure pass finishes the landing');
  assert.ok(edSrc.includes('landPendingRef.current = caretAt;'), 'chapter load arms the pending landing');
  assert.ok(edSrc.includes('m.top >= top - 2 && m.top + m.height <= bottom + 2'), 'landing is verified on screen');
  // "继续写" must focus the textarea: without focus the custom caret is not
  // painted and the browser never scrolls the insertion point into view.
  assert.ok(edSrc.includes('revealCaret() {'), 'the editor exposes revealCaret');
  assert.ok(/revealCaret\(\) \{[\s\S]{0,900}?ta\.focus\(\)/.test(edSrc), 'revealCaret focuses the textarea');
  assert.ok(appSrc.includes('revealEditorCaretSoon'), 'the resume gesture asks for the caret');
  assert.ok(appSrc.includes('api.revealCaret()'), 'the request reaches the editor');
});

check('没有「依赖数组读到了后声明的 const」的 TDZ 崩溃', () => {
  // R100 regression: a useCallback/useEffect declared before `dailyGoal`/
  // `microWritten` read them in its dependency array, which throws
  // "Cannot access 'x' before initialization" on the first render — the panel
  // simply refuses to open. This walks the file and compares declaration order.
  const appSrc = read('90-app.js');
  const lines = appSrc.split('\n');
  const declAt = new Map();
  const note = (name, line) => {
    if (name && !declAt.has(name)) declAt.set(name, line);
  };
  lines.forEach((line, i) => {
    const simple = line.match(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (simple) note(simple[1], i + 1);
    const arr = line.match(/^\s*(?:const|let)\s*\[\s*([A-Za-z_$][\w$]*)/);
    if (arr) note(arr[1], i + 1);
    const obj = line.match(/^\s*(?:const|let)\s*\{([^}]*)\}\s*=/);
    if (obj) {
      obj[1].split(',').forEach((part) => {
        const m = part.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (m) note(m[1], i + 1);
      });
    }
  });
  const problems = [];
  lines.forEach((line, i) => {
    let deps = null;
    const inline = line.match(/\},\s*\[([^\]]*)\]\s*\)/);
    if (inline) deps = inline[1];
    else {
      const alone = line.match(/^\s*\[([^\]]*)\],?\s*$/);
      if (alone) deps = alone[1];
    }
    if (!deps) return;
    deps.split(',').forEach((raw) => {
      const name = raw.trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
      const at = declAt.get(name);
      if (at && at > i + 1) problems.push(`${name}: declared line ${at}, read line ${i + 1}`);
    });
  });
  assert.deepEqual(problems, [], 'no dependency array reads a later const');
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
