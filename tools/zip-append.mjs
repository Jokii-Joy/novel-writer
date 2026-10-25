#!/usr/bin/env node
/*
 * zip-append.mjs — add entries to an existing zip without repacking it.
 *
 * Why this exists instead of "unzip everything and zip again": `aapt2 link`
 * writes an APK whose resource table and AndroidManifest order matter to the
 * platform's cache, and rebuilding it would also throw away the alignment aapt2
 * already applied. Appending is both cheaper and safer — the new central
 * directory simply lists the old entries verbatim plus the new ones.
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function findEocd(buf) {
  const max = Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= buf.length - max; i -= 1) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('not a zip: end-of-central-directory record not found');
}

export const ZipArchive = {
  /**
   * Appends each file in `fileNames` (read from `sourceDir`) to `zipPath`.
   * Entries are STORED, not deflated: .dex files are already compact and storing
   * keeps the in-archive offset equal to the file offset, which is one less thing
   * an APK verifier can disagree with.
   */
  async append(zipPath, sourceDir, fileNames) {
    const original = await fsp.readFile(zipPath);
    const eocd = findEocd(original);
    const entryCount = original.readUInt16LE(eocd + 10);
    const centralSize = original.readUInt32LE(eocd + 12);
    const centralOffset = original.readUInt32LE(eocd + 16);

    const centralParts = [original.subarray(centralOffset, centralOffset + centralSize)];
    const body = [original.subarray(0, centralOffset)];
    let offset = centralOffset;
    let count = entryCount;

    for (const name of fileNames) {
      const data = await fsp.readFile(path.join(sourceDir, name));
      const nameBytes = Buffer.from(name, 'utf8');
      const crc = crc32(data);
      const size = data.length;

      const local = Buffer.alloc(30 + nameBytes.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(0, 10); // time
      local.writeUInt16LE(0x21, 12); // date: 1980-01-01, deterministic
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(0, 28);
      nameBytes.copy(local, 30);

      body.push(local, data);

      const cen = Buffer.alloc(46 + nameBytes.length);
      cen.writeUInt32LE(SIG_CEN, 0);
      cen.writeUInt16LE(20, 4); // version made by
      cen.writeUInt16LE(20, 6); // version needed
      cen.writeUInt16LE(0x0800, 8);
      cen.writeUInt16LE(0, 10);
      cen.writeUInt16LE(0, 12);
      cen.writeUInt16LE(0x21, 14);
      cen.writeUInt32LE(crc, 16);
      cen.writeUInt32LE(size, 20);
      cen.writeUInt32LE(size, 24);
      cen.writeUInt16LE(nameBytes.length, 28);
      cen.writeUInt16LE(0, 30); // extra
      cen.writeUInt16LE(0, 32); // comment
      cen.writeUInt16LE(0, 34); // disk
      cen.writeUInt16LE(0, 36); // internal attrs
      cen.writeUInt32LE(0, 38); // external attrs
      cen.writeUInt32LE(offset, 42);
      nameBytes.copy(cen, 46);
      centralParts.push(cen);

      offset += local.length + data.length;
      count += 1;
    }

    const central = Buffer.concat(centralParts);
    const eocdOut = Buffer.alloc(22);
    eocdOut.writeUInt32LE(SIG_EOCD, 0);
    eocdOut.writeUInt16LE(0, 4);
    eocdOut.writeUInt16LE(0, 6);
    eocdOut.writeUInt16LE(count, 8);
    eocdOut.writeUInt16LE(count, 10);
    eocdOut.writeUInt32LE(central.length, 12);
    eocdOut.writeUInt32LE(offset, 16);

    const out = Buffer.concat([...body, central, eocdOut]);
    await fsp.writeFile(zipPath, out);
    return { entries: count, size: out.length };
  },
};

export default ZipArchive;
