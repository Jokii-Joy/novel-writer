#!/usr/bin/env node
/**
 * R110: the chapter row's detail block.
 *
 *   node scripts/verify-shelf-detail.mjs
 *
 * Every chapter in the shelf now shows, under its name, when it was first /
 * last edited and the opening one or two sentences of the body — no click
 * needed. Three things here are easy to break without a screenshot:
 *
 *   - the excerpt must cut on sentence boundaries (and never glue English
 *     sentences together as "world.Next", which is what a naive
 *     whitespace-collapse does);
 *   - every row must get a detail, but the excerpt must be cached per
 *     chapter — otherwise typing one word re-scans the whole book;
 *   - the type must stay smaller than the title and adapt to the shelf
 *     width (one line narrow, two lines wide).
 *
 * This script loads the real 50-shelf.js in a stub, patches in a test hook,
 * and pins both the pure functions and the wiring in 90-app/10-db.
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

// --- load the real shelf module -------------------------------------------
const NW = {
  CSS_PARTS: [],
  t: (key, ...args) => {
    let out = String(key);
    for (let i = 0; i < args.length; i += 1) {
      out = out.replace(new RegExp('\\{' + i + '\\}', 'g'), String(args[i]));
    }
    return out;
  },
  fmtDate: (ms) => String(ms),
  fmtWords: (n) => String(n),
  icon: () => null,
  ui: {},
};
const React = {
  memo: (component) => component,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  createElement: () => null,
};

const shelfSrc = read('50-shelf.js');
const marker = '  NW.CSS_PARTS.push(';
assert.ok(shelfSrc.includes(marker), '50-shelf.js still pushes its CSS with NW.CSS_PARTS.push(');
const patched = shelfSrc.replace(
  marker,
  '  NW.__shelfTest = { fmtMoment: fmtMoment, firstSentences: firstSentences };\n' + marker,
);
new Function('NW', 'React', 'h', 'window', 'document', patched)(
  NW,
  React,
  () => null,
  { innerWidth: 1280 },
  { addEventListener: () => {}, removeEventListener: () => {} },
);

const T = NW.__shelfTest;
assert.ok(T && typeof T.fmtMoment === 'function', 'fmtMoment exported for the test');
assert.ok(typeof T.firstSentences === 'function', 'firstSentences exported for the test');

// --- fmtMoment -------------------------------------------------------------
check('今天的时间：窄格式 MM-DD HH:MM，宽格式带年份', () => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 4);
  const pad = (n) => String(n).padStart(2, '0');
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  assert.equal(T.fmtMoment(d.getTime(), false), `${md} 21:04`);
  assert.equal(T.fmtMoment(d.getTime(), true), `${d.getFullYear()}-${md} 21:04`);
});

check('跨年：窄格式缩成两位年份，仍按时:分', () => {
  const d = new Date(new Date().getFullYear() - 1, 10, 8, 9, 5);
  const pad = (n) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  assert.equal(T.fmtMoment(d.getTime(), false), `${yy}-11-08 09:05`);
  assert.equal(T.fmtMoment(d.getTime(), true), `${d.getFullYear()}-11-08 09:05`);
});

check('无效时间返回空串（详情行不会出现 "NaN-NaN"）', () => {
  assert.equal(T.fmtMoment(0, true), '');
  assert.equal(T.fmtMoment(null, false), '');
  assert.equal(T.fmtMoment('nope', true), '');
});

// --- firstSentences --------------------------------------------------------
check('最多两句：按句号切，第二句后截断', () => {
  const got = T.firstSentences('他推开门。风很大。远处有灯。', 100, 2);
  assert.equal(got.text, '他推开门。风很大。');
  assert.equal(got.cut, true);
});

check('只要一句时，长句也不硬塞第二句', () => {
  const got = T.firstSentences('他推开门。风很大。', 100, 1);
  assert.equal(got.text, '他推开门。');
  assert.equal(got.cut, true);
});

check('按 maxChars 截断并标记 cut', () => {
  const got = T.firstSentences('他推开门。风很大。', 6, 2);
  assert.equal(got.text, '他推开门。风');
  assert.equal(got.cut, true);
});

check('正文开头的空行/缩进被吃掉，段落间不留双空格', () => {
  const got = T.firstSentences('\n\n  第一句。\n\n  第二句。第三句。', 100, 2);
  assert.equal(got.text, '第一句。第二句。');
  assert.equal(got.cut, true);
});

check('英文句点句尾保留空格，不会粘成 world.Next', () => {
  const got = T.firstSentences('Hello world. Next sentence.', 100, 2);
  assert.equal(got.text, 'Hello world. Next sentence.');
  assert.equal(got.cut, false);
});

check('小数/版本号里的点不算句号', () => {
  const got = T.firstSentences('圆周率约 3.14，够用了。下一句。', 100, 1);
  assert.equal(got.text, '圆周率约 3.14，够用了。');
  assert.equal(got.cut, true);
});

check('收尾引号跟着上一句走', () => {
  const got = T.firstSentences('“走吧。”他说。', 100, 1);
  assert.equal(got.text, '“走吧。”');
  assert.equal(got.cut, true);
});

check('没有句号的整段：按字数截断', () => {
  const got = T.firstSentences('一二三四五六七八九十', 4, 2);
  assert.equal(got.text, '一二三四');
  assert.equal(got.cut, true);
});

check('超长正文只归一化开头一段，后面还有内容就补省略号', () => {
  const got = T.firstSentences('短句。' + 'x'.repeat(5000), 10000, 2);
  assert.equal(got.text.slice(0, 3), '短句。');
  assert.ok(got.text.length <= 2400, 'only the opening stretch is scanned');
  assert.equal(got.cut, true);
});

check('空正文/纯空白返回空串，由调用方给占位文案', () => {
  assert.deepEqual(T.firstSentences('', 80, 2), { text: '', cut: false });
  assert.deepEqual(T.firstSentences('  \n\n　', 80, 2), { text: '', cut: false });
});

// --- wiring / static checks ------------------------------------------------
check('不用点开：每一章都带详情（主树 + 孤儿兜底两处）', () => {
  const hits = shelfSrc.split('detail: makeDetail(ch)').length - 1;
  assert.equal(hits, 2, `expected 2 detail hooks, found ${hits}`);
  assert.ok(!shelfSrc.includes('isActive ? makeDetail'), 'detail is not gated on the active row');
  assert.ok(shelfSrc.includes("if (detail) classes.push('has-detail');"), 'row marks itself has-detail');
});

check('摘要按章缓存：正文/宽度/时间戳变了才重算', () => {
  assert.ok(shelfSrc.includes('const detailCacheRef = React.useRef(new Map());'), 'per-chapter detail cache exists');
  assert.ok(shelfSrc.includes('cached.chars === detailChars'), 'cache misses when the width bucket changes');
  assert.ok(shelfSrc.includes('cached.content === ch.content'), 'cache misses when the body changes');
  assert.ok(shelfSrc.includes('cached.updatedAt === ch.updatedAt'), 'cache refreshes the last-edited stamp');
  assert.ok(shelfSrc.includes('cached.value'), 'cache keeps the same detail object so ShelfRow.memo holds');
  assert.ok(
    shelfSrc.includes('firstSentences(ch.content, detailChars, detailSentences)'),
    'narrow rows ask for one sentence, wide rows for two',
  );
});

check('行结构：第一行独立成块，动作条锚在它里面', () => {
  assert.ok(shelfSrc.includes("className: 'nw-shelf-row-main'"), 'row-main wrapper exists');
  assert.ok(shelfSrc.includes("'aria-level': p.depth + 1"), 'treeitem keeps its aria-level');
});

check('详情用 11px 更小字，窄栏一行、宽栏两行，并随宽度换时间精度', () => {
  const css = shelfSrc.slice(shelfSrc.indexOf('NW.CSS_PARTS.push('));
  assert.ok(css.includes('.nw-shelf-row-detail{'), 'detail CSS block exists');
  assert.ok(css.includes('font-size:11px'), 'detail type is smaller than the 12px token');
  assert.ok(css.includes('line-height:1.45'), 'detail line-height tightens with the smaller type');
  assert.ok(css.includes('-webkit-line-clamp:2'), 'wide rows clamp to two lines');
  assert.ok(
    css.includes('.nw-shelf-row-detail[data-wide="0"] .nw-shelf-detail-excerpt'),
    'narrow rows have their own excerpt rule',
  );
  assert.ok(css.includes('-webkit-line-clamp:1'), 'narrow rows clamp to one line');
  assert.ok(css.includes('flex-wrap:wrap'), 'the time line wraps instead of overflowing');
  // R112: the time line reads as metadata, the excerpt as body copy.
  assert.ok(css.includes('.nw-shelf-detail-times{'), 'the time line has its own rule');
  assert.ok(
    /\.nw-shelf-detail-times\{[^}]*font-size:10\.5px/.test(css),
    'the time line is a notch smaller than the excerpt',
  );
  assert.ok(
    /\.nw-shelf-detail-excerpt\{[^}]*color:var\(--nw-fg\);/.test(css),
    'the excerpt uses the body colour, not the muted meta colour',
  );
  // R111: the excerpt box must not grow/shrink with its text, otherwise typing
  // in the editor changes the shelf row height and the page looks like it jumps.
  assert.ok(css.includes('height:calc(2 * 1.45em)'), 'wide excerpt reserves exactly two lines');
  assert.ok(
    css.includes('.nw-shelf-row-detail[data-wide="0"] .nw-shelf-detail-excerpt') &&
      /\[data-wide="0"\][^{]*\{[^}]*height:1\.45em/.test(css),
    'narrow excerpt reserves exactly one line',
  );
  assert.ok(css.includes('scrollbar-gutter:stable'), 'the shelf scrollbar lane is reserved');
});

check('宽度测量用 ResizeObserver，且只在宽度变化后才换档', () => {
  assert.ok(shelfSrc.includes('new ResizeObserver(measure)'), 'ResizeObserver observes the shelf');
  assert.ok(shelfSrc.includes('Math.abs(prev - w) >= 8'), 'width updates are quantised');
  assert.ok(shelfSrc.includes('detailWide = detailWidth >= 340'), 'there is a wide/narrow split');
});

check('没有首次记录时按今年 1 月 1 日显示，不再回退创建时间', () => {
  assert.ok(shelfSrc.includes('const hasFirst = Number(ch.firstEditAt) > 0;'), 'the row tells recorded and old chapters apart');
  assert.ok(
    shelfSrc.includes('new Date(new Date().getFullYear(), 0, 1).getTime()'),
    'missing firstEditAt falls back to the start of this year',
  );
  assert.ok(!shelfSrc.includes('Number(ch.firstEditAt) || Number(ch.createdAt)'), 'createdAt is no longer the first-edit fallback');
  assert.ok(shelfSrc.includes('首次编辑时间未记录，按今年年初显示'), 'the tooltip explains the synthetic stamp');
});

check('只是打开/切换章节时，不改写「最后编辑」', () => {
  const app = read('90-app.js');
  assert.ok(app.includes('const chaptersRef = useRef(chapters);'), 'the whole chapter list is reachable from a late flush');
  assert.ok(app.includes('text === String(known.content == null ? \'\' : known.content)'), 'an unchanged flush is detected');
  assert.ok(app.includes('if (\n          known &&\n          !known.locked'), 'locked bodies still go through the save path');
});

check('保存正文后立刻更新 updatedAt / firstEditAt', () => {
  const app = read('90-app.js');
  assert.ok(app.includes('const savedAt = Date.now();'), 'saveChapter stamps its own clock');
  assert.ok(app.includes('row.firstEditAt ? null : { firstEditAt: savedAt }'), 'firstEditAt is written once');
  assert.ok(app.includes('updatedAt: savedAt'), 'updatedAt is patched into the chapter list');
});

check('数据库在第一次真正保存正文时记 firstEditAt', () => {
  const db = read('10-db.js');
  assert.ok(db.includes('if (!next.firstEditAt) next.firstEditAt = stamp;'), 'save path records firstEditAt');
  assert.ok(db.includes('if (text) chapter.firstEditAt = stamp;'), 'import with body records firstEditAt');
});

check('编辑器滚动条占位固定，避免临界时宽度来回跳', () => {
  const editor = read('60-editor.js');
  assert.ok(editor.includes('.nw-scroll{'), '.nw-scroll rule exists');
  assert.ok(editor.includes('scrollbar-gutter:stable'), 'editor reserves the scrollbar lane');
  assert.ok(editor.includes('overflow-anchor:none'), 'scroll anchoring cannot shift the page');
});

check('本地目录写入对瞬时 Windows 文件锁重试', () => {
  const library = readFileSync(join(HERE, '..', 'lib', 'library.js'), 'utf8');
  assert.ok(library.includes("const TRANSIENT_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'])"), 'transient codes are listed');
  assert.ok(library.includes('async function retryTransient(work, attempts = 4)'), 'retry helper exists');
  assert.ok(library.includes('return retryTransient(async () => {'), 'writeBytesFile is retried');
  assert.ok(library.includes("console.warn('[novel-writer] mirror failed:', error)"), 'the host logs the real cause');
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
