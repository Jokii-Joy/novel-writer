// HTTP surface of @local/novel-writer.
//
// The browser half talks to this prefix:
//   GET  <base>novel-writer/api/ping
//   POST <base>novel-writer/api/<method>          (JSON body → JSON reply)
//
// The reply is always HTTP 200 with `{ok:true,data}` or `{ok:false,error:{code,message}}`
// because the client only inspects `ok`. A missing webServer is not an error: the
// plugin still mounts and self-reports the gap through `selftest`.

import { Buffer } from 'node:buffer';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import * as ai from './ai.js';
import * as imap from './imap.js';
import * as journals from './journals.js';
import * as library from './library.js';
import * as secrets from './secrets.js';
import * as smtp from './smtp.js';

/** Prefix owned by this plugin (no trailing slash). */
export const ROUTE_PREFIX = '/novel-writer/api';
/** Largest accepted request body. */
export const MAX_BODY_BYTES = 64 * 1024 * 1024;

export const PLUGIN_NAME = 'novel-writer';
// Reported by `ping`; keep in step with package.json so a stale host module is
// obvious from the outside (the browser half shows this in its diagnostics).
export const PLUGIN_VERSION = '1.2.0';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

/** Error carrying a stable machine-readable `code` for the wire format. */
class RouteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
  }
}

function badRequest(message, code = 'bad-request') {
  return new RouteError(code, message);
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Optional service adapters (the doc engine belongs to another module and may
// be absent at any given moment, so every import is lazy and failure-tolerant).
// ---------------------------------------------------------------------------

const DOC_MODULES = {
  docx: './docx.js',
  epub: './epub.js',
  pdf: './pdf.js',
  importParse: './import-parse.js',
  zip: './zip.js',
};

const docModuleCache = new Map();

async function loadDocModule(key) {
  const specifier = DOC_MODULES[key];
  if (!specifier) return null;
  if (docModuleCache.has(key)) return docModuleCache.get(key);
  const pending = import(new URL(specifier, import.meta.url).href).catch(() => null);
  docModuleCache.set(key, pending);
  return pending;
}

async function callDocModule(key, exportName, ...args) {
  const mod = await loadDocModule(key);
  const fn = mod && mod[exportName];
  if (typeof fn !== 'function') {
    throw new RouteError('engine-unavailable', `文档引擎未就绪（${DOC_MODULES[key] || key} 缺少 ${exportName}）`);
  }
  return fn(...args);
}

// ---------------------------------------------------------------------------
// Request / response helpers
// ---------------------------------------------------------------------------

/** Read the whole body as a Buffer, capped at `limit`. Empty body → empty buffer. */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const settle = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      if (done) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        settle(reject, new RouteError('payload-too-large', `请求体超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
        if (typeof req.destroy === 'function') req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => settle(resolve, Buffer.concat(chunks)));
    req.on('error', (error) => settle(reject, new RouteError('bad-request', `读取请求失败: ${error.message}`)));
    req.on('aborted', () => settle(reject, new RouteError('bad-request', '请求被中断')));
  });
}

/** Parse a JSON body, tolerating an empty body (→ `{}`) and malformed JSON. */
export function parseJsonBody(buffer) {
  if (!buffer || buffer.length === 0) return {};
  const text = buffer.toString('utf8').trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RouteError('bad-json', `请求体不是合法 JSON: ${error.message}`);
  }
  if (parsed == null) return {};
  if (typeof parsed !== 'object') throw new RouteError('bad-json', '请求体必须是 JSON 对象');
  return parsed;
}

/** Method name from a request URL (`/novel-writer/api/ping` → `ping`). */
export function methodFromPath(rawUrl) {
  let pathname = '/';
  try {
    pathname = new URL(rawUrl || '/', 'http://x').pathname;
  } catch {
    pathname = '/';
  }
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  let rest = decoded;
  if (rest.startsWith(ROUTE_PREFIX)) rest = rest.slice(ROUTE_PREFIX.length);
  return rest.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Write one JSON envelope and end the response. */
export function sendJson(res, envelope) {
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
  res.writeHead(200, JSON_HEADERS);
  res.end(payload);
}

function errorEnvelope(error) {
  if (error instanceof RouteError) return { ok: false, error: { code: error.code, message: error.message } };
  const code = error && typeof error.code === 'string' && /^[a-z][a-z0-9-]*$/.test(error.code)
    ? error.code
    : 'internal-error';
  const message = error && error.message ? String(error.message) : String(error || '未知错误');
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function normalizeNovel(raw) {
  const novel = isObject(raw) ? raw : {};
  const chapters = Array.isArray(novel.chapters) ? novel.chapters : [];
  return {
    title: str(novel.title) || '未命名作品',
    author: str(novel.author) || '',
    chapters: chapters
      .filter((chapter) => chapter != null)
      .map((chapter) => ({
        // R14 ①: keep an untitled chapter untitled. Fabricating 「第1章」 here
        // used to leak a heading into every export of a one-piece short story.
        title: str(chapter.title),
        content: typeof chapter.content === 'string' ? chapter.content : '',
      })),
  };
}

/**
 * R14 ①: titles the app generates for you are not titles you chose.
 *
 * A short story written in one sitting lives in the default 「新章节」 the
 * editor creates, so printing 「一、新章节」 on top of it tells an editor
 * nothing and looks machine-made. These are the shapes we strip on their own.
 */
const PLACEHOLDER_TITLES = new Set(['新章节', '未命名', '未命名章节', '正文', '无题', '内容']);

function isPlaceholderTitle(title) {
  const text = str(title).trim();
  if (!text) return true;
  if (PLACEHOLDER_TITLES.has(text)) return true;
  // 「新章节 2」 style copies, and bare 「第X章」 numbering with nothing else.
  if (/^(?:新章节|未命名章节?)\s*\d*$/.test(text)) return true;
  if (/^第\s*[0-9零一二三四五六七八九十百]+\s*[章节回卷幕]$/.test(text)) return true;
  return false;
}

/**
 * Collapse a multi-chapter work into one continuous body.
 *
 * Used for short pieces and for anything the author marked as 不分章: the
 * text keeps its blank-line separation, but no chapter heading and no page
 * break is emitted, so the file reads as one story instead of a numbered
 * outline. Empty chapters are skipped (they carry no prose).
 */
function continuousChapters(chapters) {
  const parts = [];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    const body = str(chapter && chapter.content).replace(/\s+$/, '');
    if (!body.trim()) continue;
    parts.push(body);
  }
  return parts.length > 0 ? [{ title: '', content: parts.join('\n\n') }] : [];
}

/** Longest `appendText` honoured by every export format (contract §10). */
const MAX_APPEND_CHARS = 8000;

/**
 * Normalize the "文末追加固定内容" option into a plain string, capped at
 * `MAX_APPEND_CHARS` code points. Garbage values are treated as "no append".
 */
export function appendTextOf(options) {
  const raw = isObject(options) ? options.appendText : undefined;
  if (typeof raw !== 'string') return '';
  const normalized = raw.replace(/\r\n|\r/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (!normalized) return '';
  const chars = Array.from(normalized);
  return chars.length > MAX_APPEND_CHARS ? chars.slice(0, MAX_APPEND_CHARS).join('') : normalized;
}

/** Plain-text export: title, optional author line, then chapters. */
function buildTxt(novel, appendText = '') {
  const parts = [novel.title];
  if (novel.author) parts.push(`作者：${novel.author}`);
  parts.push('');
  for (const chapter of novel.chapters) {
    // R14 ①: a chapter without a title is continuous prose — no heading line.
    if (str(chapter.title).trim()) {
      parts.push(chapter.title);
      parts.push('');
    }
    parts.push(chapter.content);
    parts.push('');
    parts.push('');
  }
  // Contract §10: the trailing copy is its own block, separated by a blank line.
  if (appendText) {
    parts.push('');
    parts.push(appendText);
    parts.push('');
  }
  return Buffer.from(parts.join('\n').replace(/\n{4,}/g, '\n\n\n'), 'utf8');
}

function safeFilename(title, ext) {
  const base = String(title || 'novel')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'novel';
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

let pdfCapability; // undefined = not probed yet

/**
 * Report what this host can actually build. PDF depends on a runtime service or
 * the bundled LibreOffice kit, so it is probed once (the probe only loads a
 * module and never converts) and then cached; failure to probe means "no".
 */
async function capabilities(ctx) {
  if (pdfCapability === undefined) {
    let available = false;
    try {
      const office = typeof ctx.get === 'function' ? ctx.get('officeToPdf') : undefined;
      if (office) {
        available = true;
      } else {
        const pdf = await loadDocModule('pdf');
        available = Boolean(pdf && typeof pdf.pdfEngineAvailable === 'function' && (await pdf.pdfEngineAvailable()));
      }
    } catch {
      available = false;
    }
    pdfCapability = available;
  }
  return { pdf: pdfCapability, epub: true, docx: true, txt: true };
}

/** GET ping */
export async function handlePing(ctx) {
  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    capabilities: await capabilities(ctx),
  };
}

async function handleModels(ctx) {
  return ai.listModels(ctx);
}

async function handleProofread(ctx, payload) {
  const text = str(payload.text);
  if (!text) throw badRequest('缺少需要校对的正文（text）');
  const result = await ai.proofread(ctx, {
    provider: str(payload.provider) || undefined,
    model: str(payload.model) || undefined,
    text,
    mode: str(payload.mode) || 'normal',
    // R29: the writer's own brief, edited in Settings → 写作. Empty means the
    // shipped default; it is appended, never allowed to replace the JSON contract.
    rules: str(payload.rules),
  });
  return { suggestions: Array.isArray(result && result.suggestions) ? result.suggestions : [] };
}

/**
 * `revise {provider?, model?, text, focus?, note?}` → `{suggestions, model}`.
 *
 * Editorial advice rather than mechanical corrections, so it is a separate
 * route from `proofread`: the two run different prompts and return different
 * shapes (`quote/issue/advice` vs `original/replacement`).
 *
 * `focus` is one of the preset dimensions; `note` is the writer's own free-text
 * instruction and is passed through verbatim (the model prompt gives it
 * precedence over the preset).
 */
async function handleRevise(ctx, payload) {
  const text = str(payload.text);
  if (!text.trim()) throw badRequest('缺少需要点评的正文（text）');
  const result = await ai.revise(ctx, {
    provider: str(payload.provider) || undefined,
    model: str(payload.model) || undefined,
    text,
    focus: str(payload.focus) || 'all',
    note: str(payload.note),
  });
  return {
    suggestions: Array.isArray(result && result.suggestions) ? result.suggestions : [],
    model: str(result && result.model),
  };
}

async function handleImportParse(payload) {
  const name = str(payload.name);
  const base64 = str(payload.base64);
  if (!base64) throw badRequest('缺少文件内容（base64）');
  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('文件内容不是合法的 base64');
  }
  if (bytes.length === 0) throw badRequest('文件内容为空');
  const parsed = await callDocModule('importParse', 'parseImport', { name, bytes });
  const novel = normalizeNovel(parsed);
  return { title: novel.title, author: novel.author, chapters: novel.chapters };
}

async function handleExportBuild(ctx, payload) {
  const format = (str(payload.format) || 'docx').toLowerCase();
  const novel = normalizeNovel(payload.novel);
  const rawOptions = isObject(payload.options) ? payload.options : {};
  // R14 ①: one story, no chapter headings. `continuous` merges every chapter
  // into a single body; `noPlaceholders` only drops the titles the editor
  // invented, keeping real chapter names.
  if (rawOptions.continuous === true) {
    novel.chapters = continuousChapters(novel.chapters);
  } else if (rawOptions.noPlaceholders !== false) {
    novel.chapters = novel.chapters.map((chapter) => (isPlaceholderTitle(chapter.title) ? { ...chapter, title: '' } : chapter));
  }
  // `appendOn === false` is an explicit veto even when text is supplied.
  const appendText = rawOptions.appendOn === false ? '' : appendTextOf(rawOptions);
  // Always re-derive the field so the doc builders never see the raw/oversized
  // value (they simply ignore it when absent).
  const options = { ...rawOptions };
  if (appendText) options.appendText = appendText;
  else delete options.appendText;

  if (format === 'txt') {
    return {
      filename: safeFilename(novel.title, 'txt'),
      mime: MIME.txt,
      base64: buildTxt(novel, appendText).toString('base64'),
    };
  }

  if (format === 'docx') {
    const bytes = await callDocModule('docx', 'buildDocx', {
      title: novel.title,
      author: novel.author,
      chapters: novel.chapters,
      options,
    });
    return { filename: safeFilename(novel.title, 'docx'), mime: MIME.docx, base64: Buffer.from(bytes).toString('base64') };
  }

  if (format === 'epub') {
    const bytes = await callDocModule('epub', 'buildEpub', {
      title: novel.title,
      author: novel.author,
      language: str(options.language) || 'zh-CN',
      chapters: novel.chapters,
      options,
    });
    return { filename: safeFilename(novel.title, 'epub'), mime: MIME.epub, base64: Buffer.from(bytes).toString('base64') };
  }

  if (format === 'pdf') {
    let docxBytes;
    try {
      docxBytes = await callDocModule('docx', 'buildDocx', {
        title: novel.title,
        author: novel.author,
        chapters: novel.chapters,
        options,
      });
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw new RouteError('pdf-unavailable', 'PDF 引擎不可用，请改用 DOCX 导出');
    }
    try {
      const pdfBytes = await callDocModule('pdf', 'docxToPdf', ctx, Buffer.from(docxBytes));
      return { filename: safeFilename(novel.title, 'pdf'), mime: MIME.pdf, base64: Buffer.from(pdfBytes).toString('base64') };
    } catch {
      // Contract §3: a failed conversion is reported with this exact code and message.
      throw new RouteError('pdf-unavailable', 'PDF 引擎不可用，请改用 DOCX 导出');
    }
  }

  throw badRequest(`不支持的导出格式: ${format}`);
}

// ---------------------------------------------------------------------------
// Library (user-chosen on-disk save folder)
// ---------------------------------------------------------------------------

/** Turn a `{ok:false, code, message}` result from lib/library.js into a RouteError. */
function throwLibraryFailure(result, fallbackCode = 'library-failed') {
  const failure = result && typeof result === 'object' ? result : {};
  throw new RouteError(str(failure.code) || fallbackCode, str(failure.message) || '书库操作失败');
}

/**
 * `library.get` → `{dir, mirror, encrypt, lastMirrorAt}`.
 * `dirExists` is an additive convenience for the settings dialog (was the
 * folder moved or deleted?); it never replaces a contract key.
 */
async function handleLibraryGet() {
  const settings = await library.readSettings();
  const dir = str(settings.dir);
  const data = {
    dir,
    mirror: settings.mirror === true,
    encrypt: settings.encrypt === true,
    lastMirrorAt: Number(settings.lastMirrorAt) || 0,
  };
  if (dir) {
    const listed = await library.listLibrary(dir);
    // `dir-missing` is the only proof the folder is gone; an unreadable folder
    // still exists, so report it as present and let `library.list` explain why.
    data.dirExists = !(listed.ok === false && listed.code === 'dir-missing');
  } else {
    data.dirExists = false;
  }
  return data;
}

/** `library.set {dir, mirror, encrypt}` → `{dir, mirror, encrypt, lastMirrorAt}`. */
async function handleLibrarySet(payload) {
  const current = await library.readSettings();
  const patch = {};

  if (payload.dir !== undefined) {
    const dir = str(payload.dir).trim();
    if (dir) {
      const ensured = await library.ensureDir(dir);
      if (ensured.ok === false) throwLibraryFailure(ensured, 'dir-unwritable');
      patch.dir = ensured.dir;
    } else {
      patch.dir = '';
      // Disabling the target also disables automatic mirroring and encryption.
      patch.mirror = false;
      patch.encrypt = false;
    }
  }

  if (payload.mirror !== undefined) patch.mirror = payload.mirror === true;
  if (payload.encrypt !== undefined) patch.encrypt = payload.encrypt === true;

  const nextDir = patch.dir !== undefined ? patch.dir : str(current.dir);
  const nextMirror = patch.mirror !== undefined ? patch.mirror : current.mirror === true;
  // Clearing the folder is the one case where a still-checked "auto sync" box is
  // not an error: the dialog is tearing the target down, so both flags go off
  // instead of surfacing a scary message. Turning sync ON with no folder at all
  // stays an explicit error.
  const clearedDir = payload.dir !== undefined && !str(payload.dir).trim();
  if (nextMirror && !nextDir && !clearedDir) {
    throw badRequest('请先选择小说保存目录，再开启自动同步', 'dir-invalid');
  }
  // Without a target folder neither mirroring nor encryption can do anything, so
  // they are forced off rather than left on as a latent surprise.
  if (!nextDir) {
    patch.mirror = false;
    patch.encrypt = false;
  }

  const saved = await library.writeSettings(patch);
  if (saved && saved.ok === false) throwLibraryFailure(saved, 'settings-write-failed');
  return {
    dir: str(saved.dir),
    mirror: saved.mirror === true,
    encrypt: saved.encrypt === true,
    lastMirrorAt: Number(saved.lastMirrorAt) || 0,
  };
}

/**
 * `library.mirror {novels, encrypt}` → `{dir, files, count, lastMirrorAt, encrypted}`.
 * `encrypt` defaults to the stored setting so an autosync call can omit it.
 */
async function handleLibraryMirror(payload) {
  const settings = await library.readSettings();
  const dir = str(payload.dir).trim() || str(settings.dir);
  if (!dir) throw badRequest('尚未设置小说保存目录，请先在设置中选择', 'dir-invalid');
  const novels = Array.isArray(payload.novels) ? payload.novels : [];
  const encrypt = payload.encrypt === undefined ? settings.encrypt === true : payload.encrypt === true;
  // R9: chapters + settings ride along so the encrypted snapshot alone can
  // restore the whole library (an older client simply omits them).
  const extra = {
    chapters: Array.isArray(payload.chapters) ? payload.chapters : [],
    settings: isObject(payload.settings) ? payload.settings : null,
  };
  const written = await library.mirrorLibrary(dir, novels, { encrypt, extra });
  if (written.ok === false) throwLibraryFailure(written, 'mirror-failed');
  const lastMirrorAt = Date.now();
  await library.writeSettings({ lastMirrorAt });
  return {
    dir: written.dir,
    files: written.files,
    count: written.count,
    encrypted: written.encrypted === true,
    chapters: extra.chapters.length,
    lastMirrorAt,
  };
}

/** `library.pick` → `{dir}` — native folder picker (Windows only). */
async function handleLibraryPick() {
  const picked = await library.pickFolder();
  if (picked.ok === false) throwLibraryFailure(picked, 'picker-failed');
  return { dir: picked.dir };
}

/**
 * `library.restore {dir|path|text,name}` → `{dir, name, encrypted, snapshot}`.
 * The snapshot carries `{novels, chapters, settings}`; the client replaces its
 * IndexedDB contents with it.
 *
 * `text` is the escape hatch for a file the user picked in the browser: the page
 * can read the bytes but never learns a filesystem path, so the host decrypts
 * whatever was picked and returns the same envelope as the folder path.
 */
async function handleLibraryRestore(payload) {
  const raw = str(payload.text);
  if (raw) {
    const read = await library.readSnapshotText(raw, str(payload.name));
    if (read.ok === false) throwLibraryFailure(read, 'restore-failed');
    return { dir: '', name: read.name, encrypted: read.encrypted === true, snapshot: read.snapshot };
  }
  const settings = await library.readSettings();
  const target = str(payload.path).trim() || str(payload.dir).trim() || str(settings.dir);
  if (!target) throw badRequest('尚未设置小说保存目录，请先在设置中选择', 'dir-invalid');
  const result = await library.readSnapshot(target);
  if (result.ok === false) throwLibraryFailure(result, 'restore-failed');
  return result;
}

/** `library.list` → `{dir, files:[{name, bytes, modified}], encrypted}`. */
async function handleLibraryList(payload) {
  const settings = await library.readSettings();
  const dir = str(payload.dir).trim() || str(settings.dir);
  if (!dir) throw badRequest('尚未设置小说保存目录，请先在设置中选择', 'dir-invalid');
  const listed = await library.listLibrary(dir);
  if (listed.ok === false) throwLibraryFailure(listed, 'dir-unreadable');
  const files = Array.isArray(listed.files) ? listed.files : [];
  return {
    dir: listed.dir,
    files,
    // `encrypted` is true when every mirror file on disk is a `.nwe` container.
    encrypted: files.length > 0 && files.every((file) => file && file.encrypted === true),
  };
}

/** `library.decryptTo {dir, outDir}` → `{dir, outDir, files, count}`. */
async function handleLibraryDecryptTo(payload) {
  const settings = await library.readSettings();
  const dir = str(payload.dir).trim() || str(settings.dir);
  if (!dir) throw badRequest('尚未设置小说保存目录，请先在设置中选择', 'dir-invalid');
  const outDir = str(payload.outDir).trim();
  const result = await library.decryptTo(dir, outDir || undefined);
  if (result.ok === false) throwLibraryFailure(result, 'decrypt-failed');
  return { dir: result.dir, outDir: result.outDir, files: result.files, count: result.count };
}

// ---------------------------------------------------------------------------
// Journals (期刊库) — contract §11
// ---------------------------------------------------------------------------

/** `journals.list` → `{journals:[…]}` (built-ins merged with user overrides). */
async function handleJournalsList() {
  const listed = await journals.list();
  if (listed && listed.ok === false) throwLibraryFailure(listed, 'journals-read-failed');
  return { journals: Array.isArray(listed.journals) ? listed.journals : [] };
}

/** `journals.save {entries}` → `{saved, journals}`. */
async function handleJournalsSave(payload) {
  if (!Array.isArray(payload.entries)) throw badRequest('期刊数据必须是数组（entries）', 'journals-invalid');
  const saved = await journals.save(payload.entries);
  if (saved && saved.ok === false) throwLibraryFailure(saved, 'journals-save-failed');
  return { saved: Number(saved.saved) || 0, journals: Array.isArray(saved.journals) ? saved.journals : [] };
}

/**
 * `journals.remove {id}` → `{deleted, journals}`.
 *
 * R11 ⑦: deleting is its own call rather than a `save` with an empty row,
 * because a built-in has to be recorded as a tombstone — otherwise the next
 * read would rebuild it from the shipped table and the delete would appear to
 * have done nothing.
 */
async function handleJournalsRemove(payload) {
  const id = str(payload.id) || str(payload.journalId);
  if (!id) throw badRequest('需要提供要删除的期刊 id', 'journals-invalid');
  const removed = await journals.remove(id);
  if (removed && removed.ok === false) throwLibraryFailure(removed, 'journals-save-failed');
  return {
    deleted: removed.deleted === true,
    journals: Array.isArray(removed.journals) ? removed.journals : [],
  };
}

/**
 * `journals.email {journalId, genre, wordCount}` → `{journal, resolved}`.
 *
 * R6: one journal can publish several inboxes — a magazine that wants short
 * stories at one address and serialised novels at another. The resolution rules
 * live in `lib/journals.js` so the client and `submit.prepare` can never
 * disagree about which address a given manuscript should go to.
 */
async function handleJournalEmail(payload) {
  const id = str(payload.journalId) || str(payload.id);
  if (!id) throw badRequest('需要提供期刊 id', 'journal-id-missing');
  const entry = await journals.find(id);
  if (!entry) throw new RouteError('journal-not-found', '没有找到这本期刊，它可能已被删除。');
  const resolved = journals.resolveEmail(entry, {
    genre: str(payload.genre),
    wordCount: Number(payload.wordCount) || 0,
  });
  return { journal: entry, resolved: resolved };
}

/**
 * `journals.importEmails {text, dryRun}` → `{updated, added, unmatched, skipped, journals}`.
 *
 * Bulk-paste inboxes from a magazine's 征稿启事 page; lines are `期刊名 | 邮箱
 * [| 体裁] [| 字数] [| 备注]`. Rows carrying 体裁/字数 become per-genre /
 * per-length `emails[]` variants, plain rows set the journal's single `email`.
 */
async function handleJournalsImportEmails(payload) {
  const text = str(payload.text);
  if (!text.trim()) throw badRequest('请先粘贴「期刊名 | 邮箱」内容', 'journal-import-empty');
  const result = await journals.importEmails(text, { dryRun: payload.dryRun === true });
  if (result && result.ok === false) {
    throw new RouteError(result.code || 'journals-import-failed', result.message || '导入期刊邮箱失败');
  }
  return result;
}

/**
 * `journals.recommend {work, limit, excerpt, provider, model}`
 *   → `{recommendations:[{journal, score, reasons, match?}], by:'model'|'rules', note?}`
 *
 * R27 ③: the rule-based ranker is only a pre-filter now. It narrows 79 journals
 * to a shortlist, then the model reads the opening of the story and judges two
 * things arithmetic cannot: whether the journal's taste matches this voice, and
 * whether the manuscript is good enough for that tier. When the model is
 * unavailable the call still succeeds with `by:'rules'` and a note, because a
 * submission flow that dies with the LLM is worse than an honest fallback.
 */
async function handleJournalsRecommend(ctx, payload) {
  const work = isObject(payload.work) ? payload.work : payload;
  const shape = {
    wordCount: Number(work.wordCount) || 0,
    genre: str(work.genre),
    tags: Array.isArray(work.tags) ? work.tags : [],
    title: str(work.title),
  };
  // Ask the ranker for a wider shortlist than we will show: the model is allowed
  // to drop rows, and a shortlist of exactly 6 would leave it nothing to choose
  // from when the top scorers are all the same kind of journal.
  const shortlistLimit = Math.max(12, Math.min(30, Math.trunc(Number(payload.limit) || 6) * 3));
  const ranked = await journals.recommend(shape, shortlistLimit);
  if (ranked && ranked.ok === false) throwLibraryFailure(ranked, 'journals-read-failed');
  const rows = Array.isArray(ranked.recommendations) ? ranked.recommendations : [];
  const limit = Math.max(1, Math.min(12, Math.trunc(Number(payload.limit) || 6)));

  const excerpt = str(payload.excerpt);
  if (!excerpt.trim() || rows.length === 0) {
    return { recommendations: rows.slice(0, limit), by: 'rules' };
  }

  try {
    const result = await ai.matchJournals(ctx, {
      provider: str(payload.provider) || undefined,
      model: str(payload.model) || undefined,
      excerpt,
      wordCount: shape.wordCount,
      genre: shape.genre,
      journals: rows.map((row) => row.journal),
    });
    const matches = Array.isArray(result && result.matches) ? result.matches : [];
    if (matches.length === 0) {
      return {
        recommendations: rows.slice(0, limit),
        by: 'rules',
        note: '模型没有给出可用的匹配结果，已按体裁与字数排序',
      };
    }
    const byId = new Map(rows.map((row) => [String(row.journal.id), row]));
    const merged = [];
    for (const match of matches) {
      const base = byId.get(String(match.id));
      if (!base) continue;
      // The rule score stays attached: the card shows the model's verdict, and
      // the numeric score is what the caller persists for "上次推荐过这家".
      merged.push({
        journal: base.journal,
        score: match.fit,
        reasons: [match.verdict, match.reason].filter(Boolean),
        match: { fit: match.fit, verdict: match.verdict, reason: match.reason, quality: match.quality },
        rules: base.reasons,
      });
    }
    if (merged.length === 0) {
      return { recommendations: rows.slice(0, limit), by: 'rules', note: '模型推荐与期刊清单没有交集，已按体裁与字数排序' };
    }
    return { recommendations: merged.slice(0, limit), by: 'model', model: str(result && result.model) };
  } catch (error) {
    return {
      recommendations: rows.slice(0, limit),
      by: 'rules',
      note: `模型暂时不可用，已按体裁与字数排序（${str(error && error.message) || '未知原因'}）`,
    };
  }
}

// ---------------------------------------------------------------------------
// SMTP (投稿发信) — contract §11
//
// The mailbox password never reaches settings.json: the non-secret half (host /
// port / secure / user) lives in `<DSH_HOME>/novel-writer/settings.json` under
// `smtp`, while the password goes into the AES-256-GCM `store.enc` via
// `lib/secrets.js` under the same key.
// ---------------------------------------------------------------------------

const SECRET_SMTP_KEY = 'smtp';

function smtpSettingsOf(settings) {
  const raw = isObject(settings && settings.smtp) ? settings.smtp : {};
  const port = Number(raw.port);
  return {
    host: str(raw.host).trim(),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 465,
    secure: raw.secure !== false,
    user: str(raw.user).trim(),
    from: str(raw.from).trim(),
  };
}

/** Merge stored settings + secret password into one SMTP config object. */
async function smtpConfig() {
  const settings = await library.readSettings();
  const base = smtpSettingsOf(settings);
  const stored = await secrets.loadSecrets();
  const secret = isObject(stored[SECRET_SMTP_KEY]) ? stored[SECRET_SMTP_KEY] : {};
  const pass = str(secret.password);
  return {
    ...base,
    from: base.from || base.user,
    pass,
    hasPassword: Boolean(pass),
    configured: Boolean(base.host),
  };
}

/** `smtp.status` → `{configured, host, port, secure, user, hasPassword}`. */
async function handleSmtpStatus() {
  const cfg = await smtpConfig();
  return {
    configured: cfg.configured,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    hasPassword: cfg.hasPassword,
  };
}

/**
 * `smtp.configure {host,port,secure,user,password,from}` → `{ok, host, port, secure, user, hasPassword}`.
 * An empty `password` leaves the stored one untouched (the dialog never has to
 * echo the secret back); `clearPassword:true` removes it.
 */
async function handleSmtpConfigure(payload) {
  const patch = {};
  if (payload.host !== undefined) patch.host = str(payload.host).trim();
  if (payload.port !== undefined) {
    const port = Number(payload.port);
    patch.port = Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 465;
  }
  if (payload.secure !== undefined) patch.secure = payload.secure !== false;
  if (payload.user !== undefined) patch.user = str(payload.user).trim();
  if (payload.from !== undefined) patch.from = str(payload.from).trim();

  const current = await library.readSettings();
  const next = { ...smtpSettingsOf(current), ...patch };
  const written = await library.writeSettings({ smtp: next });
  if (written && written.ok === false) throwLibraryFailure(written, 'settings-write-failed');

  if (payload.clearPassword === true) {
    await secrets.patchSecrets({ [SECRET_SMTP_KEY]: { password: '' } }).catch(() => {});
  } else if (payload.password !== undefined && str(payload.password).length > 0) {
    await secrets.patchSecrets({ [SECRET_SMTP_KEY]: { password: str(payload.password) } }).catch(() => {});
  }

  const cfg = await smtpConfig();
  return {
    ok: true,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    hasPassword: cfg.hasPassword,
  };
}

/** `smtp.presets {}` → `{presets:[{id,name,host,port,secure,note}]}` (offline). */
async function handleSmtpPresets() {
  return { presets: smtp.PRESETS.map((row) => ({ ...row })) };
}

// ---------------------------------------------------------------------------
// Inbox (收件箱) — IMAP
//
// R8 ⑦ gets the replies *into* the app: journals answer submission mails from
// the very address the author configured for SMTP, so the same account is read
// back over IMAP. Non-secret half under `settings.json → imap`, the password in
// the AES store under its own key.
// ---------------------------------------------------------------------------

const SECRET_IMAP_KEY = 'imap';

function imapSettingsOf(settings) {
  const raw = isObject(settings && settings.imap) ? settings.imap : {};
  const port = Number(raw.port);
  return {
    enabled: raw.enabled === true,
    host: str(raw.host).trim(),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 993,
    secure: raw.secure !== false,
    user: str(raw.user).trim(),
    // `useSmtp` means "this mailbox is the same one I send from", so the dialog
    // has to offer that shortcut: most authors have exactly one mail account.
    useSmtp: raw.useSmtp !== false,
  };
}

/** Merge stored settings + secret password into one IMAP config object. */
async function imapConfig() {
  const settings = await library.readSettings();
  const base = imapSettingsOf(settings);
  const stored = await secrets.loadSecrets();
  const secret = isObject(stored[SECRET_IMAP_KEY]) ? stored[SECRET_IMAP_KEY] : {};
  let pass = str(secret.password);
  let host = base.host;
  let port = base.port;
  let secure = base.secure;
  let user = base.user;

  // Falling back to the SMTP account is the whole point of `useSmtp`: one
  // password, one address, no second round of "which server do I type".
  if (base.useSmtp && (!host || !user)) {
    const smtpCfg = await smtpConfig();
    if (smtpCfg.host) {
      host = host || imapHostFromSmtp(smtpCfg.host);
      user = user || smtpCfg.user;
      if (!base.host) {
        port = 993;
        secure = true;
      }
      if (!pass) pass = smtpCfg.pass;
    }
  }

  return {
    enabled: base.enabled,
    host,
    port,
    secure,
    user,
    pass,
    useSmtp: base.useSmtp,
    hasPassword: Boolean(pass),
    configured: Boolean(host && user),
  };
}

/** `smtp.qq.com` → `imap.qq.com`; unknown shapes are left alone. */
function imapHostFromSmtp(host) {
  const value = str(host).trim();
  if (!value) return '';
  if (/^smtp\./i.test(value)) return value.replace(/^smtp\./i, 'imap.');
  if (/^smtp-mail\./i.test(value)) return value.replace(/^smtp-mail\./i, 'imap-mail.');
  return value;
}

/** `imap.status {}` → `{configured, enabled, host, port, secure, user, hasPassword, presets}`. */
async function handleImapStatus() {
  const cfg = await imapConfig();
  return {
    configured: cfg.configured,
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    useSmtp: cfg.useSmtp,
    hasPassword: cfg.hasPassword,
    presets: imap.PRESETS.map((row) => ({ ...row })),
  };
}

/**
 * `imap.configure {enabled,host,port,secure,user,password,useSmtp}` → same shape as status.
 * An empty `password` leaves the stored one untouched; `clearPassword:true` drops it.
 */
async function handleImapConfigure(payload) {
  const patch = {};
  if (payload.enabled !== undefined) patch.enabled = payload.enabled === true;
  if (payload.host !== undefined) patch.host = str(payload.host).trim();
  if (payload.port !== undefined) {
    const port = Number(payload.port);
    patch.port = Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 993;
  }
  if (payload.secure !== undefined) patch.secure = payload.secure !== false;
  if (payload.user !== undefined) patch.user = str(payload.user).trim();
  if (payload.useSmtp !== undefined) patch.useSmtp = payload.useSmtp !== false;

  const current = await library.readSettings();
  const next = { ...imapSettingsOf(current), ...patch };
  const written = await library.writeSettings({ imap: next });
  if (written && written.ok === false) throwLibraryFailure(written, 'settings-write-failed');

  if (payload.clearPassword === true) {
    await secrets.patchSecrets({ [SECRET_IMAP_KEY]: { password: '' } }).catch(() => {});
  } else if (payload.password !== undefined && str(payload.password).length > 0) {
    await secrets.patchSecrets({ [SECRET_IMAP_KEY]: { password: str(payload.password) } }).catch(() => {});
  }

  return handleImapStatus();
}

/** `imap.test {}` → one real connect + LOGIN + STATUS INBOX. */
async function handleImapTest() {
  const cfg = await imapConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      code: 'imap-not-configured',
      message: '尚未配置收件邮箱（IMAP 主机）',
      hint: '填写 IMAP 服务器地址与账号后再测试；QQ 邮箱是 imap.qq.com，网易是 imap.163.com。',
    };
  }
  const result = await imap.probe(cfg);
  if (result && result.ok === true) {
    return {
      ok: true,
      detail: str(result.detail) || 'IMAP 连接成功',
      messages: Number(result.messages) || 0,
      unseen: Number(result.unseen) || 0,
      certBypassed: result.certBypassed === true,
    };
  }
  const failure = result || {};
  return {
    ok: false,
    code: str(failure.code) || 'imap-test-failed',
    message: str(failure.message) || 'IMAP 连接失败',
    hint: str(failure.hint) || imap.hintFor(failure.code, failure.message, cfg.host),
  };
}

/**
 * `inbox.list {limit?}` → `{configured, enabled, messages, total, unseen, error?, hint?}`.
 *
 * Never throws for a mailbox problem: the home screen calls this on every open,
 * and an unreachable server must degrade to "未连接" instead of breaking startup.
 */
async function handleInboxList(payload) {
  const cfg = await imapConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      enabled: cfg.enabled,
      messages: [],
      total: 0,
      unseen: 0,
      error: '',
      hint: '还没有配置收件邮箱。到「设置 → 投稿」填 IMAP 服务器与授权码，就能在这里看到编辑部的回信。',
    };
  }
  // The home screen asks for the inbox on every mount. Dialing IMAP while the
  // feature is switched off would cost a network round trip (and surface a
  // credential error) for a mailbox the author never asked us to read.
  if (!cfg.enabled) {
    return {
      configured: true,
      enabled: false,
      messages: [],
      total: 0,
      unseen: 0,
      error: '',
      hint: '收件箱已关闭。到「设置 → 投稿」打开「启用收件箱」，就能在这里看到编辑部的回信。',
    };
  }
  const result = await imap.listRecent(cfg, { limit: payload.limit });
  if (result && result.ok === false) {
    return {
      configured: true,
      enabled: cfg.enabled,
      messages: [],
      total: 0,
      unseen: 0,
      error: str(result.message) || '读取收件箱失败',
      hint: str(result.hint) || imap.hintFor(result.code, result.message, cfg.host),
      code: str(result.code),
    };
  }
  return {
    configured: true,
    enabled: cfg.enabled,
    messages: Array.isArray(result.messages) ? result.messages : [],
    total: Number(result.total) || 0,
    unseen: Number(result.unseen) || 0,
    error: '',
    hint: '',
    certBypassed: result.certBypassed === true,
    idStatus: str(result.idStatus),
  };
}

/** `imap.presets {}` → `{presets:[…]}` (offline). */
async function handleImapPresets() {
  return { presets: imap.PRESETS.map((row) => ({ ...row })) };
}

/**
 * `inbox.read {uid}` → `{configured, message:{uid,from,address,subject,date,text}}`.
 *
 * The list only carries headers plus a 160-character snippet, so the reader
 * needs a second round trip. Failures are returned (not thrown) for the same
 * reason as `inbox.list`: the reader is one click away from the home screen and
 * must show "读不到这封" instead of a broken panel.
 */
async function handleInboxRead(payload) {
  const uid = Number(payload.uid);
  if (!Number.isFinite(uid) || uid <= 0) throw badRequest('缺少要读取的邮件编号（uid）');
  const cfg = await imapConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      message: null,
      error: '还没有配置收件邮箱',
      hint: '到「设置 → 投稿」填 IMAP 服务器与授权码后，这里就能读编辑部的回信。',
    };
  }
  const result = await imap.readMessage(cfg, { uid });
  if (result && result.ok === false) {
    return {
      configured: true,
      message: null,
      error: str(result.message) || '读取这封邮件失败',
      hint: str(result.hint) || imap.hintFor(result.code, result.message, cfg.host),
      code: str(result.code),
    };
  }
  return { configured: true, message: result.message || null, error: '', hint: '' };
}

/**
 * `inbox.delete {uid}` → `{configured, deleted, expunged, error, hint}`.
 *
 * R16 ⑤: the home inbox rows can be removed. The host only *marks* `\Deleted`
 * and then tries to expunge; a server that refuses still reports what happened
 * instead of pretending the row is gone.
 */
async function handleInboxDelete(payload) {
  const uid = Number(payload.uid);
  if (!Number.isFinite(uid) || uid <= 0) throw badRequest('缺少要删除的邮件编号（uid）');
  const cfg = await imapConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      deleted: false,
      error: '还没有配置收件邮箱',
      hint: '到「设置 → 投稿」填 IMAP 服务器与授权码后，才能删除邮件。',
    };
  }
  const result = await imap.deleteMessage(cfg, { uid });
  if (result && result.ok === false) {
    return {
      configured: true,
      deleted: false,
      error: str(result.message) || '删除这封邮件失败',
      hint: str(result.hint) || imap.hintFor(result.code, result.message, cfg.host),
      code: str(result.code),
    };
  }
  return {
    configured: true,
    deleted: true,
    expunged: result.expunged === true,
    error: '',
    hint: result.expunged === true ? '' : '服务器只把邮件标记为已删除，需要在你自己的邮箱里再清一次。',
  };
}

/**
 * `smtp.test` → `{ok, detail, attempts}` — one real connect + AUTH + QUIT.
 *
 * When the configured port fails, `smtp.diagnose()` walks the SSL-465 /
 * STARTTLS-587 / plain-25 matrix so a user who typed the right host but the
 * wrong port still gets a working answer instead of "连接已关闭".
 */
async function handleSmtpTest() {
  const cfg = await smtpConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      code: 'smtp-not-configured',
      message: '尚未配置邮箱（SMTP 主机）',
      detail: '尚未配置邮箱（SMTP 主机）',
      attempts: [],
    };
  }
  const result = await smtp.diagnose({ ...cfg, pass: cfg.pass });
  if (result && result.ok === true) {
    return { ok: true, detail: str(result.detail) || 'SMTP 连接成功', attempts: result.attempts || [] };
  }
  const failure = result || {};
  return {
    ok: false,
    code: str(failure.code) || 'smtp-test-failed',
    message: str(failure.message) || 'SMTP 连接失败',
    detail: str(failure.message) || 'SMTP 连接失败',
    attempts: Array.isArray(failure.attempts) ? failure.attempts : [],
  };
}

// ---------------------------------------------------------------------------
// Submission preparation (投稿排版) — contract §11
// ---------------------------------------------------------------------------

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** Chinese numeral for 1..99 (chapter numbering in the fallback formatter). */
function chineseNumber(value) {
  const n = Math.trunc(Number(value) || 0);
  if (n <= 0) return '';
  if (n <= 10) return CN_DIGITS[n];
  if (n < 20) return `十${CN_DIGITS[n - 10]}`;
  if (n < 100) {
    const tens = Math.trunc(n / 10);
    const ones = n % 10;
    return `${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`;
  }
  return String(n);
}

/** Strip an existing 「第X章 / 一、 / 1.」 prefix so we can renumber uniformly. */
function stripChapterNumber(title) {
  return String(title || '')
    .replace(/^\s*(?:第\s*[0-9零一二三四五六七八九十百]+\s*[章节回卷幕])\s*[、.．:：\-—]?\s*/, '')
    .replace(/^\s*(?:[0-9]{1,3}|[零一二三四五六七八九十]{1,3})\s*[、.．]\s*/, '')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Collapse runs of blank lines, normalise ASCII punctuation that sits between
 * Chinese characters, and indent every non-empty paragraph by two full-width
 * spaces. Returns `{text, changes}` so the dialog can show what moved.
 */
function normalizeChapterBody(body) {
  const changes = [];
  const source = String(body == null ? '' : body).replace(/\r\n|\r/g, '\n');

  // 1. excessive blank lines → exactly one
  const collapsed = source.replace(/\n{3,}/g, '\n\n');
  if (collapsed !== source) changes.push({ kind: 'blank-lines', before: '连续空行', after: '压缩为单空行' });

  // 2. ASCII punctuation between CJK characters → full-width
  const PUNCT = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；' };
  const fixed = collapsed.replace(/([\u4e00-\u9fff])\s*([,.!?:;])\s*(?=[\u4e00-\u9fff“”‘’（(]|$)/gm, (match, han, mark) => `${han}${PUNCT[mark] || mark}`);
  if (fixed !== collapsed) changes.push({ kind: 'punct', before: '半角标点', after: '全角标点' });

  // 3. two-character first-line indent on every non-empty paragraph
  const paragraphs = fixed.split('\n').map((line) => {
    const trimmedStart = line.replace(/^[\s\u3000]+/, '');
    if (!trimmedStart) return '';
    return `\u3000\u3000${trimmedStart.replace(/\s+$/, '')}`;
  });
  const text = paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  if (text !== source.trim()) changes.push({ kind: 'indent', before: '未缩进', after: '首行缩进两字' });

  return { text, changes };
}

/** Rule-based manuscript formatting; used directly and as the AI fallback. */
function formatWork(work, profile, genre, options) {
  const source = isObject(work) ? work : {};
  const chapters = Array.isArray(source.chapters) ? source.chapters.filter((row) => row != null) : [];
  const changes = [];
  // R14 ①: short pieces often live in one auto-created 「新章节」. Numbering it
  // 「一、新章节」 adds a heading the author never wrote, and a real short story
  // has no chapters at all — so a single placeholder-named chapter is emitted as
  // continuous body text with no heading.
  const bodyTexts = chapters.map((chapter) => normalizeChapterBody(chapter.content));
  bodyTexts.forEach((body) => changes.push(...body.changes));
  // A single chapter is the whole story: it needs no 「一、」 number, and an
  // auto-generated 「新章节」 is not a title at all — emit it as body text.
  const single = chapters.length === 1;
  const formatted = chapters.map((chapter, index) => {
    const rawTitle = str(chapter.title).trim() || `第${index + 1}章`;
    const bare = stripChapterNumber(rawTitle) || rawTitle;
    const title = isPlaceholderTitle(rawTitle) ? '' : single ? bare : `${chineseNumber(index + 1)}、${bare}`;
    if (title && title !== rawTitle) changes.push({ kind: 'chapter-title', before: rawTitle, after: title });
    return { title, content: bodyTexts[index].text };
  });

  const author = str(isObject(profile) ? profile.penName : '').trim() || str(source.author).trim();
  const contact = str(isObject(profile) ? profile.contact : '').trim();
  const email = str(isObject(profile) ? profile.email : '').trim();
  const signature = str(isObject(profile) ? profile.signature : '').trim();

  const tail = [];
  if (signature) tail.push(signature);
  else if (author) tail.push(author);
  const contacts = [];
  if (contact) contacts.push(`联系方式：${contact}`);
  if (email) contacts.push(`邮箱：${email}`);
  if (contacts.length > 0) tail.push(contacts.join('　'));

  const wordCount = formatted.reduce((sum, chapter) => sum + countChars(chapter.content, options), 0);
  const resolvedGenre = str(genre).trim() || suggestGenre(wordCount);

  return {
    formatted: { title: str(source.title).trim() || '未命名作品', author, chapters: formatted },
    changes: dedupeChanges(changes),
    warnings: [],
    wordCount,
    genre: resolvedGenre,
    tail: tail.join('\n'),
  };
}

/**
 * Character count the way Chinese word processors report it (whitespace excluded).
 *
 * R16 ⑥: punctuation used to be included unconditionally here, while the client
 * counted without it — the same manuscript reported two different numbers in the
 * status bar and the submission preview. Both halves now honour the
 * `countPunctuation` setting: `{includePunctuation:false}` drops the marks.
 */
function countChars(text, options) {
  const body = String(text || '').replace(/\s/g, '');
  if (options && options.includePunctuation === false) {
    return Array.from(body.replace(/[\p{P}\p{S}]/gu, '')).length;
  }
  return Array.from(body).length;
}

/** Contract §11: <2000 微小说 / 2000–2万 短篇 / 2万–10万 中篇 / >10万 长篇. */
function suggestGenre(wordCount) {
  if (wordCount < 2000) return 'weixiaoshuo';
  if (wordCount < 20000) return 'duanpian';
  if (wordCount < 100000) return 'zhongpian';
  return 'changpian';
}

/** Keep one entry per (kind, before, after) so the dialog list stays readable. */
function dedupeChanges(changes) {
  const seen = new Set();
  const out = [];
  for (const change of changes) {
    const key = `${change.kind}\u0000${change.before}\u0000${change.after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(change);
  }
  return out;
}

/**
 * Rule-based cover email used when the model is unavailable.
 *
 * R6: this is now requirement-aware rather than generic. A journal's own
 * `requirements` list, `attachments` list and `paperOnly` flag are echoed back
 * in the mail — journals that demand "主题写明体裁、篇名与字数" or "同时附 Word
 * 文档" get exactly that, and the subject always comes from the journal's
 * `subject` template through `renderSubject()` so a hand-written template wins.
 */
// R7 ③: 期刊的征稿要求是一段自由文字，但真正决定「这封信长什么样」的只有三件事
// ——正文要不要粘全文、要不要附件、附件只收哪种格式。以前这三件事全靠猜（一律附
// docx+txt、一律声称"正文同时粘贴全文"），于是每家期刊收到的邮件都长得一样，而要求
// "只收 Word" 的期刊还会收到多余的 txt。
const PASTE_HINTS = /正文粘贴|粘贴正文|粘贴全文|贴在正文|正文中粘贴|正文栏|全文粘贴|粘在正文|正文附全文|正文即可|直接粘贴/;
const NO_ATTACH_HINTS = /不要附件|无需附件|不接受附件|不需要附件|请勿附|勿以附件|不收附件/;
const DOCX_ONLY_HINTS = /只(收|要|接受|需)?\s*word|仅(收|要|接受)?\s*word|word\s*文档|docx|不要\s*pdf|不接受\s*pdf|不要\s*txt|\.docx/i;
const ANY_FORMAT_HINTS = /pdf|txt|纯文本|不限格式|格式不限/i;

// R8 ③: 期刊还会写「附件只收一份 Word」「文件名：姓名_体裁_篇名」这类硬规则。
// 以前一律附 docx+txt、文件名固定成「题名_体裁_字数」——违反这些规则的稿子会被
// 编辑直接跳过，和没投一样。所以数量与命名也必须从征稿要求里读出来。
const COUNT_PATTERNS = [
  /(?:附件|文件)[^。；\n]{0,16}?(?:不超过|最多|至多|限|不高于|只需|只收|仅需|仅收)\s*([0-9一二两三四五六七八九十]{1,2})\s*(?:份|个|篇|部)/,
  /(?:只需|只收|仅需|仅收|单)\s*([0-9一二两三四五六七八九十]{0,2})\s*(?:份|个)?\s*附件/,
];
const NAMING_SENTENCE = /(?:文件命名|文件名|命名格式|命名方式|附件名|文件名称|命名)[^。；\n]{0,60}/;
const NAMING_TOKENS = [
  ['姓名', 'author'], ['作者', 'author'], ['笔名', 'author'],
  ['篇名', 'title'], ['题目', 'title'], ['标题', 'title'], ['作品名', 'title'],
  ['体裁', 'genre'], ['字数', 'words'], ['期刊', 'journal'], ['刊物', 'journal'],
];
const NAMING_LABELS = { author: '姓名', title: '篇名', genre: '体裁', words: '字数', journal: '刊名' };
const CN_COUNT_DIGITS = Object.freeze({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 });

/** `「最多两份附件」` / `「不超过 2 个」` → 2. `0` when nothing is stated. */
function countFromText(raw) {
  const text = str(raw).trim();
  if (!text) return 0;
  const digits = Number(text);
  if (Number.isFinite(digits) && digits > 0) return Math.min(digits, 9);
  let total = 0;
  for (const char of text) {
    if (char === '十') total = (total <= 0 ? 1 : total) * 10;
    else if (CN_COUNT_DIGITS[char]) total += CN_COUNT_DIGITS[char];
  }
  return total > 0 ? Math.min(total, 9) : 0;
}

/**
 * Filename rule a journal asks for, as an ordered token list. `null` when the
 * requirements say nothing about naming — then the neutral default is used.
 */
function attachmentNaming(text) {
  const sentence = (str(text).match(NAMING_SENTENCE) || [''])[0];
  if (!sentence) return null;
  const found = new Map();
  NAMING_TOKENS.forEach(([word, token], order) => {
    const at = sentence.indexOf(word);
    if (at < 0) return;
    const previous = found.get(token);
    if (!previous || at < previous.at) found.set(token, { token, at, order });
  });
  if (found.size === 0) return null;
  const tokens = [...found.values()]
    .sort((left, right) => left.at - right.at || left.order - right.order)
    .map((row) => row.token);
  return { tokens, sentence };
}

/** `['author','genre','title']` + 取值 → `张三_短篇小说_秋声`. */
function renderNaming(tokens, values) {
  const source = isObject(values) ? values : {};
  return (Array.isArray(tokens) ? tokens : [])
    .map((token) => str(source[token]).trim())
    .filter(Boolean)
    .join('_');
}

/**
 * Turn a journal's free-text 征稿要求 into the concrete mail shape.
 * Returns `{ pasteInBody, formats, attachmentCount, naming, reasons, requirements }`;
 * `reasons` is what the wizard shows the author so nothing about the generated mail
 * is a black box.
 */
function submissionRules(journal) {
  const record = isObject(journal) ? journal : {};
  const requirements = (Array.isArray(record.requirements) ? record.requirements : [])
    .map((row) => str(row).trim())
    .filter(Boolean);
  const text = requirements.join('\n');
  const declared = (Array.isArray(record.attachments) ? record.attachments : [])
    .map((row) => str(row).toLowerCase().replace(/^\./, ''))
    .filter((row) => row === 'docx' || row === 'txt' || row === 'pdf');

  const saysPaste = PASTE_HINTS.test(text);
  const saysNoAttach = NO_ATTACH_HINTS.test(text);
  const saysDocxOnly = !ANY_FORMAT_HINTS.test(text) && DOCX_ONLY_HINTS.test(text);

  // An explicit `attachments` list on the journal wins; otherwise Word only — the
  // universal default in Chinese literary submissions is one .docx.
  let formats;
  if (declared.length > 0) formats = declared;
  else if (saysNoAttach) formats = [];
  else formats = ['docx'];
  if (formats.length > 0 && !formats.includes('docx')) formats.push('docx');

  const reasons = [];
  if (declared.length > 0) reasons.push(`按该刊要求附 ${formats.join(' / ').toUpperCase()}`);
  else if (saysNoAttach) reasons.push('该刊写明不要附件，只发正文');
  else if (saysDocxOnly) reasons.push('该刊只收 Word，正文另附一份 .docx');
  else reasons.push('默认只附一份 .docx（中文文学期刊通行做法）');

  // Nothing attached means the body MUST carry the manuscript, otherwise the
  // editor receives an empty submission — so no-attachment implies paste.
  const pasteInBody = saysPaste || formats.length === 0;
  reasons.push(pasteInBody ? '正文粘贴小说全文' : '正文只写投稿信，小说全文在附件里');

  // The journal may cap the number of files (「只收一份 Word」). Trimming here keeps
  // every downstream step — naming, preview, send — working from one list.
  let attachmentCount = 1;
  for (const pattern of COUNT_PATTERNS) {
    const hit = text.match(pattern);
    if (!hit) continue;
    const parsed = countFromText(hit[1]);
    if (parsed > 0) {
      attachmentCount = parsed;
      break;
    }
  }
  if (formats.length > attachmentCount) formats = formats.slice(0, attachmentCount);
  if (formats.length > 1) reasons.push(`该刊允许 ${attachmentCount} 个附件，已按此数量生成`);

  const naming = attachmentNaming(text);
  if (naming) {
    const sample = renderNaming(naming.tokens, { author: '姓名', title: '篇名', genre: '体裁', words: '字数', journal: '刊名' });
    reasons.push(`附件命名按该刊要求：${sample}`);
  }

  return { pasteInBody, formats, attachmentCount, naming, reasons, requirements };
}

/** The manuscript as plain text, chapter by chapter, for pasting into a mail. */
function manuscriptText(work) {
  const source = isObject(work) ? work : {};
  const chapters = Array.isArray(source.chapters) ? source.chapters : [];
  return chapters
    .map((chapter, index) => {
      // R14 ①: never invent 「第N章」 for a chapter that has no title — that is
      // the machine trace the author complained about. An untitled chapter is
      // just body text.
      const title = str(chapter && chapter.title).trim();
      const content = str(chapter && chapter.content).replace(/\s+$/, '');
      if (!content) return title;
      return title ? `${title}\n\n${content}` : content;
    })
    .filter(Boolean)
    .join('\n\n');
}

function fallbackCoverLetter(work, journal, profile, genre, extra = {}) {
  const source = isObject(work) ? work : {};
  const pen = isObject(profile) ? profile : {};
  const record = isObject(journal) ? journal : {};
  const title = str(source.title).trim() || '未命名作品';
  const penName = str(pen.penName).trim() || str(source.author).trim();
  const genreLabel = { weixiaoshuo: '微小说', duanpian: '短篇小说', zhongpian: '中篇小说', changpian: '长篇小说' }[genre] || '小说';
  const journalName = str(record.name).trim();
  const wordCount = (Array.isArray(source.chapters) ? source.chapters : []).reduce(
    (sum, chapter) => sum + countChars(chapter && chapter.content, extra.counting),
    0,
  );
  const requirements = (Array.isArray(record.requirements) ? record.requirements : [])
    .map((row) => str(row).trim())
    .filter(Boolean);
  const attachments = (Array.isArray(extra.attachments) ? extra.attachments : [])
    .map((row) => str(row).trim())
    .filter(Boolean);
  const paperOnly = record.paperOnly === true;
  const bandLabel = str(extra.bandLabel).trim();
  const pasteInBody = extra.pasteInBody === true;
  const manuscript = pasteInBody ? str(extra.manuscript) : '';

  // renderSubject() keys off the raw genre id and `wordCount`, not the label.
  const subject = renderSubject(record, {
    genre: genre,
    title,
    wordCount,
    author: penName,
  });

  const lines = [];
  lines.push(journalName ? `${journalName}编辑部老师：` : '编辑老师：');
  lines.push('');
  lines.push(
    `您好！我是${penName || '一位作者'}，现向贵刊投递${genreLabel}《${title}》，全文约 ${wordCount} 字${bandLabel ? `（${bandLabel}）` : ''}。`,
  );
  lines.push('');
  // R11 ⑤: the letter must not recite the journal's 征稿要求 line by line.
  // The requirements are already honoured in what this mail *is* — the subject
  // format, how many files are attached and what they are called, and whether the
  // text is pasted below. Listing them again reads like a form reply, so only a
  // one-line acknowledgement survives, and only when the journal stated any.
  if (requirements.length > 0) {
    lines.push('投稿前已按贵刊征稿要求核对稿件格式与字数，如有不合之处请告知，我可随时调整。');
    lines.push('');
  }
  if (paperOnly) {
    lines.push('贵刊以纸质稿为主，本邮件先作电子版沟通，纸质稿将按征稿启事要求寄出。');
    lines.push('');
  }
  if (attachments.length > 0) {
    lines.push(
      pasteInBody
        ? `随信附上：${attachments.join('、')}。为便于编辑直接阅读，全文同时粘贴于正文之后。`
        : `随信附上：${attachments.join('、')}，敬请查收。`,
    );
  } else if (pasteInBody) {
    lines.push('全文粘贴于正文，未另附附件，敬请直接阅读。');
  }
  lines.push('');
  lines.push('稿件系本人原创、未在其它平台公开发表，且未一稿多投；若需修改或补充材料请随时与我联系。');
  lines.push('');
  lines.push('顺祝编安！');
  lines.push('');
  if (penName) lines.push(penName);
  const contact = [];
  if (str(pen.contact).trim()) contact.push(`联系方式：${str(pen.contact).trim()}`);
  if (str(pen.email).trim()) contact.push(`邮箱：${str(pen.email).trim()}`);
  if (contact.length > 0) lines.push(contact.join('　'));

  // R7 ③: journals that ask for the text to be pasted get the whole manuscript,
  // after the letter, separated by a rule so the editor can see where prose starts.
  if (manuscript) {
    lines.push('');
    lines.push('———————— 以下为稿件全文 ————————');
    lines.push('');
    lines.push(manuscript);
  }

  return { subject, body: lines.join('\n') };
}

const SUBMIT_SYSTEM_PROMPT = [
  '你是中文文学期刊的资深编辑助理，负责帮作者把稿件调整到目标期刊的投稿口味并撰写投稿邮件。',
  '你只会收到目标期刊的征稿要求、作者信息、作品标题与章节标题。',
  '请严格只输出一个 JSON 对象，字段为 subject（邮件主题，不超过 60 字）与 body（邮件正文，中文，礼貌简洁，包含称呼、稿件介绍、字数、原创声明与落款）。',
  '**不要在正文里罗列或复述期刊的征稿要求**：遵守要求体现在信的内容本身，逐条抄录会显得像模板回复。',
  '不要输出 Markdown 围栏，不要输出任何解释。',
].join('\n');

const SUBMIT_SYSTEM_PROMPT_WITH_BODY = [
  '你是中文文学期刊的资深编辑助理。作者把稿件交给你，你要做两件事：',
  '1) 按目标期刊的征稿要求微调稿件正文：可以统一章节标题编号、规范全角标点、压缩多余空行、修正明显错别字；**不得删改情节、不得增写内容、不得改写句子风格**。',
  '2) 写一封中文投稿邮件。**不要在正文里罗列或复述期刊的征稿要求**，遵守要求体现在信的内容本身。',
  '请严格只输出一个 JSON 对象：{"subject":"邮件主题（≤60字）","body":"邮件正文","chapters":[{"title":"章标题","content":"调整后的正文"}]}。',
  'chapters 必须与输入的章节一一对应、数量相同、不得为空；若无需调整就原样返回。不要输出 Markdown 围栏或任何解释。',
].join('\n');

/** Manuscripts at or below this size may be sent to the model for body polishing. */
const AI_ADJUST_MAX_CHARS = 4000;

/** Pull `{subject, body}` out of a model reply, tolerating fences and prose. */
function parseCoverLetter(reply) {
  const parsed = parseModelObject(reply);
  if (!parsed) return null;
  const subject = str(parsed.subject).trim();
  const body = str(parsed.body).trim();
  if (!subject && !body) return null;
  return { subject, body, chapters: Array.isArray(parsed.chapters) ? parsed.chapters : null };
}

/** Extract the first balanced `{...}` JSON object from a model reply. */
function parseModelObject(reply) {
  const text = String(reply || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Accept the model's chapter rewrite only when the structure still matches the
 * source: same count, non-empty, Chinese punctuation intact, and length within
 * a sane band (a "polish" must not silently become a rewrite or a truncation).
 */
function adoptModelChapters(candidate, baseline) {
  if (!Array.isArray(candidate) || !Array.isArray(baseline)) return null;
  if (candidate.length !== baseline.length) return null;
  // R14 ①: a single-chapter work has no heading to number — whatever title the
  // model invents (「一、雪夜」 is the common one) is discarded in favour of the
  // baseline, so the manuscript never grows a chapter mark the author didn't write.
  const single = baseline.length === 1;
  const out = [];
  for (let index = 0; index < baseline.length; index += 1) {
    const row = isObject(candidate[index]) ? candidate[index] : {};
    const content = str(row.content).trim();
    if (!content) return null;
    const before = countChars(baseline[index].content);
    const after = countChars(content);
    if (before > 0 && (after < before * 0.7 || after > before * 1.4)) return null;
    out.push({
      title: single ? baseline[index].title : str(row.title).trim() || baseline[index].title,
      content,
    });
  }
  return out;
}

/**
 * Fill the journal's subject template (`{genre}` / `{title}` / `{words}` /
 * `{author}` / `{journal}`). Falls back to the shared default, then to a plain
 * descriptive subject when the template renders empty.
 */
function renderSubject(journal, info = {}) {
  const source = isObject(journal) ? journal : {};
  const template = str(source.subject).trim() || journals.DEFAULT_SUBJECT;
  const genreLabel = { weixiaoshuo: '微小说', duanpian: '短篇小说', zhongpian: '中篇小说', changpian: '长篇小说' }[
    str(info.genre)
  ] || '小说';
  const values = {
    genre: genreLabel,
    title: str(info.title) || '未命名作品',
    words: String(Math.max(0, Math.trunc(Number(info.wordCount) || 0))),
    author: str(info.author) || '（未署名）',
    journal: str(source.name),
  };
  return template
    .replace(/\{(genre|title|words|author|journal)\}/g, (match, key) => values[key] || match)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Extension → MIME for the attachments a submission may carry. */
const SUBMIT_ATTACHMENT_MIME = { docx: MIME.docx, txt: MIME.txt, pdf: MIME.pdf };

/**
 * Build the files a journal asks for, as base64 rows ready for `submit.send`.
 * `formats` comes from `submissionRules()` — an empty list is legitimate (the
 * journal wants the text in the body and no attachment at all). DOCX failures
 * are skipped rather than fatal: the plain-text manuscript is always produced,
 * so a mail can still go out.
 */
async function buildSubmissionAttachments(journal, novel, genre, wordCount, formats, naming) {
  const source = isObject(journal) ? journal : {};
  const wanted = (Array.isArray(formats)
    ? formats
    : Array.isArray(source.attachments) && source.attachments.length > 0
      ? source.attachments
      : ['docx']
  ).map((ext) => str(ext).toLowerCase().replace(/^\./, '')).filter((ext) => ext === 'docx' || ext === 'txt');

  const genreLabel = { weixiaoshuo: '微小说', duanpian: '短篇小说', zhongpian: '中篇小说', changpian: '长篇小说' }[str(genre)] || '小说';
  const defaultStem = safeFilename(`${novel.title}_${genreLabel}_${wordCount}字`, 'x').replace(/\.x$/, '');
  // R8 ③: 期刊可能指定「姓名_体裁_篇名」这类文件名，认不出来时退回中性命名。
  const asked = renderNaming(naming && naming.tokens, {
    author: novel.author,
    title: novel.title,
    genre: genreLabel,
    words: `${wordCount}字`,
    journal: str(source.name),
  });
  const stem = asked ? safeFilename(asked, defaultStem) : defaultStem;
  const rows = [];
  const warnings = [];

  for (const ext of wanted) {
    try {
      if (ext === 'txt') {
        const text = buildTxt(novel, '');
        rows.push({ filename: `${stem}.txt`, mime: MIME.txt, base64: Buffer.from(text, 'utf8').toString('base64') });
        continue;
      }
      const bytes = await callDocModule('docx', 'buildDocx', {
        title: novel.title,
        author: novel.author,
        chapters: novel.chapters,
        // R10 ⑤: the attachment is read by an editor sitting in front of a
        // printed or half-scrolled Word window, so build it as a manuscript
        // (running header with title+author, roomier leading) rather than as
        // the plain export layout the writer uses for their own archive.
        options: { manuscript: true, pageBreak: true },
      });
      rows.push({ filename: `${stem}.docx`, mime: MIME.docx, base64: Buffer.from(bytes).toString('base64') });
    } catch (error) {
      warnings.push(`${ext.toUpperCase()} 附件生成失败，已跳过：${error && error.message ? error.message : error}`);
    }
  }

  return { attachments: rows, warnings };
}

/**
 * `submit.prepare {journal, genre, work, profile}` →
 * `{subject, body, formatted:{title,author,chapters}, changes, warnings, wordCount, genre, attachments}`.
 *
 * The deterministic rule pass always produces the baseline manuscript, so the
 * response is usable with no model at all. The model is then asked for the cover
 * email, and — only for manuscripts small enough to fit comfortably in one
 * request (`AI_ADJUST_MAX_CHARS`) — for a light per-journal polish of the prose,
 * which `adoptModelChapters()` rejects unless the structure is unchanged. Any
 * model failure falls back to the rule-based letter and is reported through
 * `warnings`, never as an error.
 */
/**
 * R16 ⑥: resolve the "count punctuation" preference.
 *
 * The dialog sends the switch when it knows it (so the preview matches the
 * setting the writer just flipped), otherwise the persisted setting decides.
 * Everything defaults to *including* punctuation, which is what Chinese word
 * processors report and what the setting ships with.
 */
async function countOptions(payload) {
  if (isObject(payload) && payload.countPunctuation !== undefined) {
    return { includePunctuation: payload.countPunctuation !== false };
  }
  try {
    const settings = await library.readSettings();
    return { includePunctuation: settings.countPunctuation !== false };
  } catch {
    return { includePunctuation: true };
  }
}

async function handleSubmitPrepare(ctx, payload) {
  const journalRef = isObject(payload.journal) ? payload.journal : { id: str(payload.journal) };
  const work = isObject(payload.work) ? payload.work : {};
  const profile = isObject(payload.profile) ? payload.profile : {};
  if (!Array.isArray(work.chapters) || work.chapters.length === 0) {
    throw badRequest('请先选择要投稿的稿件（work.chapters 为空）', 'submit-no-work');
  }

  // Resolve the journal against the merged directory so ids, names and aliases
  // all work, then let an inline `journal` payload override the stored entry.
  let journal = null;
  try {
    journal = await journals.find(str(journalRef.id) || str(journalRef.name));
  } catch {
    journal = null;
  }
  if (!journal) journal = journalRef;

  const counting = await countOptions(payload);
  const preliminary = formatWork(work, profile, payload.genre, counting);
  const warnings = [];

  // R6 ④: most literary journals route different lengths to different inboxes, so
  // the address is resolved against genre + word count instead of being taken raw
  // from `journal.email`.
  const resolvedEmail = journals.resolveEmail(journal, {
    genre: preliminary.genre,
    wordCount: preliminary.wordCount,
  });
  let letter = null;

  // Only short manuscripts are handed to the model for *body* polishing; a full
  // novel would blow the context and invite unintended rewrites.
  const includeBodies = preliminary.wordCount > 0 && preliminary.wordCount <= AI_ADJUST_MAX_CHARS;

  try {
    const requirements = Array.isArray(journal.requirements) ? journal.requirements.filter(Boolean) : [];
    const chapterTitles = preliminary.formatted.chapters.map((chapter) => chapter.title);
    const lines = [
      `期刊：${str(journal.name) || '未指定'}`,
      `体裁：${preliminary.genre}`,
      `字数：${preliminary.wordCount}`,
      `征稿要求：${requirements.length > 0 ? requirements.join('；') : '（未提供，按通用文学期刊规范）'}`,
      `作品标题：${preliminary.formatted.title}`,
      `作者笔名：${str(profile.penName) || str(preliminary.formatted.author) || '（未填写）'}`,
      `联系方式：${str(profile.contact) || '（未填写）'}`,
      `邮箱：${str(profile.email) || '（未填写）'}`,
    ];
    // R14 ①: a one-chapter short story has no chapter list worth naming, and
    // telling the model 「章节：」 with an empty value invites it to invent
    // headings. Only list real, multiple chapters.
    const namedTitles = chapterTitles.filter((title) => str(title).trim());
    if (preliminary.formatted.chapters.length > 1 && namedTitles.length > 0) {
      lines.push(`章节：${namedTitles.join('／')}`);
    } else {
      lines.push('篇幅：单篇（不要添加章节标题或序号，正文连续排版）');
    }
    if (includeBodies) {
      lines.push('', '以下为已按投稿规范整理的稿件事先稿，请在保持原意的前提下微调后回填 chapters：');
      lines.push(
        JSON.stringify(
          preliminary.formatted.chapters.map((chapter) => ({ title: chapter.title, content: chapter.content })),
        ),
      );
    }
    const reply = await ai.chatOnce(ctx, {
      // R29: 「AI 投稿模型」 is a separate choice in Settings, so the mail can be
      // drafted by a different model than the proofreader.
      provider: str(payload.provider) || undefined,
      model: str(payload.model) || undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }],
      system: includeBodies ? SUBMIT_SYSTEM_PROMPT_WITH_BODY : SUBMIT_SYSTEM_PROMPT,
      maxTokens: includeBodies ? 4000 : 1200,
    });
    letter = parseCoverLetter(reply);
    if (!letter) warnings.push('AI 未返回可解析的邮件内容，已按内置规则生成');
  } catch (error) {
    // Model service missing or the provider failed — the rule fallback is the
    // contract-mandated path, not an error.
    warnings.push('AI 不可用，已按内置规则排版');
  }

  const finalFormatted = { ...preliminary.formatted };
  if (letter && letter.chapters) {
    const adopted = adoptModelChapters(letter.chapters, preliminary.formatted.chapters);
    if (adopted) {
      finalFormatted.chapters = adopted;
      warnings.push('AI 已按期刊要求微调正文，请在预览中确认');
    } else {
      warnings.push('AI 返回的正文结构与原稿不一致，已改用内置规则排版结果');
    }
  }

  // R7 ③: what this journal actually asks for — full text in the body, which
  // formats as attachments, or nothing attached at all.
  const rules = submissionRules(journal);
  const pasteText = rules.pasteInBody ? manuscriptText(finalFormatted) : '';
  const structured = fallbackCoverLetter(finalFormatted, journal, profile, preliminary.genre, {
    attachments: rules.formats.map((row) => row.toUpperCase()),
    bandLabel: journals.bandLabel(journals.bandOf(preliminary.wordCount)),
    pasteInBody: rules.pasteInBody,
    manuscript: pasteText,
    // R16 ⑥: the subject template counts {words}, so it has to use the same
    // punctuation rule as the preview or the two numbers disagree.
    counting: counting,
  });

  if (!letter) {
    letter = structured;
    if (warnings.length === 0) warnings.push('AI 不可用，已按内置规则排版');
  }
  // R11 ⑤: never recite the journal's 征稿要求 back at the editor.
  // A cover letter that repeats "贵刊的征稿要求我已逐条对照：· 字数不超过一万…" reads
  // like a form reply and pushes the actual letter down the page. The requirements
  // already shaped the mail (subject, attachment count, naming, paste-in-body), so
  // obeying them is the acknowledgement — restating them adds nothing.

  // R7 ③: a journal that wants the text pasted must get the text whichever path
  // wrote the letter — the model's body never contains the manuscript.
  if (pasteText && !str(letter.body).includes(pasteText.slice(0, 120))) {
    letter = {
      ...letter,
      body: `${str(letter.body).trimEnd()}\n\n———————— 以下为稿件全文 ————————\n\n${pasteText}`,
    };
  }

  // Contract §11: the manuscript ends with the signature line and contact info.
  // It goes on the LAST chapter page so every export/paste keeps it attached.
  //
  // Counted BEFORE the tail is glued on: the tail is a signature block, not
  // manuscript. Counting it made `wordCount` disagree with the value used for
  // the genre recommendation and the subject line (a 13-character micro-fiction
  // plus a three-line signature read as 32 characters, and the subject said「13字」).
  const wordCount = finalFormatted.chapters.reduce((sum, chapter) => sum + countChars(chapter.content, counting), 0);

  const tail = str(preliminary.tail).trim();
  if (tail && finalFormatted.chapters.length > 0) {
    const lastIndex = finalFormatted.chapters.length - 1;
    const lastChapter = finalFormatted.chapters[lastIndex];
    finalFormatted.chapters[lastIndex] = {
      title: lastChapter.title,
      content: `${lastChapter.content.replace(/\s+$/, '')}\n\n${tail}`,
    };
  }

  // Attachments follow `submissionRules()` — an empty list means the journal
  // wants no attachment at all, in which case `rules.pasteInBody` carried the
  // manuscript instead. The build is best-effort: a missing DOCX engine must not
  // block a plain-text submission, so failures land in `warnings`.
  const built = await buildSubmissionAttachments(journal, finalFormatted, preliminary.genre, wordCount, rules.formats, rules.naming);
  warnings.push(...built.warnings);

  // The innocent-looking `subject` from the model may be empty or ignore the
  // journal's required format; the template render is the fallback both here and
  // in the preview step, so the two can never disagree.
  const subjectTemplate = renderSubject(journal, {
    genre: preliminary.genre,
    title: finalFormatted.title,
    wordCount,
    author: str(profile.penName) || str(finalFormatted.author),
  });

  // R6 ⑤: the journal's own template is the authority. The model is asked for a
  // subject as a hint only — a journal that spells out「体裁+篇名+字数」must get
  // exactly that, never whatever the model felt like writing.
  const subject = subjectTemplate || letter.subject;

  return {
    subject,
    subjectTemplate,
    modelSubject: letter.subject === subject ? '' : str(letter.subject),
    body: letter.body,
    formatted: finalFormatted,
    changes: preliminary.changes,
    warnings,
    wordCount,
    genre: preliminary.genre,
    band: resolvedEmail.band,
    bandLabel: resolvedEmail.bandLabel,
    category: resolvedEmail.category,
    categoryLabel: resolvedEmail.categoryLabel,
    attachments: built.attachments,
    // R7 ③: why this mail looks the way it does — the wizard shows these lines so
    // the author can see the journal's rule was followed, not guessed.
    pasteInBody: rules.pasteInBody,
    attachFormats: rules.formats,
    // R8 ③: how many files and what they must be called — both are editable in the
    // preview step, which is where the automation is meant to stop (R8 ⑥).
    attachmentCount: rules.attachmentCount,
    attachmentNaming: rules.naming ? { tokens: rules.naming.tokens.slice(), sentence: rules.naming.sentence } : null,
    ruleNotes: rules.reasons.slice(),
    journal: {
      id: str(journal.id),
      name: str(journal.name),
      email: resolvedEmail.email,
      emailNote: resolvedEmail.note,
      emailMatched: resolvedEmail.matched,
      emailConfigured: resolvedEmail.configured !== false,
      emailVariants: resolvedEmail.variants,
      website: str(journal.website),
      paperOnly: journal.paperOnly === true,
      responseDays: Number(journal.responseDays) || 60,
      attachments: rules.formats.slice(),
      requirements: Array.isArray(journal.requirements) ? journal.requirements.slice() : [],
      verified: journal.verified === true,
      note: str(journal.note),
    },
    journalId: str(journal.id),
    journalName: str(journal.name),
    journalEmail: resolvedEmail.email,
    tail,
  };
}

// ---------------------------------------------------------------------------
// Submission log (投稿记录)
// ---------------------------------------------------------------------------

const SUBMISSION_LIMIT = 50;

function submissionsPath() {
  return path.join(library.dataRoot(), 'submissions.json');
}

/** Read the submission log; a missing/corrupt file yields `[]`. */
async function readSubmissions() {
  try {
    const text = await fsp.readFile(submissionsPath(), 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((row) => isObject(row)) : [];
  } catch {
    return [];
  }
}

/**
 * Statuses a submission record may carry. `sent` is what the sender writes;
 * the rest are the author's own bookkeeping after the mail is out.
 */
const SUBMIT_STATUSES = ['sent', 'pending', 'accepted', 'rejected', 'published', 'withdrawn'];

/** Atomically replace the whole log (temp file + rename). */
async function writeSubmissions(rows) {
  const target = submissionsPath();
  const temp = `${target}.${Date.now().toString(36)}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const trimmed = (Array.isArray(rows) ? rows : []).slice(0, SUBMISSION_LIMIT);
  try {
    await fsp.writeFile(temp, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
    await fsp.rename(temp, target);
  } catch (error) {
    try {
      await fsp.rm(temp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
  return trimmed;
}

async function appendSubmission(record) {
  const rows = await readSubmissions();
  rows.unshift(record);
  return writeSubmissions(rows);
}

/** `submit.record {}` → `{records:[…]}` (newest first, capped at 50). */
async function handleSubmitRecord() {
  const rows = await readSubmissions();
  const now = Date.now();
  return {
    records: rows.slice(0, SUBMISSION_LIMIT).map((row) => ({
      ...row,
      // Derived for the manager dialog: 「投稿 12 天」 and how long it has left
      // before the journal's typical reply window runs out.
      daysAgo: Number.isFinite(Number(row.at)) ? Math.max(0, Math.floor((now - Number(row.at)) / 86_400_000)) : 0,
    })),
  };
}

/**
 * `submit.update {id, status?, note?}` → `{record, records}`.
 * Used by the 投稿管理 dialog to mark a submission as accepted / rejected / …
 */
async function handleSubmitUpdate(payload) {
  const id = str(payload.id).trim();
  if (!id) throw badRequest('缺少投稿记录 id（id）', 'submit-invalid');

  const status = str(payload.status).trim();
  if (status && !SUBMIT_STATUSES.includes(status)) {
    throw badRequest(`未知的投稿状态: ${status}`, 'submit-invalid');
  }

  const rows = await readSubmissions();
  const index = rows.findIndex((row) => str(row.id) === id);
  if (index < 0) throw new RouteError('submit-not-found', `找不到投稿记录：${id}`);

  const next = { ...rows[index] };
  if (status) next.status = status;
  if (payload.note !== undefined) next.note = str(payload.note).slice(0, 500);
  next.updatedAt = Date.now();
  rows[index] = next;

  try {
    await writeSubmissions(rows);
  } catch (error) {
    throw new RouteError('submit-write-failed', `保存投稿记录失败：${error && error.message ? error.message : error}`);
  }

  return { record: next, records: rows.slice(0, SUBMISSION_LIMIT) };
}

/**
 * `submit.send {to, subject, body, attachments, journalId}` → `{ok, messageId, ...}`.
 * Unconfigured SMTP is a structured `smtp-not-configured`, never a thrown error.
 */
async function handleSubmitSend(payload) {
  const to = str(payload.to).trim();
  if (!to) throw badRequest('缺少收件人地址（to）', 'submit-invalid');

  const cfg = await smtpConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      code: 'smtp-not-configured',
      message: '未配置投稿邮箱，请先在设置·投稿里填写 SMTP 服务器',
    };
  }

  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments
        .filter((row) => isObject(row) && str(row.base64))
        .map((row) => ({
          filename: str(row.filename) || '投稿作品.txt',
          mime: str(row.mime) || 'application/octet-stream',
          base64: str(row.base64),
        }))
    : [];

  const subject = str(payload.subject).trim() || '投稿';
  const body = str(payload.body);

  const result = await smtp.send({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass: cfg.pass,
    from: cfg.from || cfg.user,
    to,
    subject,
    text: body,
    attachments,
  });

  if (!result || result.ok !== true) {
    const failure = result || {};
    return {
      ok: false,
      code: str(failure.code) || 'smtp-send-failed',
      message: str(failure.message) || '邮件发送失败',
    };
  }

  const journalId = str(payload.journalId);
  let journalName = '';
  try {
    const journal = await journals.find(journalId);
    journalName = journal ? str(journal.name) : '';
  } catch {
    journalName = '';
  }

  const record = {
    id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    journalId,
    journalName,
    // The manager dialog lists 小说名 first, so it has to be persisted here —
    // looking it up from the library later would break once the novel is renamed.
    title: str(payload.title).slice(0, 120),
    genre: str(payload.genre),
    wordCount: Math.max(0, Math.trunc(Number(payload.wordCount) || 0)),
    at: Date.now(),
    to,
    subject,
    status: 'sent',
    messageId: str(result.messageId),
    attachments: attachments.map((row) => row.filename),
  };
  try {
    await appendSubmission(record);
  } catch (error) {
    // The mail is already out; losing the local log must not fail the request.
    console.warn(`[novel-writer] 写入投稿记录失败: ${error && error.message ? error.message : error}`);
  }

  return {
    ok: true,
    messageId: str(result.messageId),
    accepted: Array.isArray(result.accepted) ? result.accepted : [to],
    record,
  };
}

/** Upper bound for an attachment we are willing to parse just for a preview. */
const ATTACHMENT_PREVIEW_MAX_BYTES = 12 * 1024 * 1024;
/** Characters of attachment text sent to the preview pane (rest is truncated). */
const ATTACHMENT_PREVIEW_MAX_CHARS = 120000;

/**
 * `submit.attachment {name, base64}` → `{name, format, text, chars, truncated, chapters}`.
 *
 * The ③ 邮件预览 step claims to show what is about to be mailed; a filename alone
 * is not that. `docx` carries no plain text in the wire format, so the attachment
 * is parsed with the very same importer used for uploaded manuscripts and the
 * result is rendered as readable text.
 */
async function handleSubmitAttachment(payload) {
  const name = str(payload.name).trim() || 'attachment';
  const base64 = str(payload.base64);
  if (!base64) throw badRequest('缺少附件内容（base64）', 'submit-invalid');

  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('附件内容不是合法的 base64', 'submit-invalid');
  }
  if (bytes.length === 0) throw badRequest('附件内容为空', 'submit-invalid');
  if (bytes.length > ATTACHMENT_PREVIEW_MAX_BYTES) {
    throw new RouteError(
      'submit-attachment-too-large',
      `附件超过 ${Math.round(ATTACHMENT_PREVIEW_MAX_BYTES / 1024 / 1024)} MB，无法在预览中打开`,
    );
  }

  const format = (name.split('.').pop() || '').toLowerCase();
  let chapters = [];
  try {
    const parsed = await callDocModule('importParse', 'parseImport', { name, bytes });
    const novel = normalizeNovel(parsed);
    chapters = novel.chapters;
  } catch (error) {
    throw new RouteError(
      'submit-attachment-unreadable',
      `无法读取该附件：${error && error.message ? error.message : error}`,
    );
  }

  const joined = chapters
    .map((chapter) => {
      const title = str(chapter.title).trim();
      const content = str(chapter.content);
      return title ? `${title}\n${content}` : content;
    })
    .join('\n\n')
    .trim();
  const text = joined.length > ATTACHMENT_PREVIEW_MAX_CHARS ? joined.slice(0, ATTACHMENT_PREVIEW_MAX_CHARS) : joined;

  return {
    name,
    format,
    text,
    chars: joined.length,
    truncated: joined.length > text.length,
    chapters: chapters.length,
  };
}

async function handleSelfTest(ctx, services) {
  const results = [];

  // Prefer the live registration flag: `ctx.get('webServer')` only tells us the
  // carrier exists *now*, not that this plugin's prefix route actually landed on
  // it. The flag is set by registerRoutes() and cleared by its disposer.
  const live = services && services.state ? services.state : null;
  let webServer;
  try {
    webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  } catch {
    webServer = undefined;
  }
  const registered = live ? Boolean(live.registered) : Boolean(webServer);
  results.push({
    name: 'webServer',
    ok: Boolean(webServer) && registered,
    detail: registered
      ? 'HTTP 路由已注册（/novel-writer/api）'
      : 'HTTP 路由未注册（浏览器侧会收到 404/405）',
  });

  // DOCX round trip: build, then unzip and look for word/document.xml.
  try {
    const novel = {
      title: '自检样章',
      author: '自检',
      chapters: [{ title: '第一章 测试', content: '　　这是一段用于自检的正文。\n　　第二段内容。' }],
    };
    const bytes = Buffer.from(await callDocModule('docx', 'buildDocx', { ...novel, options: {} }));
    const unzip = await loadDocModule('zip');
    const entries = unzip && typeof unzip.unzipSync === 'function' ? unzip.unzipSync(bytes) : null;
    const documentXml = entries && typeof entries.get === 'function' ? entries.get('word/document.xml') : null;
    if (bytes.length > 0 && documentXml && documentXml.length > 0) {
      results.push({ name: 'docx', ok: true, detail: `构建 ${bytes.length} 字节，unzip 得到 word/document.xml（${documentXml.length} 字节）` });
    } else {
      results.push({ name: 'docx', ok: false, detail: 'docx 构建成功但缺少 word/document.xml' });
    }
  } catch (error) {
    results.push({ name: 'docx', ok: false, detail: `docx 构建失败: ${error && error.message ? error.message : error}` });
  }

  // EPUB round trip: build, then check the ZIP carries mimetype + a container.
  try {
    const bytes = Buffer.from(
      await callDocModule('epub', 'buildEpub', {
        title: '自检样章',
        author: '自检',
        language: 'zh-CN',
        chapters: [{ title: '第一章 测试', content: '　　这是一段用于自检的正文。' }],
        options: {},
      }),
    );
    const unzip = await loadDocModule('zip');
    const entries = unzip && typeof unzip.unzipSync === 'function' ? unzip.unzipSync(bytes) : null;
    const hasMimetype = Boolean(entries && typeof entries.get === 'function' && entries.get('mimetype'));
    const hasContainer = Boolean(entries && typeof entries.get === 'function' && entries.get('META-INF/container.xml'));
    results.push({
      name: 'epub',
      ok: bytes.length > 0 && hasMimetype && hasContainer,
      detail: bytes.length > 0 && hasMimetype && hasContainer
        ? `构建 ${bytes.length} 字节，mimetype 与 container.xml 就位`
        : 'epub 结构不完整（缺少 mimetype 或 container.xml）',
    });
  } catch (error) {
    results.push({ name: 'epub', ok: false, detail: `epub 构建失败: ${error && error.message ? error.message : error}` });
  }

  // secrets round trip (does not touch the live store).
  const secretProbe = await secrets.probeSecrets();
  results.push({ name: 'secrets', ok: Boolean(secretProbe.ok), detail: str(secretProbe.detail) });

  // model catalogue reachability.
  const modelProbe = await ai.probeModels(ctx);
  results.push({ name: 'ai', ok: Boolean(modelProbe.ok), detail: str(modelProbe.detail) });

  // journal directory reachable (built-ins + settings overrides, no network).
  try {
    const listed = await journals.list();
    const count = listed && Array.isArray(listed.journals) ? listed.journals.length : 0;
    results.push({
      name: 'journals',
      ok: count > 0,
      detail: count > 0 ? `期刊库 ${count} 家（内置 ${journals.builtinCount()} 家）` : '期刊库为空，请检查设置文件',
    });
  } catch (error) {
    results.push({ name: 'journals', ok: false, detail: `期刊库读取失败: ${error && error.message ? error.message : error}` });
  }

  // SMTP configuration state (offline — never opens a connection here).
  try {
    const cfg = await smtpConfig();
    results.push({
      name: 'smtp',
      ok: true,
      detail: cfg.configured
        ? `已配置 ${cfg.host}:${cfg.port}${cfg.secure ? '（SSL）' : '（STARTTLS）'}${cfg.hasPassword ? '，密码已加密保存' : '，未保存密码'}`
        : '未配置投稿邮箱（不影响其它功能）',
    });
  } catch (error) {
    results.push({ name: 'smtp', ok: false, detail: `SMTP 配置读取失败: ${error && error.message ? error.message : error}` });
  }

  if (isObject(services) && isObject(services.options) && services.options.dataDir) {
    results.push({ name: 'dataDir', ok: true, detail: String(services.options.dataDir) });
  }

  return { results };
}

/** Dispatch one method. Throws RouteError (mapped to `{ok:false}`) on failure. */
export async function dispatch(ctx, services, method, payload) {
  switch (method) {
    case 'ping':
      return await handlePing(ctx);
    case 'models':
      return handleModels(ctx);
    case 'proofread':
      return handleProofread(ctx, payload);
    case 'revise':
      return handleRevise(ctx, payload);
    case 'import.parse':
      return handleImportParse(payload);
    case 'export.build':
      return handleExportBuild(ctx, payload);
    case 'library.get':
      return handleLibraryGet();
    case 'library.set':
      return handleLibrarySet(payload);
    case 'library.pick':
      return handleLibraryPick();
    case 'library.restore':
      return handleLibraryRestore(payload);
    case 'library.mirror':
      return handleLibraryMirror(payload);
    case 'library.list':
      return handleLibraryList(payload);
    case 'library.decryptTo':
      return handleLibraryDecryptTo(payload);
    case 'journals.list':
      return handleJournalsList();
    case 'journals.save':
      return handleJournalsSave(payload);
    case 'journals.remove':
    case 'journals.delete':
      return handleJournalsRemove(payload);
    case 'journals.recommend':
      return handleJournalsRecommend(ctx, payload);
    case 'journals.email':
      return handleJournalEmail(payload);
    case 'journals.importEmails':
    case 'journals.import-emails':
      return handleJournalsImportEmails(payload);
    case 'smtp.status':
      return handleSmtpStatus();
    case 'smtp.configure':
      return handleSmtpConfigure(payload);
    case 'smtp.presets':
      return handleSmtpPresets();
    case 'smtp.test':
      return handleSmtpTest();
    case 'imap.status':
      return handleImapStatus();
    case 'imap.configure':
      return handleImapConfigure(payload);
    case 'imap.presets':
      return handleImapPresets();
    case 'imap.test':
      return handleImapTest();
    case 'inbox.list':
      return handleInboxList(payload);
    case 'inbox.refresh':
      return handleInboxList(payload);
    case 'inbox.read':
      return handleInboxRead(payload);
    case 'inbox.delete':
      return handleInboxDelete(payload);
    case 'submit.prepare':
      return handleSubmitPrepare(ctx, payload);
    case 'submit.send':
      return handleSubmitSend(payload);
    case 'submit.record':
      return handleSubmitRecord();
    case 'submit.recommend':
      return handleJournalsRecommend(ctx, payload);
    case 'submit.update':
      return handleSubmitUpdate(payload);
    case 'submit.attachment':
      return handleSubmitAttachment(payload);
    case 'selftest':
      return handleSelfTest(ctx, services);
    default:
      throw new RouteError('unknown-method', `未知的接口方法: ${method || '(空)'}`);
  }
}

/**
 * Build the HTTP handler bound to a context. Exported for tests.
 */
export function createHandler(ctx, services = {}) {
  const safeCtx = ctx && typeof ctx.get === 'function' ? ctx : { get: () => undefined };

  return async function handler(req, res) {
    const method = methodFromPath(req && req.url);
    const verb = String((req && req.method) || 'GET').toUpperCase();

    try {
      if (!method || method === 'ping') {
        sendJson(res, { ok: true, data: await handlePing(safeCtx) });
        return;
      }
      if (verb === 'GET' || verb === 'HEAD') {
        throw new RouteError('method-not-allowed', `接口 ${method} 只接受 POST`);
      }
      const body = await readBody(req);
      const payload = parseJsonBody(body);
      const data = await dispatch(safeCtx, services, method, payload);
      sendJson(res, { ok: true, data: data === undefined ? {} : data });
    } catch (error) {
      if (!(error instanceof RouteError)) {
        console.error(`[novel-writer] ${method || '(空)'} 处理失败:`, error);
      }
      sendJson(res, errorEnvelope(error));
    }
  };
}

/**
 * Register the HTTP routes.
 * Returns a no-op disposer when no web server is mounted.
 */
export function registerRoutes(ctx, services = {}) {
  const get = ctx && typeof ctx.get === 'function' ? ctx.get.bind(ctx) : () => undefined;
  const live = services && services.state ? services.state : { registered: false, error: null };
  if (live.registered === undefined) live.registered = false;
  if (live.error === undefined) live.error = null;

  let webServer;
  try {
    // `ctx.inject(['webServer'])` hands us a context that has the service as a
    // property; the service is also reachable through get(). Try both so the same
    // module works from a plain context (tests) and from an injected one.
    webServer = (ctx && ctx.webServer) || get('webServer');
  } catch (error) {
    console.warn('[novel-writer] 读取 webServer 失败:', error && error.message ? error.message : error);
    webServer = undefined;
  }

  if (!webServer || typeof webServer.register !== 'function') {
    live.registered = false;
    live.error = 'webServer 不可用';
    console.warn('[novel-writer] webServer 不可用，HTTP 路由未注册');
    return () => {};
  }

  const handler = createHandler(ctx, services);
  let dispose;
  try {
    dispose = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
  } catch (error) {
    live.registered = false;
    live.error = error && error.message ? error.message : String(error);
    console.error('[novel-writer] 注册 HTTP 路由失败:', error && error.message ? error.message : error);
    return () => {};
  }

  live.registered = true;
  live.error = null;
  live.origin = originOf(webServer);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    live.registered = false;
    try {
      if (typeof dispose === 'function') dispose();
    } catch (error) {
      console.error('[novel-writer] 注销 HTTP 路由失败:', error && error.message ? error.message : error);
    }
  };
}

function originOf(webServer) {
  try {
    return typeof webServer.getOrigin === 'function' ? String(webServer.getOrigin()) : undefined;
  } catch {
    return undefined;
  }
}
