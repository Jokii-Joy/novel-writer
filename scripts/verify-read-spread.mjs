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
const SPREAD_AT = 840; // measure(): avail >= 840 才有对开（R136 从 900 降下来）
const MIN_COLS_PER_PAGE = 1;
const MAX_COLS_PER_PAGE = 2;
const MIN_GLYPH_COLS = 15; // R136: 双栏的最低门槛（15 字 ≈ 300px，原 17 字卡死了 760 面板）
const MIN_GLYPH_COLS_WIDE = 12; // R138: 对开四栏（一屏两页、一页两栏）的门槛（12 字 ≈ 240px；四栏是摊开的书，栏短一点反而像书页，原 22/18 字让 1440–1920 的整屏都开不出四栏）
const MAX_GLYPH_COLS = 30; // R128: 双栏的上限（再宽就成碎片句子）
const SINGLE_MAX_GLYPH_COLS = 34;

for (const [name, re] of [
  // R125：阅读页改成「每页两栏」，几何由四档计划决定（对开四栏 → 单页两栏 →
  // 对开一栏 → 单页一栏），所以判据不再是写死的 900/300。
  ['对开阈值 840', /if \(pages === 2 && avail < 840\) continue;/],
  ['单栏 22 字下限', /const minCol = Math\.round\(22 \* fontSize\);/],
  ['双栏 15 字下限', /const minCol2 = Math\.round\(15 \* fontSize\);/],
  ['对开四栏 12 字下限', /const minColWide = Math\.round\(12 \* fontSize\);/],
  ['双栏 30 字上限', /const maxCol = Math\.round\(30 \* fontSize\);/],
  ['四档计划', /\[\[2, 2\], \[1, 2\], \[2, 1\], \[1, 1\]\]/],
  ['栏数设置', /const readColumns = clampNum\(numOf\(settings\.readColumns, 2\), 1, 2\)/],
  ['一行 34 字', /34\s*\*\s*fontSize/],
  ['双栏用更低门槛', /const floor = texts >= 2\s*\?\s*\(pages === 2 \? minColWide : minCol2\)\s*:\s*minCol;/],
]) {
  if (!re.test(src)) problems.push(`measure() 里找不到「${name}」的判据，几何规则可能已被改动`);
}

// R128：换章不再强开新栏，否则一章只剩一两行时那一栏空一大片。改由留白与
// 装饰交代换章，但标题必须跟着开头几行一起走（break-after:avoid）。
for (const [name, re] of [
  ['换章不再强制分栏', /\.nw-read-chapter \+ \.nw-read-chapter\{[^}]*break-before:auto;/],
  ['换章留白', /\.nw-read-chapter \+ \.nw-read-chapter\{[^}]*margin-top:3\.4em;/],
  ['章首第一段不拆开', /\.nw-read-chapter > \.nw-read-p:first-of-type\{text-indent:0;break-inside:avoid;\}/],
]) {
  if (!re.test(src)) problems.push(`CSS 里找不到「${name}」，排版规则可能已被改动`);
}

// 眉题按 (栏, 行) 两个坐标查章：换章能发生在栏中间，只按 left 查会把整栏算给
// 后来那一章。
for (const [name, re] of [
  ['章起始记 left', /left: el\.offsetLeft \|\| 0,/],
  ['章起始记 top', /top: el\.offsetTop \|\| 0,/],
  ['查章用行列两坐标', /sLeft < x - 1 \|\| \(Math\.abs\(sLeft - x\) <= 1 && sTop <= 2\)/],
]) {
  if (!re.test(src)) problems.push(`眉题查章找不到「${name}」，四栏时会把章名算错`);
}

// R137：全屏阅读。`.nw-root` 带 container-type（布局隔离），它自己就是 fixed
// 后代的包含块——所以「整屏」这件事必须由 `.nw-root.nw-reading` 来做，只改
// `.nw-read` 的 position 是铺不满的。两条一起断言，缺一条就退回一列。
for (const [name, re] of [
  ['开卷时整块面板提到视口', /\.nw-root\.nw-reading\{position:fixed;inset:0;/],
]) {
  if (!re.test(src)) problems.push(`CSS 里找不到「${name}」，阅读页会退回插件那一列`);
}
{
  const app = readFileSync(join(here, '..', 'client', 'src', '90-app.js'), 'utf8');
  if (!/\(readOpen && activeNovelId \? ' nw-reading' : ''\)/.test(app)) {
    problems.push("90-app.js 没有在开卷时给 .nw-root 挂 nw-reading，整屏阅读不生效");
  }
  notes.push('全屏：开卷时 .nw-root 提到 fixed inset:0（container-type 会困住 fixed 后代）');
}

// ---- 复刻 measure() 的几何（R125 的四档计划 + R128 的双栏门槛） -------------
function layoutFor(avail, fontSize, gap, readColumns = 2) {
  const maxCol = Math.round(MAX_GLYPH_COLS * fontSize);
  const minCol = Math.round(22 * fontSize);
  const minCol2 = Math.round(MIN_GLYPH_COLS * fontSize);
  const minColWide = Math.round(MIN_GLYPH_COLS_WIDE * fontSize);
  const fitCol = (pages, texts) => {
    const total = pages * texts;
    return Math.floor((avail - gap * (total - 1)) / total);
  };
  const plan = readColumns >= 2 ? [[2, 2], [1, 2], [2, 1], [1, 1]] : [[2, 1], [1, 1]];
  let cols = 1;
  let textCols = 1;
  let colW = 0;
  for (const [pages, texts] of plan) {
    if (pages === 2 && avail < SPREAD_AT) continue;
    const candidate = fitCol(pages, texts);
    const floor = texts >= 2 ? (pages === 2 ? minColWide : minCol2) : minCol;
    if (candidate < floor) continue;
    cols = pages;
    textCols = texts;
    colW = Math.min(candidate, texts >= 2 ? maxCol : Math.round(SINGLE_MAX_GLYPH_COLS * fontSize));
    break;
  }
  if (!colW) {
    cols = 1;
    textCols = 1;
    colW = Math.max(160, Math.floor(Math.min(SINGLE_MAX_GLYPH_COLS * fontSize, avail)));
  }
  const w = colW * textCols + gap * (textCols - 1); // 一页正文宽
  const step = w + gap; // 翻一页走的距离
  const box = w * cols + gap * (cols - 1); // 一屏（对开时两张）的纸面宽
  return { cols, textCols, colW, w, gap, box, step };
}

const FONT = 20;
const GAP = 48;
const cases = [
  // R136：门槛从 17 字/900px 降到 15 字/840px 之后，760 这类常见面板终于能落到
  // 单页双栏（原来 avail≈654 差 37px 够不到 340，用户选了双栏却看见一栏）。
  { avail: 640, label: '窄面板（连 15 字都放不下）', cols: 1, textCols: 1 },
  { avail: 700, label: '760 面板（R136 起要保住双栏）', cols: 1, textCols: 2 },
  { avail: 808, label: '940 面板（R128 起要保住双栏）', cols: 1, textCols: 2 },
  { avail: 830, label: '刚好不够对开', cols: 1, textCols: 2 },
  { avail: 850, label: '刚过对开线（仍然单页双栏）', cols: 1, textCols: 2 },
  // R138：阅读页现在开卷即整屏，1280 屏去掉页边只剩 1112 —— 四栏各 242px（12 字），
  // 刚够这条新下限，所以也摊开两页。它不再是「面板宽度」，而是最小的整屏。
  { avail: 1112, label: '1280 整屏（最小的整屏）', cols: 2, textCols: 2 },
  // R138：整屏阅读的验收点是「点阅读就整屏、一个屏幕两页、四栏」。1920 屏
  // avail≈1752 → 四栏各 402px（20 字）；1440 屏 avail≈1272 → 四栏各 282px
  // （14 字）——两种都要真的摊开两页。只有四栏各排不下 12 字才退回单页双栏。
  { avail: 1752, label: '1920 整屏（必须两页两栏）', cols: 2, textCols: 2 },
  { avail: 1584, label: '1680 屏', cols: 2, textCols: 2 },
  { avail: 1560, label: '1660 屏（仍要两页两栏）', cols: 2, textCols: 2 },
  { avail: 1272, label: '1440 整屏（仍要两页两栏）', cols: 2, textCols: 2 },
  { avail: 1000, label: '半屏（四栏排不下 12 字）', cols: 1, textCols: 2 },
  { avail: 2400, label: '超宽（四栏对开）', cols: 2, textCols: 2 },
];

for (const c of cases) {
  const L = layoutFor(c.avail, FONT, GAP);
  const tag = `${c.label} (${c.avail}px)`;
  notes.push(`${tag} → ${L.cols} 页 × ${L.textCols} 栏，每栏 ${L.colW}px，一页 ${L.step}px`);

  if (L.cols !== c.cols || L.textCols !== c.textCols) {
    problems.push(`${tag}: 期望 ${c.cols} 页 × ${c.textCols} 栏，实际 ${L.cols} 页 × ${L.textCols} 栏`);
  }
  if (L.textCols < MIN_COLS_PER_PAGE || L.textCols > MAX_COLS_PER_PAGE) {
    problems.push(`${tag}: 一页 ${L.textCols} 栏，超出 1–2 栏的范围`);
  }
  // 一页宽 + 页间空档 = 翻页步长；一屏宽 = 页宽 × 页数 + 页间空档。
  if (L.box !== L.cols * L.step - GAP) {
    problems.push(`${tag}: 一屏 ${L.box}px 与「页宽 ${L.step}px × ${L.cols} 页」对不上`);
  }
  if (L.box > c.avail + 1) {
    problems.push(`${tag}: 一屏 ${L.box}px 超过可用宽度 ${c.avail}px`);
  }
  if (L.textCols === 2) {
    const glyphs = L.colW / FONT;
    const floor = L.cols === 2 ? MIN_GLYPH_COLS_WIDE : MIN_GLYPH_COLS;
    if (glyphs < floor) {
      problems.push(`${tag}: 双栏每栏只放得下 ${glyphs.toFixed(1)} 个字，少于 ${floor}`);
    }
    if (glyphs > MAX_GLYPH_COLS + 0.5) {
      problems.push(`${tag}: 双栏每栏 ${glyphs.toFixed(1)} 个字，超过 ${MAX_GLYPH_COLS} 的上限`);
    }
  }
}

// (a) 切换点两侧的行为要对得上：刚好不够 → 单页双栏，够宽 → 对开四栏。
{
  const under = layoutFor(SPREAD_AT - 10, FONT, GAP);
  const over = layoutFor(SPREAD_AT + 10, FONT, GAP);
  if (under.cols !== 1) problems.push(`宽度 ${SPREAD_AT - 10}px 应当还是单页，却判成了对开`);
  if (over.cols !== 1) problems.push(`宽度 ${SPREAD_AT + 10}px 还没到四栏，判据可能变了`);
  const wide = layoutFor(2400, FONT, GAP);
  if (wide.cols !== 2 || wide.textCols !== 2) problems.push('2400px 应当是四栏对开');
  // R137：全屏阅读（1920 视口）是这一轮的主验收点——一屏两页、一页两栏。
  const screen = layoutFor(1752, FONT, GAP);
  if (screen.cols !== 2 || screen.textCols !== 2) {
    problems.push(`1920 整屏（avail 1752）应当是一屏两页、一页两栏，实际 ${screen.cols} 页 × ${screen.textCols} 栏`);
  }
  // 四栏每栏仍要读得下去：至少 18 字。
  if (screen.colW / FONT < MIN_GLYPH_COLS_WIDE - 0.5) {
    problems.push(`1920 整屏每栏只有 ${(screen.colW / FONT).toFixed(1)} 个字，低于 ${MIN_GLYPH_COLS_WIDE} 字的下限`);
  }
  notes.push(`切换点：${SPREAD_AT - 10}px 单页双栏 → 超宽才四栏对开；1920 整屏 = 两页两栏`);
}

// (d) 页数必须按页宽算。多栏布局里 scrollWidth 是「所有栏加起来」的宽度，
// 除以页宽才是页数——除以栏宽会把页数算成两倍，页码和 maxPage 一起错。
{
  const L = layoutFor(1200, FONT, GAP);
  const contentWidth = 4873; // 任意一段正文的 scrollWidth 代表值
  const byPage = Math.max(1, Math.round((contentWidth + L.gap) / L.step));
  const byCol = Math.max(1, Math.round((contentWidth + L.gap) / (L.colW + L.gap)));
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
  // 允许保留两处：step 的兜底值（layout.step 还没算出来的首帧），以及 R121
  // 里对开前翻时纸左侧的副本原点（书缝在正文第 w+gap/2 列，那不是步长）。
  const allowed = 2;
  if (hits.length > allowed) {
    problems.push(
      `源码里还有 ${hits.length} 处自己拼 "layout.w + layout.gap"（只允许兜底 + 副本原点这 2 处）；` +
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

// ---- 翻页：turn.js 的一张纸 ----------------------------------------------
//
// R156：用户要求「用它 turn.js 重写现在的翻页」。turn.js 的 _fold 里，页是
// 一个刚体平面，只做 rotate(alpha) + translate；弧度不是几何，是一道贴在
// 折线上的渐变（gradientSize = side * sin(alpha)，正面黑 0.2 / 白 0.2，背面
// 黑 0.3）。这整段锁的就是这个模型：一张纸、两面、两条渐变、一个裁在书框里
// 的翻页层。任何退回十段关节、丢掉渐变或丢掉裁剪的改动都会在这里失败。
{
  const must = (pattern, why) => {
    if (!pattern.test(src)) problems.push(why);
  };

  const poseAt = src.indexOf('const poseFlip = React.useCallback(');
  const poseBody = poseAt < 0 ? '' : src.slice(poseAt, src.indexOf('}, []);', poseAt));

  // 1) 一张纸，一个平面。没有关节、没有分段、没有逐段弯曲。
  must(/\.nw-read-flip\{[^}]*position:absolute/, '缺少掀页层（.nw-read-flip）');
  must(/\.nw-read-flip\{[^}]*perspective:none/, '翻页还带透视：turn.js 的纸是正交的，一有透视纸就会被放大、看着往上挪');
  must(/\.nw-read-flip\{[^}]*overflow:hidden/, '翻页层没有裁在书框里：纸会越出书沿（turn.js 把纸放在 overflow:hidden 的 wrapper 里）');
  must(/\.nw-read-leaf\{[^}]*transform-style:preserve-3d/, '纸不是三维空间：背面翻不出来');
  must(/\.nw-read-leaf\{[^}]*top:var\(--nw-read-air, ?18px\)/, '纸的顶边必须到整张纸的上沿');
  must(/\.nw-read-leaf\{[^}]*bottom:var\(--nw-read-air, ?18px\)/, '纸的底边必须到整张纸的下沿');
  const leafRule = (src.match(/\.nw-read-leaf\{[^}]*\}/) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
  if (/overflow:hidden/.test(leafRule)) {
    problems.push('叶子自己 overflow:hidden 会把 preserve-3d 压平：裁剪必须在外层 .nw-read-flip');
  }
  if (/\.nw-read-joint\{/.test(src) || /className: 'nw-read-joint'/.test(src)) {
    problems.push('源码里还有 .nw-read-joint：退回十段关节模型');
  }
  if (/const SEGMENTS = 10;/.test(src)) problems.push('源码里还有 SEGMENTS = 10：退回分段模型');
  if (/rotateZ|const arch|const inertia|const droop|const weight =/.test(src)) {
    problems.push('源码里还有分段弯曲公式（rotateZ/arch/inertia/droop/weight）：退回旧模型');
  }
  must(/\.nw-read-face\{[^}]*backface-visibility:hidden/, '纸的两面各要藏自己的背面');
  must(/\.nw-read-face\[data-face="back"\]\{transform:rotateY\(180deg\);/, '缺纸背那一面');
  must(/\.nw-read-face\{[^}]*overflow:hidden/, '纸面不裁副本：半页纸会把整对开的字悬在纸外');
  must(/\.nw-read-face \.nw-read-copy\{[^}]*top:calc\(var\(--nw-read-band-top, ?64px\) - var\(--nw-read-air, ?18px\)\)/, '正文副本没有从整页纸的顶边缩回正文带');
  must(/\.nw-read-face \.nw-read-copy\{[^}]*bottom:calc\(var\(--nw-read-band-bottom, ?58px\) - var\(--nw-read-air, ?18px\)\)/, '正文副本没有从整页纸的底边缩回正文带');
  // R157: 纸的厚度。零厚度平面在 90 度投影为零，必须有一道不参与旋转的切口。
  must(/\.nw-read-edge\{/, '纸没有厚度：90 度时整张纸会凭空消失');
  must(/className: 'nw-read-edge'/, '切口元素没有渲染');
  must(/1 - Math\.abs\(rise - 0\.5\) \* 8/, '切口没有跟着角度浮现');
  must(/\.nw-read-face \.nw-read-copy\{[^}]*height:auto;/, '正文副本必须收回 height:auto：全局 height:100% 会让它比半页纸高，底边被裁的行会画两遍');

  // 2) 页脚/眉题还在纸上，并且整张纸只写一次原点（不是十段各写各的）。
  must(/\.nw-read-face-foot\{[^}]*bottom:16px/, '纸的下边距里没有页脚');
  must(/\.nw-read-face-foot\{[^}]*left:var\(--nw-foot-front, ?0\)/, '页脚的横向原点没有跟着整张纸走');
  must(/\.nw-read-face\[data-face="back"\] \.nw-read-face-foot\{left:var\(--nw-foot-back, ?0\);/, '纸背的页脚没有用镜像原点');
  must(/\.nw-read-face-head\{[^}]*top:13px/, '纸的天头里没有眉题');
  must(/\.nw-read-face\[data-face="back"\] \.nw-read-face-head\{left:var\(--nw-foot-back, ?0\);/, '纸背的眉题没有用镜像原点');
  must(/flex-direction:row-reverse/, '回翻落地的背面没有镜像页脚/眉题');
  must(/const faceFoot = \(key, folio\) => h\(/, '没有渲染纸上的页脚');
  must(/const faceHead = \(key, folio\) => h\(/, '没有渲染纸上的眉题');
  must(/faceFoot\(face \+ '-foot', folio\)/, '纸面没有带上页脚');
  must(/faceHead\(face \+ '-head', folio\)/, '纸面没有带上眉题');

  // 3) 弧度是 turn.js 的渐变：gradientSize = 纸宽 * sin(角度)，正面黑 0.2 + 白 0.2，
  //    背面黑 0.3。不是整页 box-shadow，也不是第二张纸。
  must(/\.nw-read-shade\{[^}]*width:var\(--nw-gsize, ?0px\)/, '缺折线渐变带（.nw-read-shade）');
  must(/\.nw-read-shade\{[^}]*opacity:0/, '渐变带默认必须不可见');
  must(/\.nw-read-face\[data-face="front"\] \.nw-read-shade\{[\s\S]*?rgba\(255,255,255,0\.2\)/, '正面折线没有 turn.js 的亮边 0.2');
  must(/\.nw-read-face\[data-face="front"\] \.nw-read-shade\{[\s\S]*?rgba\(0,0,0,0\.2\)/, '正面折线没有 turn.js 的暗带 0.2');
  must(/\.nw-read-face\[data-face="back"\] \.nw-read-shade\{[\s\S]*?rgba\(0,0,0,0\.3\)/, '背面折线没有 turn.js 的暗带 0.3');
  must(/const swing = Math\.sin\(Math\.PI \* rise\);/, '缺 sin 包络：折线渐变不会随纸立起来变宽、贴平时消失');
  must(/leaf\.style\.setProperty\('--nw-gsize', \(leafW \* swing\)\.toFixed\(3\) \+ 'px'\);/, '渐变带宽度不是 纸宽 * sin(角度)（turn.js 的 gradientSize）');
  must(/frontShade\.style\.opacity = swing\.toFixed\(3\)/, '正面渐变没有随角度显隐');
  must(/backShade\.style\.opacity = swing\.toFixed\(3\)/, '背面渐变没有随角度显隐');

  // 4) 纸是刚体：只绕书脊转，不 translateZ/rotateX，不逐段转。
  must(/const poseGeomRef = React\.useRef\(null\);/, '缺 poseGeomRef（摆纸时的纸宽/方向）');
  must(/poseGeomRef\.current = \{ dir: side, leafW: leafW \};/, '摆纸没有记住方向与纸宽');
  must(/leaf\.style\.transform = 'rotateY\(' \+ angleDeg\.toFixed\(2\) \+ 'deg\)';/, '纸不是绕书脊的一整片 rotateY');
  if (/translateZ|rotateX/.test(poseBody)) {
    problems.push('poseFlip 里还有 translateZ/rotateX：纸被抬起或前后推，书页对不上');
  }

  // 5) 正反两面的副本各指自己那页；背上落页的偏移按方向镜像。
  must(/const frontLeft = spreadFwd \? -spineAt : pad;/, '正面副本原点没有跟方向走');
  must(/const backLeft = spreadFwd \? pad : \(single \? pad : -spineAt\);/, '背面副本原点没有按方向镜像：落页会偏 30px 或偏半页');
  must(/leafRef\.current\.style\.setProperty\('--nw-foot-front', \(frontLeft \+ 0\.35\)\.toFixed\(3\) \+ 'px'\);/, '页脚没有和正面副本共用原点');
  must(/leafRef\.current\.style\.setProperty\('--nw-foot-back', \(backLeft \+ 0\.35\)\.toFixed\(3\) \+ 'px'\);/, '纸背页脚没有和背面副本共用镜像原点');
  must(/fc\.style\.left = \(frontLeft \+ 0\.35\)\.toFixed\(3\) \+ 'px';/, '正面副本没有按整张纸的原点摆');
  must(/bc\.style\.left = \(backLeft \+ 0\.35\)\.toFixed\(3\) \+ 'px';/, '背面副本没有按镜像原点摆');
  must(/syncCopies = React\.useCallback\(\(frontAt, backAt\)/, 'syncCopies 只同步了一面');
  must(/armFlip\(dir, cur, next\)/, '摆纸时没有把「翻到哪一页」交给背面');

  // 6) 过 90° 换面：和 turn.js 换 fpage 一样，不让两面共面出重影。
  must(/const over = abs > 90;/, '缺 90° 换面');
  must(/ff\.style\.visibility = over \? 'hidden' : 'visible';/, '过了 90° 正面没有关掉：纸背会透出正面的字');
  must(/bf\.style\.visibility = over \? 'visible' : 'hidden';/, '过了 90° 纸背没有打开：后半程看不到落下的那一页');

  // 7) 交互与时长不变。
  const armAt = src.indexOf('const armed = !still && armFlip(dir, cur, next);');
  const jumpAt = src.indexOf('const at = Math.round(next * s);');
  if (armAt < 0 || jumpAt < 0 || !(armAt < jumpAt)) {
    problems.push('turnTo 里必须先 armFlip 再写 flow.scrollLeft，否则纸上印错了页');
  }
  const jumpCount = (src.match(/flow\.scrollLeft\s*=/g) || []).length;
  if (jumpCount > 5) problems.push(`flow.scrollLeft 被赋值 ${jumpCount} 次（期望 ≤5）`);
  if (/flow\.scrollLeft\s*\+=/.test(src)) problems.push('出现了 flow.scrollLeft +=：文字又横着滑过去');
  const dur = src.match(/const dur = Math\.max\(\s*(\d+),\s*Math\.round\((\d+) \* \(span \/ 180\)\)\)/);
  if (!dur) problems.push('找不到翻页时长表达式');
  else {
    if (Number(dur[2]) < 480) problems.push(`整页翻页只有 ${dur[2]}ms，用户明确说过太快`);
    if (Number(dur[1]) < 180) problems.push(`拖拽续翻的下限 ${dur[1]}ms 太短`);
  }
  if (!poseBody) problems.push('找不到 poseFlip');
  for (const bad of ['getBoundingClientRect', 'offsetWidth', 'offsetHeight', 'querySelectorAll', 'querySelector']) {
    if (poseBody.includes(bad)) problems.push(`poseFlip 里出现了 ${bad}（每帧量布局会掉帧）`);
  }
  must(/if \(turningRef\.current\) return;/, '副本窗口必须在掀页途中冻结');
  must(/const renderChapters = React\.useCallback/, '缺 renderChapters');
  const bodyMemo = src.match(/const body = React\.useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
  if (!bodyMemo) problems.push('找不到 body 的 useMemo');
  else if (/\bpage\b/.test(bodyMemo[1])) problems.push('body 的依赖里出现了 page');
  must(/const geometryRef = React\.useRef\(''\);/, '缺 geometryRef');
  must(/const abortTurn = React\.useCallback/, '缺 abortTurn');
  must(/if \(before && before !== geo\) abortTurn\(\);/, 'measure() 没有在几何变化时收纸');
  must(/if \(armColsRef\.current !== layout\.cols\) \{/, '落定没有校验摆纸时的栏数');
  must(/flow\.scrollLeft = landed;/, '重排后没有把正文重新对到页边界');
  must(/const armColsRef = React\.useRef\(0\);/, '缺 armColsRef');
  must(/const shift = Math\.cos\(base\) \* side \* leafW \* 0\.34;/, '落影没有跟着自由边移动');
  must(/cast\.style\.opacity = \(0\.62 \* swing\)\.toFixed\(3\)/, '落影没有随抬升强度变化');
  must(/\.nw-read-cast\{[\s\S]*?radial-gradient\(ellipse at center/, '落影必须是柔和椭圆');
  must(/\.nw-read-cast\{[^}]*z-index:2/, '落影被 cover 挡住');
  must(/const turnCurve = \(t\) =>/, '缺手感曲线');
  must(/0\.5 - 0\.5 \* Math\.cos\(Math\.PI \* t\)/, '翻页曲线不是单峰');
  must(/const k = turnCurve\(t\);/, '两个方向应当走同一条手感曲线');
  const toAngle = src.match(/const to = dir > 0 \? (-?\d+) : (-?\d+);/);
  if (!toAngle) problems.push('找不到落定角度');
  else if (Math.abs(Number(toAngle[1])) !== 180 || Math.abs(Number(toAngle[2])) !== 180) {
    problems.push(`落定角度是 ${toAngle[1]}/${toAngle[2]}°，纸没有翻到对侧`);
  }
  must(/syncCopies\(frontAt, backAt\)/, '摆纸时没有同步正反两面');

  // 8) R149 页码按半换：被掀起的那半从第一帧起就是新页，被盖住的那半等纸落地。
  must(/turnPagesRef\.current = \{ to: next, live: armed \};/, 'turnTo 没有登记这一趟翻页');
  must(/setHalfOverride\(armed \? \{ side: dir > 0 \? 'right' : 'left', page: next \} : null\);/, 'turnTo 没有登记「先换码的那一半」');
  if (/tp\.swapped/.test(src)) problems.push('poseFlip 还在按 90° 整体换码：外缘的页码会配错内容');
  must(/const stageFolio = folioAt\(shownPage\);/, '舞台页码/眉题没有跟着 shownPage 走');
  must(/const halfFolio = halfOverride \? folioAt\(halfOverride\.page\) : null;/, '缺 halfOverride 的 folio');
  must(/const leftFolio = halfFolio && halfOverride\.side === 'left' \? halfFolio : stageFolio;/, '左半没有自己的 folio');
  must(/const rightFolio = halfFolio && halfOverride\.side === 'right' \? halfFolio : stageFolio;/, '右半没有自己的 folio');
  must(/const pageLeft = spread \? leftFolio\.left : shownFolio\.left;/, '台面左页码没有按半取');
  must(/const pageRight = spread \? rightFolio\.right : shownFolio\.right;/, '台面右页码没有按半取');
  must(/const backFolio = turnPagesRef\.current\.live \? folioAt\(turnPagesRef\.current\.to\) : stageFolio;/, '纸背没有印「落下的那页」的页码');
  must(/const folioAt = \(idx\) => \{/, '缺 folioAt');
  must(/left: lf \+ 1,\s*\n\s*right: spread \? lf \+ 2 : lf \+ 1,/, 'folio 页码算式变了');
  must(/chapter: chapterAtX\(startX\) \|\| bookName,/, 'folio 的章名没有按栏偏移查');
  must(/turnPagesRef\.current\.live = false;\s*\n\s*setHalfOverride\(null\);\s*\n\s*setShown\(pageRef\.current\);/, 'stopFlip 没有把两半对回正文书页');
  must(/pageRef\.current = at;\s*\n\s*setPage\(at\);\s*\n\s*stopFlip\(\);\s*\n\s*setShown\(at\);/, 'scrollToPage 没有把 pageRef/page/shownPage 一起对齐');
  must(/const setShown = React\.useCallback\(\(idx\) => \{/, '缺 setShown');

  notes.push('R156 翻页：一张刚体平面绕书脊走 180°，折线明暗由 turn.js 的 gradientSize/stop 画，翻页层裁在书框内');
  notes.push('R156 页码：正面印离页、背面印到页；页码仍按半换，纸落定才把两半对回正文');
}

// ---- R150/R151/R156：cover 要像纸，缝要塌，翻页层要裁在书框内 -----------
{
  const must = (pattern, why) => {
    if (!pattern.test(src)) problems.push(why);
  };
  // 1) cover 与 sheet 同框：同样 air 上下边、同样 box + 两侧页边距、同样圆角。
  must(/\.nw-read-cover\{[\s\S]*?top:var\(--nw-read-air, 18px\);bottom:var\(--nw-read-air, 18px\);/, 'cover 仍只盖正文带');
  must(/\.nw-read-cover\{[\s\S]*?width:calc\(var\(--nw-read-box, 680px\) \+ var\(--nw-read-sheet-pad\) \* 2\);/, 'cover 仍比纸窄');
  must(/\.nw-read-cover\{[\s\S]*?border-radius:5px 5px 9px 9px \/ 3px 3px 6px 6px;/, 'cover 没有跟着纸的圆角');
  must(/\.nw-read-cover\{[\s\S]*?radial-gradient\(58% 46% at 38% 30%/, 'cover 没抄纸面的那团受光');
  must(/\.nw-read-cover\{[\s\S]*?radial-gradient\(74% 62% at 86% 88%/, 'cover 没抄纸右下角那层沉影');
  must(/\.nw-read-cover\{[\s\S]*?inset 9px 0 18px -12px/, 'cover 没抄纸面两侧的内阴影');
  must(/\.nw-read-cover \.nw-read-copy\{[\s\S]*?left:var\(--nw-read-sheet-pad, 30px\);/, 'cover 里的副本没让开页边距');
  // 2) 中缝不再是一条 1px 亮线——真书的缝是暗的塌
  if (/\.nw-read-sheet\[data-spread="1"\]::before/.test(src)) {
    problems.push('中缝还留着 1px 亮线');
  }
  must(/\.nw-read-spine\{[\s\S]*?radial-gradient\(52% 100% at 50% 50%/, '中缝没有塌陷核');
  // 3) R156：一张纸的翻页层必须裁在书框内；裁剪不能在叶子上（会压平 preserve-3d）。
  must(/\.nw-read-flip\{[^}]*overflow:hidden/, '翻页层没有裁在书框内：纸会越出书沿');
  must(/R156: 翻页层裁在书框里/, '翻页层缺少「纸不出书框」的说明');
  must(/R156: 这里不能 overflow:hidden/, '叶子上缺少「overflow 会压平 preserve-3d」的说明');
  if (/\.nw-read-joint\[data-segment/.test(src)) problems.push('还留着逐段关节的选择器');
  // 4) 中缝必须是一层真实元素，压在正文之上。
  must(/\.nw-read-spine\{[^}]*z-index:2/, '中缝没有压在正文之上');
  must(/className: 'nw-read-spine'/, '舞台上没有渲染中缝这一层');
  must(/\.nw-read-spine\{[^}]*mask-image:linear-gradient\(to bottom, transparent, #000 9%/, '中缝没有上下渐隐');
  notes.push('R156 裁剪：翻页层 overflow:hidden；叶子保留 preserve-3d，不再自己裁纸');
}

// ---- R144：书体厚度必须有三维轮廓，不只是底边一条影 ----------------------
// 这些断言不碰排版几何，只锁住纯装饰层：左右书口露出、纵向椭圆弧、底部纸叠、
// 中央装订暗与夜间材料。任何一层都不许进入 measure() 或接指针。
{
  const must = (pattern, why) => {
    if (!pattern.test(src)) problems.push(why);
  };
  must(/\.nw-read-block\{[^}]*--nw-read-cut:/, '纸垛缺少独立的切面材料变量');
  must(/top:calc\(var\(--nw-read-air, 18px\) \+ 4px\)/, '纸垛不再延伸到两侧：顶部缩进被改回了下缘专用值');
  must(/bottom:calc\(var\(--nw-read-air, 18px\) - 13px\)/, '底部纸叠必须比顶纸低 13px');
  must(/\.nw-read-block::before,\s*\.nw-read-block::after\{[^}]*width:11px/, '缺少左右书口（两个 11px 宽的纯装饰伪元素）');
  must(/\.nw-read-block::before\{[^}]*left:-8px/, '左书口没有探出顶纸 8px');
  must(/\.nw-read-block::after\{[^}]*right:-8px/, '右书口没有探出顶纸 8px');
  must(/\.nw-read-block::before\{[^}]*border-radius:[^;]*\//, '左书口缺少纵向椭圆弧，仍是直板包边');
  must(/\.nw-read-block::after\{[^}]*border-radius:[^;]*\//, '右书口缺少纵向椭圆弧，仍是直板包边');
  must(/\.nw-read-block::before\{[\s\S]*?repeating-linear-gradient\(to bottom,/, '左书口缺少稀疏纸层');
  must(/\.nw-read-block::after\{[\s\S]*?repeating-linear-gradient\(to bottom,/, '右书口缺少稀疏纸层');
  must(/radial-gradient\(18% 70px at 50% 100%,\s*var\(--nw-read-cut-shade\)/, '纸垛底面缺少装订线压暗');
  must(/\.nw-read-block\{[\s\S]*?pointer-events:none;z-index:0;/, '书体装饰层会截住阅读页指针');
  must(/\.nw-read\[data-theme="night"\] \.nw-read-block\{[^}]*--nw-read-cut-light:/, '夜盘没有单独压住纸口亮线');
  must(/border-radius:5px 5px 9px 9px \/ 3px 3px 6px 6px;/, '顶纸外缘弧度丢失');
  notes.push('书体：左右书口各露 8px、底缘纸叠 13px，纵向椭圆弧 + 装订暗 + 三段桌面落影');
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
