#!/usr/bin/env node
// R84: the manuscript's emphasis is a wash of colour, never an underline.
//
// Two bugs lived here that a screenshot cannot catch:
//   * the advice sentence and the 批注 mark both painted an inset bottom edge,
//     so they read as the same "underlined" thing — and the writer explicitly
//     asked for no underline on either;
//   * a single alpha over five paper colours is not one design: red at 14% is
//     invisible on the magazine white, and the night page needs a lighter tint
//     entirely. Each theme now owns a highlight ink and a comment ink, and this
//     script measures the tint against that theme's paper.
//
// It is a static check (parse CSS out of the parts), so it runs on every build.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'client', 'src');
const editor = readFileSync(join(src, '60-editor.js'), 'utf8');
const read = readFileSync(join(src, '62-read.js'), 'utf8');
const app = readFileSync(join(src, '90-app.js'), 'utf8');

const problems = [];
const notes = [];
const ok = (cond, message) => { if (!cond) problems.push(message); };

function rule(text, selector) {
  const at = text.indexOf(selector + '{');
  if (at < 0) return null;
  const end = text.indexOf('}', at);
  return end < 0 ? null : text.slice(at + selector.length + 1, end);
}
const has = (text, selector, needle) => {
  const body = rule(text, selector);
  return !!body && body.includes(needle);
};

// ---- 1. each paper keeps its own ink -------------------------------------
function hex(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
function rgba(value) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(String(value));
  if (!m) return null;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
}
function over(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}
function luminance(rgb) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function token(block, name) {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(block);
  return m ? m[1].trim() : null;
}

const palettes = {};
const paletteRe = /\.nw-surface\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\n\}/g;
let pm;
while ((pm = paletteRe.exec(editor))) palettes[pm[1]] = pm[2];

const THEMES = ['claude', 'eye', 'night', 'newspaper', 'magazine'];
for (const theme of THEMES) {
  const block = palettes[theme];
  ok(!!block, `theme ${theme}: palette block not found`);
  if (!block) continue;
  const bg = hex(token(block, 'nw-bg'));
  const hl = rgba(token(block, 'nw-hl-bg'));
  const active = rgba(token(block, 'nw-hl-active'));
  const comment = hex(token(block, 'nw-mark-comment'));
  ok(!!bg, `theme ${theme}: --nw-bg is not a hex colour`);
  ok(!!hl, `theme ${theme}: --nw-hl-bg missing or not rgba()`);
  ok(!!active, `theme ${theme}: --nw-hl-active missing or not rgba()`);
  ok(!!comment, `theme ${theme}: --nw-mark-comment missing or not hex`);
  if (!bg || !hl || !active || !comment) continue;

  const wash = over(hl.rgb, hl.a, bg);
  const strong = over(active.rgb, active.a, bg);
  const noteWash = over(comment, 0.28, bg);
  ok(contrast(wash, bg) >= 1.12, `theme ${theme}: advice highlight is too close to the paper (${contrast(wash, bg).toFixed(2)}:1)`);
  ok(contrast(strong, bg) > contrast(wash, bg), `theme ${theme}: the active advice highlight is not stronger than the resting one`);
  ok(contrast(noteWash, bg) >= 1.12, `theme ${theme}: comment wash is too close to the paper (${contrast(noteWash, bg).toFixed(2)}:1)`);
  ok(distance(wash, noteWash) >= 45, `theme ${theme}: advice tint and comment tint are nearly the same colour`);

  notes.push(
    `${theme}: paper ${token(block, 'nw-bg')}, advice ${contrast(wash, bg).toFixed(2)}:1, ` +
    `active ${contrast(strong, bg).toFixed(2)}:1, comment ${contrast(noteWash, bg).toFixed(2)}:1`,
  );
}

// The five papers must not share one identical highlight: that was the report.
const seen = new Map();
for (const theme of THEMES) {
  const block = palettes[theme] || '';
  const hl = rgba(token(block, 'nw-hl-bg'));
  if (!hl) continue;
  const key = hl.rgb.join(',');
  ok(!seen.has(key), `theme ${theme}: shares the exact advice tint with ${seen.get(key)} — the tint must follow the paper`);
  seen.set(key, theme);
}

// ---- 2. no underline on either kind --------------------------------------
const adv = rule(editor, '.nw-hl .nw-hl-mark');
ok(!!adv, '.nw-hl .nw-hl-mark: rule not found');
if (adv) {
  ok(!/box-shadow\s*:/.test(adv), '.nw-hl .nw-hl-mark: still paints a box-shadow (the old bottom rule)');
  ok(adv.includes('--nw-hl-bg'), '.nw-hl .nw-hl-mark: does not use the per-paper --nw-hl-bg');
}
const advActive = rule(editor, '.nw-hl .nw-hl-mark[data-active="1"]');
ok(!!advActive, '.nw-hl .nw-hl-mark[data-active="1"]: rule not found');
if (advActive) {
  ok(!/box-shadow\s*:/.test(advActive), 'active advice highlight: still paints a box-shadow');
  ok(advActive.includes('--nw-hl-active'), 'active advice highlight: does not use --nw-hl-active');
}

for (const [file, text, prefix] of [
  ['60-editor.js', editor, '.nw-hl '],
  ['62-read.js', read, ''],
]) {
  const base = rule(text, prefix + '.nw-mark-comment');
  ok(!!base, `${file}: .nw-mark-comment rule not found`);
  if (base) {
    ok(!/box-shadow\s*:\s*inset/.test(base), `${file}: .nw-mark-comment still paints the old inset bottom rule`);
    ok(!/text-decoration/.test(base), `${file}: .nw-mark-comment uses text-decoration`);
    ok(base.includes('--nw-mark-comment'), `${file}: .nw-mark-comment does not use the per-paper comment ink`);
  }
  for (const state of ['data-active', 'data-hover']) {
    const sel = prefix + `.nw-mark-comment[${state}="1"]`;
    const body = rule(text, sel);
    ok(!!body, `${file}: ${sel} override missing (a generic [${state}] rule would underline the comment)`);
    if (body) ok(/box-shadow\s*:\s*none/.test(body), `${file}: ${sel} does not clear the underline`);
  }
}

// The underline mark is supposed to have its line; don't let the fix remove it.
const underline = rule(read, '.nw-mark-underline');
ok(!!underline && /inset 0 -/.test(underline), '62-read.js: the underline mark lost its line');

// The advice card's quote was underlined to mirror the paper rule. Both are gone.
const quote = rule(app, '.nw-advice-quote');
ok(!!quote, '90-app.js: .nw-advice-quote rule not found');
if (quote) ok(!/text-decoration\s*:\s*underline/.test(quote), '90-app.js: the advice quote is still underlined');

// ---- report ---------------------------------------------------------------
console.log('verify-highlight-style: highlight = wash, never underline');
for (const line of notes) console.log('  ok   ' + line);
if (problems.length) {
  for (const problem of problems) console.error('  FAIL ' + problem);
  console.error(`\n结果: ${problems.length} 个问题`);
  process.exit(1);
}
console.log('  ok   no inset rule on advice / comment marks; each paper has its own tint');
console.log('\n结果: 全部通过 ✅');
