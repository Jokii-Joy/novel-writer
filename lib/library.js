// On-disk novel library for @local/novel-writer.
//
// The browser half keeps its authoritative data in IndexedDB. This module lets
// the user pick a real folder on their machine and have every book mirrored
// there as a Word document (plus a machine-readable snapshot), so the library
// survives browser storage eviction and can be opened, printed or reviewed by
// anybody with Word, WPS or LibreOffice.
//
// Layout:
//   <DSH_HOME>/novel-writer/settings.json      { dir, mirror, lastMirrorAt }
//   <dir>/<safeTitle>.docx                     one file per book
//   <dir>/library.json                         { version, exportedAt, novels }
//
// Every export resolves instead of rejecting: failures come back as
// `{ok:false, code, message}` so `lib/routes.js` can turn them into the
// contract's error envelope. Only Node built-ins are used.

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDocx } from './docx.js';
import { loadSecrets, secretsLocation } from './secrets.js';

/** Bump when `library.json` gains incompatible fields. */
export const SNAPSHOT_VERSION = 1;

/* ------------------------------------------------------------------------- */
/* Mirror encryption (contract §12)                                          */
/* ------------------------------------------------------------------------- */

/**
 * On-disk container for an encrypted mirror file:
 *
 *   NWENC1 | base64( iv[12] || authTag[16] || ciphertext )
 *
 * AES-256-GCM. The key is derived from the shared `secrets/key.bin` through
 * HKDF-SHA256 with the info string below, so the mirror key is never stored
 * separately and rotates automatically if the user wipes their key.
 */
export const MIRROR_MAGIC = 'NWENC1';
export const MIRROR_EXT = '.nwe';
const MIRROR_HKDF_INFO = 'novel-writer-mirror';
const MIRROR_IV_BYTES = 12;
const MIRROR_TAG_BYTES = 16;
const MIRROR_KEY_BYTES = 32;

/** Local filesystem work can still stall (network shares), so cap it. */
const FS_TIMEOUT_MS = 15000;

/** Longest basename (without extension) written to disk. */
const MAX_NAME_CHARS = 80;

// R16: the readable `.docx` twin (R15 `plain`) is gone. A save directory now
// holds exactly one kind of file per book — `.docx` when not encrypting,
// `.docx.nwe` when encrypting — so there is never a cleartext copy lying next to
// an encrypted one.
const DEFAULT_SETTINGS = Object.freeze({ dir: '', mirror: false, encrypt: false, lastMirrorAt: 0 });

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Root data directory for the plugin (`<DSH_HOME>/novel-writer`). */
export function dataRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'novel-writer');
}

/** Absolute path of the persisted settings file. */
export function settingsPath() {
  return path.join(dataRoot(), 'settings.json');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(code, message) {
  return { ok: false, code, message };
}

function messageOf(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

/** Reject after `ms` with an Error carrying `code`. Local FS only, no network. */
function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, ms);
    // Never keep the event loop alive just for the watchdog.
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Coerce a stored/patch value into the canonical settings shape. */
function normalizeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const dir = typeof source.dir === 'string' ? source.dir.trim() : '';
  const mirror = source.mirror === true;
  const encrypt = source.encrypt === true;
  const lastMirrorAt = Number.isFinite(source.lastMirrorAt) ? Number(source.lastMirrorAt) : 0;
  // Unknown keys are preserved so a newer client cannot lose its own settings
  // when an older host rewrites the file.
  return { ...source, dir, mirror, encrypt, lastMirrorAt };
}

function mergeSettings(current, patch) {
  const delta = isPlainObject(patch) ? patch : {};
  const merged = { ...current };
  for (const [key, value] of Object.entries(delta)) merged[key] = value;
  return normalizeSettings(merged);
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

/**
 * Read `<DSH_HOME>/novel-writer/settings.json`.
 * A missing file is normal (first run) and yields the defaults; a corrupt file
 * is reported on the console and also falls back to the defaults. Never throws.
 */
export async function readSettings() {
  try {
    const text = await withTimeout(
      fsp.readFile(settingsPath(), 'utf8'),
      FS_TIMEOUT_MS,
      'settings-read-failed',
      '读取设置超时（15 秒）',
    );
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.warn(`[novel-writer] settings.json 解析失败，已回落默认设置: ${messageOf(error)}`);
      return { ...DEFAULT_SETTINGS };
    }
    if (!isPlainObject(parsed)) {
      console.warn('[novel-writer] settings.json 不是 JSON 对象，已回落默认设置');
      return { ...DEFAULT_SETTINGS };
    }
    return normalizeSettings(parsed);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
    console.warn(`[novel-writer] settings.json 读取失败，已回落默认设置: ${messageOf(error)}`);
    return { ...DEFAULT_SETTINGS };
  }
}

/** Alias kept for callers that phrase it as a getter. */
export function getSettings() {
  return readSettings();
}

/** Write the settings file atomically (temp file in the same directory + rename). */
async function writeSettingsAtomic(value) {
  const target = settingsPath();
  const dir = path.dirname(target);
  await fsp.mkdir(dir, { recursive: true });
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await fsp.writeFile(temp, body, 'utf8');
    await fsp.rename(temp, target);
  } catch (error) {
    try {
      await fsp.rm(temp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
}

/**
 * Merge `patch` into the stored settings and persist atomically.
 * Resolves to the merged settings object, or `{ok:false, code, message}`.
 */
export async function writeSettings(patch = {}) {
  try {
    const current = await readSettings();
    const next = mergeSettings(current, patch);
    await withTimeout(
      writeSettingsAtomic(next),
      FS_TIMEOUT_MS,
      'settings-write-failed',
      '写入设置超时（15 秒）',
    );
    return next;
  } catch (error) {
    return fail('settings-write-failed', `保存设置失败：${messageOf(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Directory validation
// ---------------------------------------------------------------------------

/**
 * Validate and create the user's library directory.
 * * empty / relative path → `{ok:false, code:'dir-invalid'}`
 * * cannot create or cannot write → `{ok:false, code:'dir-unwritable'}`
 * Resolves to `{ok:true, dir}` on success.
 */
export async function ensureDir(dir) {
  const target = typeof dir === 'string' ? dir.trim() : '';
  if (!target) return fail('dir-invalid', '请选择一个小说保存目录');
  if (!path.isAbsolute(target)) return fail('dir-invalid', '保存目录必须是绝对路径（例如 D:\\小说）');

  try {
    await withTimeout(
      fsp.mkdir(target, { recursive: true }),
      FS_TIMEOUT_MS,
      'dir-unwritable',
      '创建目录超时（15 秒），请确认路径可访问',
    );
  } catch (error) {
    return fail('dir-unwritable', `无法创建保存目录：${messageOf(error)}`);
  }

  // mkdir can succeed on an existing *file* only by throwing, so at this point
  // `target` should be a directory. Prove writability with a real probe file:
  // fs.access(W_OK) is unreliable under Windows ACLs.
  const probe = path.join(target, `.novel-writer-probe-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await withTimeout(
      fsp.writeFile(probe, 'probe', 'utf8'),
      FS_TIMEOUT_MS,
      'dir-unwritable',
      '写入探测文件超时（15 秒）',
    );
    await fsp.rm(probe, { force: true });
  } catch (error) {
    try {
      await fsp.rm(probe, { force: true });
    } catch {
      /* best effort */
    }
    return fail('dir-unwritable', `保存目录不可写：${messageOf(error)}`);
  }

  return { ok: true, dir: target };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Truncate by code points so a surrogate pair is never split. */
function truncateChars(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * Turn a book title into a filename stem that is legal on Windows, macOS and
 * Linux: forbidden punctuation and control characters become `_`, whitespace is
 * collapsed, trailing dots/spaces are dropped, device names are escaped and the
 * whole thing is capped at 80 characters.
 */
export function safeTitle(title) {
  let base = String(title == null ? '' : title)
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows rejects names ending in a dot or space.
  base = base.replace(/[. ]+$/g, '');
  if (!base) base = '未命名作品';
  base = truncateChars(base, MAX_NAME_CHARS);
  // Truncation can expose a trailing dot/space again.
  base = base.replace(/[. ]+$/g, '');
  if (!base) base = '未命名作品';
  // Reserved DOS device names cannot be used as a file name on Windows.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `_${base}`;
  return base;
}

/** Make `base` unique within `taken` (case-insensitive, Windows semantics). */
function uniqueStem(base, taken) {
  let stem = truncateChars(base, MAX_NAME_CHARS);
  let counter = 2;
  while (taken.has(stem.toLowerCase())) {
    const suffix = ` (${counter})`;
    const room = Math.max(1, MAX_NAME_CHARS - Array.from(suffix).length);
    stem = `${truncateChars(base, room)}${suffix}`;
    counter += 1;
    if (counter > 999) {
      stem = `${truncateChars(base, MAX_NAME_CHARS - 9)}-${randomBytes(3).toString('hex')}`;
      break;
    }
  }
  taken.add(stem.toLowerCase());
  return stem;
}

// ---------------------------------------------------------------------------
// Mirror / list
// ---------------------------------------------------------------------------

function normalizeNovel(raw) {
  const novel = isPlainObject(raw) ? raw : {};
  const chapters = Array.isArray(novel.chapters) ? novel.chapters : [];
  return {
    title: String(novel.title == null ? '' : novel.title).trim() || '未命名作品',
    author: String(novel.author == null ? '' : novel.author).trim(),
    chapters: chapters
      .filter((chapter) => chapter != null)
      .map((chapter, index) => ({
        title: String(chapter.title == null ? '' : chapter.title).trim() || `第${index + 1}章`,
        content: typeof chapter.content === 'string' ? chapter.content : '',
      })),
  };
}

/**
 * Render one book as a Word document with readable typography: A4, Songti body
 * at 12pt, 1.5 line spacing, first-line indent, a heading per chapter and a
 * page break between chapters. This is the format an editor actually opens.
 */
function renderBookDocx(novel) {
  return Buffer.from(
    buildDocx({
      title: novel.title,
      author: novel.author,
      chapters: novel.chapters.map((chapter) => ({
        title: chapter.title,
        content: chapter.content,
      })),
      options: { pageBreak: true },
    }),
  );
}

async function writeTextFile(target, text) {
  return writeBytesFile(target, Buffer.from(text, 'utf8'));
}

async function writeBytesFile(target, bytes) {
  const payload = Buffer.from(bytes);
  await withTimeout(
    fsp.writeFile(target, payload),
    FS_TIMEOUT_MS,
    'mirror-failed',
    `写入文件超时（15 秒）：${path.basename(target)}`,
  );
  return payload.length;
}

/**
 * Derive the mirror key from `secrets/key.bin` via HKDF-SHA256.
 *
 * `loadSecrets()` is called first on purpose: it creates `key.bin` when missing,
 * so the very first encrypted mirror works without a prior cloud/smtp setup.
 * Resolves to a 32-byte Buffer, or `{ok:false, code, message}`.
 */
export async function deriveMirrorKey() {
  await loadSecrets();
  const location = secretsLocation();
  let raw;
  try {
    raw = await withTimeout(
      fsp.readFile(location.key),
      FS_TIMEOUT_MS,
      'mirror-key-unavailable',
      '读取加密密钥超时（15 秒）',
    );
  } catch (error) {
    return fail('mirror-key-unavailable', `无法读取加密密钥：${messageOf(error)}`);
  }
  if (raw.length < 32) return fail('mirror-key-unavailable', '加密密钥长度异常，请重置密钥存储');
  try {
    const derived = hkdfSync('sha256', raw.subarray(0, 32), Buffer.alloc(0), Buffer.from(MIRROR_HKDF_INFO, 'utf8'), MIRROR_KEY_BYTES);
    return Buffer.from(derived);
  } catch (error) {
    return fail('mirror-key-unavailable', `派生加密密钥失败：${messageOf(error)}`);
  }
}

/** Wrap plaintext into the `NWENC1` container. */
export function encryptMirrorText(plainText, key) {
  return encryptMirrorBytes(Buffer.from(String(plainText), 'utf8'), key);
}

/**
 * Wrap arbitrary bytes into the `NWENC1` container.
 *
 * The book files are Word documents now, so the mirror has to carry binary
 * payloads; the snapshot still stores JSON text through the helper above.
 * Both share one container format, so a reader never has to know which is which
 * until it looks at the decrypted bytes.
 */
export function encryptMirrorBytes(payload, key) {
  const iv = randomBytes(MIRROR_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(payload)), cipher.final()]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), data]);
  return `${MIRROR_MAGIC}${blob.toString('base64')}\n`;
}

/** Unwrap a `NWENC1` container back to bytes. Throws on a bad magic/tag. */
export function decryptMirrorBytes(payload, key) {
  const text = String(payload);
  if (!text.startsWith(MIRROR_MAGIC)) throw new Error('不是加密镜像文件（缺少 NWENC1 头）');
  const blob = Buffer.from(text.slice(MIRROR_MAGIC.length).trim(), 'base64');
  if (blob.length <= MIRROR_IV_BYTES + MIRROR_TAG_BYTES) throw new Error('加密镜像文件已损坏（长度不足）');
  const iv = blob.subarray(0, MIRROR_IV_BYTES);
  const tag = blob.subarray(MIRROR_IV_BYTES, MIRROR_IV_BYTES + MIRROR_TAG_BYTES);
  const data = blob.subarray(MIRROR_IV_BYTES + MIRROR_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Unwrap a `NWENC1` container back to text. Throws on a bad magic/tag. */
export function decryptMirrorText(payload, key) {
  return decryptMirrorBytes(payload, key).toString('utf8');
}

/** True when `name` is one of the files this module writes. */
function isMirrorName(name) {
  if (name === 'library.json' || name === `library.json${MIRROR_EXT}`) return true;
  // `.md` / `.md.nwe` stay recognised so folders written before R10 still list
  // and decrypt; nothing is written in those formats any more.
  return /\.docx$/i.test(name) || /\.docx\.nwe$/i.test(name) ||
    /\.md$/i.test(name) || /\.md\.nwe$/i.test(name);
}

/**
 * Write every book into `dir` as a Word document and refresh `library.json`.
 *
 * R10: books are `.docx` (built by lib/docx.js: A4, Songti 12pt, 1.5 spacing,
 * first-line indent, one page per chapter) — a format an editor actually opens,
 * unlike the Markdown written by earlier releases. Folders from before R10 keep
 * their `.md` files: they still list and decrypt, they are just never written.
 *
 * `options.encrypt === true` swaps the extensions to `.nwe` and stores an
 * AES-256-GCM container instead of plaintext (contract §12). Previously written
 * plaintext files are **not** deleted automatically — the caller decides.
 *
 * Resolves to `{dir, files:[{name, bytes}], count, encrypted}` (count = books)
 * or `{ok:false, code, message}`. Existing unrelated files are left alone.
 */
export async function mirrorLibrary(dir, novels, options = {}) {
  const ensured = await ensureDir(dir);
  if (!ensured.ok) return ensured;
  const target = ensured.dir;
  const list = Array.isArray(novels) ? novels.filter((novel) => novel != null) : [];
  const encrypt = Boolean(options && options.encrypt === true);

  let key = null;
  if (encrypt) {
    const derived = await deriveMirrorKey();
    if (derived && derived.ok === false) return derived;
    key = derived;
  }

  const snapshotName = encrypt ? `library.json${MIRROR_EXT}` : 'library.json';
  const taken = new Set([snapshotName, 'library.json', `library.json${MIRROR_EXT}`]);
  const files = [];
  // Twins left behind by an earlier `plain:true` save. Turning the option off
  // has to delete them, otherwise the folder keeps readable copies of every
  // book and encryption stops meaning anything.
  const stalePlain = [];
  try {
    for (const raw of list) {
      const novel = normalizeNovel(raw);
      const stem = uniqueStem(safeTitle(novel.title), taken);
      const name = `${stem}.docx${encrypt ? MIRROR_EXT : ''}`;
      const docx = renderBookDocx(novel);
      const bytes = await writeBytesFile(
        path.join(target, name),
        encrypt ? Buffer.from(encryptMirrorBytes(docx, key), 'utf8') : docx,
      );
      files.push({ name, bytes });
      if (encrypt) {
        // R16: a `.docx` under this stem can only be a leftover from the
        // removed R15 `plain` option (or from a save made while encryption was
        // off). Leaving it would mean the same book sits on disk in the clear.
        stalePlain.push(`${stem}.docx`);
      }
    }

    for (const name of stalePlain) {
      try {
        await fsp.unlink(path.join(target, name));
      } catch {
        /* nothing to remove, or the file is open elsewhere — not fatal */
      }
    }
    if (encrypt) {
      // R16: same reasoning for the snapshot. `library.json` exposes titles,
      // chapter text and settings in the clear; while encrypting it can only be
      // a leftover, because the live snapshot is `library.json.nwe`. Without
      // encryption `library.json` *is* the snapshot and is rewritten below.
      try {
        await fsp.unlink(path.join(target, 'library.json'));
      } catch {
        /* already absent — nothing to do */
      }
    }

    const snapshot = {
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      novels: list,
    };
    // R9: a bare book list cannot restore a library — the chapters (and the
    // settings that shape their rendering) travel in the same file, so one
    // encrypted snapshot is a complete, restorable backup.
    const extra = options && options.extra && typeof options.extra === 'object' ? options.extra : null;
    if (extra) {
      if (Array.isArray(extra.chapters)) snapshot.chapters = extra.chapters;
      if (extra.settings && typeof extra.settings === 'object') snapshot.settings = extra.settings;
      // R31 ③: 灵感便签 belong to the book. Leaving them out meant "restore from
      // file" brought every chapter back and dropped every note.
      if (Array.isArray(extra.notes)) snapshot.notes = extra.notes;
      // R34: 投稿记录 (the submission log with its 已投稿/已撤回 status) is part
      // of the author's work, not of the machine — it has to ride in the same
      // snapshot or a restore silently resets every status to 已投稿.
      if (Array.isArray(extra.submissions)) snapshot.submissions = extra.submissions;
    }
    const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    const json = await writeTextFile(
      path.join(target, snapshotName),
      encrypt ? encryptMirrorText(snapshotJson, key) : snapshotJson,
    );
    files.push({ name: snapshotName, bytes: json });

    return {
      dir: target,
      files,
      count: list.length,
      encrypted: encrypt,
      // R31 ③: reported so the UI can say 「含 N 条便签」 — a restore that
      // silently drops notes looks exactly like data loss.
      notes: extra && Array.isArray(extra.notes) ? extra.notes.length : 0,
      submissions: extra && Array.isArray(extra.submissions) ? extra.submissions.length : 0,
    };
  } catch (error) {
    return fail('mirror-failed', `写入小说保存目录失败：${messageOf(error)}`);
  }
}

/**
 * Reads back the newest snapshot in `dir` and decrypts it when it is an `.nwe`
 * container, so the UI can restore a library from a single file.
 *
 * Resolves to `{dir, name, encrypted, snapshot}` or `{ok:false, code, message}`.
 */
export async function readSnapshot(dir) {
  const raw0 = typeof dir === 'string' ? dir.trim() : '';
  // Accepting a full file path lets the dialog restore from a single picked
  // file, not only from the configured folder.
  const fileTarget = /\.(json|nwe)$/i.test(raw0) ? raw0 : '';
  const target = fileTarget ? path.dirname(fileTarget) : raw0;
  if (!target) return fail('dir-invalid', '尚未设置小说保存目录');
  if (!path.isAbsolute(target)) return fail('dir-invalid', '保存目录必须是绝对路径');

  let names;
  try {
    names = await withTimeout(fsp.readdir(target), FS_TIMEOUT_MS, 'dir-unreadable', '读取目录超时（15 秒）');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fail('dir-missing', `保存目录不存在：${target}`);
    return fail('dir-unreadable', `读取保存目录失败：${messageOf(error)}`);
  }

  const wanted = fileTarget
    ? [path.basename(fileTarget)].filter((name) => names.includes(name))
    : [`library.json${MIRROR_EXT}`, 'library.json'].filter((name) => names.includes(name));
  if (wanted.length === 0) return fail('nothing-to-restore', '该文件夹里没有备份文件（library.json.nwe 或 library.json）');

  const name = wanted[0];
  let raw;
  try {
    raw = await withTimeout(fsp.readFile(path.join(target, name), 'utf8'), FS_TIMEOUT_MS, 'read-failed', '读取备份文件超时（15 秒）');
  } catch (error) {
    return fail('read-failed', `读取备份文件失败：${messageOf(error)}`);
  }

  const encrypted = raw.startsWith(MIRROR_MAGIC);
  let text = raw;
  if (encrypted) {
    const derived = await deriveMirrorKey();
    if (derived && derived.ok === false) return derived;
    try {
      text = decryptMirrorText(raw, derived);
    } catch (error) {
      return fail('decrypt-failed', `解密备份文件失败：${messageOf(error)}`);
    }
  }

  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    return fail('snapshot-invalid', '备份文件内容不是有效的 JSON');
  }
  if (!snapshot || !Array.isArray(snapshot.novels)) {
    return fail('snapshot-invalid', '备份文件缺少书籍数据，可能不是本插件生成的备份');
  }
  return { dir: target, name, encrypted, snapshot };
}

/**
 * Parse a snapshot the user picked as a *file* rather than a folder.
 *
 * A browser file picker hands the page a Blob, not a filesystem path, so the
 * contents arrive here as text. The container is decrypted with the same key
 * `readSnapshot` uses, which is what makes "import the encrypted .nwe file I
 * copied to another machine" work.
 *
 * Resolves to `{name, encrypted, snapshot}` or `{ok:false, code, message}`.
 */
export async function readSnapshotText(raw, name) {
  const text0 = typeof raw === 'string' ? raw : '';
  const label = typeof name === 'string' && name.trim() ? name.trim() : '备份文件';
  if (!text0.trim()) return fail('snapshot-invalid', `${label}是空文件`);

  const encrypted = text0.startsWith(MIRROR_MAGIC);
  let text = text0;
  if (encrypted) {
    const derived = await deriveMirrorKey();
    if (derived && derived.ok === false) return derived;
    try {
      text = decryptMirrorText(text0, derived);
    } catch (error) {
      return fail('decrypt-failed', `解密 ${label} 失败：${messageOf(error)}`);
    }
  }

  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    return fail('snapshot-invalid', `${label}的内容不是有效的 JSON`);
  }
  if (!snapshot || !Array.isArray(snapshot.novels)) {
    return fail('snapshot-invalid', `${label}缺少书籍数据，可能不是本插件生成的备份`);
  }
  return { name: label, encrypted, snapshot };
}

/** Runs a child process and resolves its trimmed stdout. */
function runCommand(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: false }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Opens the platform folder picker and resolves the chosen absolute path.
 * Windows uses the built-in dialog; elsewhere the UI falls back to typing one.
 */
export async function pickFolder() {
  if (process.platform !== 'win32') {
    return fail('picker-unsupported', '当前系统不能自动弹出文件夹选择器，请手动填写绝对路径');
  }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择小说的自动保存文件夹'",
    "$dialog.ShowNewFolderButton = $true",
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
  ].join('; ');
  try {
    const out = await runCommand('powershell.exe', ['-NoProfile', '-STA', '-Command', script], 180000);
    const picked = String(out || '').trim();
    if (!picked) return fail('cancelled', '已取消选择文件夹');
    if (!path.isAbsolute(picked)) return fail('picker-failed', `返回的路径不是绝对路径：${picked}`);
    return { dir: picked };
  } catch (error) {
    return fail('picker-failed', `打开文件夹选择器失败：${messageOf(error)}`);
  }
}

/**
 * Decrypt every `.nwe` file in `dir` back to plaintext under `outDir`
 * (default `<dir>/plain`). Used by the "导出为可读文件" action.
 *
 * Resolves to `{dir, outDir, files:[{name, bytes}], count}`
 * or `{ok:false, code, message}`.
 */
export async function decryptTo(dir, outDir) {
  const target = typeof dir === 'string' ? dir.trim() : '';
  if (!target) return fail('dir-invalid', '尚未设置小说保存目录');
  if (!path.isAbsolute(target)) return fail('dir-invalid', '保存目录必须是绝对路径');

  const destination = typeof outDir === 'string' && outDir.trim() ? outDir.trim() : path.join(target, 'plain');
  if (!path.isAbsolute(destination)) return fail('out-dir-invalid', '输出目录必须是绝对路径');

  let names;
  try {
    names = await withTimeout(fsp.readdir(target), FS_TIMEOUT_MS, 'dir-unreadable', '读取目录超时（15 秒）');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fail('dir-missing', '保存目录不存在或已被移动');
    return fail('dir-unreadable', `无法读取保存目录：${messageOf(error)}`);
  }

  const sources = names.filter((name) => /\.nwe$/i.test(name));
  if (sources.length === 0) {
    return fail('nothing-to-decrypt', '该目录中没有加密镜像文件（*.nwe）');
  }

  const derived = await deriveMirrorKey();
  if (derived && derived.ok === false) return derived;

  const ensured = await ensureDir(destination);
  if (!ensured.ok) return ensured;

  const files = [];
  try {
    for (const source of sources) {
      const raw = await withTimeout(
        fsp.readFile(path.join(target, source), 'utf8'),
        FS_TIMEOUT_MS,
        'decrypt-failed',
        `读取 ${source} 超时（15 秒）`,
      );
      let plain;
      try {
        plain = decryptMirrorBytes(raw, derived);
      } catch (error) {
        return fail('decrypt-failed', `解密失败（${source}）：${messageOf(error)}`);
      }
      const name = source.replace(/\.nwe$/i, '');
      // Books are .docx (binary) and the snapshot is .json (text); writing both
      // through the byte path keeps Word files intact.
      const bytes = await writeBytesFile(path.join(destination, name), plain);
      files.push({ name, bytes });
    }
  } catch (error) {
    return fail('decrypt-failed', `解密镜像失败：${messageOf(error)}`);
  }

  return { dir: target, outDir: destination, files, count: files.length };
}

/**
 * List the files this module owns inside `dir` (`*.docx` / `*.docx.nwe` + snapshot).
 * Resolves to `{dir, files:[{name, bytes, modified, encrypted}]}` or an error envelope.
 */
export async function listLibrary(dir) {
  const target = typeof dir === 'string' ? dir.trim() : '';
  if (!target) return fail('dir-invalid', '尚未设置小说保存目录');
  if (!path.isAbsolute(target)) return fail('dir-invalid', '保存目录必须是绝对路径');

  let names;
  try {
    names = await withTimeout(
      fsp.readdir(target),
      FS_TIMEOUT_MS,
      'dir-unreadable',
      '读取目录超时（15 秒）',
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') return fail('dir-missing', '保存目录不存在或已被移动');
    return fail('dir-unreadable', `无法读取保存目录：${messageOf(error)}`);
  }

  const files = [];
  for (const name of names) {
    if (!isMirrorName(name)) continue;
    try {
      const stat = await fsp.stat(path.join(target, name));
      if (!stat.isFile()) continue;
      files.push({ name, bytes: stat.size, modified: Math.round(stat.mtimeMs), encrypted: /\.nwe$/i.test(name) });
    } catch {
      /* a file vanished between readdir and stat — just skip it */
    }
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  return { dir: target, files };
}
