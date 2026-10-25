// Encrypted local secret storage for @local/novel-writer.
//
// Layout (under DSH_HOME, defaulting to ~/.dsh):
//   <DSH_HOME>/novel-writer/secrets/key.bin    32 random bytes, mode 0600
//   <DSH_HOME>/novel-writer/secrets/store.enc  AES-256-GCM envelope of a JSON object
//
// Nothing here ever throws to the caller: a missing key, unreadable file or
// corrupt payload degrades to `{}`. No key material is hardcoded.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;

/** Root data directory for the plugin (`<DSH_HOME>/novel-writer`). */
export function dataRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'novel-writer');
}

/** Directory that holds key.bin / store.enc. */
export function secretsDir() {
  return path.join(dataRoot(), 'secrets');
}

function keyPath() {
  return path.join(secretsDir(), 'key.bin');
}

function storePath() {
  return path.join(secretsDir(), 'store.enc');
}

// The key is cached per resolved path so a DSH_HOME change (tests) is honoured.
let keyCache = { path: null, key: null };
// Single-flight guard: two concurrent first-run calls must not each mint a key
// (the loser's writeFile would land last and desync key.bin from store.enc).
let keyInFlight = { path: null, promise: null };

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Persist `key` to `target` atomically (temp file + rename). */
async function writeKeyFile(target, key) {
  await fsp.mkdir(secretsDir(), { recursive: true, mode: 0o700 });
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  const mode = 0o600;
  await fsp.writeFile(temp, key, { mode });
  try {
    await fsp.rename(temp, target);
  } catch (error) {
    // Windows can refuse to replace a file another handle just touched
    // (EPERM/EACCES). Fall back to writing in place rather than losing the key.
    if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EEXIST')) {
      await fsp.writeFile(target, key, { mode });
      try {
        await fsp.rm(temp, { force: true });
      } catch {
        /* best effort */
      }
    } else {
      try {
        await fsp.rm(temp, { force: true });
      } catch {
        /* best effort */
      }
      throw error;
    }
  }
  try {
    await fsp.chmod(target, 0o600);
  } catch {
    /* chmod is advisory on Windows */
  }
}

/** Read the key file, or create it atomically. Caches the result. */
async function loadOrCreateKey(target) {
  try {
    const existing = await fsp.readFile(target);
    if (existing.length >= KEY_BYTES) {
      const key = Buffer.from(existing.subarray(0, KEY_BYTES));
      keyCache = { path: target, key };
      return key;
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // Unreadable key file: the caller degrades to `{}`, do not create a
      // second key that would silently invalidate the existing store.
      throw error;
    }
  }

  const key = randomBytes(KEY_BYTES);
  await writeKeyFile(target, key);
  keyCache = { path: target, key };
  return key;
}

/**
 * Restore `key.bin` from the cached key if something removed it while the
 * process was running. The in-memory key is the only thing that can still
 * decrypt an existing `store.enc`, so rewriting it — rather than minting a new
 * one — keeps the store readable.
 */
async function rehydrateCachedKey(target, key) {
  try {
    await fsp.access(target);
    return key;
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    await writeKeyFile(target, key);
    return key;
  }
}

async function readOrCreateKey() {
  const target = keyPath();
  if (keyCache.path === target && keyCache.key) return rehydrateCachedKey(target, keyCache.key);
  if (keyInFlight.path === target) return keyInFlight.promise;

  const promise = loadOrCreateKey(target).finally(() => {
    if (keyInFlight.promise === promise) keyInFlight = { path: null, promise: null };
  });
  keyInFlight = { path: target, promise };
  return promise;
}

function encrypt(plainText, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    alg: ALGO,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  });
}

function decrypt(envelopeText, key) {
  const envelope = JSON.parse(envelopeText);
  if (!isPlainObject(envelope) || envelope.v !== ENVELOPE_VERSION) {
    throw new Error('unsupported secret envelope version');
  }
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const data = Buffer.from(String(envelope.data || ''), 'base64');
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error('invalid secret envelope');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function deepMerge(base, patch) {
  if (!isPlainObject(base)) return isPlainObject(patch) ? deepMerge({}, patch) : patch;
  if (!isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

// Serialize writes so concurrent patchSecrets() calls cannot lose updates.
let writeChain = Promise.resolve();

function enqueue(task) {
  const run = () => task();
  const next = writeChain.then(run, run);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Read the decrypted secret object. Never rejects: returns `{}` on any failure. */
export async function loadSecrets() {
  return readStore();
}

// Internal writer; callers must already hold the write queue. Never call
// saveSecrets() from inside an enqueued task (that would deadlock the chain).
async function writeStore(value) {
  const key = await readOrCreateKey();
  await fsp.mkdir(secretsDir(), { recursive: true, mode: 0o700 });
  const plain = JSON.stringify(isPlainObject(value) ? value : {});
  const encrypted = encrypt(plain, key);
  const target = storePath();
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(temp, encrypted, { mode: 0o600 });
  await fsp.rename(temp, target);
  try {
    await fsp.chmod(target, 0o600);
  } catch {
    /* advisory */
  }
}

async function readStore() {
  try {
    // Key first, then the store: on a fresh profile both are missing, and doing
    // them in parallel let the store's ENOENT reject the pair while `key.bin` was
    // still being written — so the first reader saw "no key" even though one
    // appeared microseconds later.
    const key = await readOrCreateKey();
    const text = await fsp.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(decrypt(text, key));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Replace the whole secret object (encrypted, atomically). Rejects only on I/O failure. */
export async function saveSecrets(obj) {
  const value = isPlainObject(obj) ? obj : {};
  return enqueue(() => writeStore(value));
}

/** Deep-merge `patch` into the stored object and save it. */
export async function patchSecrets(patch) {
  const delta = isPlainObject(patch) ? patch : {};
  return enqueue(async () => {
    const current = await readStore();
    const merged = deepMerge(current, delta);
    await writeStore(merged);
    return merged;
  });
}

/** Remove the encrypted store (the key file is kept so re-saving works). */
export async function clearSecrets() {
  return enqueue(async () => {
    try {
      await fsp.rm(storePath(), { force: true });
    } catch {
      /* already gone */
    }
  });
}

/**
 * Local round-trip self test used by the `selftest` route.
 * Verifies the key exists with the right length and that encrypt/decrypt is stable.
 * Never touches `store.enc`, so a real configuration is not endangered.
 */
export async function probeSecrets() {
  try {
    const key = await readOrCreateKey();
    if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
      return { ok: false, detail: `密钥长度异常: ${key && key.length}` };
    }
    const sample = {
      probe: randomBytes(8).toString('hex'),
      when: Date.now(),
      nested: { kind: 'aliyun', flags: [1, 2, 3] },
    };
    const round = JSON.parse(decrypt(encrypt(JSON.stringify(sample), key), key));
    const same = JSON.stringify(round) === JSON.stringify(sample);
    if (!same) return { ok: false, detail: '加解密往返不一致' };

    // Prove the directory is writable without disturbing store.enc.
    const temp = path.join(secretsDir(), `.probe-${randomBytes(4).toString('hex')}.tmp`);
    await fsp.writeFile(temp, Buffer.from('probe', 'utf8'), { mode: 0o600 });
    await fsp.rm(temp, { force: true });

    return { ok: true, detail: `AES-256-GCM 往返正常，密钥 ${key.length} 字节，目录可写` };
  } catch (error) {
    return { ok: false, detail: `密钥存储不可用: ${error && error.message ? error.message : error}` };
  }
}

/** Locations for diagnostics (never contains secret material). */
export function secretsLocation() {
  return { dir: secretsDir(), key: keyPath(), store: storePath() };
}
