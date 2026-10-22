// R6 ③ —— 把八套主题从「同一张纸换强调色」拉开成四维分叉。
// 一次性脚本，跑完即删：读 → 精确替换 → 写回 → 自校验替换次数。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => path.join(ROOT, rel);

let fails = 0;

function read(rel) {
  return fs.readFileSync(p(rel), 'utf8');
}
function write(rel, text) {
  fs.writeFileSync(p(rel), text, 'utf8');
}

/** 把 `.selector{ ... }` 整块换掉（按第一个 `\n}` 收尾，够用因为块内无嵌套）。 */
function replaceBlock(css, selector, body, file) {
  const at = css.indexOf(selector + '{');
  if (at < 0) throw new Error(`[${file}] selector not found: ${selector}`);
  if (css.indexOf(selector + '{', at + 1) >= 0) throw new Error(`[${file}] selector duplicated: ${selector}`);
  const close = css.indexOf('\n}', at);
  if (close < 0) throw new Error(`[${file}] block not closed: ${selector}`);
  return css.slice(0, at) + selector + '{\n' + body + '\n}' + css.slice(close + 2);
}

/** 逐条精确替换，每条的 old 必须出现且只出现一次。 */
function patch(text, pairs, file) {
  for (const [oldS, newS] of pairs) {
    const n = text.split(oldS).length - 1;
    if (n !== 1) {
      fails++;
      console.error(`✗ [${file}] expected 1 hit, got ${n}: ${oldS.slice(0, 70)}`);
      continue;
    }
    text = text.replace(oldS, newS);
  }
  console.log(`✓ [${file}] ${pairs.length} replacements`);
  return text;
}

/* ========================================================== 60-editor.js === */
{
  const rel = 'client/src/60-editor.js';
  let css = read(rel);

  // 1) 让 .nw-surface 消费每套主题可选的纸纹。
  css = patch(css, [[
    '  background:var(--nw-bg);color:var(--nw-fg);\n',
    '  background:var(--nw-bg);color:var(--nw-fg);\n' +
    '  /* R6: paper grain. A palette may set --nw-texture; harness and the other\n' +
    '     chrome-following themes leave it unset, which resolves to none. */\n' +
    '  background-image:var(--nw-texture,none);\n',
  ]], rel);

  // 2) harness —— 保持纯白中性纸，显式声明没有纹理。
  css = replaceBlock(css, '.nw-surface[data-theme="harness"]', [
    '  --nw-bg:#ffffff;--nw-fg:#1f1f1f;--nw-soft:#6f7278;--nw-rule:#e6e4e0;',
    '  --nw-caret-color:#1f1f1f;--nw-caret:#1f1f1f;--nw-sel:rgba(31,31,31,.14);',
    '  --nw-accent:#1f1f1f;',
    '  --nw-scroll-thumb:rgba(31,31,31,.18);--nw-scroll-thumb-hover:rgba(31,31,31,.32);',
    '  --nw-panel:#ffffff;--nw-panel-border:#e6e4e0;--nw-panel-shadow:0 8px 24px rgba(0,0,0,.06);',
    '  --nw-btn-bg:#f6f5f2;--nw-btn-fg:#1f1f1f;--nw-btn-border:#e6e4e0;--nw-btn-hover:#eeede9;',
    '  --nw-hl-bg:rgba(255,196,0,.28);--nw-hl-line:rgba(203,145,0,.68);--nw-hl-active:rgba(255,152,0,.46);',
    '  --nw-find-bg:rgba(31,31,31,.10);--nw-find-active:rgba(31,31,31,.24);--nw-find-ring:rgba(31,31,31,.72);',
    '  --nw-empty-glyph:rgba(31,31,31,.16);',
    '  --nw-texture:none;',
  ].join('\n'), rel);

  // 3) claude —— 象牙暖白 + 陶土橙（暖端最浅的一档）。原来和 harness 只差 4% 明度。
  css = replaceBlock(css, '.nw-surface[data-theme="claude"]', [
    '  --nw-bg:#faf4e9;--nw-fg:#1b1813;--nw-soft:#6d6558;--nw-rule:#e6dccb;',
    '  --nw-caret-color:#1b1813;--nw-caret:#1b1813;--nw-sel:rgba(27,24,19,.14);',
    '  --nw-accent:#c4532f;',
    '  --nw-scroll-thumb:rgba(27,24,19,.18);--nw-scroll-thumb-hover:rgba(27,24,19,.32);',
    '  --nw-panel:#fdf8ef;--nw-panel-border:#e6dccb;--nw-panel-shadow:0 8px 24px rgba(64,44,24,.09);',
    '  --nw-btn-bg:#f3ecdf;--nw-btn-fg:#1b1813;--nw-btn-border:#e6dccb;--nw-btn-hover:#eae1d1;',
    '  --nw-hl-bg:rgba(196,83,47,.20);--nw-hl-line:rgba(170,66,36,.60);--nw-hl-active:rgba(196,83,47,.36);',
    '  --nw-find-bg:rgba(196,83,47,.13);--nw-find-active:rgba(196,83,47,.28);--nw-find-ring:rgba(170,66,36,.82);',
    '  --nw-empty-glyph:rgba(27,24,19,.16);',
    '  /* A warm vertical wash: the page is lit from the top like a sheet on a desk. */',
    '  --nw-texture:linear-gradient(178deg,rgba(255,252,245,.92),rgba(251,243,229,.62) 58%,rgba(245,234,214,.80));',
    '  /* The floating dock sits over the bottom-right of .nw-main; keep the right',
    '     gutter wide enough that no glyph can hide underneath it. */',
    '  --nw-gutter-x:40px;',
  ].join('\n'), rel);

  // 4) eye —— 豆绿护眼，已足够独特；只补一层极淡的顶部晕染让它有纸的起伏。
  css = replaceBlock(css, '.nw-surface[data-theme="eye"]', [
    '  --nw-bg:#cce8cf;--nw-fg:#1f2a20;--nw-soft:#55684f;--nw-rule:#b6d6ba;',
    '  --nw-caret-color:#1f2a20;--nw-caret:#1f2a20;--nw-sel:rgba(31,42,32,.18);',
    '  --nw-accent:#2f6b3c;',
    '  --nw-scroll-thumb:rgba(31,42,32,.22);--nw-scroll-thumb-hover:rgba(31,42,32,.36);',
    '  --nw-panel:#ddf1de;--nw-panel-border:#b6d6ba;--nw-panel-shadow:0 8px 24px rgba(31,42,32,.14);',
    '  --nw-btn-bg:#c1e0c5;--nw-btn-fg:#1f2a20;--nw-btn-border:#a9cbaa;--nw-btn-hover:#b3d8b8;',
    '  --nw-hl-bg:rgba(255,214,0,.32);--nw-hl-line:rgba(158,116,0,.62);--nw-hl-active:rgba(255,170,0,.44);',
    '  --nw-find-bg:rgba(31,42,32,.12);--nw-find-active:rgba(31,42,32,.26);--nw-find-ring:rgba(31,42,32,.76);',
    '  --nw-empty-glyph:rgba(31,42,32,.18);',
    '  --nw-texture:radial-gradient(130% 110% at 50% 0%,rgba(255,255,255,.42),rgba(150,192,158,.34));',
  ].join('\n'), rel);

  // 5) night —— 唯一深色，保留原色，只显式关掉纹理。
  css = replaceBlock(css, '.nw-surface[data-theme="night"]', [
    '  --nw-bg:#1a1a18;--nw-fg:#e8e6dc;--nw-soft:#9c9a90;--nw-rule:#33322d;',
    '  --nw-caret-color:#e8e6dc;--nw-caret:#e8e6dc;--nw-sel:rgba(232,230,220,.18);',
    '  --nw-accent:#e08d6f;',
    '  --nw-scroll-thumb:rgba(232,230,220,.18);--nw-scroll-thumb-hover:rgba(232,230,220,.34);',
    '  --nw-panel:#221f1d;--nw-panel-border:#33322d;--nw-panel-shadow:0 8px 24px rgba(0,0,0,.46);',
    '  --nw-btn-bg:#2a2825;--nw-btn-fg:#e8e6dc;--nw-btn-border:#3a3832;--nw-btn-hover:#35322e;',
    '  --nw-hl-bg:rgba(224,141,111,.24);--nw-hl-line:rgba(224,141,111,.62);--nw-hl-active:rgba(224,141,111,.40);',
    '  --nw-find-bg:rgba(224,141,111,.16);--nw-find-active:rgba(224,141,111,.32);--nw-find-ring:rgba(224,141,111,.86);',
    '  --nw-empty-glyph:rgba(232,230,220,.16);',
    '  --nw-texture:none;',
  ].join('\n'), rel);

  // 6) ink —— 从「暖米白」改成真正的冷灰蓝纸 + 墨蓝强调 + 硬直角 + 水墨晕染。
  css = replaceBlock(css, '.nw-surface[data-theme="ink"]', [
    '  --nw-bg:#e9eef5;--nw-fg:#121820;--nw-soft:#5b6675;--nw-rule:#d3dce6;',
    '  --nw-caret-color:#0d141b;--nw-caret:#0d141b;--nw-sel:rgba(18,24,32,.16);',
    '  --nw-accent:#1f4f6b;',
    '  --nw-scroll-thumb:rgba(18,24,32,.20);--nw-scroll-thumb-hover:rgba(18,24,32,.36);',
    '  --nw-panel:#f7fafd;--nw-panel-border:#d3dce6;--nw-panel-shadow:0 8px 24px rgba(18,32,48,.12);',
    '  --nw-btn-bg:#e3eaf2;--nw-btn-fg:#1f4f6b;--nw-btn-border:#d3dce6;--nw-btn-hover:#d7e1ec;',
    '  --nw-hl-bg:rgba(31,79,107,.16);--nw-hl-line:rgba(31,79,107,.56);--nw-hl-active:rgba(31,79,107,.30);',
    '  --nw-find-bg:rgba(31,79,107,.12);--nw-find-active:rgba(31,79,107,.26);--nw-find-ring:rgba(31,79,107,.78);',
    '  --nw-empty-glyph:rgba(18,24,32,.18);',
    '  /* Ink is a hard-edged material: no soft rounding anywhere. */',
    '  --nw-r-card:4px;--nw-r-control:3px;',
    '  /* A blue-grey wash that darkens toward the foot of the page. */',
    '  --nw-texture:',
    '    radial-gradient(130% 100% at 10% 0%,rgba(255,255,255,.85),rgba(255,255,255,0) 58%),',
    '    linear-gradient(196deg,rgba(206,222,238,.55),rgba(236,243,250,.35) 46%,rgba(198,217,235,.62));',
  ].join('\n'), rel);

  // 7) card —— 近白冷纸（与 harness 的纯白、ink 的蓝灰各差一档）+ 更大圆角 + 蓝色强调。
  css = replaceBlock(css, '.nw-surface[data-theme="card"]', [
    '  --nw-bg:#f9fbfd;--nw-fg:#16181c;--nw-soft:#6b7280;--nw-rule:#e3e8ef;',
    '  --nw-caret-color:#16181c;--nw-caret:#16181c;--nw-sel:rgba(22,24,28,.14);',
    '  --nw-accent:#3b6ea5;',
    '  --nw-scroll-thumb:rgba(22,24,28,.16);--nw-scroll-thumb-hover:rgba(22,24,28,.30);',
    '  --nw-panel:#ffffff;--nw-panel-border:#e9edf3;--nw-panel-shadow:0 10px 30px rgba(22,32,48,.10);',
    '  --nw-btn-bg:#ffffff;--nw-btn-fg:#16181c;--nw-btn-border:#e6ebf2;--nw-btn-hover:#eef3f9;',
    '  --nw-hl-bg:rgba(59,110,165,.16);--nw-hl-line:rgba(59,110,165,.60);--nw-hl-active:rgba(59,110,165,.32);',
    '  --nw-find-bg:rgba(59,110,165,.12);--nw-find-active:rgba(59,110,165,.26);--nw-find-ring:rgba(59,110,165,.80);',
    '  --nw-empty-glyph:rgba(22,24,28,.14);',
    '  --nw-r-card:18px;--nw-r-control:14px;',
    '  --nw-texture:none;',
  ].join('\n'), rel);

  // 8) newspaper —— 真正的黄褐新闻纸（降明度、提饱和）+ 横向网点纹。
  css = replaceBlock(css, '.nw-surface[data-theme="newspaper"]', [
    '  --nw-bg:#ecdfbe;--nw-fg:#1a1913;--nw-soft:#5a5546;--nw-rule:#d3c8a9;',
    '  --nw-caret-color:#1a1913;--nw-caret:#1a1913;--nw-sel:rgba(26,25,19,.16);',
    '  --nw-accent:#8c2b22;',
    '  --nw-scroll-thumb:rgba(26,25,19,.20);--nw-scroll-thumb-hover:rgba(26,25,19,.36);',
    '  --nw-panel:#f4ecd6;--nw-panel-border:#d9cfae;--nw-panel-shadow:0 8px 22px rgba(80,64,32,.14);',
    '  --nw-btn-bg:#e4d7b4;--nw-btn-fg:#2a271e;--nw-btn-border:#d3c8a9;--nw-btn-hover:#dbcca6;',
    '  --nw-hl-bg:rgba(140,43,34,.18);--nw-hl-line:rgba(140,43,34,.56);--nw-hl-active:rgba(140,43,34,.32);',
    '  --nw-find-bg:rgba(26,25,19,.10);--nw-find-active:rgba(26,25,19,.24);--nw-find-ring:rgba(26,25,19,.72);',
    '  --nw-empty-glyph:rgba(26,25,19,.16);',
    '  /* A newspaper has no rounded corners anywhere. */',
    '  --nw-r-card:2px;--nw-r-control:2px;--nw-r-modal:3px;--nw-r-pill:2px;',
    '  --nw-ui-font-override:Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif;',
    '  --nw-reading-font:Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif;',
    '  /* Ruled newsprint: a hairline per 3px, like a cheap press run. */',
    '  --nw-texture:',
    '    repeating-linear-gradient(0deg,rgba(90,78,48,.045) 0 1px,rgba(90,78,48,0) 1px 3px),',
    '    radial-gradient(140% 110% at 50% 0%,rgba(255,250,232,.75),rgba(224,208,170,.35) 72%);',
  ].join('\n'), rel);

  // 9) guofeng —— 宣纸加深一档 + 经纬纤维 + 楷体（结构与 newspaper 明显不同：纤维是双向的）。
  css = replaceBlock(css, '.nw-surface[data-theme="guofeng"]', [
    '  --nw-bg:#f2e9d2;--nw-fg:#221f18;--nw-soft:#6a6250;--nw-rule:#ded2b6;',
    '  --nw-caret-color:#221f18;--nw-caret:#221f18;--nw-sel:rgba(34,31,24,.16);',
    '  --nw-accent:#a8442f;',
    '  --nw-scroll-thumb:rgba(34,31,24,.20);--nw-scroll-thumb-hover:rgba(34,31,24,.36);',
    '  --nw-panel:#f6eed9;--nw-panel-border:#e0d4b8;--nw-panel-shadow:0 8px 26px rgba(60,48,28,.14);',
    '  --nw-btn-bg:#e9dfc4;--nw-btn-fg:#221f18;--nw-btn-border:#dcd4bd;--nw-btn-hover:#dfd3b4;',
    '  --nw-hl-bg:rgba(168,68,47,.16);--nw-hl-line:rgba(168,68,47,.58);--nw-hl-active:rgba(168,68,47,.30);',
    '  --nw-find-bg:rgba(34,31,24,.10);--nw-find-active:rgba(34,31,24,.22);--nw-find-ring:rgba(34,31,24,.70);',
    '  --nw-empty-glyph:rgba(34,31,24,.16);',
    '  --nw-r-card:8px;--nw-r-control:6px;',
    '  --nw-ui-font-override:"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif;',
    '  --nw-reading-font:"Kaiti SC","STKaiti","KaiTi","Noto Serif CJK SC","Songti SC",serif;',
    '  /* 宣纸纤维：两向很淡的经纬线，只在纸上，不在控件上。 */',
    '  --nw-texture:',
    '    repeating-linear-gradient(0deg,rgba(146,126,78,.05) 0 1px,rgba(146,126,78,0) 1px 4px),',
    '    repeating-linear-gradient(90deg,rgba(146,126,78,.04) 0 1px,rgba(146,126,78,0) 1px 6px),',
    '    radial-gradient(150% 110% at 50% 0%,rgba(255,253,243,.85),rgba(238,224,192,.40) 74%);',
  ].join('\n'), rel);

  write(rel, css);
}

/* ===================================================== 98-shell-theme.js === */
{
  const rel = 'client/src/98-shell-theme.js';
  let css = read(rel);
  css = patch(css, [
    // claude
    ['--dsw-alias-bg-base:#faf9f5;', '--dsw-alias-bg-base:#faf4e9;'],
    ['--dsw-alias-bg-layer-1:#f4f2ea;', '--dsw-alias-bg-layer-1:#f2ebdc;'],
    ['--dsw-alias-bg-layer-2:#eae7dc;', '--dsw-alias-bg-layer-2:#e7ddca;'],
    ['--dsw-alias-bg-overlay:#fdfcf8;', '--dsw-alias-bg-overlay:#fdf9f0;'],
    ['--dsw-alias-border-l1:#efede3;', '--dsw-alias-border-l1:#ece4d4;'],
    ['--dsw-alias-border-l2:#e8e6dc;', '--dsw-alias-border-l2:#e2d7c3;'],
    ['--dsw-alias-brand-primary:#d97757;', '--dsw-alias-brand-primary:#c4532f;'],
    ['--dsw-alias-label-primary:#141413;', '--dsw-alias-label-primary:#1b1813;'],
    ['--dsw-alias-label-secondary:#6f6d66;', '--dsw-alias-label-secondary:#6d6558;'],
    ['--dsw-specific-sidebar-fill:#f5f3eb;', '--dsw-specific-sidebar-fill:#f3ecdd;'],
    // ink
    ['--dsw-alias-bg-base:#f4f2ec;', '--dsw-alias-bg-base:#e9eef5;'],
    ['--dsw-alias-bg-layer-1:#eeece4;', '--dsw-alias-bg-layer-1:#e2e8f1;'],
    ['--dsw-alias-bg-layer-2:#e7e4da;', '--dsw-alias-bg-layer-2:#d9e2ed;'],
    ['--dsw-alias-bg-overlay:#faf9f4;', '--dsw-alias-bg-overlay:#f6f9fc;'],
    ['--dsw-alias-border-l1:#e6e3d9;', '--dsw-alias-border-l1:#dde5ee;'],
    ['--dsw-alias-border-l2:#dedbd2;', '--dsw-alias-border-l2:#d3dce6;'],
    ['--dsw-alias-brand-primary:#2b2b28;', '--dsw-alias-brand-primary:#1f4f6b;'],
    ['--dsw-alias-label-primary:#1a1a18;', '--dsw-alias-label-primary:#121820;'],
    ['--dsw-alias-label-secondary:#6b6a63;', '--dsw-alias-label-secondary:#5b6675;'],
    ['--dsw-alias-state-idle-primary:#9a978e;', '--dsw-alias-state-idle-primary:#8a95a3;'],
    ['--dsw-alias-state-success-primary:#4a6b4a;', '--dsw-alias-state-success-primary:#3f6b57;'],
    ['--dsw-specific-sidebar-fill:#f0eee7;', '--dsw-specific-sidebar-fill:#e4ebf3;'],
    // card
    ['--dsw-alias-bg-base:#ffffff;', '--dsw-alias-bg-base:#f9fbfd;'],
    ['--dsw-alias-bg-layer-1:#f7f8fa;', '--dsw-alias-bg-layer-1:#f0f4f9;'],
    ['--dsw-alias-bg-layer-2:#eff2f5;', '--dsw-alias-bg-layer-2:#e8eef6;'],
    ['--dsw-alias-border-l1:#eef0f3;', '--dsw-alias-border-l1:#e9eef5;'],
    ['--dsw-alias-border-l2:#e2e5e9;', '--dsw-alias-border-l2:#dde4ee;'],
    ['--dsw-specific-sidebar-fill:#f7f8fa;', '--dsw-specific-sidebar-fill:#f2f6fb;'],
    // newspaper
    ['--dsw-alias-bg-base:#f2eee2;', '--dsw-alias-bg-base:#ecdfbe;'],
    ['--dsw-alias-bg-layer-1:#ece7d8;', '--dsw-alias-bg-layer-1:#e5d7b2;'],
    ['--dsw-alias-bg-layer-2:#e3ddca;', '--dsw-alias-bg-layer-2:#dbcaa0;'],
    ['--dsw-alias-bg-overlay:#f7f3e8;', '--dsw-alias-bg-overlay:#f5edd7;'],
    ['--dsw-alias-border-l1:#ddd7c4;', '--dsw-alias-border-l1:#d9cfae;'],
    ['--dsw-alias-border-l2:#d2cbb6;', '--dsw-alias-border-l2:#cfc399;'],
    ['--dsw-specific-sidebar-fill:#efeade;', '--dsw-specific-sidebar-fill:#e8dbb8;'],
    // guofeng
    ['--dsw-alias-bg-base:#f5f1e6;', '--dsw-alias-bg-base:#f2e9d2;'],
    ['--dsw-alias-bg-layer-1:#efeade;', '--dsw-alias-bg-layer-1:#ece1c2;'],
    ['--dsw-alias-bg-layer-2:#e7e1d1;', '--dsw-alias-bg-layer-2:#e3d6b2;'],
    ['--dsw-alias-bg-overlay:#faf6ea;', '--dsw-alias-bg-overlay:#f9f1dc;'],
    ['--dsw-alias-border-l1:#e4ddcb;', '--dsw-alias-border-l1:#e2d6bb;'],
    ['--dsw-alias-border-l2:#dad2bd;', '--dsw-alias-border-l2:#d8caa8;'],
    ['--dsw-specific-sidebar-fill:#f2eee0;', '--dsw-specific-sidebar-fill:#eee3c6;'],
  ], rel);
  write(rel, css);
}

/* ==================================================== 45-dialogs-css.js === */
{
  const rel = 'client/src/45-dialogs-css.js';
  let css = read(rel);
  css = patch(css, [
    // claude
    ['    linear-gradient(160deg,#faf9f5,#eee9dd);\n  box-shadow:inset 0 -12px 20px -14px rgba(217,119,87,.75);',
     '    linear-gradient(160deg,#fdf7ec,#ecdcc0);\n  box-shadow:inset 0 -12px 20px -14px rgba(196,83,47,.75);'],
    // ink
    ['    linear-gradient(160deg,#f4f2ec,#e6e3d9);',
     '    linear-gradient(160deg,#f2f6fb,#d6e1ee);'],
    // card
    ['    linear-gradient(160deg,#ffffff,#e9edf2);',
     '    linear-gradient(160deg,#ffffff,#e2eaf4);'],
    // newspaper
    ['    linear-gradient(160deg,#f6f2e6,#ded7c3);',
     '    linear-gradient(160deg,#f4ead0,#d8c69c);'],
    // guofeng
    ['    linear-gradient(160deg,#f5f1e6,#e2dbc8);',
     '    linear-gradient(160deg,#f9f1de,#e0d0aa);'],
  ], rel);
  write(rel, css);
}

if (fails) {
  console.error(`\n✗ ${fails} replacement(s) failed — files were still written, review before building.`);
  process.exit(1);
}
console.log('\n✓ R6 themes applied.');
