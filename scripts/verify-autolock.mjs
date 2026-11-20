#!/usr/bin/env node
/**
 * R118: 自动锁定为什么「不锁」——回归测试。
 *
 *   node scripts/verify-autolock.mjs
 *
 * Two halves, both needed:
 *
 *  1. Behaviour of the idle clock itself (`15-crypto.js`), driven by a fake
 *     clock. This is the contract the scheduler relies on: `touch()` must reset
 *     the clock, `autoLocked(m)` must only be true when a password exists, the
 *     key is in memory and the idle time really reached m minutes.
 *  2. The scheduler in `90-app.js`, which cannot run outside React. Its three
 *     load-bearing properties are asserted on the source:
 *       - the timer is created once per unlocked session and reads the *latest*
 *         settings through refs (the old effect rebuilt it on every settings
 *         change, which pushed the countdown back for ever);
 *       - waking a hidden window re-checks immediately (Chromium freezes or
 *         heavily throttles timers while minimised);
 *       - `touchActivity` locks an already-expired session *instead of*
 *         refreshing the idle clock — that was the real bug: the first mouse
 *         move after a long sleep forgave the expired session before the next
 *         tick could see it;
 *       - `doLock` cannot be held open by a stalled save or seal pass.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

// ---------------------------------------------------------------------------
// 1. the idle clock (real code, fake clock, real WebCrypto)
// ---------------------------------------------------------------------------
const store = new Map();
const fakeStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => {
    store.set(String(k), String(v));
  },
  removeItem: (k) => {
    store.delete(String(k));
  },
};
globalThis.localStorage = fakeStorage;

let now = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => now;

const NW = {};
globalThis.NW = NW;
// 15-crypto.js is a browser IIFE; run it with the globals it expects.
vm.runInThisContext(read('15-crypto.js'), { filename: '15-crypto.js' });

const MIN = 60000;
const cryptoApi = NW.crypto;

async function idleClockSuite() {
  check('没有密码时永不自动锁定（也不会误锁）', () => {
    assert.equal(cryptoApi.isLocked(), false);
    assert.equal(cryptoApi.isUnlocked(), false);
    assert.equal(cryptoApi.autoLocked(15), false);
  });

  await cryptoApi.setPassword('correct horse');
  check('设了密码且刚解锁：未超时不锁', () => {
    assert.equal(cryptoApi.isUnlocked(), true);
    assert.equal(cryptoApi.autoLocked(15), false);
  });

  check('14 分钟不锁、15 分钟锁（边界准确）', () => {
    now += 14 * MIN;
    assert.equal(cryptoApi.autoLocked(15), false, 'still inside the window');
    now += 1 * MIN;
    assert.equal(cryptoApi.autoLocked(15), true, 'window reached');
  });

  check('touch() 续命后重新计时（活动即不锁）', () => {
    cryptoApi.touch();
    assert.equal(cryptoApi.autoLocked(15), false);
    now += 10 * MIN;
    assert.equal(cryptoApi.autoLocked(15), false);
    now += 6 * MIN;
    assert.equal(cryptoApi.autoLocked(15), true);
  });

  check('lock() 之后 isUnlocked 为假，autoLocked 也必然为假', () => {
    cryptoApi.lock();
    assert.equal(cryptoApi.isUnlocked(), false);
    assert.equal(cryptoApi.isLocked(), true);
    now += 60 * MIN;
    assert.equal(cryptoApi.autoLocked(15), false, 'nothing left to lock');
  });

  check('autoLocked 对 0 / 负数 / NaN 一律为假（关闭自动锁定）', () => {
    for (const bad of [0, -5, NaN, undefined, null, 'abc']) {
      assert.equal(cryptoApi.autoLocked(bad), false, String(bad));
    }
  });

  check('时钟倒退时 idleMs 不为负（睡眠/校时不会瞬间解锁）', () => {
    now -= 5 * MIN;
    assert.equal(cryptoApi.idleMs() >= 0, true);
  });
}

// ---------------------------------------------------------------------------
// 2. the scheduler in 90-app.js
// ---------------------------------------------------------------------------
const appSrc = read('90-app.js');

function sliceBetween(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, `missing ${startMarker}`);
  const j = src.indexOf(endMarker, i + startMarker.length);
  assert.ok(j > i, `missing ${endMarker} after ${startMarker}`);
  return src.slice(i, j);
}

const touchBlock = sliceBetween(appSrc, '    const touchActivity = useCallback(() => {', '    useEffect(() => {\n      if (!ready || locked) return undefined;');
const schedBlock = sliceBetween(appSrc, '    const lockSettingsRef = useRef(settings);', '    // Global shortcut: Ctrl/Cmd+Shift+L locks the studio.');
const lockBlock = sliceBetween(appSrc, '    const doLock = useCallback(async () => {', '    /**\n     * Password just configured');

check('调度器通过 ref 读最新设置，不随 settings 重建', () => {
  assert.ok(schedBlock.includes('const lockSettingsRef = useRef(settings);'));
  assert.ok(schedBlock.includes('lockSettingsRef.current = settings;'));
  assert.ok(schedBlock.includes('const doLockRef = useRef(doLock);'));
  assert.ok(schedBlock.includes('doLockRef.current = doLock;'));
  assert.ok(schedBlock.includes('const live = lockSettingsRef.current || {};'));
});

check('计时器只建一次：5s 一跳，依赖里没有设置项', () => {
  assert.ok(schedBlock.includes('const timer = setInterval(check, 5000);'));
  assert.ok(schedBlock.includes('}, [ready, locked, wantAutoLock, requestLock]);'));
  assert.equal(
    /\[ready, locked, settings\./.test(schedBlock),
    false,
    'settings must not be an effect dependency any more',
  );
});

check('窗口重新可见/获得焦点时立刻补检', () => {
  assert.ok(schedBlock.includes("document.addEventListener('visibilitychange', onWake);"));
  assert.ok(schedBlock.includes("window.addEventListener('focus', onWake);"));
  assert.ok(schedBlock.includes("window.addEventListener('pageshow', onWake);"));
  assert.ok(schedBlock.includes("document.removeEventListener('visibilitychange', onWake);"));
  assert.ok(schedBlock.includes("window.removeEventListener('focus', onWake);"));
  assert.ok(schedBlock.includes("window.removeEventListener('pageshow', onWake);"));
});

check('touchActivity 先判过期再续命（回来第一下就锁）', () => {
  const checkAt = touchBlock.indexOf('if (wantAutoLock()) {');
  const touchAt = touchBlock.indexOf('NW.crypto.touch()');
  assert.ok(checkAt >= 0, 'expiry check exists');
  assert.ok(touchAt >= 0, 'touch still exists');
  assert.ok(checkAt < touchAt, 'the expiry check must come before the touch');
  assert.ok(touchBlock.includes('requestLock();'), 'an expired session locks instead of refreshing');
});

check('锁请求有去重，避免并发 flush/加密', () => {
  assert.ok(schedBlock.includes('const lockAgeRef = useRef(0);'));
  assert.ok(schedBlock.includes('if (now - lockAgeRef.current < 1000) return;'));
  assert.ok(schedBlock.includes('Promise.resolve(doLockRef.current && doLockRef.current())'));
});

check('点击也算活动（根节点绑了 onPointerDown）', () => {
  assert.ok(appSrc.includes('onPointerDown: onRootPointerMove,'));
});

check('doLock 有看门狗：落盘/加密卡住也必须落到锁屏', () => {
  assert.ok(lockBlock.includes('const bail = setTimeout(dropKey, 6000);'));
  assert.ok(lockBlock.includes('NW.crypto.lock()'), 'the watchdog drops the key');
  assert.ok(lockBlock.includes('setLocked(true);'), 'the watchdog shows the lock screen');
  assert.ok(lockBlock.includes('clearTimeout(bail);'), 'a normal lock cancels the watchdog');
});

check('加密（encryptAll）有截止时间，不能拖住锁定', () => {
  assert.ok(lockBlock.includes('const sealWithDeadline = (ms) =>'));
  assert.ok(lockBlock.includes('sealed = await sealWithDeadline(4000);'));
  assert.ok(lockBlock.includes('setTimeout(() => finish(-1), ms)'));
});

check('手动锁（Ctrl/Cmd+Shift+L）仍然走 doLock', () => {
  const shortcut = sliceBetween(appSrc, '    // Global shortcut: Ctrl/Cmd+Shift+L locks the studio.', '    // Global shortcut: Ctrl/Cmd+\\ shows or hides the chapter shelf.');
  assert.ok(shortcut.includes('doLock()'));
});

await idleClockSuite();
Date.now = realNow;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`\n${f.name}\n${f.error && f.error.stack ? f.error.stack : f.error}`);
  process.exit(1);
}
