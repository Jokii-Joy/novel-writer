#!/usr/bin/env node
/**
 * R113: the lock screen is a room that follows the theme.
 *
 *   node scripts/verify-lock-screen.mjs
 *
 * Three failures are invisible to a normal build:
 *   - a lock screen with a fixed dark palette looks like another app on the
 *     paper themes (that is why every theme gets its own spine palette);
 *   - the password field is the only way in, so it must keep autofocus,
 *     Enter-to-unlock and the error/disabled states;
 *   - 「始终深色」 must actually pin the night palette, not merely the copy.
 *
 * The markup half is rendered in a small React stub — no browser needed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// --- render the real Lock component ---------------------------------------
let hookIdx = 0;
const hookStore = [];
const React = {
  createElement: (type, props, ...children) => ({
    $$el: true,
    type,
    props: Object.assign({}, props || {}, children.length ? { children: children.length === 1 ? children[0] : children } : {}),
  }),
  memo: (component) => component,
  useState(init) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = typeof init === 'function' ? init() : init;
    return [hookStore[i], () => {}];
  },
  useRef(init) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = { current: init };
    return hookStore[i];
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect() { hookIdx++; },
};
const NW = {
  CSS_PARTS: [],
  t: (key, ...args) => {
    let out = String(key);
    for (let i = 0; i < args.length; i += 1) out = out.replace(new RegExp('\\{' + i + '\\}', 'g'), String(args[i]));
    return out;
  },
  icon: () => React.createElement('span', { className: 'icon-stub' }),
  SidebarIcon: () => React.createElement('span', { className: 'brand-stub' }),
  ui: { spinner: () => React.createElement('span', null, '…') },
};
new Function('NW', 'React', 'h', 'window', 'document', read('95-dialogs.js'))(
  NW,
  React,
  React.createElement,
  { setInterval: () => 0, clearInterval: () => {} },
  {},
);

const dialogsSrc = read('95-dialogs.js');
const cssSrc = read('45-dialogs-css.js');
const appSrc = read('90-app.js');

function collect(node, out) {
  if (node == null || node === false) return;
  if (Array.isArray(node)) { node.forEach((child) => collect(child, out)); return; }
  if (typeof node !== 'object' || !node.$$el) return;
  out.push(node);
  const kids = node.props && node.props.children;
  if (kids != null) collect(kids, out);
}

function renderLock(night) {
  hookIdx = 0;
  hookStore.length = 0;
  const tree = NW.dialogs.Lock({ night, onUnlock: async () => true, onClose: null });
  const nodes = [];
  collect(tree, nodes);
  return { tree, nodes };
}

// --- markup ---------------------------------------------------------------
check('锁屏有一个可自动聚焦、回车解锁的密码框', () => {
  const { tree, nodes } = renderLock(false);
  assert.ok(tree && tree.$$el, 'Lock returned an element');
  const input = nodes.find((node) => node.type === 'input');
  assert.ok(input, 'password input exists');
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.autoFocus, true);
  assert.equal(typeof input.props.onKeyDown, 'function', 'Enter is handled');
  const labels = nodes.map((node) => String((node.props && node.props['aria-label']) || '')).join(' ');
  assert.ok(labels.includes('密码'), 'the field is labelled');
});

check('书房场景：书架、书脊、黄铜灯都在，且对读屏隐藏', () => {
  const { nodes } = renderLock(false);
  const classes = nodes.map((node) => String((node.props && node.props.className) || '')).join(' ');
  for (const name of ['nw-lock-head', 'nw-lock-clock', 'nw-lock-main', 'nw-lock-title', 'nw-lock-form', 'nw-lock-go', 'nw-lock-meta', 'nw-lock-shelf', 'nw-lock-lamp', 'nw-lock-spine']) {
    assert.ok(classes.includes(name), `missing .${name}`);
  }
  const shelf = nodes.find((node) => String((node.props && node.props.className) || '') === 'nw-lock-shelf');
  assert.ok(shelf, 'shelf exists');
  assert.equal(shelf.props['aria-hidden'], 'true', 'the scene is decorative');
});

check('图标是锁屏专用线稿：书标、锁、箭头和忙碌环都不借字体', () => {
  const { nodes } = renderLock(false);
  const componentNames = nodes
    .filter((node) => typeof node.type === 'function')
    .map((node) => node.type.name);
  assert.ok(componentNames.includes('LockMark'), 'the brand draws its own book mark');
  assert.ok(componentNames.includes('LockPadlock'), 'the meta row draws its own padlock');
  const go = nodes.find(
    (node) => node.type === 'button' && String(node.props.className || '').includes('nw-lock-go'),
  );
  assert.ok(go, 'unlock button exists');
  const arrow = go.props.children;
  assert.ok(arrow && typeof arrow.type === 'function' && arrow.type.name === 'LockArrow', 'the arrow is an SVG, not a text glyph');
  assert.ok(dialogsSrc.includes("className: 'nw-lock-go-spinner'"), 'busy state has a ring');
  assert.ok(!dialogsSrc.includes("busy ? '…' : '→'"), 'the old text arrow is gone');
  assert.ok(cssSrc.includes('.nw-lock-mark{width:18px'), 'the mark keeps the 18px optical size');
  assert.ok(cssSrc.includes('@keyframes nw-lock-spin'), 'the busy ring actually spins');
  assert.ok(cssSrc.includes('prefers-reduced-motion: reduce'), 'reduced motion is respected');
  assert.ok(cssSrc.includes('.nw-lock-spine-label{'), 'book spines gained a label block');
});

check('夜间文案跟着 night 切换，不在地铁里说「深夜书房」', () => {
  const day = renderLock(false);
  const night = renderLock(true);
  const textOf = (result) => {
    const out = [];
    const walk = (node) => {
      if (node == null) return;
      if (typeof node === 'string') { out.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.$$el) walk(node.props && node.props.children);
    };
    walk(result.tree);
    return out.join(' ');
  };
  assert.ok(textOf(day).includes('精神空间 · 书房'), 'day copy');
  assert.ok(!textOf(day).includes('深夜书房'), 'day copy does not say 深夜');
  assert.ok(textOf(night).includes('精神空间 · 深夜书房'), 'night copy');
});

// --- css ------------------------------------------------------------------
check('五套主题各有自己的书脊/书架/灯光变量', () => {
  for (const theme of ['claude', 'eye', 'newspaper', 'magazine', 'night']) {
    assert.ok(cssSrc.includes(`.nw-root[data-theme="${theme}"] .nw-lock{`), `missing palette: ${theme}`);
  }
  assert.ok(cssSrc.includes('--nw-lock-b1:'), 'book spine palette exists');
  assert.ok(cssSrc.includes('--nw-lock-lamp-filter:'), 'lamp glow follows the theme');
  assert.ok(cssSrc.includes('--nw-lock-board:'), 'shelf follows the theme');
});

check('密码框只保留主题色下划线，不出现原生焦点方框', () => {
  assert.ok(cssSrc.includes('.nw-lock-input:focus-visible{outline:none;}'), 'focus outline is suppressed for the underlined field');
  assert.ok(cssSrc.includes('.nw-lock-input:focus{outline:none;border-bottom-color:var(--nw-brand);}'), 'focus paints the underline');
});

check('窄面板分层收：先关灯、再减书、最后撤掉整间房', () => {
  assert.ok(cssSrc.includes('@container nw (max-width: 1240px)'), 'lamp tier');
  assert.ok(cssSrc.includes('@container nw (max-width: 1100px)'), 'half-shelf tier');
  assert.ok(cssSrc.includes('@container nw (max-width: 980px)'), 'room hidden tier');
  assert.ok(cssSrc.includes('@container nw (max-width: 720px)'), 'phone tier');
  assert.ok(cssSrc.includes('.nw-lock-volumes'), 'volumes are grouped so bookends stay');
});

check('旧版居中卡片样式已经退休', () => {
  assert.ok(!cssSrc.includes('.nw-lock-card{'), '45-dialogs-css still has the old card');
  assert.ok(!read('97-theme.js').includes('.nw-lock-card{'), '97-theme still overrides the old card');
});

// --- wiring / settings ----------------------------------------------------
check('浅色主题不锁死深色；「始终深色」才把 data-theme 钉到 night', () => {
  assert.ok(appSrc.includes("settings.lockDark === true || String(themeSettings.theme || '') === 'night'"), 'lockNight is resolved');
  assert.ok(appSrc.includes("'data-theme': lockNight ? 'night' : themeSettings.theme || 'claude'"), 'data-theme follows lockNight');
  assert.ok(appSrc.includes('night: lockNight'), 'Lock receives the resolved night flag');
});

check('设置里有「锁屏外观」的两档，且默认跟随主题', () => {
  assert.ok(read('10-db.js').includes('lockDark: false'), 'default is follow-theme');
  assert.ok(dialogsSrc.includes("label: NW.t('锁屏外观')"), 'settings field exists');
  assert.ok(dialogsSrc.includes("label: NW.t('始终深色')"), 'pinned-dark option exists');
  assert.ok(dialogsSrc.includes("set('lockDark', value === 'dark')"), 'selection is persisted');
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
