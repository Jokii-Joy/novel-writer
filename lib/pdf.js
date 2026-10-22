/**
 * DOCX → PDF conversion for the Novel Studio host half.
 *
 * Strategy, in order:
 *   1. Ask the host service registry for `officeToPdf` and call its
 *      `convert(request)` contract (deferred bounded source read).
 *   2. Fall back to a direct dynamic import of the bundled
 *      `@deepseek-ai/libreoffice-kit` that ships with DeepSeek Harness
 *      (unpacked from app.asar), driving it in a scratch directory.
 *   3. Give up with `Error('PDF 引擎不可用')`.
 *
 * No npm dependencies are added: the LibreOffice kit is only ever loaded from
 * the already-installed Harness distribution, and it resolves its own deps.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENGINE_UNAVAILABLE = 'PDF 引擎不可用';

/* ------------------------------------------------------------------ */
/* 1. host officeToPdf service                                         */
/* ------------------------------------------------------------------ */

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

/**
 * Convert through the host `officeToPdf` service.
 * @returns {Promise<Buffer|null>} null when the service is absent or unusable.
 */
async function convertViaService(ctx, docxBytes) {
  if (!ctx || typeof ctx.get !== 'function') return null;

  let service;
  try {
    service = ctx.get('officeToPdf');
    if (service && typeof service.then === 'function') service = await service;
  } catch {
    return null;
  }
  if (!service || typeof service.convert !== 'function') return null;

  const bytes = toBuffer(docxBytes);
  if (!bytes) throw new TypeError('docxToPdf 需要 Buffer 或 Uint8Array');

  const request = {
    extension: 'docx',
    priority: 'foreground',
    source: {
      key: `novel-${randomUUID()}`,
      version: '1',
      bytes: bytes.length,
      read: async (_signal, _maxBytes) => ({ bytes: new Uint8Array(bytes), version: '1' }),
    },
  };

  const result = await service.convert(request);
  if (!result) return null;

  // `convert` returns { pdf: Uint8Array, ... }; the Remote render face returns
  // { data: Uint8Array, eof, ... }. Accept either so both shapes work.
  const pdf = toBuffer(result.pdf) || toBuffer(result.data) || toBuffer(result);
  if (!pdf || pdf.length === 0) return null;
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('officeToPdf 返回的不是 PDF 数据');
  }
  return pdf;
}

/* ------------------------------------------------------------------ */
/* 2. bundled LibreOffice kit                                          */
/* ------------------------------------------------------------------ */

/** Candidate roots that may hold `app.asar.unpacked/dsh/node_modules`. */
function resourcesRoots() {
  const roots = [];
  const push = (value) => {
    if (typeof value === 'string' && value && !roots.includes(value)) roots.push(value);
  };
  try {
    push(process.resourcesPath);
  } catch {
    /* not defined outside Electron */
  }
  if (typeof process.execPath === 'string' && process.execPath) {
    const execDir = process.execPath.replace(/[\\/][^\\/]+$/, '');
    push(`${execDir}\\resources`);
    push(`${execDir}/resources`);
  }
  push('C:\\Users\\17737\\AppData\\Local\\Programs\\DeepSeek Harness\\resources');
  if (typeof process.env?.DSH_RESOURCES === 'string') push(process.env.DSH_RESOURCES);
  return roots;
}

function libreofficeModuleCandidates() {
  const suffix = ['app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js'];
  const out = [];
  for (const root of resourcesRoots()) {
    for (const sep of ['\\', '/']) {
      out.push([root.replace(/[\\/]+$/, ''), ...suffix].join(sep));
    }
  }
  return out;
}

let kitPromise = null;

/** Dynamically import the bundled kit once; null when it is not installed. */
function loadLibreofficeKit() {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    for (const candidate of libreofficeModuleCandidates()) {
      try {
        const mod = await import(pathToFileURL(candidate).href);
        if (mod && typeof mod.createConverter === 'function') return mod;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  })();
  return kitPromise;
}

/**
 * Convert through the bundled LibreOffice kit.
 * @returns {Promise<Buffer|null>} null when the kit is unavailable.
 */
async function convertViaLibreofficeKit(docxBytes) {
  const kit = await loadLibreofficeKit();
  if (!kit) return null;

  const bytes = toBuffer(docxBytes);
  const directory = await mkdtemp(join(tmpdir(), 'novel-writer-pdf-'));
  let converter = null;
  try {
    const inputPath = join(directory, 'novel.docx');
    const outputPath = join(directory, 'novel.pdf');
    await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600 });

    converter = await kit.createConverter({ timeoutMs: 120000 });
    // `render` is the PDF-compatibility entry; `convert` with a .pdf output
    // is equivalent and works on every backend, so try render first.
    if (typeof converter.render === 'function') {
      await converter.render({ inputPath, outputPath });
    } else {
      await converter.convert({ inputPath, outputPath });
    }

    const pdf = await readFile(outputPath);
    if (!pdf || pdf.length === 0) return null;
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
    return pdf;
  } finally {
    try {
      if (converter && typeof converter.dispose === 'function') await converter.dispose();
    } catch {
      /* disposal is best effort */
    }
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Whether the bundled LibreOffice kit can be imported (diagnostics only). */
export async function pdfEngineAvailable() {
  const kit = await loadLibreofficeKit().catch(() => null);
  return Boolean(kit);
}

/**
 * Convert DOCX bytes to PDF bytes.
 *
 * @param {object|undefined} ctx Host context exposing `get(name)`.
 * @param {Buffer|Uint8Array} docxBytes
 * @returns {Promise<Buffer>}
 * @throws {Error} `PDF 引擎不可用` when neither backend can run.
 */
export async function docxToPdf(ctx, docxBytes) {
  const bytes = toBuffer(docxBytes);
  if (!bytes || bytes.length === 0) throw new TypeError('docxToPdf 需要非空的 Buffer 或 Uint8Array');

  let serviceFailure = null;
  try {
    const viaService = await convertViaService(ctx, bytes);
    if (viaService) return viaService;
  } catch (cause) {
    serviceFailure = cause;
  }

  try {
    const viaKit = await convertViaLibreofficeKit(bytes);
    if (viaKit) return viaKit;
  } catch (cause) {
    serviceFailure = serviceFailure ?? cause;
  }

  const error = new Error(ENGINE_UNAVAILABLE);
  if (serviceFailure) error.cause = serviceFailure;
  throw error;
}
