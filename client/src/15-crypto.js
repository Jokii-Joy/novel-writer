;(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // NW.crypto — WebCrypto text encryption for chapter content.
  // Only the derived key lives in memory; the password itself is never stored.
  //   localStorage 'nw.pwd.salt'     base64 of a random 16-byte PBKDF2 salt
  //   localStorage 'nw.pwd.iter'     iteration count (currently 210000)
  //   localStorage 'nw.pwd.verifier' '<ivB64>:<ctB64>' of a fixed verification string
  //   localStorage 'nw.locked'       '1' locked / '0' unlocked (survives restarts)
  // ---------------------------------------------------------------------------

  const ENC_PREFIX = 'enc:v1:';
  const VERIFY_PLAIN = 'novel-writer::verifier::v1';
  const DEFAULT_ITERATIONS = 210000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  const LS_SALT = 'nw.pwd.salt';
  const LS_ITER = 'nw.pwd.iter';
  const LS_VERIFIER = 'nw.pwd.verifier';
  const LS_LOCKED = 'nw.locked';

  /** Derived AES-GCM key (CryptoKey) or null. Never persisted. */
  let cachedKey = null;
  let lastTouch = Date.now();

  function localStore() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      return localStorage;
    } catch (err) {
      return null;
    }
  }

  function lsGet(key) {
    const store = localStore();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function lsSet(key, value) {
    const store = localStore();
    if (!store) return false;
    try {
      store.setItem(key, String(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function lsDel(key) {
    const store = localStore();
    if (!store) return;
    try {
      store.removeItem(key);
    } catch (err) {
      /* no-op */
    }
  }

  function getSubtle() {
    try {
      if (typeof crypto === 'undefined' || !crypto || !crypto.subtle) return null;
      return crypto.subtle;
    } catch (err) {
      return null;
    }
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    try {
      if (typeof crypto !== 'undefined' && crypto && crypto.getRandomValues) {
        crypto.getRandomValues(out);
        return out;
      }
    } catch (err) {
      /* fall through */
    }
    for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
    return out;
  }

  function b64Encode(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < arr.length; i += step) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, Math.min(arr.length, i + step)));
    }
    return btoa(bin);
  }

  function b64Decode(text) {
    const bin = atob(String(text));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function utf8Encode(text) {
    return new TextEncoder().encode(text);
  }

  function utf8Decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function iterations() {
    const raw = Number(lsGet(LS_ITER));
    return raw >= 10000 && raw <= 2000000 ? Math.floor(raw) : DEFAULT_ITERATIONS;
  }

  function hasPasswordSync() {
    return !!(lsGet(LS_SALT) && lsGet(LS_VERIFIER));
  }

  async function deriveKey(password, salt, iter) {
    const subtle = getSubtle();
    if (!subtle) throw new Error('当前环境不支持 WebCrypto');
    const base = await subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /** Encrypts text with the given key; returns '<ivB64>:<ctB64>'. */
  async function encryptWithKey(key, plain) {
    const subtle = getSubtle();
    if (!subtle) throw new Error('当前环境不支持 WebCrypto');
    const iv = randomBytes(IV_BYTES);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8Encode(plain));
    return b64Encode(iv) + ':' + b64Encode(new Uint8Array(ct));
  }

  /** Decrypts '<ivB64>:<ctB64>' with the given key. */
  async function decryptWithKey(key, body) {
    const subtle = getSubtle();
    if (!subtle) throw new Error('当前环境不支持 WebCrypto');
    const raw = String(body || '');
    const idx = raw.indexOf(':');
    if (idx <= 0) throw new Error('密文格式无效');
    const iv = b64Decode(raw.slice(0, idx));
    const ct = b64Decode(raw.slice(idx + 1));
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return utf8Decode(new Uint8Array(plain));
  }

  function isEncrypted(value) {
    return typeof value === 'string' && value.slice(0, ENC_PREFIX.length) === ENC_PREFIX;
  }

  // ------------------------------- public API -------------------------------

  async function hasPassword() {
    try {
      return hasPasswordSync();
    } catch (err) {
      return false;
    }
  }

  async function setPassword(pw) {
    if (typeof pw !== 'string' || pw.length === 0) throw new Error('密码不能为空');
    if (!getSubtle()) throw new Error('当前环境不支持 WebCrypto');
    try {
      const salt = randomBytes(SALT_BYTES);
      const iter = DEFAULT_ITERATIONS;
      const key = await deriveKey(pw, salt, iter);
      const verifier = await encryptWithKey(key, VERIFY_PLAIN);
      lsSet(LS_SALT, b64Encode(salt));
      lsSet(LS_ITER, String(iter));
      lsSet(LS_VERIFIER, verifier);
      cachedKey = key;
      lsSet(LS_LOCKED, '0');
      lastTouch = Date.now();
    } catch (err) {
      throw err instanceof Error ? err : new Error('设置密码失败');
    }
  }

  async function clearPassword(pw) {
    try {
      if (!hasPasswordSync()) {
        cachedKey = null;
        lsDel(LS_LOCKED);
        return true;
      }
      if (typeof pw !== 'string' || pw.length === 0) return false;
      const saltB64 = lsGet(LS_SALT);
      const verifier = lsGet(LS_VERIFIER);
      if (!saltB64 || !verifier) return false;
      const key = await deriveKey(pw, b64Decode(saltB64), iterations());
      let plain = '';
      try {
        plain = await decryptWithKey(key, verifier);
      } catch (err) {
        return false;
      }
      if (plain !== VERIFY_PLAIN) return false;
      lsDel(LS_SALT);
      lsDel(LS_ITER);
      lsDel(LS_VERIFIER);
      lsDel(LS_LOCKED);
      cachedKey = null;
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Verifies a password against the stored salt/verifier/iterations.
   *
   * PURE CHECK: it never assigns cachedKey, never touches 'nw.locked', never
   * rewrites the salt or verifier. Never throws — any problem (no password set,
   * wrong password, WebCrypto unavailable, corrupt localStorage) yields false.
   */
  async function verifyPassword(pw) {
    try {
      if (typeof pw !== 'string' || pw.length === 0) return false;
      if (!hasPasswordSync()) return false;
      const saltB64 = lsGet(LS_SALT);
      const verifier = lsGet(LS_VERIFIER);
      if (!saltB64 || !verifier) return false;
      // A wrong password derives a different AES-GCM key, so decryptWithKey
      // rejects on the authentication tag — it must stay inside this try.
      const key = await deriveKey(pw, b64Decode(saltB64), iterations());
      const plain = await decryptWithKey(key, verifier);
      return plain === VERIFY_PLAIN;
    } catch (err) {
      return false;
    }
  }

  /**
   * Rotates the password, but only after the current one is proven.
   * Returns false and changes NOTHING when oldPassword is wrong (or when the
   * new password is invalid / WebCrypto fails). Does not touch IndexedDB —
   * callers must decryptAll() before and encryptAll() after the rotation.
   */
  async function changePassword(oldPassword, newPassword) {
    try {
      if (typeof newPassword !== 'string' || newPassword.length === 0) return false;
      const matches = await verifyPassword(oldPassword);
      if (!matches) return false;
      await setPassword(newPassword);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function unlock(pw) {
    try {
      if (typeof pw !== 'string' || pw.length === 0) return false;
      const saltB64 = lsGet(LS_SALT);
      const verifier = lsGet(LS_VERIFIER);
      if (!saltB64 || !verifier) return false;
      const key = await deriveKey(pw, b64Decode(saltB64), iterations());
      let plain = '';
      try {
        plain = await decryptWithKey(key, verifier);
      } catch (err) {
        return false;
      }
      if (plain !== VERIFY_PLAIN) return false;
      cachedKey = key;
      lsSet(LS_LOCKED, '0');
      lastTouch = Date.now();
      return true;
    } catch (err) {
      return false;
    }
  }

  function lock() {
    cachedKey = null;
    if (hasPasswordSync()) lsSet(LS_LOCKED, '1');
  }

  function isLocked() {
    if (!hasPasswordSync()) return false;
    return lsGet(LS_LOCKED) !== '0';
  }

  function isUnlocked() {
    return !!cachedKey;
  }

  async function encryptionOn() {
    try {
      if (!cachedKey) return false;
      if (!NW.db || typeof NW.db.getSettings !== 'function') return false;
      const settings = await NW.db.getSettings();
      return !!(settings && settings.encryption === true);
    } catch (err) {
      return false;
    }
  }

  async function encryptText(value) {
    const text = value == null ? '' : String(value);
    if (!text) return '';
    if (isEncrypted(text)) return text;
    if (!cachedKey) throw new Error('已锁定，无法加密');
    try {
      return ENC_PREFIX + (await encryptWithKey(cachedKey, text));
    } catch (err) {
      throw err instanceof Error ? err : new Error('加密失败');
    }
  }

  async function decryptText(value) {
    const text = value == null ? '' : String(value);
    if (!isEncrypted(text)) return text;
    if (!cachedKey) throw new Error('已锁定，无法解密');
    const body = text.slice(ENC_PREFIX.length);
    try {
      return await decryptWithKey(cachedKey, body);
    } catch (err) {
      throw new Error('解密失败：密码不匹配或数据已损坏');
    }
  }

  /** ms since the last NW.crypto.touch(); never negative. */
  function idleMs() {
    const delta = Date.now() - lastTouch;
    return delta > 0 ? delta : 0;
  }

  function touch() {
    lastTouch = Date.now();
  }

  /** true when a password exists, autolock is enabled and idle exceeded. */
  function autoLocked(minutes) {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return false;
    if (!hasPasswordSync() || !isUnlocked()) return false;
    return idleMs() >= mins * 60000;
  }

  NW.crypto = {
    ENC_PREFIX,
    ITERATIONS: DEFAULT_ITERATIONS,
    hasPassword,
    verifyPassword,
    changePassword,
    setPassword,
    clearPassword,
    unlock,
    lock,
    isLocked,
    isUnlocked,
    encryptionOn,
    encryptText,
    decryptText,
    idleMs,
    touch,
    autoLocked,
    isEncrypted,
  };
})();
