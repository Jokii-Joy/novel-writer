// Persistent client-side state that must survive a WebView profile reset.
//
// Why this file exists: the studio keeps the password verifier and a handful of
// layout preferences in `localStorage`, and the library itself in IndexedDB.
// Both live inside the Harness WebView profile (on Windows
// `%APPDATA%\@deepseek-ai\dsh-desktop`), which a host reinstall can replace
// wholesale. The observed result was 「重装宿主后密码和设置都没了」 while the books
// came back from the sync mirror — the browser half had lost exactly the two
// things the host had never kept a copy of.
//
// `DSH_HOME` survives a reinstall, so the pieces the client cannot rebuild are
// mirrored there:
//
//   crypto    { salt, iterations, verifier } — enough to re-prompt for the
//             password on a fresh profile. The password itself is never stored
//             here (or anywhere else); the verifier is the AES-GCM ciphertext of
//             a fixed string, exactly what localStorage already held.
//   settings  the IndexedDB `settings` row (theme, fonts, typewriter, ...).
//   prefs     the `nw.*` localStorage keys (layout, last chapter, ...).
//
// This is NOT a manuscript backup. Books live in IndexedDB, the folder mirror
// and the LAN sync mirror; losing this file costs a re-typed password and some
// preference flips, never prose.

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { dataRoot } from './library.js';

export const CLIENT_STATE_VERSION = 1;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_SETTINGS_BYTES = 128 * 1024;
const MAX_PREFS = 200;
const MAX_PREF_VALUE = 4096;
const PREF_KEY_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function fail(code, message) {
  return { ok: false, code, message };
}

function str(value) {
  return value == null ? '' : String(value);
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// R99: every mutation below is a read-modify-write of the same JSON file, and
// the client mirrors settings/prefs on a debounce while `crypto.save` is
// awaited. Two requests in flight used to interleave: A reads crypto=null,
// B saves the verifier, A writes its stale whole-object snapshot back and the
// verifier is gone — exactly the reinstall scenario this file exists to fix.
// One promise chain makes each read→write atomic with respect to the others.
let stateChain = Promise.resolve();

function serialised(task) {
  const run = stateChain.then(task, task);
  stateChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** `<DSH_HOME>/novel-writer/client-state.json` — survives a host reinstall. */
export function clientStatePath() {
  return path.join(dataRoot(), 'client-state.json');
}

function emptyState() {
  return { version: CLIENT_STATE_VERSION, crypto: null, settings: null, prefs: null, updatedAt: 0 };
}

function normalize(raw) {
  if (!isObject(raw)) return emptyState();
  const crypto = isObject(raw.crypto)
    && typeof raw.crypto.salt === 'string'
    && typeof raw.crypto.verifier === 'string'
    ? {
        salt: raw.crypto.salt,
        iterations: Number(raw.crypto.iterations) || 0,
        verifier: raw.crypto.verifier,
        updatedAt: Number(raw.crypto.updatedAt) || 0,
      }
    : null;
  return {
    version: CLIENT_STATE_VERSION,
    crypto,
    settings: isObject(raw.settings) ? raw.settings : null,
    prefs: isObject(raw.prefs) ? raw.prefs : null,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

/** Read the whole client state. Never throws; a corrupt file degrades to empty. */
export async function read() {
  let text;
  try {
    text = await fsp.readFile(clientStatePath(), 'utf8');
  } catch {
    return emptyState();
  }
  try {
    return normalize(JSON.parse(text));
  } catch {
    console.warn('[novel-writer] client-state.json 解析失败，按空状态处理（下次写入会覆盖）');
    return emptyState();
  }
}

async function writeAtomic(value) {
  const target = clientStatePath();
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > MAX_STATE_BYTES) {
    throw Object.assign(new Error('客户端状态超过 256KB'), { code: 'state-too-large' });
  }
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temp, target);
  } catch (error) {
    try {
      await fsp.rm(temp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
  // The verifier is not the password, but it is the offline-guessing oracle for
  // it; keep the file as private as the secret store (advisory on Windows).
  try {
    await fsp.chmod(target, 0o600);
  } catch {
    /* advisory */
  }
}

/**
 * Persist the password verifier.
 *
 * Validation is deliberately strict: this file is the only thing that lets a
 * wiped profile find its password again, and a truncated verifier would lock the
 * user out of their own ciphertext (the derived key would never match).
 */
export async function saveCrypto(input) {
  const meta = isObject(input) ? input : {};
  const salt = str(meta.salt).trim();
  const verifier = str(meta.verifier).trim();
  const iterations = Math.trunc(Number(meta.iterations) || 0);
  if (salt.length < 8 || salt.length > 128) {
    return fail('crypto-invalid', '密码盐长度异常，未保存');
  }
  if (verifier.length < 16 || verifier.length > 2048) {
    return fail('crypto-invalid', '密码校验值长度异常，未保存');
  }
  if (iterations < 10000 || iterations > 2000000) {
    return fail('crypto-invalid', 'PBKDF2 迭代次数异常，未保存');
  }
  try {
    const next = await serialised(async () => {
      const current = await read();
      const out = {
        ...current,
        crypto: { salt, iterations, verifier, updatedAt: Date.now() },
        updatedAt: Date.now(),
      };
      await writeAtomic(out);
      return out;
    });
    return { ok: true, crypto: { ...next.crypto } };
  } catch (error) {
    return fail('client-state-write-failed', `保存密码校验值失败：${error && error.message ? error.message : error}`);
  }
}

/** Remove the verifier (user cleared the password). Keeps settings/prefs. */
export async function clearCrypto() {
  try {
    await serialised(async () => {
      const current = await read();
      await writeAtomic({ ...current, crypto: null, updatedAt: Date.now() });
    });
  } catch (error) {
    return fail('client-state-write-failed', `清除密码校验值失败：${error && error.message ? error.message : error}`);
  }
  return { ok: true, crypto: null };
}

/** Mirror the IndexedDB settings row. */
export async function saveSettings(input) {
  if (!isObject(input)) return fail('settings-invalid', '设置必须是 JSON 对象');
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(input), 'utf8');
  } catch {
    return fail('settings-invalid', '设置无法序列化');
  }
  if (size > MAX_SETTINGS_BYTES) return fail('settings-too-large', '设置超过 128KB，未备份');
  try {
    await serialised(async () => {
      const current = await read();
      await writeAtomic({ ...current, settings: input, updatedAt: Date.now() });
    });
  } catch (error) {
    return fail('client-state-write-failed', `备份设置失败：${error && error.message ? error.message : error}`);
  }
  return { ok: true, size };
}

/** Mirror the `nw.*` localStorage preferences (strings only). */
export async function savePrefs(input) {
  if (!isObject(input)) return fail('prefs-invalid', '偏好必须是 JSON 对象');
  const entries = Object.entries(input);
  if (entries.length > MAX_PREFS) return fail('prefs-too-large', `偏好项超过 ${MAX_PREFS} 条`);
  const prefs = {};
  for (const [key, value] of entries) {
    if (!PREF_KEY_RE.test(key)) return fail('prefs-invalid', `偏好键不合法：${key.slice(0, 40)}`);
    if (value == null) continue;
    const text = str(value);
    if (text.length > MAX_PREF_VALUE) return fail('prefs-too-large', `偏好 ${key} 的值超过 ${MAX_PREF_VALUE} 字符`);
    prefs[key] = text;
  }
  try {
    await serialised(async () => {
      const current = await read();
      await writeAtomic({ ...current, prefs, updatedAt: Date.now() });
    });
  } catch (error) {
    return fail('client-state-write-failed', `备份界面偏好失败：${error && error.message ? error.message : error}`);
  }
  return { ok: true, count: Object.keys(prefs).length };
}
