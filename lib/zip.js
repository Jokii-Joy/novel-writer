/**
 * Minimal ZIP writer / reader for the Novel Studio host half.
 *
 * Only Node builtins are used (`node:zlib` for raw deflate). Implements just
 * enough of the ZIP format for OOXML (`.docx`) and EPUB packages:
 *   - local file headers with known sizes (no data descriptor on write)
 *   - central directory + EOCD
 *   - method 0 (stored) and method 8 (deflate)
 *   - UTF-8 file names (general purpose bit 11)
 *   - reading entries whose local header sizes are zero because a data
 *     descriptor was used (sizes come from the central directory)
 *
 * No zip64 writing, no encryption, no multi-disk archives.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const MAX_ENTRIES = 0xfffe;

/* ------------------------------------------------------------------ */
/* CRC32                                                               */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3) of a byte buffer. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError('期望 Buffer / Uint8Array / string');
}

function entryNameBytes(name) {
  return Buffer.from(String(name).replace(/\\/g, '/'), 'utf8');
}

/** DOS date/time for a JS Date (clamped to the 1980..2107 range). */
function dosDateTime(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  let year = d.getFullYear();
  if (year < 1980) year = 1980;
  if (year > 2107) year = 2107;
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = ((year - 1980) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Build a ZIP archive in memory.
 *
 * @param {Record<string, string|Uint8Array|ArrayBuffer>} files
 *   Entry name -> content. Strings are written as UTF-8.
 * @param {{store?: string[], date?: Date}} [opts]
 *   `store` lists entry names that must not be compressed (EPUB `mimetype`).
 * @returns {Buffer}
 */
export function zipSync(files, opts = {}) {
  if (!files || typeof files !== 'object') throw new TypeError('files 必须是对象');
  const storeSet = new Set(Array.isArray(opts?.store) ? opts.store.map((n) => String(n).replace(/\\/g, '/')) : []);
  const { time: dosTime, date: dosDate } = dosDateTime(opts?.date);

  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES) throw new Error(`ZIP 条目过多（最多 ${MAX_ENTRIES}）`);

  // `opts.store` doubles as a priority order: those entries are written first,
  // in the order given. EPUB requires `mimetype` to be the very first entry.
  const ordered = [];
  for (const name of names) {
    if (storeSet.has(String(name).replace(/\\/g, '/'))) ordered.push(name);
  }
  for (const name of names) {
    if (!ordered.includes(name)) ordered.push(name);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const rawName of ordered) {
    const nameBytes = entryNameBytes(rawName);
    const raw = toBuffer(files[rawName]);
    const crc = crc32(raw);

    let method = METHOD_DEFLATE;
    let payload = null;
    if (storeSet.has(String(rawName).replace(/\\/g, '/')) || raw.length === 0) {
      method = METHOD_STORE;
      payload = raw;
    } else {
      payload = deflateRawSync(raw, { level: 9 });
      // Deflate of incompressible data can be larger; storing is always valid.
      if (payload.length >= raw.length) {
        method = METHOD_STORE;
        payload = raw;
      }
    }

    if (raw.length > UINT32_MAX || payload.length > UINT32_MAX) throw new Error('ZIP 不支持超过 4GB 的条目');
    if (offset > UINT32_MAX) throw new Error('ZIP 不支持 zip64 偏移');

    const flags = FLAG_UTF8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(0x0314, 4); // version made by: unix / 2.0
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0x81a40000, 38); // external attributes: -rw-r--r-- (0o100644 << 16)
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // central directory disk
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - UINT16_MAX);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8) return bytes.toString('utf8');
  // Legacy archives may store GBK bytes without the UTF-8 flag.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return bytes.toString('latin1');
    }
  }
}

/** Read the zip64 extended information extra field (id 0x0001). */
function readZip64Extra(extra, want) {
  const out = {};
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    const body = extra.subarray(p + 4, p + 4 + size);
    if (id === 0x0001) {
      let q = 0;
      for (const key of want) {
        if (key === 'disk' && q + 4 > body.length) continue;
        if (q + 8 > body.length) break;
        out[key] = Number(body.readBigUInt64LE(q));
        q += 8;
      }
    }
    p += 4 + size;
  }
  return out;
}

function readZip64Eocd(buf, eocdOffset) {
  const locator = eocdOffset - 20;
  if (locator < 0 || buf.readUInt32LE(locator) !== SIG_ZIP64_LOCATOR) return null;
  const record = Number(buf.readBigUInt64LE(locator + 8));
  if (!Number.isSafeInteger(record) || record < 0 || record + 56 > buf.length) return null;
  if (buf.readUInt32LE(record) !== SIG_ZIP64_EOCD) return null;
  return {
    total: Number(buf.readBigUInt64LE(record + 32)),
    cdSize: Number(buf.readBigUInt64LE(record + 40)),
    cdOffset: Number(buf.readBigUInt64LE(record + 48)),
  };
}

/**
 * Parse a ZIP archive.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {Map<string, Buffer>} entry name -> uncompressed bytes
 */
export function unzipSync(input) {
  const buf = toBuffer(input);
  if (buf.length < 22) throw new Error('不是有效的 ZIP 文件（长度不足）');

  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到 EOCD）');

  let total = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  if (total === UINT16_MAX || cdSize === UINT32_MAX || cdOffset === UINT32_MAX) {
    const zip64 = readZip64Eocd(buf, eocd);
    if (zip64) {
      total = zip64.total;
      cdSize = zip64.cdSize;
      cdOffset = zip64.cdOffset;
    } else {
      throw new Error('ZIP64 归档不受支持');
    }
  }

  if (cdOffset + cdSize > buf.length) throw new Error('ZIP 中央目录越界');

  const result = new Map();
  let p = cdOffset;

  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length) throw new Error('ZIP 中央目录损坏');
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('ZIP 中央目录签名不匹配');

    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);

    const nameStart = p + 46;
    const nameBytes = buf.subarray(nameStart, nameStart + nameLen);
    const extra = buf.subarray(nameStart + nameLen, nameStart + nameLen + extraLen);

    if (csize === UINT32_MAX || usize === UINT32_MAX || localOffset === UINT32_MAX) {
      const want = [];
      if (usize === UINT32_MAX) want.push('usize');
      if (csize === UINT32_MAX) want.push('csize');
      if (localOffset === UINT32_MAX) want.push('localOffset');
      // zip64 extra lists values in the fixed order usize, csize, localOffset, disk
      const z64 = readZip64ExtraOrdered(extra, ['usize', 'csize', 'localOffset', 'disk']);
      if (z64.usize !== undefined) usize = z64.usize;
      if (z64.csize !== undefined) csize = z64.csize;
      if (z64.localOffset !== undefined) localOffset = z64.localOffset;
      void want;
    }

    const name = decodeName(nameBytes, flags);

    if (localOffset + 30 > buf.length) throw new Error(`ZIP 条目 "${name}" 本地头越界`);
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error(`ZIP 条目 "${name}" 本地头签名不匹配`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + csize > buf.length) throw new Error(`ZIP 条目 "${name}" 数据越界`);

    const isDirectory = name.endsWith('/') || name.endsWith('\\');
    if (!isDirectory) {
      const raw = buf.subarray(dataStart, dataStart + csize);
      let data;
      if (method === METHOD_STORE) {
        data = Buffer.from(raw);
      } else if (method === METHOD_DEFLATE) {
        try {
          data = inflateRawSync(raw);
        } catch (cause) {
          throw new Error(`ZIP 条目 "${name}" 解压失败`, { cause });
        }
      } else {
        throw new Error(`ZIP 条目 "${name}" 使用了不支持的压缩方法 ${method}`);
      }
      if (data.length !== usize) {
        throw new Error(`ZIP 条目 "${name}" 解压后大小不匹配（期望 ${usize}，实际 ${data.length}）`);
      }
      result.set(name, data);
    }

    p = nameStart + nameLen + extraLen + commentLen;
  }

  return result;
}

/** Read zip64 extra values in the format's fixed field order. */
function readZip64ExtraOrdered(extra, order) {
  const out = {};
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      const body = extra.subarray(p + 4, p + 4 + size);
      let q = 0;
      for (const key of order) {
        if (q + 8 > body.length) break;
        out[key] = Number(body.readBigUInt64LE(q));
        q += 8;
      }
      break;
    }
    p += 4 + size;
  }
  return out;
}
