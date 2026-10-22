/**
 * EPUB 3 writer / reader for the Novel Studio host.
 *
 * Writing produces a spec-shaped EPUB 3 package:
 *   - `mimetype` as the FIRST entry, STORED (uncompressed), content
 *     `application/epub+zip`
 *   - `META-INF/container.xml` pointing at `OEBPS/content.opf`
 *   - `OEBPS/content.opf` with dc:title / dc:creator / dc:language /
 *     dc:identifier (urn:uuid:...) / dcterms:modified, a manifest and a spine
 *   - `OEBPS/nav.xhtml` with `<nav epub:type="toc">`
 *   - `OEBPS/toc.ncx` for EPUB 2 readers
 *   - one `OEBPS/text/chapter-N.xhtml` per chapter (XHTML5)
 *   - `OEBPS/style.css`
 *   - optional cover: `OEBPS/images/cover.(png|jpg)` + `OEBPS/text/cover.xhtml`
 *     + `<meta name="cover" .../>` plus a `cover-image` manifest property
 *
 * Only Node builtins; ZIP packing lives in ./zip.js.
 */

import { randomUUID } from 'node:crypto';
import { zipSync, unzipSync } from './zip.js';

const MIMETYPE = 'application/epub+zip';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function decodeXml(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&amp;/g, '&');
}

/** Strip tags / decode entities from an XML or XHTML fragment. */
function stripTags(html) {
  return decodeXml(
    String(html ?? '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\u00a0/g, ' ');
}

function isoModified(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function detectImageKind(base64) {
  const head = String(base64 || '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'png';
  if (head.startsWith('R0lGOD')) return 'gif';
  if (head.startsWith('UklGR')) return 'webp';
  return null;
}

function imageExt(kind) {
  return kind === 'jpeg' ? 'jpg' : kind;
}

function mediaType(kind) {
  return kind === 'jpg' ? 'image/jpeg' : `image/${kind}`;
}

/** Split content into paragraphs; blank lines become empty paragraphs. */
function toParagraphs(content) {
  const lines = String(content ?? '').split(/\r\n|\r|\n/);
  return lines.length ? lines : [''];
}

function chapterXhtml({ title, content, language, cssHref = '../style.css', withCover = false }) {
  const paragraphs = toParagraphs(content)
    .map((line) => `<p>${line.length ? escapeXml(line) : '<br/>'}</p>`)
    .join('\n');
  return `${XML_DECL}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeXml(cssHref)}"/>
</head>
<body${withCover ? ' epub:type="cover"' : ''}>
<section epub:type="chapter">
<h1>${escapeXml(title)}</h1>
${paragraphs}
</section>
</body>
</html>`;
}

function coverXhtml({ title, language, imageHref, media }) {
  return `${XML_DECL}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<style type="text/css">html,body{margin:0;padding:0;height:100%;text-align:center;}img{max-width:100%;max-height:100%;}</style>
</head>
<body epub:type="cover">
<section epub:type="cover">
<img src="${escapeXml(imageHref)}" alt="${escapeXml(title)}"${media ? '' : ''}/>
</section>
</body>
</html>`;
}

function navXhtml({ title, language, entries }) {
  const items = entries
    .map((entry) => `      <li><a href="${escapeXml(entry.href)}">${escapeXml(entry.label || entry.title || '')}</a></li>`)
    .join('\n');
  return `${XML_DECL}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>目录</h1>
  <ol>
${items}
  </ol>
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
  <ol>
    <li><a epub:type="bodymatter" href="${escapeXml(entries[0]?.href ?? 'text/chapter-1.xhtml')}">正文</a></li>
  </ol>
</nav>
</body>
</html>`;
}

function ncxXml({ identifier, title, entries }) {
  const points = entries
    .map(
      (entry, index) =>
        `    <navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">\n` +
        `      <navLabel><text>${escapeXml(entry.title || entry.label || '')}</text></navLabel>\n` +
        `      <content src="${escapeXml(entry.href)}"/>\n` +
        `    </navPoint>`,
    )
    .join('\n');
  return `${XML_DECL}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

function containerXml() {
  return `${XML_DECL}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function styleCss() {
  return `@charset "utf-8";

/* Reader defaults: 1em renders at whatever the device is set to, and most
   Chinese readers sit near 16-18px. Every dimension below is relative, so a
   user who bumps the font slider still gets the same rhythm. */
body {
  margin: 1em 1.1em;
  line-height: 1.85;
  font-family: "Songti SC", "SimSun", "Noto Serif CJK SC", serif;
  font-size: 1em;
}

h1 {
  font-size: 1.5em;
  text-align: center;
  margin: 1.2em 0 1em;
  line-height: 1.4;
  page-break-before: auto;
}

p {
  text-indent: 2em;
  margin: 0.5em 0;
  text-align: justify;
}

nav#toc ol {
  list-style: none;
  padding-left: 0;
}

nav#toc li {
  margin: 0.35em 0;
}
`;
}

function opfXml({ title, author, language, identifier, modified, cover, entries }) {
  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="css" href="style.css" media-type="text/css"/>',
  ];
  const spine = [];

  if (cover) {
    manifest.push(
      `    <item id="cover-image" href="images/cover.${cover.ext}" media-type="${cover.mediaType}" properties="cover-image"/>`,
    );
    manifest.push('    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('    <itemref idref="cover"/>');
  }

  entries.forEach((entry, index) => {
    manifest.push(`    <item id="chapter-${index + 1}" href="${escapeXml(entry.href)}" media-type="application/xhtml+xml"/>`);
    spine.push(`    <itemref idref="chapter-${index + 1}"/>`);
  });

  const coverMeta = cover ? '\n    <meta name="cover" content="cover-image"/>' : '';

  return `${XML_DECL}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator id="creator">${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:description></dc:description>
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>${coverMeta}
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine toc="ncx">
${spine.join('\n')}
  </spine>
</package>`;
}

/* ------------------------------------------------------------------ */
/* building                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build an EPUB 3 archive.
 *
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.author]
 * @param {string} [input.language='zh-CN']
 * @param {Array<{title?: string, content?: string}>} [input.chapters]
 * @param {object} [input.options]
 * @param {string} [input.options.coverBase64]
 * @param {string} [input.options.identifier] override the generated urn:uuid
 * @param {Date|string} [input.options.modified]
 * @param {string} [input.options.appendText] extra copy appended after the last chapter
 * @returns {Buffer}
 */
export function buildEpub({
  title = '',
  author = '',
  language = 'zh-CN',
  chapters = [],
  options = {},
} = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const bookTitle = String(title || '未命名').trim() || '未命名';
  const bookAuthor = String(author || '').trim();
  const lang = String(language || 'zh-CN');
  const identifier =
    typeof opts.identifier === 'string' && opts.identifier.trim()
      ? opts.identifier.trim()
      : `urn:uuid:${randomUUID()}`;
  const modified = isoModified(opts.modified);

  const coverBase64 =
    typeof opts.coverBase64 === 'string' ? opts.coverBase64.replace(/^data:[^;]+;base64,/, '') : '';
  const coverKind = coverBase64 ? detectImageKind(coverBase64) : null;
  const cover = coverKind
    ? { ext: imageExt(coverKind), mediaType: mediaType(imageExt(coverKind)), base64: coverBase64 }
    : null;

  const list = Array.isArray(chapters) ? chapters : [];
  const entries = list.map((chapter, index) => ({
    index,
    href: `text/chapter-${index + 1}.xhtml`,
    title: String(chapter?.title ?? '').trim() || `第${index + 1}章`,
    content: String(chapter?.content ?? ''),
  }));
  if (entries.length === 0) {
    entries.push({ index: 0, href: 'text/chapter-1.xhtml', title: bookTitle, content: '' });
  }

  // Trailing copy (contract §10): appended to the last chapter page as extra
  // `<p>` blocks, separated by a blank line so it reads as its own section.
  const appendText = typeof opts.appendText === 'string' ? opts.appendText : '';
  if (appendText.trim()) {
    const last = entries[entries.length - 1];
    const tail = appendText.replace(/\r\n|\r/g, '\n').replace(/\s+$/, '');
    last.content = last.content ? `${last.content.replace(/\s+$/, '')}\n\n${tail}` : tail;
  }

  const files = new Map();
  // The mimetype entry MUST be first and STORED.
  files.set('mimetype', MIMETYPE);
  files.set('META-INF/container.xml', containerXml());
  files.set('OEBPS/style.css', styleCss());
  files.set('OEBPS/nav.xhtml', navXhtml({ title: bookTitle, language: lang, entries }));
  files.set('OEBPS/toc.ncx', ncxXml({ identifier, title: bookTitle, entries }));

  if (cover) {
    files.set('OEBPS/images/cover.' + cover.ext, Buffer.from(cover.base64, 'base64'));
    files.set(
      'OEBPS/text/cover.xhtml',
      coverXhtml({
        title: bookTitle,
        language: lang,
        imageHref: `../images/cover.${cover.ext}`,
        media: cover.mediaType,
      }),
    );
  }

  for (const entry of entries) {
    files.set(
      `OEBPS/${entry.href}`,
      chapterXhtml({ title: entry.title, content: entry.content, language: lang }),
    );
  }

  files.set(
    'OEBPS/content.opf',
    opfXml({
      title: bookTitle,
      author: bookAuthor,
      language: lang,
      identifier,
      modified,
      cover,
      entries,
    }),
  );

  // `mimetype` must stay uncompressed; everything else deflates normally but
  // small text files that grow under deflate fall back to store inside zipSync.
  return zipSync(Object.fromEntries(files), { store: ['mimetype'], date: opts.modified ? new Date(opts.modified) : new Date() });
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function resolvePath(baseDir, href) {
  const clean = String(href || '').split('#')[0].split('?')[0];
  if (!clean) return '';
  const parts = (clean.startsWith('/') ? clean.slice(1) : `${baseDir}${clean}`).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirnameOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : `${p.slice(0, i + 1)}`;
}

function findRootfile(files) {
  const container = files.get('META-INF/container.xml');
  if (container) {
    const xml = container.toString('utf8');
    const m = /<rootfile\b[^>]*\bfull-path="([^"]+)"/i.exec(xml) || /full-path\s*=\s*["']([^"']+)["']/i.exec(xml);
    if (m) return m[1];
  }
  // Fall back to the first .opf in the archive.
  for (const name of files.keys()) {
    if (/\.opf$/i.test(name)) return name;
  }
  return null;
}

function parseOpf(xml) {
  const titleMatch = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml);
  const creatorMatch = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(xml);
  const manifest = new Map();
  const itemRe = /<item\b([^>]*)\/?>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const attrs = m[1];
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(attrs);
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs);
    const media = /\bmedia-type\s*=\s*"([^"]*)"/i.exec(attrs);
    const props = /\bproperties\s*=\s*"([^"]*)"/i.exec(attrs);
    if (!id || !href) continue;
    manifest.set(id[1], {
      href: decodeXml(href[1]),
      mediaType: media ? media[1] : '',
      properties: props ? props[1].split(/\s+/) : [],
    });
  }
  const spine = [];
  const itemrefRe = /<itemref\b([^>]*)\/?>/gi;
  while ((m = itemrefRe.exec(xml)) !== null) {
    const idref = /\bidref\s*=\s*"([^"]*)"/i.exec(m[1]);
    if (idref) spine.push(idref[1]);
  }
  const coverMeta = /<meta\b[^>]*\bname\s*=\s*"cover"[^>]*\bcontent\s*=\s*"([^"]*)"/i.exec(xml);
  return {
    title: titleMatch ? decodeXml(titleMatch[1]).trim() : '',
    author: creatorMatch ? decodeXml(creatorMatch[1] || '').trim() : '',
    manifest,
    spine,
    coverId: coverMeta ? coverMeta[1] : null,
  };
}

/** Pull headings and paragraphs out of one XHTML body. */
function parseXhtml(xml) {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const headings = [];
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = headingRe.exec(body)) !== null) {
    const text = stripTags(m[2]).trim();
    if (text) headings.push({ level: Number(m[1]), text, index: m.index });
  }

  const paragraphs = [];
  const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = paraRe.exec(body)) !== null) {
    const text = stripTags(m[1]).replace(/\s*\n\s*/g, '\n').trim();
    paragraphs.push(text);
  }

  // A title may also live in <title> for nav / cover documents.
  const docTitleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(xml);
  return {
    headings,
    paragraphs,
    docTitle: docTitleMatch ? stripTags(docTitleMatch[1]).trim() : '',
  };
}

/**
 * Parse an EPUB archive back into chapters.
 *
 * @param {Buffer|Uint8Array} input
 * @returns {{title: string, author: string, chapters: Array<{title: string, content: string}>}}
 */
export function parseEpub(input) {
  const files = unzipSync(input);
  const rootfile = findRootfile(files);
  if (!rootfile) throw new Error('不是有效的 EPUB 文件（找不到 .opf）');
  const opfRaw = files.get(rootfile);
  if (!opfRaw) throw new Error(`EPUB 的 rootfile 缺失: ${rootfile}`);

  const baseDir = dirnameOf(rootfile);
  const opf = parseOpf(opfRaw.toString('utf8'));

  const chapters = [];
  const order = opf.spine.length ? opf.spine : [...opf.manifest.keys()];
  for (const idref of order) {
    const item = opf.manifest.get(idref);
    if (!item) continue;
    if (item.properties.includes('nav')) continue;
    if (opf.coverId && idref === opf.coverId) continue;
    if (!/xhtml|html/i.test(item.mediaType) && !/\.x?html$/i.test(item.href)) continue;

    const path = resolvePath(baseDir, item.href);
    const raw = files.get(path);
    if (!raw) continue;

    const parsed = parseXhtml(raw.toString('utf8'));
    const heading = parsed.headings[0];
    const bodyParagraphs = parsed.paragraphs;
    const hasBody = bodyParagraphs.some((p) => p.trim().length > 0);
    // 标题优先取第一个标题元素；没有标题时只在有正文的情况下用 <title>
    const chapterTitle = heading ? heading.text : hasBody ? parsed.docTitle : '';
    const chapterLevel = heading ? heading.level : 1;
    // 纯封面 / 纯图片页既无标题也无正文，跳过
    if (!chapterTitle && !hasBody) continue;
    // 正文段落：跳过与标题重复的首段
    let contentParagraphs = bodyParagraphs;
    if (contentParagraphs.length && contentParagraphs[0].trim() === chapterTitle) {
      contentParagraphs = contentParagraphs.slice(1);
    }
    const content = contentParagraphs.join('\n');
    chapters.push({ title: chapterTitle, content, level: chapterLevel });
  }

  return { title: opf.title, author: opf.author, chapters };
}
