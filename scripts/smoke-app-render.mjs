// Smoke: render NW.App() with a tiny React stand-in to catch render-time crashes
// (TDZ, undefined callbacks) that `node --check` and the module loader cannot see.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '..', 'client', 'src', name), 'utf8');

// --- tiny React -------------------------------------------------------------
let hookIdx = 0;
const hookStore = [];
const React = {
  createElement: (type, props, ...children) => ({
    $$el: true,
    type,
    props: Object.assign({}, props || {}, children.length ? { children: children.length === 1 ? children[0] : children } : {}),
  }),
  Fragment: 'fragment',
  useState(init) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = typeof init === 'function' ? init() : init;
    return [hookStore[i], (v) => { hookStore[i] = typeof v === 'function' ? v(hookStore[i]) : v; }];
  },
  useRef(init) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = { current: init };
    return hookStore[i];
  },
  useMemo(fn) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = fn();
    return hookStore[i];
  },
  useCallback(fn) {
    const i = hookIdx++;
    if (!(i in hookStore)) hookStore[i] = fn;
    return hookStore[i];
  },
  useEffect() { hookIdx++; },
  useLayoutEffect() { hookIdx++; },
  useImperativeHandle() { hookIdx++; },
  useContext() { return {}; },
  createContext() { return { Provider: 'p', Consumer: 'c' }; },
  memo: (c) => c,
  Children: { map: (c, f) => (Array.isArray(c) ? c.map(f) : c == null ? [] : [f(c)]), toArray: (c) => (Array.isArray(c) ? c : c == null ? [] : [c]), count: (c) => (Array.isArray(c) ? c.length : c == null ? 0 : 1) },
};

// --- permissive NW ----------------------------------------------------------
const noop = () => {};
const universal = new Proxy(function () {}, {
  get(_t, key) {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === Symbol.iterator) return function* () {};
    if (key === 'then') return undefined;
    if (key === 'length') return 0;
    return universal;
  },
  apply() { return universal; },
  construct() { return universal; },
  set() { return true; },
});

const real = {
  React,
  h: React.createElement,
  CSS_PARTS: [],
  t: (s, ...args) => String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? m : String(args[i]))),
  fmtWords: (n) => String(n),
  version: 'smoke',
  ui: { btn: (o) => React.createElement('button', o || {}), spinner: () => null, prompt: async () => null, confirm: async () => true },
  db: { DEFAULT_SETTINGS: {} },
};
const NW = new Proxy(real, {
  get(t, key) {
    if (key in t) return t[key];
    if (key === Symbol.toPrimitive) return () => '';
    if (key === 'then') return undefined;
    return universal;
  },
  set(t, key, value) { t[key] = value; return true; },
});

const localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
const windowStub = {
  localStorage,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: () => 0,
  clearInterval: noop,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: noop,
  location: { href: '', origin: 'http://localhost' },
  navigator: { userAgent: 'node' },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
};
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: noop, removeChild: noop, setAttribute: noop, removeAttribute: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
const documentStub = {
  documentElement: el(),
  body: el(),
  head: el(),
  createElement: () => el(),
  createTextNode: () => ({}),
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
};

function load(src) {
  return new Function('NW', 'React', 'h', 'window', 'document', src)(NW, React, React.createElement, windowStub, documentStub);
}

load(read('20-format.js'));
load(read('55-welcome.js'));
load(read('90-app.js'));

hookIdx = 0;
hookStore.length = 0;
let tree = null;
try {
  tree = NW.App();
} catch (err) {
  console.error('render failed:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
  process.exit(1);
}
if (!tree || !tree.$$el) {
  console.error('render returned no element');
  process.exit(1);
}
console.log('smoke-app-render: ok (' + String(tree.type).slice(0, 40) + ')');
const wprops = {
  novels: [], chapters: [], activeNovelId: null, dailyStats: {}, dailyGoal: 500,
  countPunctuation: true, submissions: [], recent: [], lastChapterMap: {},
  onResumeChapter: () => {}, onMicroGoal: () => {}, onSetDailyGoal: () => {},
  onOpenNovel: () => {}, onNewNovel: () => {}, onOpenChapter: () => {}, onSetView: () => {},
};
hookIdx = 0; hookStore.length = 0;
let wtree = null;
try { wtree = NW.Welcome(wprops); } catch (err) {
  console.error('welcome failed:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
  process.exit(1);
}
if (!wtree || !wtree.$$el) {
  console.error('welcome returned no element');
  process.exit(1);
}
console.log('smoke-welcome: ok (' + String(wtree.type).slice(0, 40) + ')');
