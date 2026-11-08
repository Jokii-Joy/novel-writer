#!/usr/bin/env node
// Password-recovery check for the client half (R80).
//
// The complaint: 「重装宿主后密码和设置都没了」. The password verifier lives in
// localStorage, which sits in the Harness WebView profile — a host reinstall can
// replace it — while the books come back from the LAN sync mirror. R80 mirrors
// the salt/verifier to DSH_HOME (via the host) and re-hydrates on boot.
//
// This script evaluates `client/src/15-crypto.js` against a fake localStorage and
// a fake `NW.io.crypto`, then walks the exact path a wiped profile takes:
//   1. host has the verifier, localStorage is empty  → hydrate restores it, locked
//   2. the recovered verifier still accepts the old password
//   3. a live profile pushes its verifier to the host
//   4. clearing the password clears the host copy too (no resurrection)
//
// Node 24 provides WebCrypto, btoa/atob and TextEncoder globally, so no shims.
//
// Usage: node scripts/verify-crypto-recovery.mjs      (exits 1 on any regression)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, '..', 'client', 'src', '15-crypto.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

function makeLocalStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

/** One "page load": a fresh module instance with its own localStorage. */
function loadCrypto(localStorage, host) {
  const NW = {
    io: {
      crypto: {
        state: async () => (host.meta ? { ...host.meta } : {}),
        save: async (meta) => {
          host.saves += 1;
          host.meta = { ...meta };
          return { ok: true };
        },
        clear: async () => {
          host.clears += 1;
          host.meta = null;
          return { ok: true };
        },
      },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('NW', 'localStorage', 'window', 'crypto', 'TextEncoder', 'TextDecoder', 'btoa', 'atob', code)(
    NW,
    localStorage,
    { localStorage },
    globalThis.crypto,
    globalThis.TextEncoder,
    globalThis.TextDecoder,
    globalThis.btoa,
    globalThis.atob,
  );
  return NW.crypto;
}

console.log('verify-crypto-recovery: 密码校验值的宿主备份与恢复');

// --- 1. live profile creates a password; the verifier is mirrored to the host ---
const host = { meta: null, saves: 0, clears: 0 };
const live = makeLocalStorage();
const cryptoA = loadCrypto(live, host);
await cryptoA.setPassword('三十万字的密码');
check('设置密码后 localStorage 有盐与校验值',
  Boolean(live.getItem('nw.pwd.salt')) && Boolean(live.getItem('nw.pwd.verifier')));
check('设置密码后宿主拿到一份校验值',
  host.meta && host.meta.salt === live.getItem('nw.pwd.salt') && host.meta.verifier === live.getItem('nw.pwd.verifier'));
check('宿主拿到的迭代次数合法', Number(host.meta && host.meta.iterations) >= 10000);
check('同一页面的 hydrate 不会重复写宿主', await (async () => {
  const before = host.saves;
  await cryptoA.hydrate();
  return host.saves === before;
})());

// --- 2. wipe the profile: empty localStorage, host copy survives ---
const wiped = makeLocalStorage();
const cryptoB = loadCrypto(wiped, host);
const beforeSaves = host.saves;
await cryptoB.hydrate();
check('空 localStorage 时从宿主恢复盐', wiped.getItem('nw.pwd.salt') === host.meta.salt);
check('空 localStorage 时从宿主恢复校验值', wiped.getItem('nw.pwd.verifier') === host.meta.verifier);
check('恢复后是「有密码」状态', await cryptoB.hasPassword() === true);
check('恢复后默认锁定（派生密钥从不落盘）', cryptoB.isUnlocked() === false);
check('恢复过程没有反向写宿主', host.saves === beforeSaves);

// --- 3. the recovered verifier still accepts the original password ---
check('旧密码能通过恢复后的校验', await cryptoB.verifyPassword('三十万字的密码'));
check('错误密码被拒', await cryptoB.verifyPassword('不对的密码') === false);
check('旧密码能解锁恢复后的会話', await cryptoB.unlock('三十万字的密码'));
check('解锁后 isUnlocked 为真', cryptoB.isUnlocked() === true);

// --- 4. clearing the password removes the host copy too ---
check('清除密码成功', await cryptoB.clearPassword('三十万字的密码'));
check('清除后 localStorage 不再有盐与校验值',
  !wiped.getItem('nw.pwd.salt') && !wiped.getItem('nw.pwd.verifier'));
check('清除后宿主副本也被删（不会复活）', host.meta === null && host.clears > 0);
check('清除后 hasPassword 为假', await cryptoB.hasPassword() === false);

// --- 5. a third boot with an empty profile finds nothing and stays empty ---
const empty = makeLocalStorage();
const cryptoC = loadCrypto(empty, host);
await cryptoC.hydrate();
check('没有任何副本时不伪造密码', await cryptoC.hasPassword() === false && host.meta === null);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
