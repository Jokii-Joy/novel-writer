#!/usr/bin/env node
/**
 * Round-trip verification for the Novel Studio host document engine.
 *
 *   node scripts/verify-docs.mjs [--keep]
 *
 * Covers:
 *   1. zipSync → unzipSync round-trip (deflate + store, binary + UTF-8 names)
 *   2. buildDocx → parseDocx: chapter titles and paragraphs match
 *   3. buildEpub → parseEpub: chapter count and titles match
 *   4. parseImport for .txt / .md / .docx / .epub, incl. GB18030 fallback
 *   5. docxToPdf through the bundled LibreOffice kit (best effort)
 *
 * Artifacts go to scripts/.tmp/ and are removed unless --keep is passed.
 */

import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { zipSync, unzipSync } from '../lib/zip.js';
import { buildDocx, parseDocx } from '../lib/docx.js';
import { buildEpub, parseEpub } from '../lib/epub.js';
import { parseImport, decodeText, markdownToPlain, splitChapters, CHAPTER_TITLE_RE } from '../lib/import-parse.js';
import { docxToPdf, pdfEngineAvailable } from '../lib/pdf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// 每次运行用独立子目录：其他队友的验证脚本可能同时清理 scripts/.tmp。
const TMP_ROOT = join(HERE, '.tmp');
const TMP = join(TMP_ROOT, `verify-docs-${process.pid}`);
const KEEP = process.argv.includes('--keep');

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.log(`  FAIL ${name}`);
    console.log(`       ${error && error.message ? error.message : error}`);
    if (error && error.stack) {
      console.log(
        error.stack
          .split('\n')
          .slice(1, 4)
          .map((line) => `       ${line.trim()}`)
          .join('\n'),
      );
    }
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const CHAPTERS = [
  {
    title: '第一章 风起',
    content: '青山依旧在，几度夕阳红。\n\n他推开门，看见雪落满了院子。\n“你来了。”她说。',
  },
  {
    title: '第二章 云涌',
    content: '第二天清早，天光未亮。\n\n街市上已经有了人声，\n卖豆腐的挑着担子走过石桥。',
  },
  {
    title: '第三章 归途',
    content: '三年之后，他终于回到那座城。\n\n城门上的字迹已经斑驳。\n——全书完——',
  },
];

const BOOK = { title: '青山旧事', author: '无名氏' };

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ */
/* 1. zip                                                              */
/* ------------------------------------------------------------------ */

async function verifyZip() {
  section('1. zipSync → unzipSync 往返');

  const binary = Buffer.alloc(1024);
  for (let i = 0; i < binary.length; i += 1) binary[i] = (i * 37 + 11) & 0xff;

  const files = {
    'hello.txt': '你好，世界！',
    'nested/dir/data.bin': binary,
    '中文目录/章节一.txt': '第一章内容\n第二行',
    'empty.txt': '',
    mimetype: 'application/epub+zip',
  };

  const zip = zipSync(files, { store: ['mimetype'] });
  assert.ok(Buffer.isBuffer(zip), 'zipSync 应返回 Buffer');
  assert.equal(zip.readUInt32LE(0), 0x04034b50, '第一个条目应以 local file header 开始');

  const back = unzipSync(zip);
  assert.ok(back instanceof Map, 'unzipSync 应返回 Map');
  assert.equal(back.size, Object.keys(files).length, '条目数应一致');
  for (const [name, value] of Object.entries(files)) {
    const got = back.get(name);
    assert.ok(got, `缺少条目 ${name}`);
    assert.equal(got.toString('binary'), Buffer.from(value).toString('binary'), `条目内容不一致: ${name}`);
  }

  await check('mimetype 条目为 STORED 且位于第一个', async () => {
    // 第一个 local header 的方法字段必须是 0（store）
    assert.equal(zip.readUInt16LE(8), 0, 'mimetype 应以 store 写入');
    const nameLen = zip.readUInt16LE(26);
    const name = zip.subarray(30, 30 + nameLen).toString('utf8');
    assert.equal(name, 'mimetype', 'mimetype 必须是第一个条目');
  });

  await check('UTF-8 文件名置了 bit 11', async () => {
    const flags = zip.readUInt16LE(6);
    assert.equal(flags & 0x0800, 0x0800, 'general purpose bit 11 应置位');
  });

  await check('deflate 条目确实是压缩存储的', async () => {
    // 大量重复内容必须被压缩
    const big = 'abcdefgh'.repeat(4096);
    const z = zipSync({ 'big.txt': big, small: 'x' });
    const rejected = unzipSync(z).get('big.txt').toString('utf8');
    assert.equal(rejected, big);
    const compressed = z.length;
    assert.ok(compressed < big.length / 4, `重复内容应显著压缩（${compressed} vs ${big.length}）`);
  });

  await check('CRC32 正确（篡改被发现的间接验证：解压大小与 CRC 均可用）', async () => {
    const payload = Buffer.from('The quick brown fox jumps over the lazy dog');
    const z = zipSync({ 'fox.txt': payload });
    // central directory 中记录的 CRC 应与独立计算结果一致
    const cdOffset = z.readUInt32LE(z.length - 22 + 16);
    const centralCrc = z.readUInt32LE(cdOffset + 16);
    const expected = crc32ForTest(payload);
    assert.equal(centralCrc, expected, 'central directory 的 CRC 应等于独立计算值');
    assert.equal(unzipSync(z).get('fox.txt').toString(), payload.toString());
  });

  await check('带 data descriptor 条目（size=0 在本地头）也能解析', async () => {
    const built = buildStreamedZip({
      'streamed.txt': 'streamed descriptor payload',
    });
    const parsed = unzipSync(built);
    assert.equal(parsed.get('streamed.txt').toString(), 'streamed descriptor payload');
  });

  await check('非法输入抛错而不是静默返回空', async () => {
    assert.throws(() => unzipSync(Buffer.from('not a zip file at all!!')), /ZIP/);
  });
}

/* 独立实现的 CRC32，用于交叉验证 lib/zip.js 的输出 */
function crc32ForTest(buf) {
  let table = crc32ForTest.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32ForTest.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a zip whose local headers carry zeros and a data descriptor (like streamed writers). */
function buildStreamedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const raw = Buffer.from(value);
    const nameBytes = Buffer.from(name, 'utf8');
    const payload = deflateRawSync(raw);
    const crc = crc32ForTest(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800 | 0x0008, 6); // UTF-8 + data descriptor
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc = 0
    local.writeUInt32LE(0, 18); // csize = 0
    local.writeUInt32LE(0, 22); // usize = 0
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(payload.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);

    locals.push(local, nameBytes, payload, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800 | 0x0008, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + payload.length + descriptor.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------ */
/* 2. docx                                                             */
/* ------------------------------------------------------------------ */

async function verifyDocx() {
  section('2. buildDocx → parseDocx 往返');

  const docx = buildDocx({
    title: BOOK.title,
    author: BOOK.author,
    chapters: CHAPTERS,
    options: { pageBreak: true, coverBase64: PNG_BASE64 },
  });

  const file = join(TMP, 'sample.docx');
  await writeFile(file, docx);

  const parts = unzipSync(docx);
  await check('OOXML 必要部件齐全', async () => {
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/settings.xml',
      'word/footer1.xml',
      'word/_rels/document.xml.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'word/media/cover.png',
    ]) {
      assert.ok(parts.has(name), `缺少 ${name}`);
    }
  });

  await check('document.xml 含 A4 页面与页边距', async () => {
    const xml = parts.get('word/document.xml').toString('utf8');
    assert.match(xml, /<w:pgSz w:w="11906" w:h="16838"\/>/, 'A4 页面尺寸');
    assert.match(xml, /<w:pgMar [^>]*w:top="1440"/, '上页边距 1440');
    assert.match(xml, /<w:pgMar [^>]*w:bottom="1440"/, '下页边距 1440');
    assert.match(xml, /<w:pgMar [^>]*w:left="1247"/, '左页边距 1247');
    assert.match(xml, /<w:pgMar [^>]*w:right="1247"/, '右页边距 1247');
  });

  await check('正文宋体 12pt、首行缩进 2 字符、1.5 倍行距', async () => {
    const xml = parts.get('word/document.xml').toString('utf8');
    assert.match(xml, /w:eastAsia="宋体"/, '正文东亚字体为宋体');
    assert.match(xml, /<w:sz w:val="24"\/>/, '12pt = w:sz 24');
    assert.match(xml, /w:firstLine="480"/, '首行缩进 480 twips（2 字符）');
    assert.match(xml, /w:line="360" w:lineRule="auto"/, '1.5 倍行距');
  });

  await check('章标题使用 Heading1 样式', async () => {
    const xml = parts.get('word/document.xml').toString('utf8');
    assert.match(xml, /<w:pStyle w:val="Heading1"\/>/, '应出现 Heading1 段落');
    const styles = parts.get('word/styles.xml').toString('utf8');
    assert.match(styles, /w:styleId="Heading1"/, 'styles.xml 应定义 Heading1');
  });

  await check('页脚含 PAGE 域', async () => {
    const footer = parts.get('word/footer1.xml').toString('utf8');
    assert.match(footer, /PAGE/, '页脚应包含 PAGE 域');
    const xml = parts.get('word/document.xml').toString('utf8');
    assert.match(xml, /<w:footerReference w:type="default" r:id="rIdFooter1"\/>/, 'sectPr 应引用页脚');
  });

  await check('章节之间插入分页符', async () => {
    const xml = parts.get('word/document.xml').toString('utf8');
    const breaks = xml.match(/<w:br w:type="page"\/>/g) || [];
    assert.ok(breaks.length >= CHAPTERS.length, `分页符数量应 >= 章节数（实际 ${breaks.length}）`);
  });

  await check('core.xml 含 title/creator/created', async () => {
    const core = parts.get('docProps/core.xml').toString('utf8');
    assert.match(core, /<dc:title>青山旧事<\/dc:title>/);
    assert.match(core, /<dc:creator>无名氏<\/dc:creator>/);
    assert.match(core, /<dcterms:created[^>]*>\d{4}-\d{2}-\d{2}T/);
  });

  await check('parseDocx 往返：标题与段落一致', async () => {
    const parsed = parseDocx(docx);
    assert.equal(parsed.title, BOOK.title, 'title 应一致');
    assert.equal(parsed.author, BOOK.author, 'author 应一致');

    const headings = parsed.paragraphs.filter((p) => p.style === 'Heading1');
    assert.deepEqual(
      headings.map((p) => p.text),
      CHAPTERS.map((c) => c.title),
      'Heading1 段落应等于章节标题序列',
    );

    // 每章正文的非空行都应作为独立段落出现
    const bodyTexts = parsed.paragraphs.map((p) => p.text);
    for (const chapter of CHAPTERS) {
      for (const line of chapter.content.split('\n')) {
        if (!line.trim()) continue;
        assert.ok(bodyTexts.includes(line), `缺少正文段落: ${line}`);
      }
    }
  });

  await check('空行产生空段落', async () => {
    const parsed = parseDocx(docx);
    const empties = parsed.paragraphs.filter((p) => p.text === '').length;
    assert.ok(empties > 0, '应有空段落代表空行');
  });

  await check('分页符段落不产生多余换行文本', async () => {
    const parsed = parseDocx(docx);
    // `<w:br w:type="page"/>` 只换页，不应变成 "\n"
    const stray = parsed.paragraphs.filter((p) => p.text === '\n');
    assert.equal(stray.length, 0, `分页符段落不应产生换行文本，实际 ${stray.length} 个`);
  });

  await check('制表符与软换行往返', async () => {
    const parsed = parseDocx(
      buildDocx({ title: 'T', chapters: [{ title: 'C', content: 'a\tb\nc' }] }),
    );
    assert.ok(parsed.paragraphs.some((p) => p.text === 'a\tb'), 'tab 应还原为 \\t');
    assert.ok(parsed.paragraphs.some((p) => p.text === 'c'), '换行应拆成独立段落');
  });

  await check('pageBreak:false 时不分页', async () => {
    const noBreak = buildDocx({ title: 'T', author: 'A', chapters: CHAPTERS, options: { pageBreak: false } });
    const xml = unzipSync(noBreak).get('word/document.xml').toString('utf8');
    assert.equal((xml.match(/<w:br w:type="page"\/>/g) || []).length, 0, '不应有分页符');
  });

  await check('XML 特殊字符被正确转义', async () => {
    const tricky = buildDocx({
      title: 'A & B <C>',
      author: '"引号"',
      chapters: [{ title: '第<1>章 & 开始', content: '5 < 6 && 7 > 6\n<w:p>不是标签</w:p>' }],
    });
    const parsed = parseDocx(tricky);
    assert.equal(parsed.title, 'A & B <C>');
    assert.equal(parsed.paragraphs.find((p) => p.style === 'Heading1').text, '第<1>章 & 开始');
    assert.ok(parsed.paragraphs.some((p) => p.text === '<w:p>不是标签</w:p>'), '转义文本应原样还原');
  });

  console.log(`  file ${file} (${(await stat(file)).size} bytes)`);
}

/* ------------------------------------------------------------------ */
/* 3. epub                                                             */
/* ------------------------------------------------------------------ */

async function verifyEpub() {
  section('3. buildEpub → parseEpub 往返');

  const epub = buildEpub({
    title: BOOK.title,
    author: BOOK.author,
    language: 'zh-CN',
    chapters: CHAPTERS,
    options: { coverBase64: PNG_BASE64 },
  });

  const file = join(TMP, 'sample.epub');
  await writeFile(file, epub);

  const parts = unzipSync(epub);
  const names = [...parts.keys()];

  await check('mimetype 是第一个条目且 store 不压缩', async () => {
    assert.equal(names[0], 'mimetype', 'mimetype 必须是第一个条目');
    assert.equal(parts.get('mimetype').toString(), 'application/epub+zip', 'mimetype 内容');
    // 直接在原 buffer 上确认第一个条目 method=0 且数据紧跟文件名
    assert.equal(epub.readUInt32LE(0), 0x04034b50);
    assert.equal(epub.readUInt16LE(8), 0, 'mimetype 必须 method=0 (stored)');
    const nameLen = epub.readUInt16LE(26);
    assert.equal(nameLen, 8);
    assert.equal(epub.subarray(30, 38).toString(), 'mimetype');
    assert.equal(epub.subarray(38, 38 + 20).toString(), 'application/epub+zip');
  });

  await check('EPUB 必备部件齐全', async () => {
    for (const name of [
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/style.css',
      'OEBPS/text/chapter-1.xhtml',
      'OEBPS/text/chapter-2.xhtml',
      'OEBPS/text/chapter-3.xhtml',
      'OEBPS/text/cover.xhtml',
      'OEBPS/images/cover.png',
    ]) {
      assert.ok(parts.has(name), `缺少 ${name}`);
    }
  });

  await check('container.xml 指向 OEBPS/content.opf', async () => {
    const xml = parts.get('META-INF/container.xml').toString('utf8');
    assert.match(xml, /full-path="OEBPS\/content\.opf"/);
    assert.match(xml, /media-type="application\/oebps-package\+xml"/);
  });

  await check('content.opf 含完整 metadata / manifest / spine', async () => {
    const opf = parts.get('OEBPS/content.opf').toString('utf8');
    assert.match(opf, /<dc:title>青山旧事<\/dc:title>/);
    assert.match(opf, /<dc:creator[^>]*>无名氏<\/dc:creator>/);
    assert.match(opf, /<dc:language>zh-CN<\/dc:language>/);
    assert.match(opf, /<dc:identifier id="bookid">urn:uuid:[0-9a-f-]{36}<\/dc:identifier>/);
    assert.match(opf, /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/);
    assert.match(opf, /<meta name="cover" content="cover-image"\/>/);
    assert.match(opf, /properties="nav"/);
    assert.match(opf, /media-type="application\/x-dtbncx\+xml"/);
    assert.match(opf, /<spine toc="ncx">/);
    assert.match(opf, /<itemref idref="cover"\/>/);
    for (let i = 1; i <= CHAPTERS.length; i += 1) {
      assert.match(opf, new RegExp(`<itemref idref="chapter-${i}"/>`), `spine 应包含 chapter-${i}`);
    }
  });

  await check('nav.xhtml 带 nav epub:type="toc"', async () => {
    const nav = parts.get('OEBPS/nav.xhtml').toString('utf8');
    assert.match(nav, /<nav epub:type="toc"/);
    for (const chapter of CHAPTERS) {
      assert.ok(nav.includes(chapter.title), `目录应包含 ${chapter.title}`);
    }
  });

  await check('每章 XHTML 是 XHTML5 且用 h1/p', async () => {
    const chapter1 = parts.get('OEBPS/text/chapter-1.xhtml').toString('utf8');
    assert.match(chapter1, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(chapter1, /<!DOCTYPE html>/);
    assert.match(chapter1, /<html xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.match(chapter1, /<h1>第一章 风起<\/h1>/);
    assert.match(chapter1, /<p>/);
    assert.doesNotMatch(chapter1, /&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });

  await check('parseEpub 往返：章节数与标题一致', async () => {
    const parsed = parseEpub(epub);
    assert.equal(parsed.title, BOOK.title, 'title 应一致');
    assert.equal(parsed.author, BOOK.author, 'author 应一致');
    assert.equal(parsed.chapters.length, CHAPTERS.length, '章节数应一致');
    assert.deepEqual(
      parsed.chapters.map((c) => c.title),
      CHAPTERS.map((c) => c.title),
      '章节标题应一致',
    );
    for (let i = 0; i < CHAPTERS.length; i += 1) {
      const expectedLines = CHAPTERS[i].content.split('\n').filter((l) => l.trim());
      const actualLines = parsed.chapters[i].content.split('\n').filter((l) => l.trim());
      assert.deepEqual(actualLines, expectedLines, `第 ${i + 1} 章正文应一致`);
    }
  });

  await check('无封面时也能正确构建/解析', async () => {
    const bare = buildEpub({ title: '无封面书', author: '某人', chapters: CHAPTERS, options: {} });
    const parsed = parseEpub(bare);
    assert.equal(parsed.chapters.length, CHAPTERS.length);
    assert.ok(!unzipSync(bare).has('OEBPS/images/cover.png'));
  });

  await check('单章 / 空章节列表可用', async () => {
    const one = buildEpub({ title: '单章', chapters: [{ title: '唯一章', content: '只有一行' }] });
    const parsed = parseEpub(one);
    assert.equal(parsed.chapters.length, 1);
    assert.equal(parsed.chapters[0].title, '唯一章');
    const none = buildEpub({ title: '空书', chapters: [] });
    assert.ok(unzipSync(none).has('OEBPS/content.opf'));
  });

  console.log(`  file ${file} (${(await stat(file)).size} bytes)`);
}

/* ------------------------------------------------------------------ */
/* 4. import-parse                                                     */
/* ------------------------------------------------------------------ */

const TXT_SAMPLE = `青山旧事
作者：无名氏

第一章 风起

青山依旧在，几度夕阳红。
他推开门，看见雪落满了院子。

第二章 云涌

第二天清早，天光未亮。
街市上已经有了人声。

第三章 归途

三年之后，他终于回到那座城。
城门上的字迹已经斑驳。
`;

const MD_SAMPLE = `# 青山旧事

> 作者：无名氏

## 第一章 风起

**青山**依旧在，几度*夕阳红*。
他推开门，看见雪落满了院子。
\`inline code\` 也要去掉标记。

## 第二章 云涌

第二天清早，天光未亮。

- 街市上已经有了人声。
- 卖豆腐的挑着担子走过石桥。

## 第三章 归途

### 小节标题

三年之后，他终于回到那座城。
`;

async function verifyImport() {
  section('4. parseImport 分派与分章');

  await check('CONTRACT §3 分章正则行为正确', async () => {
    const positives = [
      '第一章 风起',
      '  第二十三章',
      '第1章',
      '第一百零八回 大结局',
      'Chapter 12 The End',
      '序章',
      '楔子',
      '尾声',
      '后记',
      '番外 其一',
      '1、开始',
      '12．某节',
    ];
    for (const sample of positives) {
      assert.ok(CHAPTER_TITLE_RE.test(sample), `应识别为章节标题: ${sample}`);
    }
    const negatives = ['青山依旧在，几度夕阳红。', '他推开门。', '这是一个测试。'];
    for (const sample of negatives) {
      assert.ok(!CHAPTER_TITLE_RE.test(sample), `不应识别为章节标题: ${sample}`);
    }
  });

  await check('txt：三章分章 + 首部作第 1 章', async () => {
    const result = await parseImport({ name: '青山旧事.txt', bytes: Buffer.from(TXT_SAMPLE, 'utf8') });
    assert.equal(result.title, '青山旧事');
    assert.equal(result.author, '无名氏');
    assert.equal(result.chapters.length, 4, `期望 4 段（首部 + 3 章），实际 ${result.chapters.length}: ${result.chapters.map((c) => c.title).join(' / ')}`);
    assert.deepEqual(
      result.chapters.map((c) => c.title),
      ['青山旧事', '第一章 风起', '第二章 云涌', '第三章 归途'],
    );
    assert.ok(result.chapters[1].content.includes('青山依旧在'));
    assert.ok(result.chapters[3].content.includes('城门上的字迹'));
  });

  await check('txt：GB18030 编码回退', async () => {
    // "第一章 风起" + 正文，用 GB18030 编码（Node 无编码器，故用已知字节串）
    // 第 一 章 空格 风 起 \n 你 好
    const gbk = Buffer.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb7, 0xe7, 0xc6, 0xf0, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a,
    ]);
    const decoded = decodeText(gbk);
    assert.equal(decoded.encoding, 'gb18030', '应识别为 GB18030');
    assert.ok(decoded.text.includes('第一章 风起'), `解码结果: ${decoded.text}`);
    assert.ok(decoded.text.includes('你好'));
    const result = await parseImport({ name: 'gbk小说.txt', bytes: gbk });
    assert.ok(result.chapters.some((c) => c.title.includes('第一章')), 'GBK 文本也应能分章');
  });

  await check('md：去标记但保留标题层级', async () => {
    const result = await parseImport({ name: '青山旧事.md', bytes: Buffer.from(MD_SAMPLE, 'utf8') });
    assert.equal(result.title, '青山旧事');
    assert.equal(result.author, '无名氏');
    assert.ok(result.chapters.length >= 4, `章节数应 >= 4（书名 + 3 章），实际 ${result.chapters.length}`);
    const titles = result.chapters.map((c) => c.title);
    assert.ok(titles.includes('第一章 风起'), `标题: ${titles.join(' / ')}`);
    assert.ok(titles.includes('第二章 云涌'));
    assert.ok(titles.includes('第三章 归途'));
    const joined = result.chapters.map((c) => c.content).join('\n');
    assert.ok(joined.includes('青山依旧在'), '正文应保留');
    assert.ok(!joined.includes('**'), '加粗标记应被去除');
    assert.ok(!joined.includes('##'), '标题标记应被去除');
    assert.ok(!joined.includes('`inline code`'), '行内代码反引号应被去除');
  });

  await check('md：markdownToPlain 保留标题层级信息', async () => {
    const { text, headings } = markdownToPlain('# 书名\n\n## 第一章\n\n正文\n\n### 小节\n');
    assert.deepEqual(headings.map((h) => [h.level, h.title]), [
      [1, '书名'],
      [2, '第一章'],
      [3, '小节'],
    ]);
    assert.equal(text.split('\n')[0], '书名');
  });

  await check('docx：导入还原章节', async () => {
    const docx = buildDocx({ title: BOOK.title, author: BOOK.author, chapters: CHAPTERS });
    const result = await parseImport({ name: '青山旧事.docx', bytes: docx });
    assert.equal(result.title, BOOK.title);
    assert.equal(result.author, BOOK.author);
    assert.equal(result.chapters.length, CHAPTERS.length, `章节数: ${result.chapters.map((c) => c.title).join(' / ')}`);
    assert.deepEqual(result.chapters.map((c) => c.title), CHAPTERS.map((c) => c.title));
    assert.ok(result.chapters[0].content.includes('青山依旧在'));
  });

  await check('epub：导入还原章节', async () => {
    const epub = buildEpub({ title: BOOK.title, author: BOOK.author, chapters: CHAPTERS });
    const result = await parseImport({ name: '青山旧事.epub', bytes: epub });
    assert.equal(result.title, BOOK.title);
    assert.equal(result.author, BOOK.author);
    assert.equal(result.chapters.length, CHAPTERS.length);
    assert.deepEqual(result.chapters.map((c) => c.title), CHAPTERS.map((c) => c.title));
  });

  await check('splitChapters 对首部短行取作标题', async () => {
    const chapters = splitChapters('短标题\n正文一\n\n第二章 二\n正文二\n', { title: '书名' });
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, '短标题');
    assert.equal(chapters[1].title, '第二章 二');
  });

  await check('未知扩展名按文本处理', async () => {
    const result = await parseImport({ name: 'novel.xyz', bytes: Buffer.from(TXT_SAMPLE, 'utf8') });
    assert.ok(result.chapters.length >= 1);
  });

  await check('空文件不崩', async () => {
    const result = await parseImport({ name: 'empty.txt', bytes: Buffer.alloc(0) });
    assert.equal(result.chapters.length, 0);
    assert.equal(result.title, 'empty');
  });
}

/* ------------------------------------------------------------------ */
/* 5. pdf                                                              */
/* ------------------------------------------------------------------ */

async function verifyPdf() {
  section('5. docxToPdf');

  const docx = buildDocx({ title: BOOK.title, author: BOOK.author, chapters: CHAPTERS });
  const outFile = join(TMP, 'sample.pdf');

  await check('无 ctx 时抛 PDF 引擎不可用（或成功生成）', async () => {
    const available = await pdfEngineAvailable();
    console.log(`       LibreOffice kit 可导入: ${available}`);
    try {
      const pdf = await docxToPdf(null, docx);
      assert.ok(Buffer.isBuffer(pdf));
      assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
      await writeFile(outFile, pdf);
      console.log(`       PDF 生成成功（兜底引擎）: ${pdf.length} bytes`);
    } catch (error) {
      assert.equal(error.message, 'PDF 引擎不可用', `意外错误: ${error.message}`);
      console.log('       PDF 引擎不可用（按契约抛出约定错误）');
    }
  });

  await check('officeToPdf 服务优先路径（桩服务）', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\n% fake pdf for service-path test\n');
    const calls = [];
    const ctx = {
      get(name) {
        if (name !== 'officeToPdf') return undefined;
        return {
          async convert(request) {
            calls.push(request);
            const { bytes } = await request.source.read(undefined, 1 << 20);
            assert.ok(bytes instanceof Uint8Array);
            return { pdf: new Uint8Array(fakePdf), missingFonts: [], cacheKey: 'k', generation: 'g' };
          },
        };
      },
    };
    const pdf = await docxToPdf(ctx, docx);
    assert.equal(pdf.toString(), fakePdf.toString(), '应返回服务给出的 PDF 字节');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].extension, 'docx');
    assert.equal(calls[0].priority, 'foreground');
    assert.match(calls[0].source.key, /^novel-/);
    assert.equal(calls[0].source.version, '1');
  });

  await check('officeToPdf 抛错时回退到内置引擎（或抛约定错误）', async () => {
    const ctx = {
      get() {
        return {
          async convert() {
            throw new Error('service exploded');
          },
        };
      },
    };
    try {
      const pdf = await docxToPdf(ctx, docx);
      assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
      await writeFile(outFile, pdf);
    } catch (error) {
      assert.equal(error.message, 'PDF 引擎不可用');
    }
  });
}

/* ------------------------------------------------------------------ */
/* python-docx cross-check                                             */
/* ------------------------------------------------------------------ */

async function verifyWithPython() {
  section('6. 外部验证（python-docx）');

  const python =
    process.env.NW_PYTHON ||
    'C:\\Users\\17737\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';

  /** Run one python script and return its stdout. */
  const runPython = async (scriptPath, filePath) => {
    const { spawn } = await import('node:child_process');
    return await new Promise((resolve, reject) => {
      const child = spawn(python, [scriptPath, filePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      child.stderr.on('data', (chunk) => {
        err += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)),
      );
    });
  };

  const script = join(TMP, 'check_docx.py');
  await writeFile(
    script,
    [
      'import sys, zipfile',
      'from docx import Document',
      'path = sys.argv[1]',
      'd = Document(path)',
      'paras = [p for p in d.paragraphs]',
      'print("paragraphs:", len(paras))',
      'print("first:", repr(paras[0].text if paras else ""))',
      'heads = [p.text for p in paras if p.style.name.lower().startswith("heading")]',
      'print("headings:", heads)',
      'print("styles:", sorted({p.style.name for p in paras}))',
      'with zipfile.ZipFile(path) as z:',
      '    bad = z.testzip()',
      '    print("zip_testzip:", bad)',
      '    print("zip_parts:", len(z.namelist()))',
      's = d.sections[0]',
      'print("page:", s.page_width.twips, s.page_height.twips)',
      'print("margins:", s.top_margin.twips, s.bottom_margin.twips, s.left_margin.twips, s.right_margin.twips)',
      'print("footer_xml_has_PAGE:", "PAGE" in d.sections[0].footer.paragraphs[0]._p.xml)',
    ].join('\n'),
    'utf8',
  );

  await check('python-docx 能打开生成的 docx', async () => {
    const output = await runPython(script, join(TMP, 'sample.docx'));
    console.log(
      output
        .split('\n')
        .map((line) => `       ${line}`)
        .join('\n'),
    );
    assert.match(output, /paragraphs: [1-9]/);
    assert.match(output, /zip_testzip: None/);
    assert.match(output, /page: 11906 16838/);
    assert.match(output, /margins: 1440 1440 1247 1247/);
    assert.match(output, /footer_xml_has_PAGE: True/);
  });

  // 排版细节（缩进 / 行距 / 字号 / 字体）——用 python-docx 的语义化读数验证
  const detailScript = join(TMP, 'check_docx_style.py');
  await writeFile(
    detailScript,
    [
      'import sys',
      'from docx import Document',
      'from docx.enum.text import WD_LINE_SPACING',
      'd = Document(sys.argv[1])',
      'body = [p for p in d.paragraphs if p.style.name == "Normal" and p.text.strip()]',
      'p0 = body[0]',
      'pf = p0.paragraph_format',
      'r = p0.runs[0]',
      'print("indent_twips:", pf.first_line_indent.twips if pf.first_line_indent else None)',
      'print("line_spacing:", pf.line_spacing)',
      'print("rule_is_one_and_half:", pf.line_spacing_rule == WD_LINE_SPACING.ONE_POINT_FIVE)',
      'print("size_pt:", r.font.size.pt if r.font.size else None)',
      'print("eastasia_font:", r.font.name)',
      'heads = [p for p in d.paragraphs if p.style.name.startswith("Heading")]',
      'print("heading_count:", len(heads))',
      'print("heading_bold:", all(any(run.bold for run in h.runs) for h in heads))',
      'print("heading_centered:", sorted({str(h.paragraph_format.alignment) for h in heads}))',
      'print("core_title:", repr(d.core_properties.title))',
      'print("core_author:", repr(d.core_properties.author))',
      'print("core_created_is_set:", d.core_properties.created is not None)',
    ].join('\n'),
    'utf8',
  );

  await check('python-docx 读回的排版与契约一致', async () => {
    const output = await runPython(detailScript, join(TMP, 'sample.docx'));
    console.log(output.split('\n').map((line) => `       ${line}`).join('\n'));
    assert.match(output, /indent_twips: 480/, '首行缩进应为 480 twips（2 字符）');
    assert.match(output, /line_spacing: 1\.5/, '行距应为 1.5');
    assert.match(output, /rule_is_one_and_half: True/);
    assert.match(output, /size_pt: 12\.0/, '正文字号应为 12pt (w:sz 24)');
    assert.match(output, /eastasia_font: 宋体/);
    assert.match(output, /heading_bold: True/);
    assert.match(output, /core_created_is_set: True/);
  });

  // 反向：让 python-docx（真实的 Word 工具链）造一个 docx，再用 parseDocx /
  // parseImport 解析，证明我们能读别人的文件而不只是读自己写的。
  const foreignScript = join(TMP, 'make_foreign.py');
  await writeFile(
    foreignScript,
    [
      'import sys',
      'from docx import Document',
      'doc = Document()',
      'doc.core_properties.title = "外来文档"',
      'doc.core_properties.author = "另一个工具"',
      'doc.add_heading("第一章 外来", level=1)',
      'doc.add_paragraph("由 python-docx 生成的第一段。")',
      'doc.add_paragraph("")',
      'doc.add_paragraph("第二段，含\\ttab。")',
      'doc.add_heading("第二章 对照", level=1)',
      'doc.add_paragraph("列表前的段落。")',
      'doc.add_paragraph("甲", style="List Bullet")',
      'table = doc.add_table(rows=1, cols=2)',
      'table.cell(0, 0).text = "单元格A"',
      'table.cell(0, 1).text = "单元格B"',
      'doc.add_heading("第三章 收尾", level=2)',
      'doc.add_paragraph("最后一段。")',
      'doc.save(sys.argv[1])',
    ].join('\n'),
    'utf8',
  );

  await check('parseDocx / parseImport 能读 python-docx 生成的文件', async () => {
    const foreign = join(TMP, 'foreign.docx');
    await runPython(foreignScript, foreign);
    const bytes = await readFile(foreign);

    const parsed = parseDocx(bytes);
    assert.equal(parsed.title, '外来文档');
    assert.equal(parsed.author, '另一个工具');
    const headings = parsed.paragraphs.filter((p) => /^Heading\d$/.test(p.style)).map((p) => p.text);
    assert.deepEqual(headings, ['第一章 外来', '第二章 对照', '第三章 收尾'], 'Heading 样式与文本');
    assert.ok(
      parsed.paragraphs.some((p) => p.text === '第二段，含\ttab。'),
      'tab 应还原为 \\t',
    );
    assert.equal(parsed.paragraphs.find((p) => p.style === 'Heading2').text, '第三章 收尾');

    const imported = await parseImport({ name: 'foreign.docx', bytes });
    assert.equal(imported.title, '外来文档');
    assert.equal(imported.author, '另一个工具');
    assert.equal(imported.chapters.length, 3, `章节数 ${imported.chapters.length}`);
    assert.deepEqual(
      imported.chapters.map((c) => c.title),
      ['第一章 外来', '第二章 对照', '第三章 收尾'],
    );
    assert.ok(imported.chapters[0].content.includes('由 python-docx 生成的第一段。'));
    console.log(`       外来 docx: ${parsed.paragraphs.length} 段 / ${imported.chapters.length} 章`);
  });
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('novel-writer 文档引擎验证');
  console.log(`node ${process.version} · tmp=${TMP}`);

  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  try {
    await verifyZip();
    await verifyDocx();
    await verifyEpub();
    await verifyImport();
    await verifyPdf();
    await verifyWithPython();
  } finally {
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    if (KEEP) {
      console.log(`产物保留在 ${TMP}`);
    } else {
      await rm(TMP, { recursive: true, force: true }).catch(() => {});
      console.log('已清理本次运行的临时目录');
      // 只有在本目录彻底空掉时才移除 .tmp 本身，避免和队友的验证脚本打架。
      const leftovers = await readdir(TMP_ROOT).catch(() => []);
      if (leftovers.length === 0) await rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (failed > 0) {
    console.log('\n失败详情:');
    for (const { name, error } of failures) {
      console.log(`- ${name}: ${error && error.stack ? error.stack.split('\n')[0] : error}`);
    }
    process.exitCode = 1;
  }
}

await main();
