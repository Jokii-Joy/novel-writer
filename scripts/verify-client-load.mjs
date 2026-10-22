#!/usr/bin/env node
// Load-check the built client bundle the way the Harness module loader does.
//
// `node --check` only proves the file parses: it does *not* prove the factory
// body runs. A stray backtick inside a CSS template literal, a reference to a
// helper that was never declared, a `const` used before its line — all of those
// parse fine and then throw the instant the client half is evaluated. When that
// happens the whole module graph fails and the panel disappears from the UI.
//
// So this script evaluates `client/client.js` against a minimal fake of
// `window.__ModuleLoader__` + `react`, captures the factory registration,
// calls the factory, and asserts the returned object carries the slots contract.
//
// Usage: node scripts/verify-client-load.mjs [path-to-bundle]   (exits 1 on any problem)
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = process.argv[2] ? resolve(process.argv[2]) : join(root, 'client', 'client.js');

const code = readFileSync(target, 'utf8');

/** Minimal React stand-in: components are never rendered, only declared. */
function makeReact() {
  const passthrough = (value) => value;
  const hookPair = (initial) => [typeof initial === 'function' ? undefined : initial, passthrough];
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    cloneElement: (element) => element,
    isValidElement: () => true,
    Fragment: 'Fragment',
    useState: hookPair,
    useReducer: (reducer, initial) => [initial, passthrough],
    useEffect: passthrough,
    useLayoutEffect: passthrough,
    useInsertionEffect: passthrough,
    useMemo: (fn) => (typeof fn === 'function' ? fn() : undefined),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useContext: () => ({}),
    useId: () => 'id',
    useTransition: () => [false, passthrough],
    useDeferredValue: (value) => value,
    memo: (component) => component,
    forwardRef: (render) => render,
    createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', _value: value }),
    Children: { map: (children) => children, toArray: (children) => [].concat(children || []) },
  };
  return React;
}

/** The loader only ever supplies `require('react')` to a plugin factory. */
function makeRequire() {
  const React = makeReact();
  const cache = { react: React };
  return (id) => {
    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
    const error = new Error(
      `client bundle requires "${id}", which a plugin bundle cannot resolve ` +
        '(only "react" is available; UI primitive packages are forbidden)',
    );
    error.code = 'UNRESOLVED_REQUIRE';
    throw error;
  };
}

const problems = [];
const fakeDocument = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, removeChild() {} }),
  createTextNode: () => ({}),
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {}, removeChild() {} },
  documentElement: { appendChild() {}, removeChild() {}, hasAttribute: () => false, setAttribute() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};

let captured = null;
const fakeWindow = {
  __ModuleLoader__: {
    load(entry) {
      if (!entry || typeof entry !== 'object') {
        problems.push('load() was called without an entry object');
        return;
      }
      captured = entry;
    },
  },
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'verify-client-load' },
  document: fakeDocument,
};

try {
  // The bundle is a classic script, exactly as the loader evaluates it.
  new Function('window', 'document', 'navigator', 'localStorage', code)(
    fakeWindow,
    fakeDocument,
    fakeWindow.navigator,
    fakeWindow.localStorage,
  );
} catch (error) {
  console.error('verify-client-load: the bundle threw while being evaluated');
  console.error(`  ${error && error.message}`);
  const frame = String((error && error.stack) || '').split('\n')[1] || '';
  if (frame) console.error(`  ${frame.trim()}`);
  process.exit(1);
}

if (!captured) {
  console.error('verify-client-load: window.__ModuleLoader__.load() was never called');
  process.exit(1);
}
if (!captured.id) problems.push('the loader entry has no id');
if (typeof captured.factory !== 'function') problems.push('the loader entry has no factory function');

let mod = null;
if (typeof captured.factory === 'function') {
  try {
    mod = captured.factory(makeRequire());
  } catch (error) {
    console.error('verify-client-load: the factory threw — the panel would vanish from the UI');
    console.error(`  ${error && error.message}`);
    const stack = String((error && error.stack) || '').split('\n').slice(1, 4);
    for (const line of stack) console.error(`  ${line.trim()}`);
    process.exit(1);
  }
}

if (!mod || typeof mod !== 'object') {
  console.error('verify-client-load: the factory did not return a module object');
  process.exit(1);
}
if (typeof mod.apply !== 'function') problems.push('module.apply is not a function');
const inject = Array.isArray(mod.inject) ? mod.inject : [];
if (!inject.includes('slots')) problems.push(`module.inject must contain "slots" (got ${JSON.stringify(mod.inject)})`);

if (problems.length > 0) {
  console.error('verify-client-load: FAILED');
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`verify-client-load: ok (id=${captured.id}, inject=${JSON.stringify(inject)})`);
