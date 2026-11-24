#!/usr/bin/env node
/**
 * R203/R204: 标注小卡的三组约定，截图看不出来，源码扫描也看不出来。
 *
 *   node scripts/verify-mark-card.mjs [bundle]
 *
 * 1. 「接受 / 拒绝」既上下排（R194），又贴右边。排成列以后按钮的交叉轴是**宽度**，
 *    默认 stretch 把两颗都拉成整卡宽（实测 188px / 200px 卡），所以光有
 *    `flex-direction:column` 并不能得到「靠右」——只差 `align-items:flex-end`
 *    一个关键字，删掉也没人报错。
 *
 * 2. 点页边签弹出的卡，每次都要落在**同一处**。签只有 16px 宽，而老代码按
 *    `ev.clientX/Y` 算位置：同一个签，点它左上角还是右下角，卡片能差 16px，
 *    用户看到的就是「每次点击，位置都有稍微的变化」。修法是把卡锚到签自己的
 *    盒子上（markCardSpotAt）。
 *
 * 3. R204：卡片改成「鼠标聚焦展开、失焦收起」，批注横过来排（正文在左、按钮在
 *    右），正文再长也不许撑高卡片。这三件事都没有返回值可断言——所以第 1 组读
 *    CSS 规则体，第 2 组把随 bundle 出厂的距离函数喂进假几何真算一遍，第 3 组把
 *    「收起」的调度函数喂进假时钟，验它的宽限期、去重和撤销。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = process.argv[2] ? resolve(process.argv[2]) : join(root, 'client', 'client.js');
const code = readFileSync(target, 'utf8');

let passed = 0;
const problems = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    problems.push(`${name}: ${error && error.message ? error.message : error}`);
    console.log(`  FAIL ${name}`);
    console.log(`       ${error && error.message ? error.message : error}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// 1. the CSS half: stacked AND flush right
// ---------------------------------------------------------------------------
/** Body of the rule whose selector starts its own line (so compact overrides
 *  like `.nw-mark-view[data-compact="1"] .nw-mark-view-acts` never match). */
function ruleBody(selector) {
  const at = code.indexOf('\n' + selector + '{');
  if (at < 0) return null;
  const start = at + selector.length + 2;
  const end = code.indexOf('}', start);
  return end < 0 ? null : code.slice(start, end);
}

check('「接受/拒绝」仍然上下排', () => {
  const body = ruleBody('.nw-mark-view-acts');
  assert(body !== null, '找不到 .nw-mark-view-acts 规则');
  assert(/flex-direction:\s*column/.test(body), '按钮不再上下排（flex-direction 不是 column）');
});

check('按钮贴右缘，不再撑满整卡宽', () => {
  const body = ruleBody('.nw-mark-view-acts');
  assert(body !== null, '找不到 .nw-mark-view-acts 规则');
  assert(
    /align-items:\s*flex-end/.test(body),
    '列容器的交叉轴默认 stretch：按钮会被拉成整卡宽，「靠右」也就没了',
  );
  const btn = ruleBody('.nw-mark-view-btn');
  assert(btn !== null, '找不到 .nw-mark-view-btn 规则');
  assert(!/flex:\s*1 1 auto/.test(btn), '按钮又变回 1 1 auto（会被拉伸）');
  assert(/flex:\s*0 0 auto/.test(btn), '按钮应取自身宽度（flex:0 0 auto）');
});

check('紧凑卡（删除线/下划线）只有一个按钮的宽度', () => {
  const body = ruleBody('.nw-mark-view[data-compact="1"] .nw-mark-view-btn');
  assert(body !== null, '找不到紧凑卡的按钮规则');
  assert(/padding:0 12px/.test(body), '紧凑卡按钮的内边距被改掉了');
});

// ---------------------------------------------------------------------------
// 2. the behaviour half: placement is a function of the sign, not of the click
// ---------------------------------------------------------------------------
/** Cut one whole `function name(...) { ... }` out of the bundle. */
function sourceOf(name) {
  const at = code.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const open = code.indexOf('{', at);
  if (open < 0) return null;
  const end = braceEnd(code, open);
  return end < 0 ? null : code.slice(at, end);
}

/** Index just past the brace that closes `openAt`, skipping strings/comments. */
function braceEnd(text, openAt) {
  let depth = 0;
  let quote = '';
  let i = openAt;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

const SOURCES = ['markAnchorOf', 'markCardSpotAt', 'openMarkView'].map(sourceOf);
if (SOURCES.some((src) => !src)) {
  console.error('verify-mark-card: bundle 里找不到 markAnchorOf / markCardSpotAt / openMarkView');
  process.exit(1);
}

// The three functions are rebuilt with their free variables as parameters, so
// the test drives the shipped arithmetic and nothing else.
const build = new Function(
  'stackRef',
  'hlRef',
  'gutterRef',
  'setMarkView',
  'clampNum',
  'MARK_CARD_GAP',
  'window',
  `${SOURCES.join('\n\n')}
  return { markAnchorOf: markAnchorOf, markCardSpotAt: markCardSpotAt, openMarkView: openMarkView };`,
);

/** The paper sits at (100, 40) and is 600 wide; the sign hugs its right edge. */
const PAPER = { left: 100, top: 40, width: 600, height: 800 };
const SIGN = { left: 660, top: 350, width: 16, height: 16 };
const sign = { getBoundingClientRect: () => SIGN };
const empty = { querySelector: () => null, querySelectorAll: () => [] };

function makeWorld() {
  const calls = [];
  const stack = { scrollHeight: 2400, getBoundingClientRect: () => PAPER };
  const api = build(
    { current: stack },
    { current: empty },
    { current: empty },
    (next) => calls.push(next),
    (value, lo, hi) => Math.min(hi, Math.max(lo, value)),
    6,
    { innerHeight: 900 },
  );
  return { api, calls };
}

check('签的盒子换算成纸面坐标', () => {
  const { api } = makeWorld();
  const anchor = api.markAnchorOf(sign);
  assert(anchor !== null, 'markAnchorOf 对真实盒子返回了 null');
  assert(anchor.left === SIGN.left - PAPER.left, `anchor.left 应为 ${SIGN.left - PAPER.left}，实得 ${anchor.left}`);
  assert(anchor.top === SIGN.top - PAPER.top, `anchor.top 应为 ${SIGN.top - PAPER.top}，实得 ${anchor.top}`);
});

check('卡右缘离签 6px，垂直与签居中', () => {
  const { api } = makeWorld();
  const anchor = api.markAnchorOf(sign);
  const w = 200;
  const h = 81;
  const spot = api.markCardSpotAt(anchor, w, h);
  assert(spot.left + w === anchor.left - 6, `卡右缘应贴着签左侧 6px，实得 gap=${anchor.left - (spot.left + w)}`);
  const cardMid = spot.top + h / 2;
  const signMid = anchor.top + anchor.height / 2;
  assert(Math.abs(cardMid - signMid) <= 1, `卡中心 ${cardMid} 与签中心 ${signMid} 相差超过 1px`);
});

check('同一个签、不同的落点 → 同一个位置（用户说的「位置有稍微变化」）', () => {
  const a = makeWorld();
  const b = makeWorld();
  const mark = { id: 7, kind: 'comment', note: '这句话太长了' };
  // Both clicks are inside the same 16×16 sign, 5px apart diagonally.
  a.api.openMarkView(mark, { clientX: 662, clientY: 352 }, sign);
  b.api.openMarkView(mark, { clientX: 674, clientY: 364 }, sign);
  assert(a.calls.length === 1 && b.calls.length === 1, 'openMarkView 没有落下位置');
  assert(
    a.calls[0].left === b.calls[0].left && a.calls[0].top === b.calls[0].top,
    `两次点击落点不同：(${a.calls[0].left},${a.calls[0].top}) vs (${b.calls[0].left},${b.calls[0].top})`,
  );
});

check('落点带着 anchor，量到真尺寸后还能再算一次', () => {
  const world = makeWorld();
  world.api.openMarkView({ id: 7, kind: 'comment', note: 'x' }, { clientX: 662, clientY: 352 }, sign);
  const state = world.calls[0];
  assert(state && state.anchor, 'state 里没有 anchor，layout effect 无法按真尺寸重算');
  assert(state.anchor.left === SIGN.left - PAPER.left, 'anchor 不是纸面坐标');
});

check('紧凑卡（删除线）也按签落位，且比批注卡更贴近签', () => {
  const wide = makeWorld();
  const slim = makeWorld();
  wide.api.openMarkView({ id: 7, kind: 'comment', note: 'x' }, { clientX: 662, clientY: 352 }, sign);
  slim.api.openMarkView({ id: 8, kind: 'strike' }, { clientX: 662, clientY: 352 }, sign);
  assert(slim.calls[0].anchor, '删除线卡没有按签落位');
  assert(slim.calls[0].left > wide.calls[0].left, '窄卡应更靠近签（left 更大）');
});

check('点正文里的一条线时，仍按点击处落位（没被 R203 改坏）', () => {
  const near = makeWorld();
  const far = makeWorld();
  const mark = { id: 9, kind: 'strike' };
  near.api.openMarkView(mark, { clientX: 200, clientY: 300 });
  far.api.openMarkView(mark, { clientX: 320, clientY: 300 });
  assert(near.calls[0].left < far.calls[0].left, '点正文时卡片不再跟着落点了');
  assert(!near.calls[0].anchor, '点正文时不该有 anchor');
});

check('卡片不会跑到纸面外（左右两条边界）', () => {
  const { api } = makeWorld();
  const leftEdge = api.markCardSpotAt({ left: 12, top: 400, width: 16, height: 16 }, 200, 81);
  assert(leftEdge.left >= 8, `左边界失效：left=${leftEdge.left}`);
  const topEdge = api.markCardSpotAt({ left: 500, top: 2, width: 16, height: 16 }, 200, 81);
  assert(topEdge.top >= 8, `上边界失效：top=${topEdge.top}`);
});

// ---------------------------------------------------------------------------
// 3. R204: 横排 + 不撑高 + 「聚焦展开、失焦收起」
// ---------------------------------------------------------------------------
check('批注横排：正文在左、按钮列在右', () => {
  const card = ruleBody('.nw-mark-view');
  assert(card !== null, '找不到 .nw-mark-view 规则');
  assert(/flex-direction:\s*row/.test(card), '卡片又变回竖排（正文会压在按钮上面）');
  const acts = ruleBody('.nw-mark-view-acts');
  assert(acts !== null, '找不到 .nw-mark-view-acts 规则');
  assert(/flex:\s*0 0 auto/.test(acts), '按钮列应不参与压缩（flex:0 0 auto），否则批注一长按钮就被挤窄');
});

check('批注再长也不撑高卡片，而且没有滚动条', () => {
  const note = ruleBody('.nw-mark-view-note');
  assert(note !== null, '找不到 .nw-mark-view-note 规则');
  assert(/max-height:\s*\d+px/.test(note), '正文没有高度上限：长批注会把卡片撑高');
  assert(/overflow-y:\s*auto/.test(note), '正文不能滚（overflow-y 不是 auto）');
  assert(/scrollbar-width:\s*none/.test(note), '没藏滚动条（scrollbar-width:none）');
  const bar = ruleBody('.nw-mark-view-note::-webkit-scrollbar');
  assert(bar !== null, '找不到 ::-webkit-scrollbar 规则：Chromium 上会冒出灰色长条');
  assert(/display:\s*none/.test(bar) || /width:\s*0/.test(bar), 'webkit 滚动条没有被隐藏');
});

check('全局细滚动条规则把批注正文排除在外（否则 8px 灰条会盖回来）', () => {
  const hits = code.match(/:not\(\.nw-mark-view-note\)/g) || [];
  assert(hits.length >= 6, `98c-signature.js 的全局滚动条规则只排除了 ${hits.length} 处，应把 6 条（含 ::-webkit-scrollbar 各伪元素）都排除`);
});

check('页边签挂的是「进入/离开」和键盘焦点，而不只是 click', () => {
  assert(/'pointerenter'/.test(code), '签上没有挂 pointerenter，鼠标停上去不会展开');
  assert(/'pointerleave'/.test(code), '签上没有挂 pointerleave，移开不会收起');
  assert(/addEventListener\('focus'/.test(code) && /addEventListener\('blur'/.test(code), '签上没有键盘焦点入口');
  assert(/openMarkViewForSign/.test(code), '签的入口没走 openMarkViewForSign');
});

check('卡片自己认指针：从签走进卡片不能被当成「移开」', () => {
  assert(/onPointerEnter/.test(code) && /onPointerLeave/.test(code), '卡片上没有 onPointerEnter / onPointerLeave');
  assert(/cancelMarkClose/.test(code), '卡片没有撤销收起的入口');
  assert(/closest\('\.nw-mark-side'\)/.test(code), '焦点从卡片回到签上时会把卡片关掉（缺 .nw-mark-side 的豁免）');
});

const CLOSE_SRC = ['cancelMarkClose', 'scheduleMarkClose'].map(sourceOf);
const OPEN_SRC = sourceOf('openMarkViewForSign');
if (CLOSE_SRC.some((src) => !src) || !OPEN_SRC) {
  console.error('verify-mark-card: bundle 里找不到 cancelMarkClose / scheduleMarkClose / openMarkViewForSign');
  process.exit(1);
}

/** A clock that only moves when the test says so. */
function clock() {
  const timers = [];
  let seq = 0;
  return {
    window: {
      setTimeout(fn, ms) {
        seq += 1;
        timers.push({ id: seq, fn, ms });
        return seq;
      },
      clearTimeout(target) {
        const at = timers.findIndex((entry) => entry.id === target);
        if (at >= 0) timers.splice(at, 1);
      },
    },
    timers,
    fire() {
      const due = timers.splice(0);
      for (const entry of due) entry.fn();
    },
    delays() {
      return timers.map((entry) => entry.ms);
    },
  };
}

const buildClose = new Function(
  'markCloseTimerRef',
  'closeMarkView',
  'MARK_HOVER_GRACE',
  'window',
  `${CLOSE_SRC.join('\n\n')}
  return { cancelMarkClose: cancelMarkClose, scheduleMarkClose: scheduleMarkClose };`,
);

const buildOpen = new Function(
  'markCloseTimerRef',
  'cancelMarkClose',
  'markViewRef',
  'openMarkView',
  `${OPEN_SRC}
  return openMarkViewForSign;`,
);

check('移开指针先等 150ms 再收起（留出跨过 6px 缝的时间）', () => {
  const c = clock();
  const timer = { current: 0 };
  let closes = 0;
  const api = buildClose(timer, () => { closes += 1; }, 150, c.window);
  api.scheduleMarkClose();
  assert(c.timers.length === 1, `应排一个收起定时器，实有 ${c.timers.length} 个`);
  assert(c.delays()[0] === 150, `宽限期应为 150ms，实得 ${c.delays()[0]}ms`);
  assert(closes === 0, '还没到时间就把卡片关了');
  c.fire();
  assert(closes === 1, '定时器到点后卡片没有收起');
  assert(timer.current === 0, '收起之后没把 ref 归零，下一个定时器会误清');
});

check('指针走进卡片就撤销收起；反复移开不会攒出多个定时器', () => {
  const c = clock();
  const timer = { current: 0 };
  let closes = 0;
  const api = buildClose(timer, () => { closes += 1; }, 150, c.window);
  api.scheduleMarkClose();
  api.scheduleMarkClose();
  assert(c.timers.length === 1, `重复调度应只留一个定时器，实有 ${c.timers.length} 个`);
  api.cancelMarkClose();
  assert(c.timers.length === 0, 'cancelMarkClose 没有清掉定时器');
  assert(timer.current === 0, 'cancelMarkClose 没有把 ref 归零');
  c.fire();
  assert(closes === 0, '撤销之后卡片仍然被关掉了');
});

check('同一枚签再触发一次（悬停后紧跟 click）不会重建卡片', () => {
  const timer = { current: 0 };
  const ref = { current: { mark: { id: 7 }, left: 1, top: 2, anchor: {} } };
  const opened = [];
  const api = buildOpen(timer, () => {}, ref, (...args) => opened.push(args));
  const sign = { id: 'sign-7' };
  api({ id: 7, kind: 'comment' }, {}, sign);
  assert(opened.length === 0, '卡片已经开着，却又开了一次（会在指针下闪一下）');
  api({ id: 8, kind: 'strike' }, {}, sign);
  assert(opened.length === 1, '换一枚签时应重新开卡');
  assert(opened[0][2] === sign, '换签开卡时没有把签当作锚点传进去');
});

// ---------------------------------------------------------------------------
console.log('');
if (problems.length) {
  console.log(`verify-mark-card: ${problems.length} 处问题，${passed} 项通过`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log(`verify-mark-card: ${passed} 项全通过`);
