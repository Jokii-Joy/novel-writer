#!/usr/bin/env node
/**
 * R203: 标注小卡的两条约定，截图看不出来，源码扫描也看不出来。
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
 * 第 2 条不能靠正则断言——它要真的算一遍。所以这段测试把 **bundle 里的**
 * markAnchorOf / markCardSpotAt / openMarkView 抠出来，喂进假几何里执行：
 * 同一个签、两个不同的落点，位置必须完全一致；点正文时仍按点击处落。
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
console.log('');
if (problems.length) {
  console.log(`verify-mark-card: ${problems.length} 处问题，${passed} 项通过`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log(`verify-mark-card: ${passed} 项全通过`);
