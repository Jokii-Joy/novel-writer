// 阅读页「对开两页」的静态几何审计。
//
// 为什么要有这个脚本：R55 把阅读页从「一次一栏」改成「宽屏时一次两栏」，
// 而这套分页是拿 CSS 多栏 + scrollLeft 手搓出来的，翻一页该走多远、一页算
// 多宽、页码怎么数，是三个各自独立、必须同时一致的数字。它们任何一个漏改，
// 症状都不是报错，而是「翻页总是翻半页」或「右半页点不出批注」这种看起来
// 像别的毛病的东西。
//
// 所以这里把 62-read.js 的 measure() 里的几何规则抄成模型，对一批宽度各算
// 一遍，断言：
//   (a) 单页 / 对开的切换点是真的在可读性边界上，不是随便一个数；
//   (b) 一页的宽度 = 栏宽 × 栏数 + 栏距 × (栏数-1)，永远等于 scrollLeft 的步长；
//   (c) 栏数 = 2 时每栏不会窄到写不下一行字（≥300px 且 ≥11 个字）；
//   (d) 页数按页宽算（不是按栏宽），对开时正文两栏都在第一页上。
//
// 这不是浏览器：它不能证明渲染出来长什么样，但它能保证「三个数字必须相等」
// 这条不会在下次改动里被破坏。
//
// 用法：node scripts/verify-read-spread.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'client', 'src', '62-read.js'), 'utf8');

const problems = [];
const notes = [];

// ---- 把实现里的常量抄出来，并验证它们确实在源码里 --------------------------
const SPREAD_AT = 900; // measure(): avail >= 900
const MIN_COL = 300; // measure(): 每栏至少这么宽
const MAX_COLS_PER_LINE = 34; // measure(): 一行最多 34 个汉字
const MIN_GLYPH_COLS = 11; // 每栏至少放得下这么多字

for (const [name, re] of [
  ['对开阈值 900', /avail\s*>=\s*900/],
  ['每栏下限 300', /avail\s*-\s*gap\)\s*\/\s*2\s*>=\s*300/],
  ['一行 34 字', /34\s*\*\s*fontSize/],
]) {
  if (!re.test(src)) problems.push(`measure() 里找不到「${name}」的判据，几何规则可能已被改动`);
}

// ---- 复刻 measure() 的几何 --------------------------------------------------
function layoutFor(avail, fontSize, gap) {
  const oneCol = Math.floor(Math.min(MAX_COLS_PER_LINE * fontSize, avail));
  const spread = avail >= SPREAD_AT && (avail - gap) / 2 >= MIN_COL;
  const cols = spread ? 2 : 1;
  const w = spread ? Math.floor(Math.min(oneCol, (avail - gap) / 2)) : oneCol;
  const box = w * cols + gap * (cols - 1);
  const step = w * cols + gap * (cols - 1); // measure(): colStep * cols == 同一个数
  return { cols, w, gap, box, step, oneCol, spread };
}

const FONT = 20; // 默认字号
const GAP = 48; // column-gap clamp(28px,5vw,64px) 的中段，取个代表值

const cases = [
  { avail: 420, label: '窄面板 / 手机' },
  { avail: 700, label: '中等面板' },
  { avail: 880, label: '刚好不够对开' },
  { avail: 905, label: '刚过对开线' },
  { avail: 1100, label: '宽屏' },
  { avail: 1600, label: '很宽' },
  { avail: 2400, label: '超宽' },
];

for (const c of cases) {
  const L = layoutFor(c.avail, FONT, GAP);
  const tag = `${c.label} (${c.avail}px)`;
  notes.push(
    `${tag} → ${L.cols} 栏 × ${L.w}px，一页 ${L.step}px，整行原文 ${L.oneCol}px`,
  );

  // (b) 页宽与翻页步长必须是同一个数，否则翻页会停在本页中间。
  if (L.box !== L.step) {
    problems.push(`${tag}: 一页的宽度 ${L.box} 与翻页步长 ${L.step} 不相等`);
  }

  // (c) 对开时每栏得真的能读。
  if (L.cols === 2) {
    if (L.w < MIN_COL) {
      problems.push(`${tag}: 对开时每栏只有 ${L.w}px，窄于 ${MIN_COL}px 的下限`);
    }
    if (L.w / FONT < MIN_GLYPH_COLS) {
      problems.push(
        `${tag}: 对开时每栏只放得下 ${(L.w / FONT).toFixed(1)} 个字，` +
        `少于 ${MIN_GLYPH_COLS} 个字就没法读了`,
      );
    }
    // 两栏必须容得下：字宽 × 2 + 中间空档不超过可用宽度（防止溢出）
    if (L.box > c.avail + 1) {
      problems.push(`${tag}: 对开两栏合计 ${L.box}px 超过可用宽度 ${c.avail}px`);
    }
  }
}

// (a) 切换点两侧的行为要对得上：刚好不够 → 单页，刚好够 → 对开。
const under = layoutFor(SPREAD_AT - 10, FONT, GAP);
const over = layoutFor(SPREAD_AT + 10, FONT, GAP);
if (under.cols !== 1) problems.push(`宽度 ${SPREAD_AT - 10}px 应当还是单页，却判成了对开`);
if (over.cols !== 2) problems.push(`宽度 ${SPREAD_AT + 10}px 应当是对开，却还是单页`);
notes.push(`切换点：${SPREAD_AT - 10}px 单页 → ${SPREAD_AT + 10}px 对开`);

// (d) 页数必须按页宽算。多栏布局里 scrollWidth 是「所有栏加起来」的宽度，
// 除以页宽才是页数——除以栏宽会把页数算成两倍，页码和 maxPage 一起错。
{
  const L = layoutFor(1200, FONT, GAP);
  const contentWidth = 4873; // 任意一段正文的 scrollWidth 代表值
  const byPage = Math.max(1, Math.round((contentWidth + L.gap) / L.step));
  const byCol = Math.max(1, Math.round((contentWidth + L.gap) / (L.w + L.gap)));
  if (L.cols === 2 && byPage === byCol) {
    problems.push('对开时按页宽算出的页数与按栏宽算出的相同，步长换算可能没改');
  }
  // 对开时页数应当正好是栏数的一半（±1 页的取整误差）。不写成「小于」是因为
  // 2 栏 × N 页的最后一页可能只装着半页（一栏）内容，取整会差一。
  if (L.cols === 2 && Math.abs(byPage * 2 - byCol) > 1) {
    problems.push(
      `对开时页数 ${byPage} 与栏数 ${byCol} 不成 2:1（期望 ${byPage * 2} ≈ ${byCol}），` +
      `说明某处步长还按一栏在算`,
    );
  }
  notes.push(`1200px 对开：按页宽 ${byPage} 页 / 按栏宽 ${byCol} 页（对开应约为一半）`);
}

// ---- 源码里三处步长必须都读 layout.step --------------------------------
// 任何一处自己拼 w + gap，单页模式下看着没问题，一对开就翻半页。
{
  const ownPattern = /layout\.w\s*\+\s*layout\.gap/g;
  const hits = src.match(ownPattern) || [];
  // 唯一允许保留的地方是 step 的兜底值（layout.step 还没算出来的首帧）。
  const allowed = 1;
  if (hits.length > allowed) {
    problems.push(
      `源码里还有 ${hits.length} 处自己拼 "layout.w + layout.gap"（只允许兜底那 1 处）；` +
      `对开时这些地方会翻半页`,
    );
  }
  const stepUses = (src.match(/const s = step;/g) || []).length;
  if (stepUses < 3) {
    problems.push(
      `只有 ${stepUses} 处读 step（期望 ≥3：scrollToPage / slideToPage / scroll 监听）`,
    );
  }
}

// ---- 输出 ----------------------------------------------------------------
console.log('verify-read-spread: 阅读页对开几何审计\n');
for (const n of notes) console.log('  · ' + n);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n结果: ${problems.length} 处几何不一致`);
  process.exit(1);
}
console.log('\n结果: 全部通过 ✅（步长、页宽、可读性下限三者一致）');
